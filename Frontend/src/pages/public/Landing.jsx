import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowRight, ArrowLeftRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatTile } from '@/components/ui/StatTile';
import { RouteConnector } from '@/components/ui/RouteConnector';
import { API_BASE_URL } from '@/api/client';
import { useBooking } from '@/context/BookingContext';
export function Landing() {
    const navigate = useNavigate();
    const { setSearchParams } = useBooking();

    /**
     * Network figures and a few trains, read from the API.
     *
     * The stat strip used to read "12,480 trains", "98.4% on-time", "2.4M daily
     * passengers" and "1,840 routes" as literals, with invented "+3.2%" deltas,
     * and the band below it showed three invented trains under a "Live railway
     * network / Network Operating Normal" heading. There is no on-time metric
     * and no daily-passenger count anywhere in this system, so two of those
     * numbers could not be made real — only counted, measured things are shown.
     */
    const [stats, setStats] = useState(null);
    const [trains, setTrains] = useState([]);
    const [statsFailed, setStatsFailed] = useState(false);

    useEffect(() => {
        let isMounted = true;

        fetch(`${API_BASE_URL}/trains/stats`)
            .then((res) => {
                if (!res.ok) throw new Error(`stats ${res.status}`);
                return res.json();
            })
            .then((body) => {
                if (isMounted) setStats(body?.data ?? null);
            })
            .catch(() => {
                if (isMounted) setStatsFailed(true);
            });

        fetch(`${API_BASE_URL}/trains/search?limit=3`)
            .then((res) => {
                if (!res.ok) throw new Error(`trains ${res.status}`);
                return res.json();
            })
            .then((body) => {
                if (isMounted) setTrains(Array.isArray(body?.data) ? body.data : []);
            })
            .catch(() => {
                /* the band renders an honest empty state below */
            });

        return () => {
            isMounted = false;
        };
    }, []);

    const counts = stats?.counts;
    const routes = stats?.popularRoutes ?? [];
    const number = new Intl.NumberFormat('en-IN');

    const [fromStation, setFromStation] = useState('New Delhi (NDLS)');
    const [toStation, setToStation] = useState('Mumbai Central (MMCT)');
    const [journeyDate, setJourneyDate] = useState('');
    const [selectedClass, setSelectedClass] = useState('');
    const handleSwap = () => {
        const temp = fromStation;
        setFromStation(toStation);
        setToStation(temp);
    };
    const handleSearch = (e) => {
        e.preventDefault();
        setSearchParams({
            fromStation,
            toStation,
            date: journeyDate,
            class: selectedClass,
            passengers: 1,
        });
        navigate(`/search?from=${encodeURIComponent(fromStation)}&to=${encodeURIComponent(toStation)}&date=${journeyDate}&class=${selectedClass}`);
    };
    return (<div className="w-full">
      {/* 1. HERO SECTION — Horizon Gradient + Blueprint Grid */}
      <section className="relative overflow-hidden bg-[linear-gradient(135deg,#04275B_0%,#014CA9_78%,#0A63C6_100%)] pt-16 pb-28 text-white blueprint">
        <div className="mx-auto w-full max-w-content px-4 sm:px-6 lg:px-8 relative z-10 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-sky/35 bg-sky/12 px-3 py-1.5 text-caption font-semibold text-sky-bright mb-6">
            <span className="size-1.5 animate-pulse rounded-full bg-sky"/>
            Yatrio Engine v2.4 · Real-time rail platform
          </div>

          <h1 className="mx-auto max-w-4xl text-display font-bold tracking-tight text-white leading-tight">
            Rail journeys, reimagined in motion.
          </h1>

          <p className="mx-auto mt-4 max-w-2xl text-lead text-on-dark-soft">
            Live train tracking, honest timings, and booking that feels as fast as the train itself.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Button size="lg" onClick={() => navigate('/search')} className="shadow-raised">
              Book a Train
              <ArrowRight className="size-4"/>
            </Button>
            <Button variant="darkSecondary" size="lg" onClick={() => navigate('/pnr')}>
              Check PNR Status
            </Button>
          </div>
        </div>
      </section>

      {/* 2. SIGNATURE SEARCH FORM — Overlaps hero seam (-mt-12) */}
      <div className="mx-auto w-full max-w-content px-4 sm:px-6 lg:px-8 -mt-12 relative z-20">
        <form onSubmit={handleSearch} className="rounded-card border border-line-mid bg-white p-5 shadow-raised transition-shadow hover:shadow-panel">
          <div className="grid gap-4 lg:grid-cols-[1.5fr_auto_1.5fr_1.2fr_1fr_auto] lg:items-end">
            {/* From Station */}
            <div className="space-y-1.5">
              <label htmlFor="from-station" className="block text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft">
                Origin Station
              </label>
              <input id="from-station" type="text" value={fromStation} onChange={(e) => setFromStation(e.target.value)} placeholder="Station name or code" required className="h-11 w-full rounded-control border border-line-strong bg-white px-3.5 text-sm font-medium text-ink transition-colors hover:border-ink-soft focus:border-royal focus:outline-none focus:ring-4 focus:ring-royal/15"/>
            </div>

            {/* Swap Button */}
            <div className="flex items-center justify-center pb-0.5">
              <button type="button" onClick={handleSwap} aria-label="Swap origin and destination" className="size-11 flex items-center justify-center rounded-control border border-line-strong bg-white text-ink-soft hover:text-royal hover:border-royal transition-colors">
                <ArrowLeftRight className="size-4"/>
              </button>
            </div>

            {/* To Station */}
            <div className="space-y-1.5">
              <label htmlFor="to-station" className="block text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft">
                Destination Station
              </label>
              <input id="to-station" type="text" value={toStation} onChange={(e) => setToStation(e.target.value)} placeholder="Station name or code" required className="h-11 w-full rounded-control border border-line-strong bg-white px-3.5 text-sm font-medium text-ink transition-colors hover:border-ink-soft focus:border-royal focus:outline-none focus:ring-4 focus:ring-royal/15"/>
            </div>

            {/* Date */}
            <div className="space-y-1.5">
              <label htmlFor="journey-date" className="block text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft">
                Date of Journey
              </label>
              <input id="journey-date" type="date" value={journeyDate} onChange={(e) => setJourneyDate(e.target.value)} required className="h-11 w-full rounded-control border border-line-strong bg-white px-3.5 text-sm font-medium text-ink transition-colors hover:border-ink-soft focus:border-royal focus:outline-none focus:ring-4 focus:ring-royal/15"/>
            </div>

            {/* Class */}
            <div className="space-y-1.5">
              <label htmlFor="class-select" className="block text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft">
                Travel Class
              </label>
              <select id="class-select" value={selectedClass} onChange={(e) => setSelectedClass(e.target.value)} className="h-11 w-full rounded-control border border-line-strong bg-white px-3 text-sm font-medium text-ink focus:border-royal focus:outline-none focus:ring-4 focus:ring-royal/15 cursor-pointer">
                <option value="1A">1A · First AC</option>
                <option value="2A">2A · AC 2 Tier</option>
                <option value="3A">3A · AC 3 Tier</option>
                <option value="SL">SL · Sleeper</option>
                <option value="CC">CC · Chair Car</option>
              </select>
            </div>

            {/* Submit */}
            <div>
              <Button type="submit" size="md" className="w-full lg:w-auto h-11 px-6">
                Search Trains
              </Button>
            </div>
          </div>
        </form>
      </div>

      {/* 3. STAT STRIP — counted from the database, nothing invented. */}
      <section className="py-12 md:py-16">
        <div className="mx-auto w-full max-w-content px-4 sm:px-6 lg:px-8">
          {statsFailed ? (
            <p className="text-center text-caption text-ink-soft">
              Network figures are unavailable right now.
            </p>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatTile
                label="Trains in service"
                value={counts ? number.format(counts.trains) : '—'}
              />
              <StatTile
                label="Stations served"
                value={counts ? number.format(counts.stations) : '—'}
              />
              <StatTile
                label="Coaches mapped"
                value={counts ? number.format(counts.coaches) : '—'}
              />
              <StatTile
                label="Berths bookable"
                value={counts ? number.format(counts.berths) : '—'}
              />
            </div>
          )}
        </div>
      </section>

      {/* 4. TRAIN PREVIEW — Dark Band, from GET /trains/search */}
      <section className="bg-ink py-16 text-white border-y border-white/10 blueprint">
        <div className="mx-auto w-full max-w-content px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
            <div>
              <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-sky-bright">
                Engine Telemetry
              </span>
              <h2 className="text-h2 font-bold tracking-tight text-white mt-1">
                Trains in the network
              </h2>
            </div>
            <Badge variant="outline" size="md">
              From the database
            </Badge>
          </div>

          {trains.length === 0 ? (
            <p className="text-on-dark-soft">No trains are listed right now.</p>
          ) : (
            <div className="grid gap-6 md:grid-cols-3">
              {trains.map((train) => (
                <Link
                  key={train.id ?? train.number}
                  to={`/trains/${train.number}`}
                  className="rounded-card border border-white/10 bg-panel p-5 space-y-4 hover:border-royal/50 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-h4 font-semibold text-white">
                      {train.number} {train.name}
                    </h3>
                    {train.type && (
                      <span className="text-caption text-sky-bright">{train.type}</span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {(train.runningDays ?? []).map((d) => (
                      <span key={d} className="num text-caption text-on-dark-soft">{d.slice(0, 2)}</span>
                    ))}
                  </div>

                  <div className="flex items-center justify-between text-caption text-on-dark-soft pt-2 border-t border-white/10">
                    <span className="num">{train.runningDays?.length ?? 0} days a week</span>
                    <span className={train.status === 'active' ? 'text-sky-bright' : 'text-error-strong'}>
                      {train.status}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 5. HOW IT WORKS — Numbered Steps */}
      <section className="py-16 md:py-20 bg-paper">
        <div className="mx-auto w-full max-w-content px-4 sm:px-6 lg:px-8 text-center">
          <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft">
            Engineered Efficiency
          </span>
          <h2 className="text-h2 font-bold tracking-tight text-ink mt-1 mb-12">
            Built for velocity
          </h2>

          <div className="grid gap-8 md:grid-cols-3 text-left">
            {[
            {
                step: '01',
                title: 'Instant Search',
                desc: 'Locate trains between any station pair with live seat availability and honest delay predictions.',
            },
            {
                step: '02',
                title: 'Seamless Passenger Flow',
                desc: 'Add passenger details once, select berths visually on coach blueprints, and review transparent fares.',
            },
            {
                step: '03',
                title: 'Instant Gate-Ready Ticket',
                desc: 'Complete simulated test checkout and receive an authentic digital ticket with scannable barcode.',
            },
        ].map((item) => (<Card key={item.step} className="p-6 relative overflow-hidden">
                <span className="num text-display font-bold text-royal/15 absolute right-4 top-2 select-none">
                  {item.step}
                </span>
                <div className="size-10 rounded-control bg-royal/10 text-royal flex items-center justify-center font-bold mb-4">
                  {item.step}
                </div>
                <h3 className="text-h4 font-semibold text-ink mb-2">{item.title}</h3>
                <p className="text-body text-ink-soft">{item.desc}</p>
              </Card>))}
          </div>
        </div>
      </section>

      {/* 6. POPULAR ROUTES */}
      <section className="py-16 bg-white border-t border-line-mid">
        <div className="mx-auto w-full max-w-content px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-end mb-8">
            <div>
              <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft">
                Network Corridors
              </span>
              <h2 className="text-h2 font-bold tracking-tight text-ink mt-1">
                Frequently travelled routes
              </h2>
            </div>
            <Link to="/search" className="text-sm font-semibold text-royal hover:text-azure">
              View all corridors →
            </Link>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {routes.length === 0 ? (
              <p className="col-span-full text-caption text-ink-soft">
                No corridor data is available.
              </p>
            ) : routes.map((route) => (
              <Link
                key={`${route.train_number}-${route.origin}`}
                to={`/trains/${route.train_number}`}
                className="group rounded-card border border-line-mid bg-white p-5 shadow-card hover:shadow-raised hover:border-royal/30 transition-all"
              >
                <div className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft">
                  {route.train_number} {route.train_name}
                </div>
                <RouteConnector
                  fromCode={null}
                  toCode={null}
                  fromName={route.origin}
                  toName={route.destination}
                  duration={null}
                  size="sm"
                />
                <div className="mt-4 pt-3 border-t border-line flex justify-between items-center text-sm">
                  <span className="text-caption text-ink-soft num">
                    {Number(route.booked_count ?? 0).toLocaleString('en-IN')} bookings
                  </span>
                  <ArrowRight className="size-4 text-royal group-hover:translate-x-0.5 transition-transform" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* 7. CTA BAND — Horizon Gradient */}
      <section className="bg-[linear-gradient(135deg,#04275B_0%,#014CA9_78%,#0A63C6_100%)] py-16 text-white text-center blueprint">
        <div className="mx-auto w-full max-w-content px-4 sm:px-6 lg:px-8">
          <h2 className="text-h2 font-bold tracking-tight text-white max-w-2xl mx-auto">
            Ready for your next journey?
          </h2>
          <p className="mt-3 text-lead text-on-dark-soft max-w-xl mx-auto">
            Book now with instantaneous confirmation, seat maps, and honest timings.
          </p>
          <div className="mt-8">
            <Button size="lg" variant="primaryInverted" onClick={() => navigate('/search')} className="px-8 shadow-raised">
              Search Trains Now
              <ArrowRight className="size-4"/>
            </Button>
          </div>
        </div>
      </section>
    </div>);
}
