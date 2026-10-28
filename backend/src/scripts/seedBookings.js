'use strict'

/**
 * Booking seed — the two demo references the frontend and the payment tests use.
 *
 * `YTR-12951-7QX2` and `YTR-12951-7QX3` used to live in a `Map` inside
 * `services/payment/bookingService.js`, which meant they only existed in the
 * process that served the request — restart the server and the payment pages
 * 404'd on references the UI was still handing out. They are real rows here now.
 *
 * ## Why the rows are CONFIRMED
 *
 * These represent already-paid tickets: the payment tests create orders against
 * them and exercise capture, refund and history. Seeding them as HELD would mean
 * the sweeper could expire them mid-suite, and the refund case needs a captured
 * payment against a booking that stays put.
 *
 * ## Idempotency
 *
 * Upserts on `booking_ref`. Children are removed first, because
 * `booking_passengers` and `booking_status` have no natural key — there is no way
 * to upsert them without also guaranteeing the parent still matches.
 *
 * No seat holds are created. These bookings predate the hold model and are not
 * tied to a journey date the inventory knows about; inventing one would take
 * real berths off sale for a train nobody is travelling on.
 *
 *   node src/scripts/seedBookings.js
 */

require('dotenv').config()

const { close, sequelize } = require('../config/database')
const { QueryTypes } = require('sequelize')
const { resolveSegment, routeFor } = require('../services/seat/journeyService')
const { fareForBooking } = require('../services/payment/fareService')

const DEFAULT_EXTRAS = { insurance: false, coupon: null }

/**
 * The two demo references.
 *
 * The routes are taken from the live `train_routes` table rather than invented,
 * because `resolveSegment` below rejects a station the train does not actually
 * stop at. Train 12951 runs MMCT → ADI → NDLS.
 *
 * `7QX2` deliberately spans the **full** route. Fares are stored per train and
 * class for the whole run and pro-rated by distance at read time, so a partial
 * segment is charged proportionally less — which is correct for a real booking,
 * but it means a full-route booking is the one whose total is directly
 * comparable with `train_classes.base_fare`. Anything asserting on that figure
 * should use this row. `7QX3` takes a single segment, so the pair covers both the
 * one-bit and the two-bit mask.
 */
const SEED_BOOKINGS = [
  {
    bookingRef: 'YTR-12951-7QX2',
    status: 'CONFIRMED',
    train: { number: '12951', name: 'Mumbai Rajdhani', class: '3A', coach: 'B4' },
    /**
     * One seat per passenger, listed in manifest order.
     *
     * `booking_passengers` has `uq_booking_passengers_seat` on
     * (booking_id, coach_code, seat_code), because a berth holds exactly one
     * person. The in-memory demo this replaces listed both of `7QX3`'s
     * passengers on A2-14, which that constraint correctly refuses.
     */
    seats: ['27'],
    route: { from: 'MMCT', fromName: 'Mumbai Central', to: 'NDLS', toName: 'New Delhi' },
    departureAt: '2026-09-12 08:15:00',
    arrivalAt: '2026-09-12 21:40:00',
    passengers: [{ name: 'Arjun Mehta', age: 34, gender: 'male', berthType: 'WINDOW' }],
    contact: { email: 'arjun.mehta@example.com', phone: '+919000090000' },
  },
  {
    bookingRef: 'YTR-12951-7QX3',
    status: 'CONFIRMED',
    train: { number: '12951', name: 'Mumbai Rajdhani', class: '2A', coach: 'A2' },
    seats: ['14', '15'],
    route: { from: 'MMCT', fromName: 'Mumbai Central', to: 'ADI', toName: 'Ahmedabad Junction' },
    departureAt: '2026-09-13 16:55:00',
    arrivalAt: '2026-09-13 22:10:00',
    passengers: [
      { name: 'Arjun Mehta', age: 34, gender: 'male', berthType: 'WINDOW' },
      { name: 'Ira Mehta', age: 29, gender: 'female', berthType: 'AISLE' },
    ],
    contact: { email: 'arjun.mehta@example.com', phone: '+919000090000' },
  },
]

/**
 * Look up the numeric train id and the segment geometry.
 *
 * The demo rows carry `distanceKm` but the table stores `from_stop_seq`,
 * `to_stop_seq` and a segment mask, so the values are derived from the live
 * route rather than asserted here. If the route table ever loses these stops the
 * seed fails loudly instead of writing a row whose mask means nothing.
 */
/**
 * The segment geometry and train id, derived from the live route.
 *
 * Reuses `routeFor` + `resolveSegment` rather than querying `train_routes`
 * directly. Those are the same two functions the booking service uses, so a
 * seeded row cannot drift from what a real booking would have written — and the
 * mask comes back as the decimal string the bit arithmetic expects, not a
 * Number that would round past 2^53.
 */
async function resolveGeometry(booking) {
  const [train] = await sequelize.query('SELECT id FROM trains WHERE train_number = :n', {
    replacements: { n: booking.train.number },
    type: QueryTypes.SELECT,
  });
  if (!train) throw new Error(`Seed needs train ${booking.train.number}, which is not in the database.`);

  const segment = resolveSegment(await routeFor(booking.train.number), booking.route.from, booking.route.to);

  const originId = segment.from?.stationId ?? null;
  const destinationId = segment.to?.stationId ?? null;
  if (!originId || !destinationId) {
    throw new Error(`Could not resolve station ids for ${booking.route.from} → ${booking.route.to}.`);
  }

  return {
    trainId: train.id,
    originId,
    destinationId,
    fromStopSeq: segment.fromStopSeq,
    toStopSeq: segment.toStopSeq,
    segmentMask: segment.mask,
    distanceKm: segment.distanceKm,
  };
}

async function seedBookings() {
  const bookings = SEED_BOOKINGS;
  console.log(`Seeding ${bookings.length} demo booking(s)...\n`);

  for (const booking of bookings) {
    const geometry = await resolveGeometry(booking);

    /**
     * Price it the way a real booking is priced.
     *
     * These rows used to be inserted with `total_amount = 0`, so every list and
     * ticket built from them displayed a fare of ₹0 while looking otherwise
     * perfectly normal. Going through `fareForBooking` means the seed and a live
     * booking can never disagree about what the journey costs.
     */
    const fare = await fareForBooking(
      {
        train: { number: booking.train.number, name: booking.train.name, class: booking.train.class },
        passengers: booking.passengers,
        segment: { ...geometry, from: null, to: null },
      },
      DEFAULT_EXTRAS,
    );

    await sequelize.query('DELETE FROM booking_status WHERE booking_id IN (SELECT booking_id FROM bookings WHERE booking_ref = :ref)', {
      replacements: { ref: booking.bookingRef },
    });
    await sequelize.query('DELETE FROM booking_passengers WHERE booking_id IN (SELECT booking_id FROM bookings WHERE booking_ref = :ref)', {
      replacements: { ref: booking.bookingRef },
    });

    await sequelize.query(
      `INSERT INTO \`bookings\`
         (booking_ref, user_id, status, train_id, travel_class,
          origin_station_id, destination_station_id,
          from_stop_seq, to_stop_seq, segment_mask, distance_km,
          departure_at, arrival_at, total_amount, currency,
          contact_email, contact_phone, extras, hold_expires_at, created_at, updated_at)
       VALUES
         (:ref, NULL, :status, :trainId, :travelClass,
          :originId, :destinationId,
          :fromStopSeq, :toStopSeq, :segmentMask, :distanceKm,
          :departureAt, :arrivalAt, :amount, 'INR',
          :email, :phone, :extras, NULL, NOW(3), NOW(3))
       ON DUPLICATE KEY UPDATE
         status = VALUES(status),
         travel_class = VALUES(travel_class),
         from_stop_seq = VALUES(from_stop_seq),
         to_stop_seq = VALUES(to_stop_seq),
         segment_mask = VALUES(segment_mask),
         distance_km = VALUES(distance_km),
         total_amount = VALUES(total_amount),
         departure_at = VALUES(departure_at),
         arrival_at = VALUES(arrival_at),
         contact_email = VALUES(contact_email),
         contact_phone = VALUES(contact_phone),
         extras = VALUES(extras),
         updated_at = NOW(3)`,
      {
        replacements: {
          ref: booking.bookingRef,
          status: booking.status,
          trainId: geometry.trainId,
          travelClass: booking.train.class,
          originId: geometry.originId,
          destinationId: geometry.destinationId,
          fromStopSeq: geometry.fromStopSeq,
          toStopSeq: geometry.toStopSeq,
          segmentMask: geometry.segmentMask,
          distanceKm: geometry.distanceKm,
          departureAt: booking.departureAt,
          arrivalAt: booking.arrivalAt,
          amount: fare.amount,
          email: booking.contact.email,
          phone: booking.contact.phone,
          extras: JSON.stringify(DEFAULT_EXTRAS),
        },
      },
    );

    /**
     * A loop rather than a fixed pair of inserts.
     *
     * The seeded bookings hold one passenger and two passengers respectively, so
     * indexing `passengers[1]` on the first one yields `undefined` and spreads to
     * nothing — which then fails the NOT NULL on `full_name` and takes the whole
     * seed down. Iterating cannot have that problem.
     */
    for (const [position, passenger] of booking.passengers.entries()) {
      await sequelize.query(
        `INSERT INTO booking_passengers (booking_id, full_name, age, gender, berth_type, coach_code, seat_code, position, created_at, updated_at)
         SELECT booking_id, :name, :age, :gender, :berth, :coach, :seat, :position, NOW(3), NOW(3)
           FROM bookings WHERE booking_ref = :ref`,
        {
          replacements: {
            ref: booking.bookingRef,
            name: passenger.name,
            age: passenger.age,
            gender: passenger.gender,
            berth: passenger.berthType,
            coach: booking.train.coach,
            seat: booking.seats[position],
            position,
          },
        },
      );
    }

    // `changed_at`, not `created_at` — this is an append-only log of transitions,
    // so the timestamp names when the status changed rather than when the row
    // was written.
    await sequelize.query(
      `INSERT INTO booking_status (booking_id, status, reason, changed_by, changed_at)
       SELECT booking_id, :status, 'seeded', 'seed', NOW(3) FROM bookings WHERE booking_ref = :ref`,
      { replacements: { ref: booking.bookingRef, status: booking.status } },
    );

    console.log(
      `  ${booking.bookingRef}  ${booking.train.number} ${booking.train.class}  ` +
        `${booking.route.from}→${booking.route.to}  ` +
        `${geometry.distanceKm}km  mask ${geometry.segmentMask}  Rs${(fare.amount / 100).toFixed(2)}  ${booking.status}`,
    );
  }

  console.log('\nBooking seed complete.');
  return bookings.map((b) => b.bookingRef);
}

if (require.main === module) {
  seedBookings()
    .then(async () => {
      await close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Booking seed failed:', err);
      await close();
      process.exit(1);
    });
}

module.exports = { seedBookings, SEED_BOOKINGS };
