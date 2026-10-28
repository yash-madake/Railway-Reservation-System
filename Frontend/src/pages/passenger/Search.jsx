import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { 
  Filter, 
  ArrowRight, 
  IndianRupee, 
  RotateCcw, 
  Clock, 
  Coffee, 
  Search as SearchIcon, 
  X, 
  Check,
  Sunrise,
  Sun,
  Sunset,
  Moon
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { RouteConnector } from '@/components/ui/RouteConnector';
import { EmptyState } from '@/components/ui/EmptyState';
import { cn } from '@/lib/utils';
import { useBooking } from '@/context/BookingContext';

const QUOTAS = [
  { code: 'GN', label: 'General' },
  { code: 'TQ', label: 'Tatkal' },
  { code: 'LD', label: 'Ladies' },
  { code: 'PT', label: 'Premium Tatkal' },
  { code: 'SS', label: 'Senior Citizen' },
];

const TRAIN_TYPES = [
  'All',
  'Rajdhani',
  'Shatabdi',
  'Duronto',
  'Superfast',
  'Express',
  'Garib Rath',
  'Special',
];

const TRAVEL_CLASSES = [
  { code: 'All', label: 'All Classes' },
  { code: '1A', label: '1A · First AC' },
  { code: '2A', label: '2A · AC 2 Tier' },
  { code: '3A', label: '3A · AC 3 Tier' },
  { code: 'SL', label: 'SL · Sleeper' },
  { code: 'CC', label: 'CC · Chair Car' },
  { code: '2S', label: '2S · Second Sitting' },
];

const TIME_SLOTS = [
  { id: 'All', label: 'Any Time', range: '' },
  { id: 'early', label: 'Early Morning', range: '00:00 - 06:00', icon: Sunrise },
  { id: 'morning', label: 'Morning', range: '06:00 - 12:00', icon: Sun },
  { id: 'afternoon', label: 'Afternoon', range: '12:00 - 18:00', icon: Sunset },
  { id: 'night', label: 'Night', range: '18:00 - 24:00', icon: Moon },
];

export function Search() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setSelectedTrain, setSelectedClass } = useBooking();

  const from = searchParams.get('from') || 'New Delhi (NDLS)';
  const to = searchParams.get('to') || 'Mumbai Central (MMCT)';
  const date = searchParams.get('date') || '2026-11-04';
  const queryClass = searchParams.get('class') || 'All';
  const queryQuota = searchParams.get('quota') || 'GN';

  const [isLoading, setIsLoading] = useState(true);
  const [results, setResults] = useState([]);
  const [loadError, setLoadError] = useState(null);

  // Filter States
  const [searchKeyword, setSearchKeyword] = useState('');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState('All');
  const [selectedClassFilter, setSelectedClassFilter] = useState(queryClass);
  const [selectedQuota, setSelectedQuota] = useState(queryQuota);
  const [departureTimeSlot, setDepartureTimeSlot] = useState('All');
  const [arrivalTimeSlot, setArrivalTimeSlot] = useState('All');
  const [availableOnly, setAvailableOnly] = useState(false);
  const [pantryOnly, setPantryOnly] = useState(false);
  const [sortBy, setSortBy] = useState('departure');

  const extractCode = (str) => {
    if (!str) return '';
    const match = str.match(/\(([A-Z0-9]+)\)/);
    if (match) return match[1];
    return str.trim().toUpperCase();
  };

  const fromCode = extractCode(from);
  const toCode = extractCode(to);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setLoadError(null);

    fetch(`http://localhost:5000/api/v1/trains/between?from=${fromCode}&to=${toCode}&date=${date}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Live search returned ${res.status}.`);
        return res.json();
      })
      .then((data) => {
        if (!isMounted) return;
        const mapped = (data?.data?.trains ?? []).map((t) => ({
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
          pantryAvailable: Boolean(t.pantryAvailable),
        }));
        setResults(mapped);
      })
      .catch((err) => {
        if (!isMounted) return;
        setResults([]);
        setLoadError(err?.message ?? 'Could not reach the search service.');
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [fromCode, toCode, date]);

  const handleBookNow = (train, cls) => {
    setSelectedTrain(train);
    setSelectedClass(cls?.type ?? null);
    navigate(`/booking/passenger-details?train=${train.number ?? train.id}${cls?.type ? `&class=${cls.type}` : ''}&quota=${selectedQuota}&date=${date}`);
  };

  const parseTimeToMinutes = (timeStr) => {
    if (!timeStr) return null;
    const parts = String(timeStr).split(':');
    if (parts.length < 2) return null;
    const hours = parseInt(parts[0], 10);
    const mins = parseInt(parts[1], 10);
    if (isNaN(hours) || isNaN(mins)) return null;
    return hours * 60 + mins;
  };

  const matchesTimeSlot = (timeStr, slot) => {
    if (slot === 'All') return true;
    const mins = parseTimeToMinutes(timeStr);
    if (mins === null) return true;
    if (slot === 'early') return mins >= 0 && mins < 360;       // 00:00 - 06:00
    if (slot === 'morning') return mins >= 360 && mins < 720;   // 06:00 - 12:00
    if (slot === 'afternoon') return mins >= 720 && mins < 1080; // 12:00 - 18:00
    if (slot === 'night') return mins >= 1080 && mins < 1440;   // 18:00 - 24:00
    return true;
  };

  const parseDurationMinutes = (str) => {
    if (!str) return 99999;
    const m = String(str).match(/(?:(\d+)h)?\s*(?:(\d+)m)?/i);
    if (!m) return 99999;
    const hours = parseInt(m[1] || '0', 10);
    const minutes = parseInt(m[2] || '0', 10);
    return hours * 60 + minutes;
  };

  const resetAllFilters = () => {
    setSearchKeyword('');
    setSelectedTypeFilter('All');
    setSelectedClassFilter('All');
    setDepartureTimeSlot('All');
    setArrivalTimeSlot('All');
    setAvailableOnly(false);
    setPantryOnly(false);
    setSortBy('departure');
  };

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (searchKeyword.trim()) count++;
    if (selectedTypeFilter !== 'All') count++;
    if (selectedClassFilter !== 'All') count++;
    if (departureTimeSlot !== 'All') count++;
    if (arrivalTimeSlot !== 'All') count++;
    if (availableOnly) count++;
    if (pantryOnly) count++;
    return count;
  }, [
    searchKeyword,
    selectedTypeFilter,
    selectedClassFilter,
    departureTimeSlot,
    arrivalTimeSlot,
    availableOnly,
    pantryOnly,
  ]);

  const filteredTrains = useMemo(() => {
    return results
      .filter((train) => {
        // 1. Train Number or Name Filter
        if (searchKeyword.trim()) {
          const kw = searchKeyword.trim().toLowerCase();
          const matchesNo = String(train.number || '').toLowerCase().includes(kw);
          const matchesName = String(train.name || '').toLowerCase().includes(kw);
          if (!matchesNo && !matchesName) return false;
        }

        // 2. Train Type Filter
        if (selectedTypeFilter !== 'All') {
          const tType = String(train.type || '').toLowerCase();
          const targetType = selectedTypeFilter.toLowerCase();
          if (!tType.includes(targetType)) return false;
        }

        // 3. Travel Class Filter
        if (selectedClassFilter !== 'All') {
          const hasClass = (train.classes || []).some(
            (c) => String(c.type || '').toUpperCase() === selectedClassFilter.toUpperCase()
          );
          if (!hasClass) return false;
        }

        // 4. Departure Time Slot
        if (!matchesTimeSlot(train.departureTime, departureTimeSlot)) {
          return false;
        }

        // 5. Arrival Time Slot
        if (!matchesTimeSlot(train.arrivalTime, arrivalTimeSlot)) {
          return false;
        }

        // 6. Pantry available
        if (pantryOnly && !train.pantryAvailable) {
          return false;
        }

        // 7. Confirmed / Available Seats Only
        if (availableOnly) {
          if (selectedClassFilter !== 'All') {
            const targetCls = (train.classes || []).find(
              (c) => String(c.type || '').toUpperCase() === selectedClassFilter.toUpperCase()
            );
            if (!targetCls) return false;
            const statusStr = String(targetCls.status || '').toLowerCase();
            const hasSeats = (targetCls.availableSeats || 0) > 0 || statusStr.includes('avail');
            if (!hasSeats) return false;
          } else {
            const hasAnyAvail = (train.classes || []).some((c) => {
              const statusStr = String(c.status || '').toLowerCase();
              return (c.availableSeats || 0) > 0 || statusStr.includes('avail');
            });
            if (!hasAnyAvail) return false;
          }
        }

        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'departure') {
          return (a.departureTime || '').localeCompare(b.departureTime || '');
        }
        if (sortBy === 'departure_desc') {
          return (b.departureTime || '').localeCompare(a.departureTime || '');
        }
        if (sortBy === 'duration') {
          return parseDurationMinutes(a.duration) - parseDurationMinutes(b.duration);
        }
        if (sortBy === 'fare') {
          const minA = Math.min(...(a.classes?.map((c) => c.fare) || [9999]));
          const minB = Math.min(...(b.classes?.map((c) => c.fare) || [9999]));
          return minA - minB;
        }
        if (sortBy === 'fare_desc') {
          const minA = Math.min(...(a.classes?.map((c) => c.fare) || [0]));
          const minB = Math.min(...(b.classes?.map((c) => c.fare) || [0]));
          return minB - minA;
        }
        if (sortBy === 'arrival') {
          return (a.arrivalTime || '').localeCompare(b.arrivalTime || '');
        }
        return 0;
      });
  }, [
    results,
    searchKeyword,
    selectedTypeFilter,
    selectedClassFilter,
    departureTimeSlot,
    arrivalTimeSlot,
    availableOnly,
    pantryOnly,
    sortBy,
  ]);

  return (
    <div className="mx-auto w-full max-w-content px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Top Banner / Results Header */}
      <div className="rounded-card border border-line-mid bg-white p-5 shadow-card flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft">
            Train Search & Seat Availability
          </span>
          <h1 className="text-h3 font-bold tracking-tight text-ink mt-0.5">
            {filteredTrains.length} {filteredTrains.length === 1 ? 'Train' : 'Trains'} Found · {from} → {to}
          </h1>
          <p className="text-sm text-ink-soft mt-0.5 num">
            Journey Date: {new Date(date).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
            {' · '}Quota: <strong className="text-ink">{QUOTAS.find(q => q.code === selectedQuota)?.label || selectedQuota}</strong>
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link to="/">
            <Button variant="secondary" size="sm">
              <RotateCcw className="size-3.5 mr-1.5" /> Modify Journey
            </Button>
          </Link>
        </div>
      </div>

      {/* Quota Selection Strip (Team 3 Quotas) */}
      <div className="rounded-card border border-line-mid bg-white p-3.5 shadow-card flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-ink-soft mr-2">
          Booking Quota:
        </span>
        {QUOTAS.map((q) => (
          <button
            key={q.code}
            onClick={() => setSelectedQuota(q.code)}
            className={cn(
              "px-3 py-1.5 text-xs font-semibold rounded-control transition-all cursor-pointer border",
              selectedQuota === q.code
                ? "bg-royal text-white border-royal shadow-sm"
                : "bg-surface-sunken text-ink border-line-mid hover:bg-fog"
            )}
          >
            {q.label} ({q.code})
          </button>
        ))}
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* FILTERS SIDEBAR */}
        <aside className="lg:w-72 shrink-0 space-y-6">
          <Card className="p-5 space-y-5 sticky top-20">
            {/* Header + Reset */}
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-ink flex items-center gap-2">
                <Filter className="size-4 text-royal" /> Filters
                {activeFiltersCount > 0 && (
                  <span className="px-2 py-0.5 text-xs font-bold bg-royal text-white rounded-full">
                    {activeFiltersCount}
                  </span>
                )}
              </h3>
              {activeFiltersCount > 0 && (
                <button
                  onClick={resetAllFilters}
                  className="text-caption font-semibold text-royal hover:underline cursor-pointer flex items-center gap-1"
                >
                  <X className="size-3" /> Reset All
                </button>
              )}
            </div>

            {/* 1. Quick Train Search Input */}
            <div className="space-y-2">
              <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                Search Train
              </span>
              <div className="relative">
                <SearchIcon className="size-4 text-ink-soft absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                  placeholder="Number or name..."
                  className="w-full pl-9 pr-3 py-2 text-xs font-medium rounded-control border border-line-mid bg-white text-ink placeholder:text-ink-soft focus:outline-none focus:border-royal focus:ring-1 focus:ring-royal"
                />
                {searchKeyword && (
                  <button
                    onClick={() => setSearchKeyword('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-soft hover:text-ink"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* 2. Travel Class Filter */}
            <div className="space-y-2 border-t border-line pt-4">
              <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                Travel Class
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {TRAVEL_CLASSES.map((cls) => (
                  <button
                    key={cls.code}
                    onClick={() => setSelectedClassFilter(cls.code)}
                    className={cn(
                      "text-xs font-semibold px-2.5 py-1.5 rounded-control border text-left transition-colors cursor-pointer truncate",
                      selectedClassFilter === cls.code
                        ? "bg-royal text-white border-royal shadow-sm"
                        : "border-line-mid bg-white text-ink hover:bg-fog"
                    )}
                    title={cls.label}
                  >
                    {cls.code === 'All' ? 'All Classes' : cls.code}
                  </button>
                ))}
              </div>
            </div>

            {/* 3. Train Type Filter */}
            <div className="space-y-2 border-t border-line pt-4">
              <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                Train Type
              </span>
              <div className="flex flex-wrap gap-1.5">
                {TRAIN_TYPES.map((type) => (
                  <button
                    key={type}
                    onClick={() => setSelectedTypeFilter(type)}
                    className={cn(
                      "text-caption font-semibold px-2.5 py-1.5 rounded-full border transition-colors cursor-pointer",
                      selectedTypeFilter === type
                        ? "bg-royal text-white border-royal shadow-sm"
                        : "border-line-mid bg-white text-ink hover:bg-fog"
                    )}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            {/* 4. Departure Time Slot */}
            <div className="space-y-2 border-t border-line pt-4">
              <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block flex items-center gap-1.5">
                <Clock className="size-3.5 text-royal" /> Departure Time
              </span>
              <div className="space-y-1.5">
                {TIME_SLOTS.map((slot) => {
                  const Icon = slot.icon;
                  const isSelected = departureTimeSlot === slot.id;
                  return (
                    <button
                      key={slot.id}
                      onClick={() => setDepartureTimeSlot(slot.id)}
                      className={cn(
                        "w-full text-left px-2.5 py-1.5 rounded-control text-xs font-medium border flex items-center justify-between transition-colors cursor-pointer",
                        isSelected
                          ? "bg-royal text-white border-royal shadow-sm"
                          : "border-line-mid bg-white text-ink hover:bg-fog"
                      )}
                    >
                      <span className="flex items-center gap-1.5">
                        {Icon && <Icon className="size-3.5 shrink-0" />}
                        {slot.label}
                      </span>
                      {slot.range && (
                        <span className={cn("text-[10px]", isSelected ? "text-white/80" : "text-ink-soft")}>
                          {slot.range}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 5. Arrival Time Slot */}
            <div className="space-y-2 border-t border-line pt-4">
              <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block flex items-center gap-1.5">
                <Clock className="size-3.5 text-royal" /> Arrival Time
              </span>
              <div className="space-y-1.5">
                {TIME_SLOTS.map((slot) => {
                  const Icon = slot.icon;
                  const isSelected = arrivalTimeSlot === slot.id;
                  return (
                    <button
                      key={slot.id}
                      onClick={() => setArrivalTimeSlot(slot.id)}
                      className={cn(
                        "w-full text-left px-2.5 py-1.5 rounded-control text-xs font-medium border flex items-center justify-between transition-colors cursor-pointer",
                        isSelected
                          ? "bg-royal text-white border-royal shadow-sm"
                          : "border-line-mid bg-white text-ink hover:bg-fog"
                      )}
                    >
                      <span className="flex items-center gap-1.5">
                        {Icon && <Icon className="size-3.5 shrink-0" />}
                        {slot.label}
                      </span>
                      {slot.range && (
                        <span className={cn("text-[10px]", isSelected ? "text-white/80" : "text-ink-soft")}>
                          {slot.range}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 6. Special Features & Availability Toggles */}
            <div className="space-y-3 border-t border-line pt-4">
              <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                Preferences & Availability
              </span>
              <label className="flex items-center gap-2.5 text-xs font-medium text-ink cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={availableOnly}
                  onChange={(e) => setAvailableOnly(e.target.checked)}
                  className="rounded-control border-line-strong text-royal focus:ring-royal size-4 cursor-pointer"
                />
                <span>Available / Confirmed seats only</span>
              </label>

              <label className="flex items-center gap-2.5 text-xs font-medium text-ink cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={pantryOnly}
                  onChange={(e) => setPantryOnly(e.target.checked)}
                  className="rounded-control border-line-strong text-royal focus:ring-royal size-4 cursor-pointer"
                />
                <span className="flex items-center gap-1">
                  <Coffee className="size-3.5 text-amber-600" />
                  Pantry car / Catering available
                </span>
              </label>
            </div>
          </Card>
        </aside>

        {/* RESULTS MAIN LIST */}
        <main className="flex-1 space-y-4">
          {/* Sorting & Counter Strip */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 rounded-card border border-line-mid bg-white px-4 py-3 shadow-card text-sm">
            <span className="text-ink-soft num">
              Displaying <strong className="text-ink font-semibold">{filteredTrains.length}</strong> of {results.length} active trains
              {activeFiltersCount > 0 && ` (${activeFiltersCount} filter active)`}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-caption text-ink-soft font-medium">Sort by:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="bg-transparent text-sm font-semibold text-royal border-none focus:outline-none cursor-pointer"
              >
                <option value="departure">Departure: Earliest First</option>
                <option value="departure_desc">Departure: Latest First</option>
                <option value="duration">Travel Duration: Fastest First</option>
                <option value="fare">Base Fare: Lowest First</option>
                <option value="fare_desc">Base Fare: Highest First</option>
                <option value="arrival">Arrival: Earliest First</option>
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
              title={loadError ? 'Could not reach the search service' : 'No trains matching your filter criteria'}
              description={
                loadError
                  ? `${loadError} Nothing below is shown in its place — an empty result here means the search did not complete, not that no trains run.`
                  : activeFiltersCount > 0
                    ? `None of the ${results.length} trains match all ${activeFiltersCount} applied filters. Try adjusting or clearing your filters.`
                    : 'No trains run between these two stations on the selected date. Try choosing an alternate date or nearby major junction.'
              }
              action={
                loadError ? (
                  <Button onClick={() => navigate(0)}>Try Again</Button>
                ) : activeFiltersCount > 0 ? (
                  <Button onClick={resetAllFilters}>
                    Clear All Filters ({activeFiltersCount})
                  </Button>
                ) : (
                  <Link to="/">
                    <Button>Change Search Route</Button>
                  </Link>
                )
              }
            />
          ) : (
            filteredTrains.map((train) => {
              const classes = train.classes ?? [];

              return (
                <article
                  key={train.id}
                  className="rounded-card border border-line-mid bg-white p-5 shadow-card hover:shadow-raised transition-all hover:border-royal/30"
                >
                  <div className="flex flex-col lg:flex-row justify-between gap-6">
                    {/* Train Info + Route Connector */}
                    <div className="flex-1 space-y-4">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <h2 className="text-h4 font-semibold text-ink">
                          {train.number} {train.name}
                        </h2>
                        <Badge variant="primary" size="sm">
                          {train.type}
                        </Badge>
                        {train.pantryAvailable && (
                          <Badge variant="outline" size="sm" className="text-amber-700 border-amber-300 bg-amber-50">
                            <Coffee className="size-3 mr-1 inline" /> Pantry
                          </Badge>
                        )}
                      </div>

                      {/* Route Connector Component */}
                      <RouteConnector
                        fromCode={train.source?.code ?? fromCode}
                        toCode={train.destination?.code ?? toCode}
                        fromName={train.source?.name || from}
                        toName={train.destination?.name || to}
                        depTime={train.departureTime ?? ''}
                        arrTime={train.arrivalTime ?? ''}
                        duration={train.duration ?? ''}
                      />
                    </div>

                    {/* Classes & Booking Action */}
                    <div className="flex flex-col justify-between gap-4 lg:w-80 shrink-0 border-t lg:border-t-0 lg:border-l border-line pt-4 lg:pt-0 lg:pl-6">
                      <div className="grid grid-cols-2 gap-2">
                        {classes.map((cls) => {
                          const status = String(cls.status ?? '');
                          const isSelectedClass = selectedClassFilter !== 'All' && 
                            String(cls.type).toUpperCase() === selectedClassFilter.toUpperCase();

                          return (
                            <div
                              key={cls.type}
                              onClick={() => handleBookNow(train, cls)}
                              className={cn(
                                "rounded-control border p-2.5 text-center cursor-pointer transition-all",
                                isSelectedClass
                                  ? "border-royal bg-blue-50/70 ring-1 ring-royal shadow-sm"
                                  : "border-line-mid bg-surface-sunken hover:border-royal hover:bg-blue-100/50"
                              )}
                            >
                              <div className="text-caption font-bold text-ink flex items-center justify-center gap-1">
                                {cls.type}
                                {isSelectedClass && <Check className="size-3 text-royal" />}
                              </div>
                              <div className={cn(
                                "text-caption font-semibold num mt-0.5",
                                status.includes('AVAILABLE') ? "text-success-strong" :
                                status.includes('RAC') ? "text-warning-strong" : "text-error-strong"
                              )}>
                                {status || 'Status unavailable'}
                              </div>
                              <div className="num text-xs font-bold text-royal mt-1">
                                {cls.fare != null ? `₹${cls.fare}` : '—'}
                              </div>
                            </div>
                          );
                        })}
                        {classes.length === 0 && (
                          <p className="col-span-2 text-caption text-ink-soft">
                            No bookable classes returned for this train.
                          </p>
                        )}
                      </div>

                      <div className="flex gap-2 mt-auto">
                        <Link
                          to={`/trains/${train.number ?? train.id}?date=${encodeURIComponent(date)}&class=${encodeURIComponent(selectedClassFilter !== 'All' ? selectedClassFilter : queryClass)}&quota=${encodeURIComponent(selectedQuota)}`}
                          className="flex-1"
                        >
                          <Button variant="secondary" size="sm" className="w-full">
                            Schedule & Fare
                          </Button>
                        </Link>
                        {classes.length > 0 && (
                          <Button
                            size="sm"
                            className="flex-1"
                            onClick={() => {
                              const preferredCls = classes.find(c => selectedClassFilter !== 'All' && c.type === selectedClassFilter) || classes[0];
                              handleBookNow(train, preferredCls);
                            }}
                          >
                            Book Now
                          </Button>
                        )}
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
