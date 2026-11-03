'use client';

/**
 * Demand Discovery v5 results (docs/36 §5–§6): every screening market, ranked where the data
 * allows, each with its labels and the reasons behind its score.
 *
 * The ranked list leads with the markets handed on to buyer search. Markets that could not be
 * ranked are listed apart with why — "not enough data" is a gap, not a low score, and is never
 * mixed into the ranking. Labels carry text and an icon; colour is never the only cue (docs/10 §4).
 *
 * When the exporter's FOB price or capacity is missing, fit with their business is left out of every
 * score; the page says so, names each missing figure, and links to the product's details. A card whose
 * score used fewer than 100 points says how many (stage 1, item 7).
 */

import Link from 'next/link';
import { useState } from 'react';
import { RupeeRateNote, useRupees } from '@/components/fx/RupeeRate';
import { buttonClass, StatusChip } from '@/components/ui';
import type { ExporterFitView } from '@/lib/demand-discovery-v5/exporter-inputs';
import type { IndiaMarket } from '@/lib/demand-discovery-v5/india-markets';
import type { StatusIconName, StatusTone } from '@/types';

export interface V5Label { key: string; text: string; tone: 'positive' | 'caution' | 'info'; estimated?: boolean }
export interface V5Reason { metric: string | null; effect: 'adds' | 'costs' | 'status'; text: string }

export interface V5Row {
  id: string;
  country_code: string;
  overall_score: number | null;
  confidence_score: number;
  market_status: 'ranked' | 'not_enough_data' | 'no_recorded_demand' | 'excluded' | null;
  rank: number | null;
  live_points: number | null;
  data_year: number | null;
  labels: V5Label[];
  reasons: V5Reason[];
  flag_reasons: string[];
  handed_off: boolean;
}

const REGION_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });
export const countryName = (code: string) => {
  try {
    return REGION_NAMES.of(code) ?? code;
  } catch {
    return code;
  }
};

const LABEL_TONE: Record<V5Label['tone'], { tone: StatusTone; icon: StatusIconName }> = {
  positive: { tone: 'positive', icon: 'check' },
  caution: { tone: 'warning', icon: 'alert' },
  info: { tone: 'info', icon: 'dot' },
};

export function V5Labels({ labels }: { labels: V5Label[] }) {
  if (!labels.length) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Labels">
      {labels.map((label) => (
        <li key={label.key}>
          <StatusChip label={label.text} size="sm" {...LABEL_TONE[label.tone]} />
        </li>
      ))}
    </ul>
  );
}

export function V5Reasons({ reasons }: { reasons: V5Reason[] }) {
  const rupees = useRupees();
  if (!reasons.length) return null;
  return (
    <ul className="mt-2 space-y-1 text-sm text-[var(--color-text-secondary)]">
      {reasons.map((reason, index) => (
        <li key={`${reason.metric ?? 'status'}-${index}`}>
          {reason.effect === 'costs' ? <span className="font-medium text-primary">Holding it back: </span> : null}
          {rupees(reason.text)}
        </li>
      ))}
    </ul>
  );
}

function RankedCard({ row }: { row: V5Row }) {
  return (
    <Link
      href={`/app/markets/${row.id}`}
      className="focus-visible-ring block rounded-lg border border-[var(--color-border)] bg-surface-muted p-4 transition duration-fast hover:border-[var(--color-action)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="text-sm font-semibold text-primary">
            {row.rank}. {countryName(row.country_code)}
          </span>
          <span className="ml-2 text-xs text-[var(--color-text-secondary)]">{row.country_code}</span>
          {row.data_year ? <span className="ml-2 text-xs text-[var(--color-text-muted)]">data to {row.data_year}</span> : null}
        </div>
        <div className="shrink-0 text-right">
          <span className="text-sm font-bold text-primary">
            {row.overall_score}
            <span className="text-xs font-normal text-[var(--color-text-secondary)]">/100</span>
          </span>
          <p className="text-xs text-[var(--color-text-secondary)]">Confidence {row.confidence_score}%</p>
          {row.live_points != null && row.live_points < 100 ? <p className="text-xs text-[var(--color-text-muted)]">on {row.live_points} of 100 points</p> : null}
        </div>
      </div>
      {row.flag_reasons.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {row.flag_reasons.map((reason) => <StatusChip key={reason} label={reason} tone="warning" icon="alert" size="sm" />)}
        </div>
      ) : null}
      <V5Labels labels={row.labels} />
      <V5Reasons reasons={row.reasons} />
    </Link>
  );
}

/** Which of the exporter's figures are missing, why, and the points their measures carry. */
function ExporterFitPrompt({ fit, productId }: { fit: ExporterFitView; productId: string | null }) {
  const missing = [
    fit.price.usd_per_kg == null ? { reason: fit.price.reason ?? 'Your FOB price per kg is not on file.', points: fit.points.price_fit } : null,
    fit.capacity.kg_per_year == null ? { reason: fit.capacity.reason ?? 'Your capacity is not on file.', points: fit.points.volume_fit } : null,
  ].filter((item): item is { reason: string; points: number | null } => item != null);
  if (!missing.length) return null;
  const points = missing.every((item) => item.points != null) ? missing.reduce((sum, item) => sum + item.points!, 0) : null;
  return (
    <div className="mt-3 rounded border border-[color-mix(in_srgb,var(--info-fill)_25%,transparent)] bg-[var(--info-tint)] px-3 py-3 text-sm" role="note">
      <p className="font-medium text-primary">
        {missing.length === 2 ? 'Fit with your business is left out of these scores' : 'Part of the fit with your business is left out of these scores'}
        {points != null ? ` (${points} of 100 points)` : ''}.
      </p>
      <ul className="mt-1 list-inside list-disc text-[var(--color-text-secondary)]">
        {missing.map((item) => <li key={item.reason}>{item.reason}</li>)}
      </ul>
      <p className="mt-1 text-[var(--color-text-secondary)]">
        Each score shares those points among the measures that have data. Add the missing figures to the product, then run Demand Discovery again to use all 100.
      </p>
      {productId ? (
        <Link href={`/app/products/${productId}/facts`} className={`${buttonClass('secondary', 'sm')} mt-2 inline-flex`}>
          Add product details
        </Link>
      ) : null}
    </div>
  );
}

const HANDED_OFF_FIRST = 10;

/**
 * E-045: India's own largest destinations for the product. Markets outside the top say why they rank
 * lower, in the run's own words; restricted or no ECGC cover, or a sanctions flag, is a separate note.
 */
export function IndiaMarkets({ markets }: { markets: IndiaMarket[] }) {
  if (!markets.length) return null;
  return (
    <section aria-labelledby="india-markets" className="mt-6 rounded-lg border border-[var(--color-border)] bg-surface p-4">
      <h3 id="india-markets" className="text-sm font-semibold text-primary">Where India already sells most</h3>
      <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">The markets that buy the most of this product from India. Markets ranked lower carry more risk or less opportunity for a new exporter; the reason is shown.</p>
      <ol className="mt-3 space-y-2">
        {markets.map((market, index) => (
          <li key={market.country_code} className="text-sm">
            <span className="font-medium text-primary">{index + 1}. {countryName(market.country_code)}</span>
            <span className="text-[var(--color-text-secondary)]">
              {market.rank != null ? ` · ranked #${market.rank}` : market.market_status === 'excluded' ? ' · excluded' : ' · not ranked'}
              {market.india_share_percent != null ? ` · India supplies ${market.india_share_percent.toFixed(1)}%` : ''}
            </span>
            {!market.in_top && market.reason ? <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">Ranked lower: {market.reason}</p> : null}
            {!market.in_top && market.explained_text ? (
              <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">Note: {market.explained_text.charAt(0).toUpperCase()}{market.explained_text.slice(1)}.</p>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function V5Results({ rows, notes, provenanceNote, exporterFit = null, productId = null, indiaMarkets = [] }: { rows: V5Row[]; notes: string[]; provenanceNote: string | null; exporterFit?: ExporterFitView | null; productId?: string | null; indiaMarkets?: IndiaMarket[] }) {
  const [showAll, setShowAll] = useState(false);
  const ranked = rows.filter((row) => row.market_status === 'ranked').sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  const notEnough = rows.filter((row) => row.market_status === 'not_enough_data');
  const noDemand = rows.filter((row) => row.market_status === 'no_recorded_demand');
  const excluded = rows.filter((row) => row.market_status === 'excluded');
  const handedOff = ranked.filter((row) => row.handed_off);
  const visible = showAll ? ranked : ranked.slice(0, Math.max(HANDED_OFF_FIRST, handedOff.length));

  return (
    <div>
      <p className="text-sm text-[var(--color-text-secondary)]">
        {ranked.length} of {rows.length} markets ranked.{' '}
        {handedOff.length ? `The top ${handedOff.length} go on to buyer search.` : null}
      </p>
      <div className="mt-1"><RupeeRateNote /></div>
      {exporterFit ? <ExporterFitPrompt fit={exporterFit} productId={productId} /> : null}

      {ranked.length ? (
        <ol className="mt-4 space-y-3">
          {visible.map((row) => (
            <li key={row.id}>
              <RankedCard row={row} />
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-4 text-sm text-[var(--color-text-secondary)]">
          No market has enough data to be ranked for this product yet.
        </p>
      )}
      {ranked.length > visible.length ? (
        <button type="button" onClick={() => setShowAll(true)} className="focus-visible-ring mt-3 text-sm font-semibold text-primary underline underline-offset-2">
          Show all {ranked.length} ranked markets
        </button>
      ) : null}

      <IndiaMarkets markets={indiaMarkets} />

      {notEnough.length || noDemand.length || excluded.length ? (
        <details className="mt-6 rounded-lg border border-[var(--color-border)] bg-surface p-4">
          <summary className="cursor-pointer text-sm font-semibold text-primary">
            Not ranked: {notEnough.length} without enough data, {noDemand.length} with no recorded imports, {excluded.length} excluded
          </summary>
          <ul className="mt-3 space-y-2 text-sm text-[var(--color-text-secondary)]">
            {excluded.map((row) => (
              <li key={row.id}>
                <span className="font-medium text-primary">{countryName(row.country_code)}</span> — {row.reasons[0]?.text ?? 'Excluded.'}
              </li>
            ))}
            {notEnough.map((row) => (
              <li key={row.id}>
                <span className="font-medium text-primary">{countryName(row.country_code)}</span>
                {row.overall_score != null ? ` · partial score ${row.overall_score}/100 on ${row.live_points} of 100 points` : null}
                {' — '}
                {row.reasons[0]?.text ?? 'Not enough data.'}
              </li>
            ))}
            {noDemand.length ? (
              <li>
                No recorded imports of this product: {noDemand.map((row) => countryName(row.country_code)).join(', ')}.
              </li>
            ) : null}
          </ul>
        </details>
      ) : null}

      {notes.length ? (
        <details className="mt-4 rounded border border-[color-mix(in_srgb,var(--info-fill)_25%,transparent)] bg-[var(--info-tint)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
          <summary className="cursor-pointer font-medium text-primary">What this run could not use</summary>
          <ul className="mt-2 list-inside list-disc space-y-1">
            {notes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        </details>
      ) : null}

      {provenanceNote ? (
        <p className="mt-4 rounded border border-[color-mix(in_srgb,var(--info-fill)_25%,transparent)] bg-[var(--info-tint)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
          {provenanceNote}
        </p>
      ) : null}
    </div>
  );
}
