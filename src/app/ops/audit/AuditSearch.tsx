'use client';

/**
 * OPS-07 audit search. GET-only against `/api/v1/audit` — "no mutation" is not just a
 * UI convention here, the route this calls has no PATCH/PUT/DELETE handler at all
 * (AC01).
 *
 * "Large audit range" (docs/06 required state): the server rejects a request with
 * neither a correlation/object id nor a <=90-day date range. Rather than silently
 * retrying, this component surfaces that 422 as the actual required-state message, so
 * the constraint is visible, not just enforced.
 */

import { format } from 'date-fns';
import { useCallback, useEffect, useState } from 'react';
import { DataTable, type DataTableColumn } from '@/components/ui';
import { ApiClientError, apiGet } from '@/lib/api-client';
import type { ListResponse, PageMeta } from '@/types';

const PER_PAGE = 25;
const EMPTY_PAGE: PageMeta = { page: 1, per_page: PER_PAGE, total: 0, total_pages: 1 };

interface AuditRow {
  id: string;
  actor_name: string | null;
  role: string | null;
  action: string;
  object_type: string;
  object_id: string;
  exporter_org_id: string | null;
  timestamp: string;
  before_summary: unknown;
  after_summary: unknown;
  correlation_id: string;
  source: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export function AuditSearch() {
  const [actorUserId, setActorUserId] = useState('');
  const [action, setAction] = useState('');
  const [objectType, setObjectType] = useState('');
  const [objectId, setObjectId] = useState('');
  const [exporterOrgId, setExporterOrgId] = useState('');
  const [correlationId, setCorrelationId] = useState('');
  const [dateFrom, setDateFrom] = useState(daysAgoIso(7));
  const [dateTo, setDateTo] = useState(todayIso());
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [pageMeta, setPageMeta] = useState<PageMeta>(EMPTY_PAGE);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [actorUserId, action, objectType, objectId, exporterOrgId, correlationId, dateFrom, dateTo]);

  const hasNarrowKey = Boolean(correlationId.trim()) || Boolean(objectId.trim());

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) });
      if (actorUserId.trim()) params.set('actor_user_id', actorUserId.trim());
      if (action.trim()) params.set('action', action.trim());
      if (objectType.trim()) params.set('object_type', objectType.trim());
      if (objectId.trim()) params.set('object_id', objectId.trim());
      if (exporterOrgId.trim()) params.set('exporter_org_id', exporterOrgId.trim());
      if (correlationId.trim()) params.set('correlation_id', correlationId.trim());
      if (!hasNarrowKey || dateFrom || dateTo) {
        if (dateFrom) params.set('date_from', dateFrom);
        if (dateTo) params.set('date_to', dateTo);
      }
      const res = await apiGet<ListResponse<AuditRow>>(`/api/v1/audit?${params.toString()}`);
      setRows(res.data);
      setPageMeta(res.meta);
    } catch (error) {
      setLoadError(error instanceof ApiClientError ? error.message : 'Could not load the audit log. Please retry.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [page, actorUserId, action, objectType, objectId, exporterOrgId, correlationId, dateFrom, dateTo, hasNarrowKey]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const columns: DataTableColumn<AuditRow>[] = [
    { key: 'timestamp', header: 'When', render: (r) => format(new Date(r.timestamp), 'dd MMM yyyy, HH:mm') },
    { key: 'actor', header: 'Actor', render: (r) => <div>{r.actor_name ?? 'ClearTrade'}<div className="text-xs text-[var(--color-text-secondary)]">{r.role ?? '—'}</div></div> },
    { key: 'action', header: 'Action', render: (r) => r.action.replace(/_/g, ' ') },
    { key: 'object', header: 'Object', render: (r) => <div>{r.object_type}<div className="text-xs text-[var(--color-text-secondary)]">{r.object_id.slice(-8)}</div></div> },
    { key: 'source', header: 'Source', hideOnMobile: true, render: (r) => r.source },
    { key: 'correlation_id', header: 'Correlation', hideOnMobile: true, render: (r) => <span className="font-mono text-xs">{r.correlation_id.slice(-10)}</span> },
  ];

  return (
    <div>
      <div className="mb-4 grid gap-3 rounded-lg border border-[var(--color-border)] bg-surface p-4 shadow-card sm:grid-cols-3 lg:grid-cols-6">
        <label className="text-xs font-medium text-primary">
          Actor user ID
          <input value={actorUserId} onChange={(e) => setActorUserId(e.target.value)} className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring" />
        </label>
        <label className="text-xs font-medium text-primary">
          Action
          <input value={action} onChange={(e) => setAction(e.target.value)} placeholder="e.g. state_change" className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring" />
        </label>
        <label className="text-xs font-medium text-primary">
          Object type
          <input value={objectType} onChange={(e) => setObjectType(e.target.value)} placeholder="e.g. deal" className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring" />
        </label>
        <label className="text-xs font-medium text-primary">
          Object ID
          <input value={objectId} onChange={(e) => setObjectId(e.target.value)} className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring" />
        </label>
        <label className="text-xs font-medium text-primary">
          Exporter org ID
          <input value={exporterOrgId} onChange={(e) => setExporterOrgId(e.target.value)} className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring" />
        </label>
        <label className="text-xs font-medium text-primary">
          Correlation ID
          <input value={correlationId} onChange={(e) => setCorrelationId(e.target.value)} className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring" />
        </label>
        <label className="text-xs font-medium text-primary">
          From
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} disabled={hasNarrowKey} className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring disabled:opacity-50" />
        </label>
        <label className="text-xs font-medium text-primary">
          To
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} disabled={hasNarrowKey} className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring disabled:opacity-50" />
        </label>
        {hasNarrowKey ? (
          <p className="col-span-full text-xs text-[var(--color-text-secondary)]">Searching by correlation/object ID — the date range is not required.</p>
        ) : (
          <p className="col-span-full text-xs text-[var(--color-text-secondary)]">A date range (max 90 days) is required unless searching by correlation ID or object ID.</p>
        )}
      </div>

      {loadError ? (
        <div className="rounded-lg border border-[color-mix(in_srgb,var(--color-critical)_25%,transparent)] bg-[color-mix(in_srgb,var(--color-critical)_5%,transparent)] p-4 text-sm text-critical">
          <p className="font-medium">{loadError}</p>
          <button type="button" onClick={fetchRows} className="mt-2 font-medium underline underline-offset-2">Retry</button>
        </div>
      ) : (
        <DataTable<AuditRow>
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          loading={loading}
          page={pageMeta}
          onPageChange={setPage}
          hasActiveFilters
          onRowClick={(r) => setExpanded(expanded === r.id ? null : r.id)}
          emptyState={{ title: 'No audit events', description: 'Widen the search to see results.' }}
        />
      )}

      {expanded ? (
        (() => {
          const row = rows.find((r) => r.id === expanded);
          if (!row) return null;
          return (
            <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-surface-muted p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-primary">Event detail — {row.action.replace(/_/g, ' ')} on {row.object_type}</p>
                <button type="button" onClick={() => setExpanded(null)} className="text-xs font-medium text-primary underline underline-offset-2">Close</button>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
                <div><dt className="uppercase text-[var(--color-text-muted)]">Actor</dt><dd className="text-primary">{row.actor_name ?? 'ClearTrade'} ({row.role ?? '—'})</dd></div>
                <div><dt className="uppercase text-[var(--color-text-muted)]">Source</dt><dd className="text-primary">{row.source}</dd></div>
                <div><dt className="uppercase text-[var(--color-text-muted)]">Timestamp</dt><dd className="text-primary">{format(new Date(row.timestamp), 'dd MMM yyyy, HH:mm:ss')}</dd></div>
                <div><dt className="uppercase text-[var(--color-text-muted)]">Correlation ID</dt><dd className="font-mono text-primary">{row.correlation_id}</dd></div>
              </dl>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">Before</p>
                  <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-surface p-2 text-xs text-primary">{JSON.stringify(row.before_summary, null, 2) ?? 'null'}</pre>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">After</p>
                  <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-surface p-2 text-xs text-primary">{JSON.stringify(row.after_summary, null, 2) ?? 'null'}</pre>
                </div>
              </div>
            </div>
          );
        })()
      ) : null}
    </div>
  );
}
