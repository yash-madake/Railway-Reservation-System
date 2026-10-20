'use strict'

/**
 * Booking lookup — Team 5's view of a booking.
 *
 * In production this is Team 4's booking service. Team 5 must never receive a
 * fare from the browser: it asks this module what a booking costs and uses
 * that figure, so a tampered client payload cannot change what is charged.
 * (Team assignment, Team 5 *Backend*: "Never trust amount/status directly
 * from the client.")
 *
 * The seed below mirrors Frontend/src/data/demoBooking.js so the two agree
 * during integration. Replace `resolveBooking` with a call to Team 4's API when
 * it lands; nothing else in the payment flow changes.
 *
 * ── Integration stand-in ────────────────────────────────────────────────────
 * Payment is addressed by booking reference, but the booking flow in the
 * frontend produces no reference of its own, so there was nothing for
 * `resolveBooking` to look up and the whole payment stage was unreachable.
 * `createBooking` closes that gap at the seam rather than beside it: it records
 * the booking server-side and mints the reference, so by the time
 * `create-order` resolves one, it is reading a server-held record.
 *
 * It is a stand-in, not the final contract, and one boundary is deliberately
 * left open: the travel class comes from the caller, because there is no
 * server-side booking authority yet to validate it against. The *price* is not
 * left open — it is read from `train_classes.base_fare` by fareLookup.js, the
 * same row the search screens quote from, so a caller cannot name a cheaper
 * class to pay less. What is still missing is the check that this class was
 * actually available on this journey; Team 4's real booking service closes that,
 * because it owns seat availability and is the only party that can say which
 * class a PNR is genuinely booked in.
 */

const { randomBytes } = require('node:crypto')
const { notFound, badRequest } = require('../../utils/errors')

/**
 * Class codes, for shape validation only.
 *
 * Deliberately NOT a price list. The amount charged comes from
 * `train_classes.base_fare` (fareLookup.js), which is the same table the search
 * and train-detail screens quote. The two used to disagree by up to 8x — see
 * fareLookup.js for the table — because the price lived in this file and the
 * advertisement lived in the database.
 *
 * Kept here so an obviously malformed code is rejected with a 400 before any
 * query runs; the real "does this train offer this class" check belongs to the
 * database.
 */
const TRAVEL_CLASS_CODES = new Set(['1A', '2A', '3A', 'EC', 'CC', 'SL', '2S'])

const CONVENIENCE_FEE = 1000 // ₹10 platform charge, per booking (not per passenger)
const INSURANCE_PER_PERSON = 45 // ₹0.45
const COUPONS = {
  YATRIO10: { percentOffBase: 10, label: '10% off base fare' },
}

/** Optional add-ons a booking may carry. Applied server-side. */
const DEFAULT_EXTRAS = { insurance: false, coupon: null }

const MAX_PASSENGERS = 6

const SEED_BOOKINGS = {
  'YTR-12951-7QX2': {
    bookingRef: 'YTR-12951-7QX2',
    status: 'CONFIRMED',
    availabilityCode: 'AVAILABLE-0460',
    train: { number: '12951', name: 'Rajdhani', class: '3A', coach: 'B4', seat: '27' },
    route: { from: 'NDLS', fromName: 'New Delhi', to: 'MTJ', toName: 'Mathura Junction', distanceKm: 159 },
    departureAt: '2026-09-12T16:55:00+05:30',
    arrivalAt: '2026-09-12T19:35:00+05:30',
    passengers: [
      { id: 'p1', name: 'Arjun Mehta', age: 34, gender: 'male', berth: 'window' },
    ],
    contact: { email: 'arjun.mehta@example.com', phone: '+919000090000' },
    extras: DEFAULT_EXTRAS,
  },
  'YTR-12951-7QX3': {
    bookingRef: 'YTR-12951-7QX3',
    status: 'CONFIRMED',
    availabilityCode: 'AVAILABLE-0117',
    train: { number: '12951', name: 'Rajdhani', class: '2A', coach: 'A2', seat: '14' },
    route: { from: 'NDLS', fromName: 'New Delhi', to: 'MTJ', toName: 'Mathura Junction', distanceKm: 159 },
    departureAt: '2026-09-13T08:15:00+05:30',
    arrivalAt: '2026-09-13T10:55:00+05:30',
    passengers: [
      { id: 'p1', name: 'Arjun Mehta', age: 34, gender: 'male', berth: 'window' },
      { id: 'p2', name: 'Ira Mehta', age: 29, gender: 'female', berth: 'aisle' },
    ],
    contact: { email: 'arjun.mehta@example.com', phone: '+919000090000' },
    extras: DEFAULT_EXTRAS,
  },
}

/**
 * Server-held booking records, keyed by reference.
 *
 * Seeded from SEED_BOOKINGS so the two demo references keep resolving, then
 * extended at runtime by `createBooking`. Swapping this for Team 4's service is
 * a one-function change: `resolveBooking` is the only reader.
 */
const REGISTRY = new Map(Object.entries(SEED_BOOKINGS))

/** YTR-12951-7QX2 — train number plus a short unguessable suffix. */
function mintBookingRef(trainNumber) {
  const suffix = randomBytes(3).toString('hex').slice(0, 4).toUpperCase()
  return `YTR-${String(trainNumber).replace(/\D/g, '').slice(0, 5)}-${suffix}`
}

/**
 * Record a booking and mint its reference.
 *
 * This is the integration stand-in described at the top of this file — it
 * exists so the payment stage has a real reference to resolve, and it is
 * replaced wholesale by Team 4's booking service.
 *
 * `input.bookingRef` lets the caller supply a reference it has already minted.
 * The booking controller does exactly that, because seat holds have to be tagged
 * with a reference *before* this runs — the hold is the thing that can fail, and
 * minting the reference is pure. Without this parameter the two would have to
 * happen in the other order, which would leave an orphan booking in the registry
 * every time a seat turned out to be taken.
 *
 * @param {object} input
 * @param {string} [input.bookingRef]   pre-minted reference; one is minted if absent
 * @param {{number: string|number, name?: string, class: string}} input.train
 * @param {{from: string, to: string, fromName?: string, toName?: string}} input.route
 * @param {Array<{name: string, age?: number|string, gender?: string}>} input.passengers
 * @param {{email?: string, phone?: string}} [input.contact]
 * @param {{insurance?: boolean, coupon?: string|null}} [input.extras]
 * @returns {object} the booking, not yet in the registry
 */
function buildBooking(input = {}) {
  const train = input.train ?? {}
  const route = input.route ?? {}
  const contact = input.contact ?? {}
  const extras = input.extras ?? {}

  const trainNumber = String(train.number ?? '').replace(/\D/g, '')
  if (trainNumber.length < 1 || trainNumber.length > 5) {
    throw badRequest('train.number is required.', 'train.number')
  }

  const travelClass = String(train.class ?? '').trim().toUpperCase()
  // Shape only. Whether the class is actually offered — and what it costs — is
  // answered by `train_classes` via fareLookup.lookupRate, which is the same
  // source the search screens quote from. Checking against a second list here is
  // how the two drifted apart in the first place.
  if (!TRAVEL_CLASS_CODES.has(travelClass)) {
    throw badRequest(`"${train.class}" is not a travel class code.`, 'train.class')
  }

  const from = String(route.from ?? '').trim().toUpperCase()
  const to = String(route.to ?? '').trim().toUpperCase()
  if (!from || !to) throw badRequest('route.from and route.to are required.', 'route')
  if (from === to) throw badRequest('Origin and destination must differ.', 'route')

  const passengers = Array.isArray(input.passengers) ? input.passengers : []
  if (passengers.length < 1) throw badRequest('A booking needs at least one passenger.', 'passengers')
  if (passengers.length > MAX_PASSENGERS) {
    throw badRequest(`A single booking cannot exceed ${MAX_PASSENGERS} passengers.`, 'passengers')
  }

  // A caller that already minted a reference (the booking controller, which
  // has to tag seat holds before getting here) supplies it; everyone else gets a
  // fresh one. Collision handling is unchanged — REGISTRY.set overwrites, which
  // is why the reference is only minted once, never re-minted on retry.
  const bookingRef = input.bookingRef ?? mintBookingRef(trainNumber)
  const now = new Date().toISOString()

  const booking = {
    bookingRef,
    status: 'CONFIRMED',
    train: {
      number: trainNumber,
      name: String(train.name ?? `Train ${trainNumber}`).slice(0, 80),
      class: travelClass,
      coach: train.coach ? String(train.coach).slice(0, 8) : null,
      seat: train.seat ? String(train.seat).slice(0, 8) : null,
    },
    route: {
      from,
      fromName: String(route.fromName ?? from).slice(0, 80),
      to,
      toName: String(route.toName ?? to).slice(0, 80),
    },
    departureAt: input.departureAt ?? now,
    arrivalAt: input.arrivalAt ?? now,
    passengers: passengers.map((p, i) => ({
      id: p?.id ?? `p${i + 1}`,
      name: String(p?.name ?? '').slice(0, 120),
      age: p?.age != null ? Number(p.age) : null,
      gender: p?.gender ?? null,
      berth: p?.berth ?? null,
    })),
    contact: {
      email: contact.email ? String(contact.email).slice(0, 160) : null,
      phone: contact.phone ? String(contact.phone).slice(0, 32) : null,
    },
    extras: {
      insurance: Boolean(extras.insurance),
      coupon: extras.coupon ? String(extras.coupon).trim().toUpperCase() : null,
    },
    createdAt: now,
  }

  return booking
}

function createBooking(input = {}) {
  return registerBooking(buildBooking(input))
}

/**
 * Put a booking built by `buildBooking` into the registry.
 *
 * @param {object} booking
 * @returns {object} the same booking
 */
function registerBooking(booking) {
  REGISTRY.set(booking.bookingRef, booking)
  return booking
}

/**
 * Resolve a booking by reference.
 *
 * @param {string} bookingRef
 * @throws {HttpError} 404 when the booking is unknown
 */
function resolveBooking(bookingRef) {
  const booking = REGISTRY.get(bookingRef)
  if (!booking) {
    throw notFound(`No booking found for reference "${bookingRef}".`)
  }
  return booking
}

/** Every booking the flow can be entered for — used by the frontend demo. */
const listBookings = () => [...REGISTRY.values()]

const isKnownBooking = (bookingRef) => REGISTRY.has(bookingRef)

module.exports = {
  resolveBooking,
  createBooking,
  buildBooking,
  registerBooking,
  listBookings,
  isKnownBooking,
  /** Exposed so a caller can mint the reference before doing fallible work. */
  mintBookingRef,
  TRAVEL_CLASS_CODES,
  COUPONS,
  CONVENIENCE_FEE,
  INSURANCE_PER_PERSON,
  MAX_PASSENGERS,
}