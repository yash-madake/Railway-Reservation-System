import React, { useEffect, useState } from 'react';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatTile } from '@/components/ui/StatTile';
import { Alert } from '@/components/ui/Alert';
import { Skeleton } from '@/components/ui/Skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { adminService } from '@/services/adminService';
import { fare } from '@/lib/format';
import { ShieldAlert } from 'lucide-react';

const BRAND_COLORS = ['#014CA9', '#0080F8', '#28C840', '#FEBC2E', '#E02020'];

export default function Dashboard() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchDashboard = async () => {
            try {
                setLoading(true);
                const response = await adminService.getDashboard({});
                setData(response.data);
                setError(null);
            } catch (err) {
                setError(err.message || 'Failed to load dashboard data.');
            } finally {
                setLoading(false);
            }
        };

        fetchDashboard();
    }, []);

    if (loading) {
        return (
            <div className="space-y-6 animate-pulse">
                <div>
                    <h1 className="text-h2 font-bold text-ink">Operations overview</h1>
                    <p className="text-body text-ink-soft">Railway reservation activity across the Yatrio platform.</p>
                </div>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 rounded-card" />)}
                </div>
                <Skeleton className="h-96 rounded-card" />
            </div>
        );
    }

    if (error) {
        return (
            <Alert variant="error" icon={<ShieldAlert aria-hidden="true" />}>
                {error}
            </Alert>
        );
    }

    if (!data) return null;

    const { kpis, popularRoutes, trainOccupancy, systemHealth } = data;

    // Formatting for charts (using occupancy as a proxy for trend lines currently)
    const occupancyChartData = trainOccupancy.map(t => ({
        name: t.train_number,
        Occupancy: parseFloat(t.occupancy_percentage) || 0
    })).slice(0, 10);

    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-h2 font-bold tracking-tight text-ink">Operations overview</h1>
                <p className="text-body text-ink-soft">Railway reservation activity across the Yatrio platform.</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {/* `trend` is not a StatTile prop — it takes `delta`, so
                    "+Demo reporting" was never rendered at all. The KPI is
                    derived from seat-availability snapshots rather than captured
                    payments (see adminController.getDashboard), so the label says
                    so rather than implying settled revenue. */}
                <StatTile
                    label="Revenue (estimated)"
                    value={fare(kpis.estimatedRevenue * 100)}
                    delta="From availability"
                />
                <StatTile 
                    label="Active Users" 
                    value={kpis.activeUsers} 
                />
                <StatTile
                    label="Occupancy Snapshot"
                    value={kpis.totalBookedSeats}
                    delta="Seats booked"
                />
                <StatTile 
                    label="System Health" 
                    value={systemHealth.status} 
                />
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Top Train Occupancy</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="h-80 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={occupancyChartData}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 12}} />
                                    <YAxis axisLine={false} tickLine={false} tick={{fontSize: 12}} />
                                    <Tooltip cursor={{fill: '#F7F9FC'}} />
                                    <Bar dataKey="Occupancy" fill="#014CA9" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Popular Routes</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {popularRoutes && popularRoutes.length > 0 ? (
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Train</TableHead>
                                            <TableHead>Origin</TableHead>
                                            <TableHead>Destination</TableHead>
                                            <TableHead className="text-right">Bookings</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {popularRoutes.slice(0, 5).map((route, i) => (
                                            <TableRow key={i}>
                                                <TableCell className="font-medium text-ink">{route.train_number}</TableCell>
                                                <TableCell>{route.origin}</TableCell>
                                                <TableCell>{route.destination}</TableCell>
                                                <TableCell className="text-right num font-semibold">{route.booked_count}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        ) : (
                            <div className="flex h-full items-center justify-center p-6 text-ink-soft">
                                No route data available.
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
            
            <div className="flex gap-3 rounded-card border border-azure/25 bg-blue-100 p-4">
                <span className="mt-0.5 size-5 shrink-0 text-royal text-lg font-bold" aria-hidden="true">i</span>
                <p className="text-caption text-body">
                    <b className="font-semibold text-royal">Demo project.</b> Revenue and booking metrics are derived from seat availability snapshots until Team 4 and Team 5 schemas are fully integrated. No real IRCTC bookings are made.
                </p>
            </div>
        </div>
    );
}
