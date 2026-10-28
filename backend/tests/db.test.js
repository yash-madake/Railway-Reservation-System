'use strict'

/**
 * Team 5 database tests — the Database column of the task sheet.
 *
 * Unlike tests/payment.test.js these need a real MySQL. They exercise the
 * constraints rather than the plumbing: that a gateway id can be recorded once,
 * that a bad signature never captures, that a refund happens once, and that a
 * settled payment cannot be walked backwards.
 *
 *   npm run migrate && npm run seed && node tests/db.test.js
 *
 * Every case runs against its own booking reference and the whole set is
 * deleted in a finally block, so the suite leaves the database as it found it.
 * A transaction is not an option here: create_payment_record(),
 * confirm_payment() and process_refund() each COMMIT internally, which would
 * silently end an outer ROLLBACK.
 */

const assert = require('assert')

const { sequelize, connection } = require('../src/config/database')

const BOOKING = 'YTR-TEST-DB0001'
const ORDER = 'order_dbtest0001'
const PAYMENT = 'pay_dbtest0001'
const REFUND = 'rfnd_dbtest0001'

const results = []
let passed = 0

async function test(name, fn) {
  try {
    await fn()
    passed += 1
    results.push(['ok  ', name])
  } catch (err) {
    results.push(['FAIL', `${name}\n       ${err.message}`])
    process.exitCode = 1
  }
}

/** Assert a call fails, and that MySQL raised it with `reason`. */
async function expectRefusal(fn, reason) {
  try {
    await fn()
  } catch (err) {
    const message = err.original?.sqlMessage ?? err.parent?.sqlMessage ?? err.message
    assert.ok(
      message.includes(reason),
      `expected MySQL to refuse with "${reason}", got "${message}"`,
    )
    return message
  }
  throw new Error(`expected the call to be refused with "${reason}", but it succeeded`)
}

/** Every value is escaped by Sequelize's replacement binding. */
const rows = async (sql, ...params) => {
  const [result] = await sequelize.query(sql, { replacements: params })
  return result
}

const one = async (sql, ...params) => (await rows(sql, ...params))[0]

/** Remove anything this suite created, refunds first (FK). */
/**
 * A real booking for the payment routines to reference.
 *
 * `payments.booking_id` became NOT NULL with a RESTRICT foreign key in
 * migration 011, so the suite cannot pass a NULL any more — and it could not
 * pass an invented id either, which is the constraint working as intended.
 */
async function ensureBooking(ref = BOOKING) {
  const [existing] = await sequelize.query('SELECT booking_id FROM bookings WHERE booking_ref = ?', {
    replacements: [ref],
    type: require('sequelize').QueryTypes.SELECT,
  })
  if (existing) return existing.booking_id

  const [train] = await sequelize.query('SELECT id FROM trains LIMIT 1', {
    type: require('sequelize').QueryTypes.SELECT,
  })
  const [from] = await sequelize.query('SELECT id FROM stations ORDER BY id LIMIT 1', {
    type: require('sequelize').QueryTypes.SELECT,
  })
  const [to] = await sequelize.query('SELECT id FROM stations ORDER BY id DESC LIMIT 1', {
    type: require('sequelize').QueryTypes.SELECT,
  })

  await sequelize.query(
    `INSERT INTO bookings
       (booking_ref, status, train_id, travel_class,
        origin_station_id, destination_station_id,
        from_stop_seq, to_stop_seq, segment_mask, currency)
     VALUES (?, 'CONFIRMED', ?, '3A', ?, ?, 1, 3, 3, 'INR')`,
    { replacements: [ref, train.id, from.id, to.id] },
  )
  const [row] = await sequelize.query('SELECT booking_id FROM bookings WHERE booking_ref = ?', {
    replacements: [ref],
    type: require('sequelize').QueryTypes.SELECT,
  })
  return row.booking_id
}

async function cleanup() {
  await sequelize.query('DELETE FROM refunds WHERE gateway_refund_id LIKE ?', {
    replacements: ['rfnd_dbtest%'],
  })
  await sequelize.query('DELETE FROM payments WHERE booking_ref = ?', { replacements: [BOOKING] })
  await sequelize.query('DELETE FROM payments WHERE booking_ref = ?', {
    replacements: ['YTR-TEST-DB0002'],
  })

  // `payments.booking_id` is NOT NULL and RESTRICT-referenced from migration 011,
  // so every CALL below needs a real booking. `cleanup()` is where each case
  // starts, so this is the one place the session variable gets set.
  await sequelize.query('SET @booking_id = ?', { replacements: [await ensureBooking()] })

  // Booking-routine refs, and the far-future inventory the cases above claimed.
  // By prefix, because each case mints its own reference.
  await sequelize.query("DELETE FROM seat_holds WHERE booking_ref LIKE 'YTR-TEST-PROC%'")
  await sequelize.query("DELETE FROM bookings WHERE booking_ref LIKE 'YTR-TEST-PROC%'")
  await sequelize.query(
    `DELETE i FROM seat_inventory i
       JOIN coach_seats s ON s.seat_id  = i.seat_id
       JOIN coaches      c ON c.coach_id = s.coach_id
       JOIN trains       t ON t.id       = c.train_id
      WHERE t.train_number = '12002' AND i.departure_date >= '2027-01-01'`,
  )
}

/* ------------------------------------------------------------------ cases */

async function run() {
  console.log('\nTeam 5 — database\n')

  /* -- schema ------------------------------------------------------------- */

  await test('schema: the four Team 5 tables exist', async () => {
    const found = await rows(
      `SELECT TABLE_NAME AS name FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('payments','payment_transactions','refunds','payment_methods')`,
    )
    assert.deepStrictEqual(
      found.map((r) => r.name).sort(),
      ['payment_methods', 'payment_transactions', 'payments', 'refunds'],
    )
  })

  await test('schema: procedures, triggers and the history view exist', async () => {
    const routines = await rows(
      `SELECT ROUTINE_NAME AS name FROM information_schema.ROUTINES
        WHERE ROUTINE_SCHEMA = DATABASE()`,
    )
    const names = routines.map((r) => r.name)
    for (const expected of ['create_payment_record', 'confirm_payment', 'process_refund']) {
      assert.ok(names.includes(expected), `missing procedure ${expected}`)
    }

    // The database is shared by all seven teams, so assert that Team 5's
    // triggers are present — not that these are the only ones in the schema.
    // Teams 1, 2 and 7 have audit triggers of their own.
    const triggers = await rows(
      `SELECT TRIGGER_NAME AS name FROM information_schema.TRIGGERS
        WHERE TRIGGER_SCHEMA = DATABASE()`,
    )
    const triggerNames = triggers.map((t) => t.name)
    for (const expected of ['trg_payments_status_guard', 'trg_refunds_payment_guard']) {
      assert.ok(triggerNames.includes(expected), `missing trigger ${expected}`)
    }

    const views = await rows(
      `SELECT TABLE_NAME AS name FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE()`,
    )
    assert.ok(views.some((v) => v.name === 'v_payment_history'))
  })

  await test('schema: the unique indexes that stop duplicate transaction ids', async () => {
    const indexes = await rows(
      `SELECT INDEX_NAME AS name, NON_UNIQUE AS non_unique, TABLE_NAME AS tbl
         FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND NON_UNIQUE = 0
        GROUP BY INDEX_NAME, NON_UNIQUE, TABLE_NAME`,
    )
    const unique = indexes.map((i) => `${i.tbl}.${i.name}`)

    for (const expected of [
      'payments.uq_payments_gateway_order_id',
      'payments.uq_payments_gateway_payment_id',
      'payments.uq_payments_booking_attempt',
      'payment_transactions.uq_ptx_gateway_order_id',
      'payment_transactions.uq_ptx_gateway_payment_id',
      'payment_transactions.uq_ptx_gateway_refund_id',
      'refunds.uq_refunds_gateway_refund_id',
      'payment_methods.uq_payment_methods_code',
    ]) {
      assert.ok(unique.includes(expected), `missing unique index ${expected}`)
    }
  })

  /* -- create_payment_record ---------------------------------------------- */

  await test('create_payment_record writes the payment and its first transaction', async () => {
    await cleanup()

    await sequelize.query(
      `CALL create_payment_record(
         ?, ?, ?, 'INR', 1, NULL, 30, @booking_id, @payment_id
       )`,
      { replacements: [BOOKING, ORDER, 12345] },
    )

    const payment = await one('SELECT * FROM payments WHERE gateway_order_id = ?', ORDER)
    assert.strictEqual(payment.booking_ref, BOOKING)
    assert.strictEqual(payment.status, 'created')
    assert.strictEqual(Number(payment.amount), 12345)
    assert.strictEqual(payment.currency, 'INR')
    assert.strictEqual(Number(payment.attempt_number), 1)
    // ORDER_TTL_MINUTES applied server-side.
    assert.ok(payment.expires_at, 'expires_at should be set from the TTL')

    const transaction = await one(
      'SELECT * FROM payment_transactions WHERE gateway_order_id = ?',
      ORDER,
    )
    assert.strictEqual(transaction.event, 'ORDER_CREATED')
    assert.strictEqual(Number(transaction.payment_id), Number(payment.payment_id))
  })

  await test('a duplicate gateway order id is refused', async () => {
    await expectRefusal(
      () =>
        sequelize.query(
          `CALL create_payment_record(
             ?, ?, ?, 'INR', 2, NULL, 30, @booking_id, @payment_id
           )`,
          { replacements: [BOOKING, ORDER, 12345] },
        ),
      'DUPLICATE_GATEWAY_ORDER_ID',
    )
  })

  await test('a booking cannot hold two attempts with the same number', async () => {
    // A different gateway order, same booking and attempt number: this is a
    // retry loop, and uq_payments_booking_attempt is what stops it.
    await expectRefusal(
      () =>
        sequelize.query(
          `CALL create_payment_record(
             ?, 'order_dbtest0002', 12345, 'INR', 1, NULL, 30, @booking_id, @payment_id
           )`,
          { replacements: [BOOKING] },
        ),
      'DUPLICATE_BOOKING_ATTEMPT',
    )
  })

  await test('a zero amount is refused before anything is written', async () => {
    await expectRefusal(
      () =>
        sequelize.query(
          `CALL create_payment_record(
             ?, 'order_dbtest0003', 0, 'INR', 1, NULL, 30, @booking_id, @payment_id
           )`,
          { replacements: [BOOKING] },
        ),
      'AMOUNT_MUST_BE_POSITIVE',
    )
  })

  /* -- confirm_payment ---------------------------------------------------- */

  await test('confirm_payment captures a verified payment', async () => {
    await sequelize.query(
      `CALL confirm_payment(?, ?, 'captured', 'upi', 1, 'abc123', NULL, NULL, ?)`,
      { replacements: [ORDER, PAYMENT, JSON.stringify({ status: 'captured' })] },
    )

    const payment = await one('SELECT * FROM payments WHERE gateway_order_id = ?', ORDER)
    assert.strictEqual(payment.status, 'captured')
    assert.strictEqual(payment.gateway_payment_id, PAYMENT)
    assert.strictEqual(payment.method_code, 'upi')
    assert.ok(payment.captured_at, 'captured_at should be stamped')

    const transaction = await one(
      'SELECT * FROM payment_transactions WHERE gateway_order_id = ?',
      ORDER,
    )
    assert.strictEqual(transaction.event, 'PAYMENT_VERIFIED')
    assert.strictEqual(Number(transaction.signature_valid), 1)
    assert.ok(transaction.verified_at, 'verified_at should be stamped')
  })

  await test('replaying the same confirmation changes nothing', async () => {
    const before = await one('SELECT * FROM payment_transactions WHERE gateway_order_id = ?', ORDER)
    const capturedAt = (await one('SELECT captured_at FROM payments WHERE gateway_order_id = ?', ORDER)).captured_at

    await sequelize.query(
      `CALL confirm_payment(?, ?, 'captured', 'upi', 1, 'abc123', NULL, NULL, ?)`,
      { replacements: [ORDER, PAYMENT, JSON.stringify({ status: 'captured' })] },
    )

    const after = await one('SELECT * FROM payment_transactions WHERE gateway_order_id = ?', ORDER)
    const payments = await one('SELECT * FROM payments WHERE gateway_order_id = ?', ORDER)

    assert.strictEqual(after.transaction_id, before.transaction_id, 'a replay must not add a row')
    assert.strictEqual(payments.status, 'captured')
    assert.strictEqual(String(payments.captured_at), String(capturedAt), 'captured_at must not move')

    const [{ n }] = await rows(
      'SELECT COUNT(*) AS n FROM payment_transactions WHERE gateway_order_id = ?',
      ORDER,
    )
    assert.strictEqual(Number(n), 1, 'exactly one transaction row per attempt')
  })

  await test('a failed signature never captures', async () => {
    await cleanup()

    await sequelize.query(
      `CALL create_payment_record(
         ?, ?, ?, 'INR', 1, NULL, 30, @booking_id, @payment_id
       )`,
      { replacements: [BOOKING, ORDER, 12345] },
    )

    // The gateway claims captured; the HMAC did not verify. Signature wins.
    await sequelize.query(
      `CALL confirm_payment(?, 'pay_dbtest0009', 'captured', 'upi', 0, NULL, NULL, NULL, NULL)`,
      { replacements: [ORDER] },
    )

    const payment = await one('SELECT * FROM payments WHERE gateway_order_id = ?', ORDER)
    assert.strictEqual(payment.status, 'failed')
    assert.strictEqual(payment.failure_code, 'SIGNATURE_MISMATCH')
    assert.ok(!payment.captured_at, 'a rejected payment must not be stamped captured')
  })

  await test('a payment id belonging to another order is refused', async () => {
    await cleanup()

    await sequelize.query(
      `CALL create_payment_record(
         ?, ?, ?, 'INR', 1, NULL, 30, @booking_id, @payment_id
       )`,
      { replacements: [BOOKING, ORDER, 12345] },
    )
    // Its own booking: create_payment_record checks that booking_id and
    // booking_ref agree (BOOKING_REF_MISMATCH), so pointing a second booking_ref
    // at the first booking's id would be refused before reaching the mismatch
    // this case is about.
    await sequelize.query('SET @booking_id2 = ?', {
      replacements: [await ensureBooking('YTR-TEST-DB0002')],
    })
    await sequelize.query(
      `CALL create_payment_record(
         ?, ?, ?, 'INR', 1, NULL, 30, @booking_id2, @payment_id
       )`,
      { replacements: ['YTR-TEST-DB0002', 'order_dbtest0005', 999] },
    )
    // Bind the payment id to the *other* order...
    await sequelize.query(
      `CALL confirm_payment('order_dbtest0005', 'pay_dbtest0005', 'captured', 'upi', 1, 'fp', NULL, NULL, NULL)`,
    )

    // ...then present it against this one.
    await expectRefusal(
      () =>
        sequelize.query(
          `CALL confirm_payment(?, 'pay_dbtest0005', 'captured', 'upi', 1, 'fp', NULL, NULL, NULL)`,
          { replacements: [ORDER] },
        ),
      'ORDER_MISMATCH',
    )
  })

  await test('a failed payment cannot be captured afterwards', async () => {
    // ORDER's payment was left 'created' above; fail it, then try to capture.
    await sequelize.query(
      `CALL confirm_payment(?, 'pay_dbtest0007', 'failed', 'upi', 1, 'fp', 'BAD_REQUEST_ERROR', 'declined', NULL)`,
      { replacements: [ORDER] },
    )

    const payment = await one('SELECT status FROM payments WHERE gateway_order_id = ?', ORDER)
    assert.strictEqual(payment.status, 'failed')

    await expectRefusal(
      () =>
        sequelize.query(
          `CALL confirm_payment(?, 'pay_dbtest0008', 'captured', 'upi', 1, 'fp', NULL, NULL, NULL)`,
          { replacements: [ORDER] },
        ),
      'FAILED_PAYMENT_NOT_CAPTURABLE',
    )
  })

  /* -- process_refund ----------------------------------------------------- */

  await test('process_refund reverses a captured payment and links the attempt', async () => {
    await cleanup()

    await sequelize.query(
      `CALL create_payment_record(
         ?, ?, ?, 'INR', 1, NULL, 30, @booking_id, @payment_id
       )`,
      { replacements: [BOOKING, ORDER, 20000] },
    )
    await sequelize.query(
      `CALL confirm_payment(?, ?, 'captured', 'card', 1, 'fp', NULL, NULL, NULL)`,
      { replacements: [ORDER, PAYMENT] },
    )
    await sequelize.query(
      `CALL process_refund(
         (SELECT payment_id FROM payments WHERE gateway_order_id = ?),
         ?, ?, 'Cancelled by traveller', 'system', NULL, @refund_id
       )`,
      { replacements: [ORDER, REFUND, 20000] },
    )

    const payment = await one('SELECT * FROM payments WHERE gateway_order_id = ?', ORDER)
    assert.strictEqual(payment.status, 'refunded')
    assert.ok(payment.refunded_at, 'refunded_at should be stamped')

    const refund = await one('SELECT * FROM refunds WHERE gateway_refund_id = ?', REFUND)
    assert.strictEqual(refund.status, 'processed')
    assert.strictEqual(refund.reason, 'Cancelled by traveller')

    // The refunded total is asserted where it now lives.
    //
    // It used to be read off `payments.refunded_amount`, a column that
    // duplicated SUM(refunds.amount) with no trigger keeping the two in step —
    // so it was a second place for the same fact to drift. Migration 011 dropped
    // it, and `v_payment_history` derives it. Asserting through the view proves
    // both that the refund was recorded and that the derivation is right.
    const settled = await one(
      'SELECT refunded_amount FROM v_payment_history WHERE gateway_order_id = ?',
      ORDER,
    )
    assert.strictEqual(Number(settled.refunded_amount), 20000)

    const transaction = await one(
      'SELECT * FROM payment_transactions WHERE gateway_order_id = ?',
      ORDER,
    )
    assert.strictEqual(transaction.gateway_refund_id, REFUND)
    assert.strictEqual(transaction.event, 'PAYMENT_REFUNDED')
  })

  await test('a second refund of the same payment is refused', async () => {
    await expectRefusal(
      () =>
        sequelize.query(
          `CALL process_refund(
             (SELECT payment_id FROM payments WHERE gateway_order_id = ?),
             'rfnd_dbtest0002', 100, NULL, 'system', NULL, @refund_id
           )`,
          { replacements: [ORDER] },
        ),
      'ALREADY_REFUNDED',
    )
  })

  await test('the trigger refuses a refund inserted behind the procedure', async () => {
    // The guard must hold for any writer, not only the ones that use the API.
    await expectRefusal(
      () =>
        sequelize.query(
          `INSERT INTO refunds (payment_id, gateway_refund_id, amount, currency, status)
           SELECT payment_id, 'rfnd_dbtest0003', 100, 'INR', 'processed'
             FROM payments WHERE gateway_order_id = ?`,
          { replacements: [ORDER] },
        ),
      'NOT_CAPTURED',
    )
  })

  await test('a refund larger than the capture is refused', async () => {
    await cleanup()

    await sequelize.query(
      `CALL create_payment_record(
         ?, ?, ?, 'INR', 1, NULL, 30, @booking_id, @payment_id
       )`,
      { replacements: [BOOKING, ORDER, 5000] },
    )
    await sequelize.query(
      `CALL confirm_payment(?, ?, 'captured', 'upi', 1, 'fp', NULL, NULL, NULL)`,
      { replacements: [ORDER, PAYMENT] },
    )

    await expectRefusal(
      () =>
        sequelize.query(
          `CALL process_refund(
             (SELECT payment_id FROM payments WHERE gateway_order_id = ?),
             'rfnd_dbtest0004', 5001, NULL, 'system', NULL, @refund_id
           )`,
          { replacements: [ORDER] },
        ),
      'REFUND_EXCEEDS_CAPTURE',
    )
  })

  /* -- guards ------------------------------------------------------------- */

  await test('a captured payment cannot be walked back to failed', async () => {
    await expectRefusal(
      () =>
        sequelize.query('UPDATE payments SET status = ? WHERE gateway_order_id = ?', {
          replacements: ['failed', ORDER],
        }),
      'CAPTURED_PAYMENT_ONLY_REFUNDS',
    )
  })

  await test('a refunded payment is final', async () => {
    await cleanup()

    await sequelize.query(
      `CALL create_payment_record(
         ?, ?, ?, 'INR', 1, NULL, 30, @booking_id, @payment_id
       )`,
      { replacements: [BOOKING, ORDER, 3000] },
    )
    await sequelize.query(
      `CALL confirm_payment(?, ?, 'captured', 'upi', 1, 'fp', NULL, NULL, NULL)`,
      { replacements: [ORDER, PAYMENT] },
    )
    await sequelize.query(
      `CALL process_refund(
         (SELECT payment_id FROM payments WHERE gateway_order_id = ?),
         ?, 3000, NULL, 'system', NULL, @refund_id
       )`,
      { replacements: [ORDER, REFUND] },
    )

    await expectRefusal(
      () =>
        sequelize.query('UPDATE payments SET status = ? WHERE gateway_order_id = ?', {
          replacements: ['created', ORDER],
        }),
      'TERMINAL_STATUS_IS_FINAL',
    )
  })

  await test('confirming an unknown order is refused', async () => {
    await expectRefusal(
      () =>
        sequelize.query(
          `CALL confirm_payment('order_does_not_exist', 'pay_x', 'captured', 'upi', 1, 'fp', NULL, NULL, NULL)`,
        ),
      'ORDER_NOT_FOUND',
    )
  })

  /* -- reads -------------------------------------------------------------- */

  await test('v_payment_history returns the seeded demo payments', async () => {
    const history = await rows(
      `SELECT booking_ref, status, amount, method_display_name, last_event, settled_amount
         FROM v_payment_history
        WHERE booking_ref IN ('YTR-12951-7QX2','YTR-12951-7QX3')`,
    )
    assert.ok(history.length >= 4, `expected the seeded rows, found ${history.length}`)

    const statuses = history.map((r) => r.status).sort()
    assert.deepStrictEqual(statuses, ['authorized', 'captured', 'failed', 'refunded'])

    const settled = history.find((r) => r.status === 'captured')
    assert.strictEqual(Number(settled.settled_amount), 61860)
    assert.strictEqual(settled.method_display_name, 'UPI')
  })

  await test('the models read the seeded rows back through Sequelize', async () => {
    const { Payment, PaymentTransaction, Refund, PaymentMethod } = require('../src/models')

    const methods = await PaymentMethod.findAll({ order: [['sortOrder', 'ASC']] })
    assert.strictEqual(methods.length, 4)
    assert.strictEqual(methods[0].code, 'upi', 'UPI is requested first (PAYMENTS.md 3)')
    assert.strictEqual(methods[0].displayName, 'UPI')

    const payment = await Payment.findOne({
      where: { gatewayOrderId: 'order_T5demo0002QX2a2' },
      include: [
        { model: PaymentTransaction, as: 'transactions' },
        { model: Refund, as: 'refunds' },
        { model: PaymentMethod, as: 'method' },
      ],
    })

    assert.strictEqual(payment.bookingRef, 'YTR-12951-7QX2')
    assert.strictEqual(payment.status, 'captured')
    assert.strictEqual(Number(payment.amount), 61860, 'amount comes back in paise')
    assert.strictEqual(payment.method.displayName, 'UPI')
    assert.strictEqual(payment.transactions.length, 1)
    assert.strictEqual(payment.refunds.length, 0)

    // The IST round trip: 14:30:12 IST is 09:00:12 UTC.
    assert.strictEqual(payment.createdAt.toISOString(), '2026-10-03T09:00:12.000Z')
  })

  /* ------------------------------------------- booking routines and triggers */
  //
  // Everything above exercises the payment side of the database. What follows is
  // the booking side, and it is where the interesting failures were: the first
  // two are regressions for bugs that this suite's own first run produced.

  const SEG_FROM = 1
  const SEG_TO = 5
  const SEG_MASK = 15 // segments 1..5
  const JOURNEY_DATE = '2027-06-15'
  const OTHER_DATE = '2027-06-16'

  /**
   * A CALL's scalar, read the only way that works.
   *
   * Deliberately untyped. `QueryTypes.SELECT` flattens a CALL's result sets into
   * a shape where the scalar is unreachable -- a wrapper row plus a metadata
   * object -- so `rows[0].claimed` comes back undefined and every claim looks
   * like a refusal.
   */
  const call = async (sql, ...params) => {
    const [result] = await sequelize.query(sql, { replacements: params })
    return Array.isArray(result) ? result[0] : result
  }

  /**
   * A booking reference nothing else has used.
   *
   * Per case, not per suite. `booking_status` accumulates for the life of the
   * booking, so a shared reference makes each case assert against the previous
   * cases' history -- the first run of this block counted six cancellations
   * across three cases and called it a duplicate-writer bug.
   */
  let refSeq = 0
  const freshRef = async () => {
    refSeq += 1
    const ref = `YTR-TEST-PROC${String(refSeq).padStart(3, '0')}`
    await rows('DELETE FROM seat_holds WHERE booking_ref = ?', ref)
    await rows('DELETE FROM bookings WHERE booking_ref = ?', ref)
    return ref
  }

  /** A held booking, created the way the application creates one. */
  const heldBooking = async (ref) => {
    const [train] = await sequelize.query("SELECT id FROM trains WHERE train_number = '12002'", {
      type: require('sequelize').QueryTypes.SELECT,
    })
    const [from] = await sequelize.query("SELECT id FROM stations WHERE station_code = 'NDLS'", {
      type: require('sequelize').QueryTypes.SELECT,
    })
    const [to] = await sequelize.query("SELECT id FROM stations WHERE station_code = 'BPL'", {
      type: require('sequelize').QueryTypes.SELECT,
    })
    await sequelize.query(
      `INSERT INTO bookings
         (booking_ref, status, train_id, travel_class,
          origin_station_id, destination_station_id,
          from_stop_seq, to_stop_seq, segment_mask, currency)
       VALUES (?, 'HELD', ?, 'EC', ?, ?, ?, ?, ?, 'INR')`,
      { replacements: [ref, train.id, from.id, to.id, SEG_FROM, SEG_TO, SEG_MASK] },
    )
  }

  /** One real berth of that train, found through the normalised schema. */
  const freeSeat = async () =>
    one(
      `SELECT s.seat_id
         FROM coach_seats s
         JOIN coaches c ON c.coach_id = s.coach_id
         JOIN trains  t ON t.id        = c.train_id
        WHERE t.train_number = '12002' AND s.seat_code = '9'
        LIMIT 1`,
    )

  /**
   * Inventory first, then holds.
   *
   * The same order every production path takes. Deleting holds first inverts it
   * and deadlocks against `confirm_booking_segments`, which locks the inventory
   * rows and then the holds -- which is exactly how this suite wedged the
   * connection pool once.
   */
  const resetSeat = async (seatId) => {
    await rows('DELETE FROM seat_inventory WHERE seat_id = ?', seatId)
    await rows('DELETE FROM seat_holds WHERE seat_id = ?', seatId)
  }

  const maskOf = async (seatId, date = null) => {
    const row = date
      ? await one('SELECT segment_mask FROM seat_inventory WHERE seat_id = ? AND departure_date = ?', seatId, date)
      : await one('SELECT segment_mask FROM seat_inventory WHERE seat_id = ? LIMIT 1', seatId)
    return row ? Number(row.segment_mask) : null
  }

  const claim = (ref, seatId, date = JOURNEY_DATE) =>
    call(
      'CALL confirm_booking_segments(?, ?, ?, ?, ?, ?, ?, NULL)',
      ref, seatId, date, SEG_FROM, SEG_TO, SEG_MASK, 5,
    )

  const historyFor = (ref, status = null) =>
    rows(
      `SELECT status, reason, note, changed_by FROM booking_status
        WHERE booking_id = (SELECT booking_id FROM bookings WHERE booking_ref = ?)
        ${status ? `AND status = '${status}'` : ''}
        ORDER BY changed_at`,
      ref,
    )

  await test('exactly one of two concurrent claims on a berth wins', async () => {
    const seat = await freeSeat()
    const a = await freshRef()
    const b = await freshRef()
    await heldBooking(a)
    await heldBooking(b)
    await resetSeat(seat.seat_id)

    // Issued together against one berth. The winner is decided by the row lock on
    // seat_inventory, not by which request happens to arrive first.
    const settled = await Promise.all([claim(a, seat.seat_id), claim(b, seat.seat_id)])
    const winners = settled
      .map((r, i) => (Number(r.claimed) === 1 ? [a, b][i] : null))
      .filter(Boolean)

    assert.strictEqual(winners.length, 1, 'exactly one caller may hold the berth')
    assert.strictEqual(await maskOf(seat.seat_id), SEG_MASK, 'claimed once, not twice')

    await call('CALL cancel_booking(?, ?, ?)', winners[0], 'test', 'test')
    assert.strictEqual(await maskOf(seat.seat_id), 0, 'cancelling hands the berth back')
  })

  await test('confirm_booking_segments answers from the result set, not an OUT parameter', async () => {
    const seat = await freeSeat()
    const a = await freshRef()
    const b = await freshRef()
    await heldBooking(a)
    await heldBooking(b)
    await resetSeat(seat.seat_id)

    assert.strictEqual(Number((await claim(a, seat.seat_id)).claimed), 1)

    const again = await claim(b, seat.seat_id)
    assert.strictEqual(
      Number(again.claimed), 0,
      'a routine that COMMITs before returning an OUT parameter reports 0 while the berth is sold',
    )

    await call('CALL cancel_booking(?, ?, ?)', a, 'test', 'test')
  })

  await test('a mask that disagrees with the stop range is refused', async () => {
    const seat = await freeSeat()
    const ref = await freshRef()
    await heldBooking(ref)
    await resetSeat(seat.seat_id)

    await expectRefusal(
      () =>
        call(
          'CALL confirm_booking_segments(?, ?, ?, ?, ?, ?, ?, NULL)',
          ref, seat.seat_id, JOURNEY_DATE, SEG_FROM, SEG_TO, 7, 5,
        ),
      'SEGMENT_MASK_MISMATCH',
    )
    assert.strictEqual(await maskOf(seat.seat_id), null, 'a refused claim leaves no inventory row')
  })

  await test('cancelling twice is reported, not rewritten', async () => {
    const seat = await freeSeat()
    const ref = await freshRef()
    await heldBooking(ref)
    await resetSeat(seat.seat_id)
    await claim(ref, seat.seat_id)

    const once = await call('CALL cancel_booking(?, ?, ?)', ref, 'test', 'test')
    const twice = await call('CALL cancel_booking(?, ?, ?)', ref, 'test', 'test')
    assert.strictEqual(Number(once.cancelled), 1)
    assert.strictEqual(
      Number(twice.cancelled), 0,
      'a double-clicked Cancel is a no-op, not a second event',
    )
    assert.strictEqual(
      (await historyFor(ref, 'CANCELLED')).length, 1,
      'the history records the cancellation exactly once',
    )
  })

  await test('the sweeper releases holds past their deadline', async () => {
    const seat = await freeSeat()
    const ref = await freshRef()
    await heldBooking(ref)
    await resetSeat(seat.seat_id)
    await claim(ref, seat.seat_id)
    await rows(
      'UPDATE seat_holds SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 MINUTE) WHERE booking_ref = ?',
      ref,
    )

    const { released } = await call('CALL sweep_expired_holds()')
    assert.ok(Number(released) >= 1, 'an expired hold is released')

    const mask = await maskOf(seat.seat_id)
    assert.ok(mask === 0 || mask === null, 'and the berth goes back on sale')
  })

  await test('the sweeper ages out unpaid bookings and logs its own reason', async () => {
    const ref = await freshRef()
    await heldBooking(ref)
    await rows(
      "UPDATE bookings SET hold_expires_at = DATE_SUB(NOW(3), INTERVAL 1 MINUTE) WHERE booking_ref = ?",
      ref,
    )

    // Leave a reason on the connection, the way an ordinary request would. If the
    // routine does not publish its own context it inherits this one, and the
    // expiry is attributed to whoever used the connection last.
    await rows("SET @booking_reason = 'left_by_a_previous_request', @booking_changed_by = 'someone-else'")

    const { expired } = await call('CALL sweep_expired_bookings()')
    assert.ok(Number(expired) >= 1)

    const row = await one('SELECT status FROM bookings WHERE booking_ref = ?', ref)
    assert.strictEqual(row.status, 'EXPIRED')

    const [logged] = await historyFor(ref, 'EXPIRED')
    assert.ok(logged, 'an expiry swept by the timer must appear in the history')
    assert.strictEqual(logged.reason, 'hold_expired', 'the sweeper, not the caller, wrote the reason')
    assert.strictEqual(logged.changed_by, 'system')
  })

  await test('a journey that does not start at stop 1 is masked correctly', async () => {
    // Regression: `confirm_booking_segments` computed
    // `(1 << (to - from)) - 1` without shifting by `from - 1`, so it only agreed
    // with `journeyService.maskFor` for journeys starting at the first stop --
    // which is every other case in this suite. It refused the real mask; a caller
    // that had "fixed" it by sending the routine's own number would have claimed
    // the wrong berths.
    const seat = await freeSeat()
    const ref = await freshRef()
    await heldBooking(ref)
    await resetSeat(seat.seat_id)

    // Stops 3..5 of a five-stop train. span = 2, so ((1 << 2) - 1) = 3, shifted
    // left by (3 - 1) = 2 gives 12 = 0b01100 -- legs 3 and 4. The unshifted
    // value, which is what the routine used to compute, is 3 = 0b00011.
    const mask = ((1n << 2n) - 1n) << 2n
    assert.strictEqual(mask.toString(), '12', 'the encoding the routine has to accept')

    // `call` rather than a raw query: a CALL returns its scalar through a result
    // set, and the raw form does not reach it (see the note on `call`).
    const ok = await call(
      'CALL confirm_booking_segments(?, ?, ?, 3, 5, ?, 5, NULL)',
      ref, seat.seat_id, JOURNEY_DATE, mask.toString(),
    )
    assert.strictEqual(Number(ok.claimed), 1, 'the real mask must be accepted')

    await expectRefusal(
      () => call(
        'CALL confirm_booking_segments(?, ?, ?, 3, 5, ?, 5, NULL)',
        ref, seat.seat_id, JOURNEY_DATE, '3',
      ),
      'SEGMENT_MASK_MISMATCH',
    )

    await call('CALL cancel_booking(?, ?, ?)', ref, 'test', 'test')
  })

  await test('superseding a booking gives its berths back', async () => {
    // Regression: the supersede block set `status = 'confirmed'` on expired
    // holds. A retry that replaced its own earlier attempt therefore took the
    // berths off sale permanently -- sold to a booking nobody had paid for -- and
    // left the bits set with nothing able to release them.
    const seat = await freeSeat()
    const oldRef = await freshRef()
    const newRef = await freshRef()
    await heldBooking(oldRef)
    await heldBooking(newRef)
    await resetSeat(seat.seat_id)

    await claim(oldRef, seat.seat_id)
    assert.strictEqual(await maskOf(seat.seat_id), SEG_MASK, 'the first attempt holds the berth')

    await rows('UPDATE seat_holds SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 MINUTE) WHERE booking_ref = ?', oldRef)

    const granted = await call(
      'CALL confirm_booking_segments(?, ?, ?, ?, ?, ?, 5, ?)',
      newRef, seat.seat_id, JOURNEY_DATE, SEG_FROM, SEG_TO, SEG_MASK, oldRef,
    )
    assert.strictEqual(Number(granted.claimed), 1, 'the replacement is granted')

    const stillHeld = await rows(
      'SELECT booking_ref FROM seat_holds WHERE booking_ref IN (?, ?)',
      oldRef, newRef,
    )
    assert.strictEqual(stillHeld.length, 1, 'the superseded hold is gone, not promoted to confirmed')
    assert.strictEqual(
      stillHeld[0].booking_ref, newRef,
      'what survives must be the replacement, not the one it replaced',
    )

    await call('CALL cancel_booking(?, ?, ?)', newRef, 'test', 'test')
    await resetSeat(seat.seat_id)
  })

  await test('the status trigger is the only writer of the history', async () => {
    // Regression: `trg_bookings_status_log` (AFTER UPDATE) was superseded by
    // `_ins` + `_upd`, but the old trigger was never dropped, so every
    // transition was appended twice -- two identical rows, same status, same
    // reason, same timestamp. Nothing in the resulting data looked wrong.
    const triggers = await rows(
      `SELECT trigger_name AS name
         FROM information_schema.triggers
        WHERE trigger_schema = DATABASE() AND event_object_table = 'bookings'`,
    )
    assert.deepStrictEqual(
      triggers.map((t) => t.name).sort(),
      ['trg_bookings_status_log_ins', 'trg_bookings_status_log_upd'],
      'a superseded trigger left installed writes every transition twice',
    )
  })

  await test("a status change is logged exactly once, with the caller's context", async () => {
    const ref = await freshRef()
    await heldBooking(ref)
    const before = (await historyFor(ref)).length

    await rows("SET @booking_reason = 'db_suite', @booking_note = 'note text', @booking_changed_by = 'tester'")
    await rows(
      `UPDATE bookings SET status = 'CONFIRMED', confirmed_at = NOW(3), updated_at = NOW(3)
        WHERE booking_ref = ?`,
      ref,
    )

    const [entry] = (await historyFor(ref)).slice(-1)
    assert.strictEqual(entry.status, 'CONFIRMED')
    assert.strictEqual(entry.reason, 'db_suite')
    assert.strictEqual(entry.note, 'note text')
    assert.strictEqual(entry.changed_by, 'tester')

    // An UPDATE that does not move the status must not invent history.
    await rows('UPDATE bookings SET updated_at = NOW(3) WHERE booking_ref = ?', ref)
    assert.strictEqual((await historyFor(ref)).length, before + 1, 'only the real transition is logged')
  })

  await test('a caller that supplies no context falls back to the booking row', async () => {
    const ref = await freshRef()
    await heldBooking(ref)

    // Explicitly NULL, which is how bookingService.withStatusContext clears the
    // variables it owns. What matters is that the fallback fires and the column
    // on the booking itself is trusted over the status string.
    await rows('SET @booking_reason = NULL, @booking_note = NULL, @booking_changed_by = NULL')
    await rows(
      `UPDATE bookings SET status = 'CANCELLED', cancellation_reason = 'cancelled_by_user',
              cancelled_at = NOW(3), updated_at = NOW(3)
        WHERE booking_ref = ?`,
      ref,
    )

    const [entry] = (await historyFor(ref, 'CANCELLED')).slice(-1)
    assert.strictEqual(entry.reason, 'cancelled_by_user', 'cancellation_reason is the fallback')
    assert.strictEqual(entry.changed_by, 'system', 'and the actor falls back to system')
  })

  await test('availability is derived per journey, not stored', async () => {
    // There is deliberately no trigger maintaining `train_classes.available_seats`
    // (database/sql/triggers.sql explains why). This asserts what replaces it:
    // the same berth is free on one date and sold on another, which no single
    // stored number could represent.
    const seat = await freeSeat()
    const ref = await freshRef()
    await heldBooking(ref)
    await resetSeat(seat.seat_id)
    await claim(ref, seat.seat_id, OTHER_DATE)

    assert.strictEqual(await maskOf(seat.seat_id, OTHER_DATE), SEG_MASK, 'sold on the second date')
    assert.strictEqual(
      await maskOf(seat.seat_id, JOURNEY_DATE), null,
      'a booking on one date must not occupy the same berth on another',
    )

    await call('CALL cancel_booking(?, ?, ?)', ref, 'test', 'test')
    await resetSeat(seat.seat_id)
  })

  /* --------------------------------------------------------------- output */
  for (const [status, name] of results) console.log(`  ${status} ${name}`)
  console.log(`\n  ${passed}/${results.length} passed${process.exitCode ? ' — with failures' : ''}\n`)
}

run()
  .catch((err) => {
    console.error('\nharness error:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await cleanup()
    await sequelize.close()
  })