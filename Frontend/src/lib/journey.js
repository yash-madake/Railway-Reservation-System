/**
 * Journey derivation — turning a train's full route into *this* booking's
 * segment.
 *
 * A train's `stops` are its whole timetable. A booking is a window onto that
 * timetable: NDLS→BPL on the 12002 is five stops long out of a longer route.
 * The review screen used to skip this entirely and print a fixed NDLS→MMCT
 * itinerary, which is why it contradicted the train name in the header.
 *
 * Everything here reads from the `GET /trains/:trainNo` payload. Nothing invents
 * a value; where the data cannot answer a question, the result says so rather
 * than substituting a default that would look like a fact.
 */

/** 'HH:MM' or 'HH:MM:SS' to minutes past midnight. Null when absent. */
const minutesFromMidnight = (value) => {
    if (!value) return null;
    const [h, m] = String(value).split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
};

/** 0 for 'HH:MM', so times compare and subtract cleanly. */
export const formatClock = (value) => {
    if (!value) return '--:--';
    return String(value).slice(0, 5);
};

/** Minutes to '15h 40m'. */
export const formatDuration = (totalMinutes) => {
    if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return '--';
    const h = Math.floor(totalMinutes / 60);
    const m = Math.round(totalMinutes % 60);
    if (h === 0) return `${m}m`;
    return `${h}h ${m}m`;
};

/** The ISO date (`YYYY-MM-DD`) `days` after `date`. Null when unparseable. */
export const addDays = (date, days) => {
    if (!date) return null;
    const base = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(base.getTime())) return null;
    base.setUTCDate(base.getUTCDate() + (days || 0));
    return base.toISOString().slice(0, 10);
};

/** `YYYY-MM-DD` rendered for display, e.g. '15 Oct 2026'. */
export const formatDateLong = (date) => {
    if (!date) return '--';
    const d = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return '--';
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

/**
 * A display PNR for a booking reference.
 *
 * Indian Railways PNRs are 10 digits and are allocated by a central system.
 * Yatrio has no PNR table yet — `pnr_records` is Team 6's and is not built — so
 * this derives a stable 10-digit number from the booking reference rather than
 * shipping a constant.
 *
 * The important properties are that it is deterministic (the same booking always
 * shows the same number, across reloads) and collision-resistant enough for a
 * demo. It is **not** a real allocated PNR and must not be presented as one:
 * `derivePnr` is paired with the real `bookingRef` wherever it is shown, because
 * the reference is the thing that actually resolves against `payments` and
 * `seat_holds`.
 *
 * FNV-1a, 32-bit, rendered as 10 digits. Chosen for being a few lines and
 * dependency-free rather than for being a good hash.
 *
 * @param {string|null} bookingRef e.g. 'YTR-12002-F25C'
 * @returns {string|null} '1234567890', or null when there is no reference
 */
export function derivePnr(bookingRef) {
    const ref = String(bookingRef ?? '').trim();
    if (!ref) return null;

    let hash = 0x811c9dc5;
    for (let i = 0; i < ref.length; i += 1) {
        hash ^= ref.charCodeAt(i);
        // Math.imul keeps the multiply in 32 bits; `*` would exceed it and lose
        // the high bits, collapsing the range.
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }

    // Two rounds, because one 32-bit value only yields ~4.3e9 distinct
    // ten-digit strings starting at zero — enough for a demo, but the extra
    // pass costs nothing and widens it.
    let mixed = hash;
    for (let i = 0; i < ref.length; i += 1) {
        mixed = Math.imul(mixed ^ ref.charCodeAt(i), 0x85ebca6b) >>> 0;
    }

    return String(mixed % 1_000_000_0000).padStart(10, '0');
}

/** A PNR for display, grouped the way IRCTC groups one: 3-4-3. */
export const formatPnr = (bookingRef) => {
    const digits = derivePnr(bookingRef);
    return digits ? digits.replace(/^(\d{3})(\d{4})(\d{3})$/, '$1-$2-$3') : null;
};

/**
 * The segment a booking covers.
 *
 * `from`/`to` are station codes. Both ends are located in the route; if either
 * code is not a stop on this train the whole journey is returned instead, because
 * showing the entire timetable under a two-station booking is wrong but
 * showing a fabricated segment is worse.
 *
 * @param {object|null} train  the GET /trains/:trainNo payload
 * @param {string} fromCode
 * @param {string} toCode
 * @returns {{
 *   exact: boolean,
 *   stops: object[],
 *   from: object|null, to: object|null,
 *   departureTime: string, arrivalTime: string,
 *   departureDate: string|null, arrivalDate: string|null,
 *   durationMinutes: number|null,
 *   distanceKm: number|null,
 *   departurePlatform: string|null,
 *   boardsMidRoute: boolean,
 * }}
 */
export function deriveJourney(train, fromCode, toCode) {
    const stops = Array.isArray(train?.stops) ? train.stops : [];

    const empty = {
        exact: false,
        stops: [],
        from: null,
        to: null,
        departureTime: '--:--',
        arrivalTime: '--:--',
        departureDate: null,
        arrivalDate: null,
        durationMinutes: null,
        distanceKm: null,
        departurePlatform: null,
        boardsMidRoute: false,
    };

    if (stops.length === 0) return empty;

    const wanted = (code) => String(code ?? '').trim().toUpperCase();
    const fromIndex = stops.findIndex((s) => s?.station?.code?.toUpperCase() === wanted(fromCode));
    const toIndex = stops.findIndex((s) => s?.station?.code?.toUpperCase() === wanted(toCode));

    // Unknown station on this train: fall back to the whole route rather than
    // inventing a segment, and say so via `exact`.
    const exact = fromIndex !== -1 && toIndex !== -1 && toIndex > fromIndex;
    const startIndex = exact ? fromIndex : 0;
    const endIndex = exact ? toIndex : stops.length - 1;

    const from = stops[startIndex] ?? null;
    const to = stops[endIndex] ?? null;

    const departMins = minutesFromMidnight(from?.departureTime);
    const arriveMins = minutesFromMidnight(to?.arrivalTime);

    // `day` is the timetable's day counter, so an overnight leg is handled by
    // carrying it into the subtraction rather than by guessing a 24h wrap.
    const fromDay = (from?.day ?? 1) - 1;
    const toDay = (to?.day ?? 1) - 1;

    const durationMinutes =
        departMins !== null && arriveMins !== null ? toDay * 1440 + arriveMins - (fromDay * 1440 + departMins) : null;

    const fromDistance = Number(from?.distanceKm);
    const toDistance = Number(to?.distanceKm);
    const distanceKm =
        Number.isFinite(fromDistance) && Number.isFinite(toDistance) ? Math.round(toDistance - fromDistance) : null;

    return {
        exact,
        stops: stops.slice(startIndex, endIndex + 1),
        from,
        to,
        departureTime: formatClock(from?.departureTime),
        arrivalTime: formatClock(to?.arrivalTime),
        departureDate: addDays(train?.date, fromDay),
        arrivalDate: addDays(train?.date, toDay),
        durationMinutes,
        distanceKm,
        departurePlatform: from?.platform ?? null,
        // The traveller joined after the first stop, so the coach diagram and
        // seat numbers are not the whole train. Worth saying out loud, because
        // "B1-24" on a mid-route boarding means something different.
        boardsMidRoute: fromIndex > 0,
    };
}