import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Clock, Users, Ticket } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { bookingService } from '@/services/bookingService';

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/**
 * Elapsed running time, from the timetable.
 *
 * Crosses midnight. The previous version printed a literal "16h 05m" outside the
 * train object entirely, so it was wrong for every train except by coincidence.
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
    const end = toMinutes(last.arrivalTime ?? last.departureTime);
    if (start === null || end === null) return null;

    let mins = end - start + (Number(last.day ?? 1) - Number(first.day ?? 1)) * 24 * 60;
    if (mins < 0) mins += 24 * 60;
    return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

/**
 * Admin view of one train, from `GET /trains/:trainNo`.
 *
 * This read `:id` from the route and ignored it, rendering a literal 12951
 * "Rajdhani Express" with hand-written coach counts (48 + 260 + 792, which summed
 * to the "1,100 Seats" tile beside it) plus a hardcoded "92% occupancy" and
 * "85% on time". Neither percentage is measured anywhere, so both tiles are gone
 * rather than replaced by invented figures.
 *
 * Edit and Delete are removed: `adminRoutes` is entirely GET, so those controls
 * could only ever look functional.
 */
const TrainDetail = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const [train, setTrain] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let isMounted = true;
        setLoading(true);
        setError(null);

        bookingService
            .getTrainDetails(id)
            .then((res) => {
                if (!isMounted) return;
                const payload = res?.data ?? res;
                if (!payload?.trainNumber) throw new Error(`No train matching "${id}".`);
                setTrain(payload);
            })
            .catch((err) => {
                if (!isMounted) return;
                setError(err?.message ?? 'The train could not be loaded.');
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
            <div className="p-6 max-w-6xl mx-auto space-y-6">
                <Skeleton className="h-10 w-1/3" />
                <Skeleton className="h-64 w-full" />
            </div>
        );
    }

    if (error || !train) {
        return (
            <div className="p-6 max-w-6xl mx-auto space-y-6">
                <Button variant="ghost" size="icon" onClick={() => navigate('/admin/trains')}>
                    <ArrowLeft className="h-5 w-5"/>
                </Button>
                <EmptyState
                    title="Train not found"
                    description={error ?? `No train matching "${id}" is in the database.`}
                    action={<Button onClick={() => navigate('/admin/trains')}>Back to trains</Button>}
                />
            </div>
        );
    }

    const stops = train.stops ?? [];
    const classes = train.classes ?? [];
    const duration = durationOf(stops);
    const runningDays = train.runningDays ?? [];
    // Capacity is the sum of what the price list records, not a separate figure.
    const capacity = classes.reduce((sum, c) => sum + (Number(c.totalSeats) || 0), 0);
    const available = classes.reduce((sum, c) => sum + (Number(c.availableSeats) || 0), 0);

    return (
        <div className="p-6 max-w-6xl mx-auto space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate('/admin/trains')}>
                        <ArrowLeft className="h-5 w-5"/>
                    </Button>
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-3">
                            {train.trainNumber} - {train.trainName}
                            <Badge variant={train.status === 'active' ? 'success' : 'secondary'}>{train.status}</Badge>
                        </h1>
                        <p className="text-muted">{train.trainType}</p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Route Info */}
                <Card className="md:col-span-2">
                    <CardHeader>
                        <CardTitle>Route &amp; Schedule</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="flex flex-col sm:flex-row justify-between items-center p-4 bg-gray-50 rounded-lg">
                            <div className="text-center sm:text-left">
                                <p className="text-sm text-muted">Source</p>
                                <p className="font-semibold text-lg">{train.source?.name} ({train.source?.code})</p>
                                <p className="text-xl font-bold text-primary">{train.source?.departureTime ?? '—'}</p>
                            </div>
                            <div className="flex-1 flex flex-col items-center px-4 my-4 sm:my-0">
                                <p className="text-xs text-muted mb-1">{train.totalDistanceKm ?? '—'} km</p>
                                <div className="w-full h-[2px] bg-border relative">
                                    <div className="absolute top-1/2 left-0 -translate-y-1/2 w-2 h-2 rounded-full bg-primary"></div>
                                    <div className="absolute top-1/2 right-0 -translate-y-1/2 w-2 h-2 rounded-full bg-primary"></div>
                                </div>
                                <p className="text-xs text-muted mt-1">{duration ?? '—'}</p>
                            </div>
                            <div className="text-center sm:text-right">
                                <p className="text-sm text-muted">Destination</p>
                                <p className="font-semibold text-lg">{train.destination?.name} ({train.destination?.code})</p>
                                <p className="text-xl font-bold text-primary">{train.destination?.arrivalTime ?? '—'}</p>
                            </div>
                        </div>

                        <div>
                            <h4 className="text-sm font-medium mb-2">Running Days</h4>
                            <div className="flex flex-wrap gap-2">
                                {DAYS.map(day => {
                                    const runs = runningDays.includes(day);
                                    return (
                                        <Badge
                                            key={day}
                                            variant={runs ? 'default' : 'secondary'}
                                            className={runs ? 'bg-primary' : 'bg-gray-100 text-gray-400'}
                                        >
                                            {day.slice(0, 2)}
                                        </Badge>
                                    );
                                })}
                            </div>
                        </div>

                        {stops.length > 0 && (
                            <div>
                                <h4 className="text-sm font-medium mb-2">Stops ({stops.length})</h4>
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>#</TableHead>
                                                <TableHead>Station</TableHead>
                                                <TableHead>Arr</TableHead>
                                                <TableHead>Dep</TableHead>
                                                <TableHead>Platform</TableHead>
                                                <TableHead className="text-right">Distance</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {stops.map(s => (
                                                <TableRow key={s.station?.code ?? s.sequence}>
                                                    <TableCell className="num">{s.sequence}</TableCell>
                                                    <TableCell>
                                                        {s.station?.name} <span className="text-muted">({s.station?.code})</span>
                                                    </TableCell>
                                                    <TableCell className="num">{s.arrivalTime ?? '—'}</TableCell>
                                                    <TableCell className="num">{s.departureTime ?? '—'}</TableCell>
                                                    <TableCell>{s.platform ?? '—'}</TableCell>
                                                    <TableCell className="text-right num">{s.distanceKm} km</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Stats — only what is counted. */}
                <Card>
                    <CardHeader>
                        <CardTitle>Quick Stats</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-blue-50 text-blue-600 rounded-full">
                                <Users className="h-5 w-5"/>
                            </div>
                            <div>
                                <p className="text-sm text-muted">Total Capacity</p>
                                <p className="font-bold">{capacity > 0 ? `${capacity.toLocaleString('en-IN')} seats` : '—'}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-green-50 text-green-600 rounded-full">
                                <Ticket className="h-5 w-5"/>
                            </div>
                            <div>
                                <p className="text-sm text-muted">Seats Available</p>
                                <p className="font-bold">{available > 0 ? available.toLocaleString('en-IN') : '—'}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-amber-50 text-amber-600 rounded-full">
                                <Clock className="h-5 w-5"/>
                            </div>
                            <div>
                                <p className="text-sm text-muted">Pantry</p>
                                <p className="font-bold">{train.pantryAvailable ? 'Available' : 'Not available'}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Composition */}
            <Card>
                <CardHeader>
                    <CardTitle>Class Composition</CardTitle>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Class</TableHead>
                                <TableHead>Class Name</TableHead>
                                <TableHead>Base Fare</TableHead>
                                <TableHead>Available</TableHead>
                                <TableHead className="text-right">Total Seats</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {classes.map(cls => (<TableRow key={cls.type}>
                                <TableCell className="font-bold">{cls.type}</TableCell>
                                <TableCell>{cls.name}</TableCell>
                                <TableCell className="num">{cls.fare != null ? `₹${cls.fare}` : '—'}</TableCell>
                                <TableCell className="num">{cls.availableSeats ?? '—'}</TableCell>
                                <TableCell className="text-right num">{cls.totalSeats ?? '—'}</TableCell>
                              </TableRow>))}
                            {classes.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-muted">
                                        No classes are configured for this train.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
};
export default TrainDetail;
