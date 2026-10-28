import React, { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { adminService } from '@/services/adminService';
import { Search, RefreshCw } from 'lucide-react';

const STATUS_BADGE = {
    HELD: 'outline',
    CONFIRMED: 'success',
    CANCELLED: 'error',
    EXPIRED: 'error',
};

const rupees = (paise) => (paise == null ? null : (Number(paise) / 100).toFixed(2));

const formatDateTime = (value) => {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime())
        ? null
        : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export default function BookingManagement() {
    const [rows, setRows] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize] = useState(20);
    const [status, setStatus] = useState('');
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params = { page, pageSize };
            if (status) params.status = status;
            if (query.trim()) params.q = query.trim();
            const res = await adminService.getBookings(params);
            setRows(res?.data ?? []);
            setTotal(res?.total ?? 0);
        } catch (err) {
            setRows([]);
            setError(err?.message ?? 'Failed to load bookings.');
        } finally {
            setLoading(false);
        }
    }, [page, pageSize, status, query]);

    useEffect(() => {
        load().catch(() => {});
    }, [load]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-h2 font-bold tracking-tight text-ink">Bookings</h1>
                <p className="text-body text-ink-soft">Passenger reservations and PNR lifecycles.</p>
            </div>

            <Card className="p-4 flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-[200px]">
                    <label className="block text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft mb-1">
                        Search
                    </label>
                    <div className="relative">
                        <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
                        <input
                            value={query}
                            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
                            placeholder="Reference, train number or email"
                            className="h-11 w-full rounded-control border border-line-strong bg-white pl-9 pr-3 text-sm text-ink"
                        />
                    </div>
                </div>
                <div className="w-40">
                    <label className="block text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft mb-1">
                        Status
                    </label>
                    <select
                        value={status}
                        onChange={(e) => { setStatus(e.target.value); setPage(1); }}
                        className="h-11 w-full rounded-control border border-line-strong bg-white px-3 text-sm text-ink"
                    >
                        {/* Derived from the booking enum, so a new status cannot
                            go missing from the filter. */}
                        <option value="">All</option>
                        {Object.keys(STATUS_BADGE).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                </div>
                <Button variant="outline" onClick={load} disabled={loading} className="gap-1.5">
                    <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
                </Button>
            </Card>

            <Card className="p-0 overflow-hidden">
                {loading ? (
                    <div className="p-6 space-y-4">
                        {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full rounded-control" />)}
                    </div>
                ) : error ? (
                    <EmptyState
                        title="Could not load bookings"
                        description={error}
                        action={<Button onClick={load}>Try again</Button>}
                    />
                ) : rows.length === 0 ? (
                    <EmptyState
                        title="No bookings found"
                        description={total === 0 ? 'No bookings have been created yet.' : 'No bookings match these filters.'}
                        action={<Button variant="secondary" onClick={() => { setStatus(''); setQuery(''); setPage(1); }}>Clear filters</Button>}
                    />
                ) : (
                    <>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b border-line bg-surface-sunken text-eyebrow text-ink-soft font-semibold uppercase tracking-[0.16em]">
                                        <th className="py-3 px-4">Reference</th>
                                        <th className="py-3 px-4">Train</th>
                                        <th className="py-3 px-4">Route</th>
                                        <th className="py-3 px-4">Pax</th>
                                        <th className="py-3 px-4">Fare</th>
                                        <th className="py-3 px-4">Booked</th>
                                        <th className="py-3 px-4">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-line text-sm">
                                    {rows.map(b => (
                                        <tr key={b.booking_id ?? b.booking_ref} className="hover:bg-surface-sunken/50">
                                            <td className="py-3 px-4 num font-mono font-bold text-ink">{b.booking_ref}</td>
                                            <td className="py-3 px-4">
                                                <div className="font-semibold text-ink">{b.train_no}</div>
                                                <div className="text-caption text-ink-soft">{b.train_name} · {b.travel_class}</div>
                                            </td>
                                            <td className="py-3 px-4 text-ink-soft">
                                                {b.origin_code} → {b.destination_code}
                                            </td>
                                            <td className="py-3 px-4 num text-ink">{b.passenger_count}</td>
                                            <td className="py-3 px-4 num font-semibold text-royal">
                                                {rupees(b.total_amount) != null ? `₹${rupees(b.total_amount)}` : '—'}
                                            </td>
                                            <td className="py-3 px-4 text-caption text-ink-soft">{formatDateTime(b.created_at) ?? '—'}</td>
                                            <td className="py-3 px-4">
                                                <Badge variant={STATUS_BADGE[b.status] ?? 'outline'}>{b.status}</Badge>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-line">
                            <span className="text-caption text-ink-soft">
                                Page {page} of {totalPages} · {total} booking{total === 1 ? '' : 's'}
                            </span>
                            <div className="flex gap-2">
                                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                                    Previous
                                </Button>
                                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                                    Next
                                </Button>
                            </div>
                        </div>
                    </>
                )}
            </Card>
        </div>
    );
}
