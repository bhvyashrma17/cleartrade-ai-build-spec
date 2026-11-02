/**
 * Phase 1 acceptance gate (docs/34) — a read-only evaluator over finished Demand Discovery v5 runs on
 * staging. Policy v2 checks v5 runs only (D-036): a run from an earlier engine fails.
 *
 * Name one finished v5 run per archetype in the gate policy, either directly or by product (the newest
 * completed/partial v5 run for the product's current confirmed classification).
 * `scripts/dd5-archetype-runs.ts status` prints both. The script reads every record those runs
 * produced inside a single REPEATABLE READ, READ ONLY transaction — PostgreSQL rejects any write —
 * compares each run's top 10 with India's own largest destinations (docs/36 §8), evaluates the gate,
 * and prints the machine-readable report.
 *
 *   npx tsx --env-file=<staging operator env> scripts/gate-phase-1.ts \
 *     --archetype=rice=product:<productId> \
 *     --archetype=brassware=run:<discoveryRunId> \
 *     --archetype=carpets=product:<productId> \
 *     [--negative-probes=probes.json] [--evaluated-at=2026-11-02T09:00:00Z] [--out=report.json]
 *
 * Named `gate-*`, not `verify-*`: `src/lib/prisma.ts` refuses `verify-*` entrypoints against real
 * databases because those are fixture verifiers. This reads real staging evidence and writes
 * nothing. It refuses production: Phase 1 is gated on staging evidence (roadmap WP1/WP6).
 *
 * Exit codes: 0 PASS under an approved policy · 10 PASS_UNDER_PROPOSED_POLICY · 1 FAIL ·
 * 2 INCOMPLETE · 3 usage or load error. Only 0 is a release pass, and even 0 does not freeze
 * Phase 1: that needs the named sign-offs recorded in docs/35.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { prisma } from '@/lib/prisma';
import { validateDatabaseEnvironment } from '@/lib/runtime-config';
import {
  evaluatePhase1Gate,
  phase1GateExitCode,
  stableJson,
  type GateArchetypeEvidence,
  type GateNegativeProbe,
} from '@/lib/phase-1-gate/evaluate';
import { loadPhase1GateArchetypeEvidence, parseGateSelector, withReadOnlySnapshot, type GateSelector } from '@/lib/phase-1-gate/load';
import { PHASE_1_GATE_POLICY_V3 } from '@/lib/phase-1-gate/policy';

const USAGE = 'Usage: gate-phase-1.ts --archetype=<key>=product:<id>|run:<id> [...] [--negative-probes=<file.json>] [--evaluated-at=<ISO>] [--out=<file.json>]';

function args() {
  const archetypes: Array<{ key: string; selector: GateSelector }> = [];
  let probes: string | null = null;
  let evaluatedAt: string | null = null;
  let out: string | null = null;
  for (const arg of process.argv.slice(2)) {
    const [flag, ...rest] = arg.split('=');
    const value = rest.join('=');
    if (flag === '--archetype') {
      const separator = value.indexOf('=');
      if (separator < 1) throw new Error(`--archetype needs <key>=<selector>. ${USAGE}`);
      archetypes.push({ key: value.slice(0, separator), selector: parseGateSelector(value.slice(separator + 1)) });
    } else if (flag === '--negative-probes' && value) probes = value;
    else if (flag === '--evaluated-at' && value) evaluatedAt = value;
    else if (flag === '--out' && value) out = value;
    else throw new Error(`Unknown argument ${arg}. ${USAGE}`);
  }
  return { archetypes, probes, evaluatedAt, out };
}

function readProbes(path: string): GateNegativeProbe[] {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed) || parsed.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry))) {
    throw new Error(`${path} must be a JSON array of negative-probe records (docs/34 §6.3).`);
  }
  return parsed as GateNegativeProbe[];
}

function gitCommit(): string | null {
  const fromEnv = process.env.GIT_COMMIT?.trim() || process.env.RAILWAY_GIT_COMMIT_SHA?.trim();
  if (fromEnv) return fromEnv;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

async function main() {
  const options = args();
  const policy = PHASE_1_GATE_POLICY_V3;
  const known = policy.archetypes.value.map((archetype) => archetype.key);
  const named = options.archetypes.map((item) => item.key);
  const unknown = named.filter((key) => !known.includes(key));
  if (unknown.length) throw new Error(`Unknown archetype(s) ${unknown.join(', ')}; policy ${policy.policy_version} defines ${known.join(', ')}.`);
  if (new Set(named).size !== named.length) throw new Error('Each archetype may be named once.');

  const database = validateDatabaseEnvironment('worker');
  if (database.environment === 'production') throw new Error('The Phase 1 gate evaluates staging evidence and refuses production.');

  const evaluatedAt = options.evaluatedAt ? new Date(options.evaluatedAt) : new Date();
  if (Number.isNaN(evaluatedAt.getTime())) throw new Error('--evaluated-at must be an ISO timestamp.');
  const probes = options.probes ? readProbes(options.probes) : null;

  const evidence = await withReadOnlySnapshot(prisma, async (db) => {
    const loaded: GateArchetypeEvidence[] = [];
    // One archetype at a time: queries inside an interactive transaction are serialised anyway.
    for (const item of options.archetypes) loaded.push(await loadPhase1GateArchetypeEvidence(db, item.key, item.selector, { calibration_top: policy.calibration.value.top }));
    return loaded;
  }, { timeout_ms: 600_000 }); // the calibration reads three years of BACI partitions per run

  const report = evaluatePhase1Gate({
    policy,
    evidence,
    negative_probes: probes,
    evaluated_at: evaluatedAt,
    environment: {
      app_env: database.environment,
      database_environment: process.env.DATABASE_ENVIRONMENT?.trim() || null,
      database_fingerprint_prefix: database.database_fingerprint.slice(0, 12),
      git_commit: gitCommit(),
    },
  });
  const output = stableJson(report);
  if (options.out) writeFileSync(options.out, output);
  process.stdout.write(output);
  process.stderr.write(
    `Phase 1 gate ${report.verdict} (policy ${report.policy.policy_version}${report.policy.approved ? '' : ', unapproved'}); ` +
      `${report.summary.archetypes_passed}/${report.summary.archetypes_required} archetypes pass; ` +
      `${report.summary.failed_checks.length} failed, ${report.summary.unverified_checks.length} unverified; report ${report.report_checksum.slice(0, 12)}.\n`,
  );
  process.exitCode = phase1GateExitCode(report.verdict);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 3;
  })
  .finally(() => prisma.$disconnect());
