/**
 * Owner-approved idea 3 (E-042): a one-off health check of the scoring across India's export sectors.
 * India's top export products by value in the newest BACI year are each scored as a v5 run would
 * score them, from stored data only, and each top 10 is compared with India's own top destinations
 * (docs/36 §8). No Comtrade calls, no tariff look-ups, no FX fetches; nothing is written. The summary
 * gives passes, the median overlap, results by HS chapter, and the markets missed most often: where
 * the score keeps undervaluing demand India already serves.
 */
import type { DemandDiscoveryV5Config } from '@/lib/config';
import type { DocumentStorage } from '@/lib/document-storage';
import { getDocumentStorage } from '@/lib/document-storage';
import { prisma } from '@/lib/prisma';
import { BACI_PROVIDER, type BaciFlow } from '@/lib/trade-datasets/baci';
import { readPartitionFlows } from '@/lib/trade-datasets/partitions';
import { latestReadyTradeDatasetRelease } from '@/lib/trade-datasets/service';
import { assessMarkets } from './assess';
import { compareWithIndiaExports } from './calibration';
import { loadRunInputs, type V5ProductFacts } from './run-inputs';

/** India's export value by HS6 in the flows given, largest first. Pure; values in USD. */
export function rankIndiaExports(flows: readonly BaciFlow[], indiaCode: string, top: number): { hs6: string; india_usd: number }[] {
  const byProduct = new Map<string, number>();
  for (const flow of flows) if (flow.exporter === indiaCode) byProduct.set(flow.product, (byProduct.get(flow.product) ?? 0) + flow.value_kusd * 1000);
  return [...byProduct.entries()].sort(([a, va], [b, vb]) => vb - va || a.localeCompare(b)).slice(0, top).map(([hs6, usd]) => ({ hs6, india_usd: Math.round(usd) }));
}

/** India's top export products in one year of the newest ready HS 2022 release: every chapter partition is read. */
export async function indiaTopExports(args: { top: number; year?: number; storage?: DocumentStorage }) {
  const release = await latestReadyTradeDatasetRelease(BACI_PROVIDER, 'HS22');
  if (!release) throw new Error('No ready CEPII BACI HS22 release in this environment.');
  const year = args.year ?? release.last_year;
  const india = await prisma.tradeDatasetCountry.findFirst({ where: { release_id: release.id, iso2: 'IN' }, select: { provider_code: true } });
  if (!india) throw new Error(`Release ${release.id} has no country row for India.`);
  const partitions = await prisma.tradeDatasetPartition.findMany({ where: { release_id: release.id, year }, orderBy: { hs_chapter: 'asc' } });
  const storage = args.storage ?? getDocumentStorage();
  const totals: BaciFlow[] = [];
  for (const partition of partitions) {
    const flows = readPartitionFlows({ bytes: await storage.get(partition.object_key), expected_sha256: partition.sha256, year, label: `${release.id}/${year}/${partition.hs_chapter}` });
    // Keep only India's rows: a whole chapter can hold a million flows.
    for (const flow of flows) if (flow.exporter === india.provider_code) totals.push(flow);
  }
  return { release_id: release.id, dataset_version: release.dataset_version, year, products: rankIndiaExports(totals, india.provider_code, args.top) };
}

export interface HealthCheckProduct {
  hs6: string;
  india_usd: number;
  /** `failed`: the product could not be scored; `error` says why. */
  status: 'compared' | 'failed';
  error?: string;
  verdict?: 'pass' | 'calibration_failure' | 'no_india_exports';
  overlap?: number;
  top?: number;
  run_top?: string[];
  india_top?: string[];
  missed?: { market: string; rank: number | null; status: string | null; reasons: string[] }[];
}

const NO_EXPORTER_FACTS: V5ProductFacts = {
  price_target_amount: null, price_target_currency: null, price_target_quantity_unit: null, price_target_incoterm: null,
  unit_net_weight_value: null, unit_net_weight_unit: null, capacity_value: null, capacity_unit: null, capacity_period: null,
};

/** The run's own switches, with every provider call off: the check reads stored data and writes nothing. */
export const offlineConfig = (config: DemandDiscoveryV5Config): DemandDiscoveryV5Config => ({
  ...config, comtrade_newest_year: false, comtrade_market_fallback: false, tariff_acquisition: false, fx_fetch_missing: false, fx_treasury_fallback: false,
});

/** One product scored as a run would score it, without the exporter's own figures, then compared. */
export async function scoreProductOffline(product: { hs6: string; india_usd: number }, args: { as_of: Date; exporter_org_id: string; config: DemandDiscoveryV5Config; storage?: DocumentStorage }): Promise<HealthCheckProduct> {
  try {
    const config = offlineConfig(args.config);
    const loaded = await loadRunInputs({
      hs6: product.hs6, as_of: args.as_of, product: NO_EXPORTER_FACTS, config, storage: args.storage, exporter_org_id: args.exporter_org_id,
      hs_revision: 'HS2022', job_id: 'health-check', correlation_id: `health-check:${product.hs6}`,
    });
    const result = assessMarkets(loaded.input);
    const base = loaded.input.base;
    if (!base) return { ...product, status: 'failed', error: 'No BACI flows for this code.' };
    const comparison = compareWithIndiaExports({
      hs6: product.hs6, flows: base.flows, years: base.years.slice(-config.policy.size.average_years),
      markets: result.markets.map((market) => ({ market: market.market, status: market.status, rank: market.rank, overall: market.overall, reasons: market.reasons.map((reason) => reason.text) })),
    });
    return {
      ...product, status: 'compared', verdict: comparison.verdict, overlap: comparison.overlap, top: comparison.top,
      run_top: comparison.run_top.map((entry) => entry.market), india_top: comparison.india_top.map((entry) => entry.market),
      missed: comparison.missed.map((entry) => ({ market: entry.market, rank: entry.rank, status: entry.status, reasons: entry.reasons })),
    };
  } catch (error) {
    return { ...product, status: 'failed', error: (error instanceof Error ? error.message : String(error)).slice(0, 300) };
  }
}

export interface HealthCheckSummary {
  products: number;
  compared: number;
  failed: number;
  pass: number;
  calibration_failure: number;
  no_india_exports: number;
  median_overlap: number | null;
  /** By HS chapter: compared and passing products. */
  by_chapter: Record<string, { compared: number; pass: number }>;
  /** Markets most often among India's top destinations but outside the run's top 10, with how often. */
  most_missed: { market: string; products: number }[];
}

export function summarizeHealthCheck(items: readonly HealthCheckProduct[]): HealthCheckSummary {
  const compared = items.filter((item) => item.status === 'compared');
  const overlaps = compared.filter((item) => item.verdict !== 'no_india_exports').map((item) => item.overlap ?? 0).sort((a, b) => a - b);
  const middle = Math.floor(overlaps.length / 2);
  const byChapter: Record<string, { compared: number; pass: number }> = {};
  const missed = new Map<string, number>();
  for (const item of compared) {
    const chapter = item.hs6.slice(0, 2);
    byChapter[chapter] ??= { compared: 0, pass: 0 };
    byChapter[chapter].compared += 1;
    if (item.verdict === 'pass') byChapter[chapter].pass += 1;
    for (const entry of item.missed ?? []) missed.set(entry.market, (missed.get(entry.market) ?? 0) + 1);
  }
  return {
    products: items.length,
    compared: compared.length,
    failed: items.length - compared.length,
    pass: compared.filter((item) => item.verdict === 'pass').length,
    calibration_failure: compared.filter((item) => item.verdict === 'calibration_failure').length,
    no_india_exports: compared.filter((item) => item.verdict === 'no_india_exports').length,
    median_overlap: !overlaps.length ? null : overlaps.length % 2 ? overlaps[middle]! : (overlaps[middle - 1]! + overlaps[middle]!) / 2,
    by_chapter: Object.fromEntries(Object.entries(byChapter).sort(([a], [b]) => a.localeCompare(b))),
    most_missed: [...missed.entries()].sort(([a, na], [b, nb]) => nb - na || a.localeCompare(b)).slice(0, 15).map(([market, products]) => ({ market, products })),
  };
}
