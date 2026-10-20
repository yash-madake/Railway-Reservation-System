import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, ArrowRight, ShieldCheck, Loader2, AlertTriangle, Armchair } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useBooking } from '@/context/BookingContext';
import { bookingService } from '@/services/bookingService';
import { cn } from '@/lib/utils';

/**
 * Seat selection — driven by the database, and aware of segments.
 *
 * ## What changed
 *
 * This page used to invent its own coaches (four hardcoded B1–B4) and its own
 * berths (64 per coach, with `i % 5 === 0` marked occupied). Nothing in the
 * database knew any of it existed, so there was no question it could answer:
 * not which berths were free, and certainly not which were free *for this
 * journey*. Both are now read from `coaches` / `coach_seats` / `seat_inventory`.
 *
 * ## The three states a berth can be in
 *
 *   free       no segment of this journey is claimed — selectable
 *   partial    free for us, but sold on a leg outside our journey. Still
 *              selectable, and worth showing: it is the whole reason a berth
 *              can be sold twice, and hiding it would make the map lie about
 *              how full the train is
 *   taken      one of OUR segments is claimed — not selectable
 *
 * The test is a bitwise AND against the mask of this traveller's own journey,
 * which the server returns so the browser never has to derive it.
 */

const BERTH_SHORT = {
    LOWER: 'L',
    MIDDLE: 'M',
    UPPER: 'U',
    SIDE_LOWER: 'SL',
    SIDE_MIDDLE: 'SM',
    SIDE_UPPER: 'SU',
    CHAIR: 'C',
    SEAT: 'S',
};

const BERTH_LABEL = {
    LOWER: 'Lower',
    MIDDLE: 'Middle',
    UPPER: 'Upper',
    SIDE_LOWER: 'Side Lower',
    SIDE_MIDDLE: 'Side Middle',
    SIDE_UPPER: 'Side Upper',
    CHAIR: 'Chair Car',
    SEAT: 'Seat',
};

/** Berths that sit beside the aisle rather than in the bay stack. */
const SIDE_BERTHS = new Set(['SIDE_LOWER', 'SIDE_MIDDLE', 'SIDE_UPPER']);

/** How many berths stack in one bay, by carriage layout. */
const BAY_WIDTH = {
    AC_3_TIER: 3,
    AC_2_TIER: 2,
    AC_FIRST: 2,
    SLEEPER: 1,
    CHAIR_CAR: 1,
    EXECUTIVE: 1,
    GENERAL: 1,
};

/**
 * Does this berth have one of our segments?
 *
 * BigInt because the masks are 64-bit and do not survive a JS number intact.
 * The server sends them as decimal strings for exactly this reason.
 */
const conflicts = (seatMask, journeyMask) => {
    if (!journeyMask) return false;
    try {
        return (BigInt(seatMask || '0') & BigInt(journeyMask)) !== 0n;
    } catch {
        return false;
    }
};

/** Is this berth claimed anywhere at all, on any leg? */
const claimedAtAll = (seatMask) => {
    try {
        return BigInt(seatMask || '0') !== 0n;
    } catch {
        return false;
    }
};

export function SeatSelection() {
    const navigate = useNavigate();
    const { selectedTrain, selectedClass, searchParams, passengers, selectedSeats, addSeat, removeSeat } = useBooking();

    const [availability, setAvailability] = useState(null);
    const [loadError, setLoadError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeCoach, setActiveCoach] = useState(null);

    const trainNo = selectedTrain?.number;
    const travelClass = selectedClass || selectedTrain?.class;
    const travelDate = searchParams?.date;
    const fromCode = selectedTrain?.source?.code ?? selectedTrain?.source;
    const toCode = selectedTrain?.destination?.code ?? selectedTrain?.destination;

    const load = useCallback(async () => {
        if (!trainNo || !travelClass || !travelDate) {
            setLoadError({ message: 'Pick a train and a date before choosing seats.' });
            setLoading(false);
            return;
        }
        setLoading(true);
        setLoadError(null);
        try {
            const res = await bookingService.getSeatAvailability({
                trainNo,
                travelClass,
                date: travelDate,
                from: fromCode,
                to: toCode,
            });
            const payload = res?.data ?? res;
            setAvailability(payload);
            // Default to the first coach that actually has a berth free for us,
            // rather than blindly the first one — on a nearly-full train the
            // first coach is often not it.
            const firstUsable = payload?.coaches?.find((c) =>
                c.seats.some((s) => !conflicts(s.segmentMask, payload?.journey?.mask)),
            );
            setActiveCoach((current) => current ?? firstUsable?.coach ?? payload?.coaches?.[0]?.coach ?? null);
        } catch (err) {
            setLoadError({ message: err?.message || 'Could not load the seat map.' });
        } finally {
            setLoading(false);
        }
    }, [trainNo, travelClass, travelDate, fromCode, toCode]);

    useEffect(() => {
        load();
    }, [load]);

    const journeyMask = availability?.journey?.mask ?? null;

    const coaches = availability?.coaches ?? [];
    const active = coaches.find((c) => c.coach === activeCoach) ?? coaches[0] ?? null;

    /**
     * Split the coach into bay stacks and aisle-side berths, and annotate each
     * berth with its availability for this journey.
     */
    const layout = useMemo(() => {
        if (!active) return { bays: [], side: [], width: 1 };

        const width = BAY_WIDTH[active.coachType] ?? 1;

        /**
         * Stamp the coach code onto every berth.
         *
         * `GET /seats/availability` returns the coach code on the *parent* object
         * — `coaches[].coach` — and the berths carry only `seatId`, `seatNumber`,
         * `berthType`, `position` and `segmentMask`. Nothing put it back on the
         * individual seat, so `seat.coach` was `undefined` in this file.
         *
         * That broke three things at once, all downstream of one omission:
         *   - `addSeat({ coach: undefined })` sent to `POST /bookings/confirm`,
         *     which answers "Each seat needs a coach and a seat number."
         *   - `isSelected(undefined, '1')` compared `undefined === undefined`, so
         *     every berth numbered 1 in every coach matched one another — picking
         *     berth 1 in one coach highlighted it in all of them.
         *   - `removeSeat('undefined-1')` built a key nothing could match, so a
         *     selection could not be toggled off.
         *
         * Injected here rather than at each call site, because `active.coach` is
         * the authoritative value and one place cannot drift from the other.
         */
        const annotated = active.seats.map((seat) => ({
            ...seat,
            coach: active.coach,
            shortType: BERTH_SHORT[seat.berthType] ?? seat.berthType?.[0] ?? '',
            label: BERTH_LABEL[seat.berthType] ?? seat.berthType,
            isSide: SIDE_BERTHS.has(seat.berthType),
            taken: conflicts(seat.segmentMask, journeyMask),
            claimedElsewhere: !conflicts(seat.segmentMask, journeyMask) && claimedAtAll(seat.segmentMask),
        }));

        const main = annotated.filter((s) => !s.isSide);
        const side = annotated.filter((s) => s.isSide);

        const bays = [];
        for (let i = 0; i < main.length; i += width) {
            bays.push({ index: bays.length + 1, seats: main.slice(i, i + width) });
        }

        return { bays, side, width };
    }, [active, journeyMask]);

    const maxSeats = Math.max(passengers.length, 1);

    /** Selection is keyed by coach+seat, not by seat number alone. */
    const isSelected = (coach, seatNumber) =>
        selectedSeats.some((s) => s.coach === coach && String(s.number) === String(seatNumber));

    const toggleSeat = (seat) => {
        if (seat.taken) return;

        if (isSelected(seat.coach, seat.seatNumber)) {
            removeSeat(`${seat.coach}-${seat.seatNumber}`);
            return;
        }

        if (selectedSeats.length < maxSeats) {
            addSeat({ coach: seat.coach, number: String(seat.seatNumber), type: seat.label, seatId: seat.seatId });
        } else {
            // At capacity: replace the first pick rather than silently ignoring
            // the click, which is what the old page did.
            removeSeat(`${selectedSeats[0].coach}-${selectedSeats[0].number}`);
            addSeat({ coach: seat.coach, number: String(seat.seatNumber), type: seat.label, seatId: seat.seatId });
        }
    };

    const berth = (seat) => {
        const chosen = isSelected(seat.coach, seat.seatNumber);
        return cn(
            'rounded text-xs font-bold flex flex-col items-center justify-center transition-all border',
            'w-9 h-9 cursor-pointer',
            chosen && 'bg-royal border-royal text-paper shadow-sm scale-105 ring-2 ring-royal/20',
            !chosen && seat.taken && 'bg-fog-strong border-line text-ink-muted cursor-not-allowed',
            !chosen && !seat.taken && seat.claimedElsewhere && 'bg-sky-light/70 border-sky/40 text-sky-dark hover:border-royal hover:text-royal',
            !chosen && !seat.taken && !seat.claimedElsewhere && 'bg-white border-line-strong text-ink hover:border-royal hover:text-royal hover:bg-royal/5',
        );
    };

    const seatTitle = (seat) => {
        const state = isSelected(seat.coach, seat.seatNumber)
            ? 'selected by you'
            : seat.taken
              ? 'taken on your journey'
              : seat.claimedElsewhere
                ? 'free for your journey, sold on another leg'
                : 'free';
        return `${seat.coach}-${seat.seatNumber} (${seat.label}) — ${state}`;
    };

    const freeCount = (coach) =>
        coach.seats.filter((s) => !conflicts(s.segmentMask, journeyMask)).length;

    /**
     * Berths free across every coach for *this* journey.
     *
     * Counted the same way the per-coach tabs do — a mask conflict against the
     * traveller's segment — rather than as `total - taken`, which would count
     * berths that are only sold on some other leg.
     */
    const freeBerths = coaches.reduce((sum, coach) => sum + freeCount(coach), 0);

    if (loading) {
        return (
            <div className="min-h-screen bg-fog/20 flex items-center justify-center">
                <div className="flex items-center gap-3 text-ink-soft">
                    <Loader2 className="size-5 animate-spin text-royal"/>
                    <span className="text-body">Loading the seat map…</span>
                </div>
            </div>
        );
    }

    if (loadError) {
        return (
            <div className="min-h-screen bg-fog/20 flex items-center justify-center px-4">
                <Card className="max-w-md w-full p-8 text-center space-y-4">
                    <AlertTriangle className="size-8 text-error-strong mx-auto"/>
                    <p className="text-body font-semibold text-ink">Seat map unavailable</p>
                    <p className="text-caption text-ink-soft">{loadError.message}</p>
                    <Button onClick={() => navigate('/booking/passenger-details')} variant="secondary" fullWidth>
                        Back to Passenger Details
                    </Button>
                </Card>
            </div>
        );
    }

    /**
     * A successful response with no coaches.
     *
     * Distinct from a failure: `GET /seats/availability` answers 200 with
     * `coaches: []` and `totalSeats: 0` when the requested class has no mapped
     * berths. That is reachable — the draft keeps `selectedClass` across a
     * reload, so a class that was chosen on a different train is still requested
     * here.
     *
     * Without this branch the page rendered an empty seat map: no error, no
     * explanation, and a "Continue" button that led to a booking the server
     * would refuse. The API did the right thing; nothing said so.
     */
    if (coaches.length === 0) {
        return (
            <div className="min-h-screen bg-fog/20 flex items-center justify-center px-4">
                <Card className="max-w-md w-full p-8 text-center space-y-4">
                    <Armchair className="size-8 text-ink-muted mx-auto opacity-50"/>
                    <p className="text-body font-semibold text-ink">No berths mapped for this class</p>
                    <p className="text-caption text-ink-soft">
                        {travelClass
                            ? `${selectedTrain?.name ?? 'This train'} has no seat map for class ${travelClass}. Pick another class, or choose a different train.`
                            : 'This train has no seat map available yet. Pick another class, or choose a different train.'}
                    </p>
                    <Button onClick={() => navigate('/search')} fullWidth>Back to Search</Button>
                    <Button onClick={() => navigate('/booking/passenger-details')} variant="secondary" fullWidth>
                        Change class
                    </Button>
                </Card>
            </div>
        );
    }

    const trainName = selectedTrain?.name || '';

    return (
        <div className="min-h-screen bg-fog/20 pb-20">
            {/* Yatrio Multi-Step Breadcrumb */}
            <div className="border-b border-line bg-white sticky top-16 z-20 shadow-subtle">
                <div className="max-w-6xl mx-auto px-4 lg:px-8 py-3.5">
                    <div className="flex items-center justify-between max-w-2xl mx-auto">
                        <button onClick={() => navigate('/booking/passenger-details')} className="flex items-center gap-2 text-ink hover:text-royal transition-colors cursor-pointer">
                            <span className="num size-7 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold flex items-center justify-center">
                                <Check className="size-4 stroke-[2.5]"/>
                            </span>
                            <span className="text-caption font-semibold text-ink hidden sm:inline">Passengers</span>
                        </button>
                        <div className="h-0.5 w-12 bg-emerald-500 rounded-full"/>

                        <div className="flex items-center gap-2">
                            <span className="num size-7 rounded-full bg-royal text-paper text-xs font-bold flex items-center justify-center ring-4 ring-royal/15">
                                2
                            </span>
                            <span className="text-caption font-bold text-royal">Seat Selection</span>
                        </div>
                        <div className="h-0.5 w-12 bg-line rounded-full"/>

                        <div className="flex items-center gap-2 text-ink-muted">
                            <span className="num size-7 rounded-full bg-fog text-ink-muted text-xs font-semibold flex items-center justify-center">
                                3
                            </span>
                            <span className="text-caption font-medium hidden sm:inline">Review &amp; Pay</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-6xl mx-auto px-4 lg:px-8 py-8">
                <Button variant="ghost" size="sm" onClick={() => navigate('/booking/passenger-details')} className="mb-6 -ml-2 text-ink-soft hover:text-ink gap-1.5">
                    <ArrowLeft className="size-4"/> Back to Passenger Details
                </Button>

                <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-8 items-start">
                    <div className="space-y-6">
                        <div className="bg-white rounded-card border border-line-mid p-5 shadow-card flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                            <div>
                                <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-royal">
                                    Interactive Coach Bay
                                </span>
                                <h1 className="text-h3 font-bold text-ink mt-0.5">Choose Your Berths</h1>
                                <p className="text-caption text-ink-soft mt-0.5">
                                    {trainNo} {trainName} · Select {maxSeats} seat{maxSeats > 1 ? 's' : ''}
                                </p>
                            </div>
                            {availability?.journey && (
                                <div className="text-right">
                                    <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                                        Your journey
                                    </span>
                                    <span className="num text-body font-bold text-ink block">
                                        {availability.journey.fromStation} → {availability.journey.toStation}
                                    </span>
                                    <span className="num text-caption text-ink-soft">
                                        {availability.journey.distanceKm.toLocaleString('en-IN')} km ·{' '}
                                        {availability.journey.segments} of {availability.segmentCount} segments
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Legend */}
                        <div className="flex flex-wrap items-center gap-3 text-caption font-medium bg-fog/40 px-3.5 py-2 rounded-control border border-line">
                            <div className="flex items-center gap-1.5">
                                <div className="size-4 rounded-sm border border-line-strong bg-white shadow-xs"/>
                                <span className="text-ink-soft">Free</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <div className="size-4 rounded-sm bg-sky-light/70 border border-sky/40"/>
                                <span className="text-sky-dark">Free for you, sold elsewhere</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <div className="size-4 rounded-sm bg-fog-strong border border-line"/>
                                <span className="text-ink-muted">Taken on your journey</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <div className="size-4 rounded-sm bg-royal text-paper flex items-center justify-center text-[10px] font-bold">✓</div>
                                <span className="text-ink font-semibold">Selected</span>
                            </div>
                        </div>

                        {/* Coach tabs */}
                        <div className="space-y-2">
                            <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft">
                                Select Coach
                            </span>
                            <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none">
                                {coaches.map((coach) => {
                                    const free = freeCount(coach);
                                    return (
                                        <button
                                            key={coach.coach}
                                            onClick={() => setActiveCoach(coach.coach)}
                                            disabled={free === 0}
                                            className={cn(
                                                'min-w-[100px] p-3 rounded-card border text-left transition-all shrink-0 cursor-pointer',
                                                activeCoach === coach.coach
                                                    ? 'border-royal bg-royal/5 ring-2 ring-royal/20 shadow-xs'
                                                    : 'border-line bg-white hover:border-line-strong hover:bg-fog/30',
                                                free === 0 && 'opacity-45 cursor-not-allowed hover:border-line',
                                            )}
                                        >
                                            <div className="flex items-center justify-between">
                                                <span className="font-bold text-ink text-base">{coach.coach}</span>
                                                <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-fog text-ink-soft">
                                                    {coach.coachType?.replace('AC_', '')}
                                                </span>
                                            </div>
                                            <div className="text-caption text-ink-soft mt-1">
                                                {free > 0 ? (
                                                    <span className="text-emerald-700 font-semibold">{free} free</span>
                                                ) : (
                                                    <span className="text-error-strong font-medium">Full</span>
                                                )}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Coach map */}
                        {active && (
                            <Card className="p-6 overflow-x-auto bg-fog/40 border-line-mid shadow-card rounded-card relative">
                                <div className="min-w-[760px] bg-white rounded-card p-6 border border-line-strong shadow-raised my-2 relative">
                                    <div className="flex items-center justify-between pb-4 mb-6 border-b border-line">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-bold px-2 py-0.5 rounded bg-navy text-paper uppercase tracking-wider">
                                                Coach {active.coach}
                                            </span>
                                            <span className="text-caption text-ink-soft">
                                                {layout.bays.length} bay{layout.bays.length > 1 ? 's' : ''}
                                                {layout.side.length > 0 && ` · ${layout.side.length} side berths`}
                                            </span>
                                        </div>
                                        <span className="text-caption font-mono text-ink-muted">Aisle Side ➔</span>
                                    </div>

                                    <div className="flex flex-wrap gap-4">
                                        {layout.bays.map((bay) => (
                                            <div key={bay.index} className="flex flex-col gap-3">
                                                <div className="text-center">
                                                    <span className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                                                        Bay {bay.index}
                                                    </span>
                                                </div>
                                                <div className={cn('grid gap-1.5 p-2 rounded-md bg-fog/30 border border-line', `grid-cols-${Math.min(layout.width, 3)}`)}>
                                                    {bay.seats.map((seat) => (
                                                        <button
                                                            key={seat.seatId}
                                                            onClick={() => toggleSeat(seat)}
                                                            disabled={seat.taken}
                                                            title={seatTitle(seat)}
                                                            className={berth(seat)}
                                                        >
                                                            <span className="num font-bold leading-none">{seat.seatNumber}</span>
                                                            <span className={cn('text-[8px] font-normal leading-none mt-0.5', isSelected(seat.coach, seat.seatNumber) ? 'text-paper/80' : 'text-ink-muted')}>
                                                                {seat.shortType}
                                                            </span>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {layout.side.length > 0 && (
                                        <>
                                            <div className="h-4 flex items-center justify-center my-4">
                                                <div className="w-full h-px bg-line-strong/40"/>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                {layout.side.map((seat) => (
                                                    <button
                                                        key={seat.seatId}
                                                        onClick={() => toggleSeat(seat)}
                                                        disabled={seat.taken}
                                                        title={seatTitle(seat)}
                                                        className={cn(berth(seat), 'w-16 h-9 flex-row gap-1.5')}
                                                    >
                                                        <span className="num font-bold">{seat.seatNumber}</span>
                                                        <span className={cn('text-[9px] font-normal', isSelected(seat.coach, seat.seatNumber) ? 'text-paper/80' : 'text-ink-muted')}>
                                                            {seat.shortType}
                                                        </span>
                                                    </button>
                                                ))}
                                            </div>
                                        </>
                                    )}
                                </div>
                            </Card>
                        )}
                    </div>

                    {/* Summary */}
                    <aside className="space-y-4 sticky top-28">
                        <Card className="p-6 space-y-5 border-line-mid shadow-raised">
                            <div>
                                <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft">
                                    Selection Summary
                                </span>
                                <h3 className="text-h4 font-bold text-ink mt-0.5">Chosen Berths</h3>
                            </div>

                            <div className="space-y-3 min-h-[120px]">
                                {selectedSeats.length === 0 ? (
                                    <div className="rounded-card border border-dashed border-line-strong p-6 text-center text-caption text-ink-soft">
                                        Click a berth above to reserve it for a traveller.
                                    </div>
                                ) : (
                                    selectedSeats.map((seat, idx) => (
                                        <div key={`${seat.coach}-${seat.number}`} className="flex items-center justify-between p-3.5 rounded-control bg-fog/30 border border-line">
                                            <div>
                                                <div className="text-xs font-semibold text-ink line-clamp-1">
                                                    {passengers[idx]?.name || `Passenger ${idx + 1}`}
                                                </div>
                                                <div className="num text-caption font-bold text-royal mt-0.5">
                                                    Coach {seat.coach} · Berth {seat.number}
                                                </div>
                                            </div>
                                            <Badge variant="outline" className="border-line-strong font-medium bg-white">
                                                {seat.type}
                                            </Badge>
                                        </div>
                                    ))
                                )}
                            </div>

                            {availability && (
                                <div className="border-t border-line pt-4 space-y-2 text-sm">
                                    <div className="flex justify-between text-ink-soft">
                                        <span>Berths on this train</span>
                                        <span className="num font-semibold text-ink">{availability.totalSeats}</span>
                                    </div>
                                    <div className="flex justify-between text-ink-soft">
                                        <span>At least partly taken</span>
                                        <span className="num font-semibold text-ink">{availability.takenSeats}</span>
                                    </div>
                                    <div className="flex justify-between text-ink-soft">
                                        <span>Free for your journey</span>
                                        {/*
                                          The free count, not the total.
                                          This computed the difference and then
                                          printed `totalSeats`, discarding the
                                          result — so a completely full train
                                          still reported every berth as free
                                          while the per-coach tabs said "0 free".
                                        */}
                                        <span className="num font-semibold text-emerald-700">
                                            {freeBerths > 0 ? freeBerths : '—'}
                                        </span>
                                    </div>
                                </div>
                            )}

                            <Button
                                onClick={() => navigate('/booking/review')}
                                size="lg"
                                className="w-full"
                                disabled={selectedSeats.length === 0}
                            >
                                Proceed to Review
                                <ArrowRight className="size-4"/>
                            </Button>
                            {selectedSeats.length === 0 && (
                                <p className="text-caption text-ink-soft text-center">
                                    Choose {maxSeats} berth{maxSeats > 1 ? 's' : ''} to continue.
                                </p>
                            )}
                        </Card>

                        <div className="rounded-card border border-azure/20 bg-blue-100 p-4 text-caption text-body flex items-start gap-2.5">
                            <ShieldCheck className="size-4 text-royal shrink-0 mt-0.5"/>
                            <p>
                                <b className="font-semibold text-royal">Segment-aware:</b> a berth sold
                                to someone boarding further down the train is still yours if their route
                                does not overlap yours.
                            </p>
                        </div>
                    </aside>
                </div>
            </div>
        </div>
    );
}