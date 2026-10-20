'use strict'

/**
 * The hold sweeper — the thing that actually hands a seat back five minutes later.
 *
 * ## This is a safety net, not the mechanism
 *
 * Every read and every write in holdService already treats a `held` row past
 * `expires_at` as gone, and `seat_holds.expires_at` is stamped by MySQL rather
 * than by an application server's clock. So if this sweeper is disabled, crashes,
 * or simply has not ticked yet, **no traveller is ever shown a stale seat as
 * occupied** and no seat is ever double-sold.
 *
 * What a missed sweep does cost is untidy rows: a dead `held` row lingers in the
 * table, holding nothing. The next traveller who tries that berth clears it
 * themselves — `holdSeats` deletes the journey's elapsed holds before claiming —
 * and the sweeper collects the rest.
 *
 * That ordering is deliberate. A seat must be free the moment its window closes,
 * so the rule that frees it cannot depend on a background job having run.
 *
 * ## Operational notes
 *
 * - `unref()` keeps the timer from holding the event loop open, so tests and
 *   `node --watch` shut down normally instead of hanging on to a connection.
 * - It never throws into the timer. A failed sweep logs and retries on the next
 *   tick; a sweeper that crashes and takes the process with it would turn a
 *   cosmetic problem into an outage.
 * - Runs on every API instance. The statement is a single idempotent DELETE, so
 *   N replicas cost N cheap DELETEs and no coordination.
 */

const { expireStaleHolds } = require('./holdService')
const bookingStore = require('../booking/bookingService')
const env = require('../../config/env')

/**
 * @param {object} [options]
 * @param {number} [options.intervalMs] override for tests
 * @param {() => void} [options.onError] injectable so tests do not hit console
 * @returns {{ stop: () => void, sweep: () => Promise<{holds: number, bookings: number}> }}
 */
function startSeatHoldSweeper({ intervalMs = env.seatSweepIntervalMs, onError } = {}) {
  const report =
    onError ??
    ((err) => {
      console.error('[Yatrio] Seat hold sweep failed:', err.message)
    })

  let running = false

  /**
   * Reclaim the berths, then age the bookings that were holding them.
   *
   * Order matters and it is the FK's doing: `seat_holds.booking_ref` cascades
   * from `bookings`, so a booking row outlives its holds. Releasing first means
   * the berths are free before the booking stops pointing at them; doing it the
   * other way would leave a live booking whose berths are already sold to
   * someone else.
   */
  const sweep = async () => {
    // Skip rather than queue. If a sweep is somehow still in flight — a stalled
    // connection, say — overlapping work buys nothing and only adds pressure to
    // the five-connection pool.
    if (running) return { holds: 0, bookings: 0 };
    running = true;
    try {
      const holds = await expireStaleHolds();
      const bookings = await bookingStore.expireUnpaidBookings();

      if (holds > 0 || bookings > 0) {
        console.log(`[Yatrio] Seat sweep reclaimed ${holds} hold(s), ${bookings} booking(s)`);
      }
      return { holds, bookings };
    } catch (err) {
      report(err);
      return { holds: 0, bookings: 0 };
    } finally {
      running = false;
    }
  };

  const timerId = setInterval(sweep, intervalMs);
  timerId.unref?.();

  console.log(
    `[Yatrio] Seat hold sweeper started — every ${Math.round(intervalMs / 1000)}s, holds last ${env.seatHoldTtlMinutes} min`,
  );

  return {
    sweep,
    stop: () => clearInterval(timerId),
  };
}

module.exports = { startSeatHoldSweeper }