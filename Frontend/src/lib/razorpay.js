/**
 * Razorpay Standard Checkout — the single client-side entry point.
 *
 * Two responsibilities, deliberately kept together:
 *   1. Make sure `window.Razorpay` exists (the script tag in index.html is only
 *      a hint; this loads it on demand too, so a checkout opened before the tag
 *      has executed still works).
 *   2. Build the Checkout options from a Yatrio order record.
 *
 * Razorpay owns method selection. Yatrio renders no card inputs and never sees
 * a PAN, CVV or UPI PIN — Checkout does the tokenisation inside its own frame.
 * That is what keeps us out of PCI-DSS scope, so nothing here may grow a form
 * that collects payment credentials.
 *
 * See PAYMENTS.md §3 for the payment-method block this mirrors.
 */

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
const SCRIPT_ID = 'razorpay-checkout-script';

/**
 * The key id is public by design — Razorpay's own docs put it in client code,
 * and the secret is what must never leave the server. Backend/.env.example
 * documents the pairing.
 */
export const RAZORPAY_KEY_ID = import.meta.env.VITE_RAZORPAY_KEY_ID;

/** Yatrio royal, so Checkout matches the booking flow it sits inside. */
const THEME_COLOR = '#014ca9';

let scriptPromise = null;

/**
 * Resolve once `window.Razorpay` is callable.
 *
 * Reuses an already-parsed script whether it came from index.html or a previous
 * call, and caches the in-flight promise so concurrent callers await one load.
 */
export function loadRazorpay() {
    if (typeof window !== 'undefined' && window.Razorpay) {
        return Promise.resolve(window.Razorpay);
    }
    if (scriptPromise) {
        return scriptPromise;
    }

    scriptPromise = new Promise((resolve, reject) => {
        // Already in the DOM from index.html but not parsed yet — attach to it
        // rather than injecting a second copy.
        const existing = document.getElementById(SCRIPT_ID);
        const script = existing ?? document.createElement('script');

        const onLoad = () => {
            if (window.Razorpay) {
                resolve(window.Razorpay);
            } else {
                scriptPromise = null;
                reject(new Error('Razorpay Checkout loaded but did not register. Check for a content blocker.'));
            }
        };

        script.addEventListener('load', onLoad, { once: true });
        script.addEventListener('error', () => {
            scriptPromise = null;
            reject(new Error('Could not reach Razorpay Checkout. Check your network connection.'));
        }, { once: true });

        if (!existing) {
            script.id = SCRIPT_ID;
            script.src = CHECKOUT_SRC;
            script.async = true;
            document.body.appendChild(script);
        }
    });

    return scriptPromise;
}

/**
 * Which instruments Checkout offers, and in what order.
 *
 * `show_default_blocks: false` makes this block authoritative, so the offered
 * set is exactly what is listed here rather than whatever the account happens
 * to have enabled. UPI leads: no PG charge, and the default for Indian rail.
 * Netbanking is listed but harmless — Razorpay drops any instrument the
 * account has not activated, so it appears only once enabled.
 *
 * Wallet is last: it is account-gated too, and rarely the best conversion.
 */
export function buildDisplayConfig() {
    return {
        blocks: {
            yatrio: {
                name: 'Pay with',
                instruments: [
                    { method: 'upi' },
                    { method: 'card' },
                    { method: 'netbanking' },
                    { method: 'wallet' },
                ],
            },
        },
        sequence: ['block.yatrio'],
        preferences: {
            show_default_blocks: false,
        },
        /**
         * UPI Collect — the traveller typing a VPA by hand — was deprecated by
         * NPCI on 28 Feb 2026. Hiding that flow is what lets Razorpay pick the
         * right one per platform instead: UPI Intent on mobile web, UPI QR on
         * desktop, where Intent does not exist.
         *
         * Note that desktop UPI therefore depends on the UPI QR feature being
         * enabled on the account. It is opt-in from Razorpay support, not a
         * setting in this file — see PAYMENTS.md §8.
         */
        hide: [
            { method: 'upi', flows: ['collect'] },
        ],
    };
}

/**
 * Open Checkout for an order created by POST /payments/create-order.
 *
 * `amount` must be the server's figure (paise) — the same value the backend
 * charged to Razorpay. Passing a client-side total here would produce an order
 * whose amount and signature disagree, and verification would refuse it.
 *
 * @param {object} options
 * @param {string} options.orderId      order_xxx from create-order
 * @param {number} options.amount       paise, server-computed
 * @param {string} [options.keyId]      defaults to VITE_RAZORPAY_KEY_ID
 * @param {string} [options.currency]   defaults to INR
 * @param {string} [options.description]
 * @param {object} [options.prefill]    { name, email, contact }
 * @param {object} [options.notes]      shown on the Razorpay dashboard
 * @param {Function} options.onSuccess  ({ razorpay_payment_id, razorpay_order_id, razorpay_signature })
 * @param {Function} options.onFailure  ({ error: { code, description, ... } })
 * @param {Function} [options.onDismiss]
 * @returns {Promise<object>} the Checkout instance
 */
export async function openCheckout({
    orderId,
    amount,
    keyId = RAZORPAY_KEY_ID,
    currency = 'INR',
    description = 'Yatrio booking',
    prefill,
    notes,
    onSuccess,
    onFailure,
    onDismiss,
}) {
    if (!keyId) {
        throw new Error('Razorpay key id is missing. Set VITE_RAZORPAY_KEY_ID in Frontend/.env.');
    }
    if (!orderId) {
        throw new Error('Cannot open Checkout without an order id.');
    }
    if (!Number.isInteger(amount) || amount < 1) {
        throw new Error('Cannot open Checkout without a valid amount in paise.');
    }

    await loadRazorpay();

    const rzp = new window.Razorpay({
        key: keyId,
        // Checkout echoes these for display only. The signature the handler
        // returns is computed over the real order amount, so a mismatch here
        // cannot change what is captured.
        amount,
        currency,
        name: 'Yatrio',
        description,
        order_id: orderId,
        handler: onSuccess,
        prefill,
        notes,
        theme: {
            color: THEME_COLOR,
        },
        config: {
            display: buildDisplayConfig(),
        },
        // A traveller who abandons a half-entered card should not lose it to a
        // stray click, but Escape must still work.
        modal: {
            backdropclose: false,
            escape: true,
            ondismiss: () => onDismiss?.(),
        },
        retry: {
            enabled: true,
        },
    });

    rzp.on('payment.failed', (response) => {
        onFailure?.(response);
    });

    rzp.open();
    return rzp;
}

/** Whether the browser has a usable key id. Drives the "not configured" state. */
export const isRazorpayConfigured = () => Boolean(RAZORPAY_KEY_ID);