'use strict'

/**
 * Payment controller — Team 5.
 *
 * Contract (from the team assignment):
 *   POST /payments/create-order
 *   POST /payments/verify
 *   POST /payments/refund
 *   GET  /payments/history
 *   GET  /payments/status/:orderId
 *
 * Two invariants this file exists to protect:
 *   1. The amount is always computed server-side from the booking record.
 *      Nothing the browser sends influences what is charged.
 *   2. A payment is only "captured" once Razorpay says so, and only after a
 *      valid HMAC over the order id WE stored.
 */

const store = require('../services/payment/paymentStore')
const razorpay = require('../services/payment/razorpayService')
const bookingStore = require('../services/booking/bookingService')
const audit = require('../services/auditService')
const ticketService = require('../services/ticketService')
const { confirmHolds } = require('../services/seat/holdService')
const { fareForBooking, assertNoClientAmount } = require('../services/payment/fareService')
const { verifyPaymentSignature } = require('../utils/signature')
const env = require('../config/env')
const { badRequest, notFound, conflict, upstream } = require('../utils/errors')

/** Row -> API shape. */
const serialise = (r) => ({
  orderId: r.orderId,
  paymentId: r.paymentId,
  bookingRef: r.bookingRef,
  amount: r.amount,
  currency: r.currency,
  status: r.status,
  method: r.method,
  failureCode: r.failureCode,
  failureReason: r.failureReason,
  attempts: r.attempts,
  refundId: r.refundId,
  refundedAmount: r.refundedAmount,
  passengerName: r.passengerName,
  // Echoed back so Checkout can prefill the traveller's contact details, which
  // Razorpay rates as the single biggest conversion lever. These are the
  // lead passenger's own details from the booking record, not user input.
  passengerEmail: r.passengerEmail,
  passengerContact: r.passengerContact,
  trainNo: r.trainNo,
  trainName: r.trainName,
  fromStation: r.fromStation,
  toStation: r.toStation,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
})

/**
 * POST /payments/create-order
 *
 * Body: { bookingRef, extras?: { insurance?, coupon? } }
 * A retry of the same booking mints a NEW order — Razorpay orders are
 * single-use — and increments the attempt counter.
 */
async function createOrder(req, res) {
  const { bookingRef, extras } = req.body ?? {}

  // Loud failure if a caller tries to set the price.
  assertNoClientAmount(req.body ?? {})

  if (!bookingRef) throw badRequest('bookingRef is required.', 'bookingRef')

  const booking = await bookingStore.resolveBooking(bookingRef)
  // The snapshot taken when the booking was confirmed, so the amount charged is
  // the amount the traveller was shown. Only a booking that predates the
  // snapshot — the seeded demo references — gets priced here.
  const fare = await fareForBooking(booking, extras ?? {})

  // Reuse an order that is still live and not expired.
  const previous = store.latestForBooking(bookingRef)
  if (previous && store.ACTIVE_STATUSES.includes(previous.status) && !store.isExpired(previous)) {
    return res.json({ ...serialise(previous), reused: true })
  }

  if (previous && previous.status === 'captured') {
    throw conflict('This booking is already paid. Refund it before paying again.', 'ALREADY_PAID')
  }

  // Retry cap. A captured order short-circuits above, so this only bites once
  // attempts are spent on failures.
  const attempts = (previous?.attempts ?? 0) + 1
  if (attempts > env.maxAttempts) {
    throw conflict(
      `Maximum of ${env.maxAttempts} payment attempts reached for this booking.`,
      'MAX_ATTEMPTS',
    )
  }

  const receipt = `ytr_${String(bookingRef).replace(/[^a-zA-Z0-9]/g, '').slice(0, 24)}_r${attempts}`

  let order
  try {
    order = await razorpay.createOrder({
      amount: fare.amount, // server-computed, never client-supplied
      currency: fare.currency,
      receipt,
      notes: {
        bookingRef,
        train: booking.train.number,
        route: `${booking.route.from}-${booking.route.to}`,
        passengers: String(fare.passengers),
      },
    })
  } catch (err) {
    throw upstream(
      err?.error?.description ?? 'Razorpay rejected the order request.',
      err?.error?.code ?? null,
    )
  }

  const lead = booking.passengers[0]
  const record = store.create({
    orderId: order.orderId,
    bookingRef,
    amount: fare.amount,
    currency: fare.currency,
    status: 'created',
    attempts,
    passengerName: lead?.name ?? null,
    passengerEmail: booking.contact?.email ?? null,
    passengerContact: booking.contact?.phone ?? null,
    trainNo: booking.train.number,
    trainName: booking.train.name,
    fromStation: booking.route.from,
    toStation: booking.route.to,
  })

  await audit.record({
    action: audit.ACTIONS.ORDER_CREATED,
    entity: audit.ENTITIES.PAYMENT,
    entityId: record.gatewayOrderId ?? record.orderId,
    actorId: audit.actorOf(req),
    details: { bookingRef: record.bookingRef, amount: fare.amount, currency: fare.currency },
  })

  // The public key id travels with the response so the client can open
  // Checkout without a second round-trip. The secret never leaves the server.
  return res.status(201).json({
    ...serialise(record),
    keyId: env.razorpay.keyId,
    fare: { amount: fare.amount, currency: fare.currency, breakdown: fare.breakdown, passengers: fare.passengers },
  })
}

/**
 * POST /payments/verify
 *
 * Body: { orderId, razorpayPaymentId, razorpayOrderId, razorpaySignature }
 *
 * Idempotent: verifying an already-captured order returns the same result
 * without writing again, so a duplicate callback cannot double-credit.
 */
async function verifyPayment(req, res) {
  const { orderId, razorpayPaymentId, razorpayOrderId, razorpaySignature } = req.body ?? {}

  if (!orderId || !razorpayPaymentId || !razorpaySignature) {
    throw badRequest('orderId, razorpayPaymentId and razorpaySignature are required.')
  }

  const record = store.findByOrderId(orderId)
  if (!record) throw notFound(`No payment found for order ${orderId}.`)

  // Already settled — replay-safe.
  if (record.status === 'captured') {
    return res.json({ ...serialise(record), duplicate: true })
  }
  if (record.status === 'refunded') {
    throw conflict('This payment was refunded and cannot be verified again.', 'REFUNDED')
  }

  if (store.isExpired(record)) {
    store.update(orderId, { status: 'failed', failureCode: 'ORDER_EXPIRED', failureReason: 'order_ttl_exceeded' }, {
      event: 'ORDER_EXPIRED',
      extra: { ttlMinutes: env.orderTtlMinutes },
    })
    throw conflict('This payment window has expired. Start a new payment.', 'ORDER_EXPIRED')
  }

  // HMAC over the order id WE stored — never the razorpay_order_id the client
  // echoed back, which is attacker-controlled.
  const valid = verifyPaymentSignature(
    { orderId: record.orderId, paymentId: razorpayPaymentId },
    razorpaySignature,
    env.razorpay.keySecret,
  )

  if (!valid) {
    store.update(orderId, {
      status: 'failed',
      failureCode: 'SIGNATURE_MISMATCH',
      failureReason: 'razorpay_signature_invalid',
    }, { event: 'PAYMENT_FAILED', extra: { reason: 'signature_mismatch' } })

    // Reject outright. Razorpay's guidance is explicit: a failed signature check
    // means a potentially tampered payment — do not fulfil, do not retry.
    throw conflict('Payment signature verification failed. The payment was rejected.', 'SIGNATURE_MISMATCH')
  }

  // Signature is authentic. Ask the gateway for the authoritative status.
  let payment
  try {
    payment = await razorpay.fetchPayment(razorpayPaymentId)
  } catch (err) {
    throw upstream(err?.error?.description ?? 'Could not reach Razorpay to confirm the payment.')
  }

  if (payment.orderId && payment.orderId !== record.orderId) {
    throw conflict('That payment id does not belong to this order.', 'ORDER_MISMATCH')
  }

  const status =
    payment.status === 'captured' ? 'captured' : payment.status === 'failed' ? 'failed' : payment.status

  /**
   * The money has moved, so the seats have to become permanent — in one
   * transaction, and only if they are still ours.
   *
   * Deliberately placed here and not inside `store.update`: confirmHolds locks
   * its rows with FOR UPDATE and may refuse, and a refusal after the payment has
   * been recorded would leave a captured payment attached to a booking whose
   * berth somebody else is about to buy. `confirmHolds` runs first, so the worst
   * outcome is a 409 the traveller never sees because Razorpay already has their
   * money — which is exactly the case PAYMENTS.md's webhook gap warns about.
   *
   * No transaction is held open across the Razorpay call above; that finished
   * before this point on purpose.
   */
  // Set only when THIS call turns a HELD booking into a ticket, so the e-ticket
  // email goes out exactly once. A repeat callback returns early above, and a
  // booking that was already CONFIRMED never sets it.
  let ticketIssued = false

  if (status === 'captured') {
    /**
     * A row in `bookings` was only ever written after its berths were claimed,
     * so a booking still in HELD or CONFIRMED must still be holding them.
     * Anything terminal has already given them back, and there is nothing left
     * to insist about.
     */
    const booking = await bookingStore.findBookingRow(record.bookingRef);
    const isHeld = Boolean(booking) && booking.status === 'HELD';
    const isConfirmed = Boolean(booking) && booking.status === 'CONFIRMED';

    if (isHeld || isConfirmed) {
      /**
       * Only a HELD booking has to prove it still owns its berths.
       *
       * A CONFIRMED booking has already had its seats made permanent — it was
       * confirmed once, and `confirmHolds` already ran that time. Demanding a
       * live hold again rejects the second payment against a ticket that is
       * perfectly valid, and does so the worst way: `confirmHolds` treats "no
       * holds at all" as an expiry and would age out a legitimate booking.
       *
       * So HELD is strict (`required`), CONFIRMED is a courtesy call that
       * settles any remaining pending holds without refusing.
       */
      try {
        await confirmHolds({ bookingRef: record.bookingRef, required: isHeld });
      } catch (err) {
        // The berth is gone. Say so with a code an operator can alert on, age
        // the booking out so it stops claiming seats, and leave the payment for
        // the refund path rather than issuing a ticket for a berth that is not
        // there.
        store.update(orderId, {
          status: 'failed',
          failureCode: err.code ?? 'HOLDS_EXPIRED',
          failureReason: 'seat_hold_expired_before_capture',
        }, { event: 'PAYMENT_FAILED', extra: { reason: 'holds_expired' } })
        await bookingStore
          .transition(record.bookingRef, 'EXPIRED', { reason: 'holds_expired_before_capture', changedBy: 'system' })
          .catch(() => {})
        throw err
      }

      // Money captured, berths confirmed — the booking is a ticket now.
      const confirmedBooking = await bookingStore
        .transition(record.bookingRef, 'CONFIRMED', { reason: 'payment_captured', changedBy: 'system' })
        .catch(() => null)
      ticketIssued = isHeld && Boolean(confirmedBooking)

      await audit.record({
        action: audit.ACTIONS.BOOKING_CONFIRMED,
        entity: audit.ENTITIES.BOOKING,
        entityId: record.bookingRef,
        actorId: audit.actorOf(req),
        details: { orderId, paymentId: razorpayPaymentId },
      })
    }
  }

  const updated = store.update(orderId, {
    paymentId: razorpayPaymentId,
    signature: razorpaySignature,
    status,
    method: payment.method,
    failureCode: payment.errorCode,
    failureReason: payment.errorReason,
  }, { event: status === 'failed' ? 'PAYMENT_FAILED' : 'PAYMENT_VERIFIED' })

  // Email the e-ticket. Deliberately not awaited: the traveller has paid and the
  // response should not wait on a mail server. It never throws, and a failure
  // is logged by the ticket service rather than surfaced here.
  if (ticketIssued) {
    ticketService
      .sendTicketForBooking(record.bookingRef, {
        orderId,
        paymentId: razorpayPaymentId,
        method: updated.method,
      })
      .catch(() => {})
  }

  return res.json(serialise(updated))
}

/**
 * GET /payments/status/:orderId
 * Polled by the pending screen. Reconciles with Razorpay so a payment that
 * settled out of band still resolves.
 */
async function getStatus(req, res) {
  const { orderId } = req.params
  const record = store.findByOrderId(orderId)
  if (!record) throw notFound(`No payment found for order ${orderId}.`)

  if (store.TERMINAL_STATUSES.includes(record.status)) {
    return res.json(serialise(record))
  }

  if (store.isExpired(record)) {
    const updated = store.update(orderId, {
      status: 'failed',
      failureCode: 'ORDER_EXPIRED',
      failureReason: 'order_ttl_exceeded',
    }, { event: 'ORDER_EXPIRED', extra: { ttlMinutes: env.orderTtlMinutes } })
    return res.json(serialise(updated))
  }

  // We hold a payment id and nothing has settled: ask the gateway.
  if (record.paymentId) {
    try {
      const payment = await razorpay.fetchPayment(record.paymentId)
      const status = payment.status === 'captured' ? 'captured' : payment.status === 'failed' ? 'failed' : payment.status
      const updated = store.update(orderId, {
        status,
        method: payment.method ?? record.method,
        failureCode: payment.errorCode ?? record.failureCode,
        failureReason: payment.errorReason ?? record.failureReason,
      })
      return res.json(serialise(updated))
    } catch {
      // A gateway hiccup must not fail the poll — the client keeps retrying.
    }
  }

  return res.json(serialise(record))
}

/**
 * GET /payments/history?status=all|captured|pending|failed|refunded&page=1&pageSize=10
 */
async function getHistory(req, res) {
  const { status = 'all', page = 1, pageSize = 10 } = req.query
  const limit = Math.min(Math.max(parseInt(pageSize, 10) || 10, 1), 100)
  const current = Math.max(parseInt(page, 10) || 1, 1)

  const result = store.list({ status, page: current, pageSize: limit })
  return res.json({
    items: result.items.map(serialise),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    totalPages: result.totalPages,
  })
}

/**
 * POST /payments/refund
 *
 * Body: { orderId } or { paymentId, amount? }
 * Refunds are terminal — a second refund on the same payment is refused.
 */
async function refundPayment(req, res) {
  const { orderId, paymentId, amount } = req.body ?? {}

  if (!orderId && !paymentId) {
    throw badRequest('Provide either orderId or paymentId.', 'orderId')
  }

  const record = orderId ? store.findByOrderId(orderId) : [...store.list({ pageSize: 100 }).items]
      .map((r) => store.findByOrderId(r.orderId))
      .find((r) => r?.paymentId === paymentId)

  if (!record) throw notFound('No payment found for that order or payment id.')
  if (record.status === 'refunded') throw conflict('This payment has already been refunded.', 'ALREADY_REFUNDED')
  if (record.status !== 'captured') {
    throw conflict(`Only a captured payment can be refunded. This one is "${record.status}".`, 'NOT_CAPTURED')
  }
  if (!record.paymentId) throw conflict('No gateway payment id recorded for this order.', 'NO_PAYMENT_ID')

  const refundPaise = amount != null ? Number(amount) : record.amount
  if (!Number.isInteger(refundPaise) || refundPaise < 1) {
    throw badRequest('Refund amount must be a positive integer in paise.', 'amount')
  }
  if (refundPaise > record.amount) {
    throw badRequest('Refund amount cannot exceed the captured amount.', 'amount')
  }

  let refund
  try {
    refund = await razorpay.refundPayment(record.paymentId, refundPaise)
  } catch (err) {
    throw upstream(err?.error?.description ?? 'Razorpay rejected the refund request.', err?.error?.code ?? null)
  }

  const updated = store.markRefunded(record.orderId, {
    refundId: refund.id,
    amount: refundPaise,
  })

  return res.json({ ...serialise(updated), refundStatus: refund.status })
}

module.exports = { createOrder, verifyPayment, getStatus, getHistory, refundPayment, serialise }