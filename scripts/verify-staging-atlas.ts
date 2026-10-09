/**
 * Customs Atlas staging acceptance — every engineering-complete sovereign, end to end, through the
 * deployed system:
 *
 *   enqueue `market_access_ingest` (platform job, origin IN)
 *     → the DEPLOYED worker claims and runs it (this script never runs a job itself)
 *     → snapshot persisted in the staging database
 *     → read back through the DEPLOYED web API as an ops user (GET /api/v1/jobs/:id)
 *     → the API result must equal the stored job result, and the stored snapshot must hold the
 *       Atlas invariants (no AVE invented, missing never zero, origin IN never confirms a preference,
 *       destination persisted as itself — Monaco is not France).
 *
 * Sovereign coverage is counted only over the sovereign ledger below; customs territories and
 * dependencies (AX, GG, IM, JE, PR) are never counted. Documented values are asserted only where the
 * repository's own canary scripts or qualification records state them.
 *
 *   STAGING_BASE_URL=https://… ATLAS_VERIFY_EMAIL=… ATLAS_VERIFY_PASSWORD=… \
 *     npx tsx --env-file=<staging operator env> scripts/verify-staging-atlas.ts [--only=QA,TN] [--out=report.json]
 *
 * Exit code 1 unless every requested sovereign passes.
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { JobStatus, JobType } from '@prisma/client';
import { DESTINATION_ADAPTERS } from '@/lib/job-handlers/market-access';
import { enqueueJob } from '@/lib/jobs';
import { prisma } from '@/lib/prisma';
import { validateDatabaseEnvironment } from '@/lib/runtime-config';

export const ACCEPTED_SOVEREIGNS = ['AL', 'AT', 'AU', 'BE', 'BG', 'BT', 'CA', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GB', 'GE', 'GR', 'HR', 'HU', 'IE', 'IL', 'IS', 'IT', 'JP', 'KR', 'LT', 'LU', 'LV', 'MT', 'MU', 'NL', 'NO', 'NP', 'NZ', 'OM', 'PE', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'TW', 'US'] as const;
export const STAGING_PENDING_SOVEREIGNS = ['LK', 'MC', 'ID', 'SA', 'QA', 'KW', 'UZ', 'VN', 'MA', 'TN'] as const;
/** Routed customs territories and dependencies: never sovereign coverage. */
export const NON_SOVEREIGN_ROUTES = ['AX', 'GG', 'IM', 'JE', 'PR'] as const;

interface Ctx {
  country: string;
  result: Record<string, unknown>;
  lines: { national_tariff_code: string; declarable: boolean; measure_kind: string; duty_kind: string; ad_valorem_rate_percent: unknown; specific_amount: unknown }[];
}
type Check = (ctx: Ctx) => string | null;
const num = (value: unknown) => value === null || value === undefined ? null : Number(value);
const lineAv = (code: string, rate: number): Check => (ctx) => ctx.lines.some((line) => line.national_tariff_code.startsWith(code) && line.duty_kind === 'ad_valorem' && num(line.ad_valorem_rate_percent) === rate) ? null : `no ${code}* line at ${rate}% ad valorem`;
const generalAv = (rate: number): Check => (ctx) => ctx.result.general_duty_kind === 'ad_valorem' && ctx.lines.some((line) => line.measure_kind === 'third_country_duty' && line.declarable && num(line.ad_valorem_rate_percent) === rate) ? null : `general duty is not ${rate}% ad valorem (${String(ctx.result.general_duty_expression)})`;
const generalKind = (kind: string): Check => (ctx) => ctx.result.general_duty_kind === kind ? null : `general duty kind ${String(ctx.result.general_duty_kind)}, expected ${kind}`;
const lineKind = (code: string, kind: string): Check => (ctx) => ctx.lines.some((line) => line.national_tariff_code.startsWith(code) && line.duty_kind === kind) ? null : `no ${code}* line of kind ${kind}`;
const resolution = (value: string): Check => (ctx) => ctx.result.classification_resolution === value ? null : `resolution ${String(ctx.result.classification_resolution)}, expected ${value}`;
const preference = (value: string): Check => (ctx) => ctx.result.india_preference_applicability === value ? null : `India preference ${String(ctx.result.india_preference_applicability)}, expected ${value}`;
const blankNotZero = (code: string): Check => (ctx) => ctx.lines.some((line) => line.national_tariff_code === code && line.measure_kind === 'third_country_duty' && line.declarable && num(line.ad_valorem_rate_percent) === 0) ? `${code} (blank in source) was served as 0%` : null;

/** One ordinary query per sovereign, plus the documented canaries. */
const EU_ORDINARY = '610910';
export const CASES: Record<string, { hs6: string; checks?: Check[] }[]> = {
  ...Object.fromEntries(['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'].map((country) => [country, [{ hs6: EU_ORDINARY }]])),
  MC: [{ hs6: EU_ORDINARY }, { hs6: '100630', checks: [resolution('classification_refinement_required')] }],
  GB: [{ hs6: '100630' }],
  US: [{ hs6: '460290', checks: [lineAv('4602', 3.5)] }],
  CA: [{ hs6: '610910' }], AU: [{ hs6: '610910' }], JP: [{ hs6: '610910' }], NO: [{ hs6: '610910' }], TW: [{ hs6: '610910' }],
  GE: [{ hs6: '610910' }], IL: [{ hs6: '610910' }], PE: [{ hs6: '100630' }],
  NZ: [{ hs6: '610910' }, { hs6: '020130' }],
  KR: [{ hs6: '270900', checks: [preference('potentially_applicable_requires_origin_proof')] }],
  IS: [{ hs6: '020110', checks: [generalKind('compound')] }],
  OM: [{ hs6: '240110', checks: [generalKind('mixed')] }],
  NP: [{ hs6: '010121', checks: [generalAv(10)] }], BT: [{ hs6: '010611', checks: [generalAv(10)] }],
  AL: [{ hs6: '010121', checks: [generalAv(2)] }], MU: [{ hs6: '010121', checks: [generalAv(0)] }],
  LK: [{ hs6: '030233', checks: [generalAv(20)] }],
  ID: [{ hs6: '100630' }, { hs6: '610910' }],
  SA: [{ hs6: '841810', checks: [lineAv('841810', 10)] }, { hs6: '120110', checks: [lineAv('120110000000', 0)] }],
  QA: [{ hs6: '850710', checks: [lineAv('850710', 5)] }, { hs6: '120110', checks: [lineAv('120110000000', 0)] }],
  KW: [{ hs6: '120110', checks: [lineAv('120110000000', 0)] }],
  UZ: [{ hs6: '100630', checks: [lineAv('100630', 0)] }, { hs6: '640399', checks: [lineKind('640399', 'mixed')] }],
  VN: [{ hs6: '100630' }, { hs6: '040721' }],
  MA: [{ hs6: '091020', checks: [lineAv('091020', 60)] }],
  TN: [{ hs6: '900311', checks: [lineAv('90031100003', 10)] }, { hs6: '270900', checks: [blankNotZero('27090090967')] }],
};

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);

async function login(base: string, email: string, password: string) {
  const cookies = new Map<string, string>();
  const keep = (response: Response) => { for (const header of response.headers.getSetCookie()) { const [pair] = header.split(';'); const index = pair!.indexOf('='); cookies.set(pair!.slice(0, index), pair!.slice(index + 1)); } };
  const jar = () => [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  const csrf = await fetch(`${base}/api/auth/csrf`); keep(csrf);
  const { csrfToken } = await csrf.json() as { csrfToken: string };
  const signed = await fetch(`${base}/api/auth/callback/credentials`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar() }, body: new URLSearchParams({ csrfToken, email, password, callbackUrl: base }) });
  keep(signed);
  if (![...cookies.keys()].some((name) => name.includes('session-token'))) throw new Error(`Login failed for ${email} (HTTP ${signed.status}).`);
  return jar();
}

async function main() {
  const database = validateDatabaseEnvironment('worker');
  if (database.environment !== 'staging') throw new Error('verify-staging-atlas runs only against staging.');
  const base = (process.env.STAGING_BASE_URL ?? '').replace(/\/$/, '');
  if (!/^https:\/\//.test(base)) throw new Error('STAGING_BASE_URL must be the https staging origin.');
  const cookie = await login(base, process.env.ATLAS_VERIFY_EMAIL ?? '', process.env.ATLAS_VERIFY_PASSWORD ?? '');
  const only = arg('only')?.split(',').map((code) => code.trim().toUpperCase());
  const sovereigns = [...ACCEPTED_SOVEREIGNS, ...STAGING_PENDING_SOVEREIGNS].filter((code) => !only || only.includes(code));
  const run = randomUUID().slice(0, 8);

  const routing = sovereigns.filter((code) => !DESTINATION_ADAPTERS[code]);
  if (routing.length) throw new Error(`Sovereigns without a provider route: ${routing.join(', ')}.`);

  // Enqueue every case; the deployed worker processes them.
  const jobs: { country: string; hs6: string; checks: Check[]; job_id: string }[] = [];
  for (const country of sovereigns) {
    for (const entry of CASES[country] ?? []) {
      const job = await enqueueJob({ type: JobType.market_access_ingest, payload: { country_code: country, hs_code: entry.hs6, origin_country: 'IN' }, dedupe_key: `staging-atlas:${run}:${country}:${entry.hs6}` });
      jobs.push({ country, hs6: entry.hs6, checks: entry.checks ?? [], job_id: job.id });
    }
  }
  const probes = {
    invalid_hs: (await enqueueJob({ type: JobType.market_access_ingest, payload: { country_code: 'NZ', hs_code: '12345', origin_country: 'IN' }, dedupe_key: `staging-atlas:${run}:probe:hs` })).id,
    unknown_destination: (await enqueueJob({ type: JobType.market_access_ingest, payload: { country_code: 'ZZ', hs_code: '610910', origin_country: 'IN' }, dedupe_key: `staging-atlas:${run}:probe:zz` })).id,
  };
  const waitIds = [...jobs.map((job) => job.job_id), ...Object.values(probes)];
  const deadline = Date.now() + Number(arg('timeout-min') ?? 45) * 60_000;
  for (;;) {
    const open = await prisma.job.count({ where: { id: { in: waitIds }, status: { in: [JobStatus.queued, JobStatus.processing] } } });
    if (!open) break;
    if (Date.now() > deadline) throw new Error(`${open} jobs still open at the deadline; is the deployed worker running?`);
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }

  const report: Record<string, { pass: boolean; cases: unknown[] }> = {};
  for (const job of jobs) {
    const problems: string[] = [];
    const stored = await prisma.job.findUniqueOrThrow({ where: { id: job.job_id } });
    const response = await fetch(`${base}/api/v1/jobs/${job.job_id}`, { headers: { cookie } });
    const api = response.ok ? (await response.json() as { data?: { result?: Record<string, unknown>; status?: string } }).data : null;
    if (!api) problems.push(`deployed API returned HTTP ${response.status}`);
    else if (JSON.stringify(api.result) !== JSON.stringify(stored.result)) problems.push('deployed API result differs from the stored job result');
    const result = (stored.result ?? {}) as Record<string, unknown>;
    if (stored.status !== JobStatus.completed) problems.push(`job ${stored.status}: ${String((result as { error?: string }).error ?? stored.error_message ?? '')}`);
    if (result.provider_state !== 'authoritative_public') problems.push(`provider_state ${String(result.provider_state)}`);
    if (result.india_preference_applicability === 'confirmed_applicable') problems.push('origin IN produced a confirmed preference');
    let lines: Ctx['lines'] = [];
    if (typeof result.snapshot_id === 'string') {
      const snapshot = await prisma.marketAccessEvidenceSnapshot.findUnique({ where: { id: result.snapshot_id }, include: { tariff_lines: true, evidence: true } });
      if (!snapshot) problems.push('snapshot not persisted');
      else {
        if (snapshot.country_code !== job.country) problems.push(`snapshot stored as ${snapshot.country_code}`);
        lines = snapshot.tariff_lines.map((line) => ({ national_tariff_code: line.national_tariff_code, declarable: line.declarable, measure_kind: line.measure_kind, duty_kind: line.duty_kind, ad_valorem_rate_percent: line.ad_valorem_rate_percent, specific_amount: line.specific_amount }));
        if (snapshot.tariff_lines.some((line) => ['specific', 'none', 'unparsed'].includes(line.duty_kind) && line.ad_valorem_rate_percent !== null)) problems.push('a non-ad-valorem line carries a percentage');
        if (snapshot.evidence.some((entry) => entry.duty_kind && entry.duty_kind !== 'ad_valorem' && entry.tariff_rate_percent !== null)) problems.push('an evidence row invents an ad-valorem rate');
      }
    } else problems.push('no snapshot id');
    if (!problems.length) for (const check of job.checks) { const problem = check({ country: job.country, result, lines }); if (problem) problems.push(problem); }
    const entry = report[job.country] ??= { pass: true, cases: [] };
    entry.cases.push({ hs6: job.hs6, job_id: job.job_id, problems, provider: result.provider, resolution: result.classification_resolution, general_duty: result.general_duty_expression, general_kind: result.general_duty_kind, india_preference: result.india_preference_applicability, tariff_lines: result.tariff_line_count });
    if (problems.length) entry.pass = false;
  }

  // Fail-closed and authorization probes.
  const probeState = async (id: string) => (await prisma.job.findUniqueOrThrow({ where: { id } })).status;
  const unauthenticated = await fetch(`${base}/api/v1/jobs/${jobs[0]?.job_id ?? 'x'}`);
  const missing = await fetch(`${base}/api/v1/jobs/does-not-exist`, { headers: { cookie } });
  const failClosed = {
    invalid_hs_job: await probeState(probes.invalid_hs), unknown_destination_job: await probeState(probes.unknown_destination),
    unauthenticated_status: unauthenticated.status, missing_job_status: missing.status,
  };
  const failClosedPass = failClosed.invalid_hs_job === JobStatus.failed && failClosed.unknown_destination_job === JobStatus.failed && failClosed.unauthenticated_status === 401 && failClosed.missing_job_status === 404;

  const accepted = ACCEPTED_SOVEREIGNS.filter((code) => report[code]?.pass);
  const pending = STAGING_PENDING_SOVEREIGNS.filter((code) => report[code]?.pass);
  const summary = {
    run, base, accepted_working: `${accepted.length}/${ACCEPTED_SOVEREIGNS.length}`, staging_pending_working: `${pending.length}/${STAGING_PENDING_SOVEREIGNS.length}`,
    total_sovereigns_working: `${accepted.length + pending.length}/${ACCEPTED_SOVEREIGNS.length + STAGING_PENDING_SOVEREIGNS.length}`,
    non_sovereign_routes_excluded: NON_SOVEREIGN_ROUTES, fail_closed: { ...failClosed, pass: failClosedPass },
    failed: Object.entries(report).filter(([, value]) => !value.pass).map(([country, value]) => ({ country, cases: value.cases })),
    pending_detail: Object.fromEntries(STAGING_PENDING_SOVEREIGNS.map((code) => [code, report[code] ?? null])),
  };
  if (arg('out')) writeFileSync(arg('out')!, JSON.stringify({ summary, report }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  const requested = sovereigns.length;
  if (accepted.length + pending.length !== requested || !failClosedPass) process.exitCode = 1;
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
