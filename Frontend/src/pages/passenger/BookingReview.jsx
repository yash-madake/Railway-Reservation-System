import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ArrowRight, ShieldCheck, ArrowLeft, AlertCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { RouteConnector } from '@/components/ui/RouteConnector';
import { useBooking } from '@/context/BookingContext';
import { useAuth } from '@/context/AuthContext';
import { openCheckout, isRazorpayConfigured } from '@/lib/razorpay';
import { paise } from '@/lib/format';
import { cn } from '@/lib/utils';
import { paymentService, paymentAttempt } from '@/services/paymentService';
import { bookingService, resolveTravelClass } from '@/services/bookingService';
import { deriveJourney, formatClock, formatDateLong, formatDuration } from '@/lib/journey';

/**
 * Step 3 of 3 — review, then pay.
 *
 * Checkout used to be a fourth page with its own header, fare table and button,
 * which meant the traveller pressed "Proceed to Payment", landed somewhere that
 * looked like a new screen, and had to press "Pay" again. Here the button that
 * closes the review *is* the button that opens Checkout, so the review is the
 * last thing standing between the traveller and the payment.
 *
 * That also fixes the fare. The old review page added up a hardcoded ₹850 base
 * per traveller while Checkout charges the server's CLASS_RATES, so the total
 * could change between the two screens. The order is therefore minted on mount
 * and the breakdown below is the server's, not a guess made in the browser.
 */

/**
 * Mirrors Backend ORDER_TTL_MINUTES. The server is the authority on expiry — it
 * refuses verification past the TTL no matter what this shows — but the
 * countdown has to agree with it, or the UI would offer a payment guaranteed to
 * fail. Five minutes: long enough to fill a UPI intent, short enough that a
 * forgotten tab does not hold a seat reservation hostage.
 */
const ORDER_TTL_SECONDS = 5 * 60;

/**
 * Razorpay's mark, inlined — no icon font ships it. Checkout is the surface
 * that actually handles the card or UPI credentials, so the assurance on this
 * row is theirs to make, not ours.
 */
const RazorpayMark = () => (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" aria-hidden focusable="false">
        <path fill="#2C5AF1" d="M13.4 1.5a.6.6 0 0 1 1.05.5l-1.2 5.4h4.1a.9.9 0 0 1 .69 1.47l-8.5 12a.6.6 0 0 1-1.06-.5l1.2-5.97H5.1a.9.9 0 0 1-.69-1.47l8.35-10.9a.6.6 0 0 1 .64-.53Z"/>
    </svg>
);

const formatTime = (seconds) => {
    const clamped = Math.max(seconds, 0);
    const m = Math.floor(clamped / 60).toString().padStart(2, '0');
    const s = (clamped % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
};

export function BookingReview() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const {
        searchParams,
        selectedTrain,
        selectedClass,
        selectedSeats,
        passengers,
        contact,
        bookingRef,
        setBookingRef,
        heldSeats,
        setHeldSeats,
    } = useBooking();

    const [order, setOrder] = useState(null);
    const [travelClass, setTravelClass] = useState(null);
    const [stage, setStage] = useState('loading');
    const [failure, setFailure] = useState(null);
    const [secondsLeft, setSecondsLeft] = useState(ORDER_TTL_SECONDS);

    // The train's real timetable. Separate from the booking effect below because
    // a failure to load the route must not block the booking — the traveller can
    // still pay, they just see less detail.
    const [trainDetail, setTrainDetail] = useState(null);
    const [trainDetailFailed, setTrainDetailFailed] = useState(false);

    // The journey the seats were picked for. A berth's identity is its seat plus
    // the date it is being held for, so dropping this would let two bookings on
    // different days claim the same seat.
    const travelDate = searchParams?.date ?? null;

    // 0. The train record behind this booking.
    useEffect(() => {
        const trainNo = selectedTrain?.number;
        if (!trainNo) return undefined;

        let cancelled = false;
        bookingService
            .getTrainDetails(trainNo)
            .then((res) => {
                if (!cancelled) setTrainDetail(res?.data ?? res ?? null);
            })
            .catch(() => {
                if (!cancelled) setTrainDetailFailed(true);
            });

        return () => {
            cancelled = true;
        };
    }, [selectedTrain?.number]);

    // 1. Make sure a server-side booking exists, then mint the payment order.
    //    Both are one-time per booking; a re-entry reuses the live order.
    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                // A review reached with nothing selected — a deep link, or a
                // browser that dropped the draft — has no booking to charge for.
                // Say so plainly instead of failing later on a class we would
                // have had to invent, because inventing a class means inventing
                // a price.
                if (!selectedTrain) {
                    throw Object.assign(
                        new Error('No booking in progress. Start from Search to book a ticket.'),
                        { fatal: true },
                    );
                }
                const resolved = resolveTravelClass(selectedClass, selectedTrain);
                if (!resolved) {
                    throw Object.assign(
                        new Error('Could not work out the travel class for this booking. Start from Search to book a ticket.'),
                        { fatal: true },
                    );
                }
                if (passengers.length === 0) {
                    throw Object.assign(
                        new Error('No passengers on this booking. Start from Search to book a ticket.'),
                        { fatal: true },
                    );
                }

                /**
                 * The seats must actually be bookable before anything is posted.
                 *
                 * `POST /bookings/confirm` rejects a berth with no coach or number
                 * as a 400 — "Each seat needs a coach and a seat number." — and
                 * that surfaced here as the generic "Could not start the payment",
                 * which is no help at all: the traveller had picked berths and was
                 * told payment was the problem.
                 *
                 * The draft can arrive in this state after a reload, or from a
                 * session saved by an older build. Caught here, with a route back
                 * to the seat map, instead of as an opaque gateway failure.
                 */
                const usableSeats = selectedSeats.filter(
                    (s) => s?.coach && s?.number != null && String(s.number) !== '',
                );
                if (usableSeats.length !== selectedSeats.length) {
                    throw Object.assign(
                        new Error(
                            'Your berth selection is incomplete. Please choose your berths again.',
                        ),
                        { fatal: true, needsSeats: true },
                    );
                }
                if (usableSeats.length === 0) {
                    throw Object.assign(
                        new Error('No berth selected yet. Choose one from the seat map.'),
                        { fatal: true, needsSeats: true },
                    );
                }
                setTravelClass(resolved.code);

                // A local, not the state variable: setHoldExpiresAt has not taken
                // effect yet within this same tick, and the countdown below reads
                // this on the very next line.
                let holdDeadline = null;

                let ref = bookingRef;

                const confirmFreshBooking = async (replacesBookingRef) => {
                    const booking = await bookingService.confirmBooking({
                        train: {
                            number: selectedTrain?.number,
                            name: selectedTrain?.name,
                            class: resolved.code,
                        },
                        route: {
                            from: selectedTrain?.source,
                            to: selectedTrain?.destination,
                        },
                        passengers: passengers.map((p) => ({ name: p.name, age: p.age, gender: p.gender })),
                        contact: {
                            // The address typed on the passenger step, falling back
                            // to the signed-in account. `user?.email` alone meant a
                            // guest's ticket had no contact at all, because there
                            // is no user.
                            email: contact?.email || user?.email || undefined,
                            phone: contact?.phone || user?.phone || undefined,
                        },
                        // This is what starts the seat clock. The server claims
                        // these berths in `seat_holds` and answers 409 if another
                        // traveller got to them first — at which point nothing is
                        // held, no order is minted, and the traveller goes back to
                        // the seat map. Departure date is part of a seat's
                        // identity: B1-24 today is not B1-24 tomorrow.
                        seats: selectedSeats.map((s) => ({ coach: s.coach, number: s.number, type: s.type })),
                        departureDate: travelDate,
                        // Hands the previous attempt's seats back in the same
                        // transaction that claims these. Omitted on a first
                        // booking, where there is nothing to supersede.
                        replacesBookingRef,
                    });
                    ref = booking.bookingRef;
                    holdDeadline = booking.holdExpiresAt ?? null;
                    if (!cancelled) {
                        setBookingRef(ref);
                        setHeldSeats(booking.seats ?? []);
                    }
                };

                // Re-confirm when there is no booking yet, or when the traveller
                // has changed their selection since the last one. In the second
                // case the old reference is superseded rather than abandoned.
                const needsFreshBooking = !ref || (heldSignature && seatSignature !== heldSignature);
                if (needsFreshBooking) await confirmFreshBooking(ref || undefined);

                /**
                 * `bookingRef` is kept in sessionStorage, which outlives the
                 * backend process — but the server keeps bookings in an in-memory
                 * map. A reference saved before a restart therefore names a
                 * booking that no longer exists, and create-order answers 404
                 * with a reference the server has never heard of.
                 *
                 * That is recoverable, so it must not be shown as a dead end: drop
                 * the stale reference, mint a fresh booking, and try once more.
                 * Bounded to a single attempt — retrying forever would turn a
                 * genuine "unknown booking" into a loop and re-hold the seats on
                 * every pass.
                 */
                let created;
                try {
                    created = await paymentService.createOrder(ref);
                } catch (err) {
                    if (err?.code !== 'NOT_FOUND' || cancelled) throw err;
                    if (!cancelled) setBookingRef(null);
                    // The stale reference's holds are released as the fresh ones
                    // are claimed. Superseding the dead reference is what stops a
                    // retry from being refused by the seats the previous attempt
                    // is still holding.
                    await confirmFreshBooking(ref);
                    created = await paymentService.createOrder(ref);
                }

                if (cancelled) return;

                setOrder(created);
                setStage('ready');

                /**
                 * Count down to the SEAT deadline, not the payment order's.
                 *
                 * The hold is claimed a moment before the order is minted, so it
                 * always expires first — and it is the seat that goes back on sale
                 * when it does. Counting to the order's deadline instead would
                 * show the traveller a seat as theirs for the last few seconds
                 * after it had already been handed to somebody else.
                 *
                 * `holdExpiresAt` is MySQL's own timestamp, so the browser is
                 * never guessing which clock is right — it is only subtracting.
                 */
                const deadline = holdDeadline ?? (() => {
                    const createdAt = Date.parse(created.createdAt);
                    const elapsed = Number.isNaN(createdAt) ? 0 : Math.floor((Date.now() - createdAt) / 1000);
                    return Date.now() + (ORDER_TTL_SECONDS - elapsed) * 1000;
                })();

                setSecondsLeft(Math.max(Math.round((deadline - Date.now()) / 1000), 0));
            } catch (err) {
                if (cancelled) return;
                setFailure({
                    title: err?.needsSeats
                        ? 'Choose your berths'
                        : err?.fatal
                          ? 'No booking in progress'
                          : err?.code === 'SEATS_UNAVAILABLE'
                            ? 'Those seats have just gone'
                            : 'Could not start the payment',
                    message: err?.message || 'Please try again.',
                    code: err?.code,
                    fatal: Boolean(err?.fatal),
                    // Routes the recovery to the seat map rather than to search,
                    // so a traveller who has already filled in every passenger
                    // detail does not have to do it again.
                    needsSeats: Boolean(err?.needsSeats),
                });
                setStage('error');
            }
        })();

        return () => {
            cancelled = true;
        };
        // Runs once per mount: both calls are idempotent for the same booking.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (stage !== 'ready' || secondsLeft <= 0) return;
        const timerId = setInterval(() => {
            setSecondsLeft((t) => Math.max(t - 1, 0));
        }, 1000);
        return () => clearInterval(timerId);
    }, [stage, secondsLeft]);

    // 2. The one action: open Razorpay Checkout over this page.
    const handlePay = useCallback(async () => {
        if (!order) return;
        setFailure(null);
        setStage('opening');

        try {
            await openCheckout({
                orderId: order.orderId,
                amount: order.amount,
                // The key id rides along with the order so Checkout and the
                // order were minted with the same key pair. Razorpay rejects a
                // mismatched pair outright.
                keyId: order.keyId,
                description: `${order.trainNo} · ${order.fromStation} to ${order.toStation}`,
                prefill: {
                    name: order.passengerName || passengers[0]?.name || undefined,
                    email: order.passengerEmail || user?.email || undefined,
                    contact: order.passengerContact || user?.phone || undefined,
                },
                notes: {
                    bookingRef: order.bookingRef,
                    train: order.trainNo,
                    route: `${order.fromStation}-${order.toStation}`,
                },
                onSuccess: (response) => {
                    // Persist before navigating: the processing page has to be
                    // able to finish the job even if the tab is reloaded.
                    paymentAttempt.save({
                        razorpayPaymentId: response.razorpay_payment_id,
                        razorpayOrderId: response.razorpay_order_id,
                        razorpaySignature: response.razorpay_signature,
                        bookingRef: order.bookingRef,
                    });
                    navigate('/booking/payment/processing');
                },
                onFailure: (response) => {
                    setStage('ready');
                    setFailure({
                        title: 'Payment not completed',
                        message: response?.error?.description || 'The payment was not completed. You can try again.',
                        code: response?.error?.code,
                    });
                },
                onDismiss: () => setStage((s) => (s === 'opening' ? 'ready' : s)),
            });
        } catch (err) {
            setStage('ready');
            setFailure({
                title: 'Could not open secure checkout',
                message: err?.message || 'Please try again.',
                code: err?.code,
            });
        }
    }, [order, passengers, user, navigate]);

    const retry = useCallback(() => {
        setFailure(null);
        setStage('loading');
        setOrder(null);
        window.location.reload();
    }, []);

    const expired = secondsLeft <= 0 && stage !== 'loading';
    const travellerCount = Math.max(passengers.length, 1);

    /** Distinct coaches from the current selection, in the order chosen. */
    const assignedCoaches = [
        ...new Set(selectedSeats.map((s) => s.coach).filter(Boolean)),
    ];
    const breakdown = order?.fare?.breakdown ?? [];
    const trainNumber = selectedTrain?.number || trainDetail?.trainNumber || '';
    const trainName = trainDetail?.trainName || selectedTrain?.name || '';
    const travelClassLabel = selectedTrain?.class || 'AC 3 Tier (3A)';

    /**
     * Everything the itinerary card shows, derived from the train record.
     *
     * `selectedTrain` is whatever the search result carried; `trainDetail` is the
     * authoritative record from `GET /trains/:trainNo`. The detail wins on every
     * field it can answer, and the search result is the fallback only while it
     * loads — so there is no window where the screen shows invented data.
     */
    const trainType = trainDetail?.trainType || selectedTrain?.type || 'Train';
    const pantryAvailable = trainDetail?.pantryAvailable ?? selectedTrain?.pantryAvailable ?? null;
    const runningDaysLabel = (() => {
        const days = trainDetail?.runningDays;
        if (!Array.isArray(days) || days.length === 0) return null;
        if (days.length === 7) return 'Runs daily';
        return `Runs ${days.join(', ')}`;
    })();

    const fromStationCode = selectedTrain?.source?.code ?? selectedTrain?.source ?? '';
    const toStationCode = selectedTrain?.destination?.code ?? selectedTrain?.destination ?? '';

    /**
     * What we have asked for, as one comparable string.
     *
     * The journey is part of it, not just the berths: a seat's availability is a
     * bitmask, so changing origin or destination changes which berths can be
     * claimed even when the traveller picked exactly the same seat numbers. Left
     * out of the comparison, a traveller who changed their destination would keep
     * the old hold and be charged for a journey they are not taking.
     */
    const journeySignature = `${fromStationCode}->${toStationCode}`;
    const seatSignature = `${journeySignature}|${selectedSeats
        .map((s) => `${String(s.coach).toUpperCase()}-${s.number}`)
        .sort()
        .join(',')}`;

    /**
     * The same signature, computed from the seats the server is actually holding.
     *
     * Compared against `seatSignature` to decide whether the traveller changed
     * their selection since the last confirm — if they did, the old reference is
     * superseded rather than paid for. `null` when nothing is held, which is
     * deliberately falsy: it means "unknown", not "changed", so a first attempt
     * is not needlessly re-confirmed.
     *
     * The held rows come back from the server as `seatNumber` while the local
     * selection uses `number`, so both are read. Normalising on only one of them
     * would make every hold look different from its own selection, and the page
     * would re-confirm — and re-hold — on every single payment attempt.
     *
     * This was previously referenced in the payment effect but never declared,
     * which threw a ReferenceError that the surrounding catch turned into a
     * generic "Could not start the payment" — so no booking could complete.
     */
    const heldSignature = heldSeats.length > 0
        ? `${journeySignature}|${heldSeats
            .map((s) => `${String(s.coach).toUpperCase()}-${s.seatNumber ?? s.number}`)
            .sort()
            .join(',')}`
        : null;
    const fromStationName = selectedTrain?.source?.name ?? fromStationCode;
    const toStationName = selectedTrain?.destination?.name ?? toStationCode;

    const journey = useMemo(
        () => deriveJourney({ ...trainDetail, date: travelDate }, fromStationCode, toStationCode),
        [trainDetail, travelDate, fromStationCode, toStationCode],
    );

    return (<div className="min-h-screen bg-fog/20 pb-20">
      {/* Yatrio Multi-Step Breadcrumb */}
      <div className="border-b border-line bg-white sticky top-16 z-20 shadow-subtle">
        <div className="max-w-6xl mx-auto px-4 lg:px-8 py-3.5">
          <div className="flex items-center justify-between max-w-xl mx-auto">
            <button onClick={() => navigate('/booking/passenger-details')} className="flex items-center gap-2 text-ink hover:text-royal transition-colors cursor-pointer">
              <span className="num size-7 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold flex items-center justify-center">
                <Check className="size-4 stroke-[2.5]"/>
              </span>
              <span className="text-caption font-semibold text-ink hidden sm:inline">Passengers</span>
            </button>
            <div className="h-0.5 w-12 bg-emerald-500 rounded-full"/>

            <button onClick={() => navigate('/booking/seat-selection')} className="flex items-center gap-2 text-ink hover:text-royal transition-colors cursor-pointer">
              <span className="num size-7 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold flex items-center justify-center">
                <Check className="size-4 stroke-[2.5]"/>
              </span>
              <span className="text-caption font-semibold text-ink hidden sm:inline">Seats</span>
            </button>
            <div className="h-0.5 w-12 bg-emerald-500 rounded-full"/>

            <div className="flex items-center gap-2">
              <span className="num size-7 rounded-full bg-royal text-paper text-xs font-bold flex items-center justify-center ring-4 ring-royal/15">
                3
              </span>
              <span className="text-caption font-bold text-royal">Review &amp; Pay</span>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 lg:px-8 py-8">
        <Button variant="ghost" size="sm" onClick={() => navigate('/booking/seat-selection')} className="mb-6 -ml-2 text-ink-soft hover:text-ink gap-1.5">
          <ArrowLeft className="size-4"/> Back to Seat Selection
        </Button>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8 items-start">
          {/* Main Review Column */}
          <div className="space-y-6">
            <div>
              <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-royal">
                Step 3 of 3
              </span>
              <h1 className="text-h2 font-bold tracking-tight text-ink mt-0.5">
                Review Your Itinerary
              </h1>
              <p className="text-body text-ink-soft mt-1">
                Please double-check train timings, passenger names, and allocated coach berths before payment.
              </p>
            </div>

            {/* Train / Journey Card */}
            <Card className="p-0 overflow-hidden border-line-mid shadow-card rounded-card">
              <div className="bg-gradient-to-r from-navy via-royal to-azure text-paper p-5 flex flex-wrap justify-between items-center gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="num text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-white/20 text-white">
                      {trainType}
                    </span>
                    <span className="text-xs text-paper/80 font-medium">{runningDaysLabel}</span>
                  </div>
                  <h2 className="text-h3 font-bold mt-1 text-paper">
                    {trainNumber} {trainName}
                  </h2>
                </div>
                <Badge variant="outline" className="border-white/30 text-paper font-semibold bg-white/10">
                  {travelClass ?? travelClassLabel} · General Quota
                </Badge>
              </div>

              <div className="p-6 bg-white space-y-6">
                {/* Silently rendering an empty route would read as "this train goes nowhere".
                    Say the lookup failed instead. */}
                {trainDetailFailed && (
                  <p className="rounded-control border border-warning/40 bg-warning/10 p-3 text-caption text-body">
                    Could not load this train&apos;s timetable, so the route and timings below
                    are unavailable. Your booking and fare are unaffected.
                  </p>
                )}

                <RouteConnector
                  fromCode={journey.from?.station?.code ?? fromStationCode}
                  toCode={journey.to?.station?.code ?? toStationCode}
                  fromName={journey.from?.station?.name ?? fromStationName}
                  toName={journey.to?.station?.name ?? toStationName}
                  depTime={journey.departureTime}
                  arrTime={journey.arrivalTime}
                  duration={formatDuration(journey.durationMinutes)}
                  size="lg"
                />

                {/* Only shown when the route genuinely covers both ends. Without
                    this the traveller would approve a segment nobody confirmed
                    runs on this train. */}
                {!journey.exact && journey.stops.length > 0 && (
                  <p className="rounded-control border border-warning/40 bg-warning/10 p-3 text-caption text-body">
                    This train&apos;s timetable does not list both of your stations, so the
                    times above are for the whole route. Confirm before paying.
                  </p>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-line text-sm">
                  <div>
                    <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                      Departure Date
                    </span>
                    <span className="font-semibold text-ink mt-0.5 block">
                      {formatDateLong(journey.departureDate ?? travelDate)}
                    </span>
                  </div>
                  <div>
                    <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                      Platform
                    </span>
                    <span className="font-semibold text-ink mt-0.5 block">
                      {journey.departurePlatform ? `PF #${journey.departurePlatform}` : 'Not published'}
                    </span>
                  </div>
                  <div>
                    <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                      Distance
                    </span>
                    <span className="font-semibold text-ink mt-0.5 block">
                      {journey.distanceKm !== null ? `${journey.distanceKm.toLocaleString('en-IN')} km` : '--'}
                    </span>
                  </div>
                  <div>
                    <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                      Pantry Car
                    </span>
                    <span
                      className={
                        pantryAvailable
                          ? 'font-semibold text-emerald-700 mt-0.5 block'
                          : 'font-semibold text-ink-soft mt-0.5 block'
                      }
                    >
                      {pantryAvailable ? 'Available' : 'Not available'}
                    </span>
                  </div>
                </div>

                {/* The full timetable for this segment, so the traveller is
                    approving a real journey rather than two endpoint labels. */}
                {journey.stops.length > 1 && (
                  <div className="pt-4 border-t border-line">
                    <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft">
                      Route ({journey.stops.length} stop{journey.stops.length > 1 ? 's' : ''})
                    </span>
                    <ol className="mt-3 space-y-2">
                      {journey.stops.map((stop) => (
                        <li key={stop.sequence} className="flex items-baseline justify-between gap-4 text-sm">
                          <span className="flex items-baseline gap-2.5">
                            <span className="num size-5 rounded-full bg-fog text-ink-soft text-[10px] font-bold flex items-center justify-center shrink-0">
                              {stop.sequence}
                            </span>
                            <span className="num font-semibold text-ink">{stop.station.code}</span>
                            <span className="text-ink-soft truncate">{stop.station.name}</span>
                          </span>
                          <span className="num text-ink-soft shrink-0">
                            {formatClock(stop.arrivalTime ?? stop.departureTime)}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            </Card>

            {/* Passenger Manifest Card */}
            <Card className="p-6 space-y-4 border-line-mid shadow-card rounded-card">
              <div className="flex justify-between items-center border-b border-line pb-3">
                <h3 className="text-h4 font-bold text-ink">
                  Traveller Manifest ({travellerCount})
                </h3>
                {/*
                  The coaches actually selected, not a literal "Coach B1".
                  Every booking that is not in coach B1 was displaying B1 here
                  while the row below it named the real berth.
                */}
                <span className="text-caption text-ink-soft">
                  {assignedCoaches.length > 0
                    ? `Coach ${assignedCoaches.join(', ')}`
                    : 'No berth selected yet'}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-line text-eyebrow text-ink-soft font-semibold uppercase tracking-[0.16em]">
                      <th className="py-2.5 px-3">#</th>
                      <th className="py-2.5 px-3">Passenger</th>
                      <th className="py-2.5 px-3">Age / Gender</th>
                      <th className="py-2.5 px-3">Berth Choice</th>
                      <th className="py-2.5 px-3 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line text-sm">
                    {/**
                     * Nothing is invented here.
                     *
                     * The empty case used to render a fabricated row — "Primary
                     * Passenger, 32 / Male, Coach B1 · 24 (Lower)" — badged
                     * CONFIRMED. So a booking with no passengers yet displayed a
                     * confirmed ticket for someone who does not exist, in a berth
                     * nobody picked. The real branch had the same habit in milder
                     * form, falling back to `'B1'`, `24 + idx` and `'Lower'`.
                     *
                     * Both now say what is actually known. An unallocated berth is
                     * shown as unallocated: on the review step that is a prompt to
                     * go and pick one, which is better than a number that looks
                     * real.
                     */}
                    {passengers.length === 0 ? (<tr>
                        <td className="py-3.5 px-3 text-ink-soft" colSpan={5}>
                          No passengers added yet. Go back a step to add travellers for this booking.
                        </td>
                      </tr>) : (passengers.map((p, idx) => {
            const seat = selectedSeats[idx];
            const berth = seat?.coach
              ? `Coach ${seat.coach} · ${seat.number} (${seat.type ?? p.berthPreference ?? 'Any'})`
              : 'Berth not selected yet';
            return (<tr key={p.id}>
                            <td className="py-3.5 px-3 num font-bold text-royal">{idx + 1}</td>
                            <td className="py-3.5 px-3 font-semibold text-ink">{p.name || `Passenger ${idx + 1}`}</td>
                            <td className="py-3.5 px-3 text-ink-soft">{p.age ? `${p.age} / ${p.gender}` : p.gender}</td>
                            <td className="py-3.5 px-3">
                              <span className="num font-semibold text-ink">{berth}</span>
                            </td>
                            <td className="py-3.5 px-3 text-right">
                              {/*
                                The seat is held, not confirmed — nothing is
                                confirmed until the payment captures, which is
                                what the next step does. Badging every passenger
                                CONFIRMED here claimed a ticket that did not yet
                                exist.
                              */}
                              <Badge variant={order?.status === 'captured' ? 'success' : 'outline'}>
                                {order?.status === 'captured' ? 'CONFIRMED' : 'SEAT HELD'}
                              </Badge>
                            </td>
                          </tr>);
        }))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Travel Guidelines Alert */}
            <div className="rounded-card border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-900 flex items-start gap-3">
              <AlertCircle className="size-5 text-amber-600 shrink-0 mt-0.5"/>
              <div className="space-y-1">
                <span className="font-semibold text-amber-950 block">Important Travel Advisory</span>
                <p className="text-caption text-amber-900/90 leading-relaxed">
                  Passengers must carry original photo ID during the journey. Cancellation charges apply as per Ministry of Railways refund rules.
                </p>
              </div>
            </div>
          </div>

          {/* Sticky Fare Breakdown — also the payment launcher */}
          <aside className="space-y-4 sticky top-28">
            <Card className="p-6 space-y-6 border-line-mid shadow-raised rounded-card">
              <div>
                <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft">
                  Payment Summary
                </span>
                <h3 className="text-h4 font-bold text-ink mt-0.5">
                  Fare Breakdown
                </h3>
              </div>

              {stage === 'loading' && (<div className="space-y-3" aria-busy="true" aria-live="polite">
                <span className="sr-only">Preparing your secure checkout</span>
                <div className="animate-shimmer rounded-control bg-[linear-gradient(90deg,#E9EEF4_0%,#F7F9FC_50%,#E9EEF4_100%)] bg-[length:200%_100%] p-4 space-y-2.5">
                  <div className="h-3 w-3/4 rounded-full bg-fog"/>
                  <div className="h-3 w-2/3 rounded-full bg-fog"/>
                  <div className="h-3 w-1/2 rounded-full bg-fog"/>
                </div>
                <div className="h-11 w-full rounded-control bg-fog"/>
              </div>)}

              {stage === 'error' && (<div role="alert" className="space-y-3">
                <div className="flex gap-3 rounded-card border border-status-error/30 bg-status-error/8 p-4">
                  <AlertTriangle className="mt-0.5 size-5 shrink-0 text-error-strong" aria-hidden/>
                  <div>
                    <p className="text-body font-semibold text-error-strong">{failure?.title}</p>
                    <p className="text-caption text-body mt-0.5">{failure?.message}</p>
                  </div>
                </div>
                {/* A seat conflict is the one failure a reload cannot fix: the berth is
                    genuinely sold now, and retrying would ask for the same one and
                    be refused identically. Send them to the map instead. */}
                {failure?.needsSeats
                  ? (<Button size="lg" fullWidth onClick={() => navigate('/booking/seat-selection')} leftIcon={<ArrowLeft className="size-4"/>}>
                      Choose your berths
                    </Button>)
                  : failure?.fatal
                    ? (<Button size="lg" fullWidth onClick={() => navigate(selectedTrain ? `/trains/${selectedTrain.id}` : '/search')}>
                        {selectedTrain ? 'Choose a class' : 'Start a new booking'}
                      </Button>)
                    : failure?.code === 'SEATS_UNAVAILABLE'
                      ? (<Button size="lg" fullWidth onClick={() => navigate('/booking/seat-selection')} leftIcon={<ArrowLeft className="size-4"/>}>
                          Choose different seats
                        </Button>)
                      : (<Button onClick={retry} size="lg" fullWidth leftIcon={<RefreshCw className="size-4"/>}>
                          Try again
                        </Button>)}
              </div>)}

              {order && (<div className="space-y-3 text-sm">
                {failure && (<div role="alert" className="flex gap-3 rounded-card border border-status-error/30 bg-status-error/8 p-3.5">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-error-strong" aria-hidden/>
                  <div>
                    <p className="text-body font-semibold text-error-strong">{failure.title}</p>
                    <p className="text-caption text-body mt-0.5">{failure.message}</p>
                    {failure.code && (<span className="num text-caption text-label mt-1 inline-block">{failure.code}</span>)}
                  </div>
                </div>)}

                <div className="space-y-2.5">
                  {breakdown.map((line) => (<div key={line.key} className="flex justify-between gap-4">
                    <span className="text-ink-soft">{line.label}</span>
                    <span className={cn('num font-medium', line.amount < 0 ? 'text-success-strong' : 'text-ink')}>
                      {line.amount < 0 ? '−' : ''}{paise(Math.abs(line.amount))}
                    </span>
                  </div>))}
                </div>

                <div className="border-t border-line-strong border-dashed pt-4 flex justify-between items-baseline">
                  <div>
                    <span className="text-body font-bold text-ink block">Total Payable</span>
                    <span className="text-[11px] text-ink-muted">All taxes included</span>
                  </div>
                  <span className="num text-h2 font-black text-royal">
                    {paise(order.amount)}
                  </span>
                </div>
              </div>)}

              {!isRazorpayConfigured() && (<div className="rounded-control border border-warning/40 bg-warning/10 p-3.5 text-caption text-body">
                <b className="font-semibold text-warning-strong">Razorpay key missing.</b> Set <span className="num">VITE_RAZORPAY_KEY_ID</span> in Frontend/.env and restart the dev server.
              </div>)}

              <div className="space-y-3">
                {/* An expired window is not a dead end: create-order mints a
                    fresh order for the same booking, so a reload is enough. */}
                {expired ? (<Button onClick={retry} size="lg" fullWidth leftIcon={<RefreshCw className="size-4"/>}>
                  Start a new payment
                </Button>) : (<Button
                  onClick={handlePay}
                  disabled={!order || !isRazorpayConfigured()}
                  size="lg"
                  fullWidth
                  isLoading={stage === 'opening'}
                  rightIcon={<ArrowRight className="size-4"/>}
                >
                  Proceed to Payment
                </Button>)}

                <div className="flex items-center justify-between border-t border-line pt-4">
                  <span className="inline-flex items-center gap-2 text-caption text-ink-soft">
                    <span className={cn('size-1.5 rounded-full', expired ? 'bg-status-error' : 'bg-sky')}/>
                    {expired ? 'Window closed' : 'Reserved for you'}
                  </span>
                  <span className={cn('num text-caption font-medium', expired ? 'text-error-strong' : 'text-ink-soft')}>
                    {formatTime(secondsLeft)}
                  </span>
                </div>

                {/* What the countdown is actually holding. Naming the berths is the
                    difference between "5 minutes" and "you have B1-24 and B1-25
                    for five minutes". */}
                {!expired && selectedSeats.length > 0 && (<p className="text-center text-caption text-ink-muted">
                  Seat{selectedSeats.length > 1 ? 's' : ''}{' '}
                  <span className="num font-medium text-ink-soft">
                    {selectedSeats.map((s) => `${s.coach}-${s.number}`).join(', ')}
                  </span>
                </p>)}

                {expired && (<p className="text-caption text-ink-soft text-center">
                  This window has closed and your berths are back on sale for other
                  travellers. Your passenger details are kept — start a new payment to
                  pick seats again.
                </p>)}

                <p className="flex items-center justify-center gap-2 text-caption text-ink-soft">
                  <RazorpayMark/>
                  <span>Razorpay verified</span>
                </p>

                {order?.bookingRef && (<p className="border-t border-line pt-4 text-caption text-ink-soft">
                  Reference <span className="num font-medium text-ink">{order.bookingRef}</span>
                </p>)}
              </div>
            </Card>

            {/* Demo Notice */}
            <div className="rounded-card border border-azure/20 bg-blue-100 p-4 text-caption text-body flex items-start gap-2.5">
              <ShieldCheck className="size-4 text-royal shrink-0 mt-0.5"/>
              <p>
                <b className="font-semibold text-royal">Demo Sandbox Mode:</b> Razorpay's test checkout is live — use a
                test card or the mock UPI page. No real money moves and no real ticket is issued.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>);
}