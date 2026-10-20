'use strict'

/**
 * Seat hold tests — segment booking and the bitmask occupancy model.
 *
 * Needs a real MySQL and the seeded coaches. Almost everything asserted here is
 * a property only the database can provide: that a UNIQUE-free compare-and-swap
 * refuses an overlap, that a row lock serialises two transactions, that
 * `NOW(3)` moves, and that clearing one booking's bits leaves a neighbour's
 * alone. A mocked store would test the mock.
 *
 *   npm run db:migrate && node src/scripts/seedCoaches.js && node tests/seatHold.test.js
 *
 * Each case works on its own date and its own berth, so nothing can make another
 * case's assertions lie. Cleanup is in a finally block at the end; a crash
 * mid-suite leaves rows behind, which is why each case also asserts on seats it
 * has just claimed rather than on a global count.
 */

const assert = require('assert')

const { sequelize, close } = require('../src/config/database')
const holdService = require('../src/services/seat/holdService')
const { maskFor, overlaps, resolveSegment, routeFor } = require('../src/services/seat/journeyService')

/** The train used throughout: 5 stops, so 4 segments and 4 bits. */
const TRAIN = '12002';
const TRAVEL_CLASS = 'EC';
const COACH = 'E1';
const SEAT = '3';

/**
 * A distinct journey date per test, so holds from one case can never collide
 * with another's.
 *
 * Built with real date arithmetic rather than `20 + n`: the suite has more than
 * ten cases, and November has thirty days, so a naive increment walks off the
 * end of the month and every later case fails on its own date.
 */
let dateCounter = 0;
const nextDate = () => {
  dateCounter += 1;
  const d = new Date(Date.UTC(2026, 10, 1));
  d.setUTCDate(d.getUTCDate() + dateCounter);
  return d.toISOString().slice(0, 10);
};

const refs = new Set();
const newRef = () => {
  const ref = `YTR-SEAT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  refs.add(ref);
  return ref;
};

/** Hold one berth on one date. */
/**
 * Create the `bookings` row a hold now hangs off.
 *
 * `fk_seat_holds_booking` makes a booking the parent of its holds, so a hold
 * cannot be written before its booking exists. This suite deliberately skips the
 * booking service — it is testing the hold model, not the booking lifecycle —
 * but it still has to satisfy that foreign key, so the row is written directly
 * with only the eight columns `bookings` actually requires.
 *
 * `INSERT IGNORE` rather than an upsert: a case that holds twice under the same
 * reference must keep the first row, and re-inserting would silently reset its
 * timestamps.
 */
async function ensureBooking(bookingRef, from, to) {
  // `routeFor` now returns `stationId` as well as the code, which is what the
  // booking needs: migration 011 replaced train_no and the station code/name
  // pairs with `train_id` and the two station ids.
  const segment = resolveSegment(await routeFor(TRAIN), from, to);

  const [trainRow] = await sequelize.query(
    'SELECT id FROM trains WHERE train_number = :n',
    { replacements: { n: TRAIN }, type: require('sequelize').QueryTypes.SELECT },
  );

  await sequelize.query(
    `INSERT IGNORE INTO \`bookings\`
       (booking_ref, status, train_id, travel_class,
        origin_station_id, destination_station_id,
        from_stop_seq, to_stop_seq, segment_mask, distance_km, currency)
     VALUES
       (:ref, 'HELD', :trainId, :travelClass,
        :originId, :destinationId,
        :fromSeq, :toSeq, :mask, :distanceKm, 'INR')`,
    {
      replacements: {
        ref: bookingRef,
        trainId: trainRow?.id,
        travelClass: TRAVEL_CLASS,
        originId: segment.from?.stationId,
        destinationId: segment.to?.stationId,
        fromSeq: segment.fromStopSeq,
        toSeq: segment.toStopSeq,
        mask: segment.mask,
        distanceKm: segment.distanceKm,
      },
    },
  );
}

/** Hold one berth on one date. */
const hold = async (from, to, date, { seat = SEAT, coach = COACH, bookingRef, supersedesRefs } = {}) => {
  const ref = bookingRef ?? newRef();
  await ensureBooking(ref, from, to);
  return holdService.holdSeats({
    bookingRef: ref,
    trainNo: TRAIN,
    travelClass: TRAVEL_CLASS,
    departureDate: date,
    fromStation: from,
    toStation: to,
    seats: [{ coach, number: seat }],
    supersedesRefs,
  });
};

/**
 * The current mask on one berth, as a string.
 *
 * `sequelize.query` without a `type` returns `[rows, metadata]`, so the rows
 * have to come off the front. Passing no type and treating the whole result as
 * rows is a quiet way to get `undefined` rather than a mask.
 */
async function maskOf(date, { seat = SEAT, coach = COACH } = {}) {
  const [rows] = await sequelize.query(
    `SELECT i.segment_mask AS m
       FROM seat_inventory i
       JOIN coach_seats s ON s.seat_id = i.seat_id
       JOIN coaches c ON c.coach_id = s.coach_id
      WHERE i.departure_date = :date AND c.coach_code = :coach AND s.seat_code = :seat`,
    { replacements: { date, coach, seat } },
  );
  return rows.length === 0 ? null : String(rows[0].m);
}

/** Age a hold past its deadline without waiting five minutes. */
const backdate = (bookingRef) =>
  sequelize.query(
    `UPDATE seat_holds SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 MINUTE) WHERE booking_ref = :ref`,
    { replacements: { ref: bookingRef } },
  );

async function expectRefusal(fn, expectedCode) {
  try {
    await fn();
  } catch (err) {
    if (expectedCode) {
      assert.strictEqual(err.code, expectedCode, `expected ${expectedCode}, got ${err.code}: ${err.message}`);
    }
    return err;
  }
  throw new Error(`expected a refusal${expectedCode ? ` with ${expectedCode}` : ''}, but it succeeded`);
}

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
  console.log('\nYatrio seat hold tests — segment booking\n');

  /**
   * Clear anything an earlier run or a manual poke left behind.
   *
   * A crashed suite does not reach its cleanup, and the next run then inherits
   * holds that make its assertions lie — with confusing failures rather than an
   * obvious "the database was dirty". Starting from zero makes the suite
   * repeatable, which is the property worth having.
   */
  // Cascade takes the holds with the bookings, so clearing the parents is enough.
  // Only `YTR-SEAT-*` — the demo bookings the payment suite relies on are real
  // rows and must survive.
  await sequelize.query('DELETE FROM bookings WHERE booking_ref LIKE :prefix', {
    replacements: { prefix: 'YTR-SEAT-%' },
  });
  await sequelize.query('DELETE FROM seat_holds');
  await sequelize.query('UPDATE seat_inventory SET segment_mask = 0');

  // ------------------------------------------------------------ geometry
  await test('the mask encodes the segments actually travelled', async () => {
    assert.strictEqual(maskFor(1, 5), '15', 'the whole route is all four bits');
    assert.strictEqual(maskFor(1, 4), '7', 'stops 1-4 are bits 0,1,2');
    assert.strictEqual(maskFor(4, 5), '8', 'the last leg is bit 3 alone');
    assert.strictEqual(maskFor(2, 3), '2', 'one stop is one bit');
    // The encoding is what makes a shared berth possible, so state the two
    // relationships the rest of this suite depends on.
    assert.strictEqual(overlaps(7, 8), false, 'disjoint runs share a berth');
    assert.strictEqual(overlaps(7, 14), true, 'overlapping runs do not');
  });

  await test('the mask is a string, because 64 bits do not survive a JS number', async () => {
    const mask = maskFor(1, 65);
    assert.strictEqual(typeof mask, 'string');
    assert.strictEqual(mask, ((1n << 64n) - 1n).toString());
  });

  await test('a journey shorter than a segment is refused', async () => {
    await expectRefusal(async () => maskFor(3, 3));
    await expectRefusal(async () => maskFor(4, 2));
  });

  await test('travelling backwards is refused', async () => {
    const route = await routeFor(TRAIN);
    const err = await expectRefusal(() => resolveSegment(route, 'BPL', 'NDLS'));
    assert.strictEqual(err.status, 400);
  });

  await test('a station the train does not serve is refused', async () => {
    const route = await routeFor(TRAIN);
    const err = await expectRefusal(() => resolveSegment(route, 'ZZZ', 'BPL'));
    assert.strictEqual(err.status, 400);
  });

  // ----------------------------------------------------------- claiming
  await test('a hold claims exactly the segments it was asked for', async () => {
    const date = nextDate();
    const result = await hold('NDLS', 'JHS', date);
    assert.strictEqual(result.segment.mask, '7');
    assert.strictEqual(result.segment.fromStopSeq, 1);
    assert.strictEqual(result.segment.toStopSeq, 4);
    assert.strictEqual(result.segment.distanceKm, 410, 'cumulative distance, not a guess');
    assert.strictEqual(await maskOf(date), '7');
  });

  await test('the SAME berth is sellable again where the bits are clear', async () => {
    const date = nextDate();
    await hold('NDLS', 'JHS', date);   // 0111
    await hold('JHS', 'BPL', date);    // 1000 — disjoint

    // The headline behaviour: two passengers, one physical berth.
    assert.strictEqual(await maskOf(date), '15', 'all four segments now spoken for');
  });

  await test('an overlapping claim is refused', async () => {
    const date = nextDate();
    await hold('NDLS', 'JHS', date);   // 0111
    const err = await expectRefusal(() => hold('AGC', 'GWL', date));  // 0010, overlaps
    assert.strictEqual(err.code, 'SEATS_UNAVAILABLE');
    assert.match(err.message, /part of your journey/);
  });

  await test('a whole-route claim is refused once a leg is taken', async () => {
    const date = nextDate();
    await hold('NDLS', 'JHS', date);
    await expectRefusal(() => hold('NDLS', 'BPL', date), 'SEATS_UNAVAILABLE');
  });

  await test("cancelling one journey does not free another journey's berth", async () => {
    // Regression, reproduced against the live database before it was fixed.
    //
    // `seat_inventory` is keyed (seat_id, departure_date) -- one row per berth
    // per journey. `releaseBookingSegments` selected the hold without its date
    // and matched `WHERE seat_id = :seatId` alone, so giving a berth back cleared
    // those bits on every date that berth had ever run.
    //
    // Two travellers, same berth, 1 and 2 September. The first cancels. The
    // second is still flying on the second and must keep their seat -- otherwise
    // the berth is on sale twice, to two passengers, for the same journey.
    const dayOne = nextDate()
    const dayTwo = nextDate()

    const first = await hold('NDLS', 'BPL', dayOne, { bookingRef: newRef() })
    const second = await hold('NDLS', 'BPL', dayTwo, { bookingRef: newRef() })
    assert.strictEqual(first.bookingRef !== second.bookingRef, true, 'two distinct bookings')

    assert.strictEqual(await maskOf(dayOne), '15', 'first booking holds the berth on day one')
    assert.strictEqual(await maskOf(dayTwo), '15', 'second booking holds the same berth on day two')

    await holdService.releaseHolds(first.bookingRef)

    assert.strictEqual(await maskOf(dayOne), '0', 'the cancelling booking gave its berth back')
    assert.strictEqual(
      await maskOf(dayTwo), '15',
      'and the other booking kept its berth on its own date -- this is the assertion that failed',
    )
  })

  await test('two concurrent claims of one berth: exactly one wins', async () => {
    const date = nextDate();
    // Both in flight before either settles — the race the compare-and-swap on
    // (segment_mask & mask) = 0 exists to settle.
    const settled = await Promise.allSettled([hold('NDLS', 'BPL', date), hold('NDLS', 'BPL', date)]);

    const won = settled.filter((s) => s.status === 'fulfilled');
    const lost = settled.filter((s) => s.status === 'rejected');
    assert.strictEqual(won.length, 1, 'exactly one claim may succeed');
    assert.strictEqual(lost[0].reason.code, 'SEATS_UNAVAILABLE');
  });

  await test('concurrent claims on disjoint segments both succeed', async () => {
    const date = nextDate();
    const settled = await Promise.allSettled([hold('NDLS', 'JHS', date), hold('JHS', 'BPL', date)]);
    assert.ok(
      settled.every((s) => s.status === 'fulfilled'),
      'a berth is not exclusive to one segment run',
    );
    assert.strictEqual(await maskOf(date), '15');
  });

  // ---------------------------------------------------------- releasing
  await test('releasing one booking leaves a neighbour on the same berth alone', async () => {
    const date = nextDate();
    const a = await hold('NDLS', 'JHS', date);
    await hold('JHS', 'BPL', date);

    await holdService.releaseHolds(a.bookingRef);

    assert.strictEqual(await maskOf(date), '8', 'only A\'s bits were cleared');
  });

  await test('a confirmed seat is never released', async () => {
    const date = nextDate();
    const mine = await hold('NDLS', 'BPL', date);
    await holdService.confirmHolds({ bookingRef: mine.bookingRef });

    await holdService.releaseHolds(mine.bookingRef);

    assert.strictEqual(await maskOf(date), '15', 'a sold berth stays sold');
    await expectRefusal(() => hold('NDLS', 'JHS', date), 'SEATS_UNAVAILABLE');
  });

  await test('superseding a booking gives its segments straight back', async () => {
    const date = nextDate();
    const first = await hold('NDLS', 'JHS', date);
    const second = await hold('NDLS', 'JHS', date, {
      bookingRef: newRef(),
      supersedesRefs: first.bookingRef,
    });

    // Only reachable because the retry released what it was replacing — the
    // failure mode that stranded five bookings and locked a traveller out of
    // their own seats.
    assert.deepStrictEqual(second.segment.mask, first.segment.mask);
  });

  // ------------------------------------------------------------- expiry
  await test('an elapsed hold is claimable again', async () => {
    const date = nextDate();
    const first = await hold('NDLS', 'JHS', date);
    await backdate(first.bookingRef);

    await hold('NDLS', 'JHS', date);
    assert.strictEqual(await maskOf(date), '7');
  });

  await test('the sweeper clears only the bits of the hold that lapsed', async () => {
    const date = nextDate();
    const a = await hold('NDLS', 'JHS', date);   // 0111
    await hold('JHS', 'BPL', date);             // 1000
    await backdate(a.bookingRef);

    await holdService.expireStaleHolds();

    assert.strictEqual(await maskOf(date), '8', 'B survives its neighbour expiring');
  });

  await test('the sweeper leaves a confirmed booking alone', async () => {
    const date = nextDate();
    const sold = await hold('NDLS', 'BPL', date);
    await holdService.confirmHolds({ bookingRef: sold.bookingRef });

    await holdService.expireStaleHolds();

    assert.strictEqual(await maskOf(date), '15', 'a ticket outlives the sweeper');
  });

  // -------------------------------------------------- promotion on payment
  await test('confirming a hold promotes it and keeps its bits', async () => {
    const date = nextDate();
    const mine = await hold('NDLS', 'JHS', date);
    const result = await holdService.confirmHolds({ bookingRef: mine.bookingRef });

    assert.strictEqual(result.applied, true);
    assert.ok(result.confirmedAt);
    assert.strictEqual(await maskOf(date), '7', 'still sold');
  });

  await test('a hold that lapsed before capture refuses the sale', async () => {
    const date = nextDate();
    const mine = await hold('NDLS', 'JHS', date);
    await backdate(mine.bookingRef);

    await expectRefusal(
      () => holdService.confirmHolds({ bookingRef: mine.bookingRef, required: true }),
      'HOLDS_EXPIRED',
    );
  });

  await test('a swept hold refuses the sale when holds are required', async () => {
    const date = nextDate();
    const mine = await hold('NDLS', 'JHS', date);
    await backdate(mine.bookingRef);
    await holdService.expireStaleHolds();

    await expectRefusal(
      () => holdService.confirmHolds({ bookingRef: mine.bookingRef, required: true }),
      'HOLDS_EXPIRED',
    );
  });

  await test('a booking with no holds is not a failure', async () => {
    // The seeded demo references predate seat holds; requiring one for them would
    // break payment for every booking made before this existed.
    const result = await holdService.confirmHolds({ bookingRef: 'YTR-12951-7QX2', required: false });
    assert.strictEqual(result.applied, false);
    assert.deepStrictEqual(result.seats, []);
  });

  // ------------------------------------------------------------ validation
  await test('the same berth twice in one request is a 400, not a 409', async () => {
    const date = nextDate();
    const err = await expectRefusal(() =>
      holdService.holdSeats({
        bookingRef: newRef(),
        trainNo: TRAIN,
        travelClass: TRAVEL_CLASS,
        departureDate: date,
        fromStation: 'NDLS',
        toStation: 'JHS',
        seats: [{ coach: COACH, number: SEAT }, { coach: COACH, number: SEAT }],
      }),
    );
    assert.strictEqual(err.status, 400, 'their own typo, not someone else\'s seat');
  });

  await test('a berth this coach does not have is refused', async () => {
    const date = nextDate();
    const err = await expectRefusal(() => hold('NDLS', 'JHS', date, { seat: '9999' }));
    assert.strictEqual(err.status, 400);
    assert.match(err.message, /no E1-9999/i, 'the message names the berth that does not exist');
  });

  await test('malformed dates are refused before anything is written', async () => {
    for (const date of ['2026-13-01', '2026-02-31', '15-10-2026', 'tomorrow', '']) {
      await expectRefusal(() => hold('NDLS', 'JHS', date));
    }
  });

  await test('a segment run longer than a mask can hold is refused by the schema', async () => {
    // The CHECK constraint is the backstop; it is reached by writing directly,
    // because no route in the data is long enough to produce one.
    await expectRefusal(() =>
      sequelize.query(
        `INSERT INTO seat_holds (booking_ref, seat_id, departure_date, from_stop_seq, to_stop_seq, segment_mask, status, expires_at)
         VALUES (:ref, (SELECT seat_id FROM coach_seats LIMIT 1), :date, 1, 70, 1, 'held', DATE_ADD(NOW(3), INTERVAL 5 MINUTE))`,
        { replacements: { ref: newRef(), date: nextDate() } },
      ),
    );
  });

  // ----------------------------------------------------------- availability
  await test('availability reports masks, and counts berths not bookings', async () => {
    const date = nextDate();
    await hold('NDLS', 'JHS', date);
    await hold('JHS', 'BPL', date);

    const availability = await holdService.journeyAvailability({
      trainNo: TRAIN,
      travelClass: TRAVEL_CLASS,
      departureDate: date,
    });

    const coach = availability.coaches.find((c) => c.coach === COACH);
    const seat = coach.seats.find((s) => s.seatNumber === SEAT);

    assert.strictEqual(seat.segmentMask, '15');
    assert.deepStrictEqual(seat.occupiedSegments, [0, 1, 2, 3]);
    assert.strictEqual(availability.takenSeats, 1, 'one berth, however many passengers');
    assert.strictEqual(availability.totalSeats, 46, 'EC coaches on the 12002');
  });

  await test('availability materialises the journey if it has not been seen before', async () => {
    const date = nextDate();
    const availability = await holdService.journeyAvailability({
      trainNo: TRAIN,
      travelClass: TRAVEL_CLASS,
      departureDate: date,
    });
    assert.ok(availability.totalSeats > 0);
    assert.strictEqual(availability.takenSeats, 0, 'nothing booked, so nothing taken');
  });

  // ----------------------------------------------------------- clean-up
  for (const ref of refs) {
    await holdService.releaseHolds(ref);
  }
  // The parent rows go last: CASCADE removes the holds, so deleting them
  // separately would just be a second pass over rows that are already gone.
  await sequelize.query('DELETE FROM bookings WHERE booking_ref LIKE :prefix', {
    replacements: { prefix: 'YTR-SEAT-%' },
  });
  await sequelize.query('DELETE FROM seat_holds WHERE booking_ref LIKE :prefix', {
    replacements: { prefix: 'YTR-SEAT-%' },
  });
  await holdService.expireStaleHolds();

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exitCode = 1;
}

run()
  .then(async () => {
    await close();
  })
  .catch(async (err) => {
    console.error('\nSeat hold suite crashed:', err);
    process.exitCode = 1;
    await close();
  });