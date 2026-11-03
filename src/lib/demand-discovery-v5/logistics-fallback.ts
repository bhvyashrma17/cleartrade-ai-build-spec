/**
 * Logistics where the World Bank has no logistics performance score (D-025, policy v5).
 *
 * The LPI covers about 140 economies; many small and island markets have none. UNCTAD's liner
 * shipping connectivity index (LSCI), as the World Bank republishes it (`wdi:IS.SHP.GCNW.XQ`, CC BY
 * 4.0), covers most coastal markets, including those. The two measure related things — how well a
 * market is served by trade logistics, and how well its ports are connected to world shipping — so
 * for a market with no LPI the score uses the LPI that the connectivity index predicts: an ordinary
 * least-squares line of LPI on ln(LSCI), fitted on this run's markets that have both. The prediction
 * is clamped to the LPI scale, labelled as an estimate, and carries a lower quality. Landlocked
 * markets have no LSCI and stay unscored. The fit is frozen into the run, so it can be reproduced.
 */
import type { DemandDiscoveryV5Policy } from './policy';

export interface LsciFit {
  intercept: number;
  slope: number;
  /** Markets with both values the line was fitted on. */
  pairs: number;
  r2: number;
}

export interface LogisticsEstimate {
  lsci: number;
  lsci_year: number;
  predicted_lpi: number;
  fit: LsciFit;
}

/** LPI on ln(LSCI), over markets with both; null below the policy's minimum number of pairs or without spread. */
export function fitLpiOnLsci(lpi: ReadonlyMap<string, number>, lsci: ReadonlyMap<string, { value: number; year: number }>, minimumPairs: number): LsciFit | null {
  const pairs: [number, number][] = [];
  for (const [market, y] of lpi) {
    const x = lsci.get(market);
    if (x && x.value > 0 && Number.isFinite(y)) pairs.push([Math.log(x.value), y]);
  }
  if (pairs.length < minimumPairs) return null;
  const n = pairs.length;
  const meanX = pairs.reduce((sum, [x]) => sum + x, 0) / n;
  const meanY = pairs.reduce((sum, [, y]) => sum + y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const [x, y] of pairs) {
    sxx += (x - meanX) ** 2;
    sxy += (x - meanX) * (y - meanY);
    syy += (y - meanY) ** 2;
  }
  if (!(sxx > 0) || !(syy > 0)) return null;
  const slope = sxy / sxx;
  return { intercept: meanY - slope * meanX, slope, pairs: n, r2: (sxy * sxy) / (sxx * syy) };
}

/** An estimate for every market without an LPI that has a connectivity value. */
export function logisticsEstimates(args: {
  markets: readonly string[];
  lpi: ReadonlyMap<string, number>;
  lsci: ReadonlyMap<string, { value: number; year: number }>;
  policy: DemandDiscoveryV5Policy;
}): { fit: LsciFit | null; estimates: Map<string, LogisticsEstimate> } {
  const estimates = new Map<string, LogisticsEstimate>();
  const fit = fitLpiOnLsci(args.lpi, args.lsci, args.policy.logistics.lsci_fallback_minimum_pairs);
  if (!fit) return { fit, estimates };
  const { lpi_min: min, lpi_max: max } = args.policy.logistics;
  for (const market of args.markets) {
    if (args.lpi.has(market)) continue;
    const connectivity = args.lsci.get(market);
    if (!connectivity || !(connectivity.value > 0)) continue;
    const predicted = Math.min(max, Math.max(min, fit.intercept + fit.slope * Math.log(connectivity.value)));
    estimates.set(market, { lsci: connectivity.value, lsci_year: connectivity.year, predicted_lpi: predicted, fit });
  }
  return { fit, estimates };
}
