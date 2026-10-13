/**
 * Demand Discovery v5 runs on the canonical records (docs/36 §7).
 *
 * - `startDemandDiscoveryV5` creates one `DiscoveryRun` for a product's confirmed classification and
 *   enqueues `demand_discovery_v5`. The product facts the score uses are frozen into the run.
 * - `autoStartDemandDiscoveryV5` is what confirming a classification calls (D-018). It never throws:
 *   a confirmation stands whether or not a run could start, and the reason is audited.
 * - `writeV5Results` stores one `MarketAssessment` per screening market and closes the run, in one
 *   transaction, so a run is never half-written.
 *
 * Tier gates are unchanged: a v5 run is costed work (Comtrade), so only a paid tenant can cause
 * one — checked here before any row is written, and again by `enqueueJob`.
 */
import { AuditSource, JobStatus, JobType, OrgTier, Prisma, ProductClassificationStatus, type EvidenceOrigin } from '@prisma/client';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { tierMayCauseCostedWork } from '@/lib/billing/costed-work';
import { getConfig } from '@/lib/config';
import { jobAlreadyRunning, notFound, upgradeRequired, validationError } from '@/lib/errors';
import { enqueueJob, findInFlightJob } from '@/lib/jobs';
import { prisma } from '@/lib/prisma';
import { BACI_PROVIDER } from '@/lib/trade-datasets/baci';
import { latestReadyTradeDatasetRelease } from '@/lib/trade-datasets/service';
import type { Principal } from '@/types';
import type { AssessedMarket, AssessmentResult } from './assess';
import { DEMAND_DISCOVERY_V5_MODEL, type MetricKey, type PartKey } from './policy';
import type { V5ProductFacts } from './run-inputs';

export type V5Trigger = 'classification_confirmed' | 'manual' | 'refresh';

export const v5DedupeKey = (productId: string, classificationId: string) => `demand_discovery_v5:${productId}:${classificationId}`;

/** Whether new runs go to v5 in this environment. v5 needs a ready BACI release to rank anything. */
export async function demandDiscoveryV5Availability(): Promise<{ available: true } | { available: false; reason: string }> {
  const config = await getConfig('demand_discovery.v5');
  if (!config.enabled) return { available: false, reason: 'Demand Discovery v5 is switched off in config.' };
  const [hs17, hs22] = await Promise.all([latestReadyTradeDatasetRelease(BACI_PROVIDER, 'HS17'), latestReadyTradeDatasetRelease(BACI_PROVIDER, 'HS22')]);
  if (!hs17 && !hs22) return { available: false, reason: 'No CEPII BACI release is ready in this environment.' };
  return { available: true };
}

const decimalNumber = (value: Prisma.Decimal | null) => (value == null ? null : Number(value.toString()));

export async function startDemandDiscoveryV5(args: { product_id: string; actor: Principal | null; trigger: V5Trigger; correlation_id: string; target_countries?: string[] }) {
  const product = await prisma.product.findUnique({ where: { id: args.product_id }, include: { exporter_org: { select: { id: true, tier: true } } } });
  if (!product) throw notFound('That product is not available.');
  if (product.hs_classification_status !== ProductClassificationStatus.confirmed || !product.hs_code || !/^\d{6}$/.test(product.hs_code)) {
    throw validationError([{ field: 'product_id', code: 'classification_unconfirmed', message: 'Confirm an exact HS6 classification before running Demand Discovery.' }]);
  }
  const classification = await prisma.productClassification.findFirst({ where: { product_id: product.id, status: ProductClassificationStatus.confirmed, hs6_code: product.hs_code }, orderBy: { confirmed_at: 'desc' } });
  if (!classification) throw validationError([{ field: 'product_id', code: 'classification_history_missing', message: 'The confirmed code has no classification history and must be reviewed again.' }]);
  if (!tierMayCauseCostedWork(product.exporter_org.tier)) throw upgradeRequired(OrgTier.paid, 'Full Demand Discovery is part of the Premium plan.');

  const dedupeKey = v5DedupeKey(product.id, classification.id);
  const inFlight = await findInFlightJob(dedupeKey);
  if (inFlight) throw jobAlreadyRunning(inFlight.id);

  const facts: V5ProductFacts = {
    price_target_amount: decimalNumber(product.price_target_amount), price_target_currency: product.price_target_currency,
    price_target_quantity_unit: product.price_target_quantity_unit, price_target_incoterm: product.price_target_incoterm,
    unit_net_weight_value: decimalNumber(product.unit_net_weight_value), unit_net_weight_unit: product.unit_net_weight_unit,
    capacity_value: decimalNumber(product.capacity_value), capacity_unit: product.capacity_unit, capacity_period: product.capacity_period,
  };
  const asOf = new Date();
  const snapshot = {
    source: 'product', product_id: product.id, evidence_origin: product.evidence_origin, name: product.name, description: product.description,
    hs_code: classification.hs6_code, itc_hs_code: classification.itc_hs_code, classification_id: classification.id, classification_revision: classification.revision,
    classification_nomenclature: classification.nomenclature, classification_version: classification.nomenclature_version,
    classification_confirmed_at: classification.confirmed_at?.toISOString() ?? null, v5_product_facts: facts,
    target_countries: args.target_countries ?? [], as_of_date: asOf.toISOString(),
  };

  const run = await prisma.$transaction(async (tx) => {
    const created = await tx.discoveryRun.create({
      data: {
        exporter_org_id: product.exporter_org_id, product_id: product.id, requested_by_id: args.actor?.id ?? null,
        input_snapshot: snapshot as unknown as Prisma.InputJsonValue, as_of_date: asOf, model_version: DEMAND_DISCOVERY_V5_MODEL,
        trigger: args.trigger, classification_id: classification.id,
      },
    });
    await writeAuditEvent({
      db: tx, actor: args.actor, action: AUDIT_ACTIONS.create, object_type: 'discovery_run', object_id: created.id, exporter_org_id: product.exporter_org_id,
      after_summary: { model_version: DEMAND_DISCOVERY_V5_MODEL, trigger: args.trigger, hs6: classification.hs6_code, classification_id: classification.id },
      correlation_id: args.correlation_id, source: args.actor ? AuditSource.web : AuditSource.job,
    });
    return created;
  });

  try {
    const job = await enqueueJob({
      type: JobType.demand_discovery_v5, payload: { discovery_run_id: run.id }, exporter_org_id: product.exporter_org_id, requested_by_id: args.actor?.id ?? null,
      target_type: 'discovery_run', target_id: run.id, dedupe_key: dedupeKey, correlation_id: args.correlation_id,
    });
    await prisma.discoveryRun.update({ where: { id: run.id }, data: { job_id: job.id } });
    return { run_id: run.id, job_id: job.id, status: job.status };
  } catch (error) {
    // The run row stays as the record of an attempt that never started; it is not deleted.
    await prisma.discoveryRun.update({ where: { id: run.id }, data: { status: JobStatus.failed, completed_at: new Date() } });
    throw error;
  }
}

/** D-018: confirming a classification starts a run. Never throws; returns what happened. */
export async function autoStartDemandDiscoveryV5(args: { product_id: string; actor: Principal | null; correlation_id: string }): Promise<{ started: boolean; reason: string | null; run_id?: string; job_id?: string }> {
  try {
    const config = await getConfig('demand_discovery.v5');
    if (!config.auto_start_on_classification) return { started: false, reason: 'Auto-start is switched off in config.' };
    const availability = await demandDiscoveryV5Availability();
    if (!availability.available) return { started: false, reason: availability.reason };
    const product = await prisma.product.findUnique({ where: { id: args.product_id }, select: { exporter_org: { select: { tier: true } } } });
    if (!product) return { started: false, reason: 'The product no longer exists.' };
    if (!tierMayCauseCostedWork(product.exporter_org.tier)) return { started: false, reason: 'Full Demand Discovery starts once the commitment fee is paid.' };
    const started = await startDemandDiscoveryV5({ product_id: args.product_id, actor: args.actor, trigger: 'classification_confirmed', correlation_id: args.correlation_id });
    return { started: true, reason: null, run_id: started.run_id, job_id: started.job_id };
  } catch (error) {
    return { started: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

// --- results ----------------------------------------------------------------------------------

const roundOrNull = (value: number | null | undefined) => (value == null ? null : Math.round(value));

function rowFor(market: AssessedMarket, run: { id: string; product_id: string | null }, context: {
  as_of: Date; policy_hash: string; policy_version: string; config_version: number; evidence_origins: EvidenceOrigin[];
  classification: { id: string | null; hs6: string | null; itc: string | null; nomenclature: string | null; version: string | null };
}): Prisma.MarketAssessmentCreateManyInput {
  const part = (key: PartKey) => market.parts.find((item) => item.part === key)?.score ?? null;
  const metric = (key: MetricKey) => market.metrics.find((item) => item.key === key) ?? null;
  const share = metric('india_foothold')?.inputs.india_share_percent;
  return {
    run_id: run.id,
    product_id: run.product_id,
    country_code: market.market,
    overall_score: market.overall,
    demand_score: roundOrNull(part('demand')),
    growth_score: roundOrNull(metric('growth')?.score),
    competition_score: null,
    market_access_score: roundOrNull(part('access')),
    export_economics_score: null,
    exporter_market_fit_score: roundOrNull(part('exporter_fit')),
    logistics_feasibility_score: roundOrNull(metric('logistics')?.score),
    risk_resilience_score: roundOrNull(part('risk')),
    confidence_score: market.confidence == null ? 0 : Math.round(market.confidence * 100),
    eligibility_status: market.status === 'excluded' ? 'ineligible' : 'eligible',
    eligibility_reasons: (market.status === 'excluded' ? [{ code: 'excluded_market', reason: market.excluded_reason }] : []) as Prisma.InputJsonValue,
    model_version: DEMAND_DISCOVERY_V5_MODEL,
    weight_profile_key: context.policy_version,
    weight_profile_version: context.config_version,
    as_of_date: context.as_of,
    scoring_policy_version: context.config_version,
    scoring_policy_hash: context.policy_hash,
    reproducibility_status: 'reproducible',
    evidence_origins: context.evidence_origins,
    india_share: typeof share === 'number' ? new Prisma.Decimal(share.toFixed(3)) : null,
    classification_id: context.classification.id,
    classification_hs6_code: context.classification.hs6,
    classification_itc_hs_code: context.classification.itc,
    classification_nomenclature: context.classification.nomenclature,
    classification_version: context.classification.version,
    rationale: market.reasons.map((reason) => reason.text).join(' ') || null,
    field_provenance: { source: market.source, window: market.window, structure_year: market.structure_year, data_year: market.data_year, newest_year: market.newest_year ? { linked: market.newest_year.linked != null, refusal: market.newest_year.refusal } : null } as Prisma.InputJsonValue,
    assessment_identity: `v5:${run.id}:${market.market}`,
    market_status: market.status,
    rank: market.rank,
    live_points: market.status === 'ranked' || market.status === 'not_enough_data' ? market.live_points : null,
    data_year: market.data_year,
    score_breakdown: {
      overall_exact: market.overall_exact, parts: market.parts, metrics: market.metrics, quality: market.quality, confidence: market.confidence, lag: market.lag,
      window: market.window, structure_year: market.structure_year, source: market.source, shortfall: market.shortfall, newest_year: market.newest_year,
      facts: { ...market.facts, window: undefined },
    } as unknown as Prisma.InputJsonValue,
    labels: market.labels as unknown as Prisma.InputJsonValue,
    reasons: market.reasons as unknown as Prisma.InputJsonValue,
    flag_reasons: market.flag_reasons as unknown as Prisma.InputJsonValue,
    handed_off: market.handed_off,
  };
}

export async function writeV5Results(args: {
  run: { id: string; product_id: string | null; exporter_org_id: string; input_snapshot: Prisma.JsonValue };
  result: AssessmentResult;
  frozen_inputs: Record<string, unknown>;
  evidence_origins: EvidenceOrigin[];
  notes: string[];
  status: typeof JobStatus.completed | typeof JobStatus.partial;
  as_of: Date;
  config_version: number;
  policy_snapshot: unknown;
  correlation_id: string;
}) {
  const snapshot = (args.run.input_snapshot ?? {}) as Record<string, unknown>;
  const text = (key: string) => (typeof snapshot[key] === 'string' ? (snapshot[key] as string) : null);
  const context = {
    as_of: args.as_of, policy_hash: args.result.policy_hash, policy_version: args.result.policy_version, config_version: args.config_version, evidence_origins: args.evidence_origins,
    classification: { id: text('classification_id'), hs6: text('hs_code'), itc: text('itc_hs_code'), nomenclature: text('classification_nomenclature'), version: text('classification_version') },
  };
  const summary = { ...args.result.summary, notes: args.notes, base_years: args.result.base_years, short_history: args.result.short_history, india_unit_values: args.result.india_unit_values };
  await prisma.$transaction(async (tx) => {
    // A retry replaces the run's one result set; attempt history lives on JobAttempt rows.
    await tx.marketAssessment.deleteMany({ where: { run_id: args.run.id } });
    await tx.marketAssessment.createMany({ data: args.result.markets.map((market) => rowFor(market, args.run, context)) });
    await tx.discoveryRun.update({
      where: { id: args.run.id },
      data: {
        status: args.status, completed_at: new Date(), model_version: DEMAND_DISCOVERY_V5_MODEL, summary: summary as unknown as Prisma.InputJsonValue,
        frozen_inputs: args.frozen_inputs as Prisma.InputJsonValue, scoring_policy_version: args.config_version, scoring_policy_hash: args.result.policy_hash,
        scoring_policy_snapshot: args.policy_snapshot as Prisma.InputJsonValue, reproducibility_status: 'reproducible',
      },
    });
    await writeAuditEvent({
      db: tx, actor: null, action: AUDIT_ACTIONS.update, object_type: 'discovery_run', object_id: args.run.id, exporter_org_id: args.run.exporter_org_id,
      after_summary: { status: args.status, model_version: DEMAND_DISCOVERY_V5_MODEL, ranked: args.result.summary.ranked, handed_off: args.result.summary.handed_off.map((item) => item.market) },
      correlation_id: args.correlation_id, source: AuditSource.job,
    });
  });
  return summary;
}
