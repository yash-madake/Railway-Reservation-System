'use strict'

/**
 * Team 5 payment tests — the seven cases the assignment requires:
 * success, failure, duplicate verification, tampered amount, expired order,
 * retry, and refund.
 *
 * The Razorpay gateway is stubbed, so no network or keys needed. A database is
 * still required: fares are read from `train_classes.base_fare` (see
 * fareLookup.js), because that is the single price list the search screens quote
 * from. The expected amounts below are computed from that same lookup rather
 * than written as literals — a literal here is how the old hardcoded rate table
 * stayed wrong for so long without a test noticing.
 *
 *   node backend/tests/payment.test.js
 */

const assert = require('assert')

// Stub the gateway before anything loads it.
const razorpay = require('../src/services/payment/razorpayService')
const { lookupRate, TAX_RATE } = require('../src/services/payment/fareLookup')
const { CONVENIENCE_FEE } = require('../src/services/payment/bookingService')
const bs = require('../src/services/payment/bookingService')
const fareService = require('../src/services/payment/fareService')
const { seedBookings } = require('../src/scripts/seedBookings')

const BOOKING = 'YTR-12951-7QX2' // 12951 in 3A, 1 passenger

/**
 * What this booking must cost, derived the same way the server derives it.
 * 9% tax and the ₹30 convenience fee are the only rules layered on the base.
 */
const expected = {
  get base() {
    return rate.baseFarePaise
  },
  get total() {
    return rate.baseFarePaise + rate.taxesPaise + CONVENIENCE_FEE
  },
  get withCoupon() {
    // 10% off the base fare.
    return rate.baseFarePaise + rate.taxesPaise + CONVENIENCE_FEE - Math.round((rate.baseFarePaise * 10) / 100)
  },
}
let rate = null

const SECRET = process.env.RAZORPAY_KEY_SECRET

let seq = 0
let gateway = null
/** Overridable gateway behaviour per test. */
function stubGateway(overrides = {}) {
  gateway = {
    createOrder: async ({ amount }) => ({
      orderId: `order_stub_${String(++seq).padStart(4, '0')}`,
      amount,
      currency: 'INR',
      status: 'created',
      receipt: 'stub',
      ...overrides.createOrder,
    }),
    fetchPayment: async (paymentId) => ({
      paymentId,
      orderId: gateway.createdFor ?? null,
      status: 'captured',
      method: 'upi',
      amount: 61900,
      currency: 'INR',
      errorCode: null,
      errorDescription: null,
      errorReason: null,
      ...overrides.fetchPayment,
    }),
    refundPayment: async (paymentId, amount) => ({
      id: `rfnd_stub_${String(++seq).padStart(4, '0')}`,
      entity: 'refund',
      payment_id: paymentId,
      amount,
      status: 'processed',
      ...overrides.refundPayment,
    }),
    createdFor: null,
    ...overrides.extra,
  }
  razorpay.createOrder = gateway.createOrder
  razorpay.fetchPayment = gateway.fetchPayment
  razorpay.refundPayment = gateway.refundPayment
}

const store = require('../src/services/payment/paymentStore')
const ctrl = require('../src/controllers/paymentController')
const crypto = require('crypto')

/** Mimic express req/res so controller handlers can be called directly. */
function call(handler, { body = {}, params = {}, query = {} } = {}) {
  const res = {
    statusCode: 200,
    status(c) { this.statusCode = c; return this },
    json(payload) { this.payload = payload; return this },
  }
  return handler({ body, params, query }, res).then(() => res)
}

const sign = (orderId, paymentId) =>
  crypto.createHmac('sha256', SECRET).update(`${orderId}|${paymentId}`).digest('hex')

let passed = 0
const results = []

async function test(name, fn) {
  store.reset()
  seq = 0
  stubGateway()
  try {
    await fn()
    passed += 1
    results.push(['ok  ', name])
  } catch (err) {
    results.push(['FAIL', `${name}\n       ${err.message}`])
    process.exitCode = 1
  }
}

async function expectHttpError(fn, code) {
  try {
    await fn()
  } catch (err) {
    assert.strictEqual(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`)
    return err
  }
  throw new Error(`expected the call to fail with ${code}`)
}

/* ------------------------------------------------------------------ cases */

async function run() {
  console.log('\nTeam 5 — payment integration\n')

  /**
   * Put the demo references back in the database before anything else.
   *
   * These used to live in a `Map` inside the payment booking service, so
   * `createOrder` resolved them without a database. That service has since been
   * superseded by the durable one, which resolves against `bookings` — so
   * without this the whole suite fails on "no booking found" for a reference the
   * tests legitimately use. Re-running the seed makes the suite order-independent
   * rather than depending on someone having seeded by hand.
   */
  await seedBookings()
  console.log('  seeded YTR-12951-7QX2, YTR-12951-7QX3\n')

  // Read the live price once. Every amount assertion below is derived from this,
  // so editing a fare in the database cannot leave the tests asserting a figure
  // the server no longer charges.
  rate = await lookupRate({ trainNo: '12951', travelClass: '3A' })
  console.log(
    `  12951 / 3A from train_classes.base_fare: Rs ${rate.baseFare} ` +
      `(+9% tax + Rs ${CONVENIENCE_FEE / 100} fee = Rs ${(expected.total / 100).toFixed(2)})\n`,
  )

  // 1. SUCCESS -------------------------------------------------------------
  await test('success — valid signature captures the payment', async () => {
    stubGateway()
    const created = await call(ctrl.createOrder, { body: { bookingRef: BOOKING } })
    assert.strictEqual(created.statusCode, 201)

    const orderId = created.payload.orderId
    gateway.createdFor = orderId
    const paymentId = 'pay_stub_0001'

    const verified = await call(ctrl.verifyPayment, {
      body: { orderId, razorpayPaymentId: paymentId, razorpayOrderId: orderId, razorpaySignature: sign(orderId, paymentId) },
    })

    assert.strictEqual(verified.payload.status, 'captured')
    assert.strictEqual(verified.payload.paymentId, paymentId)
    assert.strictEqual(store.findByOrderId(orderId).status, 'captured')
  })

  // 2. FAILURE -------------------------------------------------------------
  await test('failure — a bad signature is rejected and never captured', async () => {
    stubGateway()
    const created = await call(ctrl.createOrder, { body: { bookingRef: BOOKING } })
    const orderId = created.payload.orderId

    await expectHttpError(
      () => call(ctrl.verifyPayment, {
        body: { orderId, razorpayPaymentId: 'pay_x', razorpayOrderId: orderId, razorpaySignature: 'deadbeef' },
      }),
      'SIGNATURE_MISMATCH',
    )

    const record = store.findByOrderId(orderId)
    assert.strictEqual(record.status, 'failed')
    assert.strictEqual(record.failureCode, 'SIGNATURE_MISMATCH')
    assert.notStrictEqual(record.status, 'captured')
  })

  // 3. DUPLICATE VERIFICATION ---------------------------------------------
  await test('duplicate verification — replay is idempotent', async () => {
    stubGateway()
    const created = await call(ctrl.createOrder, { body: { bookingRef: BOOKING } })
    const orderId = created.payload.orderId
    gateway.createdFor = orderId

    const paymentId = 'pay_stub_dup'
    const body = { orderId, razorpayPaymentId: paymentId, razorpayOrderId: orderId, razorpaySignature: sign(orderId, paymentId) }

    const first = await call(ctrl.verifyPayment, { body })
    assert.strictEqual(first.payload.status, 'captured')
    const firstUpdatedAt = store.findByOrderId(orderId).updatedAt

    // Duplicate callback arrives.
    const second = await call(ctrl.verifyPayment, { body })
    assert.strictEqual(second.payload.status, 'captured')
    assert.strictEqual(second.payload.duplicate, true)

    const record = store.findByOrderId(orderId)
    assert.strictEqual(record.updatedAt, firstUpdatedAt, 'duplicate must not rewrite the record')
    assert.strictEqual(record.attempts, 1, 'duplicate must not inflate attempts')
  })

  // 4. TAMPERED AMOUNT -----------------------------------------------------
  await test('tampered amount — client-supplied price is refused', async () => {
    stubGateway()

    // Explicit amount in the body is a hard error, not silently ignored.
    await expectHttpError(
      () => call(ctrl.createOrder, { body: { bookingRef: BOOKING, amount: 100 } }),
      'BAD_REQUEST',
    )

    // And with no amount supplied, the server figure is used regardless.
    const created = await call(ctrl.createOrder, { body: { bookingRef: BOOKING } })
    const { fare, amount } = created.payload
    assert.strictEqual(amount, fare.amount)
    // Priced from train_classes.base_fare: base + 9% tax + the ₹30 fee.
    assert.strictEqual(amount, expected.total)
    assert.strictEqual(fare.breakdown[0].perPassenger, expected.base)
    assert.notStrictEqual(amount, 100)
  })

  // 5. EXPIRED ORDER -------------------------------------------------------
  await test('expired order — past the TTL it cannot be verified', async () => {
    stubGateway()
    const created = await call(ctrl.createOrder, { body: { bookingRef: BOOKING } })
    const orderId = created.payload.orderId

    // Age the record past the TTL. create() stamps createdAt itself, so the
    // existing record is patched rather than recreated.
    store.update(orderId, { createdAt: new Date(Date.now() - 60 * 60_000).toISOString() }, { silent: true })
    assert.strictEqual(store.isExpired(store.findByOrderId(orderId)), true, 'record should read as expired')

    const err = await expectHttpError(
      () => call(ctrl.verifyPayment, {
        body: { orderId, razorpayPaymentId: 'pay_x', razorpayOrderId: orderId, razorpaySignature: sign(orderId, 'pay_x') },
      }),
      'ORDER_EXPIRED',
    )
    assert.match(err.message, /expired/i)
    assert.strictEqual(store.findByOrderId(orderId).status, 'failed')
  })

  // 6. RETRY ---------------------------------------------------------------
  await test('retry — a new order is minted and the cap is enforced', async () => {
    stubGateway()

    const first = await call(ctrl.createOrder, { body: { bookingRef: BOOKING } })
    assert.strictEqual(first.payload.attempts, 1)
    assert.strictEqual(first.payload.reused, undefined)

    // A live order is reused rather than duplicated.
    const reuse = await call(ctrl.createOrder, { body: { bookingRef: BOOKING } })
    assert.strictEqual(reuse.payload.reused, true)
    assert.strictEqual(reuse.payload.orderId, first.payload.orderId)

    // Mark it failed so the next attempt mints a fresh order id.
    store.update(first.payload.orderId, { status: 'failed' })

    const second = await call(ctrl.createOrder, { body: { bookingRef: BOOKING } })
    assert.notStrictEqual(second.payload.orderId, first.payload.orderId, 'retry needs a new order id')
    assert.strictEqual(second.payload.attempts, 2)

    // Cap.
    store.update(second.payload.orderId, { status: 'failed' })
    const third = await call(ctrl.createOrder, { body: { bookingRef: BOOKING } })
    assert.strictEqual(third.payload.attempts, 3)
    store.update(third.payload.orderId, { status: 'failed' })
    const fourth = await call(ctrl.createOrder, { body: { bookingRef: BOOKING } })
    assert.strictEqual(fourth.payload.attempts, 4)

    store.update(fourth.payload.orderId, { status: 'failed' })
    await expectHttpError(() => call(ctrl.createOrder, { body: { bookingRef: BOOKING } }), 'MAX_ATTEMPTS')
  })

  // 7. REFUND --------------------------------------------------------------
  await test('refund — captured payments refund once and are then terminal', async () => {
    stubGateway()
    const created = await call(ctrl.createOrder, { body: { bookingRef: BOOKING } })
    const orderId = created.payload.orderId
    gateway.createdFor = orderId

    // Cannot refund something not captured.
    await expectHttpError(() => call(ctrl.refundPayment, { body: { orderId } }), 'NOT_CAPTURED')

    const paymentId = 'pay_stub_refund'
    await call(ctrl.verifyPayment, {
      body: { orderId, razorpayPaymentId: paymentId, razorpayOrderId: orderId, razorpaySignature: sign(orderId, paymentId) },
    })

    const refunded = await call(ctrl.refundPayment, { body: { orderId } })
    assert.strictEqual(refunded.payload.status, 'refunded')
    assert.strictEqual(refunded.payload.refundedAmount, expected.total)
    assert.ok(refunded.payload.refundId)

    // Second refund is refused.
    await expectHttpError(() => call(ctrl.refundPayment, { body: { orderId } }), 'ALREADY_REFUNDED')

    // Verifying a refunded payment is refused too.
    await expectHttpError(
      () => call(ctrl.verifyPayment, {
        body: { orderId, razorpayPaymentId: paymentId, razorpayOrderId: orderId, razorpaySignature: sign(orderId, paymentId) },
      }),
      'REFUNDED',
    )
  })

  // extras ------------------------------------------------------------------
  await test('history — reflects the flow and filters by status', async () => {
    stubGateway()
    const created = await call(ctrl.createOrder, { body: { bookingRef: BOOKING } })
    const orderId = created.payload.orderId
    gateway.createdFor = orderId
    const paymentId = 'pay_stub_hist'
    await call(ctrl.verifyPayment, {
      body: { orderId, razorpayPaymentId: paymentId, razorpayOrderId: orderId, razorpaySignature: sign(orderId, paymentId) },
    })

    const all = await call(ctrl.getHistory, { query: {} })
    assert.strictEqual(all.payload.total, 1)

    const captured = await call(ctrl.getHistory, { query: { status: 'captured' } })
    assert.strictEqual(captured.payload.total, 1)

    const failed = await call(ctrl.getHistory, { query: { status: 'failed' } })
    assert.strictEqual(failed.payload.total, 0)
  })

  await test('tax is levied once, on the total base fare', async () => {
    stubGateway()
    const created = await call(ctrl.createOrder, { body: { bookingRef: BOOKING } })
    const { fare } = created.payload

    const base = fare.breakdown.find((l) => l.key === 'base')
    const tax = fare.breakdown.find((l) => l.key === 'taxes')

    assert.strictEqual(base.amount, base.perPassenger * fare.passengers)
    // Derived independently here: the tax must be one rounding of the whole
    // fare, not a per-passenger rounding multiplied out. Those differ whenever
    // the per-passenger rounding goes the wrong way.
    assert.strictEqual(tax.amount, Math.round(base.amount * TAX_RATE))
    assert.ok(
      !/×/.test(tax.label),
      'the line must not claim to be per-passenger when it is not',
    )
  })

  await test('a fare that rounds badly still pays tax on the total, once', async () => {
    // Rs 12.53 is the smallest case where the two formulas disagree:
    //   round(1253 * 0.18) * 2 = 452   (per-passenger, then multiplied)
    //   round(2506 * 0.18)       = 451   (once, on the total)
    const { sequelize } = require('../src/config/database')
    const ORIGINAL = '2065.00'

    try {
      await sequelize.query(
        `UPDATE train_classes tc JOIN trains t ON t.id = tc.train_id
            SET tc.base_fare = 12.53
          WHERE t.train_number = '12951' AND tc.class_code = '3A'`,
      )

      const booking = bs.buildBooking({
        train: { number: '12951', class: '3A' },
        route: { from: 'NDLS', to: 'BPL' },
        passengers: [{ name: 'A', age: 30 }, { name: 'B', age: 30 }],
      })
      const fare = await fareService.calculateFare(booking, {})

      const base = fare.breakdown.find((l) => l.key === 'base')
      const tax = fare.breakdown.find((l) => l.key === 'taxes')

      assert.strictEqual(base.amount, 2506, 'Rs 12.53 x 2 = 2506 paise')
      assert.strictEqual(tax.amount, 451, 'tax is rounded once, on the total')
      assert.notStrictEqual(tax.amount, 452, 'not the per-passenger figure multiplied out')
      assert.strictEqual(fare.amount, base.amount + tax.amount + CONVENIENCE_FEE)
    } finally {
      await sequelize.query(
        `UPDATE train_classes tc JOIN trains t ON t.id = tc.train_id
            SET tc.base_fare = :fare
          WHERE t.train_number = '12951' AND tc.class_code = '3A'`,
        { replacements: { fare: ORIGINAL } },
      )
    }
  })

  await test('unknown booking reference is refused', async () => {
    await expectHttpError(() => call(ctrl.createOrder, { body: { bookingRef: 'NOPE' } }), 'NOT_FOUND')
  })

  await test('coupon is applied server-side and a bad one is refused', async () => {
    stubGateway()
    const withCoupon = await call(ctrl.createOrder, { body: { bookingRef: BOOKING, extras: { coupon: 'YATRIO10' } } })
    // 10% off the base, from the database fare rather than a literal.
    assert.strictEqual(withCoupon.payload.amount, expected.withCoupon)

    store.reset()
    await expectHttpError(
      () => call(ctrl.createOrder, { body: { bookingRef: BOOKING, extras: { coupon: 'NOTREAL' } } }),
      'BAD_REQUEST',
    )
  })

  /* --------------------------------------------------------------- output */
  for (const [status, name] of results) console.log(`  ${status} ${name}`)
  console.log(`\n  ${passed}/${results.length} passed${process.exitCode ? ' — with failures' : ''}\n`)
}

run().catch((err) => {
  console.error('\nharness error:', err)
  process.exit(1)
})