'use strict'

/**
 * Booking tests — the durable record, and the cancellation rules around it.
 *
 * Needs a real MySQL with the seeded coaches, like the seat hold suite. What is
 * being asserted is mostly lifecycle behaviour that only a database can give:
 * that a reference survives, that ownership is enforced, that a terminal booking
 * cannot be moved, and that cancelling gives the berths back.
 *
 *   npm run db:migrate && npm run db:seed:coaches && node tests/booking.test.js
 *
 * Cleans up after itself. Starts by clearing rows from a previous run, because a
 * crashed suite should not leave state that makes the next one's assertions lie.
 */

const assert = require('assert')

const { sequelize, close } = require('../src/config/database')
const bookings = require('../src/services/booking/bookingService')
const ctrl = require('../src/controllers/bookingController')
const holdService = require('../src/services/seat/holdService')
const { fareForBooking } = require('../src/services/payment/fareService')
const { parseDate, resolveSegment, routeFor } = require('../src/services/seat/journeyService')

const TRAIN = '12002';
const TRAVEL_CLASS = 'EC';
const COACH = 'E1';

const refs = new Set();
let dateCounter = 0;

/**
 * A distinct journey date per test, so nothing from one case can collide with
 * another's. Real date arithmetic rather than `20 + n`, because the suite runs
 * more than ten cases and a naive increment walks off the end of the month.
 */
const nextDate = () => {
  dateCounter += 1;
  const d = new Date(Date.UTC(2026, 10, 1));
  d.setUTCDate(d.getUTCDate() + dateCounter);
  return d.toISOString().slice(0, 10);
};

/**
 * Make a real booking end to end.
 *
 * This is the same five steps `confirmBooking` runs, in the same order —
 * resolve the geometry, price it, write the row, claim the berths, attach them —
 * because the order is forced by the foreign key rather than chosen. Going
 * through the controller instead would mean mocking a response object to test
 * behaviour that has nothing to do with HTTP.
 */
async function makeBooking({
  from = 'NDLS',
  to = 'BPL',
  seats,
  date = nextDate(),
  userId = null,
  passengers,
} = {}) {
  const pax = passengers ?? [{ name: 'Rahul Sharma', age: 32, gender: 'male' }];
  const wanted = seats ?? [{ coach: COACH, number: '9' }];

  const segment = resolveSegment(await routeFor(TRAIN), from, to);
  const departureDate = parseDate(date);

  const priced = {
    train: { number: TRAIN, name: 'Bhopal Shatabdi', class: TRAVEL_CLASS },
    passengers: pax,
    segment,
  };
  const fare = await fareForBooking(priced, {});

  const bookingRef = bookings.mintBookingRef(TRAIN);
  refs.add(bookingRef);

  await bookings.createBooking({
    bookingRef,
    userId,
    train: priced.train,
    route: { from, to },
    segment,
    passengers: pax,
    seats: wanted.map((s, i) => ({
      coach: s.coach,
      seatNumber: s.number ?? s.seatNumber,
      berthType: null,
      _position: i,
    })),
    amount: fare.amount,
    holdExpiresAt: null,
  });

  const hold = await holdService.holdSeats({
    bookingRef,
    trainNo: TRAIN,
    travelClass: TRAVEL_CLASS,
    departureDate,
    fromStation: from,
    toStation: to,
    seats: wanted.map((s) => ({ coach: s.coach, number: s.number ?? s.seatNumber })),
  });

  await bookings.attachSeats(bookingRef, hold.seats, hold.expiresAt);

  return { bookingRef, fare, segment, hold };
}

/**
 * A real user id, created for the suite.
 *
 * Migration 011 added `fk_bookings_user`, and it immediately caught this suite
 * booking against invented ids 42 and 77 — which is the foreign key working
 * exactly as intended. Rather than drop the constraint or invent a fake that
 * happens to exist, the tests create their own travellers.
 */
const testUsers = [];
async function testUser(tag) {
  const email = `yatrio-test-${tag}@example.invalid`;
  const [existing] = await sequelize.query('SELECT id FROM users WHERE email = :e', {
    replacements: { e: email },
    type: require('sequelize').QueryTypes.SELECT,
  });
  if (existing) return existing.id;

  const rows = await sequelize.query(
    `INSERT INTO users (full_name, email, phone, password, role, status)
     VALUES (:name, :email, :phone, 'not-a-real-hash', 'passenger', 'active')`,
    { replacements: { name: `Test ${tag}`, email, phone: `9${Date.now().toString().slice(-9)}` } },
  );
  // Sequelize reports the generated key as `rows[0]` for an INSERT, so it is
  // the id itself rather than an object with an `insertId` field.
  const id = rows[0]?.insertId ?? rows[0];
  testUsers.push(id);
  return id;
}

async function expectRefusal(fn, expected) {
  try {
    await fn();
  } catch (err) {
    if (expected) {
      assert.strictEqual(
        expected === true ? err.status : err.code,
        expected === true ? err.status : expected,
        `expected ${expected}, got ${err.code ?? err.status}: ${err.message}`,
      );
    }
    return err;
  }
  throw new Error(`expected a refusal${expected ? ` with ${expected}` : ''}, but it succeeded`);
}

/**
 * The current mask on one berth, as a string.
 *
 * No `type` is passed, so this gets `[rows, metadata]` and the rows have to come
 * off the front. Dropping the destructure here hands back the wrapper instead —
 * which reads as a mask of `"undefined"` rather than as an error.
 */
const maskOf = async (date, seat) => {
  const [rows] = await sequelize.query(
    `SELECT i.segment_mask AS m
       FROM seat_inventory i
       JOIN coach_seats s ON s.seat_id = i.seat_id
       JOIN coaches c ON c.coach_id = s.coach_id
      WHERE i.departure_date = :date AND c.coach_code = :coach AND s.seat_code = :seat`,
    { replacements: { date, coach: COACH, seat } },
  );
  return rows.length === 0 ? null : String(rows[0].m);
};

/** Age a booking's payment window past its deadline without waiting five minutes. */
const backdate = (bookingRef) =>
  sequelize.query(
    'UPDATE bookings SET hold_expires_at = DATE_SUB(NOW(3), INTERVAL 1 MINUTE) WHERE booking_ref = :ref',
    { replacements: { ref: bookingRef } },
  );

let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok    ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
  }
}

async function run() {
  console.log('\nYatrio booking tests\n');

  /**
   * Clear this suite's own leftovers, not the table.
   *
   * `mintBookingRef` prefixes the reference with the train number, so `YTR-12002-%`
   * is exactly what this suite creates. Deleting every row instead would take the
   * seeded demo bookings with it, and the payment suite — which runs against
   * those — would then fail on references it has no way to recreate.
   */
  await sequelize.query('DELETE FROM bookings WHERE booking_ref LIKE :prefix', {
    replacements: { prefix: 'YTR-12002-%' },
  });
  await sequelize.query('DELETE FROM seat_holds WHERE booking_ref LIKE :prefix', {
    replacements: { prefix: 'YTR-12002-%' },
  });
  await sequelize.query('UPDATE seat_inventory SET segment_mask = 0');

  // ------------------------------------------------------------ persistence
  await test('a booking outlives the process that made it', async () => {
    const made = await makeBooking();

    // The point of the table: read it back with no in-memory state involved,
    // which is exactly what used to fail after a restart.
    const found = await bookings.getBookingByRef(made.bookingRef);
    assert.ok(found, 'the reference still resolves');
    assert.strictEqual(found.status, 'HELD');
    assert.strictEqual(found.bookingRef, made.bookingRef);
  });

  await test('the manifest records the berths actually claimed', async () => {
    const made = await makeBooking({
      seats: [{ coach: COACH, number: '11' }, { coach: COACH, number: '12' }],
      passengers: [{ name: 'Rahul Sharma', age: 32, gender: 'male' }, { name: 'Ram', age: 22, gender: 'male' }],
    });

    const found = await bookings.getBookingByRef(made.bookingRef);
    assert.strictEqual(found.passengers.length, 2);
    assert.deepStrictEqual(
      found.passengers.map((p) => `${p.coach}-${p.seatNumber}`),
      [`${COACH}-11`, `${COACH}-12`],
    );
    assert.strictEqual(found.passengers[0].name, 'Rahul Sharma');
    assert.ok(found.passengers[0].berthType, 'the berth type came from the hold, not the request');
  });

  await test('the fare is snapshotted onto the row', async () => {
    const made = await makeBooking();
    const found = await bookings.getBookingByRef(made.bookingRef);
    assert.strictEqual(found.fare.amount, made.fare.amount);
    // Paise, not rupees — the snapshot has to survive the round trip unrescaled.
    assert.ok(found.fare.amount > 0 && found.fare.amount === Math.round(found.fare.amount));
  });

  await test('the segment is recorded, not just the endpoints', async () => {
    const made = await makeBooking({ from: 'NDLS', to: 'JHS' });
    const found = await bookings.getBookingByRef(made.bookingRef);
    assert.strictEqual(found.segment.fromStopSeq, 1);
    assert.strictEqual(found.segment.toStopSeq, 4);
    assert.strictEqual(found.segment.distanceKm, 410);
    assert.strictEqual(found.segment.mask, '7');
  });

  await test('an unknown reference is refused, not invented', async () => {
    await expectRefusal(() => bookings.resolveBooking('YTR-NOT-REAL'), 'NOT_FOUND');
  });

  // ------------------------------------------------------------- lifecycle
  await test('cancelling releases the berths', async () => {
    const date = nextDate();
    const made = await makeBooking({ date, seats: [{ coach: COACH, number: '20' }] });
    assert.strictEqual(await maskOf(date, '20'), '15');

    await bookings.transition(made.bookingRef, 'CANCELLED', { reason: 'cancelled_by_user' });
    // The controller releases the holds; doing it here mirrors that order.
    await holdService.releaseHolds(made.bookingRef);

    assert.strictEqual(await maskOf(date, '20'), '0', 'the berth is on sale again');
  });

  await test('a cancelled booking cannot be cancelled twice', async () => {
    const made = await makeBooking();
    await bookings.transition(made.bookingRef, 'CANCELLED', { reason: 'first' });
    await expectRefusal(() => bookings.transition(made.bookingRef, 'CANCELLED', { reason: 'again' }), true);
  });

  await test('an expired booking cannot become confirmed', async () => {
    const made = await makeBooking();

    // The window has to actually close first. A freshly held booking is still
    // inside its five minutes, so without this the transition to CONFIRMED
    // legitimately succeeds and the test asserts nothing.
    await backdate(made.bookingRef);
    await bookings.expireUnpaidBookings();

    const expired = await bookings.findBookingRow(made.bookingRef);
    assert.strictEqual(expired.status, 'EXPIRED');

    await expectRefusal(() => bookings.transition(made.bookingRef, 'CONFIRMED', { reason: 'late' }), true);
  });

  await test('a confirmed booking is not editable back to held', async () => {
    const made = await makeBooking();
    await bookings.transition(made.bookingRef, 'CONFIRMED', { reason: 'payment_captured' });

    const err = await expectRefusal(
      () => bookings.transition(made.bookingRef, 'HELD', { reason: 'undo' }),
      'ALREADY_CONFIRMED',
    );
    assert.strictEqual(err.status, 409);
  });

  await test('an unpaid booking expires once its window closes', async () => {
    const made = await makeBooking();
    const row = await bookings.findBookingRow(made.bookingRef);
    assert.strictEqual(row.status, 'HELD');

    await backdate(made.bookingRef);

    const expired = await bookings.expireUnpaidBookings();
    assert.ok(expired >= 1, 'something was aged out');

    const after = await bookings.findBookingRow(made.bookingRef);
    assert.strictEqual(after.status, 'EXPIRED');
  });

  await test('a confirmed booking is never expired', async () => {
    const made = await makeBooking();
    await bookings.transition(made.bookingRef, 'CONFIRMED', { reason: 'payment_captured' });
    await backdate(made.bookingRef);

    await bookings.expireUnpaidBookings();

    const after = await bookings.findBookingRow(made.bookingRef);
    assert.strictEqual(after.status, 'CONFIRMED', 'a paid ticket outlives its payment window');
  });

  // ------------------------------------------------------------- ownership
  await test('one traveller cannot read another\'s booking', async () => {
    const owner = await testUser('owner');
    const other = await testUser('other');
    const made = await makeBooking({ userId: owner });
    await expectRefusal(() => bookings.assertOwnership(made.bookingRef, other), 'NOT_YOUR_BOOKING');
  });

  await test('a traveller can read their own booking', async () => {
    const owner = await testUser('owner');
    const made = await makeBooking({ userId: owner });
    const row = await bookings.assertOwnership(made.bookingRef, owner);
    assert.strictEqual(row.booking_ref, made.bookingRef);
  });

  await test('a guest booking is unowned and stays reachable', async () => {
    // The flow does not insist on an account, so refusing unowned rows would
    // lock out every guest booking in the demo.
    const made = await makeBooking({ userId: null });
    const row = await bookings.assertOwnership(made.bookingRef, null);
    assert.strictEqual(row.user_id, null);
  });

  // ---------------------------------------------------------------- history
  await test('every transition is appended to the history', async () => {
    const made = await makeBooking();
    await bookings.transition(made.bookingRef, 'CONFIRMED', { reason: 'payment_captured', changedBy: 'system' });
    await bookings.transition(made.bookingRef, 'CANCELLED', { reason: 'cancelled_by_user', changedBy: 'user:7' });

    const history = await bookings.getStatusHistory(made.bookingRef);
    assert.deepStrictEqual(
      history.map((h) => `${h.status}:${h.reason}`),
      ['HELD:booking_created', 'CONFIRMED:payment_captured', 'CANCELLED:cancelled_by_user'],
    );
  });

  // ------------------------------------------------------------------ lists
  await test('listings are filtered by status', async () => {
    const held = await makeBooking();
    const confirmed = await makeBooking();
    await bookings.transition(confirmed.bookingRef, 'CONFIRMED', { reason: 'payment_captured' });

    const confirmedOnly = await bookings.listBookings({ status: 'confirmed' });
    assert.ok(
      confirmedOnly.items.every((b) => b.status === 'CONFIRMED'),
      'a status filter must not leak other statuses',
    );
    assert.ok(confirmedOnly.items.some((b) => b.bookingRef === confirmed.bookingRef));
    assert.ok(!confirmedOnly.items.some((b) => b.bookingRef === held.bookingRef));
  });

  await test('listings paginate', async () => {
    const page1 = await bookings.listBookings({ page: 1, pageSize: 2 });
    assert.ok(page1.items.length <= 2);
    assert.ok(page1.total >= page1.items.length);
    assert.ok(page1.totalPages >= 1);
  });

  await test('listings scope to one traveller', async () => {
    const me = await testUser('scope');
    const mine = await makeBooking({ userId: me });
    const result = await bookings.listBookings({ userId: me, pageSize: 100 });
    assert.ok(result.items.every((b) => b.bookingRef === mine.bookingRef), 'no other traveller\'s rows');
  });

  /**
   * The three-way `userId`, which is the one place a mistake discloses other
   * people's tickets. `undefined` means "no filter", `null` means "guest rows
   * only", and a number means "that traveller only" — if `null` silently
   * degraded into `undefined`, every guest would see the whole table.
   */
  await test('a null userId means guest rows, not all rows', async () => {
    const ownedA = await makeBooking({ userId: await testUser('owned-a') });
    const ownedB = await makeBooking({ userId: await testUser('owned-b') });
    const guest = await makeBooking({ userId: null });

    // Asserted by exclusion rather than by equality: guest bookings accumulate
    // across the whole suite, so "the only row is mine" would be false even when
    // the filter is doing its job. What must hold is that the owned rows are
    // absent and the guest row is present.
    const shown = new Set(
      (await bookings.listBookings({ userId: null, pageSize: 200 })).items.map((b) => b.bookingRef),
    );
    assert.ok(shown.has(guest.bookingRef), 'a guest booking is still listed');
    assert.ok(!shown.has(ownedA.bookingRef), 'a signed-out caller must not see another traveller\'s booking');
    assert.ok(!shown.has(ownedB.bookingRef), 'and not the second one either');

    // The contrast that proves the branch is a filter rather than a no-op.
    const unfiltered = await bookings.listBookings({ userId: undefined, pageSize: 200 });
    assert.ok(
      unfiltered.total > shown.size,
      'dropping the filter must widen the result, or the null case is doing nothing',
    );
  });

  await test('a listing shows the berth the same way a lookup does', async () => {
    const made = await makeBooking({ seats: [{ coach: COACH, number: '33' }] });
    const listed = (await bookings.listBookings({ pageSize: 200 })).items.find(
      (b) => b.bookingRef === made.bookingRef,
    );
    const fetched = await bookings.getBookingByRef(made.bookingRef);

    assert.strictEqual(listed.train.coach, COACH);
    assert.strictEqual(listed.train.seat, '33');
    // The same booking answering differently depending on the endpoint is the
    // bug this catches.
    assert.strictEqual(listed.train.coach, fetched.train.coach);
    assert.strictEqual(listed.train.seat, fetched.train.seat);
  });

  // -------------------------------------------------------------- integrity
  await test('a refused hold leaves no booking row behind', async () => {
    const date = nextDate();

    // Take the berth out from under a second traveller.
    await makeBooking({ date, seats: [{ coach: COACH, number: '40' }] });

    const before = (await bookings.listBookings({ pageSize: 200 })).total;

    /**
     * Through the controller, not `makeBooking`.
     *
     * `makeBooking` writes the row and then claims the berths, which is the
     * order the foreign key forces — so on a clash it holds an orphan row by
     * design and relies on its caller to clean up. The controller is the thing
     * under test here precisely because it does that clean-up, so testing the
     * guarantee through the helper would test nothing.
     */
    const err = await ctrl
      .confirmBooking(
        {
          body: {
            train: { number: TRAIN, name: 'Bhopal Shatabdi', class: TRAVEL_CLASS },
            route: { from: 'NDLS', to: 'BPL' },
            departureDate: date,
            seats: [{ coach: COACH, number: '40' }],
            passengers: [{ name: 'Impostor', age: 30, gender: 'male' }],
          },
        },
        {
          status: () => ({ json: () => ({}) }),
          json: () => ({}),
        },
      )
      .then(() => null)
      .catch((e) => e);

    assert.ok(err, 'the clashing booking was refused');
    assert.strictEqual(err.code, 'SEATS_UNAVAILABLE');

    const after = (await bookings.listBookings({ pageSize: 200 })).total;
    assert.strictEqual(after, before, 'a refused booking must not leave a row');
  });

  await test('a berth is given back when its booking is deleted', async () => {
    const date = nextDate();
    const made = await makeBooking({ date, seats: [{ coach: COACH, number: '45' }] });
    assert.strictEqual(await maskOf(date, '45'), '15');

    // CASCADE takes the holds with the booking, but the inventory mask has to be
    // cleared by hand — the FK is on the row, not on the bit.
    await holdService.releaseHolds(made.bookingRef);
    await bookings.discardBooking(made.bookingRef);

    assert.strictEqual(await maskOf(date, '45'), '0');
  });

  // --------------------------------------------------------------- clean-up
  for (const ref of refs) {
    await holdService.releaseHolds(ref).catch(() => {});
    await bookings.discardBooking(ref).catch(() => {});
  }
  await sequelize.query('UPDATE seat_inventory SET segment_mask = 0');

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exitCode = 1;
}

run()
  .then(async () => {
    await close();
  })
  .catch(async (err) => {
    console.error('\nBooking suite crashed:', err);
    process.exitCode = 1;
    await close();
  });