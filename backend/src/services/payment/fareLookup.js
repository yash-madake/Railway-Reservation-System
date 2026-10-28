'use strict'

/**
 * Fare lookup — the price list, read from the database.
 *
 * ## Why the fare varies by distance
 *
 * A berth costs less for one stop than for the whole train. The database holds
 * `base_fare` for the **full route**, and a booking covers a *segment* of it, so
 * the rate is derived rather than stored:
 *
 *   rate_per_km = base_fare_paise / full_route_km
 *   fare        = round(segment_km × rate_per_km)
 *
 * A whole-route booking therefore costs exactly the advertised `base_fare`, and
 * a sub-route is a true pro-rata share of it. Nothing else in the product has to
 * know that pro-rating exists.
 *
 * The rate has to be per *(train, class)*, not per class: implied per-km rates
 * across the seeded data span Rs 0.24 (2S on the 11077) to Rs 3.50 (1A on the
 * 12951) — a fourteenfold spread that a single class-only table could not hold.
 *
 * ## Why this used to be wrong
 *
 * The amount charged used to come from a hardcoded `CLASS_RATES` table in
 * bookingService.js while the search screens quoted `train_classes.base_fare`,
 * and the two disagreed by up to 8x — advertised Rs 2,150, charged Rs 265. See
 * PAYMENTS.md §12.9.
 *
 * ## Units
 *
 * `base_fare` is `DECIMAL(10,2)` in **rupees**. Everything downstream is **paise**,
 * because that is what Razorpay takes. The conversion happens once, in
 * `toPaise`.
 */

const { QueryTypes } = require('sequelize')

const { sequelize } = require('../../config/database')
const env = require('../../config/env')
const { badRequest } = require('../../utils/errors')

/**
 * Rupees to paise, exactly.
 *
 * Math.round rather than a bare multiply: a fare like Rs 1120.55 arrives as
 * 112054.99999999999 and would truncate to 112054 paise, one paisa short.
 */
const toPaise = (rupees) => Math.round(Number(rupees) * 100)

/**
 * Tax, as a share of the base fare — GST at 18%.
 *
 * The database holds a base fare and nothing else, so the surcharge split is
 * still a Yatrio rule rather than a stored one. It sits here, beside the lookup,
 * so the whole price is derived in one place.
 *
 * Applied to the base fare only, not to the convenience fee or to insurance.
 * Real GST has taxable components and slabs; this is a simplification, and it is
 * stated here rather than left for someone to discover on an invoice.
 */
const TAX_RATE = 0.18

/**
 * Read the base fare and the route length for one train and class.
 *
 * @param {{trainNo: string|number, travelClass: string}} input
 * @returns {Promise<{baseFare: number, baseFarePaise: number, taxesPaise: number,
 *                    fullRouteKm: number, ratePerKmPaise: number, availableSeats: number|null}>}
 * @throws {HttpError} 404 when the train does not offer that class
 */
async function lookupRate({ trainNo, travelClass } = {}) {
  const number = String(trainNo ?? '').replace(/\D/g, '');
  const cls = String(travelClass ?? '').trim().toUpperCase();

  if (!number) throw badRequest('A train number is required to price a booking.', 'train.number');
  if (!cls) throw badRequest('A travel class is required to price a booking.', 'train.class');

  const rows = await sequelize.query(
    `SELECT tc.base_fare AS baseFare, tc.available_seats AS availableSeats,
            (SELECT MAX(tr.distance_km) FROM train_routes tr WHERE tr.train_id = t.id) AS fullRouteKm
       FROM train_classes tc
       JOIN trains t ON t.id = tc.train_id
      WHERE t.train_number = :number
        AND tc.class_code = :cls
      LIMIT 1`,
    { replacements: { number, cls }, type: QueryTypes.SELECT },
  );

  if (rows.length === 0) {
    throw badRequest(`Train ${number} does not offer class ${cls}.`, 'train.class');
  }

  const { baseFare, availableSeats, fullRouteKm } = rows[0];
  const baseFarePaise = toPaise(baseFare);
  const km = Number(fullRouteKm) || 0;

  return {
    baseFare: Number(baseFare),
    baseFarePaise,
    // Rounded once, here, so every consumer sees the same surcharge figure.
    taxesPaise: Math.round(baseFarePaise * TAX_RATE),
    fullRouteKm: km,
    // Carried as a float, not a pre-rounded integer: rounding the rate and then
    // multiplying would compound the error across the distance.
    ratePerKmPaise: km > 0 ? baseFarePaise / km : 0,
    availableSeats: availableSeats ?? null,
  };
}

/**
 * The fare for one segment of a train.
 *
 * Rounded once, at the end. Truncating the rate per kilometre and then
 * multiplying is the same mistake as taxing per passenger and multiplying: the
 * answer has to be rounded from the thing actually being charged.
 *
 * A whole-route booking returns exactly `base_fare` by construction — the
 * distance is the full distance — which is what keeps the price on the search
 * page and the price at checkout the same number.
 *
 * @param {{trainNo: string|number, travelClass: string, distanceKm: number}} input
 * @returns {Promise<object>} the rate, plus the segment figures
 */
async function segmentFare({ trainNo, travelClass, distanceKm } = {}) {
  const rate = await lookupRate({ trainNo, travelClass });
  const km = Number(distanceKm);

  if (!Number.isFinite(km) || km < 0) {
    throw badRequest('A booking distance is required.', 'route');
  }

  const basePaise = Math.round(km * rate.ratePerKmPaise);

  return {
    ...rate,
    distanceKm: km,
    segmentBasePaise: basePaise,
    segmentTaxesPaise: Math.round(basePaise * TAX_RATE),
    /**
     * True when the booking covers the whole route, i.e. the traveller is being
     * charged exactly the fare the search screen advertised. Worth surfacing so
     * a mismatch has somewhere obvious to be looked for.
     */
    isFullRoute: rate.fullRouteKm > 0 && Math.round(km) === rate.fullRouteKm,
  };
}

/**
 * The whole fare list, for the admin and any screen that shows prices without a
 * specific booking.
 *
 * Not cached: `train_classes` is a couple of dozen rows of master data that
 * changes when an admin edits a fare, and a stale price list is exactly the bug
 * this module was written to eliminate.
 */
async function listFares() {
  return sequelize.query(
    `SELECT t.train_number AS trainNumber, tc.class_code AS travelClass,
            tc.base_fare AS baseFare,
            (SELECT MAX(tr.distance_km) FROM train_routes tr WHERE tr.train_id = t.id) AS fullRouteKm
       FROM train_classes tc
       JOIN trains t ON t.id = tc.train_id
      ORDER BY t.train_number, tc.class_code`,
    { type: QueryTypes.SELECT },
  );
}

module.exports = { lookupRate, segmentFare, listFares, toPaise, TAX_RATE }