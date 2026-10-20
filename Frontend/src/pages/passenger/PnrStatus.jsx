import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Printer, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { RouteConnector } from '@/components/ui/RouteConnector';
import { bookingService } from '@/services/bookingService';

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
 * Yatrio's own reference, not a 10-digit railway PNR.
 *
 * The field used to demand exactly ten digits and then, after a one-second
 * timer, printed the same confirmed 12951 ticket for every one of them —
 * including numbers that do not exist. `GET /bookings/:ref` answers on the
 * reference the server actually issued (`YTR-12951-7QX2`), so that is what this
 * asks for.
 */
const STATUS_BADGE = {
    HELD: { variant: 'outline', label: 'AWAITING PAYMENT' },
    CONFIRMED: { variant: 'success', label: 'CONFIRMED (CNF)' },
    CANCELLED: { variant: 'error', label: 'CANCELLED' },
    EXPIRED: { variant: 'error', label: 'EXPIRED' },
};

export function PnrStatus() {
    const navigate = useNavigate();
    const [pnr, setPnr] = useState('');
    const [status, setStatus] = useState('idle');
    const [booking, setBooking] = useState(null);
    const [error, setError] = useState(null);

    const handleSearch = async (e) => {
        e.preventDefault();
        const ref = pnr.trim();
        if (!ref) return;

        setStatus('loading');
        setError(null);
        setBooking(null);

        try {
            const res = await bookingService.getBooking(ref);
            const payload = res?.data ?? res;
            if (!payload?.bookingRef) throw new Error('That reference returned no booking.');
            setBooking(payload);
            setStatus('success');
        } catch (err) {
            // An unknown reference is an answer, not a failure to hide. The old
            // version had no such path — every input resolved to a ticket.
            setError(err?.message ?? `No booking found for "${ref}".`);
            setStatus('error');
        }
    };

    const badge = booking ? (STATUS_BADGE[booking.status] ?? { variant: 'outline', label: booking.status }) : null;

    return (
        <div className="min-h-screen bg-fog/25 py-12 px-4 lg:px-8">
            <div className="max-w-4xl mx-auto space-y-8">
                {/* PNR Search Hero Card */}
                <div className="rounded-card bg-gradient-to-r from-navy via-royal to-navy p-8 md:p-10 text-paper shadow-card relative overflow-hidden">
                    <div className="relative z-10 max-w-xl mx-auto text-center space-y-3">
                        <span className="text-eyebrow font-semibold uppercase tracking-[0.18em] text-sky block">
                            Direct Railway Telemetry
                        </span>
                        <h1 className="text-display font-extrabold tracking-tight text-paper">
                            Check Booking Status
                        </h1>
                        <p className="text-body text-paper/80">
                            Look up a reservation by its Yatrio reference to see its manifest, coach and berth
                            allocation, and current status.
                        </p>

                        <form onSubmit={handleSearch} className="pt-4 flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
                            <Input
                                placeholder="YTR-12951-7QX2"
                                value={pnr}
                                onChange={(e) => setPnr(e.target.value.slice(0, 32))}
                                className="num text-center tracking-widest text-lg font-bold bg-white text-ink border-0 h-12 shadow-raised"
                                maxLength={32}
                            />
                            <Button type="submit" disabled={!pnr.trim() || status === 'loading'} size="lg" className="shrink-0 h-12 font-bold px-8 shadow-raised">
                                {status === 'loading' ? 'Looking up...' : 'Check Status'}
                            </Button>
                        </form>
                    </div>
                </div>

                {/* Not found */}
                {status === 'error' && (
                    <Card className="p-8 text-center border-error/30">
                        <h3 className="text-h4 font-bold text-ink mb-1">No such booking</h3>
                        <p className="text-body text-ink-soft max-w-md mx-auto">{error}</p>
                        <div className="mt-4">
                            <Button variant="secondary" onClick={() => { setStatus('idle'); setPnr(''); }}>
                                Try another reference
                            </Button>
                        </div>
                    </Card>
                )}

                {/* Results */}
                {status === 'success' && booking && (<div className="space-y-6 animate-in fade-in slide-in-from-bottom-3 duration-300">
                    <Card className="p-0 overflow-hidden border-line-mid shadow-card rounded-card">
                        {/* Top Banner */}
                        <div className="bg-paper p-6 border-b border-line flex flex-wrap items-center justify-between gap-4">
                            <div>
                                <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                                    Current Reservation Status
                                </span>
                                <div className="flex items-center gap-3 mt-1">
                                    <span className="num font-mono text-2xl font-bold tracking-widest text-ink">
                                        {booking.bookingRef}
                                    </span>
                                    <Badge variant={badge.variant}>{badge.label}</Badge>
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <Button variant="outline" size="sm" onClick={() => window.print()}>
                                    <Printer className="size-4 mr-1.5"/> Print
                                </Button>
                                <Button variant="outline" size="sm">
                                    <Share2 className="size-4 mr-1.5"/> Share
                                </Button>
                            </div>
                        </div>

                        {/* Journey Details */}
                        <div className="p-6 md:p-8 space-y-6">
                            <div>
                                <h3 className="text-h3 font-bold text-ink">
                                    {booking.train?.number} {booking.train?.name}
                                </h3>
                                <span className="text-caption text-ink-soft">
                                    Class {booking.train?.class}
                                    {booking.train?.coach ? ` · Coach ${booking.train.coach} · Berth ${booking.train.seat}` : ''}
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
                                size="lg"
                            />

                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-line text-sm">
                                <div>
                                    <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                                        Date of Journey
                                    </span>
                                    <span className="font-semibold text-ink mt-0.5 block">
                                        {formatDate(booking.departureAt) ?? 'Not scheduled'}
                                    </span>
                                </div>
                                <div>
                                    <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                                        Boarding Station
                                    </span>
                                    <span className="font-semibold text-ink mt-0.5 block">
                                        {booking.route?.fromName ?? booking.route?.from} ({booking.route?.from})
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
                                        Hold Expires
                                    </span>
                                    <span className="font-semibold text-ink mt-0.5 block">
                                        {formatTime(booking.holdExpiresAt) ?? '—'}
                                    </span>
                                </div>
                            </div>

                            {/* Passenger Breakdown Table */}
                            <div className="pt-4 border-t border-line space-y-3">
                                <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                                    Passenger Breakdown
                                </span>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="border-b border-line text-eyebrow text-ink-soft font-semibold uppercase tracking-[0.16em]">
                                                <th className="py-2.5 px-3">#</th>
                                                <th className="py-2.5 px-3">Passenger</th>
                                                <th className="py-2.5 px-3">Booking Status</th>
                                                <th className="py-2.5 px-3 text-right">Allocated Berth</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-line text-sm">
                                            {(booking.passengers ?? []).map((p, i) => (<tr key={`${p.coach}-${p.seatNumber}-${i}`}>
                                                <td className="py-3 px-3 num font-bold text-royal">{i + 1}</td>
                                                <td className="py-3 px-3 font-semibold text-ink">{p.name}</td>
                                                <td className="py-3 px-3">
                                                    <span className="text-caption font-semibold px-2 py-0.5 rounded bg-fog text-ink">
                                                        {booking.status}
                                                    </span>
                                                </td>
                                                <td className="py-3 px-3 text-right font-bold text-ink num">
                                                    {p.coach
                                                        ? `Coach ${p.coach} · Berth ${p.seatNumber}${p.berthType ? ` (${p.berthType})` : ''}`
                                                        : 'Not allocated'}
                                                </td>
                                            </tr>))}
                                            {(booking.passengers ?? []).length === 0 && (
                                                <tr>
                                                    <td colSpan={4} className="py-3 px-3 text-ink-soft">
                                                        No passengers recorded on this booking.
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="pt-2">
                                    <Button variant="secondary" size="sm" onClick={() => navigate(`/bookings/${booking.bookingRef}`)}>
                                        View full e-ticket
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </Card>
                </div>)}
            </div>
        </div>
    );
}
