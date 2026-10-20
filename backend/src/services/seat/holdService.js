'use strict'

/**
 * Seat holds — the transactional core of "this berth is mine for five minutes".
 *
 * ## The rule
 *
 * Selecting a seat does not sell it. It *holds* it, for the length of the
 * booking's payment window, and only becomes sold when the payment is captured.
 * When the window closes the segments go back on sale automatically.
 *
 * ## How a berth is claimed
 *
 * Unlike a whole-journey seat, one berth can be sold several times over as long
 * as the runs do not overlap — one traveller NDLS→JHS, another JHS→BPL, same
 * physical seat. Occupancy lives in `seat_inventory`, one row per (seat, journey
 * date), as a bitmask. The claim is a single conditional UPDATE:
 *
 *   UPDATE seat_inventory
 *      SET segment_mask = segment_mask | :mask
 *    WHERE seat_id = :seatId AND departure_date = :date
 *      AND (segment_mask & :mask) = 0
 *
 * `affectedRows` is 1 if we won and 0 if some other booking already holds one
 * of those segments. MySQL evaluates that predicate under the row lock, so this
 * is a compare-and-swap with no read-then-write window — the same cross-process
 * guarantee a UNIQUE index gives, which matters because the payment store and
 * the booking registry are both process-local.
 *
 * ## The transaction is for all-or-nothing, not for locking
 *
 * The index and the conditional UPDATE do the locking. The transaction makes a
 * multi-seat booking all-or-nothing: three seats are three claims under one
 * commit, and if the third collides the first two are undone rather than left
 * holding segments nobody is coming back for.
 *
 * ## What this is not
 *
 * `bookings` is still Team 4's in-memory stand-in (PAYMENTS.md §10), so
 * `booking_ref` is a string with no foreign key behind it. Everything on the
 * seat side is properly keyed.
 */

const { QueryTypes, literal } = require('sequelize')

const { sequelize } = require('../../config/database')
const { SeatHold } = require('../../models')
const { routeFor, resolveSegment, parseDate, maskFor, segmentsOf, overlaps } = require('./journeyService')
const env = require('../../config/env')
const { badRequest, conflict } = require('../../utils/errors')

/**
 * ## Lock order, and why it is a rule rather than a habit
 *
 * Every transaction that touches both tables must lock **`seat_inventory`
 * first, then `seat_holds`**. Releasing a berth updates the inventory bits and
 * then deletes the hold; confirming a payment now takes the same two locks in
 * that order before it looks at the hold at all.
 *
 * The order matters because the two tables have no foreign key between them, so
 * nothing in the schema enforces it -- which is exactly why it has to be
 * written down. Get it wrong in one caller and that caller deadlocks against
 * every other one, under load, with no error at development time.
 *
 * Within `seat_inventory`, acquire rows in ascending `seat_id`. Two sessions
 * asking for the same berths in the same order queue; in opposite orders they
 * cross.
 */
const HOLDS = 'seat_holds';
const INVENTORY = 'seat_inventory';
const MAX_SEATS_PER_BOOKING = 6;

const clean = (value, maxLength) => String(value ?? '').trim().slice(0, maxLength);

/**
 * How long a hold may live, validated once.
 *
 * A hold that died before its payment window closed would free the berth out
 * from under a traveller already typing a UPI PIN — the exact race this module
 * exists to prevent. So the floor is the payment window, not zero.
 */
const resolveTtl = (ttlMinutes) => {
  const minutes = Number(ttlMinutes ?? env.seatHoldTtlMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw badRequest('Seat hold TTL must be a positive number of minutes.', 'ttlMinutes');
  }
  if (minutes < env.orderTtlMinutes) {
    throw badRequest(
      `A seat hold must outlive its payment window (${env.orderTtlMinutes} min), got ${minutes}.`,
      'ttlMinutes',
    );
  }
  return Math.round(minutes);
};

/**
 * Create this journey's inventory rows if they are not there yet.
 *
 * One idempotent statement. Needed because the claim above updates an existing
 * row — with no row, there is nothing to lock, and two concurrent first-claimers
 * would both succeed. `INSERT IGNORE` is a no-op when the rows already exist, so
 * this is safe to run on every read as well as every write.
 *
 * Scoped to one class: a traveller looking at 3A does not need the sleeper's
 * inventory materialised.
 *
 * @returns {Promise<number>} rows inserted (0 if it already existed)
 */
async function materialiseJourney({ trainNo, travelClass, departureDate } = {}) {
  const date = parseDate(departureDate);
  const number = clean(trainNo, 16);
  const cls = clean(travelClass, 10).toUpperCase();

  const [, meta] = await sequelize.query(
    `INSERT IGNORE INTO \`${INVENTORY}\` (seat_id, departure_date, segment_mask)
     SELECT s.seat_id, :date, 0
       FROM coaches c
       JOIN coach_seats s ON s.coach_id = c.coach_id
      WHERE c.train_id = (SELECT id FROM trains WHERE train_number = :number)
        AND c.class_code = :cls`,
    { replacements: { date, number, cls }, type: QueryTypes.INSERT },
  );

  return meta ?? 0;
}

/**
 * Resolve the requested seats to `seat_id`s, and reject anything unbookable.
 *
 * Done before the transaction so a typo in a seat code is a 400 rather than a
 * half-applied claim.
 */
async function resolveSeats({ trainNo, travelClass, departureDate, seats }) {
  const number = clean(trainNo, 16);
  const cls = clean(travelClass, 10).toUpperCase();
  const date = parseDate(departureDate);

  if (!Array.isArray(seats) || seats.length === 0) {
    throw badRequest('Select at least one seat before confirming.', 'seats');
  }
  if (seats.length > MAX_SEATS_PER_BOOKING) {
    throw badRequest(
      `A single booking cannot hold more than ${MAX_SEATS_PER_BOOKING} seats.`,
      'seats',
    );
  }

  const wanted = new Map();
  for (const seat of seats) {
    const coachCode = clean(seat?.coach, 8).toUpperCase();
    const seatCode = clean(seat?.number ?? seat?.seatCode ?? seat?.seat_code, 8);
    if (!coachCode || !seatCode) {
      throw badRequest('Each seat needs a coach and a seat number.', 'seats');
    }
    // A duplicate inside the request is a client bug, not a conflict: booking
    // one berth twice for a single passenger is nonsense, and left alone it would
    // surface as a collision with the traveller's own request.
    const key = `${coachCode}-${seatCode}`;
    if (wanted.has(key)) {
      throw badRequest(`Seat ${key} was selected twice.`, 'seats');
    }
    wanted.set(key, seat);
  }

  const rows = await sequelize.query(
    `SELECT s.seat_id AS seatId, c.coach_code AS coachCode, s.seat_code AS seatCode, s.berth_type AS berthType
       FROM coaches c
       JOIN coach_seats s ON s.coach_id = c.coach_id
      WHERE c.train_id = (SELECT id FROM trains WHERE train_number = :number)
        AND c.class_code = :cls`,
    { replacements: { number, cls }, type: QueryTypes.SELECT },
  );

  const byCode = new Map(rows.map((r) => [`${r.coachCode}-${r.seatCode}`, r]));

  const resolved = [];
  const unknown = [];
  for (const [key, seat] of wanted) {
    const row = byCode.get(key);
    if (row) {
      resolved.push({ ...row, requestedBerth: seat.type ?? null });
    } else {
      unknown.push(key);
    }
  }

  if (unknown.length > 0) {
    throw badRequest(
      `This train has no ${unknown.join(', ')} in class ${cls}. Pick from the coach map.`,
      'seats',
    );
  }

  return { date, seats: resolved };
}

/**
 * Which of the requested berths are blocked on which segments, and by whom.
 *
 * Read only after a rejected claim, purely to build an error worth reading.
 * A berth claimed on a *different* segment is not a conflict at all — that is
 * the whole point — so the message says which segments are spoken for.
 */
async function describeBlockers(wanted, mask, date) {
  if (wanted.length === 0) return [];

  const placeholders = wanted.map((_, i) => `:id${i}`).join(', ');
  const replacements = {};
  wanted.forEach((w, i) => {
    replacements[`id${i}`] = w.seatId;
  });

  const rows = await sequelize.query(
    `SELECT i.seat_id AS seatId, c.coach_code AS coachCode, s.seat_code AS seatCode,
            i.segment_mask AS segmentMask
       FROM \`${INVENTORY}\` i
       JOIN coach_seats s ON s.seat_id = i.seat_id
       JOIN coaches c ON c.coach_id = s.coach_id
      WHERE i.departure_date = :date
        AND i.seat_id IN (${placeholders})
        AND (i.segment_mask & :mask) != 0`,
    { replacements: { ...replacements, date, mask }, type: QueryTypes.SELECT },
  );

  return rows.map((r) => ({
    ...r,
    conflictingSegments: segmentsOf(r.segmentMask & mask),
  }));
}

/**
 * Hold every requested berth for one booking over one segment run, or none.
 *
 * @param {object} input
 * @param {string} input.bookingRef        tags the rows; must be the real ref
 * @param {string} input.trainNo
 * @param {string} input.travelClass
 * @param {string} input.departureDate     'YYYY-MM-DD'
 * @param {string} input.fromStation        station code — never a stop sequence
 * @param {string} input.toStation
 * @param {Array<{coach: string, number?: string, type?: string}>} input.seats
 * @param {number} [input.ttlMinutes]
 * @param {string|string[]} [input.supersedesRefs]
 *        bookings whose holds this replaces; their segments are released first,
 *        inside the same transaction
 * @returns {Promise<{bookingRef: string, expiresAt: string, segment: object, seats: object[]}>}
 * @throws {HttpError} 400 invalid input · 409 SEATS_UNAVAILABLE a berth is taken
 */
async function holdSeats({
  bookingRef,
  trainNo,
  travelClass,
  departureDate,
  fromStation,
  toStation,
  seats,
  ttlMinutes,
  supersedesRefs,
} = {}) {
  const ref = clean(bookingRef, 32);
  if (!ref) throw badRequest('bookingRef is required to hold a seat.', 'bookingRef');

  // Geometry and seat resolution first: both can fail with a 400, and neither
  // should reach the database.
  const route = await routeFor(trainNo);
  const segment = resolveSegment(route, fromStation, toStation);
  const { date, seats: resolvedSeats } = await resolveSeats({
    trainNo,
    travelClass,
    departureDate,
    seats,
  });
  const minutes = resolveTtl(ttlMinutes);

  // The journey has to exist before anything can be claimed against it.
  await materialiseJourney({ trainNo, travelClass, departureDate: date });

  // Never let a booking supersede itself — that would clear the very segments it
  // is about to claim, and restart the traveller's clock.
  const supersedes = (Array.isArray(supersedesRefs) ? supersedesRefs : [supersedesRefs])
    .map((r) => clean(r, 32))
    .filter((r) => r && r !== ref);

  return sequelize.transaction(async (transaction) => {
    /**
     * (0) Release the holds this claim replaces.
     *
     * Without this a retry locks the traveller out of their own seats: confirm
     * holds B1-52 for booking A, something fails before the order is minted, the
     * client re-confirms under a fresh reference B, and B is refused by the
     * mask A left behind — reported as "being paid for by someone else", which
     * is to say, by themselves.
     *
     * Inside this transaction rather than after it: releasing first and claiming
     * second as two operations would open a window where the segments are free
     * and another traveller can take them.
     */
    for (const superseded of supersedes) {
      await releaseBookingSegments(superseded, { transaction, onlyHeld: true });
    }

    /**
     * (0b) Retire lapsed holds on this journey before claiming.
     *
     * Without this a seat stays unavailable for up to one sweep interval after
     * its window closed, which would make the promise "the berth is free the
     * moment the traveller gives up" depend on a background job having ticked.
     * The sweeper is the cleanup; this is the rule.
     *
     * Scoped to the journey rather than run globally, so a claim never waits on
     * unrelated rows. Each booking is released through the same path as a
     * cancel, which clears its bits and deletes its rows together.
     */
    const lapsed = await sequelize.query(
      `SELECT DISTINCT booking_ref
         FROM \`${HOLDS}\`
        WHERE departure_date = :date
          AND status = 'held'
          AND expires_at <= NOW(3)`,
      { replacements: { date }, type: QueryTypes.SELECT, transaction },
    );

    for (const { booking_ref: lapsedRef } of lapsed) {
      await releaseBookingSegments(lapsedRef, { transaction, onlyHeld: true });
    }

    // (1) Claim each berth. Sequential rather than batched so that the first
    //     collision reports precisely which berth lost, and so the statements
    //     stay readable in a slow query log.
    for (const seat of resolvedSeats) {
      const [, meta] = await sequelize.query(
        `UPDATE \`${INVENTORY}\`
            SET segment_mask = segment_mask | :mask, updated_at = NOW(3)
          WHERE seat_id = :seatId
            AND departure_date = :date
            AND (segment_mask & :mask) = 0`,
        { replacements: { seatId: seat.seatId, date, mask: segment.mask }, type: QueryTypes.UPDATE, transaction },
      );

      if ((meta ?? 0) === 0) {
        // Roll the whole booking back by throwing; the segments already claimed
        // in this transaction go with it.
        const blockers = await describeBlockers(resolvedSeats, segment.mask, date);
        throw conflict(unavailableMessage(seat, blockers, segment), 'SEATS_UNAVAILABLE');
      }
    }

    // (2) Record what was claimed, per booking. The mask is stored rather than
    //     recomputed so a release can undo exactly what was taken even if the
    //     route is edited later.
    //
    //     Named placeholders per row, not `?` with a replacements object —
    //     Sequelize only binds positionally through named replacements, and the
    //     repeated-tuple shape means every row needs its own keys anyway.
    const insertReplacements = {};
    const tuples = resolvedSeats
      .map((seat, i) => {
        const at = (name) => `r${i}_${name}`;
        insertReplacements[at('ref')] = ref;
        insertReplacements[at('seatId')] = seat.seatId;
        insertReplacements[at('date')] = date;
        insertReplacements[at('fromSeq')] = segment.fromStopSeq;
        insertReplacements[at('toSeq')] = segment.toStopSeq;
        insertReplacements[at('mask')] = segment.mask;
        return (
          `(:${at('ref')}, :${at('seatId')}, :${at('date')}, :${at('fromSeq')}, :${at('toSeq')}, :${at('mask')},` +
          ` 'held', NOW(3), NOW(3), DATE_ADD(NOW(3), INTERVAL ${minutes} MINUTE))`
        );
      })
      .join(',\n         ');

    await sequelize.query(
      `INSERT INTO \`${HOLDS}\`
         (booking_ref, seat_id, departure_date, from_stop_seq, to_stop_seq, segment_mask,
          status, created_at, updated_at, expires_at)
       VALUES ${tuples}`,
      {
        replacements: insertReplacements,
        type: QueryTypes.INSERT,
        transaction,
      },
    );

    /**
     * `QueryTypes.SELECT` hands back the rows array *directly* — not
     * `[rows, metadata]`, which is what an untyped query gives. Destructuring
     * here would take the first row as though it were the array.
     */
    const claimed = await sequelize.query(
      `SELECT s.seat_id AS seatId, c.coach_code AS coachCode, s.seat_code AS seatCode,
              s.berth_type AS berthType, h.expires_at AS expiresAt
         FROM \`${HOLDS}\` h
         JOIN coach_seats s ON s.seat_id = h.seat_id
         JOIN coaches c ON c.coach_id = s.coach_id
        WHERE h.booking_ref = :ref
        ORDER BY c.position, s.position`,
      { replacements: { ref }, type: QueryTypes.SELECT, transaction },
    );

    if (!Array.isArray(claimed) || claimed.length === 0) {
      // The claims above all reported success, so a row must exist. If it does
      // not, the roll-up has drifted from what was written and returning a
      // half-formed hold would be worse than failing here.
      throw conflict(
        'The seat hold could not be recorded. Please try again.',
        'HOLD_NOT_RECORDED',
      );
    }

    return {
      bookingRef: ref,
      // One statement, one NOW(3), so every seat shares the deadline.
      expiresAt: new Date(claimed[0].expiresAt).toISOString(),
      segment: {
        fromStation: segment.from.stationCode,
        toStation: segment.to.stationCode,
        fromStopSeq: segment.fromStopSeq,
        toStopSeq: segment.toStopSeq,
        distanceKm: segment.distanceKm,
        mask: segment.mask,
      },
      seats: claimed.map((row) => ({
        seatId: String(row.seatId),
        coach: row.coachCode,
        seatNumber: row.seatCode,
        berthType: row.berthType,
      })),
    };
  });
}

function unavailableMessage(seat, blockers, segment) {
  const mine = blockers.find((b) => String(b.seatId) === String(seat.seatId));
  const label = `${seat.coachCode}-${seat.seatCode}`;

  if (!mine) {
    return `Seat ${label} was taken while you were choosing. Please pick again.`;
  }

  const occupied = mine.conflictingSegments
    .map((i) => `${segment.from.stationCode}→${segment.to.stationCode} leg ${i + 1}`)
    .join(', ');

  return (
    `Seat ${label} is no longer available — it is already taken for part of your journey ` +
    `(segment ${mine.conflictingSegments.join(', ')}). A berth is free only where every segment ` +
    `between your origin and destination is clear. Please pick another.`
  );
}

/**
 * Clear the bits a booking holds, and optionally delete its rows.
 *
 * @param {string} bookingRef
 * @param {object} [options]
 * @param {object} [options.transaction]
 * @param {boolean} [options.onlyHeld] leave confirmed rows and their bits alone
 * @returns {Promise<number>} segments released
 */
async function releaseBookingSegments(bookingRef, { transaction, onlyHeld = true } = {}) {
  const ref = clean(bookingRef, 32);
  if (!ref) return 0;

  const holds = await sequelize.query(
    `SELECT hold_id, seat_id, departure_date, segment_mask
       FROM \`${HOLDS}\`
      WHERE booking_ref = :ref${onlyHeld ? " AND status = 'held'" : ''}`,
    { replacements: { ref }, type: QueryTypes.SELECT, transaction },
  );

  if (holds.length === 0) return 0;

  for (const hold of holds) {
    // The SELECT above aliases nothing, so these come back as column names.
    //
    // `~(:mask)` and not `~:mask`: Sequelize's replacement scanner only
    // recognises `:name` when the colon directly follows `(`, a word boundary or
    // a comma. Written as `segment_mask & ~:mask` the placeholder reaches MySQL
    // unsubstituted and the statement fails with a syntax error near ':mask'.
    // The inner parentheses are load-bearing — do not "tidy" them away.
    //
    // `departure_date` is part of the predicate, and it is not decoration.
    //
    // `seat_inventory` is keyed (seat_id, departure_date): one row per berth per
    // journey. Selecting without the date and matching on `seat_id` alone cleared
    // those bits on *every* date the berth had ever run. Reproduced against the
    // live database: two bookings on the same berth on 1 and 2 September,
    // cancelling the first one reset the second's mask to 0 — freeing a berth
    // another passenger had already been sold, on a different day, for them to
    // buy twice.
    //
    // The SQL routines in database/sql/booking_procedures.sql join on the date
    // for exactly this reason. This one did not, and the single-date tests could
    // not see it.
    await sequelize.query(
      `UPDATE \`${INVENTORY}\`
          SET segment_mask = segment_mask & ~(:mask), updated_at = NOW(3)
        WHERE seat_id = :seatId
          AND departure_date = :departureDate`,
      {
        replacements: {
          seatId: hold.seat_id,
          mask: hold.segment_mask,
          departureDate: hold.departure_date,
        },
        type: QueryTypes.UPDATE,
        transaction,
      },
    );
  }

  await sequelize.query(
    `DELETE FROM \`${HOLDS}\` WHERE booking_ref = :ref${onlyHeld ? " AND status = 'held'" : ''}`,
    { replacements: { ref }, type: QueryTypes.DELETE, transaction },
  );

  return holds.length;
}

/**
 * Promote a booking's holds from held to sold.
 *
 * The other half of the rule, and the half that needs a real transaction: money
 * has been captured at the gateway, so the segments must become irreversibly the
 * passenger's — or the booking is refused. The `FOR UPDATE` locks the rows and the
 * liveness test runs in the same statement, so a hold that lapsed in the gap
 * between Checkout returning and this call arriving is caught here rather than
 * selling a berth somebody else has since taken.
 *
 * ## `required`, and why it is not inferred
 *
 * A booking with *no hold rows at all* is is ambiguous: it is either a booking made
 * before seat holds existed (the seeded demo references) or one whose holds have
 * all been swept. The first must not fail a payment; the second must. Guessing
 * from a row count cannot tell them apart, so the caller states it.
 *
 * @param {object} input
 * @param {string} input.bookingRef
 * @param {boolean} [input.required] treat "no holds" as a failure
 * @returns {Promise<{bookingRef: string, applied: boolean, confirmedAt: string|null, seats: object[]}>}
 * @throws {HttpError} 409 HOLDS_EXPIRED the hold lapsed before payment landed
 */
async function confirmHolds({ bookingRef, required = false } = {}) {
  const ref = clean(bookingRef, 32);
  if (!ref) throw badRequest('bookingRef is required.', 'bookingRef');

  return sequelize.transaction(async (transaction) => {
    /**
     * Take the inventory locks before the hold locks.
     *
     * This is the one place that used to get it backwards, and it was a real
     * deadlock rather than a theoretical one: it locked `seat_holds` first,
     * while every path that gives a berth back -- `releaseBookingSegments`, the
     * expiry sweeper, `cancel_booking` -- locks `seat_inventory` first and then
     * `seat_holds`. Two transactions crossing that way deadlock, and InnoDB
     * rolls one back.
     *
     * It bit hardest exactly when it matters most. A payment capture and a
     * hold expiry on the same berth have to be serialised one way or the other:
     * if the expiry clears the bits and deletes the hold first, this would
     * promote a hold whose berth is already back on sale and sell it twice. A
     * test at tatkal rates turned this from a slow query into a lock pile-up --
     * eight sessions waiting on one row, which is what a wedged connection pool
     * looks like from the outside.
     *
     * The join is also what makes the ordering total: `ORDER BY i.seat_id`
     * means two sessions that touch the same berths queue behind each other
     * instead of crossing.
     */
    await sequelize.query(
      `SELECT i.inventory_id
         FROM \`${INVENTORY}\` i
         JOIN \`${HOLDS}\` h
           ON h.\`seat_id\`         = i.\`seat_id\`
          AND h.\`departure_date\` = i.\`departure_date\`
        WHERE h.\`booking_ref\` = :ref
        ORDER BY i.\`seat_id\`
        FOR UPDATE`,
      { replacements: { ref }, type: QueryTypes.SELECT, transaction },
    );

    // `live` is computed by MySQL, on the same clock that stamped expires_at,
    // rather than by comparing timestamps in Node — otherwise this module's
    // central promise (the database decides when a hold ends) quietly stops
    // being true.
    const rows = await sequelize.query(
      `SELECT hold_id, seat_id, status,
              (status = 'confirmed' OR expires_at > NOW(3)) AS live
         FROM \`${HOLDS}\`
        WHERE booking_ref = :ref
        FOR UPDATE`,
      { replacements: { ref }, type: QueryTypes.SELECT, transaction },
    );

    if (rows.length === 0) {
      if (required) {
        throw conflict(
          'This booking no longer holds any seats, so the payment cannot be applied to them.',
          'HOLDS_EXPIRED',
        );
      }
      return { bookingRef: ref, applied: false, confirmedAt: null, seats: [] };
    }

    if (rows.some((r) => !r.live)) {
      throw conflict(
        'The seat hold expired before the payment completed. The amount will be refunded.',
        'HOLDS_EXPIRED',
      );
    }

    const pending = rows.filter((r) => r.status !== 'confirmed');
    if (pending.length > 0) {
      await sequelize.query(
        `UPDATE \`${HOLDS}\`
            SET status = 'confirmed', confirmed_at = NOW(3), updated_at = NOW(3)
          WHERE booking_ref = :ref AND status = 'held' AND expires_at > NOW(3)`,
        { replacements: { ref }, type: QueryTypes.UPDATE, transaction },
      );
    }

    const confirmed = await sequelize.query(
      `SELECT c.coach_code AS coach, s.seat_code AS seatNumber, s.berth_type AS berthType,
              h.status, h.confirmed_at AS confirmedAt
         FROM \`${HOLDS}\` h
         JOIN coach_seats s ON s.seat_id = h.seat_id
         JOIN coaches c ON c.coach_id = s.coach_id
        WHERE h.booking_ref = :ref
        ORDER BY c.position, s.position`,
      { replacements: { ref }, type: QueryTypes.SELECT, transaction },
    );

    return {
      bookingRef: ref,
      applied: true,
      confirmedAt: confirmed[0]?.confirmedAt ? new Date(confirmed[0].confirmedAt).toISOString() : null,
      seats: confirmed.map((row) => ({
        coach: row.coach,
        seatNumber: row.seatNumber,
        berthType: row.berthType,
        status: row.status,
      })),
    };
  });
}

/**
 * Give up every seat a booking is holding. Sold seats are left alone.
 *
 * This is what runs when a traveller abandons Checkout and closes the tab — the
 * sweeper covers the case where they simply stop.
 */
async function releaseHolds(bookingRef) {
  return sequelize.transaction((transaction) => releaseBookingSegments(bookingRef, { transaction, onlyHeld: true }));
}

/**
 * Reclaim every hold whose window has closed, across all journeys.
 *
 * The sweeper's only operation. Safe to run concurrently with itself and with
 * any number of in-flight bookings: the predicate is idempotent, so whoever gets
 * there first clears the row and the other finds nothing.
 *
 * @returns {Promise<number>} holds reclaimed
 */
async function expireStaleHolds() {
  const stale = await sequelize.query(
    `SELECT booking_ref FROM \`${HOLDS}\`
      WHERE status = 'held' AND expires_at <= NOW(3)
      GROUP BY booking_ref`,
    { type: QueryTypes.SELECT },
  );

  let reclaimed = 0;
  for (const { booking_ref: ref } of stale) {
    reclaimed += await sequelize.transaction((transaction) =>
      releaseBookingSegments(ref, { transaction, onlyHeld: true }),
    );
  }

  return reclaimed;
}

/**
 * Every berth spoken for on a journey, with its mask.
 *
 * The UI needs to know more than "taken or free": a berth free for the traveller
 * but taken for part of the route is exactly the case this model exists for, and
 * the seat map has to be able to show it.
 *
 * @returns {Promise<{coaches: object[], totalSeats: number, takenSeats: number}>}
 */
async function journeyAvailability({ trainNo, travelClass, departureDate } = {}) {
  const date = parseDate(departureDate);
  const number = clean(trainNo, 16);
  const cls = clean(travelClass, 10).toUpperCase();

  await materialiseJourney({ trainNo: number, travelClass: cls, departureDate: date });

  const rows = await sequelize.query(
    // `coach_type` moved to the `classes` lookup in migration 011 — it is a
    // property of the class code, duplicated onto every coach row of that class.
    `SELECT c.coach_code AS coachCode, cl.coach_type AS coachType, c.position AS coachPosition,
            s.seat_id AS seatId, s.seat_code AS seatCode, s.berth_type AS berthType, s.position AS seatPosition,
            COALESCE(i.segment_mask, 0) AS segmentMask
       FROM coaches c
       JOIN classes cl ON cl.class_code = c.class_code
       JOIN coach_seats s ON s.coach_id = c.coach_id
       LEFT JOIN \`${INVENTORY}\` i
              ON i.seat_id = s.seat_id AND i.departure_date = :date
      WHERE c.train_id = (SELECT id FROM trains WHERE train_number = :number)
        AND c.class_code = :cls
      ORDER BY c.position, s.position`,
    { replacements: { date, number, cls }, type: QueryTypes.SELECT },
  );

  const coaches = new Map();
  for (const row of rows) {
    if (!coaches.has(row.coachCode)) {
      coaches.set(row.coachCode, {
        coach: row.coachCode,
        coachType: row.coachType,
        position: Number(row.coachPosition),
        seats: [],
      });
    }
    // A string, because a 64-bit mask does not survive a JS number intact.
    const mask = String(row.segmentMask);
    coaches.get(row.coachCode).seats.push({
      seatId: String(row.seatId),
      seatNumber: row.seatCode,
      berthType: row.berthType,
      position: Number(row.seatPosition),
      segmentMask: mask,
      occupiedSegments: segmentsOf(mask),
    });
  }

  const all = [...coaches.values()].flatMap((c) => c.seats);

  return {
    departureDate: date,
    coaches: [...coaches.values()],
    totalSeats: all.length,
    // Derived, not read off train_classes.available_seats — that column is a
    // static seed number that has never tracked a booking.
    takenSeats: all.filter((s) => BigInt(s.segmentMask) !== 0n).length,
  };
}

/**
 * What this booking currently holds, and when it dies.
 *
 * @returns {Promise<{bookingRef: string, expiresAt: string|null, seats: object[], segment: object|null}|null>}
 */
async function holdsForBooking(bookingRef) {
  const ref = clean(bookingRef, 32);
  if (!ref) return null;

  const rows = await sequelize.query(
    `SELECT c.coach_code AS coach, s.seat_code AS seatNumber, s.berth_type AS berthType,
            h.expires_at AS expiresAt, h.from_stop_seq AS fromSeq, h.to_stop_seq AS toSeq
       FROM \`${HOLDS}\` h
       JOIN coach_seats s ON s.seat_id = h.seat_id
       JOIN coaches c ON c.coach_id = s.coach_id
      WHERE h.booking_ref = :ref
        AND h.status = 'held'
        AND h.expires_at > NOW(3)
      ORDER BY c.position, s.position`,
    { replacements: { ref }, type: QueryTypes.SELECT },
  );

  if (rows.length === 0) return null;

  return {
    bookingRef: ref,
    expiresAt: new Date(rows[0].expiresAt).toISOString(),
    segment: { fromStopSeq: Number(rows[0].fromSeq), toStopSeq: Number(rows[0].toSeq) },
    seats: rows.map((row) => ({
      coach: row.coach,
      seatNumber: row.seatNumber,
      berthType: row.berthType,
    })),
  };
}

module.exports = {
  holdSeats,
  confirmHolds,
  releaseHolds,
  releaseBookingSegments,
  expireStaleHolds,
  journeyAvailability,
  holdsForBooking,
  materialiseJourney,
  resolveSeats,
  MAX_SEATS_PER_BOOKING,
};