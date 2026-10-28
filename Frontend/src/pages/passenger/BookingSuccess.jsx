import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Download, Copy, PlusCircle, Bookmark, CheckCircle2, Info } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { RouteConnector } from '@/components/ui/RouteConnector';
import { Logo } from '@/components/layout/Logo';
import { useBooking } from '@/context/BookingContext';
import { bookingService } from '@/services/bookingService';
import { formatPnr } from '@/lib/journey';
export function BookingSuccess() {
    const navigate = useNavigate();
    const { selectedTrain, passengers, selectedSeats, bookingRef, resetBookingRef } = useBooking();
    const [copied, setCopied] = useState(false);

    /**
     * Read the reference BEFORE clearing it.
     *
     * This booking is settled, so the reference has to be dropped — otherwise the
     * next booking mints nothing and tries to pay against a captured order. But
     * it is also the only thing that identifies this ticket, so it is captured
     * into state on the same render. Doing it in an effect instead would read a
     * ref that was already null.
     */
    const [settledRef] = useState(bookingRef);

    const pnr = formatPnr(settledRef);

    /**
     * The settled booking, read back from the server.
     *
     * The ticket used to be assembled entirely from literals — "Superfast Daily
     * Express · Platform #3", "15 Oct 2026", "₹1,640", "1,384 km" and a
     * `CONFIRMED (CNF)` badge — so every confirmed booking printed the same
     * NDLS→MMCT ticket regardless of what was actually booked or paid.
     *
     * `settledRef` is the one identifier that is correct at this point, so the
     * ticket is fetched by it. The context is kept only as a fallback for the
     * manifest, since `resetBookingRef` clears the reference on mount.
     */
    const [booking, setBooking] = useState(null);

    useEffect(() => {
        if (!settledRef) return;
        let isMounted = true;
        bookingService
            .getBooking(settledRef)
            .then((res) => {
                if (isMounted) setBooking(res?.data ?? res ?? null);
            })
            .catch(() => {
                /* the ticket still renders from what the client holds */
            });
        return () => {
            isMounted = false;
        };
    }, [settledRef]);

    useEffect(() => {
        resetBookingRef();
    }, [resetBookingRef]);

    const copyPnr = () => {
        navigator.clipboard.writeText((pnr ?? settledRef ?? '').replace(/-/g, ''));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    /**
     * The server's record wins over the client draft.
     *
     * No invented defaults: a booking that cannot be read shows blanks rather
     * than a plausible-looking 12951 Rajdhani that was never booked.
     */
    const trainNumber = booking?.train?.number ?? selectedTrain?.number ?? null;
    const trainName = booking?.train?.name ?? selectedTrain?.name ?? null;
    const travelClass = booking?.train?.class ?? selectedTrain?.class ?? null;
    const journeyDate = booking?.departureAt ?? null;
    const totalPaid = booking?.fare?.amount != null ? Number(booking.fare.amount) / 100 : null;
    const distanceKm = booking?.segment?.distanceKm ?? null;

    const formatDate = (value) => {
        if (!value) return null;
        const d = new Date(value);
        return Number.isNaN(d.getTime())
            ? null
            : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    };
    const formatTime = (value) => {
        if (!value) return null;
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    };
    const journeyLabel = formatDate(journeyDate);
    const routeFrom = booking?.route?.from ?? null;
    const routeTo = booking?.route?.to ?? null;
    const routeFromName = booking?.route?.fromName ?? routeFrom;
    const routeToName = booking?.route?.toName ?? routeTo;

    /**
     * One entry per traveller, each carrying the berth they actually chose.
     *
     * Driven off `passengers` rather than a fixed pair of cards, and paired with
     * `selectedSeats` by position — the same order the server writes the manifest
     * in. A seat with no passenger to go with it (or the reverse) is shown as
     * unallocated rather than papered over with a placeholder name.
     */
    const manifest = (passengers ?? []).map((p, idx) => {
      const seat = selectedSeats?.[idx];
      return {
        key: p.id ?? `pax_${idx}`,
        name: String(p.name ?? '').trim() || `Passenger ${idx + 1}`,
        age: p.age,
        gender: p.gender,
        coach: seat?.coach ?? null,
        berthNo: seat?.number ?? null,
        berthType: seat?.type ?? null,
      };
    });
    return (<div className="min-h-screen bg-fog/30 py-12 px-4 lg:px-8">
      <div className="max-w-3xl mx-auto space-y-8">
        {/* Celebration Header */}
        <div className="text-center space-y-2">
          <div className="size-16 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto shadow-sm ring-8 ring-emerald-50">
            <CheckCircle2 className="size-9 stroke-[2.5]"/>
          </div>
          <h1 className="text-display font-extrabold tracking-tight text-ink mt-3">
            Reservation Confirmed!
          </h1>
          <p className="text-body text-ink-soft max-w-md mx-auto">
            Your e-ticket has been generated and sent via SMS and Email to your registered account.
          </p>
        </div>

        {/* Signature Yatrio Boarding Pass / Ticket Stub (Brandkit §7.5) */}
        <div className="relative rounded-ticket bg-white border border-line-mid shadow-ticket overflow-hidden">
          {/* Ticket Top Horizon Gradient Header */}
          <div className="bg-gradient-to-r from-navy via-royal to-azure text-paper p-6 md:p-8 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <Logo variant="dark" size="sm"/>
                <span className="text-xs uppercase tracking-widest text-sky font-semibold px-2 py-0.5 rounded bg-white/10">
                  Electronic Reservation Slip
                </span>
              </div>
              <div className="text-caption text-paper/80 font-medium pt-1">
                Indian Railways Passenger Itinerary
              </div>
            </div>

            <div className="text-right">
              <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-paper/75 block">
                PNR Number
              </span>
              <div className="flex items-center justify-end gap-2 mt-0.5">
                <span className="num font-mono text-2xl md:text-3xl font-black tracking-widest text-paper">
                  {pnr ?? '--'}
                </span>
                {pnr && (<button onClick={copyPnr} className="p-1.5 rounded-control bg-white/15 hover:bg-white/25 transition-colors cursor-pointer text-paper" title="Copy PNR">
                  {copied ? <Check className="size-4 text-emerald-300"/> : <Copy className="size-4"/>}
                </button>)}
              </div>
              {/* The reference is the part that actually resolves. The PNR above
                  is derived from it until Team 6's allocation table exists, and
                  saying so stops anyone treating it as a real railway PNR. */}
              {settledRef && (
                <span className="num mt-1 block text-[11px] text-paper/60">
                  Ref {settledRef}
                </span>
              )}
            </div>
          </div>

          {/* Ticket Body Content */}
          <div className="p-6 md:p-8 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-line">
              <div>
                <h3 className="text-h3 font-bold text-ink">
                  {trainNumber} {trainName}
                </h3>
                <span className="text-caption text-ink-soft">
                  {/* Was a literal "Superfast Daily Express · Platform #3" for
                      every train. Neither the service nor the platform is
                      recorded on the booking. */}
                  {travelClass ? `Class ${travelClass}` : 'Class not recorded'}
                </span>
              </div>
              {/* The booking's own status, not an unconditional confirmation. */}
              <Badge
                variant={booking?.status === 'CONFIRMED' ? 'success' : 'outline'}
                className="text-xs font-bold px-3 py-1"
              >
                {booking?.status === 'CONFIRMED' ? 'CONFIRMED (CNF)' : (booking?.status ?? 'PENDING')}
              </Badge>
            </div>

            {/* Signature RouteConnector */}
            {/* The route of the booking, not a fixed NDLS to MMCT. */}
            <RouteConnector
              fromCode={routeFrom}
              toCode={routeTo}
              fromName={routeFromName}
              toName={routeToName}
              depTime={formatTime(booking?.departureAt)}
              arrTime={formatTime(booking?.arrivalAt)}
              size="lg"
            />

            {/* 4-up Meta Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-4 px-5 rounded-card bg-fog/30 border border-line text-sm">
              <div>
                <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                  Date of Journey
                </span>
                <span className="num font-bold text-ink mt-0.5 block">{journeyLabel ?? 'Not scheduled'}</span>
              </div>
              <div>
                <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                  Class & Quota
                </span>
                <span className="font-semibold text-ink mt-0.5 block">{travelClass ?? '—'}</span>
              </div>
              <div>
                <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                  Total Fare Paid
                </span>
                <span className="num font-bold text-royal mt-0.5 block">
                  {totalPaid != null ? `₹${totalPaid.toFixed(2)}` : 'Not paid'}
                </span>
              </div>
              <div>
                <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                  Distance
                </span>
                <span className="num font-semibold text-ink mt-0.5 block">
                  {distanceKm != null ? `${distanceKm} km` : '—'}
                </span>
              </div>
            </div>

            {/* Ticket Perforation Divider with Circular Notches */}
            <div className="relative my-6 -mx-6 md:-mx-8">
              <div className="absolute -left-3 top-1/2 -translate-y-1/2 size-6 rounded-full bg-fog/30 border-r border-line-mid"/>
              <div className="absolute -right-3 top-1/2 -translate-y-1/2 size-6 rounded-full bg-fog/30 border-l border-line-mid"/>
              <div className="border-t-2 border-dashed border-line-strong w-full"/>
            </div>

            {/* Passengers manifest */}
            <div className="space-y-3">
              <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                Passenger & Berth Allocations
              </span>
              {/**
               * Rendered from the booking, one card per traveller.
               *
               * This was two hardcoded cards behind `||` fallbacks, so a
               * single-passenger booking still showed two people — the second one
               * entirely fictional — and both always claimed coach B1 berths 24
               * and 25, whatever was actually booked.
               *
               * Each traveller is paired with the berth they picked, by position.
               * That is the same pairing the server uses when it writes the
               * manifest, so the card and the ticket agree.
               */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {manifest.map(({ key, name, age, gender, coach, berthNo, berthType }) => (
                  <div key={key} className="p-3.5 rounded-control bg-white border border-line flex items-center justify-between shadow-xs">
                    <div>
                      <span className="font-semibold text-sm text-ink block">
                        {name}
                      </span>
                      <span className="text-caption text-ink-soft">
                        {age ? `Age ${age}` : 'Age not recorded'}
                        {gender ? ` · ${gender}` : ''}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="num text-sm font-bold text-royal block">
                        {coach ? `Coach ${coach} · ${berthNo}` : 'Berth not allocated'}
                      </span>
                      {berthType && <span className="text-caption font-medium text-emerald-700">{berthType}</span>}
                    </div>
                  </div>
                ))}
              </div>
              {manifest.length === 0 && (
                <p className="text-caption text-ink-soft">
                  No passenger details were captured for this booking.
                </p>
              )}
            </div>

            {/* Barcode & Security Hash Block */}
            <div className="pt-4 border-t border-line flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="space-y-1 text-center sm:text-left">
                {/* SVG Simulated Barcode */}
                <div className="h-10 flex items-center gap-[3px] bg-fog/50 p-2 rounded border border-line">
                  {[4, 2, 6, 1, 3, 5, 2, 7, 1, 4, 2, 6, 3, 1, 5, 2, 4, 1, 6, 3, 2, 5, 1, 4, 6, 2, 3].map((w, i) => (<div key={i} className="h-full bg-ink" style={{ width: `${w * 1.5}px` }}/>))}
                </div>
                <span className="num font-mono text-[10px] text-ink-muted tracking-widest block">
                  SHA256: {(settledRef ?? 'UNAVAILABLE').toUpperCase()}
                </span>
              </div>

              <div className="text-caption text-ink-soft text-center sm:text-right">
                <span className="font-medium block text-ink">IRCTC / Yatrio Gateway</span>
                <span>Authorized Digital Pass</span>
              </div>
            </div>
          </div>
        </div>

        {/* Mandatory Demo Mode Notice (Brandkit §7.7) */}
        <div className="rounded-card border border-azure/20 bg-blue-100 p-4 text-caption text-body flex items-start gap-3 shadow-xs">
          <Info className="size-4 text-royal shrink-0 mt-0.5"/>
          <p>
            <b className="font-semibold text-royal">Demo Mode Notice:</b> This ticket was generated in sandbox mode for simulation and evaluation. It is not an actual reservation valid on Indian Railways tracks.
          </p>
        </div>

        {/* Action CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Button size="lg" onClick={() => window.print()} className="w-full sm:w-auto shadow-raised gap-2">
            <Download className="size-4"/> Download e-Ticket (PDF)
          </Button>

          <Button variant="secondary" size="lg" onClick={() => navigate('/bookings')} className="w-full sm:w-auto gap-2">
            <Bookmark className="size-4"/> View My Bookings
          </Button>

          <Button variant="ghost" size="lg" onClick={() => navigate('/')} className="w-full sm:w-auto gap-2">
            <PlusCircle className="size-4"/> Plan Another Journey
          </Button>
        </div>
      </div>
    </div>);
}
