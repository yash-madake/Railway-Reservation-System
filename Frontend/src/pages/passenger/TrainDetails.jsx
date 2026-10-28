import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { ArrowLeft, Calendar, Coffee, ShieldCheck, MapPin, Sparkles, AlertCircle, Clock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { API_BASE_URL } from '@/api/client';
import { cn } from '@/lib/utils';
import { bookingService } from '@/services/bookingService';
import { useBooking } from '@/context/BookingContext';

const DAY_INITIAL = { MON: 'M', TUE: 'T', WED: 'W', THU: 'T', FRI: 'F', SAT: 'S', SUN: 'S' };
const ALL_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

const QUOTA_OPTIONS = [
  { code: 'GN', name: 'General', desc: 'Standard open booking quota' },
  { code: 'TQ', name: 'Tatkal', desc: 'Last-minute emergency quota' },
  { code: 'LD', name: 'Ladies', desc: 'Reserved for female travelers' },
  { code: 'PT', name: 'Premium Tatkal', desc: 'Dynamic pricing tatkal' },
  { code: 'SS', name: 'Senior Citizen', desc: 'Lower berth quota' },
];

const hhmm = (value) => (value ? String(value).slice(0, 5) : null);

function durationOf(stops) {
  if (!stops || stops.length < 2) return null;
  const toMinutes = (t) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const first = stops[0];
  const last = stops[stops.length - 1];

  const start = toMinutes(first.departureTime);
  const startDay = Number(first.day ?? first.dayOffset ?? 1);
  const end = toMinutes(last.arrivalTime ?? last.departureTime);
  const endDay = Number(last.day ?? last.dayOffset ?? 1);
  if (start === null || end === null) return null;

  let minutes = end - start + (endDay - startDay) * 24 * 60;
  if (minutes < 0) minutes += 24 * 60;

  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

export function TrainDetails() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setSelectedTrain, setSelectedClass } = useBooking();

  const initialDate = searchParams.get('date') || new Date().toISOString().split('T')[0];
  const initialQuota = searchParams.get('quota') || 'GN';

  const [train, setTrain] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ConfirmTkt state controls
  const [selectedQuota, setSelectedQuota] = useState(initialQuota);
  const [journeyDate, setJourneyDate] = useState(initialDate);
  const [boardingStation, setBoardingStation] = useState('');
  const [quotaAvailability, setQuotaAvailability] = useState({});
  const [availLoading, setAvailLoading] = useState(false);
  const [fareOverrides, setFareOverrides] = useState({});

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);

    bookingService
      .getTrainDetails(id)
      .then((res) => {
        if (!isMounted) return;
        const payload = res?.data ?? res;
        if (!payload) throw new Error('No train data returned.');

        const rawStops = payload.stops || [];
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
          duration: durationOf(rawStops),
          classes: payload.classes || [],
          stops: rawStops,
          runningDays: payload.runningDays || [],
          railwayZone: payload.railwayZone || 'IR',
        });

        if (rawStops.length > 0) {
          setBoardingStation(rawStops[0].station?.code || rawStops[0].stationCode || '');
        }
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

  // Fetch ConfirmTkt date/quota availability whenever quota or date changes
  useEffect(() => {
    if (!id) return;
    let isMounted = true;
    setAvailLoading(true);

    fetch(`${API_BASE_URL}/trains/${encodeURIComponent(id)}/availability?date=${journeyDate}&quota=${selectedQuota}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!isMounted || !body?.data?.classes) return;
        const map = {};
        for (const cls of body.data.classes) {
          map[cls.classCode] = cls;
        }
        setQuotaAvailability(map);
      })
      .catch(() => {
        // Fallback to static values if endpoint is unconfigured
      })
      .finally(() => {
        if (isMounted) setAvailLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [id, journeyDate, selectedQuota]);

  // Recalculate intermediate boarding station fare
  useEffect(() => {
    if (!id || !boardingStation || !train?.destination?.code) return;
    if (boardingStation === train.source?.code) {
      setFareOverrides({});
      return;
    }

    let isMounted = true;
    fetch(`${API_BASE_URL}/trains/${encodeURIComponent(id)}/fare?from=${boardingStation}&to=${train.destination.code}&class=3A`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (isMounted && body?.data?.totalFare) {
          setFareOverrides({
            calculatedDistance: body.data.distanceKm,
            totalFare: body.data.totalFare,
          });
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [id, boardingStation, train]);

  const classes = train?.classes ?? [];
  const stops = train?.stops ?? [];
  const runningDays = train?.runningDays ?? [];

  const handleBook = (clsType) => {
    if (!train) return;
    setSelectedTrain(train);
    setSelectedClass(clsType);
    navigate(`/booking/passenger-details?train=${train.number}&class=${clsType}&quota=${selectedQuota}&date=${journeyDate}`);
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
      <div className="flex items-center justify-between">
        <Link to="/search">
          <Button variant="ghost" size="sm" className="pl-0 hover:bg-transparent text-ink-soft hover:text-ink">
            <ArrowLeft className="size-4 mr-1.5" /> Back to Results
          </Button>
        </Link>

        <div className="inline-flex items-center gap-2 rounded-full border border-azure/30 bg-azure/10 px-3 py-1 text-xs font-semibold text-royal">
          <Sparkles className="size-3.5 text-royal" />
          <span>ConfirmTkt Real-Time Seat &amp; Prediction Engine</span>
        </div>
      </div>

      {/* Train Header Banner */}
      <div className="rounded-card border border-white/10 bg-[linear-gradient(135deg,#04275B_0%,#014CA9_78%,#0A63C6_100%)] p-6 sm:p-8 text-white blueprint shadow-panel">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-h2 font-bold tracking-tight text-white leading-tight">
                {train.number} {train.name}
              </h1>
              {train.type && (
                <span className="rounded-full bg-white/20 px-3 py-0.5 text-caption font-semibold text-white">
                  {train.type}
                </span>
              )}
              {train.railwayZone && (
                <span className="rounded-full bg-sky/25 border border-sky/40 px-2.5 py-0.5 text-caption font-semibold text-sky-bright">
                  {train.railwayZone} Zone
                </span>
              )}
            </div>
            <p className="text-on-dark-soft flex items-center gap-3 text-sm flex-wrap">
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
            <Badge variant={train.status === 'active' ? 'success' : 'outline'} size="md">
              {train.status === 'active' ? '● In Service' : `Status: ${train.status ?? 'unknown'}`}
            </Badge>
          </div>
        </div>
      </div>

      {/* Quota Selector Tabs (ConfirmTkt Signature Component) */}
      <Card className="p-4 bg-surface shadow-subtle border-line-mid">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-eyebrow font-bold uppercase tracking-[0.16em] text-ink-soft">
              Select Quota:
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            {QUOTA_OPTIONS.map((q) => {
              const active = selectedQuota === q.code;
              return (
                <button
                  key={q.code}
                  type="button"
                  onClick={() => setSelectedQuota(q.code)}
                  className={cn(
                    "px-3.5 py-1.5 rounded-control text-sm font-semibold transition-all border",
                    active
                      ? "bg-royal text-white border-royal shadow-sm"
                      : "bg-surface-sunken text-ink hover:bg-surface-sunken/80 border-line hover:border-royal/50"
                  )}
                  title={q.desc}
                >
                  {q.name} ({q.code})
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content Area (2 cols) */}
        <div className="lg:col-span-2 space-y-6">
          {/* ConfirmTkt-Style Class Availability Grid */}
          <Card className="p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h2 className="text-h4 font-bold text-ink">
                  Fares &amp; Availability
                </h2>
                <p className="text-caption text-ink-soft">
                  Quota: <b className="text-royal font-semibold">{selectedQuota}</b> · Journey Date: <b className="text-ink font-semibold">{journeyDate}</b>
                </p>
              </div>

              {availLoading && (
                <span className="text-caption text-royal font-semibold flex items-center gap-1.5 animate-pulse">
                  <Clock className="size-3.5" /> Updating seat status...
                </span>
              )}
            </div>

            {/* ConfirmTkt Visual Class Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {classes.map((cls) => {
                const clsCode = cls.type || cls.classCode;
                const dynamicInfo = quotaAvailability[clsCode];
                const rawStatus = dynamicInfo?.status || (cls.availableSeats > 0 ? 'AVAILABLE' : 'WL');
                const availableSeats = dynamicInfo?.availableSeats ?? cls.availableSeats ?? 0;
                const racSeats = dynamicInfo?.racSeats ?? 0;
                const waitingSeats = dynamicInfo?.waitingSeats ?? 0;
                const probability = dynamicInfo?.confirmationProbability ?? (rawStatus === 'AVAILABLE' ? 100 : 75);

                const isAvailable = rawStatus === 'AVAILABLE' && availableSeats > 0;
                const isRac = rawStatus === 'RAC' || (rawStatus === 'AVAILABLE' && availableSeats === 0 && racSeats > 0);
                const isWL = rawStatus === 'WL' || (!isAvailable && !isRac);

                const baseFare = fareOverrides.totalFare || cls.fare || dynamicInfo?.baseFare || 0;

                return (
                  <div
                    key={clsCode}
                    className="rounded-card border border-line-mid bg-white p-4.5 shadow-subtle hover:border-royal/60 hover:shadow-panel transition-all space-y-3.5 flex flex-col justify-between"
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <div className="font-extrabold text-h4 text-ink flex items-center gap-1.5">
                          {clsCode}
                          <span className="text-caption font-semibold text-ink-soft">· {cls.name || cls.className}</span>
                        </div>
                        <div className="num font-bold text-royal text-lg pt-0.5">
                          ₹{baseFare}
                        </div>
                      </div>

                      {/* Status Badge */}
                      <div>
                        {isAvailable && (
                          <span className="num text-caption font-bold px-2.5 py-1 rounded-control bg-status-success/15 text-success-strong border border-status-success/30 inline-block">
                            AVAILABLE - {availableSeats}
                          </span>
                        )}
                        {isRac && (
                          <span className="num text-caption font-bold px-2.5 py-1 rounded-control bg-status-warning/15 text-warning-strong border border-status-warning/30 inline-block">
                            RAC - {racSeats || 10}
                          </span>
                        )}
                        {isWL && (
                          <span className="num text-caption font-bold px-2.5 py-1 rounded-control bg-status-danger/15 text-danger-strong border border-status-danger/30 inline-block">
                            {selectedQuota}WL - {waitingSeats || 12}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* ConfirmTkt Prediction Metric */}
                    <div className="flex items-center justify-between text-caption pt-1 border-t border-line-soft">
                      <div className="flex items-center gap-1.5 text-ink-soft">
                        <Sparkles className="size-3.5 text-azure" />
                        <span className="font-medium">
                          {isAvailable ? '100% High Chance' : `${probability}% Chance of Confirmation`}
                        </span>
                      </div>

                      <Button size="sm" onClick={() => handleBook(clsCode)} className="h-8 px-4 text-xs">
                        Book Now
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            {classes.length === 0 && (
              <p className="text-ink-soft text-center py-6">No travel classes listed for this train.</p>
            )}

            <div className="rounded-control bg-surface-sunken p-3 text-caption text-ink-soft flex items-center gap-2">
              <ShieldCheck className="size-4 text-royal shrink-0" />
              <span>
                <b>Demo Mode:</b> Availability &amp; predictions are computed from Yatrio's simulated reservation snapshots.
              </span>
            </div>
          </Card>

          {/* Route Schedule Timeline with Intermediate Boarding Halt Selector */}
          <Card className="p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-line pb-4">
              <div>
                <h2 className="text-h4 font-bold text-ink">
                  Route &amp; Station Schedule
                </h2>
                <p className="text-caption text-ink-soft">
                  {stops.length} Scheduled Halts · Total {train.distance || 0} km
                </p>
              </div>

              {/* Boarding Station Dropdown */}
              <div className="flex items-center gap-2">
                <label htmlFor="boarding-station-select" className="text-caption font-semibold text-ink-soft whitespace-nowrap">
                  Boarding At:
                </label>
                <select
                  id="boarding-station-select"
                  value={boardingStation}
                  onChange={(e) => setBoardingStation(e.target.value)}
                  className="h-9 rounded-control border border-line-strong bg-white px-3 text-xs font-semibold text-ink focus:border-royal focus:outline-none cursor-pointer"
                >
                  {stops.map((stop) => {
                    const code = stop.station?.code || stop.stationCode;
                    const name = stop.station?.name || stop.stationName;
                    return (
                      <option key={code} value={code}>
                        {name} ({code})
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>

            {fareOverrides.calculatedDistance && (
              <div className="rounded-control bg-azure/10 border border-azure/20 p-3 text-caption text-royal font-medium flex items-center justify-between">
                <span>
                  Pro-rata journey from <b>{boardingStation}</b> to <b>{train.destination?.code}</b>:
                </span>
                <span className="font-bold">
                  {fareOverrides.calculatedDistance} km (Base Fare updated)
                </span>
              </div>
            )}

            <div className="space-y-6 pl-4 border-l-2 border-line ml-3">
              {stops.map((stop, idx) => {
                const isOrigin = idx === 0;
                const isDest = idx === stops.length - 1;
                const stationCode = stop.station?.code || stop.stationCode;
                const stationName = stop.station?.name || stop.stationName;
                const isBoarding = stationCode === boardingStation;
                const dayOffset = stop.day || stop.dayOffset || 1;

                return (
                  <div key={stationCode ?? idx} className="relative pl-6">
                    {/* Station Marker Dot */}
                    <div
                      className={cn(
                        "absolute -left-[23px] top-1 size-3 rounded-full border-2 border-white shadow-sm transition-transform",
                        isBoarding ? "bg-status-success ring-4 ring-status-success/20 scale-125" : isOrigin ? "bg-status-success" : isDest ? "bg-azure" : "bg-royal"
                      )}
                    />

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-line pb-4">
                      <div>
                        <div className="text-body font-semibold text-ink flex items-center gap-2">
                          <span>{stationName}</span>
                          <span className="text-ink-soft">({stationCode})</span>
                          {isBoarding && (
                            <span className="rounded-full bg-status-success/15 px-2 py-0.5 text-[10px] font-bold text-success-strong">
                              Selected Boarding
                            </span>
                          )}
                          {dayOffset > 1 && (
                            <span className="rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-[10px] font-bold">
                              Day {dayOffset} (+{dayOffset - 1} Day)
                            </span>
                          )}
                        </div>
                        <div className="text-caption text-ink-soft num pt-0.5">
                          {stop.platform && <>Platform {stop.platform} · </>}
                          {stop.haltMinutes > 0 && <>{stop.haltMinutes}m Halt · </>}
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
                            {hhmm(stop.departureTime) ?? (isDest ? 'Terminus' : '—')}
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

          {/* On-board Amenities */}
          <Card className="p-5 space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-ink">
              Train Amenities
            </h3>
            {train.pantryAvailable ? (
              <div className="space-y-3 text-sm text-body">
                <div className="flex items-center gap-3">
                  <Coffee className="size-4 text-royal shrink-0" />
                  <span>Pantry Car &amp; Catering Services</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-ink-soft">
                No on-board amenities are recorded for this train.
              </p>
            )}
          </Card>

          {/* Instant Booking Notice */}
          <div className="rounded-card border border-azure/25 bg-blue-100 p-4 text-caption text-body space-y-1">
            <b className="font-semibold text-royal block">Instant Booking Pipeline</b>
            <span>Confirmations are verified through Yatrio's atomic reservation engine.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
