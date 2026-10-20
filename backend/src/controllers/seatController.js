'use strict'

/**
 * Seat availability — what the seat map draws.
 *
 * ## Why this returns masks rather than "taken / free"
 *
 * A berth can be sold several times on one train. Someone holds it NDLS→JHS and
 * another holds it JHS→BPL, and it is genuinely available to a third traveller
 * boarding at JHS. Collapsing that to a boolean would throw away the only
 * information the seat map needs, and the seat map is where the decision gets
 * made.
 *
 * So each seat carries its `segmentMask` — which segments are spoken for — and
 * the client intersects that with the mask of *its own* journey to decide
 * whether that berth is sellable to it.
 *
 * ## Derived, not stored
 *
 * Availability is counted from the masks rather than read from
 * `train_classes.available_seats`, which is a static seed number that has never
 * tracked a booking (PAYMENTS.md §14).
 */

const { journeyAvailability } = require('../services/seat/holdService')
const { routeFor, resolveSegment, maskFor, parseDate } = require('../services/seat/journeyService')
const env = require('../config/env')

/**
 * GET /seats/availability?trainNo=12951&class=3A&date=2026-10-15&from=NDLS&to=BPL
 *
 * `from`/`to` are optional. Given, the response carries the mask of that
 * specific journey so the client can test each seat against it without doing the
 * bit arithmetic itself. Omitted, the response still returns every seat's mask and
 * the segment count, which is enough to draw the whole train.
 */
async function getAvailability(req, res) {
  const { trainNo, travelClass, class: classCode, date, from, to } = req.query;
  const cls = travelClass ?? classCode;

  const availability = await journeyAvailability({
    trainNo,
    travelClass: cls,
    departureDate: date,
  });

  /**
   * The journey's own mask, when the traveller has told us both ends.
   *
   * Sent to the client rather than computed there because the bit encoding is a
   * server detail — a BigInt mask does not survive JSON as a number — and
   * duplicating the arithmetic in two places is how they would drift.
   */
  let journey = null;
  if (from && to) {
    const route = await routeFor(trainNo);
    const segment = resolveSegment(route, from, to);
    journey = {
      fromStation: segment.from.stationCode,
      toStation: segment.to.stationCode,
      fromStopSeq: segment.fromStopSeq,
      toStopSeq: segment.toStopSeq,
      distanceKm: segment.distanceKm,
      mask: segment.mask,
      segments: segment.segments,
    };
  }

  const route = await routeFor(trainNo);

  return res.json({
    trainNo: String(trainNo ?? '').trim(),
    travelClass: String(cls ?? '').trim().toUpperCase(),
    departureDate: availability.departureDate,
    totalSeats: availability.totalSeats,
    takenSeats: availability.takenSeats,
    coaches: availability.coaches,
    /**
     * One bit per segment between consecutive stops, so the client can turn a
     * mask into "taken between these two stations" without knowing the encoding.
     */
    route: route.map((stop) => ({
      stopSeq: stop.stopSeq,
      stationCode: stop.stationCode,
      stationName: stop.stationName,
      distanceKm: stop.distanceKm,
      arrivalTime: stop.arrivalTime,
      departureTime: stop.departureTime,
    })),
    segmentCount: Math.max(route.length - 1, 0),
    journey,
    /**
     * Stated rather than assumed, so a client rendering a countdown from this
     * and disagreeing with the database has an obvious place to look.
     */
    holdTtlMinutes: env.seatHoldTtlMinutes,
  });
}

module.exports = { getAvailability }