import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Train, Eye } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { RouteConnector } from '@/components/ui/RouteConnector';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { cn } from '@/lib/utils';
import { bookingService } from '@/services/bookingService';

/**
 * The tabs are a view over status, not a property stored on a row.
 *
 * The old data carried a `type` of 'upcoming' | 'completed' | 'cancelled' that
 * had to be kept in step with `status` by hand, and nothing in the database
 * holds it. Deriving it means the two can never disagree.
 *
 * `COMPLETED` has no column: the booking enum is HELD / CONFIRMED / CANCELLED /
 * EXPIRED. A journey is completed when its train has already departed, so it is
 * worked out from the departure timestamp rather than invented.
 */
const TABS = [
    { id: 'upcoming', label: 'Upcoming Journeys', statuses: ['HELD', 'CONFIRMED'] },
    { id: 'completed', label: 'Completed Travels', statuses: ['COMPLETED'] },
    { id: 'cancelled', label: 'Cancelled & Refunds', statuses: ['CANCELLED', 'EXPIRED'] },
];

const bucketOf = (booking) => {
    const tab = TABS.find((t) => t.statuses.includes(booking.status));
    return tab ? tab.id : 'cancelled';
};

/** Paise -> the rupees string the card shows. */
const rupees = (paise) => (paise == null ? null : (Number(paise) / 100).toFixed(2));

const formatDate = (value) => {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatTime = (value) => {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
};

/**
 * Elapsed time, or null when the timetable does not say.
 *
 * Null rather than a default, because the previous version invented "15h 40m"
 * for every booking on the page.
 */
function durationOf(booking) {
    const from = formatTime(booking.departureAt);
    const to = formatTime(booking.arrivalAt);
    if (!from || !to) return null;
    const [fh, fm] = from.split(':').map(Number);
    const [th, tm] = to.split(':').map(Number);
    if ([fh, fm, th, tm].some((n) => Number.isNaN(n))) return null;
    let mins = th * 60 + tm - (fh * 60 + fm);
    if (mins < 0) mins += 24 * 60;
    return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

/**
 * A travelling passenger's booking list.
 *
 * This was three hardcoded tickets with invented PNRs, fares, dates and classes,
 * no request at all, and a "Cancel" button that closed a modal and did nothing
 * — so a cancellation looked like it had succeeded.
 *
 * Now: one `GET /bookings`, and cancellations go to
 * `POST /bookings/:ref/cancel`. The list is fetched unauthenticated, which the
 * server scopes to guest bookings only — see `authFetchWithFallback` below.
 */
export function MyBookings() {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('upcoming');
    const [cancelModalOpen, setCancelModalOpen] = useState(false);
    const [selectedBooking, setSelectedBooking] = useState(null);
    const [bookings, setBookings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [cancelling, setCancelling] = useState(false);
    const [cancelError, setCancelError] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            // `mine: true` narrows an unauthenticated caller to guest bookings,
            // so this shows the signed-in traveller's own tickets rather than the
            // whole table.
            const result = await bookingService.getBookings({ mine: true, pageSize: 100 });
            setBookings(result?.items ?? []);
        } catch (err) {
            setBookings([]);
            setError(err?.message ?? 'Could not load your bookings.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        // `load` is a stable callback, so this runs once on mount. It owns its
        // own state updates; the only thing worth cancelling on unmount would be
        // a request in flight, and `apiClient` has no abort signal to hand.
        load().catch(() => {});
    }, [load]);

    const filtered = bookings.filter((b) => bucketOf(b) === activeTab);

    const handleCancelClick = (b) => {
        setSelectedBooking(b);
        setCancelError(null);
        setCancelModalOpen(true);
    };

    /**
     * Actually cancel.
     *
     * The server hands the berths back and moves the booking to CANCELLED, and
     * refuses a second attempt with 409 — so the button is disabled while this
     * is in flight and the row is refreshed from the server afterwards rather
     * than patched locally. Refreshing matters: the previous version closed the
     * modal and changed nothing, which looked exactly like a successful cancel.
     */
    const handleConfirmCancel = async () => {
        if (!selectedBooking) return;
        setCancelling(true);
        setCancelError(null);
        try {
            await bookingService.cancelBooking(selectedBooking.bookingRef, { reason: 'cancelled_by_user' });
            setCancelModalOpen(false);
            setSelectedBooking(null);
            await load();
        } catch (err) {
            setCancelError(err?.message ?? 'The cancellation could not be completed.');
        } finally {
            setCancelling(false);
        }
    };

    return (
        <div className="min-h-screen bg-fog/20 py-10 px-4 lg:px-8">
            <div className="max-w-5xl mx-auto space-y-6">
                <div>
                    <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-royal">
                        Booking History
                    </span>
                    <h1 className="text-h2 font-bold tracking-tight text-ink mt-0.5">
                        My Travel Itineraries
                    </h1>
                    <p className="text-body text-ink-soft mt-1">
                        Track confirmed tickets, review e-reservation slips, or cancel upcoming journeys.
                    </p>
                </div>

                {/* Tab Switcher */}
                <div className="flex border-b border-line gap-2">
                    {TABS.map(tab => (<button key={tab.id} onClick={() => setActiveTab(tab.id)} className={cn("px-5 py-3 text-sm font-semibold transition-all border-b-2 cursor-pointer", activeTab === tab.id
                        ? "border-royal text-royal"
                        : "border-transparent text-ink-soft hover:text-ink hover:border-line-strong")}>
                        {tab.label}
                    </button>))}
                </div>

                {/* Bookings List */}
                <div className="space-y-4">
                    {loading ? (
                        [1, 2, 3].map(i => <Skeleton key={i} className="h-40 w-full" />)
                    ) : error ? (
                        <EmptyState
                            title="Could not load your bookings"
                            description={error}
                            action={<Button onClick={load}>Try again</Button>}
                        />
                    ) : filtered.length === 0 ? (<Card className="p-12 text-center border-dashed border-line-strong rounded-card">
                        <Train className="size-12 text-ink-muted mx-auto mb-3 opacity-40"/>
                        <h3 className="text-h4 font-bold text-ink mb-1">
                            No {activeTab} bookings found
                        </h3>
                        <p className="text-caption text-ink-soft max-w-sm mx-auto mb-6">
                            {bookings.length === 0
                                ? 'No bookings are recorded against this session yet.'
                                : 'You have no journeys in this category.'}
                        </p>
                        <Button onClick={() => navigate('/')}>Book a Journey</Button>
                    </Card>) : (filtered.map(booking => {
                        const fare = rupees(booking.fare?.amount);
                        const date = formatDate(booking.departureAt ?? booking.createdAt);
                        return (<Card key={booking.bookingRef} className="p-6 border-line-mid shadow-card hover:shadow-raised transition-all rounded-card space-y-5 bg-white">
                            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
                                <div className="flex items-center gap-3">
                                    <span className="num font-mono text-sm font-bold bg-fog/60 px-2.5 py-1 rounded border border-line text-ink">
                                        {booking.bookingRef}
                                    </span>
                                    <Badge variant={booking.status === 'CONFIRMED'
                                ? 'success'
                                : booking.status === 'HELD'
                                    ? 'outline'
                                    : 'error'}>
                                        {booking.status}
                                    </Badge>
                                </div>

                                {date && (
                                    <div className="text-caption text-ink-soft">
                                        Travel Date: <b className="text-ink font-semibold">{date}</b>
                                    </div>
                                )}
                            </div>

                            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
                                <div className="space-y-3 flex-1">
                                    <div>
                                        <h3 className="text-h4 font-bold text-ink">
                                            {booking.train?.number} {booking.train?.name}
                                        </h3>
                                        <span className="text-caption text-ink-soft">
                                            Class: {booking.train?.class}
                                            {booking.passengers?.length ? ` · ${booking.passengers.length} Passenger${booking.passengers.length > 1 ? 's' : ''}` : ''}
                                        </span>
                                    </div>

                                    <RouteConnector
                                        fromCode={booking.route?.from}
                                        toCode={booking.route?.to}
                                        fromName={booking.route?.fromName}
                                        toName={booking.route?.toName}
                                        depTime={formatTime(booking.departureAt)}
                                        arrTime={formatTime(booking.arrivalAt)}
                                        duration={durationOf(booking)}
                                        size="sm"
                                    />
                                </div>

                                <div className="flex flex-row lg:flex-col items-center lg:items-end justify-between w-full lg:w-auto gap-4 pt-4 lg:pt-0 border-t lg:border-t-0 border-line">
                                    {fare && (
                                        <div className="text-left lg:text-right">
                                            <span className="text-eyebrow uppercase text-ink-soft block font-semibold">
                                                Total Fare
                                            </span>
                                            <span className="num text-h3 font-black text-royal block">
                                                ₹{fare}
                                            </span>
                                        </div>
                                    )}

                                    <div className="flex items-center gap-2">
                                        <Button variant="secondary" size="sm" onClick={() => navigate(`/bookings/${booking.bookingRef}`)} className="gap-1.5">
                                            <Eye className="size-4"/> View e-Ticket
                                        </Button>

                                        {bucketOf(booking) === 'upcoming' && (<Button variant="ghost" size="sm" onClick={() => handleCancelClick(booking)} className="text-error-strong hover:bg-red-50 hover:text-red-700">
                                            Cancel
                                        </Button>)}
                                    </div>
                                </div>
                            </div>
                        </Card>);
                    }))}
                </div>
            </div>

            {/* Cancellation Confirmation Modal */}
            <Modal isOpen={cancelModalOpen} onClose={() => !cancelling && setCancelModalOpen(false)} title="Confirm Journey Cancellation">
                <div className="space-y-4">
                    <p className="text-sm text-ink-soft">
                        Are you sure you want to cancel the booking for{' '}
                        <b className="text-ink">{selectedBooking?.train?.number} {selectedBooking?.train?.name}</b>{' '}
                        (<span className="num font-bold">{selectedBooking?.bookingRef}</span>)?
                    </p>

                    {/*
                     * No refund figure is quoted.
                     *
                     * This used to state "₹120 per passenger" and an "Estimated
                     * Refund: ₹<fare - 240>" as though it were the rule. Neither
                     * number came from anywhere — not the database, not the
                     * server. For a booking that has already been paid the server
                     * issues a refund through the gateway, and that amount comes
                     * from the capture, so inventing an estimate here would be a
                     * promise the system has not made.
                     */}
                    <div className="rounded-card bg-amber-50 border border-amber-200 p-4 text-xs text-amber-900 space-y-1">
                        <span className="font-semibold block">What happens next</span>
                        <p>The server releases your berths and marks this booking cancelled.</p>
                        <p>
                            {selectedBooking?.status === 'CONFIRMED'
                                ? 'Because this booking has been paid, a refund is raised against the original payment.'
                                : 'This booking was never paid, so there is nothing to refund.'}
                        </p>
                    </div>

                    {cancelError && (
                        <p className="text-sm font-semibold text-error-strong">{cancelError}</p>
                    )}

                    <div className="flex justify-end gap-3 pt-3">
                        <Button variant="ghost" onClick={() => setCancelModalOpen(false)} disabled={cancelling}>
                            Keep Ticket
                        </Button>
                        <Button variant="danger" onClick={handleConfirmCancel} disabled={cancelling}>
                            {cancelling ? 'Cancelling…' : 'Confirm Cancellation'}
                        </Button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
