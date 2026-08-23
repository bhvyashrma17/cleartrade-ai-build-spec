'use client';

/**
 * EXP-08 Deals List. Filters persist to the URL (docs/04: "URL-persist when
 * practical") so a refresh or a shared link keeps the same view. Risk/blocked state is
 * a visible column on every row (AC02) — never something you have to open a deal to see.
 */

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable, MetricCard, StatusChip, type DataTableColumn } from '@/components/ui';
import { useDebouncedValue } from '@/hooks';
import { ApiClientError, apiGet } from '@/lib/api-client';
import type { ListResponse, PageMeta } from '@/types';

const PER_PAGE = 20;
const EMPTY_PAGE: PageMeta = { page: 1, per_page: PER_PAGE, total: 0, total_pages: 1 };

interface DealRow {
  id: string;
  stage: string;
  risk_state: string;
  risk_reason: string | null;
  value_amount: string | null;
  value_currency: string | null;
  buyer_name: string;
  buyer_country: string;
  product_name: string | null;
  owner_agent_name: string | null;
  updated_at: string;
  next_action: { title: string; due_at: string | null; sla_state: string } | null;
}

interface DealsSummary {
  open_value: { currency: string; amount: number }[];
  negotiating_count: number;
  executing_count: number;
}

type DealsMeta = PageMeta & { summary?: DealsSummary };

const STAGE_OPTIONS = [
  { value: '', label: 'All stages' },
  { value: 'qualifying', label: 'Qualifying' },
  { value: 'negotiating', label: 'Negotiating' },
  { value: 'terms_agreed', label: 'Terms agreed' },
  { value: 'deal_locked', label: 'Deal locked' },
  { value: 'executing', label: 'Executing' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'closed_won', label: 'Closed — won' },
  { value: 'closed_lost', label: 'Closed — lost' },
  { value: 'cancelled', label: 'Cancelled' },
];

const RISK_OPTIONS = [
  { value: '', label: 'Any risk' },
  { value: 'normal', label: 'Normal' },
  { value: 'watch', label: 'Watch' },
  { value: 'at_risk', label: 'At risk' },
  { value: 'blocked', label: 'Blocked' },
];

const RISK_DISPLAY: Record<string, { label: string; tone: 'positive' | 'info' | 'warning' | 'critical' }> = {
  normal: { label: 'Normal', tone: 'positive' },
  watch: { label: 'Watch', tone: 'info' },
  at_risk: { label: 'At risk', tone: 'warning' },
  blocked: { label: 'Blocked', tone: 'critical' },
};

const SLA_DISPLAY: Record<string, { label: string; tone: 'positive' | 'info' | 'warning' | 'critical' }> = {
  on_time: { label: 'On time', tone: 'info' },
  due_soon: { label: 'Due soon', tone: 'warning' },
  overdue: { label: 'Overdue', tone: 'critical' },
  escalated: { label: 'Escalated', tone: 'critical' },
};

function money(amount: string | null, currency: string | null) {
  if (!amount) return '—';
  return `${currency ?? ''} ${Number(amount).toLocaleString('en-IN')}`.trim();
}

function formatDue(due: string | null) {
  if (!due) return 'No due date';
  return new Date(due).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export interface DealsListInitialFilters {
  stage?: string;
  risk?: string;
  country?: string;
  buyer?: string;
  updated_after?: string;
  page?: string;
}

export function DealsList({ initialFilters = {} }: { initialFilters?: DealsListInitialFilters }) {
  const router = useRouter();
  const pathname = usePathname();

  // Initial state comes from the SERVER-read searchParams (passed down as a prop), not
  // from the `useSearchParams()` client hook — that hook forces the route into a
  // Suspense boundary at build time, which nothing else in this codebase uses
  // (BuyersExplorer takes the same prop-from-server-page approach). `router.replace`
  // below still keeps the URL in sync as filters change client-side.
  const [stage, setStage] = useState(initialFilters.stage ?? '');
  const [risk, setRisk] = useState(initialFilters.risk ?? '');
  const [country, setCountry] = useState(initialFilters.country ?? '');
  const [buyer, setBuyer] = useState(initialFilters.buyer ?? '');
  const [updatedAfter, setUpdatedAfter] = useState(initialFilters.updated_after ?? '');
  const [page, setPage] = useState(Number(initialFilters.page ?? 1) || 1);

  const debouncedCountry = useDebouncedValue(country.trim().toUpperCase(), 350);
  const debouncedBuyer = useDebouncedValue(buyer.trim(), 350);

  const [deals, setDeals] = useState<DealRow[]>([]);
  const [pageMeta, setPageMeta] = useState<PageMeta>(EMPTY_PAGE);
  const [summary, setSummary] = useState<DealsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filter changes reset to page 1 — a stale page number on a narrower result set would
  // otherwise render an empty page that looks like "no results" rather than "wrong page".
  useEffect(() => {
    setPage(1);
  }, [stage, risk, debouncedCountry, debouncedBuyer, updatedAfter]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) });
    if (stage) params.set('stage', stage);
    if (risk) params.set('risk', risk);
    if (debouncedCountry) params.set('country', debouncedCountry);
    if (debouncedBuyer) params.set('buyer', debouncedBuyer);
    if (updatedAfter) params.set('updated_after', updatedAfter);
    return params;
  }, [page, stage, risk, debouncedCountry, debouncedBuyer, updatedAfter]);

  // URL-persist (docs/04 EXP-08): mirror the current filter/page state into the address
  // bar without adding a history entry per keystroke, so refresh/share/back all work.
  useEffect(() => {
    router.replace(`${pathname}?${queryString.toString()}`, { scroll: false });
  }, [queryString, pathname, router]);

  const fetchDeals = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiGet<ListResponse<DealRow>>(`/api/v1/deals?${queryString.toString()}`);
      setDeals(res.data);
      setPageMeta(res.meta);
      setSummary((res.meta as DealsMeta).summary ?? null);
    } catch (error) {
      setLoadError(error instanceof ApiClientError ? error.message : 'Could not load your deals. Please retry.');
      setDeals([]);
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    fetchDeals();
  }, [fetchDeals]);

  const hasActiveFilters = Boolean(stage || risk || country || buyer || updatedAfter);

  const resetFilters = () => {
    setStage('');
    setRisk('');
    setCountry('');
    setBuyer('');
    setUpdatedAfter('');
  };

  const columns: DataTableColumn<DealRow>[] = [
    {
      key: 'buyer',
      header: 'Buyer',
      render: (deal) => (
        <div>
          <Link href={`/app/deals/${deal.id}`} className="focus-visible-ring font-medium text-primary underline-offset-2 hover:underline">
            {deal.buyer_name}
          </Link>
          <div className="text-xs text-[var(--color-text-secondary)]">
            {deal.buyer_country}
            {deal.product_name ? ` · ${deal.product_name}` : ''}
          </div>
        </div>
      ),
    },
    {
      key: 'stage',
      header: 'Stage',
      render: (deal) => <span className="capitalize">{deal.stage.replace(/_/g, ' ')}</span>,
    },
    {
      key: 'value',
      header: 'Value',
      align: 'right',
      render: (deal) => money(deal.value_amount, deal.value_currency),
    },
    {
      key: 'next_action',
      header: 'Next action',
      render: (deal) =>
        deal.next_action ? (
          <div>
            <div className="text-primary">{deal.next_action.title}</div>
            <div className="mt-0.5">
              <StatusChip
                label={SLA_DISPLAY[deal.next_action.sla_state]?.label ?? formatDue(deal.next_action.due_at)}
                tone={SLA_DISPLAY[deal.next_action.sla_state]?.tone ?? 'neutral'}
                icon="clock"
                size="sm"
              />
            </div>
          </div>
        ) : (
          <span className="text-[var(--color-text-secondary)]">Nothing outstanding</span>
        ),
    },
    {
      key: 'risk',
      header: 'Risk',
      // AC02: risk/blocked state visible on the list itself — this column, not a click-through.
      render: (deal) => {
        const display = RISK_DISPLAY[deal.risk_state] ?? RISK_DISPLAY.normal;
        return (
          <StatusChip
            label={display.label}
            tone={display.tone}
            icon={display.tone === 'critical' || display.tone === 'warning' ? 'alert' : 'dot'}
            detail={deal.risk_reason ?? undefined}
            size="sm"
          />
        );
      },
    },
    {
      key: 'owner',
      header: 'Agent',
      hideOnMobile: true,
      render: (deal) => deal.owner_agent_name ?? 'Unassigned',
    },
  ];

  return (
    <div className="py-4 md:py-6">
      <header className="mb-6">
        <p className="text-sm font-normal text-primary">Your pipeline</p>
        <h1 className="font-serif text-title-page text-primary">Deals</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Every deal your agent is working, across every buyer.
        </p>
      </header>

      <section aria-label="Pipeline summary" className="mb-6 grid gap-3 sm:grid-cols-3">
        <MetricCard
          label="Open value"
          value={
            summary && summary.open_value.length > 0
              ? summary.open_value.map((v) => money(String(v.amount), v.currency)).join(' + ')
              : '—'
          }
          secondaryText="Across every active stage"
          loading={loading && !summary}
        />
        <MetricCard label="Negotiating" value={summary?.negotiating_count ?? 0} loading={loading && !summary} />
        <MetricCard label="Executing" value={summary?.executing_count ?? 0} loading={loading && !summary} />
      </section>

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-[var(--color-border)] bg-surface p-4 shadow-card">
        <div>
          <label className="block text-sm font-medium text-primary" htmlFor="deal-stage-filter">
            Stage
          </label>
          <select
            id="deal-stage-filter"
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            className="mt-1 rounded-md border border-[var(--color-border)] bg-surface px-3 py-2 text-sm text-primary focus-visible-ring"
          >
            {STAGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-primary" htmlFor="deal-risk-filter">
            Risk
          </label>
          <select
            id="deal-risk-filter"
            value={risk}
            onChange={(e) => setRisk(e.target.value)}
            className="mt-1 rounded-md border border-[var(--color-border)] bg-surface px-3 py-2 text-sm text-primary focus-visible-ring"
          >
            {RISK_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-primary" htmlFor="deal-country-filter">
            Country
          </label>
          <input
            id="deal-country-filter"
            type="text"
            maxLength={2}
            placeholder="e.g. US"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="mt-1 w-24 rounded-md border border-[var(--color-border)] bg-surface px-3 py-2 text-sm uppercase text-primary focus-visible-ring"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-primary" htmlFor="deal-buyer-filter">
            Buyer
          </label>
          <input
            id="deal-buyer-filter"
            type="text"
            placeholder="Search buyer name"
            value={buyer}
            onChange={(e) => setBuyer(e.target.value)}
            className="mt-1 w-44 rounded-md border border-[var(--color-border)] bg-surface px-3 py-2 text-sm text-primary focus-visible-ring"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-primary" htmlFor="deal-date-filter">
            Updated since
          </label>
          <input
            id="deal-date-filter"
            type="date"
            value={updatedAfter}
            onChange={(e) => setUpdatedAfter(e.target.value)}
            className="mt-1 rounded-md border border-[var(--color-border)] bg-surface px-3 py-2 text-sm text-primary focus-visible-ring"
          />
        </div>
        {hasActiveFilters ? (
          <button type="button" onClick={resetFilters} className="text-sm font-medium text-primary underline underline-offset-2">
            Reset filters
          </button>
        ) : null}
      </div>

      {loadError ? (
        <div className="rounded-lg border border-[color-mix(in_srgb,var(--color-critical)_25%,transparent)] bg-[color-mix(in_srgb,var(--color-critical)_5%,transparent)] p-4 text-sm text-[var(--color-critical-text)]">
          <p className="font-normal">{loadError}</p>
          <button type="button" onClick={fetchDeals} className="mt-2 font-medium underline underline-offset-2">
            Retry
          </button>
        </div>
      ) : (
        <DataTable<DealRow>
          columns={columns}
          rows={deals}
          rowKey={(deal) => deal.id}
          loading={loading}
          page={pageMeta}
          onPageChange={setPage}
          hasActiveFilters={hasActiveFilters}
          onRowClick={(deal) => router.push(`/app/deals/${deal.id}`)}
          emptyState={{
            title: 'No deals yet',
            description: 'Deals your agent opens from a buyer lead will appear here.',
            action: (
              <Link href="/app/buyers" className="text-sm font-medium text-primary underline underline-offset-2">
                Find buyers
              </Link>
            ),
          }}
          filteredEmptyState={{
            title: 'No deals match these filters',
            description: 'Try a different filter or reset them.',
            action: (
              <button type="button" onClick={resetFilters} className="text-sm font-medium text-primary underline underline-offset-2">
                Reset filters
              </button>
            ),
          }}
        />
      )}
    </div>
  );
}
