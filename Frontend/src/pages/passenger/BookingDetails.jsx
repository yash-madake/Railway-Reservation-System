import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Printer, Info } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { RouteConnector } from '@/components/ui/RouteConnector';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Logo } from '@/components/layout/Logo';
import { bookingService } from '@/services/bookingService';

const formatDate = (value) => {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatDateTime = (value) => {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime())
        ? null
        : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const formatTime = (value) => {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
};

/** Paise -> rupees, or null when the booking carries no fare. */
const rupees = (paise) => (paise == null ? null : (Number(paise) / 100).toFixed(2));

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

/** The booking status badge, driven by the row rather than hardcoded CNF. */
const STATUS_BADGE = {
    HELD: { variant: 'outline', label: 'AWAITING PAYMENT' },
    CONFIRMED: { variant: 'success', label: 'CONFIRMED (CNF)' },
    CANCELLED: { variant: 'error', label: 'CANCELLED' },
    EXPIRED: { variant: 'error', label: 'EXPIRED' },
};

/**
 * The e-ticket for one booking.
 *
 * This read `:id` from the route and then ignored it, printing the same literal
 * ticket for every reference: PNR 2849105832, two invented passengers on B1
 * berths 24 and 25, a ₹1,640 fare split into base/reservation/GST figures that
 * came from nowhere, and a hardcoded `CONFIRMED (CNF)` badge regardless of what
 * the booking actually was.
 *
 * It now loads `GET /bookings/:ref`. The fare is rendered from the server's own
 * `breakdown` rather than from invented categories — the server charges tax and a
 * per-booking convenience fee, not the GST-plus-reservation split this page used
 * to display.
 */
export function BookingDetails() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [booking, setBooking] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let isMounted = true;
        setLoading(true);
        setError(null);
        setBooking(null);

        bookingService
            .getBooking(id)
            .then((res) => {
                if (!isMounted) return;
                const payload = res?.data ?? res;
                if (!payload?.bookingRef) throw new Error('That booking returned no record.');
                setBooking(payload);
            })
            .catch((err) => {
                if (!isMounted) return;
                setError(err?.message ?? `No booking found for "${id}".`);
            })
            .finally(() => {
                if (isMounted) setLoading(false);
            });

        return () => {
            isMounted = false;
        };
    }, [id]);

    if (loading) {
        return (
            <div className="min-h-screen bg-fog/20 py-8 px-4 lg:px-8">
                <div className="max-w-4xl mx-auto space-y-6">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-96 w-full" />
                </div>
            </div>
        );
    }

    if (error || !booking) {
        return (
            <div className="min-h-screen bg-fog/20 py-8 px-4 lg:px-8">
                <div className="max-w-4xl mx-auto space-y-6">
                    <Button variant="ghost" onClick={() => navigate('/bookings')} className="-ml-2 text-ink-soft hover:text-ink gap-1.5">
                        <ArrowLeft className="size-4"/> Back to My Bookings
                    </Button>
                    <EmptyState
                        title="Booking not found"
                        description={error ?? `No booking matching "${id}" exists.`}
                        action={<Button onClick={() => navigate('/bookings')}>Back to My Bookings</Button>}
                    />
                </div>
            </div>
        );
    }

    const badge = STATUS_BADGE[booking.status] ?? { variant: 'outline', label: booking.status };
    const total = rupees(booking.fare?.amount);
    const breakdown = booking.fare?.breakdown ?? [];
    const bookedOn = formatDateTime(booking.createdAt);

    return (
        <div className="min-h-screen bg-fog/20 py-8 px-4 lg:px-8">
            <div className="max-w-4xl mx-auto space-y-6">
                <div className="flex flex-wrap justify-between items-center gap-4">
                    <Button variant="ghost" onClick={() => navigate('/bookings')} className="-ml-2 text-ink-soft hover:text-ink gap-1.5">
                        <ArrowLeft className="size-4"/> Back to My Bookings
                    </Button>

                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => window.print()}>
                            <Printer className="size-4 mr-1.5"/> Print
                        </Button>
                        <Button size="sm" onClick={() => window.print()} className="gap-1.5">
                            <Download className="size-4"/> Download e-Ticket
                        </Button>
                    </div>
                </div>

                {/* Detailed Boarding Pass */}
                <div className="relative rounded-ticket bg-white border border-line-mid shadow-ticket overflow-hidden">
                    {/* Header Banner */}
                    <div className="bg-gradient-to-r from-navy via-royal to-azure text-paper p-6 md:p-8 flex flex-wrap items-center justify-between gap-4">
                        <div className="space-y-1">
                            <div className="flex items-center gap-3">
                                <Logo variant="dark" size="sm"/>
                                <span className="text-xs uppercase tracking-widest text-sky font-semibold px-2 py-0.5 rounded bg-white/10">
                                    Electronic Reservation Slip (ERS)
                                </span>
                            </div>
                            <div className="text-caption text-paper/80 font-medium pt-1">
                                Booking ID: {booking.bookingRef}
                                {bookedOn ? ` · Booked On ${bookedOn}` : ''}
                            </div>
                        </div>

                        <div className="text-right">
                            <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-paper/75 block">
                                PNR Number
                            </span>
                            <span className="num font-mono text-2xl md:text-3xl font-black tracking-widest text-paper block">
                                {booking.bookingRef}
                            </span>
                        </div>
                    </div>

                    <div className="p-6 md:p-8 space-y-6">
                        <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-line">
                            <div>
                                <h3 className="text-h3 font-bold text-ink">
                                    {booking.train?.number} {booking.train?.name}
                                </h3>
                                <span className="text-caption text-ink-soft">
                                    Class {booking.train?.class}
                                    {booking.contact?.email ? ` · ${booking.contact.email}` : ''}
                                </span>
                            </div>
                            <Badge variant={badge.variant} className="text-xs font-bold px-3 py-1">
                                {badge.label}
                            </Badge>
                        </div>

                        <RouteConnector
                            fromCode={booking.route?.from}
                            toCode={booking.route?.to}
                            fromName={booking.route?.fromName}
                            toName={booking.route?.toName}
                            depTime={formatTime(booking.departureAt)}
                            arrTime={formatTime(booking.arrivalAt)}
                            duration={durationOf(booking)}
                            size="lg"
                        />

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-4 px-5 rounded-card bg-fog/30 border border-line text-sm">
                            <div>
                                <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                                    Departure
                                </span>
                                <span className="num font-bold text-ink mt-0.5 block">
                                    {formatDate(booking.departureAt) ?? 'Not scheduled'}
                                </span>
                            </div>
                            <div>
                                <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                                    Distance
                                </span>
                                <span className="font-semibold text-ink mt-0.5 block">
                                    {booking.segment?.distanceKm != null ? `${booking.segment.distanceKm} km` : '—'}
                                </span>
                            </div>
                            <div>
                                <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                                    Contact
                                </span>
                                <span className="font-semibold text-ink mt-0.5 block break-all">
                                    {booking.contact?.email ?? booking.contact?.phone ?? '—'}
                                </span>
                            </div>
                            <div>
                                <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                                    Total Paid
                                </span>
                                <span className="num font-bold text-royal mt-0.5 block">
                                    {total != null ? `₹${total}` : 'Not paid'}
                                </span>
                            </div>
                        </div>

                        {/* Passenger List */}
                        <div className="space-y-3 pt-2">
                            <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                                Passengers
                            </span>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="border-b border-line text-eyebrow text-ink-soft font-semibold uppercase tracking-[0.16em]">
                                            <th className="py-2.5 px-3">#</th>
                                            <th className="py-2.5 px-3">Name</th>
                                            <th className="py-2.5 px-3">Age / Sex</th>
                                            <th className="py-2.5 px-3">Coach / Seat</th>
                                            <th className="py-2.5 px-3 text-right">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-line text-sm">
                                        {(booking.passengers ?? []).map((p, i) => (<tr key={p.coach ? `${p.coach}-${p.seatNumber}-${i}` : i}>
                                            <td className="py-3 px-3 num font-bold text-royal">{i + 1}</td>
                                            <td className="py-3 px-3 font-semibold text-ink">{p.name}</td>
                                            <td className="py-3 px-3 text-ink-soft">{p.age} / {p.gender}</td>
                                            <td className="py-3 px-3 num font-semibold text-ink">
                                                {p.coach ? `Coach ${p.coach} · ${p.seatNumber}${p.berthType ? ` (${p.berthType})` : ''}` : 'Not allocated'}
                                            </td>
                                            <td className="py-3 px-3 text-right">
                                                {/* The whole booking's status, not a
                                                    hardcoded CONFIRMED. */}
                                                <Badge variant={badge.variant}>{badge.label}</Badge>
                                            </td>
                                        </tr>))}
                                        {(booking.passengers ?? []).length === 0 && (
                                            <tr>
                                                <td colSpan={5} className="py-3 px-3 text-ink-soft">
                                                    No passengers recorded on this booking.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Fare Breakdown — the server's own categories. */}
                        <div className="pt-4 border-t border-line space-y-2 text-sm">
                            <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                                Fare Breakdown
                            </span>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-caption">
                                {breakdown.map((line) => (
                                    <div key={line.key}>
                                        <span className="text-ink-soft block">{line.label}:</span>
                                        <span className="num font-bold text-ink">₹{rupees(line.amount)}</span>
                                    </div>
                                ))}
                                {breakdown.length === 0 && (
                                    <p className="col-span-2 sm:col-span-4 text-ink-soft">
                                        No fare breakdown is recorded for this booking.
                                    </p>
                                )}
                                <div>
                                    <span className="text-ink-soft block">Grand Total:</span>
                                    <span className="num font-bold text-royal text-base">
                                        {total != null ? `₹${total}` : '—'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Demo Notice */}
                <div className="rounded-card border border-azure/20 bg-blue-100 p-4 text-caption text-body flex items-start gap-2.5">
                    <Info className="size-4 text-royal shrink-0 mt-0.5"/>
                    <p>
                        <b className="font-semibold text-royal">Demo Mode — Simulated Ticket:</b> Not valid for actual travel on Indian Railways tracks.
                    </p>
                </div>
            </div>
        </div>
    );
}
