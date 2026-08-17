/**
 * Verification: the Comtrade warehouse ingest layer.
 *
 * Per the AGENTS.md rule ("seeded fixtures hand-place END states, so the transitions into
 * them go unexercised"): this drives the ingest through the REAL job system — enqueue,
 * claim, run — using the mock Comtrade client (no network access in this environment),
 * never by hand-inserting TradeFlow/IngestRun rows. Standalone: does not require
 * `npm run dev` or `npm run worker`, mirroring how `scripts/ingest-comtrade.ts` itself
 * drains its own job inline.
 *
 *   npx tsx --env-file=.env scripts/verify-comtrade-ingest.ts
 *
 * Checks:
 *   1. Idempotency — running the identical ingest twice does not duplicate TradeFlow rows.
 *   2. IngestRun records both runs (two rows, each reflecting its own attempt).
 *   3. unit_value is computed correctly at ingest time.
 *   4. No API route references the TradeFlow model — the non-negotiable server-side-only
 *      rule is enforced by omission, and this greps the route tree to keep it that way.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { IngestStatus, JobType, Prisma, TradeDataSource } from '@prisma/client';
import { registerAllJobHandlers } from '../src/lib/job-handlers';
import { claimNextJob, enqueueJob, runClaimedJob } from '../src/lib/jobs';
import { prisma } from '../src/lib/prisma';
import { ComtradeRateLimitError, setComtradeClient } from '../src/lib/comtrade';
import { reserveProviderQuota } from '../src/lib/provider-quota';

type Status = 'PASS' | 'FAIL';
const results: { id: string; name: string; status: Status; detail: string }[] = [];

function record(id: string, name: string, status: Status, detail: string) {
  results.push({ id, name, status, detail });
  console.log(`[${status}] ${id} ${name}\n    ${detail}`);
}

async function scenario(id: string, name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    record(id, name, 'FAIL', `threw: ${message}`);
  }
}

function summarize(title: string) {
  console.log(`\n================ ${title} ================`);
  const pass = results.filter((r) => r.status === 'PASS');
  const fail = results.filter((r) => r.status === 'FAIL');
  console.log(`${pass.length} passed, ${fail.length} failed (of ${results.length})`);
  if (fail.length) {
    console.log('\nFailures:');
    for (const f of fail) console.log(`  ${f.id} ${f.name}\n    ${f.detail}`);
  }
  console.log('================================================\n');
  if (fail.length) process.exitCode = 1;
}

/** Walk src/app/api and return every file whose source references the TradeFlow model. */
function findTradeFlowReferencesInRoutes(root: string): string[] {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry)) {
        const src = readFileSync(full, 'utf8');
        if (/\btradeFlow\b/i.test(src)) hits.push(full);
      }
    }
  };
  walk(root);
  return hits;
}

async function runIngestOnce(payload: Record<string, unknown>) {
  const job = await enqueueJob({
    type: JobType.comtrade_ingest,
    payload: payload as Prisma.InputJsonValue,
    dedupe_key: `verify-comtrade:${Date.now()}:${Math.random()}`,
  });
  let claimed = await claimNextJob([JobType.comtrade_ingest]);
  while (claimed) {
    await runClaimedJob({
      id: claimed.id,
      type: claimed.type,
      attempt_no: claimed.attempt_no,
      payload: claimed.payload,
      exporter_org_id: claimed.exporter_org_id,
      target_id: claimed.target_id,
      correlation_id: claimed.correlation_id,
    });
    claimed = await claimNextJob([JobType.comtrade_ingest]);
  }
  return prisma.job.findUnique({ where: { id: job.id } });
}

const HS_CHAPTER = '09';
const REPORTER = '699';
const PARTNER = '0';
const YEAR = 2099; // out-of-range test year: cheap isolation from any other data in the table

async function cleanup() {
  await prisma.providerQuotaWindow.deleteMany({ where: { credential_fingerprint: { startsWith: 'verify-' } } });
  await prisma.tradeFlowAcquisition.deleteMany({ where: { reporter: REPORTER, partner: PARTNER, hs_code: { startsWith: HS_CHAPTER }, year: YEAR } });
  await prisma.tradeFlow.deleteMany({ where: { reporter: REPORTER, partner: PARTNER, hs_code: { startsWith: HS_CHAPTER }, year: YEAR } });
  await prisma.ingestRun.deleteMany({
    where: { source: TradeDataSource.comtrade, params: { path: ['year'], equals: YEAR } },
  });
}

async function main() {
  registerAllJobHandlers();
  await cleanup();

  try {
    let firstJobResult: { records_written?: number; ingest_run_id?: string } | null = null;

    await scenario('COMTRADE-1', 'First ingest run writes TradeFlow rows and a completed IngestRun', async () => {
      const job = await runIngestOnce({ hs_chapter: HS_CHAPTER, reporter: REPORTER, partner: PARTNER, year: YEAR });
      firstJobResult = job?.result as typeof firstJobResult;

      const rowCount = await prisma.tradeFlow.count({ where: { reporter: REPORTER, partner: PARTNER, year: YEAR } });
      const ingestRun = firstJobResult?.ingest_run_id
        ? await prisma.ingestRun.findUnique({ where: { id: firstJobResult.ingest_run_id } })
        : null;

      const pass =
        job?.status === 'completed' &&
        rowCount > 0 &&
        rowCount === firstJobResult?.records_written &&
        ingestRun?.status === IngestStatus.completed &&
        ingestRun?.records_written === rowCount;

      record(
        'COMTRADE-1',
        'First ingest run writes TradeFlow rows and a completed IngestRun',
        pass ? 'PASS' : 'FAIL',
        `job status=${job?.status}; TradeFlow rows written=${rowCount}; IngestRun status=${ingestRun?.status}, records_written=${ingestRun?.records_written}`,
      );
    });

    await scenario('COMTRADE-2', 'unit_value computed correctly at ingest time', async () => {
      const withQty = await prisma.tradeFlow.findFirst({
        where: { reporter: REPORTER, partner: PARTNER, year: YEAR, quantity: { not: null } },
      });
      const expected = withQty ? Number(withQty.value) / Number(withQty.quantity) : null;
      const actual = withQty?.unit_value != null ? Number(withQty.unit_value) : null;
      const pass = withQty != null && actual != null && expected != null && Math.abs(actual - expected) < 1e-6;

      record(
        'COMTRADE-2',
        'unit_value computed correctly at ingest time',
        pass ? 'PASS' : 'FAIL',
        `row hs_code=${withQty?.hs_code}; value=${withQty?.value}; quantity=${withQty?.quantity}; stored unit_value=${actual}; expected=${expected}`,
      );
    });

    await scenario('COMTRADE-2B', 'missing quantity persists as null and is never divided', async () => {
      const missing = await prisma.tradeFlow.findFirst({
        where: { reporter: REPORTER, partner: PARTNER, year: YEAR, quantity: null },
      });
      const pass = missing != null && missing.unit_value == null && missing.unit == null;
      record('COMTRADE-2B', 'missing quantity persists as null and is never divided', pass ? 'PASS' : 'FAIL',
        `row hs_code=${missing?.hs_code}; quantity=${missing?.quantity}; unit=${missing?.unit}; unit_value=${missing?.unit_value}`);
    });

    await scenario('COMTRADE-2C', 'IngestRun durably records HS6 progress', async () => {
      const run = firstJobResult?.ingest_run_id ? await prisma.ingestRun.findUnique({ where: { id: firstJobResult.ingest_run_id } }) : null;
      const progress = run?.progress as { hs_codes?: string[]; next_index?: number } | null;
      const pass = !!run && run.total_codes > 0 && run.completed_codes === run.total_codes && progress?.next_index === run.total_codes && progress.hs_codes?.every((code) => /^\d{6}$/.test(code));
      record('COMTRADE-2C', 'IngestRun durably records HS6 progress', pass ? 'PASS' : 'FAIL',
        `total=${run?.total_codes}; completed=${run?.completed_codes}; next_index=${progress?.next_index}; requests=${run?.request_count}`);
    });

    await scenario('COMTRADE-2D', 'every newly ingested row carries source mode and exact IngestRun lineage', async () => {
      const runId=firstJobResult?.ingest_run_id;
      const rows=runId?await prisma.tradeFlow.findMany({where:{ingest_run_id:runId}}):[];
      const acquisitions=runId?await prisma.tradeFlowAcquisition.findMany({where:{ingest_run_id:runId}}):[];
      const run=runId?await prisma.ingestRun.findUnique({where:{id:runId}}):null;
      const pass=rows.length>0&&acquisitions.length===rows.length&&run?.client_mode==='mock'&&run.authenticated===false&&rows.every(row=>row.source_mode==='mock'&&row.provider==='un_comtrade'&&row.ingest_run_id===runId&&row.retrieved_at instanceof Date&&row.request_batch_id)&&acquisitions.every(item=>item.source_mode==='mock'&&item.ingest_run_id===runId);
      record('COMTRADE-2D','every newly ingested row carries source mode and exact IngestRun lineage',pass?'PASS':'FAIL',`rows=${rows.length}; immutable_acquisitions=${acquisitions.length}; run_mode=${run?.client_mode}; authenticated=${run?.authenticated}; all_linked=${rows.every(row=>row.ingest_run_id===runId)}`);
    });

    await scenario('COMTRADE-3', 'Rerunning the identical ingest is idempotent — no duplicate TradeFlow rows, second IngestRun recorded', async () => {
      const countBefore = await prisma.tradeFlow.count({ where: { reporter: REPORTER, partner: PARTNER, year: YEAR } });
      const ingestRunCountBefore = await prisma.ingestRun.count({ where: { source: TradeDataSource.comtrade, params: { path: ['year'], equals: YEAR } } });

      const job2 = await runIngestOnce({ hs_chapter: HS_CHAPTER, reporter: REPORTER, partner: PARTNER, year: YEAR });
      const secondResult = job2?.result as typeof firstJobResult;

      const countAfter = await prisma.tradeFlow.count({ where: { reporter: REPORTER, partner: PARTNER, year: YEAR } });
      const acquisitionCount = await prisma.tradeFlowAcquisition.count({ where: { reporter: REPORTER, partner: PARTNER, year: YEAR } });
      const ingestRunCountAfter = await prisma.ingestRun.count({ where: { source: TradeDataSource.comtrade, params: { path: ['year'], equals: YEAR } } });

      const pass =
        job2?.status === 'completed' &&
        countAfter === countBefore && // no duplicates
        secondResult?.records_written === countBefore && // second run touched the same N rows
        ingestRunCountAfter === ingestRunCountBefore + 1 && // a NEW IngestRun row for this attempt
        acquisitionCount === countAfter * 2; // immutable evidence from both acquisitions survives

      record(
        'COMTRADE-3',
        'Rerunning the identical ingest is idempotent — no duplicate TradeFlow rows, second IngestRun recorded',
        pass ? 'PASS' : 'FAIL',
        `TradeFlow rows before=${countBefore}, after second run=${countAfter} (must be equal); immutable acquisitions=${acquisitionCount}; IngestRun rows before=${ingestRunCountBefore}, after=${ingestRunCountAfter} (must be +1); second run records_written=${secondResult?.records_written}`,
      );
    });

    await scenario('COMTRADE-4', 'No API route references the TradeFlow model — server-side-only rule holds', async () => {
      const hits = findTradeFlowReferencesInRoutes(join(process.cwd(), 'src/app/api'));
      const pass = hits.length === 0;
      record(
        'COMTRADE-4',
        'No API route references the TradeFlow model — server-side-only rule holds',
        pass ? 'PASS' : 'FAIL',
        pass ? 'grep of src/app/api for `tradeFlow` found nothing' : `found references in: ${hits.join(', ')}`,
      );
    });

    await scenario('COMTRADE-5', 'provider throttling is recorded as resumable state, not a failed ingest', async () => {
      setComtradeClient({
        name: 'throttle-verifier',
        identity: { provider: 'un_comtrade', mode: 'fixture', authenticated: false, credential_fingerprint: 'verify-throttle', source_dataset: 'verification-fixture', source_dataset_version: 'v1' },
        async resolveChapter(chapter: string) { return { chapter, hs_codes: ['090111'] }; },
        async fetchChapter() { throw new ComtradeRateLimitError('verification throttle', 60_000); },
      });
      const job = await runIngestOnce({ hs_chapter: HS_CHAPTER, reporter: REPORTER, partner: PARTNER, year: YEAR });
      const result = job?.result as { ingest_run_id?: string; throttled?: boolean } | null;
      const run = result?.ingest_run_id ? await prisma.ingestRun.findUnique({ where: { id: result.ingest_run_id } }) : null;
      const progress = run?.progress as { next_index?: number } | null;
      const pass = job?.status === 'partial' && result?.throttled === true && run?.status === IngestStatus.throttled && run.throttle_count === 1 && progress?.next_index === 0 && run.retry_after != null;
      record('COMTRADE-5', 'provider throttling is recorded as resumable state, not a failed ingest', pass ? 'PASS' : 'FAIL',
        `job=${job?.status}; ingest=${run?.status}; throttle_count=${run?.throttle_count}; next_index=${progress?.next_index}; retry_after=${run?.retry_after?.toISOString()}`);
      setComtradeClient(null);
    });

    await scenario('COMTRADE-6', 'persistent local quota exhaustion is recorded and resumable', async()=>{
      const fingerprint=`verify-local-${Date.now()}`;
      await reserveProviderQuota({provider:'un_comtrade',credential_fingerprint:fingerprint,configured_limit:450,request_count:450});
      setComtradeClient({name:'local-quota-verifier',identity:{provider:'un_comtrade',mode:'fixture',authenticated:false,credential_fingerprint:fingerprint,source_dataset:'verification-fixture',source_dataset_version:'v1'},async resolveChapter(chapter){return {chapter,hs_codes:['090111']};},async fetchChapter(){throw new Error('must not call provider after local exhaustion');}});
      const job=await runIngestOnce({hs_chapter:HS_CHAPTER,reporter:REPORTER,partner:PARTNER,year:YEAR});
      const result=job?.result as {ingest_run_id?:string;throttled?:boolean}|null;
      const run=result?.ingest_run_id?await prisma.ingestRun.findUnique({where:{id:result.ingest_run_id}}):null;
      const pass=job?.status==='partial'&&result?.throttled===true&&run?.status===IngestStatus.throttled&&run.local_quota_throttle_count===1&&run.throttle_count===1&&run.retry_after!=null;
      record('COMTRADE-6','persistent local quota exhaustion is recorded and resumable',pass?'PASS':'FAIL',`job=${job?.status}; ingest=${run?.status}; local_throttles=${run?.local_quota_throttle_count}; total_throttles=${run?.throttle_count}`);
      await prisma.providerQuotaWindow.deleteMany({where:{credential_fingerprint:fingerprint}});setComtradeClient(null);
    });

    await scenario('COMTRADE-7', 'failed IngestRun produces a failed Job',async()=>{
      setComtradeClient({name:'failure-verifier',identity:{provider:'un_comtrade',mode:'fixture',authenticated:false,credential_fingerprint:`verify-failure-${Date.now()}`,source_dataset:'verification-fixture',source_dataset_version:'v1'},async resolveChapter(chapter){return {chapter,hs_codes:['090111']};},async fetchChapter(){throw new Error('verification provider failure');}});
      const job=await runIngestOnce({hs_chapter:HS_CHAPTER,reporter:REPORTER,partner:PARTNER,year:YEAR});
      const result=job?.result as {ingest_run_id?:string;ingest_status?:string}|null;
      const run=result?.ingest_run_id?await prisma.ingestRun.findUnique({where:{id:result.ingest_run_id}}):null;
      const pass=job?.status==='failed'&&run?.status===IngestStatus.failed&&result?.ingest_status==='failed';
      record('COMTRADE-7','failed IngestRun produces a failed Job',pass?'PASS':'FAIL',`job=${job?.status}; ingest=${run?.status}; job_error=${job?.error_code}`);setComtradeClient(null);
    });
  } finally {
    await cleanup();
  }

  summarize('COMTRADE INGEST VERIFICATION');
}

main()
  .catch((e) => {
    console.error('SUITE CRASHED:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
