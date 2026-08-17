/**
 * Part E — operational visibility.
 *
 * Two properties matter here and both are tested against the database rather than a mock:
 *
 *   1. The dashboard's verdict CANNOT disagree with the gate that blocks screening. It is
 *      derived from the same `sanctionsCoverage()` call, so these tests assert agreement
 *      rather than asserting a hand-written expectation twice.
 *   2. The surface stays restricted (E5). A source-health view names which authorities are
 *      uncovered — that is an internal control detail, not exporter-facing.
 */

import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, test } from 'vitest';
import {
  EvidenceOrigin,
  SanctionsArtifactVerification,
  SanctionsCompletenessStatus,
  SanctionsFailureStage,
  SanctionsSnapshotState,
  UserRole,
} from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import {
  SANCTIONS_OPS_ROLES,
  canViewSanctionsSourceHealth,
  sanctionsSourceHealth,
} from '../src/lib/sanctions/source-health';
import { REQUIRED_SANCTIONS_SOURCES, sanctionsCoverage } from '../src/lib/sanctions/screening';

const marker = `health-${randomUUID().slice(0, 8)}`;
const NOW = new Date('2026-08-15T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

async function seedActive(source: string, over: Record<string, unknown> = {}) {
  return prisma.sanctionsSourceSnapshot.create({
    data: {
      source,
      source_url: `fixture://${marker}`,
      checksum: randomUUID().replace(/-/g, ''),
      record_count: 100,
      retrieved_count: 100,
      parsed_entity_count: 100,
      rejected_records: 0,
      completeness_status: SanctionsCompletenessStatus.COMPLETE,
      coverage_complete: true,
      state: SanctionsSnapshotState.active,
      evidence_origin: EvidenceOrigin.fixture,
      fetched_at: hoursAgo(2),
      activated_at: hoursAgo(2),
      last_successful_full_refresh: hoursAgo(2),
      source_update_date: hoursAgo(6),
      source_version: '2026-08-15',
      authority: source.startsWith('ofac') ? 'ofac' : source.startsWith('eu') ? 'eu' : 'un',
      ...over,
    },
  });
}

/** Seed all four required datasets as healthy, then let a test perturb one. */
async function seedAllHealthy() {
  for (const source of REQUIRED_SANCTIONS_SOURCES) await seedActive(source);
}

async function cleanup() {
  const ids = (
    await prisma.sanctionsSourceSnapshot.findMany({
      where: { source_url: `fixture://${marker}` },
      select: { id: true },
    })
  ).map((s) => s.id);
  await prisma.sanctionsArtifact.deleteMany({ where: { snapshot_id: { in: ids } } });
  await prisma.sanctionsSourceSnapshot.deleteMany({ where: { id: { in: ids } } });
}

afterEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// E5 — access control
// ---------------------------------------------------------------------------

describe('E5 access control', () => {
  test('only ops_supervisor and admin may read source health', () => {
    const permitted = Object.values(UserRole).filter(canViewSanctionsSourceHealth);
    expect(permitted.sort()).toEqual([UserRole.admin, UserRole.ops_supervisor].sort());
  });

  test.each([UserRole.exporter_owner, UserRole.exporter_member, UserRole.agent, UserRole.ops_finance])(
    '%s is denied',
    (role) => {
      expect(canViewSanctionsSourceHealth(role)).toBe(false);
    },
  );

  test('the allow-list itself has not been widened', () => {
    expect([...SANCTIONS_OPS_ROLES].sort()).toEqual([UserRole.admin, UserRole.ops_supervisor].sort());
  });

  test('every exporter-portal role is excluded by the portal gate, not merely the allow-list', () => {
    // Defence in depth: even if the allow-list were widened, the portal check must still deny.
    for (const role of [UserRole.exporter_owner, UserRole.exporter_member]) {
      expect(canViewSanctionsSourceHealth(role)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// E1/E2/E3 — derivation
// ---------------------------------------------------------------------------

describe('E1 per-dataset health', () => {
  test('reports every required dataset, never a subset', async () => {
    await seedAllHealthy();
    const health = await sanctionsSourceHealth(NOW);
    expect(health.datasets.map((d) => d.dataset).sort()).toEqual([...REQUIRED_SANCTIONS_SOURCES].sort());
  });

  test('surfaces provider metadata, counts and lifecycle for an active snapshot', async () => {
    await seedAllHealthy();
    const d = (await sanctionsSourceHealth(NOW)).datasets.find((x) => x.dataset === 'ofac_sdn')!;
    expect(d.lifecycle_state).toBe(SanctionsSnapshotState.active);
    expect(d.completeness).toBe(SanctionsCompletenessStatus.COMPLETE);
    expect(d.provider_published_at).toEqual(hoursAgo(6));
    expect(d.provider_version).toBe('2026-08-15');
    expect(d.retrieved_count).toBe(100);
    expect(d.parsed_count).toBe(100);
    expect(d.age_hours).toBeCloseTo(2, 1);
    expect(d.freshness_status).toBe('FRESH');
  });

  test('abbreviates the checksum rather than dumping it', async () => {
    await seedAllHealthy();
    const d = (await sanctionsSourceHealth(NOW)).datasets.find((x) => x.dataset === 'ofac_sdn')!;
    expect(d.checksum_abbrev).toMatch(/^[0-9a-f]{12}…$/);
  });

  test('a dataset with no active snapshot reads UNKNOWN freshness, not FRESH', async () => {
    // Seed only three of four.
    for (const s of REQUIRED_SANCTIONS_SOURCES.filter((x) => x !== 'un_security_council')) await seedActive(s);
    const d = (await sanctionsSourceHealth(NOW)).datasets.find((x) => x.dataset === 'un_security_council')!;
    expect(d.active_snapshot_id).toBeNull();
    expect(d.freshness_status).toBe('UNKNOWN');
  });

  test('artifact retention state is reported honestly when absent', async () => {
    await seedAllHealthy();
    const d = (await sanctionsSourceHealth(NOW)).datasets.find((x) => x.dataset === 'ofac_sdn')!;
    expect(d.artifact_retained).toBe(false);
    expect(d.artifact_verification).toBeNull();
  });

  test('artifact retention state is reported when present', async () => {
    await seedAllHealthy();
    const snap = await prisma.sanctionsSourceSnapshot.findFirst({
      where: { source: 'ofac_sdn', source_url: `fixture://${marker}` },
    });
    await prisma.sanctionsSourceSnapshot.update({
      where: { id: snap!.id },
      data: { artifact_ref: 'sanctions/ofac_sdn/2026/deadbeef.xml' },
    });
    await prisma.sanctionsArtifact.create({
      data: {
        dataset: 'ofac_sdn',
        source_contract_version: 'test-contract-v1',
        source_reference: 'fixture',
        retrieved_at: new Date(),
        sha256: 'a'.repeat(64),
        byte_length: 10,
        storage_provider: 'local',
        object_key: 'sanctions/ofac_sdn/2026/deadbeef.xml',
        verification_status: SanctionsArtifactVerification.verified,
        verification_detail: 'fixture',
        snapshot_id: snap!.id,
        evidence_origin: EvidenceOrigin.fixture,
      },
    });
    const d = (await sanctionsSourceHealth(NOW)).datasets.find((x) => x.dataset === 'ofac_sdn')!;
    expect(d.artifact_retained).toBe(true);
    expect(d.artifact_storage_provider).toBe('local');
    expect(d.artifact_verification).toBe(SanctionsArtifactVerification.verified);
  });
});

describe('E2 authority rollup', () => {
  test('an authority is covered only when ALL its datasets are', async () => {
    await seedAllHealthy();
    const ofac = (await sanctionsSourceHealth(NOW)).authorities.find((a) => a.authority === 'ofac')!;
    expect(ofac.datasets.sort()).toEqual(['ofac_non_sdn_consolidated', 'ofac_sdn']);
    expect(ofac.complete).toBe(true);
  });

  test('one failing member dataset makes the authority incomplete AND names it', async () => {
    for (const s of REQUIRED_SANCTIONS_SOURCES.filter((x) => x !== 'ofac_non_sdn_consolidated')) await seedActive(s);
    const ofac = (await sanctionsSourceHealth(NOW)).authorities.find((a) => a.authority === 'ofac')!;
    expect(ofac.complete).toBe(false);
    // The specific gap must be visible — a bare red chip would not tell Ops what to fix.
    expect(ofac.failing_datasets).toEqual(['ofac_non_sdn_consolidated']);
  });

  test('rollup agrees with the authorityCoverage screening itself uses', async () => {
    await seedAllHealthy();
    const [health, coverage] = await Promise.all([sanctionsSourceHealth(NOW), sanctionsCoverage(NOW)]);
    expect(health.authorities.map((a) => ({ authority: a.authority, complete: a.complete }))).toEqual(
      coverage.authorities.map((a) => ({ authority: a.authority, complete: a.complete })),
    );
  });
});

describe('E3 global state', () => {
  test('READY when all four datasets are complete, fresh and active', async () => {
    await seedAllHealthy();
    const health = await sanctionsSourceHealth(NOW);
    expect(health.global_state).toBe('READY');
    expect(health.global_reasons).toEqual([]);
  });

  test('BLOCKED with a named reason when a required dataset has no active snapshot', async () => {
    for (const s of REQUIRED_SANCTIONS_SOURCES.filter((x) => x !== 'un_security_council')) await seedActive(s);
    const health = await sanctionsSourceHealth(NOW);
    expect(health.global_state).toBe('BLOCKED');
    expect(health.global_reasons.some((r) => r.includes('un_security_council'))).toBe(true);
  });

  test('BLOCKED when a dataset is stale beyond the freshness threshold', async () => {
    for (const s of REQUIRED_SANCTIONS_SOURCES.filter((x) => x !== 'eu_financial_sanctions')) await seedActive(s);
    await seedActive('eu_financial_sanctions', {
      fetched_at: hoursAgo(24 * 30),
      activated_at: hoursAgo(24 * 30),
      last_successful_full_refresh: hoursAgo(24 * 30),
    });
    const health = await sanctionsSourceHealth(NOW);
    expect(health.global_state).toBe('BLOCKED');
    expect(health.global_reasons.some((r) => r.includes('eu_financial_sanctions') && r.includes('stale'))).toBe(true);
  });

  test('global state NEVER reads READY while screening coverage is incomplete', async () => {
    // The property that matters: the dashboard cannot contradict the gate.
    for (const s of REQUIRED_SANCTIONS_SOURCES.filter((x) => x !== 'ofac_sdn')) await seedActive(s);
    const [health, coverage] = await Promise.all([sanctionsSourceHealth(NOW), sanctionsCoverage(NOW)]);
    expect(coverage.complete).toBe(false);
    expect(health.global_state).not.toBe('READY');
  });

  test('a non-COMPLETE snapshot blocks and states the completeness value', async () => {
    for (const s of REQUIRED_SANCTIONS_SOURCES.filter((x) => x !== 'un_security_council')) await seedActive(s);
    await seedActive('un_security_council', {
      completeness_status: SanctionsCompletenessStatus.PARTIAL,
      coverage_complete: false,
    });
    const health = await sanctionsSourceHealth(NOW);
    expect(health.global_state).toBe('BLOCKED');
    expect(health.global_reasons.some((r) => r.includes('un_security_council') && r.includes('PARTIAL'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// E4 — refresh observability
// ---------------------------------------------------------------------------

describe('E4 refresh observability', () => {
  test('DEGRADED, not BLOCKED, when the latest refresh failed but a COMPLETE snapshot still serves', async () => {
    await seedAllHealthy();
    // A newer REJECTED attempt for one dataset; the active snapshot is untouched.
    await seedActive('ofac_sdn', {
      state: SanctionsSnapshotState.rejected,
      completeness_status: SanctionsCompletenessStatus.FAILED,
      coverage_complete: false,
      fetched_at: hoursAgo(1),
      activated_at: null,
      last_successful_full_refresh: null,
      failure_stage: SanctionsFailureStage.retrieval,
      failure_reason: 'Provider returned HTTP 503',
    });

    const health = await sanctionsSourceHealth(NOW);
    const d = health.datasets.find((x) => x.dataset === 'ofac_sdn')!;

    // Screening still has full coverage — the older snapshot is genuinely serving.
    expect(d.completeness).toBe(SanctionsCompletenessStatus.COMPLETE);
    expect(d.serving_previous_after_failure).toBe(true);
    expect(d.latest_failure_stage).toBe(SanctionsFailureStage.retrieval);
    expect(health.global_state).toBe('DEGRADED');
    expect(
      health.global_reasons.some((r) => r.includes('ofac_sdn') && r.includes('serving the previous COMPLETE snapshot')),
    ).toBe(true);
  });

  test('retrieval failure is reported as retrieval, not as a parse failure', async () => {
    await seedAllHealthy();
    await seedActive('eu_financial_sanctions', {
      state: SanctionsSnapshotState.rejected,
      fetched_at: hoursAgo(1),
      activated_at: null,
      last_successful_full_refresh: null,
      failure_stage: SanctionsFailureStage.retrieval,
      failure_reason: 'Connection reset',
    });
    const d = (await sanctionsSourceHealth(NOW)).datasets.find((x) => x.dataset === 'eu_financial_sanctions')!;
    expect(d.latest_failure_stage).toBe(SanctionsFailureStage.retrieval);
    expect(d.latest_failure_stage).not.toBe(SanctionsFailureStage.parsing);
  });

  test('a clean dataset reports no failure and no previous-snapshot banner', async () => {
    await seedAllHealthy();
    const d = (await sanctionsSourceHealth(NOW)).datasets.find((x) => x.dataset === 'un_security_council')!;
    expect(d.latest_failure_stage).toBeNull();
    expect(d.serving_previous_after_failure).toBe(false);
  });

  test('cadence and next-refresh are exposed per dataset', async () => {
    await seedAllHealthy();
    const d = (await sanctionsSourceHealth(NOW)).datasets.find((x) => x.dataset === 'ofac_sdn')!;
    expect(d.refresh_interval_hours).toBeGreaterThan(0);
    expect(d.next_refresh_at).toBeInstanceOf(Date);
    expect(d.refresh_in_progress).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Policy boundary
// ---------------------------------------------------------------------------

describe('policy boundary is represented, not decided', () => {
  test('freshness tolerance is still labelled pending_policy_approval', async () => {
    await seedAllHealthy();
    const health = await sanctionsSourceHealth(NOW);
    expect(health.freshness_policy_status).toBe('pending_policy_approval');
    expect(health.datasets.every((d) => d.policy_approval === 'pending_policy_approval')).toBe(true);
  });

  test('the reported policy version matches the screening policy in force', async () => {
    await seedAllHealthy();
    const [health, coverage] = await Promise.all([sanctionsSourceHealth(NOW), sanctionsCoverage(NOW)]);
    expect(health.policy_version).toBe(coverage.policy_version);
  });
});
