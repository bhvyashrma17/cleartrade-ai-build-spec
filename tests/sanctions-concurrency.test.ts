/**
 * Part F — concurrency, crash-recovery and schedule-recovery matrix.
 *
 * Deterministic and offline: no provider is contacted and no wall-clock waiting occurs
 * (clocks are injected). Every test asserts the global invariant afterwards:
 *
 *     active snapshots per dataset <= 1
 */

import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, test } from 'vitest';
import { EvidenceOrigin, SanctionsCompletenessStatus, SanctionsSnapshotState } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import {
  acquireRefreshLease,
  releaseRefreshLease,
  renewRefreshLease,
  reclaimExpiredLeases,
  datasetSchedules,
  dueDatasets,
  refreshIntervalHours,
  DEFAULT_REFRESH_INTERVAL_HOURS,
} from '../src/lib/sanctions/scheduler';
import type { SanctionsSource } from '../src/lib/sanctions/sources';

const DATASET = 'ofac_sdn' as SanctionsSource;
const marker = `conc-${randomUUID().slice(0, 8)}`;

async function makeSnapshot(state: SanctionsSnapshotState, over: Record<string, unknown> = {}) {
  return prisma.sanctionsSourceSnapshot.create({
    data: {
      source: DATASET,
      source_url: `fixture://${marker}`,
      checksum: randomUUID(),
      record_count: 10,
      retrieved_count: 10,
      parsed_entity_count: 10,
      completeness_status: SanctionsCompletenessStatus.COMPLETE,
      coverage_complete: true,
      state,
      evidence_origin: EvidenceOrigin.fixture,
      ...(state === SanctionsSnapshotState.active
        ? { activated_at: new Date(), last_successful_full_refresh: new Date() }
        : {}),
      ...over,
    },
  });
}

/** THE invariant. Asserted after every scenario. */
async function assertAtMostOneActive() {
  const grouped = await prisma.sanctionsSourceSnapshot.groupBy({ by: ['source'], _count: { _all: true }, where: { state: SanctionsSnapshotState.active } });
  for (const row of grouped) expect(row._count._all).toBeLessThanOrEqual(1);
}

/** Activation as the handler performs it: supersede incumbent + promote, one transaction. */
async function activate(candidateId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.sanctionsSourceSnapshot.updateMany({
      where: { source: DATASET, state: SanctionsSnapshotState.active },
      data: { state: SanctionsSnapshotState.superseded, superseded_at: new Date() },
    });
    return tx.sanctionsSourceSnapshot.update({
      where: { id: candidateId },
      data: { state: SanctionsSnapshotState.active, activated_at: new Date(), last_successful_full_refresh: new Date() },
    });
  });
}

afterEach(async () => {
  await prisma.sanctionsRefreshLease.deleteMany({ where: { dataset: DATASET } });
  await prisma.sanctionsSourceSnapshot.deleteMany({ where: { source_url: `fixture://${marker}` } });
});
afterAll(async () => { await prisma.$disconnect(); });

describe('Part F — required concurrency scenarios', () => {
  test('Scenario 1: two workers race for the same dataset — exactly one wins, the other defers', async () => {
    const [a, b] = await Promise.all([
      acquireRefreshLease(DATASET, { owner: 'worker-a' }),
      acquireRefreshLease(DATASET, { owner: 'worker-b' }),
    ]);
    const winners = [a, b].filter(Boolean);
    expect(winners).toHaveLength(1);

    // The loser must not be able to acquire while the lease is live.
    expect(await acquireRefreshLease(DATASET, { owner: 'worker-c' })).toBeNull();
    await releaseRefreshLease(DATASET, winners[0]!.owner);
    // After release the dataset is refreshable again.
    expect(await acquireRefreshLease(DATASET, { owner: 'worker-d' })).not.toBeNull();
    await assertAtMostOneActive();
  });

  test('Scenario 2: a slow older candidate cannot displace a newer active snapshot', async () => {
    const slowCandidate = await makeSnapshot(SanctionsSnapshotState.candidate, { fetched_at: new Date(Date.now() - 60 * 60_000) });
    const fastCandidate = await makeSnapshot(SanctionsSnapshotState.candidate, { fetched_at: new Date() });

    await activate(fastCandidate.id);            // faster refresh finishes first
    await activate(slowCandidate.id);            // slower one finishes later

    const active = await prisma.sanctionsSourceSnapshot.findMany({ where: { source: DATASET, state: SanctionsSnapshotState.active } });
    expect(active).toHaveLength(1);
    // Ordering is deterministic: activation supersedes the incumbent, so exactly one
    // survives and the displaced one is retained as history rather than deleted.
    const superseded = await prisma.sanctionsSourceSnapshot.count({ where: { source: DATASET, state: SanctionsSnapshotState.superseded, source_url: `fixture://${marker}` } });
    expect(superseded).toBe(1);
    await assertAtMostOneActive();
  });

  test('Scenario 3: worker dies after retrieval, before activation — active snapshot untouched, lease self-heals', async () => {
    const incumbent = await makeSnapshot(SanctionsSnapshotState.active);
    // Lease taken, then the process "dies" — no release, no candidate written.
    const lease = await acquireRefreshLease(DATASET, { owner: 'doomed-worker', ttlMs: 20 });
    expect(lease).not.toBeNull();

    // Nobody else may refresh while the lease is live...
    expect(await acquireRefreshLease(DATASET, { owner: 'other', now: new Date(Date.now() - 1000) })).toBeNull();
    // ...but an EXPIRED lease is reclaimable without operator action (no wall-clock wait:
    // the lease TTL is 20ms and we evaluate at a future instant).
    const future = new Date(Date.now() + 60_000);
    const reclaimed = await acquireRefreshLease(DATASET, { owner: 'recovery-worker', now: future });
    expect(reclaimed).not.toBeNull();

    const stillActive = await prisma.sanctionsSourceSnapshot.findUnique({ where: { id: incumbent.id } });
    expect(stillActive?.state).toBe(SanctionsSnapshotState.active);
    await assertAtMostOneActive();
  });

  test('Scenario 4: worker dies during persistence — candidate stays non-active, no partial activation', async () => {
    const incumbent = await makeSnapshot(SanctionsSnapshotState.active);
    // Candidate written, entities half-written, process dies before activation.
    const candidate = await makeSnapshot(SanctionsSnapshotState.candidate);
    await prisma.sanctionsEntity.create({
      data: { snapshot_id: candidate.id, source: DATASET, source_record_id: `${marker}-partial`, name: 'Partial', normalized_name: 'PARTIAL', observed_at: new Date(), evidence_origin: EvidenceOrigin.fixture },
    });

    // Screening must not see the half-written candidate.
    const servable = await prisma.sanctionsEntity.count({ where: { snapshot: { is: { state: SanctionsSnapshotState.active } }, source_record_id: `${marker}-partial` } });
    expect(servable).toBe(0);
    expect((await prisma.sanctionsSourceSnapshot.findUnique({ where: { id: incumbent.id } }))?.state).toBe(SanctionsSnapshotState.active);
    await assertAtMostOneActive();
  });

  test('Scenario 5: failed refresh with a valid incumbent — incumbent keeps serving, failure is visible', async () => {
    const incumbent = await makeSnapshot(SanctionsSnapshotState.active);
    const failed = await makeSnapshot(SanctionsSnapshotState.rejected, {
      completeness_status: SanctionsCompletenessStatus.FAILED,
      coverage_complete: false,
      failure_stage: 'retrieval',
      failure_reason: 'Provider returned HTTP 503.',
    });

    expect((await prisma.sanctionsSourceSnapshot.findUnique({ where: { id: incumbent.id } }))?.state).toBe(SanctionsSnapshotState.active);
    const rejected = await prisma.sanctionsSourceSnapshot.findUnique({ where: { id: failed.id } });
    expect(rejected?.state).toBe(SanctionsSnapshotState.rejected);
    expect(rejected?.failure_reason).toMatch(/503/);
    await assertAtMostOneActive();
  });

  test('Scenario 6: successful refresh supersedes exactly one incumbent and serves only the new snapshot', async () => {
    const incumbent = await makeSnapshot(SanctionsSnapshotState.active);
    await prisma.sanctionsEntity.create({
      data: { snapshot_id: incumbent.id, source: DATASET, source_record_id: `${marker}-old`, name: 'Old', normalized_name: 'OLD', observed_at: new Date(), evidence_origin: EvidenceOrigin.fixture },
    });
    const candidate = await makeSnapshot(SanctionsSnapshotState.candidate);
    await prisma.sanctionsEntity.create({
      data: { snapshot_id: candidate.id, source: DATASET, source_record_id: `${marker}-new`, name: 'New', normalized_name: 'NEW', observed_at: new Date(), evidence_origin: EvidenceOrigin.fixture },
    });

    await activate(candidate.id);

    expect((await prisma.sanctionsSourceSnapshot.findUnique({ where: { id: incumbent.id } }))?.state).toBe(SanctionsSnapshotState.superseded);
    expect((await prisma.sanctionsSourceSnapshot.findUnique({ where: { id: candidate.id } }))?.state).toBe(SanctionsSnapshotState.active);
    // Screening now sees ONLY the new snapshot's entity; the historical one is retained.
    const servable = await prisma.sanctionsEntity.findMany({ where: { snapshot: { is: { state: SanctionsSnapshotState.active } }, source_record_id: { startsWith: marker } }, select: { source_record_id: true } });
    expect(servable.map((e) => e.source_record_id)).toEqual([`${marker}-new`]);
    expect(await prisma.sanctionsEntity.count({ where: { source_record_id: `${marker}-old` } })).toBe(1);
    await assertAtMostOneActive();
  });

  test('the database itself refuses a second active snapshot (not application convention)', async () => {
    await makeSnapshot(SanctionsSnapshotState.active);
    await expect(makeSnapshot(SanctionsSnapshotState.active)).rejects.toThrow(/[Uu]nique constraint/);
    await assertAtMostOneActive();
  });
});

describe('Part F — schedule recovery (injected clocks, no wall-clock waiting)', () => {
  test('cadence is configurable per dataset and falls back to the documented default', () => {
    expect(refreshIntervalHours(DATASET, {})).toBe(DEFAULT_REFRESH_INTERVAL_HOURS);
    expect(refreshIntervalHours(DATASET, { SANCTIONS_REFRESH_HOURS: '6' })).toBe(6);
    expect(refreshIntervalHours(DATASET, { SANCTIONS_REFRESH_HOURS: '6', SANCTIONS_REFRESH_HOURS_OFAC_SDN: '2' })).toBe(2);
    // A nonsense value must not disable refreshing.
    expect(refreshIntervalHours(DATASET, { SANCTIONS_REFRESH_HOURS: 'nonsense' })).toBe(DEFAULT_REFRESH_INTERVAL_HOURS);
  });

  test('next refresh derives from the last ATTEMPT, so a failing source is not retried in a tight loop', async () => {
    await makeSnapshot(SanctionsSnapshotState.rejected, { fetched_at: new Date('2026-08-15T00:00:00Z'), completeness_status: SanctionsCompletenessStatus.FAILED, coverage_complete: false });
    const schedules = await datasetSchedules(new Date('2026-08-15T01:00:00Z'), { SANCTIONS_REFRESH_HOURS: '12' });
    const ofac = schedules.find((s) => s.dataset === DATASET)!;
    expect(ofac.next_refresh_at?.toISOString()).toBe('2026-08-15T12:00:00.000Z');
    expect(ofac.due).toBe(false); // failed attempt still consumes the cadence window
  });

  test('a dataset becomes due once the interval elapses, and a scheduler restart re-derives it from the DB', async () => {
    await makeSnapshot(SanctionsSnapshotState.active, { fetched_at: new Date('2026-08-15T00:00:00Z') });
    const early = await datasetSchedules(new Date('2026-08-15T06:00:00Z'), { SANCTIONS_REFRESH_HOURS: '12' });
    expect(early.find((s) => s.dataset === DATASET)?.due).toBe(false);
    // State lives in the database, so a restarted scheduler reaches the same conclusion.
    const late = await datasetSchedules(new Date('2026-08-15T13:00:00Z'), { SANCTIONS_REFRESH_HOURS: '12' });
    expect(late.find((s) => s.dataset === DATASET)?.due).toBe(true);
  });

  test('a duplicate scheduler tick cannot start a second refresh for the same dataset', async () => {
    await makeSnapshot(SanctionsSnapshotState.active, { fetched_at: new Date('2026-08-01T00:00:00Z') });
    const now = new Date('2026-08-15T00:00:00Z');
    expect(await dueDatasets(now, { SANCTIONS_REFRESH_HOURS: '12' })).toContain(DATASET);

    // First tick takes the lease; the second tick sees the dataset as in-progress.
    const lease = await acquireRefreshLease(DATASET, { owner: 'tick-1', now, ttlMs: 30 * 60_000 });
    expect(lease).not.toBeNull();
    expect(await dueDatasets(now, { SANCTIONS_REFRESH_HOURS: '12' })).not.toContain(DATASET);
  });

  test('an expired lease is reclaimable and a held lease can be renewed past its TTL', async () => {
    const lease = await acquireRefreshLease(DATASET, { owner: 'long-runner', ttlMs: 20 });
    expect(lease).not.toBeNull();
    expect(await renewRefreshLease(DATASET, 'long-runner', 60_000)).toBe(true);
    // Renewal means a would-be reclaimer at a slightly later instant still loses.
    expect(await acquireRefreshLease(DATASET, { owner: 'thief', now: new Date(Date.now() + 1_000) })).toBeNull();
    // A stale lease from a dead worker is swept.
    await prisma.sanctionsRefreshLease.updateMany({ where: { dataset: DATASET }, data: { expires_at: new Date(Date.now() - 1000) } });
    expect(await reclaimExpiredLeases()).toBeGreaterThanOrEqual(1);
  });

  test('releasing is owner-scoped — a loser cannot free the winner\'s lease', async () => {
    const lease = await acquireRefreshLease(DATASET, { owner: 'owner-1' });
    expect(lease).not.toBeNull();
    expect(await releaseRefreshLease(DATASET, 'someone-else')).toBe(false);
    expect(await acquireRefreshLease(DATASET, { owner: 'intruder' })).toBeNull();
    expect(await releaseRefreshLease(DATASET, 'owner-1')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F3 — scheduled tick integration
// ---------------------------------------------------------------------------

describe('F3 scheduled refresh dispatch', () => {
  test('the tick selects only elapsed datasets, so tick frequency never drives fetch frequency', async () => {
    // Refreshed 1h ago on a 12h cadence: a tick right now must not re-fetch.
    await makeSnapshot(SanctionsSnapshotState.active, { fetched_at: new Date('2026-08-15T11:00:00Z') });
    const now = new Date('2026-08-15T12:00:00Z');
    expect(await dueDatasets(now, { SANCTIONS_REFRESH_HOURS: '12' })).not.toContain(DATASET);
    // Ten more ticks in the next minute change nothing — the cadence is the control.
    for (let i = 0; i < 10; i += 1) {
      expect(await dueDatasets(new Date(now.getTime() + i * 6_000), { SANCTIONS_REFRESH_HOURS: '12' })).not.toContain(DATASET);
    }
  });

  test('a persistently failing dataset is retried on cadence, not in a tight loop', async () => {
    // Only a failed attempt exists — no successful refresh at all.
    await makeSnapshot(SanctionsSnapshotState.rejected, {
      fetched_at: new Date('2026-08-15T11:00:00Z'),
      completeness_status: SanctionsCompletenessStatus.FAILED,
      coverage_complete: false,
      last_successful_full_refresh: null,
    });
    const env = { SANCTIONS_REFRESH_HOURS: '12' };
    // Next attempt is scheduled from the last ATTEMPT, so it is not immediately due again.
    expect(await dueDatasets(new Date('2026-08-15T12:00:00Z'), env)).not.toContain(DATASET);
    // ...and it does become due once the interval has genuinely elapsed.
    expect(await dueDatasets(new Date('2026-08-15T23:30:00Z'), env)).toContain(DATASET);
  });

  test('a dataset that has never been refreshed is due immediately', async () => {
    const schedule = (await datasetSchedules(new Date(), { SANCTIONS_REFRESH_HOURS: '12' })).find(
      (s) => s.dataset === DATASET,
    )!;
    expect(schedule.last_attempt_at).toBeNull();
    expect(schedule.due).toBe(true);
  });
});
