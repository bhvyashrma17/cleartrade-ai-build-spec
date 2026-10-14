'use client';

/**
 * Demand Discovery v5 results (docs/36 §5–§6): every screening market, ranked where the data
 * allows, each with its labels and the reasons behind its score.
 *
 * The ranked list leads with the markets handed on to buyer search. Markets that could not be
 * ranked are listed apart with why — "not enough data" is a gap, not a low score, and is never
 * mixed into the ranking. Labels carry text and an icon; colour is never the only cue (docs/10 §4).
 */

import Link from 'next/link';
import { useState } from 'react';
import { RupeeRateNote, useRupees } from '@/components/fx/RupeeRate';
import { StatusChip } from '@/components/ui';
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

const HANDED_OFF_FIRST = 10;

export function V5Results({ rows, notes, provenanceNote }: { rows: V5Row[]; notes: string[]; provenanceNote: string | null }) {
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
