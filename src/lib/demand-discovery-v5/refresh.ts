/**
 * Re-runs when newer data lands (stage 1, item 5; the recommended default of E-035, built in E-040).
 * Every hour the worker finds each product's newest v5 run that newer data would change and starts a
 * fresh run for the oldest first, within a daily budget (`refresh_daily_budget`, 100 by default: a run
 * makes two batched Comtrade calls, and the free key allows 500 a day). Newer data is:
 * - a newer ready CEPII BACI release for a revision the run read (HS17, HS22), or one where it had none;
 * - a newer active release of a reference dataset the run froze, or one where it had none;
 * - an official tariff release activated after the run's date.
 * A refresh starts like any run (`startDemandDiscoveryV5`, trigger `refresh`): the paid-tier rule, the
 * in-flight dedupe and the audit trail apply unchanged. Only a finished newest run under the
 * product's confirmed code is refreshed; one in flight, failed or under an old code is left alone.
 */
import { randomUUID } from 'node:crypto';
import { AuthorityReleaseStatus, JobStatus, ProductClassificationStatus, ReferenceDatasetReleaseStatus } from '@prisma/client';
import { getConfig } from '@/lib/config';
import { appEnvironment } from '@/lib/evidence-environment';
import { prisma } from '@/lib/prisma';
import { BACI_PROVIDER } from '@/lib/trade-datasets/baci';
import { latestReadyTradeDatasetRelease } from '@/lib/trade-datasets/service';
import { DEMAND_DISCOVERY_V5_MODEL } from './policy';
import { startDemandDiscoveryV5 } from './service';

export interface RefreshState {
  /** The ready BACI release now, by revision. */
  baci: { HS17: string | null; HS22: string | null };
  /** The active release now, by reference dataset key. */
  reference: ReadonlyMap<string, string>;
  /** Active official tariff releases, with when each was activated. */
  tariff_releases: readonly { id: string; authority: string; activated_at: Date }[];
}

type FrozenRelease = { release_id?: unknown } | null | undefined;
type Frozen = { baci?: { hs17?: FrozenRelease; hs22?: FrozenRelease }; reference?: Record<string, FrozenRelease> };
const releaseId = (frozen: FrozenRelease) => (typeof frozen?.release_id === 'string' ? frozen.release_id : null);

/** Why newer data would change a run: one plain line per input, empty when it is current. Pure. */
export function refreshReasons(run: { frozen_inputs: unknown; as_of: Date }, state: RefreshState): string[] {
  const frozen = (run.frozen_inputs ?? {}) as Frozen;
  const reasons: string[] = [];
  for (const [revision, used] of [['HS17', frozen.baci?.hs17], ['HS22', frozen.baci?.hs22]] as const) {
    const now = state.baci[revision];
    if (now && now !== releaseId(used)) reasons.push(`A newer CEPII BACI ${revision} release is ready.`);
  }
  for (const [key, used] of Object.entries(frozen.reference ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    const now = state.reference.get(key);
    if (now && now !== releaseId(used)) reasons.push(`${key} has a newer release.`);
  }
  const tariffs = [...new Set(state.tariff_releases.filter((release) => release.activated_at > run.as_of).map((release) => release.authority))].sort();
  if (tariffs.length) reasons.push(`Official tariffs released since the run: ${tariffs.join(', ')}.`);
  return reasons;
}

export async function loadRefreshState(): Promise<RefreshState> {
  const [hs17, hs22, reference, tariffs] = await Promise.all([
    latestReadyTradeDatasetRelease(BACI_PROVIDER, 'HS17'),
    latestReadyTradeDatasetRelease(BACI_PROVIDER, 'HS22'),
    prisma.referenceDatasetRelease.findMany({ where: { environment: appEnvironment(), status: ReferenceDatasetReleaseStatus.active }, select: { id: true, dataset_key: true } }),
    prisma.authorityRelease.findMany({ where: { status: AuthorityReleaseStatus.active, activated_at: { not: null } }, select: { id: true, authority: true, activated_at: true } }),
  ]);
  return {
    baci: { HS17: hs17?.id ?? null, HS22: hs22?.id ?? null },
    reference: new Map(reference.map((release) => [release.dataset_key, release.id])),
    tariff_releases: tariffs.map((release) => ({ id: release.id, authority: release.authority, activated_at: release.activated_at! })),
  };
}

export interface RefreshSweepResult {
  /** Products whose newest run could be refreshed (finished, under the confirmed code). */
  checked: number;
  out_of_date: number;
  started: { product_id: string; run_id: string; replaces: string; reasons: string[] }[];
  /** Out-of-date products not started, with why (the budget, the tier, a run already in flight). */
  skipped: { product_id: string; reason: string }[];
  budget_left: number;
}

const FINISHED: readonly JobStatus[] = [JobStatus.completed, JobStatus.partial];
const describe = (error: unknown) => {
  const fields = (error as { fields?: { message?: string }[] } | null)?.fields?.map((field) => field.message).filter(Boolean) ?? [];
  return fields.length ? fields.join(' ') : error instanceof Error ? error.message : String(error);
};

/** Null when refreshes are switched off. `state`, `start` and `daily_budget` (instead of the config's) are seams for tests. */
export async function sweepV5Refresh(options: { now?: Date; state?: RefreshState; start?: typeof startDemandDiscoveryV5; daily_budget?: number } = {}): Promise<RefreshSweepResult | null> {
  const config = await getConfig('demand_discovery.v5');
  if (!config.enabled || !config.refresh_on_new_data) return null;
  const now = options.now ?? new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const startedToday = await prisma.discoveryRun.count({ where: { model_version: DEMAND_DISCOVERY_V5_MODEL, trigger: 'refresh', created_at: { gte: dayStart } } });
  const dailyBudget = options.daily_budget ?? config.refresh_daily_budget;
  let budget = Math.max(0, dailyBudget - startedToday);

  // Each product's newest v5 run; only a finished one under the product's confirmed code qualifies.
  const newest = await prisma.discoveryRun.findMany({
    where: { model_version: DEMAND_DISCOVERY_V5_MODEL, product_id: { not: null } },
    orderBy: [{ product_id: 'asc' }, { created_at: 'desc' }],
    distinct: ['product_id'],
    select: { id: true, product_id: true, status: true, created_at: true, as_of_date: true, completed_at: true, classification: { select: { status: true } } },
  });
  const candidates = newest
    .filter((run) => FINISHED.includes(run.status) && run.classification?.status === ProductClassificationStatus.confirmed)
    .sort((a, b) => (a.completed_at ?? a.created_at).getTime() - (b.completed_at ?? b.created_at).getTime() || a.id.localeCompare(b.id));
  const result: RefreshSweepResult = { checked: candidates.length, out_of_date: 0, started: [], skipped: [], budget_left: budget };
  if (!candidates.length) return result;

  const state = options.state ?? await loadRefreshState();
  const start = options.start ?? startDemandDiscoveryV5;
  for (const run of candidates) {
    const frozen = await prisma.discoveryRun.findUnique({ where: { id: run.id }, select: { frozen_inputs: true } });
    const reasons = refreshReasons({ frozen_inputs: frozen?.frozen_inputs, as_of: run.as_of_date ?? run.created_at }, state);
    if (!reasons.length) continue;
    result.out_of_date += 1;
    if (budget === 0) {
      result.skipped.push({ product_id: run.product_id!, reason: `Today's refresh budget (${dailyBudget} runs) is used.` });
      continue;
    }
    try {
      const started = await start({ product_id: run.product_id!, actor: null, trigger: 'refresh', correlation_id: `v5-refresh:${randomUUID()}` });
      budget -= 1;
      result.started.push({ product_id: run.product_id!, run_id: started.run_id, replaces: run.id, reasons });
    } catch (error) {
      result.skipped.push({ product_id: run.product_id!, reason: describe(error) });
    }
  }
  result.budget_left = budget;
  return result;
}
