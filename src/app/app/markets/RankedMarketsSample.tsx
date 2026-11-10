/**
 * The Demand Discovery sample, shown to visitors and free accounts on `/app/markets`.
 *
 * Every value rendered here is a constant from `src/lib/billing/preview.ts`: one real Demand
 * Discovery result, frozen on the day it was run (D-039, E-055). This component performs no
 * fetch, takes no props from the tenant, and cannot reach the warehouse, the discovery engine or
 * any provider — so nobody's visit spends anything, and nothing here is about the visitor's own
 * product.
 *
 * The cards are laid out like the member's real ranked list (`V5Results`): rank, country, score
 * and confidence, the labels and the reasons, in the engine's own words.
 */

import { SamplePanel } from '@/components/ui';
import { countryName, V5Labels, V5Reasons } from './V5Results';
import { SAMPLE_DISCLAIMER, SAMPLE_MARKETS, SAMPLE_RANKED_TOTAL, SAMPLE_REGIONS, SAMPLE_RUN } from '@/lib/billing/preview';

export function RankedMarketsSample() {
  const more = SAMPLE_RANKED_TOTAL - SAMPLE_MARKETS.length;
  return (
    <div className="space-y-6">
      <SamplePanel
        title="Ranked Demand Discovery"
        subject={`${SAMPLE_RUN.product} · HS ${SAMPLE_RUN.hs_code} · run on ${SAMPLE_RUN.run_on}`}
        disclaimer={SAMPLE_DISCLAIMER}
        lockedSummary={more > 0 ? `${more} more ranked markets are in this run's full result` : undefined}
      >
        <ul className="space-y-3">
          {SAMPLE_MARKETS.map((market) => (
            <li key={market.country_code} className="rounded-md border border-line bg-surface-2 p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium text-bone">
                  {market.rank}. {countryName(market.country_code)}
                  {market.data_year ? <span className="ml-2 text-xs font-normal text-faint">data to {market.data_year}</span> : null}
                </p>
                <div className="shrink-0 text-right">
                  <p className="text-sm text-bone">
                    <span className="font-mono">{market.score}</span>
                    <span className="ml-1 text-xs text-muted">/ 100</span>
                  </p>
                  <p className="text-xs text-muted">Confidence {market.confidence}%</p>
                </div>
              </div>
              <V5Labels labels={[...market.labels]} />
              <V5Reasons reasons={[...market.reasons]} />
            </li>
          ))}
        </ul>
      </SamplePanel>

      {SAMPLE_REGIONS ? (
        <SamplePanel
          title={`Regional demand in ${countryName(SAMPLE_REGIONS.country_code)}`}
          subject={`${SAMPLE_RUN.product} · HS ${SAMPLE_RUN.hs_code} · run on ${SAMPLE_RUN.run_on}`}
          disclaimer={SAMPLE_DISCLAIMER}
          lockedSummary={SAMPLE_REGIONS.more > 0 ? `${SAMPLE_REGIONS.more} more regions in this run's full result` : undefined}
        >
          <p className="mb-3 text-xs text-muted">{SAMPLE_REGIONS.basis}</p>
          <ul className="divide-y divide-line">
            {SAMPLE_REGIONS.rows.map((region) => (
              <li key={region.name} className="flex flex-wrap items-center justify-between gap-3 py-2 first:pt-0">
                <p className="text-sm text-bone">{region.name}</p>
                <p className="shrink-0 text-sm text-muted">{region.value}</p>
              </li>
            ))}
          </ul>
        </SamplePanel>
      ) : null}
    </div>
  );
}
