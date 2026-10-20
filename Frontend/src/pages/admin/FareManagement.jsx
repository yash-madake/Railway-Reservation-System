import React, { useCallback, useEffect, useState } from 'react';
import { Calculator } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { bookingService } from '@/services/bookingService';
import { API_BASE_URL } from '@/api/client';

/**
 * The real price list, and a calculator that uses it.
 *
 * This page held four invented fare rules (Rajdhani 1A at ₹1,500, Superfast SL
 * at ₹200) that matched nothing in the database, plus a calculator hardcoded to
 * `800 + (dist * 1.2)` with ₹40 reservation and ₹45 superfast regardless of what
 * the admin had selected in the train and class dropdowns — so it confidently
 * priced every journey as a 3A Rajdhani while appearing to respond to the inputs.
 *
 * The real prices live in `train_classes.base_fare` and are per train and class,
 * not per train *type*. This reads them through `GET /trains/:no`, and the
 * calculator now derives its figure from the selected train's own rate per km —
 * the same pro-rating the server applies — instead of a literal.
 */
const FareManagement = () => {
    const [trains, setTrains] = useState([]);
    const [rules, setRules] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const [calcTrain, setCalcTrain] = useState('');
    const [calcClass, setCalcClass] = useState('');
    const [calcDistance, setCalcDistance] = useState('');
    const [calcResult, setCalcResult] = useState(null);

    /**
     * Every train's classes, flattened into one price list.
     *
     * `base_fare` is stored for the *whole* route, so the per-km rate has to be
     * derived against the train's own total distance — the same arithmetic the
     * server does at read time.
     */
    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const listRes = await fetch(`${API_BASE_URL}/trains/search?limit=100`);
            if (!listRes.ok) throw new Error(`trains ${listRes.status}`);
            const list = (await listRes.json())?.data ?? [];

            const details = await Promise.all(
                list.map((t) =>
                    bookingService
                        .getTrainDetails(t.number)
                        .then((res) => res?.data ?? res)
                        .catch(() => null),
                ),
            );

            const flat = [];
            details.filter(Boolean).forEach((train) => {
                const routeKm = Number(train.totalDistanceKm) || 0;
                (train.classes ?? []).forEach((c) => {
                    const base = Number(c.fare);
                    flat.push({
                        key: `${train.trainNumber}-${c.type}`,
                        trainNumber: train.trainNumber,
                        trainName: train.trainName,
                        trainType: train.trainType,
                        class: c.type,
                        className: c.name,
                        baseFare: base,
                        routeKm,
                        ratePerKm: routeKm > 0 ? base / routeKm : null,
                        availableSeats: c.availableSeats,
                        totalSeats: c.totalSeats,
                    });
                });
            });

            setTrains(list);
            setRules(flat);
        } catch (err) {
            setRules([]);
            setError(err?.message ?? 'Could not load the price list.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load().catch(() => {});
    }, [load]);

    const selectedTrain = trains.find((t) => t.number === calcTrain) ?? null;
    const selectedRule = rules.find((r) => r.trainNumber === calcTrain && r.class === calcClass) ?? null;

    /**
     * Pro-rate the selected train's whole-route fare over the entered distance.
     *
     * The old version ignored `calcTrain` and `calcClass` entirely and returned
     * `800 + dist * 1.2` with fixed charges. Now, a distance that the selected
     * train cannot cover is refused rather than priced.
     */
    const handleCalculate = () => {
        const dist = Number(calcDistance);
        if (!selectedTrain || !selectedRule || !Number.isFinite(dist) || dist <= 0) {
            setCalcResult(null);
            return;
        }
        if (selectedRule.routeKm > 0 && dist > selectedRule.routeKm) {
            setCalcResult({ error: `That is longer than the ${selectedRule.routeKm} km this train covers.` });
            return;
        }

        const base = selectedRule.ratePerKm == null ? 0 : Math.round(dist * selectedRule.ratePerKm);
        // 18% tax and a flat per-booking convenience fee are the server's rules,
        // not per-passenger surcharges. See services/payment/fareService.js.
        const taxes = Math.round(base * 0.18);
        const convenienceFee = 1000;
        setCalcResult({ base, taxes, convenienceFee, total: base + taxes + convenienceFee, passengers: 1 });
    };

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h1 className="text-2xl font-bold text-foreground">Fare Management</h1>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Price List</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="border rounded-md overflow-x-auto">
                                {loading ? (
                                    <div className="p-6 space-y-3">
                                        {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-10 w-full" />)}
                                    </div>
                                ) : error ? (
                                    <EmptyState
                                        title="Could not load the price list"
                                        description={error}
                                        action={<Button onClick={load}>Try again</Button>}
                                    />
                                ) : rules.length === 0 ? (
                                    <EmptyState title="No fares configured" description="No train has a class price." />
                                ) : (
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Train</TableHead>
                                                <TableHead>Class</TableHead>
                                                <TableHead>Base(₹)</TableHead>
                                                <TableHead>Rate(₹/km)</TableHead>
                                                <TableHead>Route(km)</TableHead>
                                                <TableHead>Available</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {rules.map(r => (<TableRow key={r.key}>
                                                <TableCell>
                                                    <div className="font-semibold">{r.trainNumber}</div>
                                                    <div className="text-xs text-muted">{r.trainType}</div>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge>{r.class}</Badge>
                                                </TableCell>
                                                <TableCell className="num font-semibold">{r.baseFare.toLocaleString('en-IN')}</TableCell>
                                                <TableCell className="num">
                                                    {r.ratePerKm == null ? '—' : r.ratePerKm.toFixed(2)}
                                                </TableCell>
                                                <TableCell className="num">{r.routeKm}</TableCell>
                                                <TableCell className="num">{r.availableSeats ?? '—'}</TableCell>
                                              </TableRow>))}
                                        </TableBody>
                                    </Table>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    <p className="text-caption text-muted">
                        This view is read-only. The admin API exposes GET endpoints only, so fares are
                        seeded into <code className="num">train_classes.base_fare</code> rather than edited here.
                        Fares are stored for the whole route and pro-rated by distance at read time.
                    </p>
                </div>

                {/* Calculator */}
                <Card className="h-fit">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Calculator className="h-4 w-4"/> Fare Calculator
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Train</label>
                            <Select value={calcTrain} onChange={(e) => { setCalcTrain(e.target.value); setCalcClass(''); setCalcResult(null); }}>
                                <option value="">Select a train</option>
                                {trains.map(t => (
                                    <option key={t.id ?? t.number} value={t.number}>
                                        {t.number} — {t.name}
                                    </option>
                                ))}
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Class</label>
                            <Select
                                value={calcClass}
                                onChange={(e) => { setCalcClass(e.target.value); setCalcResult(null); }}
                                disabled={!calcTrain}
                            >
                                <option value="">Select a class</option>
                                {rules.filter(r => r.trainNumber === calcTrain).map(r => (
                                    <option key={r.key} value={r.class}>
                                        {r.class} — {r.className}
                                    </option>
                                ))}
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Distance (km)</label>
                            <Input
                                type="number"
                                min="1"
                                placeholder="e.g. 410"
                                value={calcDistance}
                                onChange={(e) => { setCalcDistance(e.target.value); setCalcResult(null); }}
                            />
                        </div>

                        <Button
                            className="w-full"
                            onClick={handleCalculate}
                            disabled={!calcTrain || !calcClass || !calcDistance}
                        >
                            Calculate
                        </Button>

                        {calcResult?.error && (
                            <p className="text-sm font-semibold text-error-strong">{calcResult.error}</p>
                        )}

                        {calcResult && !calcResult.error && (
                            <div className="rounded-lg bg-fog/40 border border-line p-4 space-y-1.5 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-muted">Base fare</span>
                                    <span className="num font-semibold">₹{(calcResult.base / 100).toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted">Taxes (18%)</span>
                                    <span className="num font-semibold">₹{(calcResult.taxes / 100).toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted">Convenience fee</span>
                                    <span className="num font-semibold">₹{(calcResult.convenienceFee / 100).toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between border-t border-line pt-1.5 mt-1.5">
                                    <span className="font-semibold">Total</span>
                                    <span className="num font-bold text-primary">₹{(calcResult.total / 100).toFixed(2)}</span>
                                </div>
                                <p className="text-xs text-muted pt-1">One passenger. Fees are per booking, not per head.</p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};
export default FareManagement;
