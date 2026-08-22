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
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button, DataTable, StatusChip, type DataTableColumn, UpgradeNotice } from '@/components/ui';
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
  /** How many contacts exist. A count, never the contacts themselves. */
  contacts_total?: number;
  /** Server's answer, not a local guess — the API decides by tier. */
  contacts_locked?: boolean;
  contacts?: { id: string; name: string; role_title: string | null; email: string | null }[];
}

type Tier = 'guest' | 'free' | 'paid';

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

export function BuyersExplorer({
  products,
  tier,
  adHocContext,
  initialCountry = '',
  initialProductId = '',
}: {
  products: { id: string; name: string }[];
  tier: Tier;
  adHocContext: string | null;
  /** Prefill from EXP-05 "Find buyers in this market" — a market's country/product context. */
  initialCountry?: string;
  initialProductId?: string;
}) {
  const isGuest = tier === 'guest';
  const [productId, setProductId] = useState(initialProductId);
  const [country, setCountry] = useState(initialCountry);
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
          <Link href={`/app/buyers/${b.id}`} className="focus-visible-ring font-medium text-primary underline-offset-2 hover:underline">
            {b.display_name}
          </Link>
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
      key: 'contacts',
      header: 'Contacts',
      // Locked is shown, not hidden. A guest should be able to see that named contacts
      // exist and what unlocks them — an absent column would read as "this buyer has
      // none", which is a different and misleading claim (docs/03 §5).
      render: (b) => {
        if (b.contacts_locked) {
          return b.contacts_total && b.contacts_total > 0 ? (
            <UpgradeNotice
              variant="inline"
              title={`${b.contacts_total} contact${b.contacts_total === 1 ? '' : 's'} hidden`}
              requiredTier="free"
            />
          ) : (
            <span className="text-xs text-[var(--color-text-secondary)]">None listed</span>
          );
        }
        if (!b.contacts?.length) {
          return <span className="text-xs text-[var(--color-text-secondary)]">None listed</span>;
        }
        return (
          <div className="text-xs">
            <div className="text-primary">{b.contacts[0]!.name}</div>
            {b.contacts.length > 1 ? (
              <div className="text-[var(--color-text-secondary)]">+{b.contacts.length - 1} more</div>
            ) : null}
          </div>
        );
      },
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
        <h1 className="font-serif text-title-page text-primary">Buyer discovery</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Search importers and create a tracked lead for your product.
        </p>
      </header>

      {/* Context header (docs/04 EXP-06): a lead needs a product before it can be created.
          A guest has no Product rows by design, so they get their ad-hoc search context
          shown read-only instead of an empty selector they could never populate. */}
      <div className="mb-4 rounded-lg border border-[var(--color-border)] bg-surface p-4 shadow-card">
        {isGuest ? (
          <>
            <p className="text-sm font-normal text-primary">Searching for</p>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              {adHocContext ?? 'All buyers — run a market search to narrow this to your product.'}
            </p>
            <div className="mt-3">
              <UpgradeNotice
                variant="inline"
                title="Saving a lead needs a free account"
                requiredTier="free"
              />
            </div>
          </>
        ) : (
          <>
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
          </>
        )}
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
          <button type="button" onClick={resetFilters} className="text-sm font-medium text-primary underline underline-offset-2">
            Reset filters
          </button>
        ) : null}
      </div>

      {loadError ? (
        <div className="rounded-lg border border-[color-mix(in_srgb,var(--color-critical)_25%,transparent)] bg-[color-mix(in_srgb,var(--color-critical)_5%,transparent)] p-4 text-sm text-critical">
          <p className="font-normal">{loadError}</p>
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
              <button type="button" onClick={resetFilters} className="text-sm font-medium text-primary underline underline-offset-2">
                Reset filters
              </button>
            ),
          }}
          rowActions={(buyer) =>
            // A guest cannot save a lead at all, so they get the reason and the fix
            // rather than a disabled button with no explanation.
            isGuest ? (
              <UpgradeNotice variant="inline" title="Save this lead" requiredTier="free" />
            ) : (
              <LeadAction
                state={leadStates[buyer.id] ?? { status: 'idle' }}
                disabled={!productId}
                onCreate={() => createLead(buyer)}
              />
            )
          }
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
          <a href={state.blocker.deep_link} className="mt-1 block text-primary underline underline-offset-2">
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
        <button type="button" onClick={onCreate} className="mt-1 block text-primary underline underline-offset-2">
          Retry
        </button>
      </div>
    );
  }
  return (
    <Button
      type="button"
      disabled={disabled || state.status === 'loading'}
      onClick={onCreate}
      className="min-h-0 rounded-md px-3 py-1.5 text-xs font-medium"
      title={disabled ? 'Choose a product first' : undefined}
    >
      {state.status === 'loading' ? 'Creating…' : 'Create lead'}
    </Button>
  );
}
