import React, { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { adminService } from '@/services/adminService';
import { RefreshCw } from 'lucide-react';

const STATUS_BADGE = {
    created: 'outline',
    captured: 'success',
    failed: 'error',
    refunded: 'warning',
};

/**
 * Paise -> rupees.
 *
 * Everything in the database is in paise. Rendering the raw integer would show
 * a captured ₹2,446.70 payment as "244670", which reads as a lakh.
 */
const rupees = (paise) => (paise == null ? null : (Number(paise) / 100).toFixed(2));

const formatDateTime = (value) => {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime())
        ? null
        : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/**
 * Real transactions from `GET /admin/payments`.
 *
 * This rendered "Integration Pending — Payment data unavailable" over a live
 * `payments` table that the Razorpay flow writes to. There was never a reason
 * for it to be empty; the endpoint itself was a stub returning `data: []`.
 */
export default function PaymentsManagement() {
    const [rows, setRows] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize] = useState(20);
    const [status, setStatus] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params = { page, pageSize };
            if (status) params.status = status;
            const res = await adminService.getPayments(params);
            setRows(res?.data ?? []);
            setTotal(res?.total ?? 0);
        } catch (err) {
            setRows([]);
            setError(err?.message ?? 'Failed to load payments.');
        } finally {
            setLoading(false);
        }
    }, [page, pageSize, status]);

    useEffect(() => {
        load().catch(() => {});
    }, [load]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-h2 font-bold tracking-tight text-ink">Payments</h1>
                <p className="text-body text-ink-soft">Transaction history and gateway verification.</p>
            </div>

            <Card className="p-4 flex flex-wrap items-end gap-3">
                <div className="w-44">
                    <label className="block text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft mb-1">
                        Status
                    </label>
                    <select
                        value={status}
                        onChange={(e) => { setStatus(e.target.value); setPage(1); }}
                        className="h-11 w-full rounded-control border border-line-strong bg-white px-3 text-sm text-ink"
                    >
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
                        title="Could not load payments"
                        description={error}
                        action={<Button onClick={load}>Try again</Button>}
                    />
                ) : rows.length === 0 ? (
                    <EmptyState
                        title="No payments found"
                        description={status ? `No ${status} payments.` : 'No payments have been taken yet.'}
                        action={<Button variant="secondary" onClick={() => setStatus('')}>Clear filter</Button>}
                    />
                ) : (
                    <>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b border-line bg-surface-sunken text-eyebrow text-ink-soft font-semibold uppercase tracking-[0.16em]">
                                        <th className="py-3 px-4">Order</th>
                                        <th className="py-3 px-4">Booking</th>
                                        <th className="py-3 px-4">Method</th>
                                        <th className="py-3 px-4">Amount</th>
                                        <th className="py-3 px-4">Refunded</th>
                                        <th className="py-3 px-4">Created</th>
                                        <th className="py-3 px-4">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-line text-sm">
                                    {rows.map(p => (
                                        <tr key={p.payment_id ?? p.gateway_order_id} className="hover:bg-surface-sunken/50">
                                            <td className="py-3 px-4 num font-mono text-xs text-ink">{p.gateway_order_id ?? '—'}</td>
                                            <td className="py-3 px-4 num font-semibold text-ink">{p.booking_ref ?? '—'}</td>
                                            <td className="py-3 px-4 text-ink-soft">{p.method_code ?? '—'}</td>
                                            <td className="py-3 px-4 num font-semibold text-royal">
                                                {rupees(p.amount) != null ? `₹${rupees(p.amount)}` : '—'}
                                            </td>
                                            <td className="py-3 px-4 num text-ink-soft">
                                                {rupees(p.refunded_amount) != null && Number(p.refunded_amount) > 0
                                                    ? `₹${rupees(p.refunded_amount)}`
                                                    : '—'}
                                            </td>
                                            <td className="py-3 px-4 text-caption text-ink-soft">{formatDateTime(p.created_at) ?? '—'}</td>
                                            <td className="py-3 px-4">
                                                <Badge variant={STATUS_BADGE[p.status] ?? 'outline'}>{p.status}</Badge>
                                                {p.failure_code && (
                                                    <div className="text-caption text-error-strong mt-0.5">{p.failure_code}</div>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-line">
                            <span className="text-caption text-ink-soft">
                                Page {page} of {totalPages} · {total} payment{total === 1 ? '' : 's'}
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
