'use client';

/**
 * The ranked market list, plus comparison selection.
 *
 * Attractiveness and evidence confidence are rendered in deliberately different vocabularies —
 * a large numeral for the score, a small labelled meter for confidence — because they answer
 * different questions and a reader who conflates them will misread every card on the page. The
 * confidence figure always travels with the sentence explaining what it is not.
 *
 * Rows become cards below `sm`. Nothing is dropped at narrow widths: an SME exporter on a phone
 * gets the same facts, stacked.
 */

import { useState } from 'react';
import Link from 'next/link';
import { buttonClass, Card, EmptyState, SectionHeading, StatusChip } from '@/components/ui';
import { CONFIDENCE_MEANING } from '@/lib/country-discovery/explanations';
import type { MarketResultsView } from '@/lib/country-discovery/service';
import type { ProductDiscoveryState } from '@/lib/country-discovery/service';

const MAX_COMPARE = 3;

export function MarketResults({
  productId,
  results,
  screening,
}: {
  productId: string;
  results: MarketResultsView;
  screening: ProductDiscoveryState['screening'];
}) {
  const [selected, setSelected] = useState<string[]>([]);

  function toggle(code: string) {
    setSelected((current) =>
      current.includes(code)
        ? current.filter((entry) => entry !== code)
        : current.length >= MAX_COMPARE
          ? current
          : [...current, code],
    );
  }

  if (!results.markets.length) {
    return (
      <EmptyState
        title={screening.state === 'completed' ? 'Detailed analysis has not run yet' : 'No market analysis yet'}
        description={
          screening.state === 'completed'
            ? `${screening.shortlist_size ?? 0} markets have been shortlisted. ClearTrade is preparing the detailed analysis for them.`
            : 'Run a market scan from the product page to see recommended markets.'
        }
        action={
          <Link href={`/app/products/${productId}`} className={buttonClass('primary', 'md')}>
            Back to product
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate">
          {results.markets.length} {results.markets.length === 1 ? 'market' : 'markets'} analysed
          {results.run ? ` · Analysis generated ${new Date(results.run.generated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
        </p>
        {selected.length > 0 ? (
          <Link
            href={`/app/products/${productId}/markets/compare?countries=${selected.join(',')}`}
            className={buttonClass('primary', 'sm')}
          >
            Compare {selected.length} {selected.length === 1 ? 'market' : 'markets'}
          </Link>
        ) : (
          <p className="text-xs text-muted">Select up to {MAX_COMPARE} markets to compare.</p>
        )}
      </div>

      <ul className="space-y-3">
        {results.markets.map((market) => {
          const checked = selected.includes(market.country_code);
          const atLimit = !checked && selected.length >= MAX_COMPARE;
          return (
            <li key={market.country_code}>
              <Card as="article">
                <div className="flex flex-wrap items-start gap-4">
                  <div className="flex min-w-0 flex-1 items-start gap-4">
                    <div className="shrink-0 text-center">
                      <p className="text-xs text-muted">Rank</p>
                      <p className="text-lg font-medium text-bone">#{market.rank}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="text-base font-medium text-bone">
                        <Link href={`/app/products/${productId}/markets/${market.country_code}`} className="hover:underline">
                          {market.country}
                        </Link>
                      </h2>
                      <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                        <div>
                          <dt className="text-xs text-muted">Import market</dt>
                          <dd className="text-bone">{market.market_size.display ?? 'Not established'}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted">Growth (past)</dt>
                          <dd className="text-bone">
                            {market.growth.display ? `${market.growth.display} a year` : 'Not established'}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted">India&rsquo;s share</dt>
                          <dd className="text-bone">{market.india_share.display ?? 'Not established'}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted">Trade data</dt>
                          <dd className="text-bone">{market.trade_periods ?? 'Not established'}</dd>
                        </div>
                      </dl>
                      {market.stands_out ? (
                        <p className="mt-3 text-sm text-bone">
                          <span className="text-xs uppercase tracking-wide text-muted">Why it stands out · </span>
                          {market.stands_out}
                        </p>
                      ) : null}
                      {market.can_improve ? (
                        <p className="mt-1 text-sm text-slate">
                          <span className="text-xs uppercase tracking-wide text-muted">Analysis can improve · </span>
                          {market.can_improve}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <div className="text-right">
                      <p className="text-xs text-muted">Attractiveness</p>
                      {market.attractiveness == null ? (
                        <p className="text-sm text-slate">Not rankable</p>
                      ) : (
                        <p className="text-2xl font-medium text-bone">{market.attractiveness}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted">Evidence confidence</p>
                      <p className="text-sm text-bone" title={CONFIDENCE_MEANING}>
                        {market.evidence_confidence}%
                      </p>
                    </div>
                    {market.is_selected ? <StatusChip label="Your target market" tone="positive" icon="check" size="sm" /> : null}
                    <label className="flex items-center gap-2 text-xs text-slate">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={atLimit}
                        onChange={() => toggle(market.country_code)}
                        aria-label={`Compare ${market.country}`}
                      />
                      Compare
                    </label>
                  </div>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-muted">{CONFIDENCE_MEANING}</p>

      {results.awaiting_analysis.length > 0 ? (
        <Card tone="bare">
          <SectionHeading title="Shortlisted, analysis pending" />
          <p className="mt-2 text-sm text-slate">
            These markets were shortlisted by the scan but do not have detailed analysis yet.
          </p>
          <p className="mt-2 text-sm text-bone">
            {results.awaiting_analysis.map((entry) => entry.country).join(', ')}
          </p>
        </Card>
      ) : null}
    </div>
  );
}
