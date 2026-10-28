import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { bookingService } from '@/services/bookingService';
import { API_BASE_URL } from '@/api/client';

/**
 * Real timetables, from `GET /trains/:no`.
 *
 * This displayed five invented rows all belonging to train 12951 — NDLS, KOTA,
 * BRC, ST, MMCT with made-up times — and offered exactly one train in its
 * dropdown, so the page could only ever describe a timetable that was not in the
 * database. It made no request at all.
 *
 * Stops live in `train_routes`, which is what `GET /trains/:no` returns, so this
 * reads them from there. The train list is populated from `/trains/search`, so a
 * train added to the database appears here without a code change.
 */
const ScheduleManagement = () => {
    const [trains, setTrains] = useState([]);
    const [selected, setSelected] = useState('');
    const [train, setTrain] = useState(null);
    const [loadingList, setLoadingList] = useState(true);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        let isMounted = true;
        fetch(`${API_BASE_URL}/trains/search?limit=100`)
            .then((res) => {
                if (!res.ok) throw new Error(`trains ${res.status}`);
                return res.json();
            })
            .then((body) => {
                if (isMounted) {
                    const list = body?.data ?? [];
                    setTrains(list);
                    // Open on a real train so the page is never blank-but-loading.
                    if (list.length > 0) setSelected(list[0].number);
                }
            })
            .catch((err) => {
                if (isMounted) setError(err?.message ?? 'Could not load the train list.');
            })
            .finally(() => {
                if (isMounted) setLoadingList(false);
            });
        return () => {
            isMounted = false;
        };
    }, []);

    const loadSchedule = useCallback(async () => {
        if (!selected) return;
        setLoading(true);
        setError(null);
        setTrain(null);
        try {
            const res = await bookingService.getTrainDetails(selected);
            setTrain(res?.data ?? res);
        } catch (err) {
            setError(err?.message ?? `No schedule found for ${selected}.`);
        } finally {
            setLoading(false);
        }
    }, [selected]);

    useEffect(() => {
        loadSchedule().catch(() => {});
    }, [loadSchedule]);

    const stops = train?.stops ?? [];

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h1 className="text-2xl font-bold text-foreground">Schedule Management</h1>
                <div className="w-64">
                    <Select value={selected} onChange={(e) => setSelected(e.target.value)} disabled={loadingList}>
                        <option value="">Select a train</option>
                        {trains.map(t => (
                            <option key={t.id ?? t.number} value={t.number}>
                                {t.number} — {t.name}
                            </option>
                        ))}
                    </Select>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>
                        {train ? `${train.trainNumber} — ${train.trainName}` : 'Schedule'}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="border rounded-md overflow-x-auto">
                        {loadingList || loading ? (
                            <div className="p-6 space-y-3">
                                {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-10 w-full" />)}
                            </div>
                        ) : error ? (
                            <EmptyState
                                title="Could not load the schedule"
                                description={error}
                                action={<Button onClick={loadSchedule}>Try again</Button>}
                            />
                        ) : stops.length === 0 ? (
                            <EmptyState title="No stops recorded" description="This train has no route in the database." />
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>#</TableHead>
                                        <TableHead>Station</TableHead>
                                        <TableHead>Arr</TableHead>
                                        <TableHead>Dep</TableHead>
                                        <TableHead>Day</TableHead>
                                        <TableHead>Halt</TableHead>
                                        <TableHead>Platform</TableHead>
                                        <TableHead className="text-right">Distance</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {stops.map(s => (
                                        <TableRow key={s.station?.code ?? s.sequence}>
                                            <TableCell className="num">{s.sequence}</TableCell>
                                            <TableCell>
                                                <div className="font-semibold">{s.station?.name}</div>
                                                <div className="text-xs text-muted">{s.station?.code}</div>
                                            </TableCell>
                                            <TableCell className="num">
                                                {s.arrivalTime ?? (s.sequence === 1 ? 'Source' : '—')}
                                            </TableCell>
                                            <TableCell className="num">
                                                {s.departureTime ?? (s.sequence === stops.length ? 'Destination' : '—')}
                                            </TableCell>
                                            <TableCell className="num">{s.day}</TableCell>
                                            <TableCell className="num">{s.haltMinutes ? `${s.haltMinutes}m` : '—'}</TableCell>
                                            <TableCell>{s.platform ?? '—'}</TableCell>
                                            <TableCell className="text-right num">{s.distanceKm} km</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </div>

                    {train && !loading && (
                        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-muted">
                            <Badge>{train.trainType}</Badge>
                            <span>{train.totalDistanceKm} km</span>
                            <span>{(train.runningDays ?? []).join(' · ')}</span>
                            <span>Pantry: {train.pantryAvailable ? 'yes' : 'no'}</span>
                        </div>
                    )}
                </CardContent>
            </Card>

            <p className="text-caption text-muted">
                This view is read-only. The admin API exposes GET endpoints only, so timetables are
                seeded into <code className="num">train_routes</code> rather than edited here.
            </p>
        </div>
    );
};
export default ScheduleManagement;
