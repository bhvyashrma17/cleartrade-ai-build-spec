'use client';

/**
 * The pre-membership estimate (docs/14 §3) — what guest and free tier get at `/app/markets`
 * instead of full ranked Demand Discovery, which now requires the commitment fee paid.
 *
 * FRAMING IS A REQUIREMENT: every number here is observed history from the trade
 * warehouse, never a projection. The component renders exactly what the API returns
 * (`headline`, `disclaimer`) rather than composing its own copy, so the framing rule
 * lives in one place (`src/lib/market-estimate.ts`) and this component cannot drift from
 * it by rewording something that sounded better.
 */

import { useState } from 'react';
import Link from 'next/link';
import { Button, Input, UpgradeNotice } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

type Tier = 'guest' | 'free' | 'paid';

interface EstimateMarket {
  country_code: string;
  observed_import_value_usd: number;
  data_years: number[];
  unit_price_band: { min: number; max: number; currency: string } | null;
  headline: string;
}

interface EstimateResult {
  hs_scope: string;
  hs_scope_requested: string;
  hs_scope_widened: boolean;
  markets: EstimateMarket[];
  disclaimer: string;
  /** Where the figures come from, e.g. "CEPII BACI 202501 (HS22), 2022–2024" (E-041). */
  source_label?: string | null;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; result: EstimateResult }
  | { kind: 'blocked'; message: string }
  | { kind: 'error'; message: string; fields: Record<string, string> };

const REGION_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });
const countryName = (code: string) => {
  try {
    return REGION_NAMES.of(code) ?? code;
  } catch {
    return code;
  }
};

export function MarketEstimate({ tier, guestRunLimit }: { tier: Tier; guestRunLimit: number }) {
  const isGuest = tier === 'guest';
  const [description, setDescription] = useState('');
  const [hsCode, setHsCode] = useState('');
  const [monthlyQuantity, setMonthlyQuantity] = useState('');
  const [location, setLocation] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  const fieldErrors = phase.kind === 'error' ? phase.fields : {};
  const submitting = phase.kind === 'running';
  const canSubmit = description.trim().length >= 3 && /^\d{4,8}$/.test(hsCode.trim()) && !submitting;

  async function run() {
    setPhase({ kind: 'running' });
    try {
      const result = await apiPost<{ data: EstimateResult }>('/api/v1/market-estimates', {
        product_description: description.trim(),
        hs_code: hsCode.trim(),
        ...(monthlyQuantity.trim() ? { monthly_quantity: Number(monthlyQuantity.trim()) } : {}),
        ...(location.trim() ? { location: location.trim() } : {}),
      });
      setPhase({ kind: 'done', result: result.data });
    } catch (error) {
      if (error instanceof ApiClientError) {
        if (error.code === 'RATE_LIMITED') {
          setPhase({ kind: 'blocked', message: error.message });
          return;
        }
        setPhase({
          kind: 'error',
          message: error.message,
          fields: Object.fromEntries((error.fields ?? []).map((f) => [f.field, f.message])),
        });
        return;
      }
      setPhase({ kind: 'error', message: 'Could not compute the estimate. Please retry.', fields: {} });
    }
  }

  return (
    <div className="py-6">
      <header className="mb-6">
        <h1 className="font-serif text-title-page text-primary">See where your product is already selling</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          A free look at customs-recorded trade history for your product&rsquo;s HS code — which
          countries buy it, and at what price. This is historical data, not a forecast.
        </p>
      </header>

      {isGuest ? (
        <div className="mb-5 rounded-lg border border-[color-mix(in_srgb,var(--info-fill)_25%,transparent)] bg-[var(--info-tint)] p-4 text-sm">
          <p className="font-normal text-primary">You&rsquo;re browsing as a guest — no account needed.</p>
          <p className="mt-1 text-[var(--color-text-secondary)]">
            You get {guestRunLimit} free estimates.{' '}
            <Link href="/register" className="font-semibold text-primary underline underline-offset-2">
              Create a free account
            </Link>{' '}
            to save this search, then upgrade to Premium for full ranked Demand Discovery —
            market scores, requirements, and buyer discovery.
          </p>
        </div>
      ) : (
        <div className="mb-5 rounded-lg border border-[var(--color-border)] bg-surface-muted p-4 text-sm">
          <p className="text-[var(--color-text-secondary)]">
            You&rsquo;re on the free plan.{' '}
            <Link href="/app/plans" className="font-semibold text-primary underline underline-offset-2">
              Upgrade to Premium
            </Link>{' '}
            to unlock full ranked Demand Discovery — market scores, requirements, and Buyer
            Discovery. There&rsquo;s a sample of it below.
          </p>
        </div>
      )}

      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <div className="space-y-4">
          <div>
            <label htmlFor="est-description" className="mb-1.5 block text-sm font-medium text-primary">
              What do you export?
            </label>
            <Input
              id="est-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Organic turmeric powder, food grade"
              error={fieldErrors.product_description}
            />
          </div>
          <div>
            <label htmlFor="est-hs" className="mb-1.5 block text-sm font-medium text-primary">
              HS code
            </label>
            <Input
              id="est-hs"
              value={hsCode}
              onChange={(e) => setHsCode(e.target.value)}
              placeholder="091030"
              inputMode="numeric"
              error={fieldErrors.hs_code}
            />
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
              Required — this is the customs classification the trade data is indexed by.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="est-qty" className="mb-1.5 block text-sm font-medium text-primary">
                Monthly quantity{' '}
                <span className="font-normal text-[var(--color-text-secondary)]">(optional)</span>
              </label>
              <Input
                id="est-qty"
                value={monthlyQuantity}
                onChange={(e) => setMonthlyQuantity(e.target.value)}
                placeholder="500"
                inputMode="numeric"
                error={fieldErrors.monthly_quantity}
              />
            </div>
            <div>
              <label htmlFor="est-loc" className="mb-1.5 block text-sm font-medium text-primary">
                Your location <span className="font-normal text-[var(--color-text-secondary)]">(optional)</span>
              </label>
              <Input
                id="est-loc"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Kochi, Kerala"
                error={fieldErrors.location}
              />
            </div>
          </div>
        </div>

        {phase.kind === 'error' && !Object.keys(fieldErrors).length ? (
          <p role="alert" className="mt-3 text-sm text-critical">
            {phase.message}
          </p>
        ) : null}

        <Button onClick={run} disabled={!canSubmit} className="mt-5 w-full sm:w-auto">
          {submitting ? 'Looking up trade data…' : 'See the estimate'}
        </Button>
      </section>

      {phase.kind === 'blocked' ? (
        <div className="mt-5">
          <UpgradeNotice title="You've used your free estimates" description={phase.message} requiredTier="free" />
        </div>
      ) : null}

      {phase.kind === 'done' ? <EstimateResults result={phase.result} /> : null}
    </div>
  );
}

function EstimateResults({ result }: { result: EstimateResult }) {
  if (result.markets.length === 0) {
    return (
      <section className="mt-5 rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <p className="text-sm text-[var(--color-text-secondary)]">
          {result.hs_scope
            ? 'No recorded import history above our reporting threshold for this HS code yet.'
            : 'Enter a valid HS code to see recorded trade history.'}
        </p>
      </section>
    );
  }

  return (
    <section className="mt-5 rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
      {result.hs_scope_widened ? (
        <p className="mb-3 rounded border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5 px-3 py-2 text-xs text-[var(--color-text-secondary)]">
          No recorded history at HS {result.hs_scope_requested} specifically — shown for the broader
          HS <span className="record">{result.hs_scope}</span> group.
        </p>
      ) : null}

      <ol className="space-y-3">
        {result.markets.map((market, index) => (
          <li
            key={market.country_code}
            className="rounded-lg border border-[var(--color-border)] bg-surface-muted p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="text-sm font-semibold text-primary">
                {index + 1}. {countryName(market.country_code)}
              </span>
              <span className="text-xs text-[var(--color-text-secondary)]">
                {market.data_years[0]}–{market.data_years[market.data_years.length - 1]}
              </span>
            </div>
            <p className="mt-1.5 text-sm text-[var(--color-text-secondary)]">{market.headline}</p>
          </li>
        ))}
      </ol>

      {result.source_label ? <p className="mt-3 text-xs text-[var(--color-text-muted)]">Source: {result.source_label}</p> : null}
      {/* Verbatim from the API — never rewritten by this component. */}
      <p className="mt-4 rounded border border-[color-mix(in_srgb,var(--info-fill)_25%,transparent)] bg-[var(--info-tint)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
        {result.disclaimer}
      </p>
    </section>
  );
}
