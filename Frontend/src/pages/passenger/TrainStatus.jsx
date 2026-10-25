import React, { useEffect, useMemo, useState } from 'react';
import { Clock3, MapPin, Route, Search, Train } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { cn } from '@/lib/utils';
import { estimateTrainPosition, formatDistance } from '@/lib/trainStatus';
import { trainService } from '@/services/trainService';

const hhmm = (value) => (value ? String(value).slice(0, 5) : '—');
const EMPTY_STOPS = [];

const updatedAtLabel = (date) => date.toLocaleString('en-IN', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Kolkata',
});

function normalizeTrain(value) {
  const payload = value?.data ?? value;
  return payload ? {
    ...payload,
    number: payload.trainNumber ?? payload.number,
    name: payload.trainName ?? payload.name,
  } : null;
}

function searchResultLabel(result) {
  return `${result.number ?? result.trainNumber} ${result.name ?? result.trainName}`;
}

export function TrainStatus() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [train, setTrain] = useState(null);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingTrain, setLoadingTrain] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const loadTrain = async (result) => {
    const number = result?.number ?? result?.trainNumber ?? result;
    if (!number) return;

    setLoadingTrain(true);
    setError('');
    try {
      const details = normalizeTrain(await trainService.getStatus(number));
      if (!details) throw new Error('No timetable was returned for this train.');
      setTrain(details);
      setLastUpdated(new Date());
      setResults([]);
    } catch (err) {
      setTrain(null);
      setError(err?.message ?? 'This train timetable could not be loaded.');
    } finally {
      setLoadingTrain(false);
    }
  };

  const handleSearch = async (event) => {
    event.preventDefault();
    const cleanQuery = query.trim();
    if (!cleanQuery) return;

    setLoadingSearch(true);
    setSearched(true);
    setError('');
    setTrain(null);
    try {
      const payload = await trainService.search(cleanQuery);
      const matches = Array.isArray(payload) ? payload : payload?.trains ?? [];
      setResults(matches);
      if (matches.length === 1) await loadTrain(matches[0]);
    } catch (err) {
      setResults([]);
      setError(err?.message ?? 'Train search could not be completed.');
    } finally {
      setLoadingSearch(false);
    }
  };

  const stops = train?.stops ?? EMPTY_STOPS;
  const estimate = useMemo(() => estimateTrainPosition(stops, now), [stops, now]);
  const hasDistanceData = stops.length > 0 && stops.every((stop) => (
    stop.distanceKm !== null && stop.distanceKm !== undefined && Number.isFinite(Number(stop.distanceKm))
  )) && Number(stops.at(-1)?.distanceKm) > 0;
  const totalDistance = hasDistanceData ? Number(stops.at(-1)?.distanceKm) : null;
  const progress = estimate.completionPercent ?? 0;
  const timelinePercent = estimate.timelinePosition === null || stops.length < 2
    ? 0
    : (estimate.timelinePosition / (stops.length - 1)) * 100;

  const stationState = (index) => {
    if (estimate.currentStopIndex === index && estimate.state !== 'unknown') return 'current';
    if (estimate.state === 'ended') return 'covered';
    if (estimate.currentStopIndex !== null && index < estimate.currentStopIndex) return 'covered';
    return 'upcoming';
  };

  return (
    <div className="mx-auto w-full max-w-content px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 max-w-3xl">
        <p className="text-eyebrow font-semibold uppercase tracking-[0.18em] text-royal">Journey tools</p>
        <h1 className="mt-2 text-h2 font-bold tracking-tight text-ink sm:text-display">Train Status</h1>
        <p className="mt-3 text-body text-ink-soft">
          Search a train to view its scheduled route and a timetable-based estimated position.
        </p>
      </div>

      <Card className="mb-6 p-4 sm:p-5">
        <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row">
          <label htmlFor="train-status-search" className="sr-only">Search by train number or name</label>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-soft" aria-hidden="true" />
            <input
              id="train-status-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Enter train number or train name"
              className="h-11 w-full rounded-control border border-line-strong bg-white pl-10 pr-3 text-sm text-ink outline-none transition-colors placeholder:text-label focus:border-royal focus:ring-2 focus:ring-royal/15"
            />
          </div>
          <Button type="submit" isLoading={loadingSearch} leftIcon={<Search className="size-4" />}>
            Search train
          </Button>
        </form>

        {error && <Alert className="mt-4" variant="error" title="Something went wrong" description={error} />}

        {searched && !loadingSearch && !train && results.length === 0 && !error && (
          <EmptyState
            className="mt-4 py-10"
            icon={<Train className="size-6" />}
            title="No train found"
            description={`We could not find an active train matching “${query.trim()}”. Try a train number or a shorter name.`}
          />
        )}

        {results.length > 1 && !train && (
          <div className="mt-4 space-y-2" aria-label="Train search results">
            <p className="text-caption font-semibold uppercase tracking-[0.14em] text-ink-soft">Select a train</p>
            {results.map((result) => (
              <button
                type="button"
                key={result.id ?? result.number}
                onClick={() => loadTrain(result)}
                className="flex w-full items-center justify-between gap-4 rounded-control border border-line bg-surface-sunken px-4 py-3 text-left transition-colors hover:border-royal/40 hover:bg-blue-100"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink">{searchResultLabel(result)}</span>
                  <span className="mt-0.5 block text-caption text-ink-soft">{result.type ?? result.trainType ?? 'Train'}</span>
                </span>
                <span className="shrink-0 text-caption font-semibold text-royal">View status →</span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {loadingTrain && <LoadingSpinner className="py-20" size="lg" text="Loading the scheduled route…" />}

      {train && !loadingTrain && (
        <div className="space-y-6">
          <section className="rounded-card bg-[linear-gradient(135deg,#04275B_0%,#014CA9_78%,#0A63C6_100%)] p-6 text-white shadow-panel blueprint sm:p-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-h3 font-bold tracking-tight text-white sm:text-h2">{train.number} {train.name}</h2>
                  {train.trainType && <Badge variant="secondary" size="md">{train.trainType}</Badge>}
                </div>
                <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-on-dark-soft">
                  <span>{train.source?.name ?? 'Source'}</span><span aria-hidden="true">→</span><span>{train.destination?.name ?? 'Destination'}</span>
                </p>
              </div>
              <Badge variant="info" size="md" showDot pulseDot>
                Estimated Position
              </Badge>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-caption text-on-dark-soft">
              <span className="inline-flex items-center gap-1.5"><Clock3 className="size-3.5" /> Last updated {lastUpdated ? updatedAtLabel(lastUpdated) : 'just now'}</span>
              <span className="inline-flex items-center gap-1.5"><Route className="size-3.5" /> Scheduled timetable only</span>
            </div>
          </section>

          <section aria-label="Journey distance summary" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card className="p-4 sm:p-5"><p className="text-eyebrow font-semibold uppercase tracking-[0.14em] text-ink-soft">Total distance</p><p className="num mt-1 text-h3 font-bold text-ink">{formatDistance(totalDistance)}</p></Card>
            <Card className="p-4 sm:p-5"><p className="text-eyebrow font-semibold uppercase tracking-[0.14em] text-ink-soft">Distance covered</p><p className="num mt-1 text-h3 font-bold text-success-strong">{formatDistance(estimate.coveredDistanceKm)}</p></Card>
            <Card className="p-4 sm:p-5"><p className="text-eyebrow font-semibold uppercase tracking-[0.14em] text-ink-soft">Distance remaining</p><p className="num mt-1 text-h3 font-bold text-ink">{formatDistance(estimate.remainingDistanceKm)}</p></Card>
          </section>

          {!hasDistanceData && (
            <Alert
              variant="warning"
              title="Distance data is not available for this timetable"
              description="The route can still be shown, but distance totals and progress are unavailable. Add cumulative distance_km values to train_routes for every stop to enable them."
            />
          )}

          <Card className="p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft">Journey progress</p>
                <p className="mt-1 text-lead font-semibold text-ink">{estimate.statusLabel}</p>
              </div>
              <span className="num text-h3 font-bold text-success-strong">{hasDistanceData ? `${progress}%` : '—'}</span>
            </div>
            <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-fog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={hasDistanceData ? progress : undefined} aria-label="Journey completion">
              <div className="h-full rounded-full bg-success-strong transition-[width] duration-500" style={{ width: `${hasDistanceData ? progress : 0}%` }} />
            </div>
            <p className="mt-3 text-caption text-ink-soft">This is an estimate from scheduled arrival and departure times; it is not live location telemetry.</p>
          </Card>

          {stops.length === 0 ? (
            <EmptyState
              icon={<MapPin className="size-6" />}
              title="No timetable available"
              description="This train exists in the dataset, but no ordered station timetable has been recorded for it yet."
            />
          ) : (
            <Card className="p-5 sm:p-7">
              <div className="mb-6 flex items-start justify-between gap-4 border-b border-line pb-4">
                <div>
                  <h3 className="text-h4 font-semibold text-ink">Scheduled route</h3>
                  <p className="mt-1 text-caption text-ink-soft">Source to destination · {stops.length} stations</p>
                </div>
                <Train className="size-6 shrink-0 text-royal" aria-hidden="true" />
              </div>

              <div className="relative pl-12">
                <div className="absolute bottom-6 left-6 top-6 w-1 rounded-full bg-line-mid" aria-hidden="true" />
                <div
                  className="absolute left-6 top-6 w-1 rounded-full bg-success-strong transition-[height] duration-500"
                  style={{ height: `calc(${timelinePercent}% - 0.25rem)` }}
                  aria-hidden="true"
                />

                {stops.map((stop, index) => {
                  const state = stationState(index);
                  const covered = state === 'covered';
                  const current = state === 'current';
                  return (
                    <div key={stop.station?.code ?? stop.sequence ?? index} className="relative min-h-[8.25rem] pb-6 last:min-h-0 last:pb-0">
                      <div className={cn(
                        'absolute -left-8 top-1 z-10 flex size-4 items-center justify-center rounded-full border-4 border-white transition-all duration-300',
                        covered && 'bg-success-strong',
                        state === 'upcoming' && 'bg-line-strong',
                        current && 'size-5 -left-[2.125rem] bg-azure ring-4 ring-azure/20',
                      )} aria-label={current ? 'Estimated train position' : undefined}>
                        {current && <span className="size-1.5 rounded-full bg-white" />}
                      </div>

                      <div className={cn(
                        'rounded-card border p-4 transition-colors duration-300',
                        covered && 'border-success-strong/20 bg-success-strong/[0.04]',
                        current && 'border-azure/40 bg-blue-100 shadow-card',
                        state === 'upcoming' && 'border-line bg-surface-sunken/60',
                      )}>
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className={cn('min-w-0', state === 'upcoming' && 'text-ink-soft')}>
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className={cn('text-body font-semibold', state === 'upcoming' ? 'text-ink-soft' : 'text-ink')}>
                                {stop.station?.name ?? 'Unknown station'}
                              </h4>
                              {stop.station?.code && <span className="text-caption font-semibold text-ink-soft">{stop.station.code}</span>}
                              {current && <Badge variant="info" showDot>Estimated Position</Badge>}
                              {covered && !current && <Badge variant="success">Covered</Badge>}
                            </div>
                            <p className="mt-1 text-caption text-ink-soft">{stop.station?.city ?? '—'}{stop.platform ? ` · Platform ${stop.platform}` : ''}</p>
                          </div>

                          <div className="grid grid-cols-3 gap-4 text-left sm:min-w-[19rem] sm:text-right">
                            <div><span className="block text-eyebrow font-semibold uppercase tracking-[0.12em] text-ink-soft">Arrival</span><span className="num text-sm font-semibold text-ink">{index === 0 ? 'Source' : hhmm(stop.arrivalTime)}</span></div>
                            <div><span className="block text-eyebrow font-semibold uppercase tracking-[0.12em] text-ink-soft">Departure</span><span className="num text-sm font-semibold text-ink">{index === stops.length - 1 ? 'Destination' : hhmm(stop.departureTime)}</span></div>
                            <div><span className="block text-eyebrow font-semibold uppercase tracking-[0.12em] text-ink-soft">Distance</span><span className="num text-sm font-semibold text-ink">{formatDistance(stop.distanceKm)}</span></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>
      )}

      {!train && !loadingTrain && !searched && (
        <EmptyState
          icon={<Train className="size-6" />}
          title="Track a train by timetable"
          description="Search by train number or name to see its complete vertical route, distance progress, and estimated position."
        />
      )}
    </div>
  );
}

