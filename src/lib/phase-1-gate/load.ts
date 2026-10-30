/**
 * Phase 1 acceptance gate — the read-only evidence loader (docs/34), policy v2.
 *
 * Reads one Demand Discovery v5 run — the run, its assessments, the classification it scored and who
 * confirmed it — and returns plain JSON for `evaluate.ts`. It also makes the docs/36 §8 comparison of
 * the run's top markets with India's own largest destinations, from the BACI release the run froze.
 *
 * It never writes, and it does not rely on being written carefully to guarantee that:
 * `withReadOnlySnapshot` runs every query inside one `REPEATABLE READ, READ ONLY` transaction, so
 * PostgreSQL itself rejects any write (SQLSTATE 25006) and every query sees the same snapshot — a run
 * that finishes mid-evaluation cannot produce a report that is half before and half after it. (The
 * BACI partition files the comparison reads are outside the database; each is checked against the
 * SHA-256 its release recorded.)
 *
 * Only v5 runs are read in full. A run from a retired engine (D-036) is read only far enough for the
 * evaluator to say so. Missing links are recorded as `load_errors` and nulls, never thrown: the
 * evaluator turns them into named failures, which is more useful to an operator than a stack trace.
 */
import { JobStatus, type Prisma, type PrismaClient } from '@prisma/client';
import { compareRunWithIndiaExports } from '@/lib/demand-discovery-v5/calibration-report';
import { DEMAND_DISCOVERY_V5_MODEL } from '@/lib/demand-discovery-v5/policy';
import type { DocumentStorage } from '@/lib/document-storage';
import type { GateArchetypeEvidence, GateCalibrationEvidence, GateMarketEvidence, GateMetricEvidence, GateRunEvidence } from './evaluate';

export type GateDb = Prisma.TransactionClient;

export interface GateSelector {
  kind: 'product' | 'run';
  id: string;
}

/** `product:<id>` or `run:<discoveryRunId>`. */
export function parseGateSelector(value: string): GateSelector {
  const trimmed = value.trim();
  if (/^job:/.test(trimmed)) {
    throw new Error(`"${value}" names a job. Policy v2 evaluates Demand Discovery v5 runs only (D-036): name run:<discoveryRunId> or product:<productId>.`);
  }
  const match = /^(product|run):([A-Za-z0-9_-]{1,64})$/.exec(trimmed);
  if (!match) throw new Error(`Invalid selector "${value}"; expected product:<id> or run:<id>.`);
  return { kind: match[1] as GateSelector['kind'], id: match[2] };
}

export function formatGateSelector(selector: GateSelector): string {
  return `${selector.kind}:${selector.id}`;
}

/**
 * Run `fn` inside one REPEATABLE READ, READ ONLY transaction. The isolation and access mode are set
 * by the first statement of the transaction, which PostgreSQL requires.
 */
export async function withReadOnlySnapshot<T>(
  client: PrismaClient,
  fn: (db: GateDb) => Promise<T>,
  options: { timeout_ms?: number } = {},
): Promise<T> {
  return client.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      return fn(tx);
    },
    { timeout: options.timeout_ms ?? 120_000, maxWait: 10_000 },
  );
}

// ---------------------------------------------------------------------------
// Small readers for stored JSON. Stored JSON is untrusted shape-wise: a field that is not the type
// we expect reads as null, and the evaluator reports the gap.
// ---------------------------------------------------------------------------

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null;
}
function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function strings(value: unknown): string[] {
  return array(value).filter((entry): entry is string => typeof entry === 'string');
}
function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function metricEvidence(value: unknown, code: string, errors: string[]): GateMetricEvidence | null {
  const metric = record(value);
  if (!metric || typeof metric.key !== 'string') {
    errors.push(`metric_unreadable:${code}`);
    return null;
  }
  const score = metric.score == null ? null : finite(metric.score);
  if (metric.score != null && score == null) errors.push(`metric_score_unreadable:${code}:${metric.key}`);
  return { key: metric.key, score, quality: finite(metric.quality) ?? 0, reason: text(metric.reason), estimated: metric.estimated === true, inputs: record(metric.inputs) ?? {} };
}

function marketEvidence(row: {
  id: string; country_code: string; model_version: string; classification_id: string | null; scoring_policy_hash: string | null; market_status: string | null;
  rank: number | null; overall_score: number | null; live_points: number | null; data_year: number | null; confidence_score: number; handed_off: boolean;
  eligibility_reasons: Prisma.JsonValue; flag_reasons: Prisma.JsonValue; labels: Prisma.JsonValue; score_breakdown: Prisma.JsonValue;
}, errors: string[]): GateMarketEvidence {
  const stored = record(row.score_breakdown);
  const excluded = array(row.eligibility_reasons).map(record).find((entry) => entry?.code === 'excluded_market');
  return {
    assessment_id: row.id,
    country_code: row.country_code,
    model_version: row.model_version,
    classification_id: row.classification_id,
    scoring_policy_hash: row.scoring_policy_hash,
    market_status: row.market_status,
    rank: row.rank,
    overall_score: row.overall_score,
    live_points: row.live_points,
    data_year: row.data_year,
    confidence_score: row.confidence_score,
    handed_off: row.handed_off,
    excluded_reason: text(excluded?.reason),
    flag_reasons: strings(row.flag_reasons),
    label_keys: array(row.labels).map((label) => text(record(label)?.key)).filter((key): key is string => key != null),
    breakdown: stored
      ? {
          overall_exact: finite(stored.overall_exact),
          quality: finite(stored.quality),
          confidence: finite(stored.confidence),
          lag: finite(stored.lag),
          has_shortfall: record(stored.shortfall) != null,
          partner_only: typeof record(stored.facts)?.partner_only === 'boolean' ? (record(stored.facts)!.partner_only as boolean) : null,
          metrics: array(stored.metrics).map((metric) => metricEvidence(metric, row.country_code, errors)).filter((metric): metric is GateMetricEvidence => metric != null),
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Run resolution
// ---------------------------------------------------------------------------

const FINISHED: JobStatus[] = [JobStatus.completed, JobStatus.partial];
const CANDIDATE_LIMIT = 50;

interface ResolvedRun {
  run_id: string | null;
  selection_note: string;
  errors: string[];
}

async function resolveFromProduct(db: GateDb, productId: string): Promise<ResolvedRun> {
  const product = await db.product.findUnique({ where: { id: productId }, select: { id: true, hs_classification_revision: true } });
  if (!product) return { run_id: null, selection_note: 'product not found', errors: ['product_not_found'] };
  const classification = await db.productClassification.findFirst({
    where: { product_id: product.id, revision: product.hs_classification_revision, status: 'confirmed' },
    select: { id: true, revision: true },
  });
  if (!classification) return { run_id: null, selection_note: 'product has no current confirmed classification', errors: ['no_current_confirmed_classification'] };
  // Newest first, deterministically: completion time, then id. Only v5 runs are candidates (D-036).
  const candidates = await db.discoveryRun.findMany({
    where: { product_id: product.id, classification_id: classification.id, model_version: DEMAND_DISCOVERY_V5_MODEL, status: { in: FINISHED } },
    // PostgreSQL sorts NULLs first under DESC; a finished run always has completed_at, but a malformed
    // row must never be chosen as "newest".
    orderBy: [{ completed_at: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
    take: CANDIDATE_LIMIT,
    select: { id: true },
  });
  if (!candidates.length) {
    return { run_id: null, selection_note: `no completed or partial v5 run for classification revision ${classification.revision}`, errors: ['no_finished_v5_run_for_classification'] };
  }
  return { run_id: candidates[0].id, selection_note: `newest completed/partial v5 run for classification revision ${classification.revision} (${candidates.length} candidate(s) considered)`, errors: [] };
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export interface GateLoadOptions {
  /** How many of the run's top markets the calibration compares: the policy's `calibration.top`. */
  calibration_top: number;
  /** Where BACI partitions are read from; the configured document storage when omitted. */
  storage?: DocumentStorage;
}

/** Load one archetype's evidence. Call inside `withReadOnlySnapshot`. */
export async function loadPhase1GateArchetypeEvidence(db: GateDb, archetypeKey: string, selector: GateSelector, options: GateLoadOptions): Promise<GateArchetypeEvidence> {
  const resolved = selector.kind === 'product' ? await resolveFromProduct(db, selector.id) : { run_id: selector.id, selection_note: 'run named explicitly', errors: [] };
  const errors = [...resolved.errors];

  const row = resolved.run_id ? await db.discoveryRun.findUnique({ where: { id: resolved.run_id } }) : null;
  if (resolved.run_id && !row) errors.push('run_not_found');

  const product = row?.product_id
    ? await db.product.findUnique({ where: { id: row.product_id }, select: { id: true, exporter_org_id: true, hs_code: true } })
    : null;
  if (row?.product_id && !product) errors.push('product_not_found');
  if (row && !row.product_id) errors.push('run_has_no_product');

  const classificationRow = row?.classification_id
    ? await db.productClassification.findUnique({
        where: { id: row.classification_id },
        select: { id: true, revision: true, hs6_code: true, nomenclature_version: true, status: true, confirmed_by_id: true, confirmed_at: true, superseded_at: true, confirmed_by: { select: { role: true } } },
      })
    : null;
  if (row?.classification_id && !classificationRow) errors.push('classification_not_found');
  const confirmations = classificationRow
    ? await db.auditEvent.findMany({ where: { object_type: 'product_classification', object_id: classificationRow.id }, select: { id: true, after_summary: true }, orderBy: [{ timestamp: 'asc' }, { id: 'asc' }] })
    : [];

  const job = row?.job_id ? await db.job.findUnique({ where: { id: row.job_id }, select: { status: true } }) : null;
  if (row?.job_id && !job) errors.push('run_job_not_found');

  let run: GateRunEvidence | null = null;
  let markets: GateMarketEvidence[] = [];
  let calibration: GateCalibrationEvidence | null = null;
  if (row) {
    const frozen = record(row.frozen_inputs);
    const universe = record(frozen?.universe);
    const baci = record(frozen?.baci);
    const summary = record(row.summary);
    run = {
      id: row.id,
      model_version: row.model_version,
      status: row.status,
      trigger: row.trigger,
      classification_id: row.classification_id,
      input_hs6: text(record(row.input_snapshot)?.hs_code),
      job_id: row.job_id,
      job_status: job?.status ?? null,
      as_of_date: iso(row.as_of_date),
      created_at: row.created_at.toISOString(),
      started_at: iso(row.started_at),
      completed_at: iso(row.completed_at),
      scoring_policy_hash: row.scoring_policy_hash,
      scoring_policy_snapshot: row.scoring_policy_snapshot,
      frozen: {
        schema_version: text(frozen?.schema_version),
        policy_version: text(frozen?.policy_version),
        policy_hash: text(frozen?.policy_hash),
        universe_version: text(universe?.version),
        universe_size: finite(universe?.size),
        baci_release_id: text(baci?.chosen_release_id),
        base_years: array(baci?.base_years).map(finite).filter((year): year is number => year != null),
      },
      notes: strings(summary?.notes),
      summary_markets: finite(summary?.markets),
    };

    if (row.model_version === DEMAND_DISCOVERY_V5_MODEL) {
      if (!frozen) errors.push('run_has_no_frozen_inputs');
      const rows = await db.marketAssessment.findMany({
        where: { run_id: row.id },
        select: {
          id: true, country_code: true, model_version: true, classification_id: true, scoring_policy_hash: true, market_status: true, rank: true, overall_score: true,
          live_points: true, data_year: true, confidence_score: true, handed_off: true, eligibility_reasons: true, flag_reasons: true, labels: true, score_breakdown: true,
        },
        orderBy: [{ country_code: 'asc' }, { id: 'asc' }],
      });
      markets = rows.map((item) => marketEvidence(item, errors));

      try {
        const report = await compareRunWithIndiaExports(row.id, options.calibration_top, { db, storage: options.storage });
        calibration = {
          status: 'computed', error: null, baci_release_id: report.baci_release_id, years: report.years, top: report.top,
          india_top: report.india_top.map((item) => ({ market: item.market, usd: item.usd, status: item.status, rank: item.rank })),
          run_top: report.run_top.map((item) => ({ market: item.market, rank: item.rank })),
          overlap: report.overlap,
          missed: report.missed.map((item) => ({ market: item.market, status: item.status, rank: item.rank })),
        };
      } catch (error) {
        calibration = { status: 'error', error: error instanceof Error ? error.message : String(error), baci_release_id: null, years: [], top: options.calibration_top, india_top: [], run_top: [], overlap: 0, missed: [] };
      }
    }
  }

  return {
    archetype_key: archetypeKey,
    selector: formatGateSelector(selector),
    selection_note: resolved.selection_note,
    load_errors: [...new Set(errors)].sort(),
    product: product ? { id: product.id, exporter_org_id: product.exporter_org_id, hs_code: product.hs_code } : null,
    classification: classificationRow
      ? {
          id: classificationRow.id,
          revision: classificationRow.revision,
          hs6_code: classificationRow.hs6_code,
          nomenclature_version: classificationRow.nomenclature_version,
          status: classificationRow.status,
          confirmed_by_id: classificationRow.confirmed_by_id,
          confirmed_by_role: classificationRow.confirmed_by?.role ?? null,
          confirmed_at: iso(classificationRow.confirmed_at),
          superseded_at: iso(classificationRow.superseded_at),
          confirmation_audit_event_ids: confirmations.filter((event) => record(event.after_summary)?.status === 'confirmed').map((event) => event.id),
        }
      : null,
    run,
    markets,
    calibration,
  };
}
