/**
 * Sanctions refresh scheduling + cross-process concurrency control (Part F).
 *
 * Two ideas are kept strictly apart, because conflating them is how a compliance control
 * silently becomes a timer:
 *
 *   - **Operational refresh cadence** (here) — how often we ASK the provider. Tunable,
 *     per-dataset, an engineering/ops concern.
 *   - **Compliance freshness threshold** (`SANCTIONS_MAX_AGE_DAYS`, screening.ts) — how
 *     stale data may be before screening fails closed. A policy concern, still
 *     `pending_policy_approval`.
 *
 * Refreshing more often does not widen the freshness tolerance, and lengthening the cadence
 * does not make stale data acceptable. They are independent by construction.
 */

import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { SANCTIONS_SCREENING_POLICY } from '@/lib/sanctions/screening';
import type { SanctionsSource } from '@/lib/sanctions/sources';

/** Default cadence. Deliberately unaggressive — these are public government services. */
/** Loose env shape: callers (tests, jobs) pass partial maps, not a full `NodeJS.ProcessEnv`. */
export type SanctionsEnv = Record<string, string | undefined>;

export const DEFAULT_REFRESH_INTERVAL_HOURS = 12;
/** A lease must outlive a slow refresh (28 MB artifact + 19k upserts) but still self-heal. */
export const DEFAULT_LEASE_TTL_MINUTES = 30;

export function refreshIntervalHours(dataset: SanctionsSource, env: SanctionsEnv = process.env): number {
  const perDataset = env[`SANCTIONS_REFRESH_HOURS_${dataset.toUpperCase()}`];
  const global = env.SANCTIONS_REFRESH_HOURS;
  const value = Number(perDataset ?? global ?? DEFAULT_REFRESH_INTERVAL_HOURS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_REFRESH_INTERVAL_HOURS;
}

export function leaseTtlMs(env: SanctionsEnv = process.env): number {
  const value = Number(env.SANCTIONS_LEASE_TTL_MINUTES ?? DEFAULT_LEASE_TTL_MINUTES);
  return (Number.isFinite(value) && value > 0 ? value : DEFAULT_LEASE_TTL_MINUTES) * 60_000;
}

// ---------------------------------------------------------------------------
// Lease (F4)
// ---------------------------------------------------------------------------

export interface RefreshLease {
  dataset: string;
  owner: string;
  expires_at: Date;
}

/**
 * Acquire the exclusive refresh lease for one dataset, or return null.
 *
 * The primary key on `dataset` is the mutual exclusion: a second concurrent `create` for
 * the same dataset fails with P2002 no matter which process attempts it. An EXPIRED lease
 * is stolen via a conditional `updateMany` whose WHERE re-asserts expiry — so of two
 * workers racing to reclaim, exactly one gets `count === 1`. That is what stops a crashed
 * worker from holding a dataset locked forever, without ever allowing two live owners.
 */
export async function acquireRefreshLease(
  dataset: SanctionsSource,
  options: { owner?: string; now?: Date; ttlMs?: number; jobId?: string | null } = {},
): Promise<RefreshLease | null> {
  const owner = options.owner ?? `${process.pid}-${randomUUID().slice(0, 8)}`;
  const now = options.now ?? new Date();
  const expiresAt = new Date(now.getTime() + (options.ttlMs ?? leaseTtlMs()));

  try {
    const lease = await prisma.sanctionsRefreshLease.create({
      data: { dataset, owner, acquired_at: now, expires_at: expiresAt, job_id: options.jobId ?? null },
    });
    return { dataset, owner: lease.owner, expires_at: lease.expires_at };
  } catch {
    // A lease row exists. Steal it only if it has genuinely expired.
    const stolen = await prisma.sanctionsRefreshLease.updateMany({
      where: { dataset, expires_at: { lt: now } },
      data: { owner, acquired_at: now, expires_at: expiresAt, job_id: options.jobId ?? null },
    });
    return stolen.count === 1 ? { dataset, owner, expires_at: expiresAt } : null;
  }
}

/** Release only if still the owner — a lease stolen after expiry must not be freed by the loser. */
export async function releaseRefreshLease(dataset: SanctionsSource, owner: string): Promise<boolean> {
  const released = await prisma.sanctionsRefreshLease.deleteMany({ where: { dataset, owner } });
  return released.count === 1;
}

/** Extend a held lease — for a refresh that legitimately runs longer than the TTL. */
export async function renewRefreshLease(dataset: SanctionsSource, owner: string, ttlMs = leaseTtlMs()): Promise<boolean> {
  const renewed = await prisma.sanctionsRefreshLease.updateMany({
    where: { dataset, owner },
    data: { expires_at: new Date(Date.now() + ttlMs) },
  });
  return renewed.count === 1;
}

/** Reclaim expired leases (stale-job recovery); returns how many were cleared. */
export async function reclaimExpiredLeases(now = new Date()): Promise<number> {
  const { count } = await prisma.sanctionsRefreshLease.deleteMany({ where: { expires_at: { lt: now } } });
  return count;
}

// ---------------------------------------------------------------------------
// Cadence (F1/F2)
// ---------------------------------------------------------------------------

export interface DatasetSchedule {
  dataset: SanctionsSource;
  interval_hours: number;
  last_attempt_at: Date | null;
  last_success_at: Date | null;
  next_refresh_at: Date | null;
  due: boolean;
  refresh_in_progress: boolean;
}

/**
 * Per-dataset schedule state. `next_refresh_at` is derived from the last ATTEMPT, not the
 * last success — otherwise a persistently failing source would be retried in a tight loop
 * forever, which is exactly the hammering Part F8 forbids.
 */
export async function datasetSchedules(now = new Date(), env: SanctionsEnv = process.env): Promise<DatasetSchedule[]> {
  const datasets = [...SANCTIONS_SCREENING_POLICY.required_datasets] as SanctionsSource[];
  const [snapshots, leases] = await Promise.all([
    prisma.sanctionsSourceSnapshot.findMany({
      where: { source: { in: datasets } },
      orderBy: { fetched_at: 'desc' },
      select: { source: true, fetched_at: true, state: true, last_successful_full_refresh: true },
    }),
    prisma.sanctionsRefreshLease.findMany({ where: { dataset: { in: datasets } } }),
  ]);

  return datasets.map((dataset) => {
    const forDataset = snapshots.filter((s) => s.source === dataset);
    const lastAttempt = forDataset[0]?.fetched_at ?? null;
    const lastSuccess = forDataset.find((s) => s.last_successful_full_refresh)?.last_successful_full_refresh ?? null;
    const intervalHours = refreshIntervalHours(dataset, env);
    const next = lastAttempt ? new Date(lastAttempt.getTime() + intervalHours * 3_600_000) : null;
    const lease = leases.find((l) => l.dataset === dataset);
    return {
      dataset,
      interval_hours: intervalHours,
      last_attempt_at: lastAttempt,
      last_success_at: lastSuccess,
      next_refresh_at: next,
      due: !next || next <= now,
      refresh_in_progress: Boolean(lease && lease.expires_at > now),
    };
  });
}

/** Datasets whose cadence has elapsed and which are not already being refreshed. */
export async function dueDatasets(now = new Date(), env: SanctionsEnv = process.env): Promise<SanctionsSource[]> {
  return (await datasetSchedules(now, env)).filter((s) => s.due && !s.refresh_in_progress).map((s) => s.dataset);
}
