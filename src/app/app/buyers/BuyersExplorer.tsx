'use client';

/**
 * EXP-06 Buyer Discovery client — search/filter buyers and create a `BuyerLead`.
 *
 * Duplicate detection is entirely server-side (POST /api/v1/buyer-leads): this
 * component never guesses whether a lead already exists, it just renders whatever
 * the DUPLICATE_LEAD blocker says (docs/09 §2 "you can't do this yet, here's what to
 * fix, with a link").
 */

import { VerificationStatus } from '@prisma/client';
import { format } from 'date-fns';
import { useCallback, useEffect, useState } from 'react';
import { DataTable, StatusChip, type DataTableColumn } from '@/components/ui';
import { useDebouncedValue } from '@/hooks';
import { ApiClientError, apiGet, apiPost } from '@/lib/api-client';
import type { Blocker, ListResponse, PageMeta, SingleResponse, StatusDescriptor } from '@/types';

const PER_PAGE = 10;

interface BuyerDTO {
  id: string;
  legal_name: string;
  display_name: string;
  country_code: string;
  website: string | null;
  buyer_type: string;
  verification_status: VerificationStatus;
  risk_flags: { code: string; severity: string; summary: string }[];
  last_activity_at: string | null;
}

interface BuyerLeadDTO {
  id: string;
  stage: string;
  assigned_agent_id: string | null;
}

const VERIFICATION_DISPLAY: Record<VerificationStatus, StatusDescriptor> = {
  unverified: { label: 'Unverified', tone: 'neutral', icon: 'dot', detail: 'No verification performed yet.' },
  partially_verified: {
    label: 'Partially verified',
    tone: 'warning',
    icon: 'clock',
    detail: 'Some details confirmed — treat contact details with caution.',
  },
  verified: { label: 'Verified', tone: 'positive', icon: 'check' },
};

type LeadCreationState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'created'; lead: BuyerLeadDTO }
  | { status: 'duplicate'; blocker: Blocker }
  | { status: 'error'; message: string };

const EMPTY_PAGE: PageMeta = { page: 1, per_page: PER_PAGE, total: 0, total_pages: 1 };

export function BuyersExplorer({ products }: { products: { id: string; name: string }[] }) {
  const [productId, setProductId] = useState('');
  const [country, setCountry] = useState('');
  const [verificationStatus, setVerificationStatus] = useState<'' | VerificationStatus>('');
  const [page, setPage] = useState(1);

  const debouncedCountry = useDebouncedValue(country.trim().toUpperCase(), 350);
  const hasActiveFilters = Boolean(debouncedCountry || verificationStatus);

  const [buyers, setBuyers] = useState<BuyerDTO[]>([]);
  const [pageMeta, setPageMeta] = useState<PageMeta>(EMPTY_PAGE);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [leadStates, setLeadStates] = useState<Record<string, LeadCreationState>>({});

  useEffect(() => {
    setPage(1);
  }, [debouncedCountry, verificationStatus]);

  const fetchBuyers = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) });
      if (debouncedCountry) params.set('country', debouncedCountry);
      if (verificationStatus) params.set('verification_status', verificationStatus);
      const res = await apiGet<ListResponse<BuyerDTO>>(`/api/v1/buyers?${params.toString()}`);
      setBuyers(res.data);
      setPageMeta(res.meta);
    } catch (error) {
      setLoadError(error instanceof ApiClientError ? error.message : 'Could not load buyers. Please retry.');
      setBuyers([]);
    } finally {
      setLoading(false);
    }
  }, [page, debouncedCountry, verificationStatus]);

  useEffect(() => {
    fetchBuyers();
  }, [fetchBuyers]);

  const resetFilters = () => {
    setCountry('');
    setVerificationStatus('');
  };

  const createLead = async (buyer: BuyerDTO) => {
    if (!productId) return;
    setLeadStates((prev) => ({ ...prev, [buyer.id]: { status: 'loading' } }));
    try {
      const res = await apiPost<SingleResponse<BuyerLeadDTO>>('/api/v1/buyer-leads', {
        product_id: productId,
        buyer_id: buyer.id,
      });
      setLeadStates((prev) => ({ ...prev, [buyer.id]: { status: 'created', lead: res.data } }));
    } catch (error) {
      if (error instanceof ApiClientError && error.code === 'DUPLICATE_LEAD' && error.blockers?.[0]) {
        setLeadStates((prev) => ({ ...prev, [buyer.id]: { status: 'duplicate', blocker: error.blockers![0] } }));
        return;
      }
      setLeadStates((prev) => ({
        ...prev,
        [buyer.id]: {
          status: 'error',
          message: error instanceof ApiClientError ? error.message : 'Could not create the lead.',
        },
      }));
    }
  };

  const columns: DataTableColumn<BuyerDTO>[] = [
    {
      key: 'buyer',
      header: 'Buyer',
      render: (b) => (
        <div>
          <div className="font-medium text-primary">{b.display_name}</div>
          <div className="text-xs text-[var(--color-text-secondary)]">{b.legal_name}</div>
        </div>
      ),
    },
    { key: 'country', header: 'Country', render: (b) => b.country_code },
    {
      key: 'type',
      header: 'Type',
      render: (b) => <span className="capitalize">{b.buyer_type.replace(/_/g, ' ')}</span>,
    },
    {
      key: 'verification',
      header: 'Verification',
      render: (b) => <StatusChip {...VERIFICATION_DISPLAY[b.verification_status]} size="sm" />,
    },
    {
      key: 'risk',
      header: 'Risk',
      render: (b) =>
        b.risk_flags.length > 0 ? (
          <StatusChip
            label="Risk flagged"
            tone="critical"
            icon="alert"
            detail={b.risk_flags.map((f) => f.summary).join(' ')}
            size="sm"
          />
        ) : (
          <span className="text-xs text-[var(--color-text-secondary)]">No flags</span>
        ),
    },
    {
      key: 'activity',
      header: 'Last activity',
      hideOnMobile: true,
      render: (b) => (b.last_activity_at ? format(new Date(b.last_activity_at), 'dd MMM yyyy') : 'No activity recorded'),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-primary">Buyer discovery</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Search importers and create a tracked lead for your product.
        </p>
      </header>

      {/* Context header (docs/04 EXP-06): a lead needs a product before it can be created. */}
      <div className="mb-4 rounded-lg border border-[var(--color-border)] bg-surface p-4 shadow-card">
        <label className="block text-sm font-medium text-primary" htmlFor="product-select">
          Product
        </label>
        <select
          id="product-select"
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          className="mt-1 w-full max-w-sm rounded-md border border-[var(--color-border)] bg-surface px-3 py-2 text-sm text-primary focus-visible-ring"
        >
          <option value="">Choose a product…</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {!productId ? (
          <div className="mt-2">
            <StatusChip label="Choose a product to create leads" tone="warning" icon="alert" size="sm" />
          </div>
        ) : null}
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-[var(--color-border)] bg-surface p-4 shadow-card">
        <div>
          <label className="block text-sm font-medium text-primary" htmlFor="country-filter">
            Country code
          </label>
          <input
            id="country-filter"
            type="text"
            maxLength={2}
            placeholder="e.g. US"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="mt-1 w-28 rounded-md border border-[var(--color-border)] bg-surface px-3 py-2 text-sm uppercase text-primary focus-visible-ring"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-primary" htmlFor="verification-filter">
            Verification
          </label>
          <select
            id="verification-filter"
            value={verificationStatus}
            onChange={(e) => setVerificationStatus(e.target.value as '' | VerificationStatus)}
            className="mt-1 rounded-md border border-[var(--color-border)] bg-surface px-3 py-2 text-sm text-primary focus-visible-ring"
          >
            <option value="">All</option>
            <option value={VerificationStatus.unverified}>Unverified</option>
            <option value={VerificationStatus.partially_verified}>Partially verified</option>
            <option value={VerificationStatus.verified}>Verified</option>
          </select>
        </div>
        {hasActiveFilters ? (
          <button type="button" onClick={resetFilters} className="text-sm font-medium text-action hover:underline">
            Reset filters
          </button>
        ) : null}
      </div>

      {loadError ? (
        <div className="rounded-lg border border-critical/25 bg-critical/5 p-4 text-sm text-critical">
          <p className="font-medium">{loadError}</p>
          <button type="button" onClick={fetchBuyers} className="mt-2 font-medium underline underline-offset-2">
            Retry
          </button>
        </div>
      ) : (
        <DataTable<BuyerDTO>
          columns={columns}
          rows={buyers}
          rowKey={(b) => b.id}
          loading={loading}
          page={pageMeta}
          onPageChange={setPage}
          hasActiveFilters={hasActiveFilters}
          emptyState={{
            title: 'No buyers yet',
            description: 'Run buyer discovery from your product to populate this list.',
          }}
          filteredEmptyState={{
            title: 'No buyers match these filters',
            description: 'Try a different country or verification status.',
            action: (
              <button type="button" onClick={resetFilters} className="text-sm font-medium text-action hover:underline">
                Reset filters
              </button>
            ),
          }}
          rowActions={(buyer) => (
            <LeadAction
              state={leadStates[buyer.id] ?? { status: 'idle' }}
              disabled={!productId}
              onCreate={() => createLead(buyer)}
            />
          )}
        />
      )}
    </div>
  );
}

function LeadAction({
  state,
  disabled,
  onCreate,
}: {
  state: LeadCreationState;
  disabled: boolean;
  onCreate: () => void;
}) {
  if (state.status === 'created') {
    return (
      <StatusChip
        label={state.lead.assigned_agent_id ? 'Lead created' : 'Lead created — pending agent assignment'}
        tone="positive"
        icon="check"
        size="sm"
      />
    );
  }
  if (state.status === 'duplicate') {
    return (
      <div className="text-right text-xs">
        <StatusChip label="Lead already exists" tone="warning" icon="alert" size="sm" />
        {state.blocker.deep_link ? (
          <a href={state.blocker.deep_link} className="mt-1 block text-action underline underline-offset-2">
            View existing lead
          </a>
        ) : null}
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="text-right text-xs">
        <StatusChip label="Could not create lead" tone="critical" icon="x" size="sm" />
        <button type="button" onClick={onCreate} className="mt-1 block text-action underline underline-offset-2">
          Retry
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      disabled={disabled || state.status === 'loading'}
      onClick={onCreate}
      className="rounded-md bg-action px-3 py-1.5 text-xs font-medium text-[var(--color-text-inverse)] disabled:cursor-not-allowed disabled:opacity-40"
      title={disabled ? 'Choose a product first' : undefined}
    >
      {state.status === 'loading' ? 'Creating…' : 'Create lead'}
    </button>
  );
}
