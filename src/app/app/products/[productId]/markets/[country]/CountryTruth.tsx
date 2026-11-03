'use client';

/**
 * The country detail: overall, the eight pillars, deterministic reasons, and what to do next.
 *
 * Three separate clocks appear on this page and are never conflated, because merging them is
 * how a 2025 trade statistic starts reading as today's market:
 *
 *   - **Trade data period** — the years the destination's customs data covers.
 *   - **Analysis generated** — when ClearTrade computed this assessment.
 *   - **Evidence observed** — when a tariff, rate or quote was read (shown per pillar).
 */

import Link from 'next/link';
import { buttonClass, Card, SectionHeading, StatusChip } from '@/components/ui';
import { InfoTooltip } from '@/components/discovery';
import { ATTRACTIVENESS_MEANING, CONFIDENCE_MEANING } from '@/lib/country-discovery/explanations';
import type { CountryDetailView } from '@/lib/country-discovery/service';
import { SelectMarket } from './SelectMarket';

const KIND_STYLE = {
  signal: { label: 'Strong signal', tone: 'positive' as const, icon: 'check' as const },
  caution: { label: 'Caution', tone: 'warning' as const, icon: 'alert' as const },
  gap: { label: 'Evidence gap', tone: 'neutral' as const, icon: 'dot' as const },
};

function formatDate(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function CountryTruth({
  productId,
  exporterOrgId,
  detail,
  basePath = '/app/products',
}: {
  productId: string;
  exporterOrgId: string;
  detail: CountryDetailView;
  /** Lets the agent surface reuse this component under its own route tree. */
  basePath?: string;
}) {
  const { market, classification, improve } = detail;

  return (
    <div className="space-y-6">
      {detail.refresh_available ? (
        <Card tone="raised">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-bone">New information is available</p>
              <p className="mt-1 text-sm text-slate">
                Product details have changed since this analysis was generated. This page still shows the
                analysis as it stood on {formatDate(market.generated_at)}.
              </p>
            </div>
            <Link href={`${basePath}/${productId}`} className={buttonClass('secondary', 'sm')}>
              Refresh analysis
            </Link>
          </div>
        </Card>
      ) : null}

      {/* --- Overall ------------------------------------------------------- */}
      <Card ticked>
        <SectionHeading title="Overall" />
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted">Attractiveness</p>
            {market.attractiveness == null ? (
              <p className="text-lg text-slate">Not rankable</p>
            ) : (
              <p className="text-3xl font-medium text-bone">{market.attractiveness}</p>
            )}
            <p className="mt-1 text-xs text-muted">{ATTRACTIVENESS_MEANING}</p>
          </div>
          <div>
            <span className="flex items-center gap-1.5 text-xs text-muted">
              Evidence coverage
              <InfoTooltip label="What evidence coverage means">{CONFIDENCE_MEANING}</InfoTooltip>
            </span>
            <p className="text-3xl font-medium text-bone">{market.evidence_confidence}%</p>
            <p className="mt-1 text-xs text-muted">{CONFIDENCE_MEANING}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Rank</p>
            <p className="text-3xl font-medium text-bone">#{market.rank}</p>
            <p className="mt-1 text-xs text-muted">Among the markets analysed for this product.</p>
          </div>
        </div>
        <dl className="mt-4 grid gap-x-6 gap-y-1 border-t border-line pt-3 text-xs sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="text-muted">Trade data period</dt>
            <dd className="text-slate">{market.trade_periods ?? 'Not established'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted">Analysis generated</dt>
            <dd className="text-slate">{formatDate(market.generated_at)}</dd>
          </div>
        </dl>
        <div className="mt-4">
          <SelectMarket
            exporterOrgId={exporterOrgId}
            assessmentId={market.assessment_id}
            country={market.country}
            initiallySelected={market.is_selected}
          />
        </div>
      </Card>

      {/* --- Why this market ------------------------------------------------ */}
      <Card>
        <SectionHeading title="Why this market" description="Drawn directly from the evidence on file — no interpretation added." />
        <ul className="mt-3 space-y-3">
          {detail.explanations.map((entry) => {
            const style = KIND_STYLE[entry.kind];
            return (
              <li key={entry.code} className="border-b border-line pb-3 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip label={style.label} tone={style.tone} icon={style.icon} size="sm" />
                  <p className="text-sm font-medium text-bone">{entry.headline}</p>
                </div>
                <p className="mt-1 text-sm text-slate">{entry.detail}</p>
              </li>
            );
          })}
        </ul>
      </Card>

      {/* --- Pillars -------------------------------------------------------- */}
      <Card>
        <SectionHeading
          title="What makes up this score"
          description="A pillar with no score has not been measured. It is never counted as zero."
        />
        <ul className="mt-3 space-y-2">
          {market.pillars.map((pillar) => (
            <li key={pillar.key} className="flex flex-wrap items-start justify-between gap-3 border-b border-line py-3 last:border-0">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-bone">{pillar.label}</p>
                {pillar.state === 'not_established' ? (
                  <p className="mt-1 text-sm text-slate">{pillar.not_established_because}</p>
                ) : (
                  <p className="mt-1 text-xs text-muted">
                    Evidence coverage for this pillar: {pillar.confidence}%
                  </p>
                )}
              </div>
              <div className="shrink-0 text-right">
                {pillar.state === 'available' ? (
                  <p className="text-xl font-medium text-bone">{pillar.score}</p>
                ) : (
                  <StatusChip label="Not assessed yet" tone="neutral" icon="dot" size="sm" />
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {/* Staff-only canonical confidence audit. `countryDetail` omits it for exporters. */}
      {detail.confidence_ledger ? (
        <Card>
          <SectionHeading
            title="Evidence coverage audit"
            description={`${detail.confidence_ledger.coverage_before_freshness}% coverage × ${detail.confidence_ledger.freshness_multiplier.toFixed(4)} freshness = ${detail.confidence_ledger.calculated_confidence}%. Stored: ${detail.confidence_ledger.stored_confidence}%.`}
          />
          <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Evidence coverage contribution ledger">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="border-b border-line text-muted">
                <tr>
                  <th className="py-2 pr-3">Component</th>
                  <th className="py-2 pr-3 text-right">Base</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3 text-right">Coverage</th>
                  <th className="py-2 pr-3 text-right">Freshness</th>
                  <th className="py-2 text-right">Contribution</th>
                </tr>
              </thead>
              <tbody>
                {detail.confidence_ledger.components.map((component) => (
                  <tr key={component.key} className="border-b border-line align-top last:border-0">
                    <td className="py-2 pr-3">
                      <span className="font-medium text-bone">{component.label}</span>
                      {component.exact_missing_evidence.length ? (
                        <ul className="mt-1 space-y-1 text-muted">
                          {component.exact_missing_evidence.map((missing) => (
                            <li key={missing.code}>− {missing.label} ({missing.owners.join(', ').replaceAll('_', ' ')})</li>
                          ))}
                        </ul>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 text-right">{component.base_weight}</td>
                    <td className="py-2 pr-3">{component.status}</td>
                    <td className="py-2 pr-3 text-right">{component.evidence_coverage}%</td>
                    <td className="py-2 pr-3 text-right">{component.freshness_multiplier.toFixed(4)}</td>
                    <td className="py-2 text-right">{component.effective_contribution}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 rounded-md border border-line bg-surface-2 p-3 text-xs text-slate">
            <p className="font-medium text-bone">Exporter-data ceiling</p>
            <p className="mt-1">
              Currently {detail.confidence_ledger.exporter_data_ceiling.current}%. Missing exporter facts potentially unlock up to{' '}
              {detail.confidence_ledger.exporter_data_ceiling.potentially_unlocks_up_to_weight} weight (conditional upper bound{' '}
              {detail.confidence_ledger.exporter_data_ceiling.conditional_upper_bound}%).
            </p>
            <p className="mt-1 text-muted">{detail.confidence_ledger.exporter_data_ceiling.explanation}</p>
          </div>
          {!detail.confidence_ledger.reconciles ? (
            <p className="mt-3 text-sm text-[var(--color-critical-text)]" role="alert">
              Stored confidence does not reconcile with the frozen component ledger.
            </p>
          ) : null}
        </Card>
      ) : null}

      {/* --- Classification ------------------------------------------------- */}
      {classification.state === 'questions' || classification.state === 'resolved' || classification.state === 'agent_classification_required' ? (
        <Card>
          <SectionHeading title="Tariff & classification" />
          {/*
            The distinction this section exists to hold: the general/third-country duty can be
            understood from official data (every declarable line in this destination carrying the
            same treatment, or one line already established) even while the EXACT customs line for
            THIS product is still unresolved. Showing only the classification gap would read as
            "Market Access has no evidence at all" when in fact the tariff itself is known and only
            the product-specific line remains open.
          */}
          {classification.source ? (
            <div className="mt-2 flex items-center gap-2">
              <StatusChip label="Tariff treatment available" tone="positive" icon="check" size="sm" />
              <span className="text-xs text-muted">from official {classification.source.authority} data</span>
            </div>
          ) : null}

          {classification.state === 'resolved' ? (
            <div className="mt-3 space-y-2">
              <StatusChip label="Product classification narrowed" tone="positive" icon="check" size="sm" />
              <p className="text-sm text-bone">
                ClearTrade has identified the destination tariff line for your product.
              </p>
              <p className="text-sm text-slate">{classification.resolved_line?.description}</p>
              <p className="text-xs text-muted">
                Verification status: {classification.resolved_line?.verification}
              </p>
            </div>
          ) : classification.state === 'agent_classification_required' ? (
            <div className="mt-3 space-y-2">
              <p className="text-sm font-medium text-bone">Complete product classification</p>
              <StatusChip label="ClearTrade action required" tone="info" icon="clock" size="sm" />
              <p className="text-sm text-slate">
                Your product could fall under {classification.remaining} different tariff lines in{' '}
                {market.country}, and the destination&rsquo;s published descriptions do not contain a
                distinction we can turn into a question for you. A ClearTrade specialist will establish
                the correct line.
              </p>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <p className="text-sm font-medium text-bone">Complete product classification</p>
              <p className="text-sm text-slate">
                ClearTrade needs {classification.questions.length}{' '}
                {classification.questions.length === 1 ? 'product detail' : 'product details'} before the
                exact customs classification in {market.country} can be confirmed.
              </p>
              <Link
                href={`${basePath}/${productId}/markets/${market.country_code}/classification`}
                className={buttonClass('primary', 'sm')}
              >
                Answer {classification.questions.length}{' '}
                {classification.questions.length === 1 ? 'question' : 'questions'}
              </Link>
            </div>
          )}
        </Card>
      ) : null}

      {/* --- Improve this analysis ------------------------------------------ */}
      {improve.actions.length > 0 ? (
        <Card>
          <SectionHeading
            title="Improve this analysis"
            description={`Evidence coverage is ${improve.evidence_confidence}%. These are the specific things that would raise it.`}
          />
          <ul className="mt-3 space-y-2">
            {improve.actions.map((action) => (
              <li key={action.code} className="flex flex-wrap items-start justify-between gap-3 border-b border-line py-3 last:border-0">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-bone">{action.label}</p>
                  <p className="mt-1 text-sm text-slate">{action.detail}</p>
                  <p className="mt-1 text-xs text-muted">Unlocks: {action.unlocks}</p>
                </div>
                <div className="shrink-0">
                  {action.owner === 'cleartrade' ? (
                    <StatusChip label="ClearTrade action required" tone="info" icon="clock" size="sm" />
                  ) : action.href ? (
                    <Link href={action.href} className={buttonClass('secondary', 'sm')}>
                      Add
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
