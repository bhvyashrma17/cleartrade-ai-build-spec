/**
 * What operations needs to see about Demand Discovery v5 (docs/36 §7): whether runs can start in
 * this environment, which datasets they read and what a missing one costs, and which runs are
 * running, partial or failed and why. Read-only, Ops only; nothing here changes a run.
 */
import { JobStatus } from '@prisma/client';
import { getConfig } from '@/lib/config';
import { forbidden } from '@/lib/errors';
import { appEnvironment } from '@/lib/evidence-environment';
import { isOps } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { ECGC_COUNTRY_RISK_KEY, GEO_CEPII_KEY } from '@/lib/reference-datasets/registry';
import { BACI_PROVIDER } from '@/lib/trade-datasets/baci';
import { latestReadyTradeDatasetRelease } from '@/lib/trade-datasets/service';
import type { Principal } from '@/types';
import { DEMAND_DISCOVERY_V5_MODEL } from './policy';

export interface V5DatasetStatus {
  key: string;
  label: string;
  /** What runs lose while this dataset is not imported. */
  when_missing: string;
  active: { version: string; row_count: number; retrieved_at: Date; imported_at: Date; evidence_origin: string } | null;
}

export interface V5RunRow {
  id: string;
  status: JobStatus;
  trigger: string | null;
  product: string | null;
  exporter: string;
  created_at: Date;
  completed_at: Date | null;
  ranked: number | null;
  top_markets: string[];
  notes: string[];
}

function referenceDatasets(latestYear: number | null): Omit<V5DatasetStatus, 'active'>[] {
  return [
    { key: 'wdi:LP.LPI.OVRL.XQ', label: 'World Bank logistics index', when_missing: 'Logistics is not scored.' },
    { key: 'wdi:TM.TAX.TCOM.SM.AR.ZS', label: 'World Bank tariff average, primary products', when_missing: 'No duty estimate for HS chapters 01–27.' },
    { key: 'wdi:TM.TAX.MANF.SM.AR.ZS', label: 'World Bank tariff average, manufactured products', when_missing: 'No duty estimate for manufactured goods.' },
    ...(latestYear == null ? [] : [
      { key: `comtrade:availability:${latestYear}`, label: `Comtrade reporting list ${latestYear}`, when_missing: "Every market is labelled as estimated from partners' figures." },
      { key: `comtrade:availability:${latestYear + 1}`, label: `Comtrade reporting list ${latestYear + 1}`, when_missing: `The ${latestYear + 1} figures cannot be checked against what each market reported.` },
    ]),
    { key: 'india:trade-agreements', label: "India's trade agreements", when_missing: 'Duty estimates assume no trade agreement.' },
    { key: ECGC_COUNTRY_RISK_KEY, label: 'ECGC country risk list (short term)', when_missing: 'Country risk is not scored.' },
    { key: GEO_CEPII_KEY, label: 'CEPII GeoDist capitals', when_missing: 'Distance is not scored.' },
  ];
}

export async function demandDiscoveryV5Operations(actor: Principal) {
  if (!isOps(actor)) throw forbidden('Only ClearTrade operations staff can see Demand Discovery operations.');
  const environment = appEnvironment();
  const config = await getConfig('demand_discovery.v5');
  const [hs17, hs22] = await Promise.all([latestReadyTradeDatasetRelease(BACI_PROVIDER, 'HS17'), latestReadyTradeDatasetRelease(BACI_PROVIDER, 'HS22')]);
  const baci = [hs17, hs22].filter((release) => release != null);
  const latestYear = baci.length ? Math.max(...baci.map((release) => release.last_year)) : null;

  const expected = referenceDatasets(latestYear);
  const active = await prisma.referenceDatasetRelease.findMany({
    where: { environment, status: 'active', dataset_key: { in: expected.map((item) => item.key) } },
    select: { dataset_key: true, version: true, row_count: true, retrieved_at: true, imported_at: true, evidence_origin: true },
  });
  const byKey = new Map(active.map((release) => [release.dataset_key, release]));

  const since = new Date(Date.now() - 7 * 86_400_000);
  const [recent, counts] = await Promise.all([
    prisma.discoveryRun.findMany({
      where: { model_version: DEMAND_DISCOVERY_V5_MODEL },
      orderBy: { created_at: 'desc' },
      take: 20,
      select: { id: true, status: true, trigger: true, product_id: true, created_at: true, completed_at: true, summary: true, exporter_org: { select: { display_name: true } } },
    }),
    prisma.discoveryRun.groupBy({ by: ['status'], where: { model_version: DEMAND_DISCOVERY_V5_MODEL, created_at: { gte: since } }, _count: { _all: true } }),
  ]);
  const products = new Map((await prisma.product.findMany({
    where: { id: { in: recent.map((run) => run.product_id).filter((id): id is string => id != null) } },
    select: { id: true, name: true },
  })).map((product) => [product.id, product.name]));

  const runs: V5RunRow[] = recent.map((run) => {
    const summary = (run.summary ?? {}) as { ranked?: number; handed_off?: { market: string }[]; notes?: string[] };
    return {
      id: run.id, status: run.status, trigger: run.trigger, product: run.product_id ? products.get(run.product_id) ?? null : null,
      exporter: run.exporter_org.display_name, created_at: run.created_at, completed_at: run.completed_at,
      ranked: typeof summary.ranked === 'number' ? summary.ranked : null,
      top_markets: (summary.handed_off ?? []).slice(0, 5).map((item) => item.market),
      notes: summary.notes ?? [],
    };
  });
  const count = (status: JobStatus) => counts.find((row) => row.status === status)?._count._all ?? 0;

  return {
    environment,
    available: config.enabled && baci.length > 0,
    unavailable_reason: !config.enabled ? 'Switched off in demand_discovery.v5 config.' : !baci.length ? 'No CEPII BACI release is ready in this environment.' : null,
    switches: {
      auto_start_on_classification: config.auto_start_on_classification,
      comtrade_newest_year: config.comtrade_newest_year,
      comtrade_market_fallback: config.comtrade_market_fallback,
      policy_version: config.policy.policy_version,
    },
    baci: baci.map((release) => ({ hs_revision: release.hs_revision, dataset_version: release.dataset_version, first_year: release.first_year, last_year: release.last_year, completed_at: release.completed_at, evidence_origin: release.evidence_origin })),
    reference: expected.map((item): V5DatasetStatus => {
      const release = byKey.get(item.key);
      return { ...item, active: release ? { version: release.version, row_count: release.row_count, retrieved_at: release.retrieved_at, imported_at: release.imported_at, evidence_origin: release.evidence_origin } : null };
    }),
    last_7_days: { queued: count(JobStatus.queued), processing: count(JobStatus.processing), completed: count(JobStatus.completed), partial: count(JobStatus.partial), failed: count(JobStatus.failed) },
    runs,
  };
}

export type DemandDiscoveryV5Operations = Awaited<ReturnType<typeof demandDiscoveryV5Operations>>;
