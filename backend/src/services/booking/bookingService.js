'use strict'

/**
 * Booking service — the durable booking record.
 *
 * ## What this replaces
 *
 * `payment/bookingService.js` kept bookings in a `Map`. A reference the browser
 * held in `sessionStorage` therefore named nothing after a restart, and because
 * the reference is persisted client-side while the record was not,
 * `/payments/create-order` answered a 404 the traveller could not recover from:
 * every retry replayed the same dead reference. That is the bug this table and
 * this service exist to remove.
 *
 * `payment/bookingService.js` still owns fare *policy* — the class list, coupons,
 * the convenience fee — because the payment module reads those too. What moved
 * here is the **record**: its lifecycle, its persistence, and the transitions
 * between statuses.
 *
 * ## Ownership
 *
 * A booking belongs to the user who made it, and cancelling one requires proving
 * that. `user_id` is nullable because the booking flow does not insist on an
 * account, but when it is set the check is a single indexed comparison — which
 * is why `assertOwnership` exists rather than "look it up and compare in the
 * caller".
 */

const { QueryTypes } = require('sequelize')

const { sequelize } = require('../../config/database')
const { randomBytes } = require('node:crypto')
const env = require('../../config/env')
const { badRequest, notFound, conflict, forbidden } = require('../../utils/errors')

const COACH_PREFIX = { '1A': 'H', '2A': 'A', '3A': 'B', SL: 'S', CC: 'C', EC: 'E', '2S': 'G' };
const MAX_PASSENGERS = 6;

/**
 * Statuses a booking can never leave.
 *
 * Both are decisions something else made: expiry by the sweeper, cancellation by
 * the traveller (or support). Treating them as ordinary intermediate states
 * would let a stale HELD booking be revived onto berths that have since been
 * resold.
 */
const TERMINAL = ['CANCELLED', 'EXPIRED'];

/** Per-booking platform fee, in paise. Not per passenger. */
const CONVENIENCE_FEE = 1000;
const INSURANCE_PER_PERSON = 45;

const COUPONS = {
  YATRIO10: { percentOffBase: 10, label: '10% off base fare' },
};

const DEFAULT_EXTRAS = { insurance: false, coupon: null };

/** YTR-12951-7QX2 — train number plus a short unguessable suffix. */
function mintBookingRef(trainNumber) {
  const suffix = randomBytes(3).toString('hex').slice(0, 4).toUpperCase();
  return `YTR-${String(trainNumber).replace(/\D/g, '').slice(0, 5)}-${suffix}`;
}

const clean = (value, maxLength) => String(value ?? '').trim().slice(0, maxLength);

/**
 * The booking row, joined to the master data it now references.
 *
 * Migration 011 made 3NF delete `bookings.train_no`, `train_name`,
 * `origin_name`, `destination_name`, `origin_code` and `destination_code`. A
 * booking is now identified by `train_id`, `origin_station_id` and
 * `destination_station_id`, so a plain `SELECT *` no longer carries the train
 * number or the station codes the API shape needs.
 *
 * Defined once and aliased back to the original column names (`train_number`,
 * `origin_code`, …) so `serialise` keeps its shape and nothing downstream of the
 * API contract has to know the schema changed. Every reader of a booking row
 * goes through this, rather than each one re-deriving the join.
 *
 * LEFT JOIN on the stations and trains deliberately: a booking whose train has
 * been deactivated still has to render. The FKs are RESTRICT, so this cannot
 * actually happen for a hard delete, but the left join keeps a partial record
 * readable rather than dropping the row entirely.
 */
const BOOKING_PROJECTION = `
  SELECT
    b.*,
    t.train_number                AS train_number,
    t.train_name                  AS train_name,
    os.station_code               AS origin_code,
    os.station_name               AS origin_name,
    ds.station_code               AS destination_code,
    ds.station_name               AS destination_name
  FROM bookings b
  LEFT JOIN trains t      ON t.id  = b.train_id
  LEFT JOIN stations os   ON os.id = b.origin_station_id
  LEFT JOIN stations ds   ON ds.id = b.destination_station_id
`;

/** Row -> API shape. The one place the API's booking shape is defined. */
function serialise(row, extras = {}) {
  return {
    bookingId: row.booking_id !== undefined ? String(row.booking_id) : null,
    bookingRef: row.booking_ref,
    status: row.status,
    /**
     * Train and station fields now come from the joined master rows.
     *
     * Migration 011 removed `bookings.train_no`, `train_name`, `origin_name` and
     * `destination_name`: they were copies of `trains` and `stations`, and two
     * bookings already disagreed with `trains.train_name`. The API shape is
     * unchanged — the same values, read from one place.
     */
    train: {
      number: row.train_number ?? null,
      name: row.train_name ?? null,
      class: row.travel_class,
      coach: extras.coach ?? null,
      seat: extras.seat ?? null,
    },
    route: {
      from: row.origin_code ?? null,
      fromName: row.origin_name ?? null,
      to: row.destination_code ?? null,
      toName: row.destination_name ?? null,
    },
    segment: {
      fromStopSeq: row.from_stop_seq,
      toStopSeq: row.to_stop_seq,
      mask: String(row.segment_mask ?? 0),
      distanceKm: row.distance_km ?? null,
    },
    departureAt: row.departure_at,
    arrivalAt: row.arrival_at,
    passengers: extras.passengers ?? [],
    contact: { email: row.contact_email ?? null, phone: row.contact_phone ?? null },
    extras: extras.extras ?? row.extras ?? DEFAULT_EXTRAS,
    fare: row.total_amount !== undefined && row.total_amount !== null
      ? { amount: Number(row.total_amount), currency: row.currency }
      : undefined,
    holdExpiresAt: row.hold_expires_at,
    confirmedAt: row.confirmed_at,
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
    createdAt: row.created_at,
  };
}

/** Passengers as rows, in manifest order. */
function serialisePassengers(rows) {
  return (rows ?? []).map((p) => ({
    name: p.full_name,
    age: p.age,
    gender: p.gender,
    berthType: p.berth_type,
    coach: p.coach_code,
    seatNumber: p.seat_code,
  }));
}

/**
 * Record a booking and its manifest.
 *
 * Called only once the seats are held, so a failed claim never leaves a booking
 * claiming a berth nobody owns.
 *
 * @param {object} input
 * @param {string} [input.bookingRef] pre-minted; one is minted if absent
 * @param {number|null} [input.userId]
 * @param {{number: string, name?: string, class: string}} input.train
 * @param {{from: string, to: string, fromName?: string, toName?: string}} input.route
 * @param {object} input.segment  from holdSeats: { fromStation, toStation, fromStopSeq, toStopSeq, mask, distanceKm }
 * @param {Array<{name: string, age?: number|string, gender?: string}>} input.passengers
 * @param {Array<{coach: string, seatNumber: string, berthType: string}>} input.seats
 * @param {{email?: string, phone?: string}} [input.contact]
 * @param {{insurance?: boolean, coupon?: string|null}} [input.extras]
 * @param {number} input.amount paise, already priced
 * @param {Date|string} input.holdExpiresAt
 * @returns {Promise<object>} the stored booking, API-shaped
 */
async function createBooking({
  bookingRef,
  userId = null,
  train,
  route,
  segment,
  passengers,
  seats,
  contact,
  extras,
  amount,
  holdExpiresAt,
  departureAt,
  arrivalAt,
} = {}) {
  const trainNumber = String(train?.number ?? '').replace(/\D/g, '');
  if (trainNumber.length < 1 || trainNumber.length > 5) {
    throw badRequest('train.number is required.', 'train.number');
  }

  const travelClass = String(train?.class ?? '').trim().toUpperCase();
  const from = String(route?.from ?? segment?.fromStation ?? '').trim().toUpperCase();
  const to = String(route?.to ?? segment?.toStation ?? '').trim().toUpperCase();
  if (!from || !to) throw badRequest('route.from and route.to are required.', 'route');
  if (from === to) throw badRequest('Origin and destination must differ.', 'route');

  const pax = Array.isArray(passengers) ? passengers : [];
  if (pax.length < 1) throw badRequest('A booking needs at least one passenger.', 'passengers');
  if (pax.length > MAX_PASSENGERS) {
    throw badRequest(`A single booking cannot exceed ${MAX_PASSENGERS} passengers.`, 'passengers');
  }

  const seatsHeld = Array.isArray(seats) ? seats : [];
  if (seatsHeld.length !== pax.length) {
    throw badRequest('Each passenger needs their own berth.', 'seats');
  }

  const ref = bookingRef ?? mintBookingRef(trainNumber);
  const addOns = { ...DEFAULT_EXTRAS, ...(extras ?? {}) };

  /**
   * Resolve the train and both stations to their ids.
   *
   * 3NF: a booking now stores `train_id`, `origin_station_id` and
   * `destination_station_id` and nothing else. The train number and the station
   * codes are inputs, not stored facts — `resolveSegment` above has already
   * proved both stations are real stops on this train, so these lookups cannot
   * miss, and a miss is a hard error rather than a null that quietly produces a
   * booking with no journey.
   *
   * All three in one round trip rather than three, because this runs on the hot
   * path of every booking confirmation.
   *
   * `QueryTypes.SELECT` hands back the rows array directly, not
   * `[rows, metadata]`, so this must not be destructured.
   */
  const refs = await sequelize.query(
    `SELECT
       (SELECT t.id  FROM trains t   WHERE t.train_number = :n LIMIT 1) AS train_id,
       (SELECT s1.id FROM stations s1 WHERE s1.station_code = :fromCode LIMIT 1) AS origin_id,
       (SELECT s2.id FROM stations s2 WHERE s2.station_code = :toCode LIMIT 1) AS destination_id`,
    {
      replacements: { n: trainNumber, fromCode: from, toCode: to },
      type: QueryTypes.SELECT,
    },
  );

  const { train_id: trainId, origin_id: originId, destination_id: destinationId } = refs[0] ?? {};

  if (!trainId || !originId || !destinationId) {
    throw badRequest(
      `Could not resolve train ${trainNumber} (${from} to ${to}) against the railway master data.`,
      'train',
    );
  }

  const row = {
    booking_ref: ref,
    user_id: userId,
    status: 'HELD',
    train_id: trainId,
    travel_class: travelClass,
    origin_station_id: originId,
    destination_station_id: destinationId,
    from_stop_seq: segment?.fromStopSeq,
    to_stop_seq: segment?.toStopSeq,
    segment_mask: segment?.mask ?? 0,
    distance_km: segment?.distanceKm ?? null,
    departure_at: departureAt ?? null,
    arrival_at: arrivalAt ?? null,
    total_amount: amount ?? null,
    currency: 'INR',
    contact_email: contact?.email ? clean(contact.email, 160) : null,
    contact_phone: contact?.phone ? clean(contact.phone, 32) : null,
    extras: addOns,
    hold_expires_at: holdExpiresAt ?? null,
    // Stamped by MySQL, not by Node: `created_at` is DATETIME(3) and rejects an
    // ISO string with a `Z`, and the database clock is the one the sweeper and
    // the seat holds are compared against.
  };

  /**
   * Insert header, manifest and status history together.
   *
   * This used to be two statements plus a compensating DELETE in the catch,
   * because there was nothing worth a transaction: the header was cheap to
   * remove. There is now. `trg_bookings_status_log_ins` writes the opening
   * HELD row as part of the header INSERT, so the unit that has to hold
   * together is three rows across two tables, and "insert, fail, delete by
   * hand" is exactly the shape that leaves an orphan history row behind when
   * the delete itself fails.
   *
   * One transaction, so a failed manifest rolls back the header and its history
   * together and the reference is free for a clean retry.
   */
  await withStatusContext(
    { reason: 'booking_created', changedBy: userId ? `user:${userId}` : 'guest' },
    async (t) => {
    await sequelize.query(
      `INSERT INTO \`bookings\`
         (booking_ref, user_id, status, train_id, travel_class,
          origin_station_id, destination_station_id,
          from_stop_seq, to_stop_seq, segment_mask, distance_km,
          departure_at, arrival_at, total_amount, currency,
          contact_email, contact_phone, extras, hold_expires_at, created_at, updated_at)
       VALUES
         (:booking_ref, :user_id, :status, :train_id, :travel_class,
          :origin_station_id, :destination_station_id,
          :from_stop_seq, :to_stop_seq, :segment_mask, :distance_km,
          :departure_at, :arrival_at, :total_amount, :currency,
          :contact_email, :contact_phone, :extras, :hold_expires_at, NOW(3), NOW(3))`,
      { replacements: { ...row, extras: JSON.stringify(addOns) }, transaction: t },
    );

    const replacements = { ref };
    const args = [];
    pax.forEach((p, i) => {
      const seat = seatsHeld[i];
      args.push(
        clean(p?.name, 120),
        p?.age != null ? Number(p.age) : null,
        p?.gender ? clean(p.gender, 16) : null,
        seat?.berthType ? clean(seat.berthType, 24) : null,
        seat?.coach ?? null,
        seat?.seatNumber ?? null,
        i + 1,
      );
    });

    // Named placeholders per passenger, for the same reason as the seat-hold
    // insert: repeated tuples need distinct keys.
    const tuples = pax
      .map((_, i) => {
        const at = (n) => `p${i}_${n}`;
        replacements[at('name')] = args[i * 7];
        replacements[at('age')] = args[i * 7 + 1];
        replacements[at('gender')] = args[i * 7 + 2];
        replacements[at('berth')] = args[i * 7 + 3];
        replacements[at('coach')] = args[i * 7 + 4];
        replacements[at('seat')] = args[i * 7 + 5];
        replacements[at('pos')] = args[i * 7 + 6];
        return (
          `((SELECT booking_id FROM bookings WHERE booking_ref = :ref), :${at('name')}, :${at('age')}, ` +
          `:${at('gender')}, :${at('berth')}, :${at('coach')}, :${at('seat')}, :${at('pos')}, NOW(3), NOW(3))`
        );
      })
      .join(',\n           ');

    await sequelize.query(
      `INSERT INTO booking_passengers
         (booking_id, full_name, age, gender, berth_type, coach_code, seat_code, position, created_at, updated_at)
       VALUES ${tuples}`,
      { replacements, transaction: t },
    );

    // The opening HELD row in the history comes from trg_bookings_status_log_ins,
    // fired by the INSERT above -- same transaction, same fate.
    },
  );

  return getBookingByRef(ref);
}

/**
 * Resolve a booking by reference.
 *
 * @param {string} bookingRef
 * @returns {Promise<object>} the booking, API-shaped
 * @throws {HttpError} 404 when the reference is unknown
 */
async function resolveBooking(bookingRef) {
  const booking = await getBookingByRef(bookingRef);
  if (!booking) {
    throw notFound(`No booking found for reference "${bookingRef}".`);
  }
  return booking;
}

/**
 * The raw row, without the passenger join.
 *
 * `resolveBooking` for callers that want the persisted shape — the payment
 * controller pricing an order, for instance.
 */
async function findBookingRow(bookingRef) {
  const rows = await sequelize.query(
    `${BOOKING_PROJECTION} WHERE b.booking_ref = :ref`,
    { replacements: { ref: clean(bookingRef, 32) }, type: QueryTypes.SELECT },
  );
  return rows[0] ?? null;
}

/** A booking plus its manifest, API-shaped. Null when unknown. */
async function getBookingByRef(bookingRef) {
  const row = await findBookingRow(bookingRef);
  if (!row) return null;

  const passengers = await sequelize.query(
    'SELECT * FROM booking_passengers WHERE booking_id = :id ORDER BY position',
    { replacements: { id: row.booking_id }, type: QueryTypes.SELECT },
  );

  const seats = passengers.map((p) => `${p.coach_code}-${p.seat_code}`).filter((s) => !s.endsWith('null'));

  return serialise(row, {
    passengers: serialisePassengers(passengers),
    coach: passengers[0]?.coach_code ?? null,
    seat: seats.length ? seats.map((s) => s.split('-')[1]).join(',') : null,
  });
}

/**
 * Run a write that moves a booking's status, with the audit context the
 * trigger reads.
 *
 * `trg_bookings_status_log_ins` / `_upd` are the only writers of
 * `booking_status`. A trigger cannot take parameters, so the caller publishes
 * `reason`, `note` and `changed_by` in session variables and the trigger reads
 * them back.
 *
 * Session variables are per-connection and the pool hands out connections
 * arbitrarily, so a bare `SET` followed by an `UPDATE` can land on two different
 * connections -- the trigger then reads whatever the last user of that
 * connection left behind. The application's pool does not enable
 * `multipleStatements` (deliberately: that flag is only on the dedicated
 * connection `runSqlScript` uses, so the two statements cannot be batched into
 * one round trip), so the pinning is done with a transaction instead, which
 * holds one connection for the duration and makes the pair atomic besides.
 *
 * All three variables are always assigned, including to NULL. Leaving one unset
 * means inheriting a previous request's value off a pooled connection.
 *
 * @param {{reason?: string, note?: string, changedBy?: string}} context
 * @param {(t: object) => Promise<any>} write
 */
async function withStatusContext(context, write) {
  const { reason = null, note = null, changedBy = null } = context ?? {};
  return sequelize.transaction(async (t) => {
    await sequelize.query(
      'SET @booking_reason = :reason, @booking_note = :note, @booking_changed_by = :changedBy',
      { replacements: { reason, note, changedBy }, transaction: t },
    );
    return write(t);
  });
}

/**
 * Move a booking to a new status, refusing illegal transitions.
 *
 * The rules that matter:
 *   - a terminal booking never moves again
 *   - CONFIRMED is not reversible here; a paid booking is cancelled through the
 *     refund path, which is a different operation with different consequences
 *   - expiry only applies to HELD, because a confirmed booking's seats are sold
 *
 * @param {string} bookingRef
 * @param {string} status
 * @param {object} [options]
 * @returns {Promise<object>} the updated booking
 */
async function transition(bookingRef, status, { reason, note, changedBy, allowFrom } = {}) {
  const ref = clean(bookingRef, 32);
  const row = await findBookingRow(ref);
  if (!row) throw notFound(`No booking found for reference "${ref}".`);

  const from = row.status;

  /**
   * Settled bookings are terminal.
   *
   * Cancelled and expired are both outcomes something else decided, not states a
   * traveller can move back out of — a cancelled booking that came back to HELD
   * would let its stale berths be reclaimed while the berths themselves may
   * already be sold. Refusing the no-op repeat as well (cancelling twice) means a
   * double-clicked button gets an honest 409 rather than a second success.
   */
  if (TERMINAL.includes(from)) {
    throw conflict(
      `This booking is already ${from.toLowerCase()} and cannot change.`,
      'BOOKING_SETTLED',
    );
  }

  if (from === status) {
    throw conflict(`This booking is already ${status.toLowerCase()}.`, 'NO_CHANGE');
  }

  const permitted = allowFrom ?? ['HELD', 'CONFIRMED'];
  if (!permitted.includes(from)) {
    throw conflict(`A ${from} booking cannot become ${status}.`, 'INVALID_TRANSITION');
  }

  if (from === 'CONFIRMED' && status !== 'CANCELLED') {
    throw conflict(
      'This booking is already paid. Cancel it to reverse it — a paid booking is not editable.',
      'ALREADY_CONFIRMED',
    );
  }

  const sets = ['status = :status', 'updated_at = NOW(3)'];
  if (status === 'CONFIRMED') sets.push('confirmed_at = NOW(3)');
  if (status === 'CANCELLED') {
    sets.push('cancelled_at = NOW(3)', 'cancellation_reason = :reason');
  }

  await withStatusContext({ reason, note, changedBy }, (t) =>
    sequelize.query(`UPDATE bookings SET ${sets.join(', ')} WHERE booking_ref = :ref`, {
      replacements: { ref, status, reason: reason ?? null },
      transaction: t,
    }),
  );

  // The history row is written by trg_bookings_status_log_upd, in the same
  // statement as the status change and under the same transaction.
  return getBookingByRef(ref);
}

/**
 * Age out bookings whose payment window closed unpaid.
 *
 * Only HELD is touched: a confirmed booking's seats are sold regardless of how
 * long ago it was made, and a cancelled one is already settled.
 *
 * @returns {Promise<number>} how many were expired
 */
async function expireUnpaidBookings() {
  /**
   * `QueryTypes.UPDATE` is required, not incidental.
   *
   * An untyped `sequelize.query` returns `[results, metadata]`, where the second
   * element is an object — so `meta ?? 0` is that object, `expired > 0` is
   * `NaN > 0`, and the bookkeeping below silently never runs while the function
   * hands its caller an object where a count was promised. The typed form returns
   * `[null, affectedRows]`.
   */
  const [result, affectedRows] = await withStatusContext(
    { reason: 'hold_expired', changedBy: 'system' },
    (t) =>
      sequelize.query(
        `UPDATE bookings
            SET status = 'EXPIRED', updated_at = NOW(3)
          WHERE status = 'HELD'
            AND hold_expires_at IS NOT NULL
            AND hold_expires_at <= NOW(3)`,
        { type: QueryTypes.UPDATE, transaction: t },
      ),
  );

  /**
   * The history is no longer a loop.
   *
   * This used to re-read the expired bookings and write one status row each,
   * after the UPDATE had already committed -- so a crash mid-loop left bookings
   * marked EXPIRED with the log truncated partway, and the reason it was trying
   * to guarantee is the one thing missing. The trigger writes a row per changed
   * booking inside the UPDATE's own transaction, so the history is exactly as
   * durable as the state change it describes.
   *
   * The context is set once for the whole statement; the trigger reads the same
   * session variables on every row, which is why `hold_expired` / `system` was
   * already constant across the loop it replaces.
   */
  return affectedRows ?? 0;
}

/**
 * Refuse an operation on a booking that belongs to someone else.
 *
 * A booking with no `user_id` is unowned — the flow does not require an account —
 * and is left open, because refusing it would lock out every guest booking and
 * the reference is a 4-hex-character unguessable token in any case.
 */
async function assertOwnership(bookingRef, userId) {
  const row = await findBookingRow(bookingRef);
  if (!row) throw notFound(`No booking found for reference "${bookingRef}".`);
  if (row.user_id === null || row.user_id === undefined) return row;
  if (!userId || Number(userId) !== Number(row.user_id)) {
    throw forbidden('This booking belongs to another account.', 'NOT_YOUR_BOOKING');
  }
  return row;
}

/** A booking and its status history, oldest first. */
async function getStatusHistory(bookingRef) {
  const rows = await sequelize.query(
    `SELECT s.status, s.reason, s.note, s.changed_by AS changedBy, s.changed_at AS changedAt
       FROM booking_status s
       JOIN bookings b ON b.booking_id = s.booking_id
      WHERE b.booking_ref = :ref
      ORDER BY s.changed_at`,
    { replacements: { ref: clean(bookingRef, 32) }, type: QueryTypes.SELECT },
  );
  return rows;
}

/**
 * List bookings, newest first, filtered and paginated.
 *
 * @param {object} [params]
 * @param {number|null} [params.userId] restrict to one traveller
 * @param {string} [params.status]  'all' or one of the statuses
 * @param {number} [params.page=1]
 * @param {number} [params.pageSize=20]
 */
/**
 * List bookings, newest first.
 *
 * `userId` is a three-way switch, which is why it has no default:
 *   - a number  — only that traveller's bookings
 *   - `null`    — only guest bookings (nobody signed in)
 *   - `undefined` — no user filter at all
 *
 * That last case is the dangerous one and is why the distinction exists: it is
 * what lets the unauthenticated demo show something, and it is also what would
 * leak every traveller's booking if it were reachable by accident. Callers must
 * pass it deliberately. See `listBookings` in the controller for how auth maps
 * onto it.
 */
async function listBookings({ userId, status = 'all', page = 1, pageSize = 20 } = {}) {
  const limit = Math.min(Math.max(Number(pageSize) || 20, 1), 100);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

  const where = [];
  const replacements = { limit, offset };
  if (userId === null) {
    where.push('b.user_id IS NULL');
  } else if (userId !== undefined) {
    where.push('b.user_id = :userId');
    replacements.userId = userId;
  }
  if (status && status !== 'all') {
    where.push('b.status = :status');
    replacements.status = String(status).toUpperCase();
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await sequelize.query(
    `${BOOKING_PROJECTION} ${clause} ORDER BY b.created_at DESC LIMIT :limit OFFSET :offset`,
    { replacements, type: QueryTypes.SELECT },
  );
  // Counted against the bare table, not the joined projection: joining trains
  // and stations would fan the rows out and inflate the total.
  const counts = await sequelize.query(`SELECT COUNT(*) AS total FROM bookings b ${clause}`, {
    replacements,
    type: QueryTypes.SELECT,
  });

  /**
   * Attach the berth and the party size to each row in one extra query.
   *
   * `serialise` takes the coach and seat from the manifest, so without this a
   * listing shows `coach: null` next to a reference while `GET /bookings/:ref`
   * on the same row shows the seat — the same booking, two different answers.
   * One grouped query beats N per-row lookups, which is what doing this inside
   * `serialise` per item would cost.
   *
   * The party size comes along for free from the same rows, and a list that
   * cannot say how many people are on the booking is not much use.
   */
  const berthByBooking = new Map();
  const sizeByBooking = new Map();
  if (rows.length > 0) {
    const ids = rows.map((row) => row.booking_id);
    const passengers = await sequelize.query(
      `SELECT booking_id, coach_code, seat_code
         FROM booking_passengers
        WHERE booking_id IN (:ids)
        ORDER BY position`,
      { replacements: { ids }, type: QueryTypes.SELECT },
    );
    for (const p of passengers) {
      if (!berthByBooking.has(p.booking_id)) berthByBooking.set(p.booking_id, p);
      sizeByBooking.set(p.booking_id, (sizeByBooking.get(p.booking_id) ?? 0) + 1);
    }
  }

  return {
    items: rows.map((row) => {
      const seat = berthByBooking.get(row.booking_id);
      return {
        ...serialise(row, { coach: seat?.coach_code ?? null, seat: seat?.seat_code ?? null }),
        passengerCount: sizeByBooking.get(row.booking_id) ?? 0,
      };
    }),
    total: Number(counts[0].total),
    page: Math.max(Number(page) || 1, 1),
    pageSize: limit,
    totalPages: Math.max(1, Math.ceil(Number(counts[0].total) / limit)),
  };
}

/** Whether a class has a coach prefix for display. */
const prefixFor = (travelClass) => COACH_PREFIX[String(travelClass ?? '').toUpperCase()] ?? '';

/**
 * Attach the berths a hold actually claimed, and the hold deadline.
 *
 * Called after `holdSeats`. The booking row is written first because
 * `seat_holds.booking_ref` is a foreign key into it, which puts the seat
 * details and the deadline in a second write rather than in the INSERT.
 *
 * @param {string} bookingRef
 * @param {Array<{seatId: string, coach: string, seatNumber: string, berthType: string}>} seats
 * @param {string|Date} holdExpiresAt
 */
async function attachSeats(bookingRef, seats, holdExpiresAt) {
  const ref = clean(bookingRef, 32);
  const held = Array.isArray(seats) ? seats : [];

  /**
   * Matched by position, not by the berths the client asked for.
   *
   * The hold is the authority on which berths this booking actually got, and it
   * resolves them in the order they were claimed. Copying the client's request
   * into the manifest instead would put a seat on a passenger that the database
   * refused to give them.
   */
  for (let i = 0; i < held.length; i += 1) {
    await sequelize.query(
      `UPDATE booking_passengers
          SET coach_code = :coach, seat_code = :seat, berth_type = :berth
        WHERE booking_id = (SELECT booking_id FROM bookings WHERE booking_ref = :ref)
          AND position = :pos`,
      {
        replacements: {
          ref,
          pos: i + 1,
          coach: held[i].coach,
          seat: held[i].seatNumber,
          berth: held[i].berthType ? clean(held[i].berthType, 24) : null,
        },
      },
    );
  }

  if (holdExpiresAt) {
    /**
     * A Date, not the ISO string `holdSeats` returns.
     *
     * `hold_expires_at` is DATETIME(3), which MySQL refuses an ISO string from —
     * it will not take the `T` or the `Z`. Sequelize renders a Date using the
     * connection's timezone (+05:30), which is the convention every other
     * timestamp in this schema is written under.
     */
    const deadline = holdExpiresAt instanceof Date ? holdExpiresAt : new Date(holdExpiresAt);
    await sequelize.query(
      'UPDATE bookings SET hold_expires_at = :exp, updated_at = NOW(3) WHERE booking_ref = :ref',
      {
        replacements: {
          ref,
          exp: Number.isNaN(deadline.getTime()) ? null : deadline,
        },
      },
    );
  }
}

/**
 * Remove a booking and everything that hangs off it.
 *
 * Used when the hold or manifest fails after the row was written: CASCADE
 * takes the passengers and any partial holds, so the failure leaves neither a
 * booking nor an orphaned berth claim.
 *
 * @param {string} bookingRef
 */
async function discardBooking(bookingRef) {
  await sequelize.query('DELETE FROM bookings WHERE booking_ref = :ref', {
    replacements: { ref: clean(bookingRef, 32) },
  });
}

module.exports = {
  createBooking,
  attachSeats,
  discardBooking,
  resolveBooking,
  findBookingRow,
  getBookingByRef,
  listBookings,
  transition,
  expireUnpaidBookings,
  assertOwnership,
  getStatusHistory,
  serialise,
  serialisePassengers,
  mintBookingRef,
  prefixFor,
  COUPONS,
  CONVENIENCE_FEE,
  INSURANCE_PER_PERSON,
  DEFAULT_EXTRAS,
  MAX_PASSENGERS,
  env,
};