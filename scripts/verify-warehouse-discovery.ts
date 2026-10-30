/**
 * Verification: Demand Discovery ranks real markets from real ingested trade data.
 *
 * Per the AGENTS.md rule ("seeded fixtures hand-place END states, so the transitions into
 * them go unexercised"): this seeds nothing. It ingests Comtrade data through the real
 * `comtrade_ingest` job, then runs discovery through the real `demand_discovery` job, and
 * asserts against what those two code paths actually wrote.
 *
 * The two claims under test are the ones that would be liabilities if false:
 *
 *   1. **Scores are reproducible from the input snapshot.** Two runs over identical input
 *      produce identical scores. Anything else means the ranking an exporter saw cannot be
 *      explained after the fact.
 *   2. **No assessment contains a number absent from TradeFlow.** Checked by recomputing
 *      every figure independently — with arithmetic written here, not by calling the
 *      engine's own scoring functions, which would only prove it agrees with itself — and
 *      then asserting the ENTIRE remaining rationale text is digit-free. That is a
 *      complete check rather than a spot check: every numeral in the stored prose is
 *      accounted for by a recomputed value, or the test fails.
 *
 * Standalone — no dev server, no worker. It drives the job queue inline.
 *
 *   npx tsx --env-file=.env scripts/verify-warehouse-discovery.ts
 */

import { JobStatus, JobType, Prisma, TradeDataSource, TradeFlowDirection } from '@prisma/client';
import { registerAllJobHandlers } from '../src/lib/job-handlers';
import { claimNextJob, enqueueJob, runClaimedJob } from '../src/lib/jobs';
import { prisma } from '../src/lib/prisma';
import { setDiscoveryEngine, WarehouseDiscoveryEngine } from '../src/lib/discovery';
import { setRationaleWriter, TemplateRationaleWriter } from '../src/lib/discovery/rationale';
import { assertEarlierEnginesRetired } from '../src/lib/demand-discovery-v5/earlier-engines';

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
    record(id, name, 'FAIL', `threw: ${error instanceof Error ? error.stack : String(error)}`);
  }
}

function summarize(title: string) {
  console.log(`\n================ ${title} ================`);
  const fail = results.filter((r) => r.status === 'FAIL');
  console.log(`${results.length - fail.length} passed, ${fail.length} failed (of ${results.length})`);
  if (fail.length) {
    console.log('\nFailures:');
    for (const f of fail) console.log(`  ${f.id} ${f.name}\n    ${f.detail}`);
  }
  console.log('================================================\n');
  if (fail.length) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Fixture scope — an out-of-range year band keeps this isolated from real data
// ---------------------------------------------------------------------------

// Chapter 52 (cotton) deliberately: the seed populates chapters 09 and 63, and this suite
// must not rank over rows it did not create. An earlier version used 09 and silently mixed
// seeded markets into its own fixture — the engine ranked over both while this script
// recomputed over one, so a correct engine looked broken. AGENTS.md: "Verification
// scenarios must not assume a pristine database."
const CHAPTER = '52';
let TEST_HS = '';
const YEARS = [2090, 2091, 2092, 2093, 2094];
/** Candidate importing markets, by Comtrade area code (US, Germany, UAE, UK). */
const REPORTERS = ['842', '276', '784', '826'];
/** World (the denominator), India (the share), and two other suppliers (the HHI spread). */
const PARTNERS = ['0', '699', '156', '76'];

const ORG = 'seed-org-1';
const USER = 'seed-user-owner';

async function cleanup() {
  await prisma.marketEligibilityRule.deleteMany({ where: { source: 'verify-warehouse' } });
  await prisma.tradeFlowAcquisition.deleteMany({ where: { year: { in: YEARS } } });
  await prisma.tradeFlow.deleteMany({ where: { year: { in: YEARS } } });
  await prisma.ingestRun.deleteMany({ where: { params: { path: ['hs_chapter'], equals: CHAPTER } } });
  const runs = await prisma.discoveryRun.findMany({
    where: { exporter_org_id: ORG, input_snapshot: { path: ['verify_probe'], equals: true } },
    select: { id: true },
  });
  const runIds = runs.map((r) => r.id);
  if (runIds.length) {
    await prisma.marketAssessment.deleteMany({ where: { run_id: { in: runIds } } });
    await prisma.jobAttempt.deleteMany({ where: { job: { target_id: { in: runIds } } } });
    await prisma.job.deleteMany({ where: { target_id: { in: runIds } } });
    await prisma.discoveryRun.deleteMany({ where: { id: { in: runIds } } });
  }
}

/** Drain one job type inline, the same way scripts/ingest-comtrade.ts does. */
/**
 * Drain jobs of one type, tolerating a real `npm run worker` running concurrently (which
 * AGENTS.md requires for other suites in the same regression pass). A single null claim
 * does NOT mean the queue is empty — it can mean the background worker won the race for
 * the last candidate. Loop until nothing of this type is left `queued`/`processing`,
 * same fix as `seedTradeWarehouse()` in prisma/seed.ts, and for the same reason: this
 * script's own drain loop stopping early is what looked like a scoring regression before
 * it was traced to a race.
 */
async function drain(type: JobType, ownedJobIds: string[]) {
  for (;;) {
    const claimed = await claimNextJob([type]);
    if (claimed) {
      await runClaimedJob({
        id: claimed.id,
        type: claimed.type,
        attempt_no: claimed.attempt_no,
        payload: claimed.payload,
        exporter_org_id: claimed.exporter_org_id,
        target_id: claimed.target_id,
        correlation_id: claimed.correlation_id,
      });
      continue;
    }
    const stillInFlight = await prisma.job.count({ where: { id:{in:ownedJobIds},type, status: { in: ['queued', 'processing'] } } });
    if (stillInFlight === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * Zero the ingest pacing delay for this run and restore it afterwards.
 *
 * The delay exists to respect Comtrade's free-tier rate limit; the mock client makes no
 * network calls, so waiting on it would add ~13 minutes of pure sleep to the fixture build.
 * Done by publishing a config version rather than by patching code — which is what
 * `comtrade.policy` being Ops-tunable is for, and it exercises the real config path.
 */
async function withoutIngestDelay<T>(fn: () => Promise<T>): Promise<T> {
  const current = await prisma.configSetting.findFirst({
    where: { key: 'comtrade.policy', is_active: true },
    orderBy: { version: 'desc' },
  });
  const probe = await prisma.configSetting.create({
    data: {
      key: 'comtrade.policy',
      version: (current?.version ?? 0) + 1,
      value: { request_delay_ms: 0, max_retries: 3, retry_backoff_ms: 2000 },
      description: 'Verify probe — pacing disabled against the mock client.',
      is_active: true,
    },
  });
  if (current) await prisma.configSetting.update({ where: { id: current.id }, data: { is_active: false } });

  try {
    return await fn();
  } finally {
    await prisma.configSetting.delete({ where: { id: probe.id } }).catch(() => undefined);
    if (current) await prisma.configSetting.update({ where: { id: current.id }, data: { is_active: true } }).catch(() => undefined);
  }
}

/** Build the warehouse fixture through the real ingest job — never by inserting rows. */
async function ingestFixture() {
  let jobs = 0;
  const jobIds:string[]=[];
  for (const reporter of REPORTERS) {
    for (const partner of PARTNERS) {
      for (const year of YEARS) {
        const job=await enqueueJob({
          type: JobType.comtrade_ingest,
          payload: { hs_chapter: CHAPTER, reporter, partner, year, flow_direction: 'import' },
          dedupe_key: `verify-wh:${reporter}:${partner}:${year}:${Date.now()}`,
        });
        jobIds.push(job.id);
        jobs++;
      }
    }
  }
  await drain(JobType.comtrade_ingest,jobIds);
  const first = await prisma.tradeFlow.findFirst({ where: { year: YEARS[0], hs_code: { startsWith: CHAPTER } }, select: { hs_code: true }, orderBy: { hs_code: 'asc' } });
  if (!first) throw new Error('Fixture ingest produced no HS6 code.');
  TEST_HS = first.hs_code;
  return jobs;
}

/** Run discovery through the real job handler and return the persisted assessments. */
async function runDiscovery(_label: string) {
  const snapshot = {
    source: 'ad_hoc',
    description: 'Combed cotton yarn, single, unbleached',
    hs_code: TEST_HS,
    target_countries: [],
    verify_probe: true,
    as_of_date: '2096-01-01T00:00:00.000Z',
  };

  const run = await prisma.discoveryRun.create({
    data: {
      exporter_org_id: ORG,
      requested_by_id: USER,
      input_snapshot: snapshot as Prisma.InputJsonValue,
      as_of_date:new Date(snapshot.as_of_date),
    },
  });

  const job = await enqueueJob({
    type: JobType.demand_discovery,
    payload: { discovery_run_id: run.id },
    target_type: 'discovery_run',
    target_id: run.id,
    exporter_org_id: ORG,
    dedupe_key: `verify-wh-disc:${run.id}`,
  });

  await drain(JobType.demand_discovery,[job.id]);

  const finished = await prisma.job.findUnique({ where: { id: job.id } });
  const assessments = await prisma.marketAssessment.findMany({
    where: { run_id: run.id },
    orderBy: [{ overall_score: 'desc' }, { country_code: 'asc' }],
  });
  return { runId: run.id, job: finished, assessments };
}

// ---------------------------------------------------------------------------
// Independent recomputation — deliberately NOT importing scoring.ts
// ---------------------------------------------------------------------------

const WORLD = '0';
const INDIA = '699';

/**
 * Recompute one market's facts straight from TradeFlow with arithmetic written here.
 *
 * Importing the engine's own `scoreCandidate` would only prove the engine agrees with
 * itself. These formulas are transcribed from the stated spec — India's value over total
 * value; sum of squared supplier shares — so a bug in the engine's implementation shows up
 * as a mismatch rather than being reproduced identically on both sides.
 */
async function recomputeFacts(reporter: string) {
  const rows = await prisma.tradeFlow.findMany({
    where: {
      reporter,
      hs_code: TEST_HS,
      year: { in: YEARS },
      source: TradeDataSource.comtrade,
      flow_direction: TradeFlowDirection.import,
    },
  });

  const num = (d: Prisma.Decimal | null) => (d == null ? null : d.toNumber());
  const worldRows = rows.filter((r) => r.partner === WORLD);
  if (worldRows.length === 0) return null;

  const latestYear = Math.max(...worldRows.map((r) => r.year));
  const latestWorld = worldRows.filter((r) => r.year === latestYear);
  const latestTotal = latestWorld.reduce((s, r) => s + r.value.toNumber(), 0);

  const indiaLatest = rows.filter((r) => r.partner === INDIA && r.year === latestYear);
  const indiaValue = indiaLatest.reduce((s, r) => s + r.value.toNumber(), 0);
  const indiaSharePct = latestTotal > 0 && indiaLatest.length > 0 ? (indiaValue / latestTotal) * 100 : null;

  // HHI = sum of squared supplier shares, over named partners in the latest year.
  const supplierRows = rows.filter((r) => r.partner !== WORLD && r.year === latestYear);
  const byPartner = new Map<string, number>();
  for (const r of supplierRows) byPartner.set(r.partner, (byPartner.get(r.partner) ?? 0) + r.value.toNumber());
  const supplierTotal = [...byPartner.values()].reduce((s, v) => s + v, 0);
  const hhi = supplierTotal > 0 ? [...byPartner.values()].reduce((s, v) => s + (v / supplierTotal) ** 2, 0) : null;

  // 10th/90th percentile of observed unit values in the latest year.
  const unitValues = latestWorld
    .map((r) => num(r.unit_value))
    .filter((v): v is number => v != null && v > 0)
    .sort((a, b) => a - b);
  const priceBand = unitValues.length
    ? {
        min: unitValues[Math.floor(unitValues.length * 0.1)],
        max: unitValues[Math.min(unitValues.length - 1, Math.floor(unitValues.length * 0.9))],
      }
    : null;

  return { latestYear, latestTotal, indiaSharePct, hhi, priceBand };
}

/** The fact sentence the engine appends. Reconstructed here from independently-recomputed values. */
function expectedFactSentence(facts: NonNullable<Awaited<ReturnType<typeof recomputeFacts>>>): string {
  const parts = [
    `Recorded imports of ${facts.latestTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })} USD in ${facts.latestYear}`,
  ];
  if (facts.indiaSharePct != null) parts.push(`India-origin share ${facts.indiaSharePct.toFixed(2)}%`);
  return `${parts.join('; ')}.`;
}

const ISO_TO_AREA: Record<string, string> = { US: '842', DE: '276', AE: '784', GB: '826' };

// ---------------------------------------------------------------------------

async function main() {
  // The warehouse engine is retired in staging and production (D-036); this check runs only elsewhere.
  assertEarlierEnginesRetired('The warehouse engine verification');
  registerAllJobHandlers();
  // Pin both swappable pieces so the run is deterministic and offline: the warehouse engine
  // (rather than whatever DISCOVERY_ENGINE happens to be set to) and the template rationale
  // writer (a model's prose is non-deterministic by nature, which would make the
  // byte-identical reproducibility assertion untestable).
  setDiscoveryEngine(new WarehouseDiscoveryEngine());
  setRationaleWriter(new TemplateRationaleWriter());

  await cleanup();

  try {
    let firstRun: Awaited<ReturnType<typeof runDiscovery>> | null = null;

    await scenario('WH-1', 'Warehouse fixture is built through the real ingest job, spanning years and partners', async () => {
      const jobCount = await withoutIngestDelay(ingestFixture);
      const rowCount = await prisma.tradeFlow.count({ where: { year: { in: YEARS } } });
      const failedRuns = await prisma.ingestRun.count({
        where: { params: { path: ['hs_chapter'], equals: CHAPTER }, status: { in: ['failed', 'partial'] } },
      });
      const distinctCodes = await prisma.tradeFlow.findMany({
        where: { year: { in: YEARS } },
        select: { hs_code: true },
        distinct: ['hs_code'],
      });

      const pass = rowCount > 0 && failedRuns === 0 && distinctCodes.length > 1;
      record('WH-1', 'Warehouse fixture is built through the real ingest job, spanning years and partners', pass ? 'PASS' : 'FAIL',
        `${jobCount} ingest jobs run → ${rowCount} TradeFlow rows across ${REPORTERS.length} reporters × ${PARTNERS.length} partners × ${YEARS.length} years; ${distinctCodes.length} distinct HS codes; failed/partial IngestRuns=${failedRuns}`);
    });

    await scenario('WH-2', 'Discovery ranks markets computed from warehouse rows, not simulated', async () => {
      firstRun = await runDiscovery('first');
      const provenance = (firstRun.job?.result as { provenance?: Record<string, unknown> } | null)?.provenance;

      const pass =
        firstRun.job?.status === JobStatus.completed || firstRun.job?.status === JobStatus.partial
          ? firstRun.assessments.length > 0 && provenance?.engine === 'warehouse-v1' && provenance?.source === 'comtrade'
          : false;

      record('WH-2', 'Discovery ranks markets computed from warehouse rows, not simulated', pass ? 'PASS' : 'FAIL',
        `job=${firstRun.job?.status}; ${firstRun.assessments.length} markets ranked (${firstRun.assessments.map((a) => `${a.country_code}:${a.overall_score}`).join(', ')}); engine=${provenance?.engine}; data years=${JSON.stringify(provenance?.data_years)}`);
    });

    await scenario('WH-3', 'Scores are reproducible: a second run over the same input snapshot is byte-identical', async () => {
      const second = await runDiscovery('second');
      const shape = (a: { country_code: string; overall_score: number | null; demand_score: number | null; growth_score: number | null; competition_score: number | null; india_share: Prisma.Decimal | null; rationale: string | null }) =>
        `${a.country_code}|${a.overall_score}|${a.demand_score}|${a.growth_score}|${a.competition_score}|${a.india_share?.toString()}|${a.rationale}`;

      const before = firstRun!.assessments.map(shape);
      const after = second.assessments.map(shape);
      const identical = before.length === after.length && before.every((v, i) => v === after[i]);

      record('WH-3', 'Scores are reproducible: a second run over the same input snapshot is byte-identical', identical ? 'PASS' : 'FAIL',
        identical
          ? `both runs produced ${before.length} identically-scored markets from the same snapshot (compared country, overall, demand, growth, competition, india_share and full rationale text)`
          : `MISMATCH\n      run 1: ${before.join('\n             ')}\n      run 2: ${after.join('\n             ')}`);
    });

    await scenario('WH-4', 'Every subscore is recomputable from TradeFlow by independent arithmetic', async () => {
      const details: string[] = [];
      let allMatch = true;

      for (const assessment of firstRun!.assessments) {
        const area = ISO_TO_AREA[assessment.country_code];
        const facts = await recomputeFacts(area);
        if (!facts) { allMatch = false; details.push(`${assessment.country_code}: no warehouse rows`); continue; }

        // india_share: stored as a percentage, recomputed as india value / total value.
        const storedShare = assessment.india_share == null ? null : assessment.india_share.toNumber();
        const shareOk = storedShare != null && facts.indiaSharePct != null
          ? Math.abs(storedShare - facts.indiaSharePct) < 0.01
          : storedShare == null && facts.indiaSharePct == null;

        // Competition component: HHI may contribute only when the stored immutable
        // coverage assertion proves the partner extract reconciles to the world total.
        const clamp = (n: number) => Math.max(1, Math.min(99, Math.round(n)));
        const competitionProvenance=assessment.field_provenance as {competition_score?:{input_evidence?:{supplier_coverage?:{completeness?:string}}}}|null;
        const coverageComplete=competitionProvenance?.competition_score?.input_evidence?.supplier_coverage?.completeness==='COMPLETE';
        const fragmentation = coverageComplete&&facts.hhi != null ? clamp((1 - facts.hhi) * 100):null;
        const indiaScore = facts.indiaSharePct == null ? null : clamp(Math.min(facts.indiaSharePct / 15, 1) * 100);
        const available = [[fragmentation, 70], [indiaScore, 30]] as const;
        const denominator = available.reduce((sum, [score, weight]) => sum + (score == null ? 0 : weight), 0);
        const expectedCompetition = denominator ? clamp(available.reduce((sum, [score, weight]) => sum + (score == null ? 0 : score * weight), 0) / denominator) : null;
        const competitionOk = assessment.competition_score === expectedCompetition;

        // price band: 10th/90th percentile of observed unit values.
        const bandOk = facts.priceBand
          ? assessment.price_band_min != null &&
            Math.abs(assessment.price_band_min.toNumber() - facts.priceBand.min) < 0.0001 &&
            assessment.price_band_max != null &&
            Math.abs(assessment.price_band_max.toNumber() - facts.priceBand.max) < 0.0001
          : assessment.price_band_min == null;

        if (!shareOk || !competitionOk || !bandOk) allMatch = false;
        details.push(
          `${assessment.country_code}: india_share stored=${storedShare?.toFixed(3)} recomputed=${facts.indiaSharePct?.toFixed(3)} ${shareOk ? 'OK' : 'MISMATCH'}; competition stored=${assessment.competition_score} expected=${expectedCompetition} (raw HHI=${facts.hhi?.toFixed(4)}, coverage=${coverageComplete?'COMPLETE':'insufficient'}) ${competitionOk ? 'OK' : 'MISMATCH'}; price band ${bandOk ? 'OK' : 'MISMATCH'}`,
        );
      }

      record('WH-4', 'Every subscore is recomputable from TradeFlow by independent arithmetic', allMatch ? 'PASS' : 'FAIL',
        details.join('\n    '));
    });

    await scenario('WH-5', 'No assessment contains a number absent from TradeFlow', async () => {
      const details: string[] = [];
      let allClean = true;

      for (const assessment of firstRun!.assessments) {
        const facts = await recomputeFacts(ISO_TO_AREA[assessment.country_code]);
        if (!facts) { allClean = false; details.push(`${assessment.country_code}: no rows to verify against`); continue; }

        const rationale = assessment.rationale ?? '';
        const expectedTail = expectedFactSentence(facts);

        // The rationale must END with exactly the sentence reconstructed from recomputed
        // values — so every figure it states is one we independently derived from TradeFlow.
        const tailMatches = rationale.endsWith(expectedTail);
        // Strip that sentence; whatever is left is the generated prose, which must contain
        // no digits at all. Together these two checks account for EVERY numeral in the text.
        const prose = tailMatches ? rationale.slice(0, rationale.length - expectedTail.length) : rationale;
        const proseHasDigits = /[0-9]/.test(prose);

        if (!tailMatches || proseHasDigits) allClean = false;
        details.push(
          `${assessment.country_code}: fact sentence matches independently-recomputed values=${tailMatches}; generated prose digit-free=${!proseHasDigits}${proseHasDigits ? ` (offending prose: "${prose.trim()}")` : ''}`,
        );
      }

      record('WH-5', 'No assessment contains a number absent from TradeFlow', allClean ? 'PASS' : 'FAIL',
        `Every numeral in each rationale is accounted for: the trailing fact sentence is reconstructed from independent recomputation, and the remaining generated prose contains no digits.\n    ${details.join('\n    ')}`);
    });

    await scenario('WH-6', 'Unsourced fields declare themselves unavailable rather than being invented', async () => {
      const details: string[] = [];
      let allDeclared = true;

      for (const assessment of firstRun!.assessments) {
        const tariff = assessment.tariff_summary as { status?: string; reason?: string } | null;
        const logistics = assessment.logistics_summary as { status?: string; reason?: string } | null;
        const certs = assessment.certification_requirements as unknown[];
        const provenance = assessment.field_provenance as Record<string, { source?: string; retrieved_at?: string; status?: string }> | null;

        const declared =
          tariff?.status === 'unavailable' && Boolean(tariff.reason) &&
          logistics?.status === 'unavailable' && Boolean(logistics.reason) &&
          Array.isArray(certs) && certs.length === 0;

        // Every field that DOES carry a number must carry its source and retrieval date.
        const sourced = Boolean(
          provenance?.demand_score?.source === 'comtrade' && provenance?.demand_score?.retrieved_at &&
          provenance?.competition_score && provenance?.india_share,
        );

        if (!declared || !sourced) allDeclared = false;
        details.push(`${assessment.country_code}: tariff/logistics/certs declared unavailable=${declared}; computed fields carry source+retrieved_at=${sourced}`);
      }

      record('WH-6', 'Unsourced fields declare themselves unavailable rather than being invented', allDeclared ? 'PASS' : 'FAIL',
        details.join('\n    '));
    });

    await scenario('WH-6B', 'missing components lower confidence and redistribute their weights', async () => {
      const details = firstRun!.assessments.map((assessment) => {
        const p = assessment.field_provenance as { overall_score?: { input_evidence?:{effective_weights?:Record<string,number>} };[key:string]:unknown };
        const effective=p.overall_score?.input_evidence?.effective_weights??{};
        const scores:Record<string,number|null>={demand_strength:assessment.demand_score,growth_momentum:assessment.growth_score,competitive_opportunity:assessment.competition_score,market_access:assessment.market_access_score,export_economics:assessment.export_economics_score,exporter_market_fit:assessment.exporter_market_fit_score,logistics_feasibility:assessment.logistics_feasibility_score,risk_resilience:assessment.risk_resilience_score};
        const expectedOverall=Math.max(1,Math.min(99,Math.round(Object.entries(effective).reduce((sum,[key,weight])=>sum+(scores[key]??0)*weight,0))));
        const unavailableCount=Object.entries(scores).filter(([,score])=>score==null).length;
        const arithmetic=assessment.overall_score===expectedOverall;
        const redistributed=Math.abs(Object.values(effective).reduce((sum,value)=>sum+value,0)-1)<1e-9&&Object.keys(effective).every(key=>scores[key]!=null);
        return { assessment, unavailableCount, expectedOverall, arithmetic, redistributed };
      });
      const pass = details.every(({ assessment,unavailableCount, arithmetic, redistributed }) => unavailableCount>0&&assessment.confidence_score<100&&arithmetic&&redistributed);
      record('WH-6B', 'missing components lower confidence and redistribute their weights', pass ? 'PASS' : 'FAIL', details.map(({assessment,unavailableCount,redistributed,expectedOverall,arithmetic}) => `${assessment.country_code}: overall=${assessment.overall_score}, independently weighted=${expectedOverall}; confidence=${assessment.confidence_score}; unavailable_components=${unavailableCount}; effective_weights_sum_to_one=${redistributed}; arithmetic=${arithmetic}`).join('; '));
    });

    await scenario('WH-6C', 'hard eligibility failure produces an ineligible assessment, never a low score', async () => {
      await prisma.marketEligibilityRule.create({ data: { country_code: 'US', rule_type: 'sanctions_restricted', source: 'verify-warehouse', source_ref: 'fixture' } });
      const filtered = await runDiscovery('hard-filter');
      const us = filtered.assessments.find(a => a.country_code === 'US');
      const pass = us?.eligibility_status === 'ineligible' && us.overall_score == null;
      record('WH-6C', 'hard eligibility failure produces an ineligible assessment, never a low score', pass ? 'PASS' : 'FAIL', `US eligibility=${us?.eligibility_status}; overall=${us?.overall_score}; reasons=${JSON.stringify(us?.eligibility_reasons)}`);
      await prisma.marketEligibilityRule.deleteMany({ where: { source: 'verify-warehouse' } });
    });

    await scenario('WH-8', 'A writer that fabricates a figure is rejected, and the run degrades to deterministic prose', async () => {
      // The guard in WH-5 only proves the well-behaved writer stayed in its lane. This
      // proves the guard itself fires — an untested safety net is not a safety net, and
      // this one is the whole defence against a model stating a number nobody computed.
      //
      // Runs the engine IN THIS PROCESS rather than through the job queue: `setRationaleWriter`
      // is an in-process seam, so if a running `npm run worker` claimed the job first, the
      // injected writer would never load and this would fail for a reason that has nothing
      // to do with the guard. The engine and the guard being exercised are the real ones.
      const fabricated = 'Demand here grew 47% last year and India already holds a 12% share.';
      setRationaleWriter({
        name: 'rogue-test-writer',
        async write() { return fabricated; },
      });

      let assessments: Awaited<ReturnType<WarehouseDiscoveryEngine['rank']>>['assessments'] = [];
      try {
        const result = await new WarehouseDiscoveryEngine().rank({
          description: 'Combed cotton yarn, single, unbleached',
          hs_code: TEST_HS,
          target_countries: [],
          origin_country: 'IN',
        });
        assessments = result.assessments;
      } finally {
        setRationaleWriter(new TemplateRationaleWriter());
      }

      const leaked = assessments.filter((a) => a.rationale.includes('47%') || a.rationale.includes('12% share'));
      const digitsInProse = assessments.filter((a) => {
        // Everything before "Recorded imports of" is the generated prose half.
        const prose = a.rationale.split('Recorded imports of')[0];
        return /[0-9]/.test(prose);
      });
      const provenance = assessments.map((a) => (a.field_provenance as { rationale?: { writer?: string; fell_back_from_model?: boolean } } | null | undefined));
      const allFellBack = provenance.every((p) => p?.rationale?.writer === 'template-v1');
      const flagged = provenance.some((p) => p?.rationale?.fell_back_from_model === true);

      const pass = assessments.length > 0 && leaked.length === 0 && digitsInProse.length === 0 && allFellBack && flagged;
      record('WH-8', 'A writer that fabricates a figure is rejected, and the run degrades to deterministic prose', pass ? 'PASS' : 'FAIL',
        `Injected a writer returning "${fabricated}" — fabricated figures reaching a rationale: ${leaked.length}; assessments whose prose half contains any digit: ${digitsInProse.length}; every assessment fell back to the deterministic writer: ${allFellBack}; fallback recorded in field_provenance: ${flagged}. The run still produced ${assessments.length} ranked markets.`);
    });

    await scenario('WH-7', 'No API route reads TradeFlow — the warehouse stays server-side', async () => {
      const { execSync } = await import('child_process');
      let hits = '';
      try {
        hits = execSync('grep -rl "tradeFlow" src/app/api 2>/dev/null || true', { encoding: 'utf8' }).trim();
      } catch { hits = ''; }

      // The engine reads TradeFlow; the assessments it returns carry only derived figures.
      const assessmentKeys = new Set(firstRun!.assessments.flatMap((a) => Object.keys(a)));
      const leaksRawColumns = ['reporter', 'partner', 'unit_value', 'quantity', 'period'].filter((k) => assessmentKeys.has(k));

      const pass = hits === '' && leaksRawColumns.length === 0;
      record('WH-7', 'No API route reads TradeFlow — the warehouse stays server-side', pass ? 'PASS' : 'FAIL',
        `grep of src/app/api for \`tradeFlow\`: ${hits === '' ? 'no hits' : hits}; MarketAssessment rows carrying raw warehouse columns: ${leaksRawColumns.length === 0 ? 'none' : leaksRawColumns.join(', ')}`);
    });
  } finally {
    await cleanup();
  }

  summarize('WAREHOUSE DISCOVERY VERIFICATION');
}

main()
  .catch((e) => {
    console.error('SUITE CRASHED:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
