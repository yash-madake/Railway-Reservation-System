import { apiClient } from '@/api/client';

/**
 * Client for the Team 5 payment API (`/payments`). See PAYMENTS.md §4.
 *
 * Two rules this module exists to enforce:
 *
 *   1. **No amount is ever sent.** `createOrder` takes a booking reference and
 *      the server returns the figure. Passing one is not merely redundant — the
 *      backend rejects the request with 400 rather than risk the two disagreeing.
 *   2. **Nothing is trusted from the Checkout handler.** The response fields go
 *      to `/verify`, where the server recomputes the HMAC and re-reads the
 *      status from Razorpay. A "success" in the browser proves nothing.
 */

export const paymentService = {
    /**
     * Mint a Razorpay order for a booking.
     *
     * @param {string} bookingRef  YTR-12951-7QX2
     * @param {{insurance?: boolean, coupon?: string|null}} [extras]
     * @returns {Promise<{orderId, amount, currency, keyId, fare, createdAt, ...}>}
     *          `amount` is paise and is the server's authoritative figure.
     */
    createOrder: (bookingRef, extras = {}) =>
        apiClient.post('/payments/create-order', { bookingRef, extras }),

    /**
     * Confirm a payment. Idempotent — replaying a settled payment returns
     * `duplicate: true` and writes nothing, so a double callback cannot
     * double-credit.
     *
     * @param {{razorpayPaymentId: string, razorpayOrderId: string, razorpaySignature: string}} response
     *        the object Razorpay's Checkout `handler` receives
     */
    verify: ({ razorpayPaymentId, razorpayOrderId, razorpaySignature }) =>
        apiClient.post('/payments/verify', {
            // The backend looks the record up by this and HMACs over the copy it
            // stored, so echoing the client's order id here is safe.
            orderId: razorpayOrderId,
            razorpayPaymentId,
            razorpayOrderId,
            razorpaySignature,
        }),

    /** Poll target for a payment the gateway has not settled yet. */
    getStatus: (orderId) => apiClient.get(`/payments/status/${orderId}`),

    /** Terminal. Omit `amount` for a full refund. */
    refund: ({ orderId, paymentId, amount }) =>
        apiClient.post('/payments/refund', { orderId, paymentId, amount }),

    /**
     * @param {{status?: 'all'|'captured'|'pending'|'failed'|'refunded', page?: number, pageSize?: number}} params
     */
    getHistory: ({ status = 'all', page = 1, pageSize = 10 } = {}) =>
        apiClient.get('/payments/history', { status, page, pageSize }),
};

export default paymentService;

/**
 * The Checkout result, held in sessionStorage between the payment page and the
 * processing page.
 *
 * Without this, a refresh between "Razorpay said yes" and "the server agreed"
 * loses the payment id and the traveller has to pay again. sessionStorage rather
 * than a route param because the three Checkout values belong in one atomic
 * blob, and because a payment id is not something to put in a URL that gets
 * logged, bookmarked or sent in a Referer.
 */
const ATTEMPT_KEY = 'yatrio.payment.attempt';

export const paymentAttempt = {
    save(attempt) {
        try {
            sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify(attempt));
        } catch {
            // Private mode with storage disabled. Verification still works from
            // the in-memory route state; only the refresh case is lost.
        }
    },
    load() {
        try {
            const raw = sessionStorage.getItem(ATTEMPT_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    },
    clear() {
        try {
            sessionStorage.removeItem(ATTEMPT_KEY);
        } catch {
            /* nothing to do */
        }
    },
};