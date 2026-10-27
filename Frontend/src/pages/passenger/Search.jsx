import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Filter, ArrowRight, IndianRupee, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { RouteConnector } from '@/components/ui/RouteConnector';
import { EmptyState } from '@/components/ui/EmptyState';
import { cn } from '@/lib/utils';
import { trains as mockTrains } from '@/data/trains';
import { useBooking } from '@/context/BookingContext';

export function Search() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setSelectedTrain, setSelectedClass } = useBooking();

  const from = searchParams.get('from') || 'New Delhi (NDLS)';
  const to = searchParams.get('to') || 'Mumbai Central (MMCT)';
  const date = searchParams.get('date') || '2026-10-15';
  const queryClass = searchParams.get('class') || '3A';

  const [isLoading, setIsLoading] = useState(true);
  const [results, setResults] = useState([]);
  const [selectedTypeFilter, setSelectedTypeFilter] = useState('All');
  const [availableOnly, setAvailableOnly] = useState(false);
  const [sortBy, setSortBy] = useState('departure');

  const extractCode = (str) => {
    if (!str) return '';
    const match = str.match(/\(([A-Z0-9]+)\)/);
    if (match) return match[1];
    return str.trim().toUpperCase();
  };

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);

    const fromCode = extractCode(from);
    const toCode = extractCode(to);

    fetch(`http://localhost:5000/api/v1/trains/between?from=${fromCode}&to=${toCode}&date=${date}`)
      .then((res) => {
        if (!res.ok) throw new Error('Live search returned non-OK status');
        return res.json();
      })
      .then((data) => {
        if (!isMounted) return;
        if (data?.data?.trains && data.data.trains.length > 0) {
          const mapped = data.data.trains.map((t) => ({
            id: String(t.trainId || t.trainNumber),
            number: t.trainNumber,
            name: t.trainName,
            type: t.trainType,
            source: { code: fromCode, name: data.data.from?.name || from },
            destination: { code: toCode, name: data.data.to?.name || to },
            departureTime: t.departure,
            arrivalTime: t.arrival,
            duration: t.duration,
            distance: t.distanceKm,
            classes: (t.classes || []).map((c) => ({
              type: c.type,
              name: c.name,
              fare: c.fare,
              availableSeats: c.availableSeats,
              totalSeats: c.totalSeats,
              status: c.status === 'AVAILABLE' ? `AVAILABLE ${c.availableSeats}` : c.status,
            })),
            pantryAvailable: t.pantryAvailable,
          }));
          setResults(mapped);
        } else {
          setResults(mockTrains || []);
        }
      })
      .catch(() => {
        if (isMounted) setResults(mockTrains || []);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [from, to, date]);

  const handleBookNow = (train, cls) => {
    setSelectedTrain(train);
    setSelectedClass(cls?.type || '3A');
    navigate(`/booking/passenger-details?train=${train.id}&class=${cls?.type || '3A'}`);
  };

  const filteredTrains = results
    .filter((train) => {
      if (selectedTypeFilter !== 'All' && train.type !== selectedTypeFilter) return false;
      if (availableOnly) {
        const hasAvail = (train.classes || []).some((c) =>
          typeof c.status === 'string' && c.status.toLowerCase().includes('avail')
        );
        if (!hasAvail) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'departure') {
        return (a.departureTime || '').localeCompare(b.departureTime || '');
      }
      if (sortBy === 'fare') {
        const minFareA = Math.min(...(a.classes?.map((c) => c.fare) || [9999]));
        const minFareB = Math.min(...(b.classes?.map((c) => c.fare) || [9999]));
        return minFareA - minFareB;
      }
      return 0;
    });

  return (
    <div className="mx-auto w-full max-w-content px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Results Header Strip */}
      <div className="rounded-card border border-line-mid bg-white p-5 shadow-card flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft">
            Search Results
          </span>
          <h1 className="text-h3 font-bold tracking-tight text-ink mt-0.5">
            {filteredTrains.length} Trains · {from} → {to}
          </h1>
          <p className="text-sm text-ink-soft mt-0.5 num">
            Journey Date: {new Date(date).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
          </p>
        </div>

        <Link to="/">
          <Button variant="secondary" size="sm">
            <RotateCcw className="size-3.5 mr-1.5" /> Modify Search
          </Button>
        </Link>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Filters Sidebar */}
        <aside className="lg:w-64 shrink-0 space-y-6">
          <Card className="p-5 space-y-6 sticky top-20">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-ink flex items-center gap-2">
                <Filter className="size-4 text-royal" /> Filters
              </h3>
              <button 
                onClick={() => { setSelectedTypeFilter('All'); setAvailableOnly(false); }}
                className="text-caption font-semibold text-royal hover:underline"
              >
                Reset
              </button>
            </div>

            {/* Train Type Chips */}
            <div className="space-y-2.5">
              <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                Train Type
              </span>
              <div className="flex flex-wrap gap-1.5">
                {['All', 'Rajdhani', 'Shatabdi', 'Superfast', 'Express'].map((type) => (
                  <button
                    key={type}
                    onClick={() => setSelectedTypeFilter(type)}
                    className={cn(
                      "text-caption font-semibold px-3 py-1.5 rounded-full border transition-colors cursor-pointer",
                      selectedTypeFilter === type
                        ? "bg-royal text-white border-royal"
                        : "border-line-mid bg-white text-ink hover:bg-fog"
                    )}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            {/* Availability Toggle */}
            <div className="space-y-2 border-t border-line pt-4">
              <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                Seat Availability
              </span>
              <label className="flex items-center gap-2 text-sm text-ink cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={availableOnly}
                  onChange={(e) => setAvailableOnly(e.target.checked)}
                  className="rounded-control border-line-strong text-royal focus:ring-royal size-4"
                />
                <span>Confirmed seats only</span>
              </label>
            </div>
          </Card>
        </aside>

        {/* Results List */}
        <main className="flex-1 space-y-4">
          {/* Sorter Row */}
          <div className="flex justify-between items-center rounded-card border border-line-mid bg-white px-4 py-3 shadow-card text-sm">
            <span className="text-ink-soft num">
              Displaying <strong className="text-ink font-semibold">{filteredTrains.length}</strong> active trains
            </span>
            <div className="flex items-center gap-2">
              <span className="text-caption text-ink-soft font-medium">Sort by:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="bg-transparent text-sm font-semibold text-royal border-none focus:outline-none cursor-pointer"
              >
                <option value="departure">Departure Time</option>
                <option value="duration">Travel Duration</option>
                <option value="fare">Base Fare</option>
              </select>
            </div>
          </div>

          {/* Cards or Loading */}
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="animate-shimmer rounded-card border border-line-mid bg-white p-5 space-y-4 shadow-card">
                <div className="h-5 w-1/3 rounded-full bg-fog" />
                <div className="h-10 w-full rounded-control bg-fog" />
                <div className="h-8 w-1/4 rounded-full bg-fog" />
              </div>
            ))
          ) : filteredTrains.length === 0 ? (
            <EmptyState
              title="No trains matching criteria"
              description="No trains match your selected filters. Adjust your station query, departure dates, or train type filters."
              action={
                <Button onClick={() => setSelectedTypeFilter('All')}>
                  Clear Type Filters
                </Button>
              }
            />
          ) : (
            filteredTrains.map((train) => {
              const defaultClasses = train.classes || [
                { type: '3A', name: '3rd AC', fare: 820, status: 'AVAILABLE 42' },
                { type: '2A', name: '2nd AC', fare: 1250, status: 'RAC 12' },
                { type: 'SL', name: 'Sleeper', fare: 340, status: 'WL 18' },
              ];

              return (
                <article
                  key={train.id}
                  className="rounded-card border border-line-mid bg-white p-5 shadow-card hover:shadow-raised transition-all hover:border-royal/30"
                >
                  <div className="flex flex-col lg:flex-row justify-between gap-6">
                    {/* Train Info + Route Connector */}
                    <div className="flex-1 space-y-4">
                      <div className="flex items-center gap-3">
                        <h2 className="text-h4 font-semibold text-ink">
                          {train.number} {train.name}
                        </h2>
                        <Badge variant="primary" size="sm">
                          {train.type}
                        </Badge>
                      </div>

                      {/* Route Connector Component */}
                      <RouteConnector
                        fromCode={train.source?.code || 'NDLS'}
                        toCode={train.destination?.code || 'MMCT'}
                        fromName={train.source?.name || from}
                        toName={train.destination?.name || to}
                        depTime={train.departureTime || '16:55'}
                        arrTime={train.arrivalTime || '08:35'}
                        duration={train.duration || '15h 40m'}
                      />
                    </div>

                    {/* Classes & Booking Action */}
                    <div className="flex flex-col justify-between gap-4 lg:w-72 shrink-0 border-t lg:border-t-0 lg:border-l border-line pt-4 lg:pt-0 lg:pl-6">
                      <div className="grid grid-cols-2 gap-2">
                        {defaultClasses.map((cls, idx) => (
                          <div
                            key={idx}
                            onClick={() => handleBookNow(train, cls)}
                            className="rounded-control border border-line-mid bg-surface-sunken p-2.5 text-center cursor-pointer hover:border-royal hover:bg-blue-100/50 transition-colors"
                          >
                            <div className="text-caption font-bold text-ink">{cls.type}</div>
                            <div className={cn(
                              "text-caption font-semibold num mt-0.5",
                              cls.status.includes('AVAILABLE') ? "text-success-strong" :
                              cls.status.includes('RAC') ? "text-warning-strong" : "text-error-strong"
                            )}>
                              {cls.status}
                            </div>
                            <div className="num text-xs font-bold text-royal mt-1">
                              ₹{cls.fare}
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="flex gap-2 mt-auto">
                        <Link to={`/trains/${train.id}`} className="flex-1">
                          <Button variant="secondary" size="sm" className="w-full">
                            Details
                          </Button>
                        </Link>
                        <Button
                          size="sm"
                          className="flex-1"
                          onClick={() => handleBookNow(train, defaultClasses[0])}
                        >
                          Book Now
                        </Button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </main>
      </div>
    </div>
  );
}
