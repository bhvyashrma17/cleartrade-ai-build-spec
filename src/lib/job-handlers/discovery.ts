/**
 * `demand_discovery` job handler — the only place that knows both the engine interface
 * and the database.
 *
 * It reads the run's frozen `input_snapshot` rather than the job payload's copy of it
 * wherever possible: docs/04 EXP-04-AC01 makes the run's snapshot the record of what was
 * actually searched, so the engine must be fed from the same source the user is shown.
 */

import { JobStatus, Prisma } from '@prisma/client';
import { getDiscoveryEngine } from '@/lib/discovery';
import type { DiscoveryInput } from '@/lib/discovery';
import type { JobContext, JobOutcome } from '@/lib/jobs';
import { prisma } from '@/lib/prisma';

/** The shape POST /api/v1/discovery-runs writes into DiscoveryRun.input_snapshot. */
interface StoredSnapshot {
  source?: string;
  evidence_origin?: 'unknown_legacy'|'fixture'|'mock'|'preview'|'authenticated_real'|'public_real'|'imported_real'|'manually_entered_real';
  name?: string | null;
  description?: string | null;
  hs_code?: string | null;
  itc_hs_code?:string|null;
  classification_nomenclature?:string|null;
  classification_version?:string|null;
  classification_revision?:number|null;
  classification_id?:string|null;
  target_countries?: string[];
  origin_country?: string | null;
  origin_state?: string | null;
  origin_city?: string | null;
  origin_location_code?: string | null;
  origin_gateway?: string | null;
  price_target_amount?: string | number | null;
  price_target_currency?: string | null;
  price_target_quantity_unit?: string | null;
  price_target_incoterm?: string | null;
  capacity_value?:string|number|null;
  capacity_unit?:string|null;
  lead_time_days?: number | null;
  delivery_commitment_days?: number | null;
  logistics_constraint_codes?: string[];
  logistics_constraints_confirmed?: boolean;
  desired_order_size_amount?: string | number | null;
  desired_order_size_currency?: string | null;
  customization_capability?: string | null;
  packaging_capability?: string | null;
  moq_value?: string | number | null;
  moq_unit?: string | null;
  certifications?: { code: string; name: string; status: string; evidence_ref: string | null; valid_until?:string|null }[];
  as_of_date?:string;
}

export async function runDemandDiscovery(ctx: JobContext): Promise<JobOutcome> {
  const runId = ctx.target_id;
  if (!runId) throw new Error('demand_discovery job has no target discovery run.');

  const run = await prisma.discoveryRun.findUnique({
    where: { id: runId },
    select: { id: true, product_id: true, input_snapshot: true, exporter_org_id: true },
  });
  if (!run) throw new Error(`Discovery run ${runId} no longer exists.`);

  const snapshot = (run.input_snapshot ?? {}) as StoredSnapshot;
  const description = snapshot.description ?? snapshot.name ?? '';
  if (!description) throw new Error(`Discovery run ${runId} has no product context to search on.`);

  const input: DiscoveryInput = {
    description,
    hs_code: snapshot.hs_code ?? null,
    target_countries: snapshot.target_countries ?? [],
    origin_country: snapshot.origin_country ?? 'IN',
    origin_state: snapshot.origin_state ?? null,
    origin_city: snapshot.origin_city ?? null,
    origin_location_code: snapshot.origin_location_code ?? null,
    origin_gateway: snapshot.origin_gateway ?? null,
    price_target_amount: snapshot.price_target_amount == null ? null : Number(snapshot.price_target_amount),
    price_target_currency: snapshot.price_target_currency ?? null,
    price_target_quantity_unit: snapshot.price_target_quantity_unit ?? null,
    price_target_incoterm: snapshot.price_target_incoterm ?? null,
    capacity_value:snapshot.capacity_value==null?null:Number(snapshot.capacity_value),
    capacity_unit:snapshot.capacity_unit??null,
    lead_time_days: snapshot.lead_time_days ?? null,
    delivery_commitment_days: snapshot.delivery_commitment_days ?? null,
    logistics_constraint_codes: snapshot.logistics_constraint_codes ?? [],
    logistics_constraints_confirmed: snapshot.logistics_constraints_confirmed ?? false,
    desired_order_size_amount: snapshot.desired_order_size_amount == null ? null : Number(snapshot.desired_order_size_amount),
    desired_order_size_currency: snapshot.desired_order_size_currency ?? null,
    customization_capability: snapshot.customization_capability ?? null,
    packaging_capability: snapshot.packaging_capability ?? null,
    moq_value: snapshot.moq_value == null ? null : Number(snapshot.moq_value),
    moq_unit: snapshot.moq_unit ?? null,
    certifications: snapshot.certifications ?? [],
    as_of_date:snapshot.as_of_date,
  };
  const classification=run.product_id&&snapshot.classification_id?await prisma.productClassification.findFirst({where:{id:snapshot.classification_id,product_id:run.product_id},select:{id:true}}):null;

  await prisma.discoveryRun.update({
    where: { id: runId },
    data: { status: JobStatus.processing, started_at: new Date() },
  });

  const engine = getDiscoveryEngine();
  const result = await engine.rank(input, {
    onProgress: (pct) => {
      // Fire-and-forget: a progress write must never fail the job it is reporting on.
      void ctx.reportProgress(pct).catch(() => undefined);
    },
  });

  const status = result.partial ? JobStatus.partial : JobStatus.completed;

  // Results and run status commit together. A half-written run that claims to be complete
  // is worse than one that failed cleanly, and re-running is always safe.
  await prisma.$transaction(async (tx) => {
    // A retry of the same run must not append a second set of rankings on top of the
    // first — the run holds one current result set, and attempt history lives on
    // JobAttempt rows rather than as duplicated assessments.
    await tx.marketAssessment.deleteMany({ where: { run_id: runId } });

    if (result.assessments.length > 0) {
      await tx.marketAssessment.createMany({
        data: result.assessments.map((a) => ({
          run_id: runId,
          product_id: run.product_id,
          country_code: a.country_code.toUpperCase().slice(0, 2),
          overall_score: a.overall_score,
          demand_score: a.demand_score ?? null,
          growth_score: a.growth_score ?? null,
          competition_score: a.competition_score ?? null,
          market_access_score: a.market_access_score ?? null,
          export_economics_score: a.export_economics_score ?? null,
          exporter_market_fit_score: a.exporter_market_fit_score ?? null,
          logistics_feasibility_score: a.logistics_feasibility_score ?? null,
          risk_resilience_score: a.risk_resilience_score ?? null,
          confidence_score: a.confidence_score ?? 0,
          eligibility_status: a.eligibility_status ?? 'eligible',
          eligibility_reasons: (a.eligibility_reasons ?? []) as Prisma.InputJsonValue,
          model_version: a.model_version ?? 'market-attractiveness-v2',
          weight_profile_key: a.weight_profile_key ?? 'general',
          weight_profile_version: a.weight_profile_version ?? 1,
          as_of_date:a.as_of_date?new Date(a.as_of_date):null,
          scoring_policy_version:a.scoring_policy_version??null,
          scoring_policy_hash:a.scoring_policy_hash??null,
          scoring_policy_snapshot:(a.scoring_policy_snapshot??undefined) as Prisma.InputJsonValue|undefined,
          reproducibility_status:a.reproducibility_status??'legacy_non_recomputable',
          evidence_origins: [...new Set([...(a.evidence_origins ?? ['unknown_legacy']),...(a.exporter_market_fit_score!=null&&snapshot.evidence_origin?[snapshot.evidence_origin]:[])])],
          india_share: a.india_share != null ? new Prisma.Decimal(a.india_share) : null,
          classification_id:classification?.id??null,
          classification_hs6_code:snapshot.hs_code??null,
          classification_itc_hs_code:snapshot.itc_hs_code??null,
          classification_nomenclature:snapshot.classification_nomenclature??null,
          classification_version:snapshot.classification_version??null,
          tariff_summary: (a.tariff_summary ?? undefined) as Prisma.InputJsonValue | undefined,
          certification_requirements: (a.certification_requirements ?? []) as Prisma.InputJsonValue,
          logistics_summary: (a.logistics_summary ?? undefined) as Prisma.InputJsonValue | undefined,
          price_band_min: a.price_band_min != null ? new Prisma.Decimal(a.price_band_min) : null,
          price_band_max: a.price_band_max != null ? new Prisma.Decimal(a.price_band_max) : null,
          price_band_currency: a.price_band_currency ?? null,
          rationale: a.rationale,
          // Optional on the interface — an engine with no provenance to report omits it and
          // the column stays null, which is why this survives an engine swap in either
          // direction (docs/04 EXP-04-AC03).
          field_provenance: (a.field_provenance ?? undefined) as Prisma.InputJsonValue | undefined,
        })),
      });
    }

    await tx.discoveryRun.update({
      where: { id: runId },
      data: { status, completed_at: new Date(),as_of_date:snapshot.as_of_date?new Date(snapshot.as_of_date):undefined,scoring_policy_version:typeof result.provenance?.config_version==='number'?result.provenance.config_version:undefined,scoring_policy_hash:typeof result.provenance?.scoring_policy_hash==='string'?result.provenance.scoring_policy_hash:undefined,scoring_policy_snapshot:(result.provenance?.scoring_policy_snapshot??undefined) as Prisma.InputJsonValue|undefined,reproducibility_status:result.provenance?.scoring_policy_snapshot?'reproducible':'legacy_non_recomputable' },
    });
  });

  return {
    status,
    result: {
      assessment_count: result.assessments.length,
      top_markets: result.assessments.slice(0, 3).map((a) => ({
        country_code: a.country_code,
        overall_score: a.overall_score,
      })),
      ...(result.missing?.length ? { missing: result.missing } : {}),
      // Provenance travels with the result so the UI can label AI output as generated
      // and say what produced it (docs/00 §6).
      provenance: result.provenance ?? { engine: engine.name },
    } as Prisma.InputJsonValue,
  };
}
