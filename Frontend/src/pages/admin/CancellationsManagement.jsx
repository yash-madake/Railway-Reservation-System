import React, { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { adminService } from '@/services/adminService';
import { RefreshCw } from 'lucide-react';

const STATUS_BADGE = {
    CANCELLED: 'error',
    EXPIRED: 'outline',
};

const rupees = (paise) => (paise == null ? null : (Number(paise) / 100).toFixed(2));

const formatDateTime = (value) => {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime())
        ? null
        : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/**
 * Withdrawn and lapsed bookings from `GET /admin/cancellations`.
 *
 * There is no cancellations table — a cancellation is a `bookings` row in a
 * terminal state — so this used to be an endpoint returning `data: []` behind an
 * "Integration Pending" card.
 */
export default function CancellationsManagement() {
    const [rows, setRows] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize] = useState(20);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await adminService.getCancellations({ page, pageSize });
            setRows(res?.data ?? []);
            setTotal(res?.total ?? 0);
        } catch (err) {
            setRows([]);
            setError(err?.message ?? 'Failed to load cancellations.');
        } finally {
            setLoading(false);
        }
    }, [page, pageSize]);

    useEffect(() => {
        load().catch(() => {});
    }, [load]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-h2 font-bold tracking-tight text-ink">Cancellations</h1>
                <p className="text-body text-ink-soft">Refund processing and booking reversions.</p>
            </div>

            <Card className="p-4 flex justify-end">
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
                        title="Could not load cancellations"
                        description={error}
                        action={<Button onClick={load}>Try again</Button>}
                    />
                ) : rows.length === 0 ? (
                    <EmptyState
                        title="No cancellations"
                        description="Nothing has been cancelled or has lapsed. That is the good outcome."
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
                                        <th className="py-3 px-4">Reason</th>
                                        <th className="py-3 px-4">When</th>
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
                                            <td className="py-3 px-4 text-caption text-ink-soft">
                                                {b.cancellation_reason ?? '—'}
                                            </td>
                                            <td className="py-3 px-4 text-caption text-ink-soft">
                                                {formatDateTime(b.cancelled_at ?? b.created_at) ?? '—'}
                                            </td>
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
                                Page {page} of {totalPages} · {total} cancellation{total === 1 ? '' : 's'}
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
