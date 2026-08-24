/**
 * The Demand Discovery demo, shown to guest and free tiers under their market estimate.
 *
 * Every value rendered here is a constant from `src/lib/billing/preview.ts`. This
 * component performs no fetch, takes no props from the tenant, and cannot reach the
 * warehouse, the discovery engine or any provider — which is the point: a free member sees
 * exactly what ranked discovery produces without a single credit being spent on their
 * behalf, and without any risk of an illustrative figure being mistaken for a fact about
 * their own product.
 *
 * The shape deliberately mirrors the real ranked table (rank, country, score, component
 * bands, rationale) so the demo is a fair representation of the product rather than a
 * flattering mock-up of something that does not exist.
 */

import { SamplePanel } from '@/components/ui';
import {
  PREVIEW_LOCKED_MARKET_COUNT,
  PREVIEW_MARKETS,
  PREVIEW_PRODUCT_LABEL,
  SAMPLE_DISCLAIMER,
} from '@/lib/billing/preview';

const BAND_CLASS: Record<string, string> = {
  strong: 'text-[var(--ok)]',
  moderate: 'text-[var(--warn)]',
  weak: 'text-muted',
  unknown: 'text-faint',
};

export function RankedMarketsSample() {
  return (
    <SamplePanel
      title="Ranked Demand Discovery"
      subject={PREVIEW_PRODUCT_LABEL}
      disclaimer={SAMPLE_DISCLAIMER}
      lockedSummary={`${PREVIEW_LOCKED_MARKET_COUNT} more ranked markets are in the full result`}
    >
      <ul className="space-y-3">
        {PREVIEW_MARKETS.map((market) => (
          <li key={market.country_code} className="rounded-md border border-line bg-surface-2 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-bone">
                <span className="mr-2 font-mono text-xs text-faint">
                  {String(market.rank).padStart(2, '0')}
                </span>
                {market.country_name}
              </p>
              <p className="text-sm text-bone">
                <span className="font-mono">{market.score}</span>
                <span className="ml-1 text-xs text-muted">/ 100</span>
              </p>
            </div>

            <p className="mt-2 text-sm text-muted text-pretty">{market.rationale}</p>

            <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
              {market.components.map((component) => (
                <div key={component.label} className="flex items-baseline gap-1.5 text-xs">
                  <dt className="text-faint">{component.label}</dt>
                  {/* The band is a word, not a colour — colour is the third cue only. */}
                  <dd className={BAND_CLASS[component.band]}>{component.band}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </SamplePanel>
  );
}
