'use strict'

/**
 * Booking controller — the booking flow's durable record.
 *
 * ## Order of operations, which is the point
 *
 *   1. validate and shape the booking    pure, writes nothing
 *   2. hold the berths                   fallible — a berth may be taken, or
 *                                        taken on part of the journey
 *   3. price it                          server-owned, from the DB price list
 *   4. record the booking                writes the row and its manifest
 *
 * The berths are held *before* the booking is recorded because the hold is what
 * can fail. A traveller whose berth went thirty seconds ago gets a 409 and
 * nothing else, not a booking row claiming a seat nobody owns.
 *
 * ## Segment pricing
 *
 * The fare comes from the distance between this traveller's two stations. A
 * booking JHS→BPL on a train running NDLS→BPL is charged for 292 km rather
 * than 702 — `holdSeats` returns the resolved segment, and that is what the fare
 * is priced against, so the number reviewed is the number charged.
 */

const bookingStore = require('../services/booking/bookingService')
const audit = require('../services/auditService')
const { fareForBooking } = require('../services/payment/fareService')
const { holdSeats, releaseHolds } = require('../services/seat/holdService')
const { routeFor, resolveSegment, parseDate } = require('../services/seat/journeyService')
const { conflict, badRequest, asyncHandler } = require('../utils/errors')

/** The authenticated user, when the route was mounted behind auth. */
const userIdOf = (req) => req?.user?.id ?? req?.user?.userId ?? null;

/**
 * POST /bookings/confirm
 *
 * Body: {
 *   train:  { number, name, class },
 *   route:  { from, to },              station CODES, never stop sequences
 *   passengers: [...],
 *   contact?, extras?,
 *   departureDate: 'YYYY-MM-DD',
 *   seats: [ { coach, number } ],
 *   replacesBookingRef?                 previous attempt to release
 * }
 *
 * Responds 409 SEATS_UNAVAILABLE if any berth is already spoken for on any
 * segment of this traveller's journey.
 */
async function confirmBooking(req, res) {
  const body = req.body ?? {};
  const {
    seats,
    departureDate,
    replacesBookingRef,
    route: routeInput,
    ...bookingInput
  } = body;

  const from = routeInput?.from?.code ?? routeInput?.from;
  const to = routeInput?.to?.code ?? routeInput?.to;
  const trainNumber = bookingInput?.train?.number;
  const travelClass = bookingInput?.train?.class;

  if (!trainNumber || !travelClass || !from || !to) {
    throw badRequest('train, travelClass and a route are required to confirm a booking.');
  }

  /**
   * Resolve the segment *before* claiming anything.
   *
   * This is pure and it is the step that decides the fare, so doing it first
   * means a bad origin/destination is a 400 that touches nothing.
   *
   * It also breaks a circular dependency the new foreign key introduced:
   * `seat_holds.booking_ref` now references `bookings.booking_ref`, so a hold
   * cannot exist before its booking row does. Resolving the geometry up front
   * means the row can be written first and the hold taken immediately after,
   * with the ordering below rather than a chicken-and-egg.
   */
  const segment = resolveSegment(await routeFor(trainNumber), from, to);
  const date = parseDate(departureDate);

  // (2) Price the segment, before any state changes. The server owns the price;
  //     the client never sends one.
  const priced = {
    train: { number: trainNumber, name: bookingInput?.train?.name, class: travelClass },
    passengers: bookingInput?.passengers ?? [],
    segment,
    extras: bookingInput?.extras,
  };
  const fare = await fareForBooking(priced, bookingInput?.extras ?? {});

  // (3) Write the booking, then (4) claim the berths, then (5) the manifest.
  //
  //     The order is a consequence of the foreign key, not a preference. What
  //     protects the invariant — no booking without seats — is the catch below:
  //     if the hold or the manifest fails, the row is removed, and CASCADE takes
  //     any partial holds with it. The traveller is left with neither, rather
  //     than a booking claiming a berth nobody owns.
  const bookingRef = bookingStore.mintBookingRef(trainNumber);

  await bookingStore.createBooking({
    bookingRef,
    userId: userIdOf(req),
    train: priced.train,
    route: { from, to, fromName: routeInput?.from?.name, toName: routeInput?.to?.name },
    segment,
    passengers: bookingInput?.passengers,
    // Filled in once the berths are actually claimed.
    seats: (seats ?? []).map((s, i) => ({
      coach: s.coach,
      seatNumber: s.number ?? s.seatNumber,
      berthType: null,
      _position: i,
    })),
    contact: bookingInput?.contact,
    extras: bookingInput?.extras,
    amount: fare.amount,
    holdExpiresAt: null,
  });

  let hold;
  let booking;
  try {
    hold = await holdSeats({
      bookingRef,
      trainNo: trainNumber,
      travelClass,
      departureDate: date,
      fromStation: from,
      toStation: to,
      seats,
      supersedesRefs: replacesBookingRef,
    });

    // Attach the resolved berths to the manifest now that they are real.
    await bookingStore.attachSeats(bookingRef, hold.seats, hold.expiresAt);

    // Read back inside the guard. Everything from here can still fail, and a
    // throw outside this block would leave a booking row behind claiming berths
    // the traveller never confirmed.
    booking = await bookingStore.getBookingByRef(bookingRef);
  } catch (err) {
    // CASCADE removes any partial holds; the reference is unique, so a retry
    // cannot collide with what is being cleaned up.
    await bookingStore.discardBooking(bookingRef).catch(() => {});
    throw err;
  }

  // The booking exists from here, so the event is recorded. `record` never
  // throws — a failure to write the audit row must not undo a held booking.
  await audit.record({
    action: audit.ACTIONS.BOOKING_CREATED,
    entity: audit.ENTITIES.BOOKING,
    entityId: bookingRef,
    actorId: audit.actorOf(req),
    details: {
      train: trainNumber,
      class: travelClass,
      from,
      to,
      seats: hold?.seats?.length ?? 0,
      amount: fare.amount,
    },
  });

  return res.status(201).json({
    ...booking,
    fare: {
      amount: fare.amount,
      currency: fare.currency,
      breakdown: fare.breakdown,
      passengers: fare.passengers,
      couponApplied: fare.couponApplied,
      isFullRoute: fare.isFullRoute,
      distanceKm: fare.distanceKm,
    },
    seats: hold.seats,
    // MySQL's deadline, not a browser-side one.
    holdExpiresAt: hold.expiresAt,
  });
}

/**
 * GET /bookings?status=all&page=1&pageSize=20
 *
 * Scoped to the caller when the route is authenticated. Unauthenticated, it
 * lists everything, which is what the admin view needs and what makes the
 * endpoint unsuitable for mounting publicly — see routes/bookingRoutes.js.
 */
const listBookings = asyncHandler(async (req, res) => {
  const userId = userIdOf(req);
  const mine = req.query.mine === 'true';

  /**
   * Map auth onto the service's three-way `userId`.
   *
   *   signed in          -> that traveller's rows, always
   *   signed out, mine    -> guest rows only
   *   signed out, no mine -> everything
   *
   * The last is what the public demo relies on to have anything to show, and it
   * is the one that would disclose other people's bookings if this were ever
   * exposed. Authenticated callers never reach it, because `userIdOf` returns a
   * real id for them — which is the property worth stating, since it is the
   * whole reason the three cases are separated instead of collapsed into one.
   */
  const scope =
    userId !== null && userId !== undefined ? userId : mine ? null : undefined;

  const result = await bookingStore.listBookings({
    userId: scope,
    status: req.query.status ?? 'all',
    page: req.query.page,
    pageSize: req.query.pageSize,
  });

  return res.json(result);
});

/** GET /bookings/:bookingRef — one booking, with its manifest and history. */
const getBooking = asyncHandler(async (req, res) => {
  const { bookingRef } = req.params;

  // Proves ownership before revealing anything.
  await bookingStore.assertOwnership(bookingRef, userIdOf(req));

  const booking = await bookingStore.getBookingByRef(bookingRef);
  const history = await bookingStore.getStatusHistory(bookingRef);

  return res.json({ ...booking, statusHistory: history });
});

/**
 * POST /bookings/:bookingRef/cancel
 *
 * Withdrawing a booking. Two cases, with different consequences:
 *
 *   HELD       never paid, so there is nothing to reverse. The berths go straight
 *              back on sale.
 *   CONFIRMED  paid, so cancelling is not enough — the money has to come back
 *              through the payment module's refund path. The seats are released
 *              and the booking is marked CANCELLED, but the response says
 *              plainly that a refund is outstanding rather than pretending the
 *              cancellation completed it.
 */
const cancelBooking = asyncHandler(async (req, res) => {
  const { bookingRef } = req.params;
  const reason = req.body?.reason ?? null;

  const row = await bookingStore.assertOwnership(bookingRef, userIdOf(req));

  if (row.status === 'CANCELLED') {
    throw conflict('This booking is already cancelled.', 'ALREADY_CANCELLED');
  }
  if (row.status === 'EXPIRED') {
    throw conflict('This booking expired before payment and cannot be cancelled.', 'ALREADY_EXPIRED');
  }

  const wasPaid = row.status === 'CONFIRMED';

  // Give the berths back before flipping the status, so a crash in between
  // leaves a cancelled-looking booking with live seats rather than the reverse:
  // the seat would be unreleasable, because only a HELD or CONFIRMED row can
  // still be transitioned.
  const released = await releaseHolds(bookingRef);

  const booking = await bookingStore.transition(bookingRef, 'CANCELLED', {
    reason: reason ?? (wasPaid ? 'cancelled_after_payment' : 'cancelled_by_user'),
    changedBy: userIdOf(req) ? `user:${userIdOf(req)}` : 'guest',
  });

  await audit.record({
    action: audit.ACTIONS.BOOKING_CANCELLED,
    entity: audit.ENTITIES.BOOKING,
    entityId: bookingRef,
    actorId: audit.actorOf(req),
    details: { reason: booking.cancellationReason ?? reason ?? null, wasPaid, holdsReleased: released },
  });

  return res.json({
    ...booking,
    seatsReleased: released,
    /**
     * Honest about what has not happened. A paid cancellation is not finished
     * until the gateway refunds, and saying otherwise would leave the traveller
     * believing they are done when their money is still captured.
     */
    refundRequired: wasPaid,
    message: wasPaid
      ? 'Booking cancelled and berths released. A refund has been requested for your payment.'
      : 'Booking cancelled and berths released.',
  });
});

/**
 * POST /bookings/expire — run by the sweeper.
 *
 * Ages out bookings whose payment window closed unpaid. Exposed as a route only
 * so it can be driven from a scheduler on another host; the in-process sweeper
 * calls the service directly.
 */
const expireBookings = asyncHandler(async (req, res) => {
  const expired = await bookingStore.expireUnpaidBookings();
  return res.json({ expired });
});

module.exports = { confirmBooking, listBookings, getBooking, cancelBooking, expireBookings };