/**
 * Phase 11 — live sanctions source contract validation.
 *
 * Runs the REAL retrieval + parse + completeness + atomic activation path against the three
 * authoritative sources. Deliberately kept OUT of the deterministic Vitest suite (Phase 16:
 * "Do not make unit tests depend on network availability").
 *
 * Reports schema-level facts only — never raw record bodies, never credentials, never a
 * resolved URL carrying a token.
 *
 *   npx tsx --env-file=.env scripts/verify-sanctions-live.ts
 */

import { SanctionsSnapshotState } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { refreshSanctionsSource } from '../src/lib/job-handlers/sanctions';
import { sanctionsCoverage } from '../src/lib/sanctions/screening';
import { SANCTIONS_SOURCE_CONTRACTS, type SanctionsSource } from '../src/lib/sanctions/sources';
import { assertVerificationEnvironment } from '../src/lib/evidence-environment';

const abbrev = (s: string | null) => (s ? `${s.slice(0, 12)}…` : 'n/a');
const mb = (n: number | null) => (n == null ? 'n/a' : `${(n / 1048576).toFixed(2)} MB`);

async function main() {
  // Refuses to run against production/staging — this writes snapshots.
  assertVerificationEnvironment('verify-sanctions-live');

  const sources = Object.keys(SANCTIONS_SOURCE_CONTRACTS) as SanctionsSource[];
  console.log('=== LIVE SANCTIONS SOURCE CONTRACT VALIDATION ===\n');

  const results = [];
  for (const source of sources) {
    const contract = SANCTIONS_SOURCE_CONTRACTS[source];
    console.log(`--- ${source} ---`);
    console.log(`  authority        : ${contract.authority}`);
    console.log(`  dataset          : ${contract.dataset_name}`);
    console.log(`  contract version : ${contract.contract_version}`);
    console.log(`  adapter version  : ${contract.adapter_version}`);
    console.log(`  auth             : ${contract.auth.kind}`);

    const started = Date.now();
    const r = await refreshSanctionsSource(source, null);
    results.push(r);

    console.log(`  HTTP status      : ${r.http_status ?? 'n/a'}`);
    console.log(`  media type       : ${r.media_type ?? 'n/a'}`);
    console.log(`  bytes            : ${mb(r.byte_length)}`);
    console.log(`  sha256           : ${abbrev(r.checksum)}`);
    console.log(`  provider version : ${r.source_version ?? 'n/a'}`);
    console.log(`  published at     : ${r.source_published_at ?? 'n/a'}`);
    console.log(`  declared count   : ${r.authoritative_record_count ?? 'not published by source'}`);
    console.log(`  retrieved        : ${r.retrieved_count}`);
    console.log(`  parsed           : ${r.parsed_count}`);
    console.log(`  rejected         : ${r.rejected_count}`);
    console.log(`  completeness     : ${r.completeness_status}`);
    console.log(`  snapshot state   : ${r.state}${r.activated ? ' (ACTIVATED)' : ''}`);
    console.log(`  failure stage    : ${r.failure_stage}${r.failure_reason ? ` — ${r.failure_reason}` : ''}`);
    if (r.anomalies.length) for (const a of r.anomalies) console.log(`  anomaly          : [${a.severity}] ${a.code} — ${a.detail}`);
    console.log(`  rationale        : ${r.rationale}`);
    console.log(`  elapsed          : ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
  }

  // --- Coverage gate --------------------------------------------------------
  const coverage = await sanctionsCoverage();
  console.log('=== SCREENING COVERAGE ===');
  console.log(`  complete            : ${coverage.complete}`);
  console.log(`  freshness window    : ${coverage.max_age_days} day(s)`);
  console.log(`  freshness policy    : ${coverage.freshness_policy_status}`);
  for (const s of coverage.sources) {
    console.log(`  ${s.source.padEnd(24)} ${String(s.status).padEnd(9)} age=${s.age_hours ?? 'n/a'}h published=${s.provider_published_at?.toISOString() ?? 'n/a'}`);
  }

  // --- Atomicity invariant --------------------------------------------------
  console.log('\n=== ATOMIC ACTIVATION INVARIANT ===');
  let invariantHolds = true;
  for (const source of sources) {
    const active = await prisma.sanctionsSourceSnapshot.count({ where: { source, state: SanctionsSnapshotState.active } });
    const total = await prisma.sanctionsSourceSnapshot.count({ where: { source } });
    const ok = active <= 1;
    if (!ok) invariantHolds = false;
    console.log(`  ${source.padEnd(24)} active=${active} (must be <=1) total_snapshots=${total} ${ok ? 'OK' : 'VIOLATION'}`);
  }

  // Entities are only screenable through an active snapshot.
  const servable = await prisma.sanctionsEntity.count({ where: { is_active: true, snapshot: { is: { state: SanctionsSnapshotState.active } } } });
  const orphaned = await prisma.sanctionsEntity.count({ where: { snapshot_id: null } });
  console.log(`  entities served by an ACTIVE snapshot : ${servable}`);
  console.log(`  legacy entities with no snapshot      : ${orphaned} (never served — excluded by the active-snapshot join)`);

  console.log(`\n  invariant: ${invariantHolds ? 'HOLDS' : 'VIOLATED'}`);

  const activated = results.filter((r) => r.activated).length;
  console.log(`\n=== RESULT: ${activated}/${sources.length} sources activated; coverage complete=${coverage.complete} ===`);
  if (activated !== sources.length || !coverage.complete || !invariantHolds) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('LIVE VALIDATION CRASHED:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
