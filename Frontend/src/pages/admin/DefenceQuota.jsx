import React, { useEffect, useMemo, useState } from 'react';
import { Search, ShieldCheck, RefreshCw } from 'lucide-react';

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/Card';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

import { defenceQuotaService } from '@/services/defenceQuotaService';

export default function DefenceQuota() {
  const [candidates, setCandidates] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadCandidates = async () => {
    setLoading(true);
    setError('');

    try {
      const result =
        await defenceQuotaService.getVerifiedCandidates();

      const rows = Array.isArray(result)
        ? result
        : Array.isArray(result?.data)
          ? result.data
          : Array.isArray(result?.data?.data)
            ? result.data.data
            : [];

      setCandidates(rows);
    } catch (err) {
      setError(
        err.message || 'Unable to load verified defence candidates.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCandidates();
  }, []);

  const filteredCandidates = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return candidates;

    return candidates.filter((candidate) => {
      const name = [
        candidate.firstName ?? candidate.first_name,
        candidate.lastName ?? candidate.last_name,
      ].filter(Boolean).join(' ');

      const defenceId =
        candidate.defenceId ?? candidate.defence_id ?? '';

      return (
        name.toLowerCase().includes(query) ||
        defenceId.toLowerCase().includes(query)
      );
    });
  }, [candidates, search]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row
                      sm:items-center sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2
                          text-sm font-semibold text-royal">
            <ShieldCheck className="size-5" />
            VERIFIED CANDIDATES
          </div>

          <h1 className="text-2xl font-bold text-ink sm:text-3xl">
            Defence Quota
          </h1>

          <p className="mt-1 text-sm text-ink-soft">
            View verified defence candidates registered in Yatrio.
          </p>
        </div>

        <Button
          type="button"
          onClick={loadCandidates}
          disabled={loading}
        >
          <RefreshCw className="mr-2 size-4" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-ink-soft">
              Verified candidates loaded
            </p>
            <p className="mt-2 text-3xl font-bold text-ink">
              {candidates.length}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-ink-soft">
              Verification filter
            </p>
            <p className="mt-2 text-xl font-semibold text-ink">
              Verified only
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row
                          sm:items-center sm:justify-between">
            <CardTitle>Defence Candidate Records</CardTitle>

            <div className="relative w-full sm:max-w-sm">
              <Search className="absolute left-3 top-1/2
                                 size-4 -translate-y-1/2
                                 text-ink-soft" />

              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or Defence ID"
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {error && (
            <div className="m-4 rounded-control border
                            border-error-strong/30 bg-error/10
                            p-3 text-sm text-error-strong">
              {error}
            </div>
          )}

          {loading ? (
            <p className="p-6 text-sm text-ink-soft">
              Loading candidates...
            </p>
          ) : !error && filteredCandidates.length === 0 ? (
            <p className="p-6 text-sm text-ink-soft">
              No verified candidates found.
            </p>
          ) : !error ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-left text-sm">
                <thead className="bg-surface-sunken">
                  <tr className="border-b border-line-mid">
                    <th className="p-4">Serial No.</th>
                    <th className="p-4">Name</th>
                    <th className="p-4">Defence ID</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredCandidates.map((candidate, index) => {
                    const firstName =
                      candidate.firstName ?? candidate.first_name ?? '';

                    const lastName =
                      candidate.lastName ?? candidate.last_name ?? '';

                    const defenceId =
                      candidate.defenceId ?? candidate.defence_id ?? '';

                    return (
                      <tr
                        key={candidate.serialNo ?? candidate.id ?? defenceId}
                        className="border-b border-line-mid last:border-0
                                   hover:bg-surface-sunken/60"
                      >
                        <td className="p-4">
                          {index + 1}
                        </td>

                        <td className="p-4 font-medium text-ink">
                          {firstName} {lastName}
                        </td>

                        <td className="p-4 font-mono">
                          {defenceId}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}

          {!loading && !error && (
            <p className="border-t border-line-mid p-3 text-xs
                          text-ink-soft">
              Showing {filteredCandidates.length} of{' '}
              {candidates.length} loaded verified candidates.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}