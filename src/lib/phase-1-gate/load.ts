/**
 * Phase 1 acceptance gate — the read-only evidence loader (docs/34).
 *
 * Reads everything one completed deep Country Truth run produced, plus the classification and
 * screen it came from, and returns plain JSON for `evaluate.ts`. It never writes, and it does not
 * rely on being written carefully to guarantee that: `withReadOnlySnapshot` runs every query inside
 * one `REPEATABLE READ, READ ONLY` transaction, so PostgreSQL itself rejects any write (SQLSTATE
 * 25006) and every query sees the same snapshot — a run that completes mid-evaluation cannot
 * produce a report that is half before and half after it.
 *
 * Missing links are recorded as `load_errors` and nulls, never thrown: the evaluator turns them
 * into named failures, which is more useful to an operator than a stack trace.
 */
import { JobType, type Job, type Prisma, type PrismaClient } from '@prisma/client';
import { canonicalHash } from '@/lib/country-evidence/planner';
import type {
  GateArchetypeEvidence,
  GateComponentEvidence,
  GateComponentKey,
  GateMarketEvidence,
  GateTariffEvidenceRow,
} from './evaluate';

export type GateDb = Prisma.TransactionClient;

export interface GateSelector {
  kind: 'product' | 'job';
  id: string;
}

/** `product:<id>` or `job:<id>`. */
export function parseGateSelector(value: string): GateSelector {
  const match = /^(product|job):([A-Za-z0-9_-]{1,64})$/.exec(value.trim());
  if (!match) throw new Error(`Invalid selector "${value}"; expected product:<id> or job:<id>.`);
  return { kind: match[1] as GateSelector['kind'], id: match[2] };
}

export function formatGateSelector(selector: GateSelector): string {
  return `${selector.kind}:${selector.id}`;
}

/**
 * Run `fn` inside one REPEATABLE READ, READ ONLY transaction. The isolation and access mode are
 * set by the first statement of the transaction, which PostgreSQL requires.
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
function decimalNumber(value: Prisma.Decimal | null): number | null {
  if (value == null) return null;
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? parsed : null;
}

const TARIFF_FACT_PREFIX = 'market_access_tariff:';

/** Where each scored component lives in `MarketAssessment.field_provenance` (country-truth-v4-service.ts). */
const COMPONENT_PROVENANCE_FIELDS: Record<GateComponentKey, string> = {
  demand_strength: 'demand_score',
  growth_momentum: 'growth_score',
  competitive_opportunity: 'competition_score',
  market_access: 'market_access',
  export_economics: 'export_economics',
  exporter_market_fit: 'exporter_market_fit',
  logistics_feasibility: 'logistics_feasibility',
  risk_resilience: 'risk_resilience',
};

function componentEvidence(value: unknown): GateComponentEvidence | null {
  const component = record(value);
  if (!component || typeof component.available !== 'boolean') return null;
  return { available: component.available, score: finite(component.score), exclusion_reason: text(component.exclusion_reason) };
}

// ---------------------------------------------------------------------------
// Run resolution
// ---------------------------------------------------------------------------

const TERMINAL_RUN_STATUSES = ['completed', 'partial'] as const;
const JOB_CANDIDATE_LIMIT = 50;

interface ResolvedRun {
  job: Job | null;
  product_id: string | null;
  classification_id: string | null;
  selection_note: string;
  errors: string[];
}

async function resolveFromProduct(db: GateDb, productId: string): Promise<ResolvedRun> {
  const product = await db.product.findUnique({ where: { id: productId }, select: { id: true, hs_classification_revision: true } });
  if (!product) return { job: null, product_id: null, classification_id: null, selection_note: 'product not found', errors: ['product_not_found'] };
  const classification = await db.productClassification.findFirst({
    where: { product_id: product.id, revision: product.hs_classification_revision, status: 'confirmed' },
    select: { id: true, revision: true },
  });
  if (!classification) {
    return { job: null, product_id: product.id, classification_id: null, selection_note: 'product has no current confirmed classification', errors: ['no_current_confirmed_classification'] };
  }
  // Newest first, deterministically: completion time, then id. A screen-derived run is preferred,
  // because only a screen-derived run can satisfy the destination-set rule; when none exists the
  // newest run is still returned so the report says WHY it cannot pass rather than "not found".
  const candidates = await db.job.findMany({
    where: {
      type: JobType.country_truth_discovery,
      target_type: 'product_classification',
      target_id: classification.id,
      status: { in: [...TERMINAL_RUN_STATUSES] },
    },
    // PostgreSQL sorts NULLs first under DESC; a terminal job always has completed_at, but a
    // malformed row must never be chosen as "newest".
    orderBy: [{ completed_at: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
    take: JOB_CANDIDATE_LIMIT,
  });
  const screened = candidates.find((job) => record(record(job.payload)?.provenance) != null);
  const job = screened ?? candidates[0] ?? null;
  if (!job) {
    return { job: null, product_id: product.id, classification_id: classification.id, selection_note: `no completed or partial deep run for classification revision ${classification.revision}`, errors: ['no_terminal_country_truth_job_for_classification'] };
  }
  const note = screened
    ? `newest completed/partial screen-derived deep run for classification revision ${classification.revision} (${candidates.length} candidate(s) considered)`
    : `newest completed/partial deep run for classification revision ${classification.revision}; none of ${candidates.length} candidate(s) came from a global screen`;
  return { job, product_id: product.id, classification_id: classification.id, selection_note: note, errors: [] };
}

async function resolveFromJob(db: GateDb, jobId: string): Promise<ResolvedRun> {
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job) return { job: null, product_id: null, classification_id: null, selection_note: 'job not found', errors: ['job_not_found'] };
  if (job.type !== JobType.country_truth_discovery) {
    return { job: null, product_id: null, classification_id: null, selection_note: `job is ${job.type}`, errors: ['job_is_not_country_truth_discovery'] };
  }
  const payload = record(job.payload);
  return {
    job,
    product_id: text(payload?.product_id),
    classification_id: text(payload?.product_classification_id),
    selection_note: 'job named explicitly',
    errors: payload ? [] : ['job_payload_unreadable'],
  };
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/** Load one archetype's evidence. Call inside `withReadOnlySnapshot`. */
export async function loadPhase1GateArchetypeEvidence(
  db: GateDb,
  archetypeKey: string,
  selector: GateSelector,
): Promise<GateArchetypeEvidence> {
  const resolved = selector.kind === 'product' ? await resolveFromProduct(db, selector.id) : await resolveFromJob(db, selector.id);
  const errors = [...resolved.errors];

  const product = resolved.product_id
    ? await db.product.findUnique({
        where: { id: resolved.product_id },
        select: { id: true, exporter_org_id: true, hs_code: true, hs_classification_status: true, hs_classification_revision: true },
      })
    : null;
  if (resolved.product_id && !product) errors.push('product_not_found');

  const classificationRow = resolved.classification_id
    ? await db.productClassification.findUnique({
        where: { id: resolved.classification_id },
        select: {
          id: true, revision: true, hs6_code: true, nomenclature_version: true, status: true, method: true,
          confirmed_by_id: true, confirmed_at: true, superseded_at: true, confirmed_by: { select: { role: true } },
        },
      })
    : null;
  if (resolved.classification_id && !classificationRow) errors.push('classification_not_found');
  const confirmations = classificationRow
    ? await db.auditEvent.findMany({
        where: { object_type: 'product_classification', object_id: classificationRow.id },
        select: { id: true, after_summary: true },
        orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
      })
    : [];

  const job = resolved.job;
  const payload = record(job?.payload);
  const result = record(job?.result);
  const provenance = record(payload?.provenance);

  const screeningRunId = text(provenance?.screening_run_id);
  const screeningRun = screeningRunId
    ? await db.countryScreeningRun.findUnique({
        where: { id: screeningRunId },
        select: {
          id: true, run_key: true, status: true, as_of_date: true, policy_version: true, policy_hash: true, universe_version: true,
          eligible_count: true, shortlist_size: true, physical_call_count: true, completed_at: true,
        },
      })
    : null;
  if (screeningRunId && !screeningRun) errors.push('screening_run_not_found');

  const planId = text(result?.country_evidence_plan_id);
  const plan = planId
    ? await db.countryEvidencePlan.findUnique({
        where: { id: planId },
        select: {
          id: true, plan_key: true, status: true, screening_run_id: true, as_of_date: true, period_set: true,
          latest_common_year: true, policy_version: true, policy_hash: true, candidate_reporters: true,
        },
      })
    : null;
  if (job && !planId) errors.push('job_result_names_no_evidence_plan');
  else if (planId && !plan) errors.push('evidence_plan_not_found');

  const manifestId = text(result?.country_evidence_manifest_id);
  const manifest = manifestId
    ? await db.countryEvidenceManifest.findUnique({ where: { id: manifestId }, select: { id: true, checksum: true, evaluation_state: true, created_at: true } })
    : null;
  if (job && !manifestId) errors.push('job_result_names_no_manifest');
  else if (manifestId && !manifest) errors.push('manifest_not_found');

  const runId = text(result?.discovery_run_id);
  const discoveryRun = job
    ? runId
      ? await db.discoveryRun.findUnique({ where: { id: runId } })
      : await db.discoveryRun.findFirst({ where: { job_id: job.id }, orderBy: [{ created_at: 'asc' }, { id: 'asc' }] })
    : null;
  if (job && !discoveryRun) errors.push('discovery_run_not_found');

  const assessments = discoveryRun
    ? await db.marketAssessment.findMany({
        where: { run_id: discoveryRun.id },
        orderBy: [{ country_code: 'asc' }, { id: 'asc' }],
        select: {
          id: true, country_code: true, country_truth_assessment_state: true, eligibility_status: true, overall_score: true,
          confidence_score: true, classification_current: true, assessment_checksum: true, assessment_identity: true,
          as_of_date: true, field_provenance: true, country_trade_metrics_id: true, country_trade_metrics_checksum: true,
          country_evidence_manifest_checksum: true, country_truth_fact_snapshot_id: true, country_truth_fact_snapshot_checksum: true,
        },
      })
    : [];

  const metricIds = [...new Set(assessments.flatMap((row) => (row.country_trade_metrics_id ? [row.country_trade_metrics_id] : [])))].sort();
  const metrics = metricIds.length
    ? await db.countryTradeMetrics.findMany({
        where: { id: { in: metricIds } },
        select: { id: true, checksum: true, manifest_id: true, reporter_code: true, latest_common_year: true, metrics_payload: true },
      })
    : [];
  const metricsById = new Map(metrics.map((row) => [row.id, row]));
  const manifestIds = [...new Set(metrics.map((row) => row.manifest_id))].sort();
  const manifests = manifestIds.length
    ? await db.countryEvidenceManifest.findMany({ where: { id: { in: manifestIds } }, select: { id: true, checksum: true } })
    : [];
  const manifestChecksums = new Map(manifests.map((row) => [row.id, row.checksum]));

  const factIds = [...new Set(assessments.flatMap((row) => (row.country_truth_fact_snapshot_id ? [row.country_truth_fact_snapshot_id] : [])))].sort();
  const factSnapshots = factIds.length
    ? await db.countryTruthFactSnapshot.findMany({
        where: { id: { in: factIds } },
        select: { id: true, facts_checksum: true, facts_payload: true, as_of_date: true },
      })
    : [];
  const factsById = new Map(factSnapshots.map((row) => [row.id, row]));

  const usedTariffIds = (fieldProvenance: unknown) => {
    const access = record(record(fieldProvenance)?.market_access);
    return strings(record(access?.provenance)?.used_fact_ids).filter((id) => id.startsWith(TARIFF_FACT_PREFIX)).sort();
  };
  const evidenceIds = [...new Set(assessments.flatMap((row) => usedTariffIds(row.field_provenance).map((id) => id.slice(TARIFF_FACT_PREFIX.length))))].sort();
  const tariffRows = evidenceIds.length
    ? await db.marketAccessEvidence.findMany({
        where: { id: { in: evidenceIds } },
        select: {
          id: true, rule_type: true, evidence_origin: true, retrieved_at: true, tariff_rate_percent: true, preference_applicability: true,
          snapshot: {
            select: {
              id: true, provider: true, source_authority: true, source_version: true, authority_release_id: true,
              evidence_origin: true, retrieved_at: true, source_run_id: true,
            },
          },
        },
      })
    : [];
  const tariffById = new Map<string, GateTariffEvidenceRow>(
    tariffRows.map((row) => [
      row.id,
      {
        evidence_id: row.id,
        rule_type: row.rule_type,
        evidence_origin: row.evidence_origin,
        retrieved_at: row.retrieved_at.toISOString(),
        tariff_rate_percent: decimalNumber(row.tariff_rate_percent),
        preference_applicability: row.preference_applicability,
        snapshot: row.snapshot
          ? {
              id: row.snapshot.id,
              provider: row.snapshot.provider,
              source_authority: row.snapshot.source_authority,
              source_version: row.snapshot.source_version,
              authority_release_id: row.snapshot.authority_release_id,
              evidence_origin: row.snapshot.evidence_origin,
              retrieved_at: row.snapshot.retrieved_at.toISOString(),
              source_run_id: row.snapshot.source_run_id,
            }
          : null,
      },
    ]),
  );

  const markets: GateMarketEvidence[] = assessments.map((row) => {
    const provenanceByField = record(row.field_provenance);
    const overall = record(provenanceByField?.overall_score);
    const access = record(provenanceByField?.market_access);
    const accessProvenance = record(access?.provenance);
    const accessDetails = record(accessProvenance?.details);
    const metricsRow = row.country_trade_metrics_id ? metricsById.get(row.country_trade_metrics_id) ?? null : null;
    if (row.country_trade_metrics_id && !metricsRow) errors.push(`metrics_not_found:${row.country_trade_metrics_id}`);
    if (!row.country_trade_metrics_id) errors.push(`assessment_without_metrics:${row.id}`);
    const facts = row.country_truth_fact_snapshot_id ? factsById.get(row.country_truth_fact_snapshot_id) ?? null : null;
    if (row.country_truth_fact_snapshot_id && !facts) errors.push(`fact_snapshot_not_found:${row.country_truth_fact_snapshot_id}`);
    const factsPayload = record(facts?.facts_payload);
    const factsScope = record(factsPayload?.scope);
    const used = usedTariffIds(row.field_provenance);
    const tariffEvidence = used.flatMap((id) => {
      const evidence = tariffById.get(id.slice(TARIFF_FACT_PREFIX.length));
      if (!evidence) errors.push(`tariff_evidence_not_found:${id}`);
      return evidence ? [evidence] : [];
    });
    const components = Object.fromEntries(
      (Object.keys(COMPONENT_PROVENANCE_FIELDS) as GateComponentKey[]).map((component) => [
        component,
        componentEvidence(provenanceByField?.[COMPONENT_PROVENANCE_FIELDS[component]]),
      ]),
    ) as Record<GateComponentKey, GateComponentEvidence | null>;

    return {
      assessment_id: row.id,
      country_code: row.country_code,
      reporter_code: metricsRow?.reporter_code ?? null,
      assessment_state: row.country_truth_assessment_state,
      eligibility_status: row.eligibility_status,
      overall_score: row.overall_score,
      confidence_score: row.confidence_score,
      period_lag: finite(overall?.period_lag),
      latest_common_year: metricsRow?.latest_common_year ?? null,
      classification_current: row.classification_current,
      assessment_checksum: row.assessment_checksum,
      assessment_identity: row.assessment_identity,
      components,
      market_access: {
        tariff_rate_percent: finite(accessDetails?.tariff_rate_percent),
        tariff_basis: text(accessDetails?.tariff_basis) ?? text(accessProvenance?.applicable_tariff_basis),
        used_tariff_fact_ids: used,
        excluded_facts: array(accessProvenance?.excluded_facts)
          .map(record)
          .flatMap((entry) => (entry && text(entry.fact_id) && text(entry.reason) ? [{ fact_id: text(entry.fact_id)!, reason: text(entry.reason)! }] : [])),
      },
      // A separate tariff clock (WP2, D-004), when the run recorded one, is what tariff evidence was
      // admitted and evaluated against; otherwise the single assessment clock was.
      tariff_clock: text(factsScope?.tariff_as_of_date) ?? text(factsScope?.as_of_date) ?? iso(facts?.as_of_date) ?? iso(row.as_of_date),
      tariff_evidence: tariffEvidence,
      rejected_tariff_rows: array(factsPayload?.rejected_rows)
        .map(record)
        .flatMap((entry) =>
          entry && entry.source === 'market_access_evidence' && text(entry.row_id) && text(entry.reason)
            ? [{ row_id: text(entry.row_id)!, reason: text(entry.reason)! }]
            : [],
        ),
      integrity: {
        country_trade_metrics_id: row.country_trade_metrics_id,
        metrics_checksum: metricsRow?.checksum ?? null,
        assessment_metrics_checksum: row.country_trade_metrics_checksum,
        metrics_payload_manifest_checksum: text(record(metricsRow?.metrics_payload)?.manifest_checksum),
        manifest_checksum: metricsRow ? manifestChecksums.get(metricsRow.manifest_id) ?? null : null,
        assessment_manifest_checksum: row.country_evidence_manifest_checksum,
        fact_snapshot_id: row.country_truth_fact_snapshot_id,
        fact_snapshot_checksum: facts?.facts_checksum ?? null,
        fact_snapshot_checksum_recomputed: facts ? canonicalHash(facts.facts_payload) : null,
        assessment_fact_snapshot_checksum: row.country_truth_fact_snapshot_checksum,
      },
    };
  });

  return {
    archetype_key: archetypeKey,
    selector: formatGateSelector(selector),
    selection_note: resolved.selection_note,
    load_errors: [...new Set(errors)].sort(),
    product: product
      ? {
          id: product.id,
          exporter_org_id: product.exporter_org_id,
          hs_code: product.hs_code,
          hs_classification_status: product.hs_classification_status,
          hs_classification_revision: product.hs_classification_revision,
        }
      : null,
    classification: classificationRow
      ? {
          id: classificationRow.id,
          revision: classificationRow.revision,
          hs6_code: classificationRow.hs6_code,
          nomenclature_version: classificationRow.nomenclature_version,
          status: classificationRow.status,
          method: classificationRow.method,
          confirmed_by_id: classificationRow.confirmed_by_id,
          confirmed_by_role: classificationRow.confirmed_by?.role ?? null,
          confirmed_at: iso(classificationRow.confirmed_at),
          superseded_at: iso(classificationRow.superseded_at),
          confirmation_audit_event_ids: confirmations.filter((event) => record(event.after_summary)?.status === 'confirmed').map((event) => event.id),
        }
      : null,
    job: job
      ? {
          id: job.id,
          status: job.status,
          attempts: job.attempts,
          created_at: job.created_at.toISOString(),
          started_at: iso(job.started_at),
          completed_at: iso(job.completed_at),
          requested_at: text(payload?.requested_at),
          payload_schema_version: text(payload?.schema_version),
          payload_classification_id: text(payload?.product_classification_id),
          physical_calls: finite(result?.physical_calls),
          evidence_status: text(result?.evidence_status),
          error_code: job.error_code,
        }
      : null,
    screening: job
      ? {
          provenance_present: provenance != null,
          screening_run_id: screeningRun?.id ?? screeningRunId,
          run_key: screeningRun?.run_key ?? null,
          status: screeningRun?.status ?? null,
          as_of_date: iso(screeningRun?.as_of_date),
          policy_version: screeningRun?.policy_version ?? null,
          policy_hash: screeningRun?.policy_hash ?? null,
          universe_version: screeningRun?.universe_version ?? null,
          eligible_count: screeningRun?.eligible_count ?? null,
          shortlist_size: screeningRun?.shortlist_size ?? null,
          physical_call_count: screeningRun?.physical_call_count ?? null,
          completed_at: iso(screeningRun?.completed_at),
          shortlist_reporters: strings(provenance?.shortlist_reporters).sort(),
        }
      : null,
    plan: plan
      ? {
          id: plan.id,
          plan_key: plan.plan_key,
          status: plan.status,
          screening_run_id: plan.screening_run_id,
          as_of_date: plan.as_of_date.toISOString(),
          period_set: [...plan.period_set],
          latest_common_year: plan.latest_common_year,
          policy_version: plan.policy_version,
          policy_hash: plan.policy_hash,
          candidate_reporters: [...plan.candidate_reporters].sort(),
        }
      : null,
    manifest: manifest
      ? { id: manifest.id, checksum: manifest.checksum, evaluation_state: manifest.evaluation_state, created_at: manifest.created_at.toISOString() }
      : null,
    discovery_run: discoveryRun
      ? {
          id: discoveryRun.id,
          status: discoveryRun.status,
          as_of_date: iso(discoveryRun.as_of_date),
          started_at: iso(discoveryRun.started_at),
          completed_at: iso(discoveryRun.completed_at),
          scoring_policy_version: discoveryRun.scoring_policy_version,
          scoring_policy_hash: discoveryRun.scoring_policy_hash,
        }
      : null,
    markets,
  };
}
