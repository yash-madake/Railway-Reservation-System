import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Calendar, Coffee } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/utils';
import { bookingService } from '@/services/bookingService';
import { useBooking } from '@/context/BookingContext';

/** 'MON'..'SUN' -> the single letter the chips show. */
const DAY_INITIAL = { MON: 'M', TUE: 'T', WED: 'W', THU: 'T', FRI: 'F', SAT: 'S', SUN: 'S' };
const ALL_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/**
 * "17:00:00" -> "17:00". The database stores seconds; nothing here needs them
 * and showing them made the timetable look busier than it is.
 */
const hhmm = (value) => (value ? String(value).slice(0, 5) : null);

/**
 * Elapsed time between the first departure and the last arrival.
 *
 * Computed rather than hardcoded — this page previously printed "15h 40m" for
 * every train, including ones whose real timetable is half that. Crosses
 * midnight because a train departing 17:00 and arriving 08:32 is 15h32m, not
 * "negative 8 and a half hours".
 */
function durationOf(stops) {
  if (!stops || stops.length < 2) return null;
  const toMinutes = (t) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const first = stops[0];
  const last = stops[stops.length - 1];

  const start = toMinutes(first.departureTime);
  const startDay = Number(first.day ?? 1);
  const end = toMinutes(last.arrivalTime ?? last.departureTime);
  const endDay = Number(last.day ?? 1);
  if (start === null || end === null) return null;

  // Anchor the origin at midnight of its own day, then add whole days for the
  // arrival so the wrap is handled once, here.
  let minutes = end - start + (endDay - startDay) * 24 * 60;
  if (minutes < 0) minutes += 24 * 60;

  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

export function TrainDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { setSelectedTrain, setSelectedClass } = useBooking();

  const [train, setTrain] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);
    setTrain(null);

    bookingService
      .getTrainDetails(id)
      .then((res) => {
        if (!isMounted) return;
        // The endpoint wraps in `{ success, data }`; the api client unwraps some
        // envelopes but not all, so both shapes are accepted rather than guessed.
        const payload = res?.data ?? res;
        if (!payload) throw new Error('No train data returned.');
        setTrain({
          id: payload.id ?? payload.trainNumber,
          number: payload.trainNumber,
          name: payload.trainName,
          type: payload.trainType,
          status: payload.status,
          pantryAvailable: payload.pantryAvailable,
          source: payload.source,
          destination: payload.destination,
          distance: payload.totalDistanceKm,
          duration: durationOf(payload.stops),
        });
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err?.message ?? `Train "${id}" could not be loaded.`);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [id]);

  /**
   * Everything below is derived from `train`.
   *
   * This page used to resolve the train from `@/data/trains` and fall back to a
   * literal 12951, then ignore the train entirely for its five-stop timetable,
   * its four class fares, and a hardcoded seven-day week. So a header could read
   * "12002 Bhopal Shatabdi" over an NDLS→MMCT Rajdhani schedule. Every one of
   * those is now the row the database returned.
   */
  const classes = train?.classes ?? [];
  const stops = train?.stops ?? [];
  const runningDays = train?.runningDays ?? [];

  const handleBook = (clsType) => {
    if (!train) return;
    setSelectedTrain(train);
    setSelectedClass(clsType);
    navigate(`/booking/passenger-details?train=${train.number}&class=${clsType}`);
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-content px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !train) {
    return (
      <div className="mx-auto w-full max-w-content px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <Link to="/search">
          <Button variant="ghost" size="sm" className="pl-0 hover:bg-transparent">
            <ArrowLeft className="size-4 mr-1.5" /> Back to Results
          </Button>
        </Link>
        <EmptyState
          title="Train not found"
          description={error ?? `No train matching "${id}" is in the database.`}
          action={<Button onClick={() => navigate('/search')}>Back to Search</Button>}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-content px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <Link to="/search">
        <Button variant="ghost" size="sm" className="pl-0 hover:bg-transparent">
          <ArrowLeft className="size-4 mr-1.5" /> Back to Results
        </Button>
      </Link>

      {/* Train Header Banner */}
      <div className="rounded-card border border-white/10 bg-[linear-gradient(135deg,#04275B_0%,#014CA9_78%,#0A63C6_100%)] p-6 sm:p-8 text-white blueprint shadow-panel">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <h1 className="text-h2 font-bold tracking-tight text-white leading-tight">
                {train.number} {train.name}
              </h1>
              {train.type && (
                <span className="rounded-full bg-white/20 px-3 py-0.5 text-caption font-semibold text-white">
                  {train.type}
                </span>
              )}
            </div>
            <p className="text-on-dark-soft flex items-center gap-3 text-sm">
              <span>
                {train.source?.name} ({train.source?.code}) → {train.destination?.name} ({train.destination?.code})
              </span>
              {train.duration && (
                <>
                  <span>·</span>
                  <span className="num font-semibold text-white">{train.duration}</span>
                </>
              )}
              {train.distance != null && (
                <>
                  <span>·</span>
                  <span className="num font-semibold text-white">{train.distance} km</span>
                </>
              )}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/*
              The status is the database's. This used to read "Live Telemetry
              Active" unconditionally — on a static page, over a train that may
              not run that day.
            */}
            <Badge variant={train.status === 'active' ? 'success' : 'outline'} size="md">
              {train.status === 'active' ? 'In service' : `Status: ${train.status ?? 'unknown'}`}
            </Badge>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content Area (2 cols) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Availability & Classes Table */}
          <Card className="p-6 space-y-4">
            <h2 className="text-h4 font-semibold text-ink border-b border-line pb-3">
              Fares &amp; Availability by Class
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-sunken border-b border-line-mid text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft">
                    <th scope="col" className="p-3">Class</th>
                    <th scope="col" className="p-3">Base Fare</th>
                    <th scope="col" className="p-3">Status</th>
                    <th scope="col" className="p-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {classes.map((cls) => {
                    const status = String(cls.status ?? '');
                    return (
                      <tr key={cls.type} className="hover:bg-surface-sunken/60 transition-colors">
                        <td className="p-3">
                          <div className="font-bold text-ink">{cls.type}</div>
                          <div className="text-caption text-ink-soft">{cls.name}</div>
                        </td>
                        <td className="p-3 num font-bold text-royal text-sm">
                          {cls.fare != null ? `₹${cls.fare}` : '—'}
                        </td>
                        <td className="p-3">
                          <span className={cn(
                            "num text-caption font-semibold px-2 py-0.5 rounded-control",
                            status.includes('AVAILABLE') ? "bg-status-success/12 text-success-strong" : "bg-status-warning/14 text-warning-strong"
                          )}>
                            {status || 'Unknown'}
                            {cls.availableSeats != null && cls.availableSeats > 0 ? ` (${cls.availableSeats})` : ''}
                          </span>
                        </td>
                        <td className="p-3 text-right">
                          <Button size="sm" onClick={() => handleBook(cls.type)}>
                            Book Now
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {classes.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-3 text-ink-soft">
                        This train has no classes in the price list yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Route Schedule Timeline */}
          <Card className="p-6 space-y-6">
            <h2 className="text-h4 font-semibold text-ink border-b border-line pb-3">
              Route &amp; Station Schedule
            </h2>

            <div className="space-y-6 pl-4 border-l-2 border-line ml-3">
              {stops.map((stop, idx) => {
                const isOrigin = idx === 0;
                const isDest = idx === stops.length - 1;

                return (
                  <div key={stop.station?.code ?? idx} className="relative pl-6">
                    {/* Station Dot */}
                    <div
                      className={cn(
                        "absolute -left-[23px] top-1 size-3 rounded-full border-2 border-white shadow-sm",
                        isOrigin ? "bg-status-success" : isDest ? "bg-azure" : "bg-royal"
                      )}
                    />

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-line pb-4">
                      <div>
                        <div className="text-body font-semibold text-ink">
                          {stop.station?.name} <span className="text-ink-soft">({stop.station?.code})</span>
                        </div>
                        <div className="text-caption text-ink-soft num">
                          {stop.platform && <>Platform {stop.platform} · </>}
                          {stop.distanceKm} km
                        </div>
                      </div>

                      <div className="flex gap-6 text-sm num">
                        <div>
                          <span className="text-caption text-ink-soft block">Arr</span>
                          <span className="font-semibold text-ink">
                            {hhmm(stop.arrivalTime) ?? (isOrigin ? 'Source' : '—')}
                          </span>
                        </div>
                        <div>
                          <span className="text-caption text-ink-soft block">Dep</span>
                          <span className="font-semibold text-ink">
                            {hhmm(stop.departureTime) ?? (isDest ? 'Destination' : '—')}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {stops.length === 0 && (
                <p className="text-ink-soft">No route has been recorded for this train.</p>
              )}
            </div>
          </Card>
        </div>

        {/* Sidebar Info (1 col) */}
        <div className="space-y-6">
          {/* Running Days */}
          <Card className="p-5 space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-ink flex items-center gap-2">
              <Calendar className="size-4 text-royal" /> Running Days
            </h3>
            <div className="flex justify-between gap-1 pt-1">
              {/* All seven rendered, active or not: a greyed day tells the
                  traveller something a missing chip would not. */}
              {ALL_DAYS.map((day) => {
                const runs = runningDays.includes(day);
                return (
                  <div
                    key={day}
                    title={`${day}${runs ? '' : ' — does not run'}`}
                    className={cn(
                      "size-8 rounded-full flex items-center justify-center text-xs font-semibold num shadow-sm",
                      runs ? "bg-royal text-white" : "bg-surface-sunken text-ink-muted line-through"
                    )}
                  >
                    {DAY_INITIAL[day]}
                  </div>
                );
              })}
            </div>
            <p className="text-caption text-ink-soft pt-1">
              {runningDays.length === 0
                ? 'No running days recorded.'
                : `Operates ${runningDays.length} day${runningDays.length === 1 ? '' : 's'} a week.`}
            </p>
          </Card>

          {/* On-board Amenities — only what the database actually records. */}
          <Card className="p-5 space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-ink">
              Train Amenities
            </h3>
            {train.pantryAvailable ? (
              <div className="space-y-3 text-sm text-body">
                <div className="flex items-center gap-3">
                  <Coffee className="size-4 text-royal shrink-0" />
                  <span>Pantry car &amp; catering services</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-ink-soft">
                No on-board amenities are recorded for this train.
              </p>
            )}
          </Card>

          {/* Booking Support Notice */}
          <div className="rounded-card border border-azure/25 bg-blue-100 p-4 text-caption text-body">
            <b className="font-semibold text-royal">Instant Booking.</b> Confirmations are verified instantly through Yatrio reservation pipeline.
          </div>
        </div>
      </div>
    </div>
  );
}
