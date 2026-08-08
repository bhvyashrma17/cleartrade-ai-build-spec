'use client';

/**
 * EXP-05 Market Detail — score breakdown, requirements, commercial signal, logistics,
 * and the "Find buyers in this market" next step (docs/04).
 *
 * Every section is independent (AC02: "unavailable sections degrade independently") —
 * a missing `logistics_summary` must not blank the requirements section next to it.
 * `DataGap` renders that "unavailable" state explicitly rather than as empty space.
 */

import Link from 'next/link';
import { useState } from 'react';
import { format } from 'date-fns';
import { Button, MetricCard, StatusChip, UpgradeNotice } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

type Tier = 'guest' | 'free' | 'paid';

interface AssessmentDetail {
  id: string;
  country_code: string;
  overall_score: number;
  demand_score: number | null;
  growth_score: number | null;
  competition_score: number | null;
  india_share: string | null;
  tariff_summary: Record<string, unknown> | null;
  certification_requirements: unknown[];
  logistics_summary: Record<string, unknown> | null;
  price_band: { min: string; max: string | null; currency: string | null } | null;
  rationale: string | null;
  agent_note: string | null;
  generated_at: string;
  is_selected: boolean;
  is_saved: boolean;
  rank: number;
  total_ranked: number;
}

const REGION_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });
const countryName = (code: string) => {
  try {
    return REGION_NAMES.of(code) ?? code;
  } catch {
    return code;
  }
};

export function MarketDetail({
  tier,
  assessment,
  buyerDiscoveryHref,
  productDescription,
}: {
  tier: Tier;
  assessment: AssessmentDetail;
  buyerDiscoveryHref: { productId: string | null; countryCode: string };
  productDescription: string | null;
}) {
  const buyersUrl = buyerDiscoveryHref.productId
    ? `/app/buyers?product_id=${encodeURIComponent(buyerDiscoveryHref.productId)}&country=${buyerDiscoveryHref.countryCode}`
    : `/app/buyers?country=${buyerDiscoveryHref.countryCode}`;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <Link href="/app/markets" className="text-sm text-primary underline underline-offset-2">
        &larr; Back to markets
      </Link>

      <DecisionHeader tier={tier} assessment={assessment} />

      {assessment.rationale ? (
        <p className="mt-4 rounded-lg border border-[var(--color-border)] bg-surface-muted p-4 text-sm text-[var(--color-text-secondary)]">
          {assessment.rationale}
        </p>
      ) : null}

      <section className="mt-6">
        <SectionTitle>Score breakdown</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard label="Overall" value={`${assessment.overall_score}/100`} secondaryText="Weighted rank score" />
          {assessment.demand_score != null ? (
            <MetricCard label="Demand" value={`${assessment.demand_score}/100`} secondaryText="Import demand strength" />
          ) : (
            <DataGap label="Demand" />
          )}
          {assessment.growth_score != null ? (
            <MetricCard label="Growth" value={`${assessment.growth_score}/100`} secondaryText="Import growth trend" />
          ) : (
            <DataGap label="Growth" />
          )}
          {assessment.competition_score != null ? (
            <MetricCard
              label="Competition"
              value={`${assessment.competition_score}/100`}
              secondaryText="Higher = more crowded"
            />
          ) : (
            <DataGap label="Competition" />
          )}
          {assessment.india_share != null ? (
            <MetricCard label="India's share" value={`${assessment.india_share}%`} secondaryText="Of this market's imports" />
          ) : (
            <DataGap label="India's share" />
          )}
        </div>
      </section>

      <section className="mt-6">
        <SectionTitle>Requirements</SectionTitle>
        <RequirementsSection assessment={assessment} />
      </section>

      <section className="mt-6">
        <SectionTitle>Commercial signal</SectionTitle>
        <CommercialSection assessment={assessment} />
      </section>

      <section className="mt-6">
        <SectionTitle>Logistics</SectionTitle>
        <LogisticsSection assessment={assessment} />
      </section>

      <section className="mt-8 rounded-lg border border-[var(--color-action)]/30 bg-surface p-5 shadow-card">
        <h2 className="text-base font-semibold text-primary">Find buyers in this market</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          {productDescription
            ? `See importers for "${productDescription}" in ${countryName(assessment.country_code)}.`
            : `See importers in ${countryName(assessment.country_code)}.`}
        </p>
        <Link
          href={buyersUrl}
          className="mt-4 inline-flex min-h-10 items-center justify-center rounded bg-action px-4 text-sm font-semibold text-primary transition duration-fast hover:brightness-95"
        >
          Find buyers in {countryName(assessment.country_code)}
        </Link>
      </section>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
      {children}
    </h2>
  );
}

/** EXP-05 required state: "Data gap — individual section states 'Data unavailable'." */
function DataGap({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--color-border-strong)] bg-surface p-3">
      <p className="text-xs font-medium text-[var(--color-text-secondary)]">{label}</p>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">Data unavailable</p>
    </div>
  );
}

function DecisionHeader({ tier, assessment }: { tier: Tier; assessment: AssessmentDetail }) {
  return (
    <header className="mt-3 flex flex-wrap items-start justify-between gap-4 rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-primary">{countryName(assessment.country_code)}</h1>
          <span className="text-sm text-[var(--color-text-secondary)]">{assessment.country_code}</span>
          {assessment.is_selected ? <StatusChip label="Selected target" tone="positive" icon="check" size="sm" /> : null}
        </div>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Rank {assessment.rank} of {assessment.total_ranked} · Score {assessment.overall_score}/100 · Generated{' '}
          {format(new Date(assessment.generated_at), 'dd MMM yyyy')}
        </p>
      </div>
      <SaveSelectActions tier={tier} assessment={assessment} />
    </header>
  );
}

// ---------------------------------------------------------------------------
// Save / Select — the tier boundary
// ---------------------------------------------------------------------------

function SaveSelectActions({ tier, assessment }: { tier: Tier; assessment: AssessmentDetail }) {
  const [selected, setSelected] = useState(assessment.is_selected);
  const [saved, setSaved] = useState(assessment.is_saved);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (tier === 'guest') {
    // Never a blank space where the actions would be (docs/03 §5) — the boundary is
    // named, and the fix is one click away.
    return (
      <div className="w-full sm:w-64">
        <UpgradeNotice
          title="Save or select this market"
          description="Create a free account to save markets for later and pick your active target."
          requiredTier="free"
        />
      </div>
    );
  }

  async function toggleSave() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ data: { saved: boolean } }>(
        `/api/v1/market-assessments/${assessment.id}/save`,
        { saved: !saved },
      );
      setSaved(res.data.saved);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not save this market.');
    } finally {
      setBusy(false);
    }
  }

  async function select(confirmReplace: boolean) {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/v1/market-assessments/${assessment.id}/select`, {
        confirm_replace: confirmReplace,
      });
      setSelected(true);
      setConfirming(null);
    } catch (e) {
      if (e instanceof ApiClientError && e.code === 'VALIDATION_ERROR' && e.fields?.[0]?.field === 'confirm_replace') {
        // "Confirm if replacing the current active target" — the server holds the
        // reason; this just surfaces it rather than re-deriving it.
        setConfirming(e.fields[0].message);
        setBusy(false);
        return;
      }
      setError(e instanceof ApiClientError ? e.message : 'Could not select this market.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <Button variant="secondary" onClick={toggleSave} disabled={busy}>
          {saved ? 'Saved ✓' : 'Save for later'}
        </Button>
        <Button onClick={() => select(false)} disabled={busy || selected}>
          {selected ? 'Selected target' : 'Select as target'}
        </Button>
      </div>
      {confirming ? (
        <div className="max-w-xs rounded border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-3 text-right text-xs">
          <p className="text-primary">{confirming}</p>
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setConfirming(null)} className="text-[var(--color-text-secondary)] underline">
              Cancel
            </button>
            <button type="button" onClick={() => select(true)} className="font-semibold text-primary underline">
              Replace it
            </button>
          </div>
        </div>
      ) : null}
      {error ? <p className="text-xs text-critical">{error}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Requirements / commercial / logistics — each degrades independently
// ---------------------------------------------------------------------------

function RequirementsSection({ assessment }: { assessment: AssessmentDetail }) {
  const tariff = assessment.tariff_summary;
  const certs = assessment.certification_requirements;
  const hasAny = tariff || (certs && certs.length > 0);

  if (!hasAny) return <DataGap label="Requirements" />;

  return (
    <div className="space-y-3 rounded-lg border border-[var(--color-border)] bg-surface p-4">
      {tariff ? (
        <div>
          <p className="text-xs font-medium text-[var(--color-text-secondary)]">Tariff</p>
          <p className="mt-0.5 text-sm text-primary">
            {typeof tariff.note === 'string' ? tariff.note : JSON.stringify(tariff)}
          </p>
          {typeof tariff.band === 'string' ? (
            <StatusChip
              className="mt-1.5"
              size="sm"
              label={`${tariff.band} duty band`}
              tone={tariff.band === 'low' ? 'positive' : tariff.band === 'high' ? 'critical' : 'warning'}
              icon={tariff.band === 'low' ? 'check' : tariff.band === 'high' ? 'alert' : 'clock'}
            />
          ) : null}
        </div>
      ) : null}
      {certs && certs.length > 0 ? (
        <div>
          <p className="text-xs font-medium text-[var(--color-text-secondary)]">Certifications likely required</p>
          <ul className="mt-1 list-inside list-disc text-sm text-primary">
            {certs.map((c, i) => (
              <li key={i}>{String(c)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-xs text-[var(--color-text-muted)]">
        Estimated from category and destination — confirm exact requirements before quoting.
      </p>
    </div>
  );
}

function CommercialSection({ assessment }: { assessment: AssessmentDetail }) {
  if (!assessment.price_band) return <DataGap label="Commercial signal" />;

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-surface p-4">
      <p className="text-xs font-medium text-[var(--color-text-secondary)]">Typical price band</p>
      <p className="mt-0.5 text-lg font-semibold text-primary">
        {assessment.price_band.currency} {assessment.price_band.min}
        {assessment.price_band.max ? ` – ${assessment.price_band.max}` : ''}
        <span className="ml-1 text-xs font-normal text-[var(--color-text-secondary)]">per unit</span>
      </p>
    </div>
  );
}

function LogisticsSection({ assessment }: { assessment: AssessmentDetail }) {
  const logistics = assessment.logistics_summary;
  if (!logistics) return <DataGap label="Logistics" />;

  const transit = logistics.typical_transit_days;
  const mode = logistics.common_mode;

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-surface p-4">
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {typeof transit === 'number' ? (
          <div>
            <span className="text-[var(--color-text-secondary)]">Typical transit </span>
            <span className="font-medium text-primary">{transit} days</span>
          </div>
        ) : null}
        {typeof mode === 'string' ? (
          <div>
            <span className="text-[var(--color-text-secondary)]">Common mode </span>
            <span className="font-medium text-primary">{mode}</span>
          </div>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-[var(--color-text-muted)]">Estimated — confirm with your freight partner.</p>
    </div>
  );
}
