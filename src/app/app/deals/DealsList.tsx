'use client';

import { useCallback, useEffect, useState } from 'react';
import { DataTable, StatusChip, type DataTableColumn } from '@/components/ui';
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
}

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

const RISK_DISPLAY: Record<string, { label: string; tone: 'positive' | 'info' | 'warning' | 'critical' }> = {
  normal: { label: 'Normal', tone: 'positive' },
  watch: { label: 'Watch', tone: 'info' },
  at_risk: { label: 'At risk', tone: 'warning' },
  blocked: { label: 'Blocked', tone: 'critical' },
};

function money(amount: string | null, currency: string | null) {
  if (!amount) return '—';
  return `${currency ?? ''} ${Number(amount).toLocaleString('en-IN')}`.trim();
}

export function DealsList() {
  const [stage, setStage] = useState('');
  const [page, setPage] = useState(1);
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [pageMeta, setPageMeta] = useState<PageMeta>(EMPTY_PAGE);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [stage]);

  const fetchDeals = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) });
      if (stage) params.set('stage', stage);
      const res = await apiGet<ListResponse<DealRow>>(`/api/v1/deals?${params.toString()}`);
      setDeals(res.data);
      setPageMeta(res.meta);
    } catch (error) {
      setLoadError(error instanceof ApiClientError ? error.message : 'Could not load your deals. Please retry.');
      setDeals([]);
    } finally {
      setLoading(false);
    }
  }, [page, stage]);

  useEffect(() => {
    fetchDeals();
  }, [fetchDeals]);

  const hasActiveFilters = Boolean(stage);

  const columns: DataTableColumn<DealRow>[] = [
    {
      key: 'buyer',
      header: 'Buyer',
      render: (deal) => (
        <div>
          <div className="font-medium text-primary">{deal.buyer_name}</div>
          <div className="text-xs text-[var(--color-text-secondary)]">{deal.buyer_country}{deal.product_name ? ` · ${deal.product_name}` : ''}</div>
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
      key: 'risk',
      header: 'Risk',
      render: (deal) => {
        const display = RISK_DISPLAY[deal.risk_state] ?? RISK_DISPLAY.normal;
        return <StatusChip label={display.label} tone={display.tone} icon={display.tone === 'critical' || display.tone === 'warning' ? 'alert' : 'dot'} detail={deal.risk_reason ?? undefined} size="sm" />;
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
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <header className="mb-6">
        <p className="text-sm font-medium text-primary">Your pipeline</p>
        <h1 className="text-2xl font-semibold text-primary">Deals</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Every deal your agent is working, across every buyer.
        </p>
      </header>

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
      </div>

      {loadError ? (
        <div className="rounded-lg border border-[color-mix(in_srgb,var(--color-critical)_25%,transparent)] bg-[color-mix(in_srgb,var(--color-critical)_5%,transparent)] p-4 text-sm text-[var(--color-critical-text)]">
          <p className="font-medium">{loadError}</p>
          <button type="button" onClick={fetchDeals} className="mt-2 font-medium underline underline-offset-2">
            Retry
          </button>
        </div>
      ) : (
        <>
          <DataTable<DealRow>
            columns={columns}
            rows={deals}
            rowKey={(deal) => deal.id}
            loading={loading}
            page={pageMeta}
            onPageChange={setPage}
            hasActiveFilters={hasActiveFilters}
            emptyState={{
              title: 'No deals yet',
              description: 'Deals your agent opens from a buyer lead will appear here.',
            }}
            filteredEmptyState={{
              title: 'No deals at this stage',
              description: 'Try a different stage filter.',
              action: (
                <button type="button" onClick={() => setStage('')} className="text-sm font-medium text-primary underline underline-offset-2">
                  Reset filter
                </button>
              ),
            }}
          />
          {deals.length > 0 ? (
            <p className="mt-3 text-xs text-[var(--color-text-secondary)]">
              Deal detail pages aren&apos;t built yet — this list is read-only for now.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
