'use client';

/**
 * EXP-05 for a Demand Discovery v5 assessment (docs/36 §4–§6): where the market stands, then the
 * five parts and twelve measures behind its score. A measure without data says so and why; it is
 * never shown as a zero. Each live measure states the observed figure in plain words.
 */

import { RupeeRateNote, useRupees } from '@/components/fx/RupeeRate';
import { StatusChip } from '@/components/ui';
import type { V5Detail } from '@/lib/demand-discovery-v5/detail';
import { metricSentence } from '@/lib/demand-discovery-v5/explain';
import type { MetricResult } from '@/lib/demand-discovery-v5/metrics';
import { V5Labels, V5Reasons } from '../V5Results';

export type { V5Detail };

const PART_NAMES: Record<string, string> = {
  demand: 'Demand', india_opportunity: "India's opportunity", access: 'Access', risk: 'Risk', exporter_fit: 'Fit with your business',
};
const PART_METRICS: Record<string, string[]> = {
  demand: ['market_size', 'growth', 'stability'], india_opportunity: ['india_foothold', 'price_headroom', 'openness'],
  access: ['duty', 'distance_fit', 'logistics'], risk: ['country_risk'], exporter_fit: ['price_fit', 'volume_fit'],
};
const METRIC_NAMES: Record<string, string> = {
  market_size: 'Market size', growth: 'Growth', stability: 'Steadiness', india_foothold: "India's foothold",
  price_headroom: "Price against India's usual price", openness: 'Open to new suppliers', duty: 'Duty on Indian goods',
  distance_fit: 'Distance', logistics: 'Logistics', country_risk: 'Payment risk (ECGC)', price_fit: 'Your price against this market',
  volume_fit: 'Your capacity against this market',
};

function StatusLine({ detail }: { detail: V5Detail }) {
  if (detail.market_status === 'ranked') {
    return (
      <p className="text-sm text-[var(--color-text-secondary)]">
        Ranked <span className="font-semibold text-primary">#{detail.rank}</span> of {detail.total_ranked} · {detail.overall_score}/100 · confidence {detail.confidence_score}%
        {detail.data_year ? ` · data to ${detail.data_year}` : ''}
        {detail.handed_off ? ' · goes on to buyer search' : ''}
      </p>
    );
  }
  const label = detail.market_status === 'excluded' ? 'Excluded' : detail.market_status === 'no_recorded_demand' ? 'No recorded imports' : 'Not ranked — not enough data';
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-text-secondary)]">
      <StatusChip label={label} tone={detail.market_status === 'excluded' ? 'critical' : 'neutral'} icon={detail.market_status === 'excluded' ? 'block' : 'dot'} size="sm" />
      {detail.market_status === 'not_enough_data' && detail.overall_score != null ? <span>Partial score {detail.overall_score}/100 on {detail.live_points} of 100 points</span> : null}
    </div>
  );
}

/** Agent view only (D-024): where to read this market's official tariff when the duty is estimated or missing. */
export interface ManualTariffCheck { authority: string; source_url: string | null; note: string }

function ManualTariffLine({ check }: { check: ManualTariffCheck }) {
  return (
    <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
      Official tariff to check: {check.source_url ? (
        <a href={check.source_url} target="_blank" rel="noopener noreferrer" className="focus-visible-ring rounded font-medium text-primary underline underline-offset-2">{check.authority}</a>
      ) : <span className="font-medium text-primary">{check.authority}</span>}. {check.note}
    </p>
  );
}

export function V5Breakdown({ detail, manualTariff = null }: { detail: V5Detail; manualTariff?: ManualTariffCheck | null }) {
  const rupees = useRupees();
  const metrics = new Map(detail.metrics.map((metric) => [metric.key, metric]));
  return (
    <section className="mt-6">
      <StatusLine detail={detail} />
      <div className="mt-1"><RupeeRateNote /></div>
      {detail.flag_reasons.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {detail.flag_reasons.map((reason) => <StatusChip key={reason} label={reason} tone="warning" icon="alert" size="sm" />)}
        </div>
      ) : null}
      <V5Labels labels={detail.labels} />
      <V5Reasons reasons={detail.reasons} />

      {detail.parts.length ? (
        <div className="mt-6 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">How the score is made</h2>
          {detail.parts.map((part) => (
            <div key={part.part} className="rounded-lg border border-[var(--color-border)] bg-surface p-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-semibold text-primary">{PART_NAMES[part.part] ?? part.part}</h3>
                <span className="text-sm text-primary">
                  {part.score == null ? 'No data' : `${Math.round(part.score)}/100`}
                  <span className="ml-2 text-xs text-[var(--color-text-secondary)]">{part.points} points</span>
                </span>
              </div>
              <ul className="mt-3 space-y-2">
                {(PART_METRICS[part.part] ?? []).map((key) => {
                  const metric = metrics.get(key as MetricResult['key']);
                  if (!metric) return null;
                  return (
                    <li key={key} className="text-sm">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-medium text-primary">
                          {METRIC_NAMES[key] ?? key}
                          {metric.estimated ? <span className="ml-2"><StatusChip label="Estimated" tone="info" icon="dot" size="sm" /></span> : null}
                        </span>
                        <span className="shrink-0 text-xs text-[var(--color-text-secondary)]">{metric.score == null ? 'No data' : `${Math.round(metric.score)}/100`}</span>
                      </div>
                      <p className="mt-0.5 text-[var(--color-text-secondary)]">{metric.score == null ? metric.reason : rupees(metricSentence(metric))}</p>
                      {key === 'duty' && manualTariff ? <ManualTariffLine check={manualTariff} /> : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <p className="text-xs text-[var(--color-text-muted)]">
            Measures without data are left out and their points shared among the rest; a gap is never counted as zero.
          </p>
        </div>
      ) : null}
    </section>
  );
}
