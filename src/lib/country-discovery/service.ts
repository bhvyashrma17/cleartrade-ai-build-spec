/**
 * The read/write service behind the exporter's country-discovery product.
 *
 * Every function here is server-side and re-checks authorization itself. The UI's job is to
 * render what this returns; it is never the thing that decides what a caller may see. In
 * particular `assertOrgAccess` is called before any product, run or assessment is read, so a
 * product id belonging to another tenant 404s rather than leaking its existence.
 *
 * Nothing in this module scores, ranks by a new formula, or recomputes a metric. It reads
 * frozen rows and projects them (see `market-view.ts`).
 */
import { JobStatus, JobType, TradeSourceMode, UserRole } from '@prisma/client';
import { enqueueGlobalCountryScreening } from '@/lib/job-handlers/country-screening';
import { globalCountryScreeningShortlist } from '@/lib/country-screening/service';
import { currentRefinement, deriveRefinementQuestions, narrowCandidates, type CandidateLine } from '@/lib/market-access/classification-refinement';
import { forbidden, notFound, validationError } from '@/lib/errors';
import { assertCan, assertOrgAccess } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';
import { buildImprovementPlan, type ImprovementPlan } from './improve';
import { explainMarket, summariseMarket, type Explanation } from './explanations';
import {
  projectMarketDetail,
  projectMarketRow,
  rankMarkets,
  type AssessmentRecord,
  type MarketDetailView,
  type MarketRowView,
} from './market-view';
import { assessProductReadiness, type ProductReadiness } from './readiness';
import { buildWorkQueue, summariseWork, type MarketWorkInput, type WorkSummary, type WorkTask } from './work-queue';

/**
 * A market's one-line status for the summary table.
 *
 * Deliberately says what is MISSING rather than restating the score: an agent scanning twenty
 * rows needs to know which one to open, and "needs a freight quote" answers that where "69"
 * does not.
 */
function marketStatus(detail: MarketDetailView): { status: string; status_tone: 'ready' | 'needs_evidence' | 'needs_classification' | 'incomplete' } {
  const missing = detail.pillars.filter((pillar) => pillar.state === 'not_established');
  if (!missing.length) return { status: 'Ready', status_tone: 'ready' };
  const marketAccess = missing.find((pillar) => pillar.key === 'market_access');
  if (marketAccess) return { status: 'Classification needed', status_tone: 'needs_classification' };
  if (missing.some((pillar) => pillar.key === 'export_economics' || pillar.key === 'logistics_feasibility')) {
    return { status: 'Needs freight & cost evidence', status_tone: 'needs_evidence' };
  }
  if (missing.some((pillar) => pillar.key === 'exporter_market_fit')) {
    return { status: 'Needs exporter information', status_tone: 'needs_evidence' };
  }
  return { status: 'Analysis incomplete', status_tone: 'incomplete' };
}

/**
 * Which markets a human has already ruled on, read once per run.
 *
 * `marked` means an agent actively chose to pursue it (promoted, or given an operational
 * priority); `excluded` means they removed it. Both come from the existing decision model.
 */
async function currentMarketDecisions(assessmentIds: readonly string[]) {
  const { bucketFor } = await import('@/lib/demand-control');
  const { effectiveState } = await import('@/lib/agent-decisions');
  const map = new Map<string, { marked: boolean; excluded: boolean }>();
  if (!assessmentIds.length) return map;
  const rows = await prisma.agentDecision.findMany({
    where: { market_assessment_id: { in: [...assessmentIds] } },
    orderBy: { created_at: 'desc' },
    include: { superseded_by: { select: { id: true } } },
  });
  const now = new Date();
  for (const decision of rows) {
    const subject = decision.market_assessment_id;
    if (!subject || map.has(subject)) continue;   // newest-first: the first seen is the tip
    if (effectiveState(decision, now) !== 'active') continue;
    map.set(subject, {
      marked: decision.action === 'promote' || decision.action === 'mark_selected' || decision.agent_priority != null,
      excluded: bucketFor(decision) === 'terminal',
    });
  }
  return map;
}

/**
 * Which provider mode a screen this process starts must be recorded under.
 *
 * Mirrors `scripts/screen-countries.ts` so an operator-run screen and a product-run screen of
 * the same classification produce the same work identity (the mode is part of the dedupe key)
 * rather than two rival runs.
 */
function screeningSourceMode(): TradeSourceMode {
  const client = process.env.COMTRADE_CLIENT;
  if (client === 'real') return TradeSourceMode.authenticated;
  if (client === 'fixture') return TradeSourceMode.fixture;
  return TradeSourceMode.mock;
}

const EXPORTER_ROLES: readonly UserRole[] = [UserRole.exporter_owner, UserRole.exporter_member];
const AGENT_ROLES: readonly UserRole[] = [UserRole.agent, UserRole.ops_supervisor, UserRole.admin];
/** Who may spend a global screen's provider budget. Mirrors `runGlobalCountryScreening`. */
export const SCREENING_PRINCIPALS: readonly UserRole[] = [UserRole.agent, UserRole.ops_supervisor, UserRole.admin];

const ASSESSMENT_SELECT = {
  id: true, country_code: true, overall_score: true, confidence_score: true,
  country_truth_assessment_state: true, country_truth_period_set: true, country_truth_as_of_date: true,
  generated_at: true, rationale: true, field_provenance: true, is_selected: true, saved_at: true,
  country_trade_metrics: { select: { metrics_payload: true } },
} as const;

/** Load a product the caller is entitled to see, with its confirmed classification. */
async function loadProduct(actor: Principal, exporterOrgId: string, productId: string) {
  await assertOrgAccess(actor, exporterOrgId);
  const product = await prisma.product.findFirst({
    where: { id: productId, exporter_org_id: exporterOrgId },
    include: {
      classification_history: { where: { status: 'confirmed' }, orderBy: { revision: 'desc' }, take: 1 },
    },
  });
  // Not `forbidden`: a product in another tenant must be indistinguishable from one that does
  // not exist, or the 403/404 split becomes an existence oracle.
  if (!product) throw notFound('That product does not exist.');
  return { product, classification: product.classification_history[0] ?? null };
}

export interface ProductDiscoveryState {
  product: { id: string; name: string; hs6: string | null };
  readiness: ProductReadiness;
  /** True when THIS caller may start a screen. False for an exporter: ClearTrade runs it. */
  viewer_can_start_screening: boolean;
  /** The exporter's standing request for a scan, reconciled against its screening job. */
  scan_request: {
    id: string;
    status: string;
    requested_at: string;
    rejection_reason: string | null;
    resolution_note: string | null;
  } | null;
  screening: {
    state: 'not_started' | 'queued' | 'running' | 'completed' | 'failed';
    job_id: string | null;
    screening_run_id: string | null;
    /** Markets shortlisted by the completed screen. */
    shortlist_size: number | null;
    /** How many markets the screen actually looked at. */
    universe_size: number | null;
    completed_at: string | null;
    failure_reason: string | null;
  };
  deep_analysis: {
    state: 'not_started' | 'queued' | 'running' | 'completed' | 'partial' | 'failed';
    job_id: string | null;
    /** Markets with a deep assessment on the latest run. */
    assessed: number;
    generated_at: string | null;
  };
}

function screeningState(status: JobStatus | null): ProductDiscoveryState['screening']['state'] {
  if (status == null) return 'not_started';
  if (status === JobStatus.queued) return 'queued';
  if (status === JobStatus.processing) return 'running';
  if (status === JobStatus.completed) return 'completed';
  return 'failed';
}

/**
 * Everything the product page needs to decide what to offer: can we discover, is a screen
 * already running, and is there a deep analysis behind it.
 */
export async function productDiscoveryState(actor: Principal, exporterOrgId: string, productId: string): Promise<ProductDiscoveryState> {
  const { product, classification } = await loadProduct(actor, exporterOrgId, productId);
  const readiness = assessProductReadiness(product, classification);

  const screeningJob = classification
    ? await prisma.job.findFirst({
        where: { type: JobType.country_screening, exporter_org_id: exporterOrgId, target_type: 'product_classification', target_id: classification.id },
        orderBy: { created_at: 'desc' },
      })
    : null;
  const result = (screeningJob?.result ?? null) as { screening_run_id?: string; shortlist_size?: number; universe_size?: number; error?: string } | null;

  // A completed screen is the durable artefact, not the job: a run from a job that has since
  // been pruned is still the shortlist this product was screened into.
  const run = classification
    ? await prisma.countryScreeningRun.findFirst({
        where: { product_classification_id: classification.id, status: 'completed' },
        orderBy: { created_at: 'desc' },
      })
    : null;

  const deepJob = classification
    ? await prisma.job.findFirst({
        where: { type: JobType.country_truth_discovery, exporter_org_id: exporterOrgId, target_type: 'product_classification', target_id: classification.id },
        orderBy: { created_at: 'desc' },
      })
    : null;
  const latestRun = await prisma.discoveryRun.findFirst({
    where: { exporter_org_id: exporterOrgId, product_id: productId, status: { in: [JobStatus.completed, JobStatus.partial] } },
    orderBy: { created_at: 'desc' },
    include: { _count: { select: { market_assessments: true } } },
  });

  // Reconciled on read, so the exporter never sees `queued` for a job that already finished.
  // Imported lazily because `scan-requests` imports `startMarketDiscovery` from this module.
  const { currentScanRequest, reconcileScanRequest } = await import('./scan-requests');
  const standing = classification ? await currentScanRequest(actor, exporterOrgId, productId) : null;
  const scanRequest = standing ? await reconcileScanRequest(standing.id) : null;

  return {
    product: { id: product.id, name: product.name, hs6: classification?.hs6_code ?? null },
    readiness,
    viewer_can_start_screening: SCREENING_PRINCIPALS.includes(actor.role),
    scan_request: scanRequest
      ? {
          id: scanRequest.id, status: scanRequest.status,
          requested_at: scanRequest.requested_at.toISOString(),
          rejection_reason: scanRequest.rejection_reason,
          resolution_note: scanRequest.resolution_note,
        }
      : null,
    screening: {
      state: run ? 'completed' : screeningState(screeningJob?.status ?? null),
      job_id: screeningJob?.id ?? null,
      screening_run_id: run?.id ?? result?.screening_run_id ?? null,
      shortlist_size: run?.shortlist_size ?? result?.shortlist_size ?? null,
      universe_size: run?.universe_size ?? result?.universe_size ?? null,
      completed_at: run?.updated_at.toISOString() ?? null,
      failure_reason: screeningJob?.status === JobStatus.failed ? (result?.error ?? 'The market scan did not finish.') : null,
    },
    deep_analysis: {
      state: latestRun
        ? latestRun.status === JobStatus.partial ? 'partial' : 'completed'
        : deepJob?.status === JobStatus.queued ? 'queued'
          : deepJob?.status === JobStatus.processing ? 'running'
            : deepJob?.status === JobStatus.failed ? 'failed'
              : 'not_started',
      job_id: deepJob?.id ?? null,
      assessed: latestRun?._count.market_assessments ?? 0,
      generated_at: latestRun?.created_at.toISOString() ?? null,
    },
  };
}

/**
 * Start a global screen for this product.
 *
 * There is no country parameter and there never will be: Stage A's entire value is that the
 * candidate set is derived from world trade rather than from what the requester already
 * believed. A caller that could pass countries here would be able to reintroduce exactly the
 * selection bias screening exists to remove.
 */
export async function startMarketDiscovery(actor: Principal, exporterOrgId: string, productId: string, correlationId: string) {
  assertCan(actor, 'demand_discovery.run');
  // A global screen acquires one authoritative observation per reporting market — ~218 metered
  // provider calls per run. Phase 1F made that a staff-initiated operation deliberately, and
  // `runGlobalCountryScreening` re-checks the requesting actor's role when it executes.
  //
  // The check is repeated HERE so an exporter gets an immediate, legible answer instead of a
  // job that is accepted, retried three times over the next hour and then fails with an
  // internal message they never see. Widening the role set instead would hand every paid
  // exporter an unmetered button on a quota the whole platform shares — that is a cost control,
  // not an oversight, so it is enforced earlier rather than removed.
  if (!SCREENING_PRINCIPALS.includes(actor.role)) {
    throw forbidden('ClearTrade runs the global market scan for you. Your ClearTrade agent will start it for this product.');
  }
  const { product, classification } = await loadProduct(actor, exporterOrgId, productId);
  if (!classification) {
    throw validationError([{ field: 'product_id', code: 'classification_required', message: 'This product needs a confirmed HS classification before markets can be compared.' }]);
  }

  const inFlight = await prisma.job.findFirst({
    where: {
      type: JobType.country_screening, exporter_org_id: exporterOrgId,
      target_type: 'product_classification', target_id: classification.id,
      status: { in: [JobStatus.queued, JobStatus.processing] },
    },
    orderBy: { created_at: 'desc' },
  });
  if (inFlight) return { job: inFlight, created: false };

  const { job } = await enqueueGlobalCountryScreening({
    exporter_org_id: exporterOrgId,
    product_id: product.id,
    product_classification_id: classification.id,
    hs6: classification.hs6_code,
    hs_revision: classification.nomenclature_version as 'HS2022' | '2022',
    // The provider mode is an environment fact, never a request field: a caller that could
    // choose it could ask for mock data and have it recorded as a real screen.
    source_mode: screeningSourceMode(),
    requested_by_agent_id: actor.id,
    correlation_id: correlationId,
  });
  return { job, created: true };
}

export interface MarketResultsView {
  product: { id: string; name: string; hs6: string | null };
  /** Null when no deep analysis has produced assessments yet. */
  run: { id: string; generated_at: string; status: string } | null;
  markets: Array<MarketRowView & { stands_out: string | null; can_improve: string | null }>;
  /** Markets the screen shortlisted but which have no deep assessment yet. */
  awaiting_analysis: Array<{ country_code: string; country: string }>;
  screening_run_id: string | null;
}

/** The ranked results surface. Ordering is `rankMarkets`, which the detail page reuses. */
export async function marketResults(actor: Principal, exporterOrgId: string, productId: string): Promise<MarketResultsView> {
  const { product, classification } = await loadProduct(actor, exporterOrgId, productId);
  const run = await prisma.discoveryRun.findFirst({
    where: { exporter_org_id: exporterOrgId, product_id: productId, status: { in: [JobStatus.completed, JobStatus.partial] } },
    orderBy: { created_at: 'desc' },
  });
  const rows = run
    ? await prisma.marketAssessment.findMany({ where: { run_id: run.id }, select: ASSESSMENT_SELECT })
    : [];
  const ranked = rankMarkets(rows as AssessmentRecord[]);
  const markets = ranked.map((row, index) => {
    const detail = projectMarketDetail(row, index + 1);
    return { ...projectMarketRow(row, index + 1), ...summariseMarket(detail) };
  });

  const screeningRun = classification
    ? await prisma.countryScreeningRun.findFirst({ where: { product_classification_id: classification.id, status: 'completed' }, orderBy: { created_at: 'desc' } })
    : null;
  const assessed = new Set(markets.map((market) => market.country_code));
  const shortlist = screeningRun ? await globalCountryScreeningShortlist(screeningRun.id) : [];
  const awaiting = shortlist
    .filter((candidate) => !assessed.has(candidate.country_code.toUpperCase()))
    .map((candidate) => ({ country_code: candidate.country_code.toUpperCase(), country: candidate.country_name }));

  return {
    product: { id: product.id, name: product.name, hs6: classification?.hs6_code ?? null },
    run: run ? { id: run.id, generated_at: run.created_at.toISOString(), status: run.status } : null,
    markets,
    awaiting_analysis: awaiting,
    screening_run_id: screeningRun?.id ?? null,
  };
}

export interface CountryDetailView {
  product: { id: string; name: string; hs6: string | null };
  market: MarketDetailView;
  explanations: Explanation[];
  improve: ImprovementPlan;
  classification: ClassificationQuestionView;
  run: { id: string; generated_at: string; status: string };
  /** True when evidence has changed since this assessment was generated. */
  refresh_available: boolean;
}

/** The country detail page. */
export async function countryDetail(actor: Principal, exporterOrgId: string, productId: string, countryCode: string): Promise<CountryDetailView> {
  const { product, classification } = await loadProduct(actor, exporterOrgId, productId);
  const country = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw validationError([{ field: 'country', code: 'invalid', message: 'A two-letter country code is required.' }]);

  const run = await prisma.discoveryRun.findFirst({
    where: { exporter_org_id: exporterOrgId, product_id: productId, status: { in: [JobStatus.completed, JobStatus.partial] } },
    orderBy: { created_at: 'desc' },
  });
  if (!run) throw notFound('No market analysis has been produced for this product yet.');
  const rows = await prisma.marketAssessment.findMany({ where: { run_id: run.id }, select: ASSESSMENT_SELECT });
  const ranked = rankMarkets(rows as AssessmentRecord[]);
  const index = ranked.findIndex((row) => row.country_code.toUpperCase() === country);
  if (index < 0) throw notFound('That market is not part of this analysis.');
  const market = projectMarketDetail(ranked[index]!, index + 1);

  const questions = await classificationQuestions(actor, exporterOrgId, productId, country);
  const readiness = assessProductReadiness(product, classification);
  const improve = buildImprovementPlan(market.pillars, market.evidence_confidence, {
    product_id: productId,
    country_code: country,
    open_classification_questions: questions.questions.length,
    readiness,
  });

  // Evidence recorded after the assessment was frozen is not in it. Saying so is what stops a
  // stale analysis reading as current after the exporter has just filled in their price.
  const newerFact = await prisma.product.findFirst({
    where: { id: productId, updated_at: { gt: ranked[index]!.generated_at } },
    select: { id: true },
  });

  return {
    product: { id: product.id, name: product.name, hs6: classification?.hs6_code ?? null },
    market,
    explanations: explainMarket(market),
    improve,
    classification: questions,
    run: { id: run.id, generated_at: run.created_at.toISOString(), status: run.status },
    refresh_available: Boolean(newerFact),
  };
}

export interface ComparisonView {
  product: { id: string; name: string };
  markets: MarketDetailView[];
  /** Countries asked for that this analysis does not cover, named rather than dropped. */
  unavailable: string[];
}

/**
 * Compare up to three markets side by side.
 *
 * Missing evidence stays missing: a pillar with no score is carried through as `null` with its
 * reason, never coerced to 0 so a bar chart has something to draw. A comparison that silently
 * zeroes an unknown is worse than no comparison, because it ranks a market DOWN for evidence
 * nobody has gathered yet.
 */
export async function compareMarkets(actor: Principal, exporterOrgId: string, productId: string, countries: readonly string[]): Promise<ComparisonView> {
  const { product } = await loadProduct(actor, exporterOrgId, productId);
  const wanted = [...new Set(countries.map((code) => code.trim().toUpperCase()).filter((code) => /^[A-Z]{2}$/.test(code)))].slice(0, 3);
  if (!wanted.length) throw validationError([{ field: 'countries', code: 'required', message: 'Choose at least one market to compare.' }]);

  const run = await prisma.discoveryRun.findFirst({
    where: { exporter_org_id: exporterOrgId, product_id: productId, status: { in: [JobStatus.completed, JobStatus.partial] } },
    orderBy: { created_at: 'desc' },
  });
  if (!run) throw notFound('No market analysis has been produced for this product yet.');
  const rows = await prisma.marketAssessment.findMany({ where: { run_id: run.id }, select: ASSESSMENT_SELECT });
  const ranked = rankMarkets(rows as AssessmentRecord[]);

  const markets: MarketDetailView[] = [];
  const unavailable: string[] = [];
  for (const code of wanted) {
    const index = ranked.findIndex((row) => row.country_code.toUpperCase() === code);
    if (index < 0) unavailable.push(code);
    else markets.push(projectMarketDetail(ranked[index]!, index + 1));
  }
  return { product: { id: product.id, name: product.name }, markets, unavailable };
}

// ---------------------------------------------------------------------------
// Agent action surface
// ---------------------------------------------------------------------------

export interface AgentCountryTask {
  code: string;
  label: string;
  country_code: string;
  country: string;
  detail: string;
  /** The pillar this unblocks, in exporter-facing words. */
  unlocks: string;
}

export interface AgentProductView {
  product: { id: string; name: string; hs6: string | null };
  screening: ProductDiscoveryState['screening'];
  deep_analysis: ProductDiscoveryState['deep_analysis'];
  /** Non-null when a completed screen exists and deep Country Truth can be requested. */
  deep_request_ready: boolean;
  tasks: AgentCountryTask[];
  /** The prioritised ClearTrade work queue for this product. */
  queue: WorkTask[];
  queue_summary: WorkSummary;
  /** Compact product header: where this product stands, before any list. */
  summary: {
    markets_analysed: number;
    top_market: { country_code: string; country: string; attractiveness: number | null; confidence: number } | null;
    selected_market: { country_code: string; country: string } | null;
    exporter_inputs_missing: number;
  };
  /** The leading markets, for the summary table. Full list lives on the market route. */
  top_markets: Array<{
    country_code: string; country: string; rank: number;
    attractiveness: number | null; confidence: number;
    status: string; status_tone: 'ready' | 'needs_evidence' | 'needs_classification' | 'incomplete';
  }>;
}

/**
 * What an assigned agent still has to do for this exporter's Country Truth.
 *
 * Only ClearTrade-owned work appears here. The exporter's own missing facts are the exporter's
 * to supply and show up on their surface; duplicating them into the agent's queue would make
 * the agent chase the exporter for data the product is already asking them for.
 */
export async function agentCountryTruthWork(actor: Principal, exporterOrgId: string): Promise<AgentProductView[]> {
  if (!AGENT_ROLES.includes(actor.role)) throw forbidden('Only an assigned agent or operations reviewer can see Country Truth tasks.');
  await assertOrgAccess(actor, exporterOrgId);
  const products = await prisma.product.findMany({
    where: { exporter_org_id: exporterOrgId },
    include: { classification_history: { where: { status: 'confirmed' }, orderBy: { revision: 'desc' }, take: 1 } },
    orderBy: { name: 'asc' },
  });

  const views: AgentProductView[] = [];
  for (const product of products) {
    const state = await productDiscoveryState(actor, exporterOrgId, product.id);
    const tasks: AgentCountryTask[] = [];
    const workInputs: MarketWorkInput[] = [];
    const topMarkets: AgentProductView['top_markets'] = [];
    let selectedMarket: { country_code: string; country: string } | null = null;
    const run = await prisma.discoveryRun.findFirst({
      where: { exporter_org_id: exporterOrgId, product_id: product.id, status: { in: [JobStatus.completed, JobStatus.partial] } },
      orderBy: { created_at: 'desc' },
    });
    if (run) {
      const rows = await prisma.marketAssessment.findMany({ where: { run_id: run.id }, select: ASSESSMENT_SELECT });
      const ranked = rankMarkets(rows as AssessmentRecord[]);
      // One read of the agent decisions for the whole run, so a 20-market product does not issue
      // twenty queries to discover which markets a human has already ruled on.
      const decisions = await currentMarketDecisions(ranked.map((row) => row.id));
      const readiness = assessProductReadiness(product, product.classification_history[0] ?? null);
      for (const [index, row] of ranked.entries()) {
        const detail = projectMarketDetail(row, index + 1);
        const plan = buildImprovementPlan(detail.pillars, detail.evidence_confidence, {
          product_id: product.id, country_code: row.country_code, open_classification_questions: 0, readiness,
        });
        for (const action of plan.actions) {
          if (action.owner !== 'cleartrade') continue;
          tasks.push({
            code: `${row.country_code}:${action.code}`,
            label: action.label,
            country_code: row.country_code,
            country: detail.country,
            detail: action.detail,
            unlocks: action.unlocks,
          });
        }
        const decision = decisions.get(row.id) ?? null;
        if (row.is_selected) selectedMarket = { country_code: row.country_code, country: detail.country };
        workInputs.push({
          country_code: row.country_code, country: detail.country, rank: index + 1,
          is_selected: row.is_selected,
          is_marked: decision?.marked ?? false,
          is_excluded: decision?.excluded ?? false,
          actions: plan.actions,
        });
        topMarkets.push({
          country_code: row.country_code, country: detail.country, rank: index + 1,
          attractiveness: detail.attractiveness, confidence: detail.evidence_confidence,
          ...marketStatus(detail),
        });
      }
    }
    const queue = buildWorkQueue(workInputs);
    views.push({
      product: { id: product.id, name: product.name, hs6: product.classification_history[0]?.hs6_code ?? null },
      screening: state.screening,
      deep_analysis: state.deep_analysis,
      deep_request_ready: Boolean(state.screening.screening_run_id) && state.screening.state === 'completed',
      tasks,
      queue,
      queue_summary: summariseWork(queue),
      summary: {
        markets_analysed: topMarkets.length ? state.deep_analysis.assessed : 0,
        top_market: topMarkets[0]
          ? { country_code: topMarkets[0].country_code, country: topMarkets[0].country, attractiveness: topMarkets[0].attractiveness, confidence: topMarkets[0].confidence }
          : null,
        selected_market: selectedMarket,
        exporter_inputs_missing: state.readiness.missing_now,
      },
      top_markets: topMarkets.slice(0, 5),
    });
  }
  return views;
}

// ---------------------------------------------------------------------------
// Classification refinement, exporter-facing
// ---------------------------------------------------------------------------

export interface ClassificationQuestionView {
  /**
   * `resolved` — one line is established.
   * `questions` — answers about the goods would narrow it.
   * `agent_classification_required` — refinement IS required, but ClearTrade cannot derive a
   *   question a manufacturer could answer from the authority's own descriptions. This is a
   *   distinct and honest state: telling the exporter there is "no evidence yet" when the
   *   evidence exists and simply cannot be narrowed by questionnaire would be false, and would
   *   leave them with no route forward.
   * `no_evidence_yet` — no authoritative tariff snapshot has been gathered for the destination.
   */
  state: 'not_applicable' | 'no_evidence_yet' | 'questions' | 'agent_classification_required' | 'resolved';
  destination_country: string;
  /** How many candidate lines are still in scope after the answers already on file. */
  remaining: number;
  candidate_total: number;
  questions: Array<{ attribute: string; question: string; options: Array<{ value: string; label: string; keeps: number }> }>;
  answers_on_file: Record<string, string>;
  /** Set only when narrowing has left exactly one line. Never a code the browser supplied. */
  resolved_line: { description: string; verification: string } | null;
  /** Identity of the authoritative snapshot the questions came from. */
  source: { authority: string; snapshot_id: string; retrieved_at: string } | null;
}

/**
 * Derive the questions to ask about this product for this destination.
 *
 * The candidate set is read from the immutable Market Access snapshot server-side. The browser
 * is never given tariff codes to choose between and never sends one back — it sees questions
 * about the goods ("is the rice parboiled?") and returns yes/no. That is what makes tariff-code
 * injection structurally impossible from this surface rather than merely validated against.
 */
export async function classificationQuestions(actor: Principal, exporterOrgId: string, productId: string, countryCode: string): Promise<ClassificationQuestionView> {
  const { classification } = await loadProduct(actor, exporterOrgId, productId);
  const country = countryCode.trim().toUpperCase();
  const empty = { destination_country: country, remaining: 0, candidate_total: 0, questions: [], answers_on_file: {}, resolved_line: null, source: null };
  if (!classification) return { ...empty, state: 'not_applicable' };

  const snapshot = await prisma.marketAccessEvidenceSnapshot.findFirst({
    where: { country_code: country, hs6_code: classification.hs6_code },
    orderBy: { retrieved_at: 'desc' },
  });
  if (!snapshot) return { ...empty, state: 'no_evidence_yet' };

  const detail = snapshot.resolution_detail as { declarable_candidates?: Array<Record<string, unknown>> } | null;
  const candidates: CandidateLine[] = (detail?.declarable_candidates ?? []).flatMap((entry) => {
    if (typeof entry.code !== 'string' || typeof entry.description !== 'string') return [];
    return [{
      national_tariff_code: entry.code,
      description: entry.description,
      description_path: Array.isArray(entry.description_path) ? entry.description_path.filter((part): part is string => typeof part === 'string') : [],
      duty_expression: typeof entry.duty === 'string' ? entry.duty : null,
      duty_kind: typeof entry.duty_kind === 'string' ? entry.duty_kind : null,
    }];
  });
  if (!candidates.length) return { ...empty, state: 'no_evidence_yet' };

  const existing = await currentRefinement({ product_id: productId, destination_country: country, as_of: new Date() });
  const answers = (existing?.deciding_attributes ?? {}) as Record<string, string>;
  const narrowed = narrowCandidates(candidates, answers);
  const source = { authority: snapshot.source_authority, snapshot_id: snapshot.id, retrieved_at: snapshot.retrieved_at.toISOString() };

  if (narrowed.remaining.length === 1) {
    const line = narrowed.remaining[0]!;
    return {
      state: 'resolved', destination_country: country,
      remaining: 1, candidate_total: candidates.length, questions: [], answers_on_file: answers,
      // The description, never the code: the exporter is being told what their product was
      // classified AS, not handed a number to quote. And the verification state is stated
      // plainly so a narrowed-by-questions result is never mistaken for a customs ruling.
      resolved_line: {
        description: [...(line.description_path ?? []), line.description].filter(Boolean).join(' › '),
        verification: existing?.state === 'agent_verified_selection' || existing?.state === 'authoritative_verified'
          ? 'Verified by ClearTrade'
          : 'Based on your answers — not yet verified by ClearTrade',
      },
      source,
    };
  }

  const questions = deriveRefinementQuestions(narrowed.remaining);
  return {
    // More than one line still in scope and nothing to ask means an agent must classify it.
    // Falling back to `no_evidence_yet` here would deny evidence that demonstrably exists.
    state: questions.length ? 'questions' : 'agent_classification_required',
    destination_country: country,
    remaining: narrowed.remaining.length,
    candidate_total: candidates.length,
    questions: questions.map((question) => ({
      attribute: question.attribute,
      question: question.question,
      options: question.options.map((option) => ({ value: option.value, label: option.label, keeps: option.keeps_codes.length })),
    })),
    answers_on_file: answers,
    resolved_line: null,
    source,
  };
}

/**
 * Record the exporter's answers about their own goods.
 *
 * Takes answers only — `{ basmati: 'yes' }` — and never a tariff code or a candidate array. The
 * canonical candidate set is reloaded from the snapshot here and handed to
 * `recordClassificationRefinement`, which independently re-validates it against that same
 * snapshot. An exporter's answers can never produce a verified selection: the state recorded is
 * always `refinement_required`, and promotion to a verified line is an agent act.
 */
export async function answerClassificationQuestions(args: {
  actor: Principal;
  exporter_org_id: string;
  product_id: string;
  country_code: string;
  answers: Record<string, string>;
  correlation_id: string;
}) {
  const { actor } = args;
  if (!EXPORTER_ROLES.includes(actor.role) && !AGENT_ROLES.includes(actor.role)) {
    throw forbidden('Only the exporter or its assigned agent may answer product classification questions.');
  }
  assertCan(actor, 'demand_discovery.run');
  const { classification } = await loadProduct(actor, args.exporter_org_id, args.product_id);
  const country = args.country_code.trim().toUpperCase();
  if (!classification) throw validationError([{ field: 'product_id', code: 'classification_required', message: 'This product needs a confirmed HS classification first.' }]);

  const snapshot = await prisma.marketAccessEvidenceSnapshot.findFirst({
    where: { country_code: country, hs6_code: classification.hs6_code },
    orderBy: { retrieved_at: 'desc' },
  });
  if (!snapshot) throw notFound('No authoritative tariff evidence has been gathered for that destination yet.');

  const detail = snapshot.resolution_detail as { declarable_candidates?: Array<Record<string, unknown>> } | null;
  const candidates: CandidateLine[] = (detail?.declarable_candidates ?? []).flatMap((entry) => {
    if (typeof entry.code !== 'string' || typeof entry.description !== 'string') return [];
    return [{
      national_tariff_code: entry.code,
      description: entry.description,
      description_path: Array.isArray(entry.description_path) ? entry.description_path.filter((part): part is string => typeof part === 'string') : [],
      duty_expression: typeof entry.duty === 'string' ? entry.duty : null,
      duty_kind: typeof entry.duty_kind === 'string' ? entry.duty_kind : null,
      effective_from: typeof entry.effective_from === 'string' ? entry.effective_from : null,
      effective_to: typeof entry.effective_to === 'string' ? entry.effective_to : null,
    }];
  });

  // Answers already on file are preserved: a question answered last week is not re-asked, and
  // this submission adds to the record rather than replacing it.
  const existing = await currentRefinement({ product_id: args.product_id, destination_country: country, as_of: new Date() });
  const merged = { ...((existing?.deciding_attributes ?? {}) as Record<string, string>), ...args.answers };

  const { recordClassificationRefinement } = await import('@/lib/market-access/classification-refinement');
  return recordClassificationRefinement({
    actor,
    exporter_org_id: args.exporter_org_id,
    product_id: args.product_id,
    product_classification_id: classification.id,
    destination_country: country,
    national_code_system: snapshot.national_code_system!,
    source_authority: snapshot.source_authority,
    source_reference: snapshot.source_reference,
    source_snapshot_id: snapshot.id,
    candidates,
    deciding_attributes: merged,
    // Never a selection state from this surface, even when the answers leave one line. The
    // exporter has described their goods; declaring the tariff line is a separate, explicit act.
    state: 'refinement_required',
    correlation_id: args.correlation_id,
  });
}
