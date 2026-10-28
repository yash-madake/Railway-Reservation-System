'use strict'

/**
 * Journey geometry — the segment arithmetic every other module shares.
 *
 * A train's `train_routes` rows carry `stop_sequence` and a **cumulative**
 * `distance_km`, so a booking from stop 2 to stop 5 is `stops[4].distance_km -
 * stops[2].distance_km`. Nothing here needs a separate distance table.
 *
 * ## Bit encoding
 *
 * Segment `i` is the run from stop `i` to stop `i + 1`, and is bit `i` of the
 * mask. So a booking from stop 1 to stop 4 claims segments 0, 1 and 2:
 *
 *   mask = ((1 << (to - from)) - 1) << (from - 1)
 *        = ((1 << 3) - 1) << 0
 *        = 7   = 0b0111
 *
 * Two bookings may share a berth iff their masks do not intersect.
 *
 * ## The client never supplies segment numbers
 *
 * Everything here takes station *codes* and resolves them against the route. A
 * client that sent `from_stop_seq` directly could ask for a segment it is not
 * travelling and be charged for the wrong distance, so the codes are the only
 * thing accepted from outside.
 */

const { QueryTypes } = require('sequelize')

const { sequelize } = require('../../config/database')
const { badRequest } = require('../../utils/errors')

/** BIGINT UNSIGNED is 64 bits; refuse anything that could overflow it. */
const MAX_SEGMENTS = 64

/**
 * Every stop on a train, with its cumulative distance.
 *
 * @param {string|number} trainNo
 * @returns {Promise<Array<{stopSeq: number, stationId: number, stationCode: string, stationName: string, distanceKm: number, arrivalTime: string|null, departureTime: string|null}>>}
 *
 * `stationId` is included because 3NF stores station keys rather than codes, so
 * the booking writer needs the id as well as the code it validates against.
 */
async function routeFor(trainNo) {
  const number = String(trainNo ?? '').replace(/\D/g, '');
  if (!number) throw badRequest('trainNo is required.', 'trainNo');

  const rows = await sequelize.query(
    `SELECT tr.stop_sequence AS stopSeq,
            s.id              AS stationId,
            s.station_code   AS stationCode,
            s.station_name   AS stationName,
            tr.distance_km   AS distanceKm,
            tr.arrival_time  AS arrivalTime,
            tr.departure_time AS departureTime
       FROM train_routes tr
       JOIN trains  t ON t.id = tr.train_id
       JOIN stations s ON s.id = tr.station_id
      WHERE t.train_number = :number
      ORDER BY tr.stop_sequence`,
    { replacements: { number }, type: QueryTypes.SELECT },
  );

  return rows.map((r) => ({
    ...r,
    stopSeq: Number(r.stopSeq),
    distanceKm: Number(r.distanceKm) || 0,
  }));
}

/** A `YYYY-MM-DD` date, validated. A journey date is a calendar day, no timezone. */
function parseDate(value) {
  const raw = String(value ?? '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw badRequest('departureDate must be an ISO date, YYYY-MM-DD.', 'departureDate');
  }
  const [y, m, d] = raw.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    throw badRequest(`"${raw}" is not a real date.`, 'departureDate');
  }
  return raw;
}

/**
 * Resolve a boarding/dropping pair into the segment run between them.
 *
 * @param {Array} route from routeFor()
 * @param {string} fromCode
 * @param {string} toCode
 * @returns {{
 *   fromStopSeq: number, toStopSeq: number,
 *   distanceKm: number, segments: number,
 *   mask: string,            // as a string: BIGINT UNSIGNED over 2^53 loses precision in JS
 *   from: object, to: object,
 * }}
 * @throws {HttpError} 400 when either station is not on this train, or the
 *         travel is the wrong way round
 */
function resolveSegment(route, fromCode, toCode) {
  if (!Array.isArray(route) || route.length < 2) {
    throw badRequest('This train has no usable route.', 'trainNo');
  }

  const want = (code) => String(code ?? '').trim().toUpperCase();
  const from = route.find((s) => s.stationCode?.toUpperCase() === want(fromCode));
  const to = route.find((s) => s.stationCode?.toUpperCase() === want(toCode));

  if (!from) {
    throw badRequest(`${want(fromCode) || 'Your origin'} is not a stop on this train.`, 'route.from');
  }
  if (!to) {
    throw badRequest(`${want(toCode) || 'Your destination'} is not a stop on this train.`, 'route.to');
  }
  if (to.stopSeq <= from.stopSeq) {
    throw badRequest(
      `${to.stationCode} is not reached after ${from.stationCode} on this train.`,
      'route',
    );
  }

  const segments = to.stopSeq - from.stopSeq;
  if (segments > MAX_SEGMENTS) {
    throw badRequest('This journey covers more segments than a ticket can represent.', 'route');
  }

  return {
    fromStopSeq: from.stopSeq,
    toStopSeq: to.stopSeq,
    distanceKm: Math.round(to.distanceKm - from.distanceKm),
    segments,
    // Returned as a string, not a number. A 64-bit mask does not survive
    // IEEE-754 as a Number once it passes 2^53, and rounding one silently would
    // make two different segment runs compare equal.
    mask: maskFor(from.stopSeq, to.stopSeq),
    from,
    to,
  };
}

/**
 * The bits for stops `from`..`to`, as a decimal string.
 *
 * @param {number} fromSeq 1-based stop sequence
 * @param {number} toSeq   1-based stop sequence, greater than fromSeq
 * @returns {string}
 */
function maskFor(fromSeq, toSeq) {
  const span = toSeq - fromSeq;
  if (span <= 0 || span > MAX_SEGMENTS) {
    throw badRequest('A ticket must cover at least one segment.', 'route');
  }
  // BigInt because 1 << 64 is already past Number.MAX_SAFE_INTEGER.
  const mask = (1n << BigInt(span)) - 1n;
  return (mask << BigInt(fromSeq - 1)).toString();
}

/** Every segment index a mask claims, ascending. For messages and debugging. */
function segmentsOf(mask) {
  const bits = BigInt(mask);
  const out = [];
  for (let i = 0; i < MAX_SEGMENTS; i += 1) {
    if ((bits >> BigInt(i)) & 1n) out.push(i);
  }
  return out;
}

/** Do two masks claim any of the same segments? */
const overlaps = (a, b) => (BigInt(a) & BigInt(b)) !== 0n;

module.exports = {
  routeFor,
  resolveSegment,
  parseDate,
  maskFor,
  segmentsOf,
  overlaps,
  MAX_SEGMENTS,
};