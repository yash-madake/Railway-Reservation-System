'use strict'

/**
 * Fare calculation — the server's authoritative amount.
 *
 * This is the boundary that stops the "tampered amount" attack. The browser
 * never sends an amount; it sends a booking reference, and the charge is
 * derived here from the database's own price list. Any `amount` in the request
 * body is ignored, and `createOrder` rejects the request outright if one is
 * present, so a caller who expects to be believed gets a loud failure rather
 * than a silently discounted charge.
 *
 * ## The price comes from `train_classes.base_fare`
 *
 * Not from a table in this file. That is the whole point: the search and
 * train-detail screens quote `base_fare`, so charging anything else meant the
 * fare could change between seeing it and paying it. See fareLookup.js for the
 * scale that discrepancy had reached.
 *
 * Every figure is in paise — Razorpay's smallest currency unit. Storing or
 * sending rupees introduces a 100x error.
 */

const { COUPONS, CONVENIENCE_FEE, INSURANCE_PER_PERSON } = require('./bookingService')
const { segmentFare, lookupRate, TAX_RATE } = require('./fareLookup')
const { badRequest } = require('../../utils/errors')

const MAX_PASSENGERS = 6

/**
 * "18%" in a customer-facing breakdown.
 *
 * Derived from TAX_RATE rather than written into the string, because a label that
 * says one thing while the arithmetic does another is precisely the class of bug
 * that let the fare drift in the first place. Change the rate and the label
 * follows.
 */
const TAX_LABEL = `${Math.round(TAX_RATE * 100)}%`

/**
 * @param {object} booking from bookingService.resolveBooking()
 * @param {{insurance?: boolean, coupon?: string|null}} extras optional add-ons
 * @returns {Promise<{currency: string, amount: number, total: number, breakdown: object[]}>}
 */
async function calculateFare(booking, extras = {}) {
  const passengers = booking.passengers?.length ?? 0
  if (passengers < 1) throw badRequest('A booking needs at least one passenger.', 'passengers')
  if (passengers > MAX_PASSENGERS) {
    throw badRequest(`A single booking cannot exceed ${MAX_PASSENGERS} passengers.`, 'passengers')
  }

  /**
   * The fare for the *segment* this booking covers, not for the whole train.
   *
   * `booking.segment.distanceKm` is set by the booking controller from the
   * resolved origin/destination pair. A booking that somehow has no segment — an
   * older record, or the seeded demo references — is priced for the full route,
   * which is the same figure the search screen advertised.
   */
  const distanceKm = booking.segment?.distanceKm
  const isFullRoute = !Number.isFinite(distanceKm)

  const rate = isFullRoute
    ? await lookupFullRoute(booking)
    : await segmentFare({
        trainNo: booking.train.number,
        travelClass: booking.train.class,
        distanceKm,
      })

  const base = rate.segmentBasePaise * passengers

  /**
   * Tax: one calculation, on the total base fare.
   *
   * Not `rate.taxesPaise * passengers`. That is not the same number — it rounds
   * once per passenger and then multiplies, whereas this rounds once at the end.
   * They diverge whenever rounding the per-passenger figure lands the wrong way:
   * for a base fare of Rs 12.53 with two passengers, round(1253 * 0.18) * 2 is
   * 452 paise but round(2506 * 0.18) is 451.
   */
  const taxes = Math.round(base * TAX_RATE)

  const convenienceFee = CONVENIENCE_FEE

  const insurance = extras.insurance ? INSURANCE_PER_PERSON * passengers : 0

  let discount = 0
  let couponLabel = null
  const couponCode = extras.coupon ? String(extras.coupon).trim().toUpperCase() : null
  if (couponCode) {
    const coupon = COUPONS[couponCode]
    if (!coupon) throw badRequest(`"${couponCode}" is not a valid coupon code.`, 'coupon')
    discount = Math.round((base * coupon.percentOffBase) / 100)
    couponLabel = `${couponCode} — ${coupon.label}`
  }

  const total = Math.max(0, base + taxes + convenienceFee + insurance - discount)

  const distanceLabel = isFullRoute
    ? 'full route'
    : `${rate.distanceKm.toLocaleString('en-IN')} km`

  const breakdown = [
    {
      key: 'base',
      label: `Base fare (${booking.train.class}, ${distanceLabel}) × ${passengers}`,
      amount: base,
      // Per-passenger figure, so the traveller can reconcile the line against
      // the fare they were quoted on the train page.
      perPassenger: rate.segmentBasePaise,
    },
    // One line for the whole booking, not one per passenger: the tax is levied
    // once on the total base fare, so showing it as "x 2" would describe a
    // calculation that does not happen.
    {
      key: 'taxes',
      label: `Taxes & surcharges (${TAX_LABEL} on the total fare)`,
      amount: taxes,
    },
    {
      key: 'convenienceFee',
      label: `Convenience fee (₹${CONVENIENCE_FEE / 100} per booking)`,
      amount: convenienceFee,
    },
  ]
  if (insurance > 0) breakdown.push({ key: 'insurance', label: 'Travel insurance', amount: insurance })
  if (discount > 0) breakdown.push({ key: 'discount', label: couponLabel, amount: -discount, tone: 'discount' })

  return {
    currency: 'INR',
    amount: total,
    total,
    breakdown,
    passengers,
    couponApplied: Boolean(couponLabel),
    /**
     * Whether this is the fare the search screen advertised. `false` means the
     * traveller is booking part of a route, which is the expected case for a
     * mid-train boarding and not a warning in itself.
     */
    isFullRoute: isFullRoute || rate.isFullRoute,
    distanceKm: isFullRoute ? rate.fullRouteKm : rate.distanceKm,
  }
}

/** Price a booking with no recorded segment at the full route. */
async function lookupFullRoute(booking) {
  const rate = await lookupRate({
    trainNo: booking.train.number,
    travelClass: booking.train.class,
  })
  return {
    ...rate,
    segmentBasePaise: rate.baseFarePaise,
    segmentTaxesPaise: rate.taxesPaise,
    distanceKm: rate.fullRouteKm,
    isFullRoute: true,
  }
}

/**
 * The fare this booking will be charged, priced once and remembered.
 *
 * Why a snapshot rather than recomputing at payment time: the traveller reviews
 * a number on the review screen and then pays whatever `/payments/create-order`
 * returns. Recomputing means an admin editing a fare between those two moments
 * changes the amount after it has been agreed. Pricing at booking confirmation
 * makes the reviewed figure and the charged figure the same figure by
 * construction.
 *
 * Falls back to pricing on demand for bookings that predate the snapshot — the
 * seeded demo references, which were created before this existed.
 *
 * @param {object} booking a record from resolveBooking, mutated with the snapshot
 * @param {{insurance?: boolean, coupon?: string|null}} extras
 * @returns {Promise<object>} the fare
 */
async function fareForBooking(booking, extras = {}) {
  const couponCode = extras.coupon ? String(extras.coupon).trim().toUpperCase() : null
  const snapshotKey = `${Boolean(extras.insurance) ? 'i' : ''}${couponCode ?? ''}`

  if (booking.fareSnapshot && booking.fareSnapshot.key === snapshotKey) {
    return booking.fareSnapshot.fare
  }

  const fare = await calculateFare(booking, extras)

  booking.fareSnapshot = { key: snapshotKey, computedAt: new Date().toISOString(), fare }
  return fare
}

/**
 * Reject a request that carries an amount.
 *
 * Returning 400 rather than quietly discarding the field means a caller who
 * believes the browser sets the price finds out immediately, instead of
 * debugging a mismatch later.
 */
function assertNoClientAmount(body = {}) {
  const supplied = ['amount', 'total', 'fare', 'payableAmount'].filter((k) => body[k] !== undefined)
  if (supplied.length) {
    throw badRequest(
      `Amount is computed server-side and must not be supplied by the client. Ignored field(s): ${supplied.join(', ')}.`,
      supplied[0],
    )
  }
}

module.exports = { calculateFare, fareForBooking, assertNoClientAmount, MAX_PASSENGERS }