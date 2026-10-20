import React, { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { Pagination } from '@/components/ui/Pagination';
import { API_BASE_URL } from '@/api/client';

/**
 * Stations, read from `GET /stations`.
 *
 * This held five invented stations behind a search box that was never wired to
 * the array it filtered, a "All States" dropdown offering two of India's ~36
 * states, and Add/Edit/Delete controls with no handlers. Worse, it rendered
 * `totalPages={3}` over a five-row array, so the pager implied nine stations
 * existed.
 *
 * Writes are still impossible — `adminRoutes` is entirely GET, so there is no
 * endpoint to POST a new station to. Rather than keep a "Save Station" button
 * that discards its input and closes the modal as though it had worked, the
 * read-only table is all this page offers.
 */
const StationManagement = () => {
    const [rows, setRows] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize] = useState(20);
    const [searchTerm, setSearchTerm] = useState('');
    const [stateFilter, setStateFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    /**
     * Distinct states, derived from the rows already loaded.
     *
     * Was a two-option list of Delhi and Maharashtra, so selecting anything else
     * silently returned nothing — and the filter was not even applied to the
     * mock array. Built from real data instead, it cannot fall behind the table.
     */
    const states = [...new Set(rows.map((r) => r.state).filter(Boolean))].sort();

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            // Filtered client-side: the endpoint takes a single `search` term and
            // this page needs state/status on top of it, which would otherwise
            // mean adding server params for a 22-row table.
            const res = await fetch(`${API_BASE_URL}/stations?page=1&limit=200`);
            if (!res.ok) throw new Error(`stations ${res.status}`);
            const body = await res.json();
            const data = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];

            const term = searchTerm.trim().toLowerCase();
            const filtered = data.filter((st) => {
                if (term) {
                    const haystack = `${st.code} ${st.name} ${st.city ?? ''} ${st.state ?? ''}`.toLowerCase();
                    if (!haystack.includes(term)) return false;
                }
                if (stateFilter && st.state !== stateFilter) return false;
                if (statusFilter && st.status !== statusFilter) return false;
                return true;
            });

            setRows(filtered);
            setTotal(filtered.length);
            setPage(1);
        } catch (err) {
            setRows([]);
            setError(err?.message ?? 'Could not load stations.');
        } finally {
            setLoading(false);
        }
    }, [searchTerm, stateFilter, statusFilter]);

    useEffect(() => {
        load().catch(() => {});
    }, [load]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h1 className="text-2xl font-bold text-foreground">Station Management</h1>
            </div>

            <Card>
                <CardContent className="p-4 sm:p-6 space-y-4">
                    <div className="flex flex-col sm:flex-row gap-4">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted"/>
                            <Input
                                placeholder="Search by Code, Name or City..."
                                className="pl-9"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <div className="flex gap-4">
                            <Select
                                className="w-[180px]"
                                value={stateFilter}
                                onChange={(e) => setStateFilter(e.target.value)}
                            >
                                <option value="">All States</option>
                                {states.map(s => <option key={s} value={s}>{s}</option>)}
                            </Select>
                            <Select
                                className="w-[150px]"
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                            >
                                <option value="">All Status</option>
                                {/* Matches the lowercase `status` enum in the schema. */}
                                <option value="active">Active</option>
                                <option value="inactive">Inactive</option>
                            </Select>
                        </div>
                    </div>

                    <div className="border rounded-md overflow-x-auto">
                        {loading ? (
                            <div className="p-6 space-y-3">
                                {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-10 w-full" />)}
                            </div>
                        ) : error ? (
                            <EmptyState
                                title="Could not load stations"
                                description={error}
                                action={<Button onClick={load}>Try again</Button>}
                            />
                        ) : rows.length === 0 ? (
                            <EmptyState
                                title="No stations found"
                                description={total === 0 ? 'No stations are loaded.' : 'No stations match these filters.'}
                                action={<Button variant="secondary" onClick={() => { setSearchTerm(''); setStateFilter(''); setStatusFilter(''); }}>Clear filters</Button>}
                            />
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Code</TableHead>
                                        <TableHead>Station Name</TableHead>
                                        <TableHead>City</TableHead>
                                        <TableHead>State</TableHead>
                                        <TableHead>Status</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {rows.map((st) => (<TableRow key={st.code}>
                                        <TableCell className="font-semibold">{st.code}</TableCell>
                                        <TableCell>{st.name}</TableCell>
                                        <TableCell>{st.city ?? '—'}</TableCell>
                                        <TableCell>{st.state ?? '—'}</TableCell>
                                        <TableCell>
                                            <Badge variant={st.status === 'active' ? 'success' : 'secondary'}>
                                                {st.status}
                                            </Badge>
                                        </TableCell>
                                      </TableRow>))}
                                </TableBody>
                            </Table>
                        )}
                    </div>

                    {total > 0 && (
                        <div className="mt-4 flex justify-end">
                            <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage}/>
                        </div>
                    )}
                </CardContent>
            </Card>

            <p className="text-caption text-muted">
                This view is read-only. The admin API exposes GET endpoints only, so stations are
                seeded through <code className="num">src/scripts/seedRailwayData.js</code> rather than
                edited here.
            </p>
        </div>
    );
};
export default StationManagement;
