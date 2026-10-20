import { apiClient } from '@/api/client';

/**
 * Map whatever the search UI calls a class onto the codes the server's price
 * list uses (see bookingService.js / CLASS_RATES on the backend).
 */
const CLASS_CODE = {
    '1A': '1A', '2A': '2A', '3A': '3A',
    FIRST: '1A', SECOND: '2A', THIRD: '3A',
    EC: 'EC', EXECUTIVE: 'EC',
    CC: 'CC', 'CHAIR CAR': 'CC',
    SL: 'SL', SLEEPER: 'SL',
    '2S': '2S', '2S AC': '2S',
};

const toClassCode = (raw) => CLASS_CODE[String(raw ?? '').trim().toUpperCase()] ?? null;

/**
 * Work out which class the traveller is actually booked in.
 *
 * `selectedClass` is the usual answer, but it is only set once someone has
 * clicked a class on the search results. Falling back to the train's own class
 * list means a direct link to the payment stage, or a reload that lost the
 * selection, still resolves instead of dead-ending.
 *
 * Returns null when there is genuinely nothing to go on — the caller must then
 * send the traveller back to search rather than guess, because guessing a class
 * means guessing what to charge.
 *
 * @returns {{code: string, from: string}|null}
 */
export const resolveTravelClass = (selectedClass, selectedTrain) => {
    const direct = toClassCode(selectedClass);
    if (direct) return { code: direct, from: 'selection' };

    const onTrain = toClassCode(selectedTrain?.class);
    if (onTrain) return { code: onTrain, from: 'train' };

    // First class the train actually offers, skipping ones with no seats left.
    const offered = (selectedTrain?.classes ?? []).find((c) => {
        const code = toClassCode(c?.type);
        return code && c?.status !== 'unavailable' && (c?.availableSeats ?? 1) > 0;
    });
    const fallback = toClassCode(offered?.type);
    return fallback ? { code: fallback, from: 'train-classes' } : null;
};

export const bookingService = {
    /**
     * Confirm a booking, hold its seats, and mint its reference.
     *
     * Payment is addressed by booking reference, so this has to happen before
     * the payment stage — there is no reference to pay against until it does.
     * Not mocked: a fake reference would be unresolvable server-side.
     *
* `seats` is the selection as the seat map holds it — `[{ coach, number }]` —
     * and it is not optional decoration. The server claims those berths in
     * `seat_holds` for the length of the payment window and answers 409 if any
     * of them is taken on any segment this journey covers. Sending it is what
     * starts the five-minute clock.
     *
     * The fare is priced on the distance between `route.from` and `route.to`, so
     * a mid-train boarding costs the pro-rata share of the full-route fare
     * rather than the whole thing. Station *codes* go in; the server resolves
     * them to segment positions, because a client that sent its own stop
     * sequence could ask to be charged for a different journey.
     *
     * @param {object} payload
     * @param {{train: object, route: object, passengers: Array, contact?: object, extras?: object,
     *          seats?: Array<{coach: string, number: string, type?: string}>, departureDate?: string,
     *          replacesBookingRef?: string}} payload
     * @returns {Promise<{bookingRef: string, fare: object, seats: object[], holdExpiresAt: string,
     *                    segment: {distanceKm: number, mask: string, ...}, ...}>}
     *          `holdExpiresAt` is the deadline MySQL stamped — count down to it,
     *          do not recompute one from a local clock.
     */
    confirmBooking: async ({ train, route, passengers, contact, extras, seats, departureDate, replacesBookingRef }) => {
        const classCode = toClassCode(train?.class);
        if (!classCode) {
            throw new Error(`Unsupported travel class "${train?.class}".`);
        }

        // departureAt is deliberately not sent: the search flow holds a bare
        // "17:00" rather than a date, and the fare does not depend on it.
        return apiClient.post('/bookings/confirm', {
            train: {
                number: train?.number,
                name: train?.name,
                class: classCode,
            },
            route: {
                from: route?.from?.code ?? route?.from,
                to: route?.to?.code ?? route?.to,
                fromName: route?.from?.name,
                toName: route?.to?.name,
            },
            passengers: (passengers ?? []).map((p) => ({
                name: p?.name,
                age: p?.age,
                gender: p?.gender,
            })),
            contact,
            extras,
            seats,
            departureDate,
            replacesBookingRef,
        });
    },

    /**
     * Which berths are spoken for on a journey, and for which segments.
     *
     * `from`/`to` are optional but should always be passed: with them the server
     * returns the mask of *this* journey, and each seat can be tested against it
     * without the browser doing bit arithmetic it would only get wrong once.
     *
     * @param {{trainNo: string, travelClass: string, date: string, from?: string, to?: string}} params
     * @returns {Promise<{coaches: object[], totalSeats: number, takenSeats: number,
     *                    route: object[], segmentCount: number, journey: object|null}>}
     */
    getSeatAvailability: async ({ trainNo, travelClass, date, from, to }) => {
        const query = new URLSearchParams({
            trainNo: trainNo ?? '',
            class: travelClass ?? '',
            date: date ?? '',
        });
        if (from && to) {
            query.set('from', from);
            query.set('to', to);
        }
        return apiClient.get(`/seats/availability?${query.toString()}`);
    },

    /**
     * The full train record — route timeline, platforms, distance, pantry,
     * classes and their fares.
     *
     * The review screen used to invent these: NDLS→MMCT, 15h 40m, PF #3,
     * 1,384 km, "Pantry Car Available", all of it literals from a copy-pasted
     * 12951 itinerary, shown next to whatever train the traveller actually
     * picked. `trainNumber` is the only lookup key that is always right, which is
     * why the header could show "12002 Bhopal Shatabdi" while the route underneath
     * described a different train entirely.
     *
     * @param {string|number} trainNo
     * @returns {Promise<object>} stops[], classes[], source, destination,
     *          totalDistanceKm, pantryAvailable
     */
    getTrainDetails: async (trainNo) => apiClient.get(`/trains/${encodeURIComponent(trainNo ?? '')}`),

    /**
     * Every booking the caller may see, newest first.
     *
     * Scoped server-side: an authenticated caller gets only their own rows, and
     * an unauthenticated one gets everything (see the auth note in
     * `bookingRoutes.js`). `?mine=true` narrows an unauthenticated caller to
     * guest bookings, which is the only self-scoping available without a login.
     *
     * These three used to be served from `@/data/bookings` behind a 500 ms
     * `delay`, so the list rendered two invented tickets with invented PNRs and
     * invented fares — and `createBooking` invented a *new* one client-side,
     * minting a PNR the server had never issued.
     *
     * @param {{status?: string, page?: number, pageSize?: number, mine?: boolean}} [params]
     * @returns {Promise<{items: object[], total: number, page: number, pageSize: number, totalPages: number}>}
     */
    getBookings: async ({ status, page, pageSize, mine } = {}) => {
        const query = new URLSearchParams();
        if (status && status !== 'all') query.set('status', status);
        if (page) query.set('page', String(page));
        if (pageSize) query.set('pageSize', String(pageSize));
        if (mine) query.set('mine', 'true');
        const qs = query.toString();
        return apiClient.get(`/bookings${qs ? `?${qs}` : ''}`);
    },

    /**
     * One booking, with its manifest and status history.
     *
     * @param {string} bookingRef e.g. `YTR-12951-7QX2`
     * @returns {Promise<object>}
     */
    getBooking: async (bookingRef) =>
        apiClient.get(`/bookings/${encodeURIComponent(bookingRef ?? '')}`),

    /**
     * Withdraw a booking and hand its berths back.
     *
     * @param {string} bookingRef
     * @param {{reason?: string}} [body]
     * @returns {Promise<object>}
     */
    cancelBooking: async (bookingRef, { reason } = {}) =>
        apiClient.post(`/bookings/${encodeURIComponent(bookingRef ?? '')}/cancel`, { reason }),
};
