/**
 * Warehouse discovery engine — ranks markets from ingested Comtrade trade flows.
 *
 * Replaces `MockDiscoveryEngine` as the default. The `DiscoveryEngine` interface is
 * unchanged, so no route, job handler, or component knows this happened: docs/02's "don't
 * bind the frontend to an assumed AI provider or algorithm" is what made the swap a
 * one-line change in `getDiscoveryEngine()`.
 *
 * Division of labour, and it is strict:
 *
 *   - **This file does IO.** It queries `TradeFlow`, assembles candidates, calls the pure
 *     scorer, and calls the rationale writer. It computes no scores of its own.
 *   - **`scoring.ts` does arithmetic.** Pure functions, no IO, no model.
 *   - **`rationale/` does prose.** Handed qualitative bands, never magnitudes.
 *
 * That split is what makes the two hard rules checkable rather than aspirational: the model
 * is never given a number to restate, and every number is produced by a function whose only
 * inputs are warehouse rows.
 *
 * ARCHITECTURAL BOUNDARY: this module reads `TradeFlow` and never returns a row of it.
 * What crosses back to the caller — and from there, through the job handler, to an API
 * response — is scores, bands, and aggregates derived from those rows. Raw flows are
 * Internal Use only under Comtrade's terms (see the model comment in prisma/schema.prisma).
 * Do not add a field to `MarketAssessmentDraft` that carries a row through.
 */

import { createHash } from 'node:crypto';
import { EvidenceCompletenessStatus, Prisma, TradeDataSource, TradeFlowDirection } from '@prisma/client';
import { INDIA_REPORTER, toIso2, WORLD_PARTNER } from '@/lib/comtrade/areas';
import { getConfigWithVersion } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { allowedEvidenceOrigins, tradeFlowEvidenceWhere, tradeSourceModeToEvidenceOrigin } from '@/lib/evidence-environment';
import type { DiscoveryEngine, DiscoveryInput, DiscoveryResult, MarketAssessmentDraft } from './engine';
import { composeRationale } from './rationale';
import { assertSupportedScoringModel, scoringPolicyHash } from './policy';
import {
  scoreCandidateByModel,
  marketAccessHardBlockers,
  marketAccessScopeMatches,
  type CandidateInput,
  type ExporterContext,
  type ScoredMarket,
  type ScoringRow,
} from './scoring';

/** Prisma returns Decimal; scoring works in numbers. Converted once, here, at the boundary. */
function toScoringRow(row: {
  reporter: string;
  partner: string;
  hs_code: string;
  year: number;
  value: Prisma.Decimal;
  quantity: Prisma.Decimal | null;
  unit: string | null;
  unit_value: Prisma.Decimal | null;
  ingested_at: Date;
  source_mode: import('@prisma/client').TradeSourceMode;
  id:string;
  ingest_run_id:string|null;
  acquisitions:{id:string}[];
}): ScoringRow {
  return {
    id:row.id,
    acquisition_id:row.acquisitions[0]?.id??null,
    ingest_run_id:row.ingest_run_id,
    reporter: row.reporter,
    partner: row.partner,
    hs_code: row.hs_code,
    year: row.year,
    value: row.value.toNumber(),
    quantity: row.quantity?.toNumber() ?? null,
    unit: row.unit,
    unit_value: row.unit_value?.toNumber() ?? null,
    ingested_at: row.ingested_at,
    evidence_origin: tradeSourceModeToEvidenceOrigin(row.source_mode),
  };
}

export class WarehouseDiscoveryEngine implements DiscoveryEngine {
  readonly name = 'warehouse-v1';

  async rank(
    input: DiscoveryInput,
    signal?: { onProgress?: (pct: number) => void },
  ): Promise<DiscoveryResult> {
    const configured = await getConfigWithVersion('discovery.scoring');
    const policy = configured.value;
    assertSupportedScoringModel(policy);
    const policyHash=scoringPolicyHash(policy);
    const asOfDate=input.as_of_date?new Date(input.as_of_date):new Date(`${new Date().toISOString().slice(0,10)}T00:00:00.000Z`);
    if(Number.isNaN(asOfDate.getTime()))throw new Error('Demand Discovery requires a valid frozen as_of_date.');
    const missing: string[] = [];

    // An HS code is what indexes the warehouse. Without one there is nothing to look up —
    // and inferring a code from free-text product description is a classification decision
    // with customs consequences, not a convenience this engine gets to make silently.
    // Truncate to six digits before querying. Indian exporters state ITC-HS codes, which
    // are 8-digit national extensions (e.g. 09103030 for turmeric powder); international
    // trade statistics are only published to the 6-digit HS subheading their first six
    // digits belong to (091030). Matching the raw 8-digit code against the warehouse finds
    // nothing — not "no demand", but a granularity mismatch that would silently return an
    // empty ranking for a perfectly well-specified product.
    const hsCode = (input.hs_code?.replace(/\D/g, '') ?? '').slice(0, 6);
    if (!hsCode) {
      return {
        assessments: [],
        partial: true,
        missing: ['No HS code was supplied, so trade data could not be looked up. Add an HS code and run again.'],
        provenance: { engine: this.name, source: 'comtrade', reason: 'no_hs_code' },
      };
    }

    signal?.onProgress?.(10);

    const rowSelect = {
      reporter: true, partner: true, hs_code: true, year: true,
      value: true, quantity: true, unit: true, unit_value: true, ingested_at: true,
      source_mode: true,
      id:true,ingest_run_id:true,acquisitions:{select:{id:true},orderBy:{retrieved_at:'desc' as const},take:1},
    } as const;

    type WarehouseRow = Prisma.TradeFlowGetPayload<{ select: typeof rowSelect }>;
    const effectiveScope = hsCode;
    const worldRows: WarehouseRow[] = await prisma.tradeFlow.findMany({
        where: {
          hs_code: hsCode,
          source: TradeDataSource.comtrade,
          flow_direction: TradeFlowDirection.import,
          partner: WORLD_PARTNER,
          ...tradeFlowEvidenceWhere(),
        },
        select: rowSelect,
      });

    if (worldRows.length === 0) {
      return {
        assessments: [],
        partial: true,
        missing: [`The trade warehouse holds no import data for HS ${hsCode} yet.`],
        provenance: { engine: this.name, source: 'comtrade', hs_scope: hsCode, reason: 'no_warehouse_data' },
      };
    }

    const scopeFilter = {
      hs_code: effectiveScope,
      source: TradeDataSource.comtrade,
      flow_direction: TradeFlowDirection.import,
      ...tradeFlowEvidenceWhere(),
    };

    signal?.onProgress?.(35);

    const byReporter = new Map<string, ScoringRow[]>();
    for (const row of worldRows) {
      const scoringRow = toScoringRow(row);
      const existing = byReporter.get(scoringRow.reporter);
      if (existing) existing.push(scoringRow);
      else byReporter.set(scoringRow.reporter, [scoringRow]);
    }

    // A caller-supplied country list restricts the search; countries with no warehouse data
    // are reported as gaps rather than silently dropped (docs/09 §3 partial semantics).
    const requested = (input.target_countries ?? []).map((c) => c.toUpperCase());
    const newestYearInRun = Math.max(...worldRows.map((r) => r.year));

    const candidates: CandidateInput[] = [];
    const eligibleReporters: string[] = [];

    for (const [reporter, rows] of byReporter) {
      const iso2 = toIso2(reporter);
      if (!iso2) {
        // Never guessed — see the note on `areas.ts`. An unmappable reporter is a declared
        // gap, not an invented country.
        missing.push(`Comtrade reporter ${reporter} has no verified ISO country mapping and was skipped.`);
        continue;
      }
      if (requested.length > 0 && !requested.includes(iso2)) continue;

      const latestYear = Math.max(...rows.map((r) => r.year));
      const latestTotal = rows.filter((r) => r.year === latestYear).reduce((sum, r) => sum + r.value, 0);
      if (latestTotal < policy.volume_floor_usd) continue;

      eligibleReporters.push(reporter);
      candidates.push({ reporter, country_code: iso2, totalRows: rows, indiaRows: [], supplierRowsLatestYear: [] });
    }

    for (const wanted of requested) {
      if (!candidates.some((c) => c.country_code === wanted)) {
        missing.push(`No trade data above the volume threshold for ${wanted}.`);
      }
    }

    if (candidates.length === 0) {
      return {
        assessments: [],
        partial: true,
        missing: missing.length ? missing : [`No market imports HS ${effectiveScope} above the ${policy.volume_floor_usd} USD threshold.`],
        provenance: { engine: this.name, source: 'comtrade', hs_scope: effectiveScope, reason: 'no_candidates_above_floor' },
      };
    }

    // --- Supporting facts: India's share, and the supplier base for HHI ---------
    const partnerRows = await prisma.tradeFlow.findMany({
      where: { ...scopeFilter, reporter: { in: eligibleReporters }, partner: { not: WORLD_PARTNER } },
      select: rowSelect,
    });

    for (const raw of partnerRows) {
      const row = toScoringRow(raw);
      const candidate = candidates.find((c) => c.reporter === row.reporter);
      if (!candidate) continue;

      if (row.partner === INDIA_REPORTER) candidate.indiaRows.push(row);

      const candidateLatestYear = Math.max(...candidate.totalRows.map((r) => r.year));
      // HHI is a snapshot of who supplies this market NOW; mixing years would blend a
      // supplier that exited with one that just arrived into a single meaningless share.
      if (row.year === candidateLatestYear) candidate.supplierRowsLatestYear.push(row);
    }

    for(const candidate of candidates){
      const latestYear=Math.max(...candidate.totalRows.map(row=>row.year));
      const worldTotal=candidate.totalRows.filter(row=>row.year===latestYear).reduce((sum,row)=>sum+row.value,0);
      const supplierSum=candidate.supplierRowsLatestYear.reduce((sum,row)=>sum+row.value,0);
      const partnerCount=new Set(candidate.supplierRowsLatestYear.map(row=>row.partner)).size;
      const ratio=worldTotal>0?supplierSum/worldTotal:null;
      const complete=ratio!=null&&ratio>=policy.competition.minimum_supplier_coverage_ratio&&ratio<=policy.competition.maximum_supplier_coverage_ratio&&partnerCount>=policy.competition.minimum_partner_count;
      const acquisitionIds=candidate.supplierRowsLatestYear.map(row=>row.acquisition_id).filter((id):id is string=>Boolean(id)).sort();
      const queryScope={provider:'comtrade',flow_direction:'import',reporter:candidate.reporter,partner_scope:'all_non_world_rows_present_in_warehouse',hs_code:hsCode,year:latestYear,evidence_origins:allowedEvidenceOrigins()};
      const assertionId=`sca_${createHash('sha256').update(JSON.stringify({queryScope,worldTotal,supplierSum,partnerCount,acquisitionIds,threshold:policy.competition.coverage_policy_version})).digest('hex').slice(0,24)}`;
      const assertion=await prisma.supplierCoverageAssertion.upsert({where:{id:assertionId},create:{id:assertionId,country_code:candidate.country_code,reporter:candidate.reporter,hs_code:hsCode,year:latestYear,world_total_value:new Prisma.Decimal(worldTotal),supplier_value_sum:new Prisma.Decimal(supplierSum),partner_count:partnerCount,coverage_ratio:ratio==null?null:new Prisma.Decimal(ratio),query_scope:queryScope,acquisition_ids:acquisitionIds,completeness_status:complete?EvidenceCompletenessStatus.COMPLETE:EvidenceCompletenessStatus.PARTIAL,threshold_version:policy.competition.coverage_policy_version},update:{}});
      candidate.supplierCoverage={assertion_id:assertion.id,world_total_value:worldTotal,supplier_value_sum:supplierSum,partner_count:partnerCount,coverage_ratio:ratio,completeness:assertion.completeness_status,query_scope:queryScope,acquisition_ids:acquisitionIds,threshold_version:assertion.threshold_version};
    }

    signal?.onProgress?.(60);

    // --- Score -----------------------------------------------------------------
    const context: ExporterContext = {
      price_target: input.price_target_amount ?? null,
      price_target_currency: input.price_target_currency ?? null,
      price_target_quantity_unit: input.price_target_quantity_unit ?? null,
      price_target_incoterm: input.price_target_incoterm ?? null,
      capacity:input.capacity_value??null,
      capacity_unit:input.capacity_unit??null,
      lead_time_days: input.lead_time_days ?? null,
      delivery_commitment_days:input.delivery_commitment_days??null,
      origin_country:input.origin_country??null,
      origin_state:input.origin_state??null,
      origin_city:input.origin_city??null,
      origin_location_code:input.origin_location_code??null,
      origin_gateway:input.origin_gateway??null,
      logistics_constraint_codes:input.logistics_constraint_codes??[],
      logistics_constraints_confirmed:input.logistics_constraints_confirmed??false,
      desired_order_size_amount: input.desired_order_size_amount ?? null,
      desired_order_size_currency: input.desired_order_size_currency ?? null,
      customization_capability: input.customization_capability ?? null,
      packaging_capability: input.packaging_capability ?? null,
      moq_value: input.moq_value ?? null,
      moq_unit: input.moq_unit ?? null,
      certifications: input.certifications ?? [],
    };
    const exporterFitInputs = {
      order_size: context.desired_order_size_amount != null && context.desired_order_size_currency != null,
      certification: Boolean(context.certifications?.some((certification) => certification.status === 'held')),
      lead_time: context.lead_time_days != null,
      moq: context.moq_value != null && context.moq_unit != null,
    };
    const missingExporterFitInputs = Object.entries(exporterFitInputs).filter(([, present]) => !present).map(([name]) => name);
    const exporterFitInputConfidence = Math.round(((4 - missingExporterFitInputs.length) / 4) * 100);

    const fixedDenominators=new Map<number,{values:number[];evidenceIds:string[]}>();
    for(const rows of byReporter.values())for(const year of new Set(rows.map(row=>row.year))){const value=rows.filter(row=>row.year===year).reduce((sum,row)=>sum+row.value,0);const current=fixedDenominators.get(year)??{values:[],evidenceIds:[]};current.values.push(value);current.evidenceIds.push(...rows.filter(row=>row.year===year).map(row=>row.acquisition_id).filter((id):id is string=>Boolean(id)));fixedDenominators.set(year,current);}

    const chapter = hsCode.slice(0, 2);
    const profileEntry = Object.entries(policy.archetype_profiles).find(([key, profile]) => key !== 'general' && profile.hs_chapters.includes(chapter)) ?? ['general', policy.archetype_profiles.general] as const;
    const [weightProfileKey, weightProfile] = profileEntry;
    const accessSnapshots = await Promise.all(candidates.map(async (candidate) => ({
      country: candidate.country_code,
      snapshot: await prisma.marketAccessEvidenceSnapshot.findFirst({ where: { country_code: candidate.country_code, evidence_origin:{in:allowedEvidenceOrigins()},completeness_status: 'COMPLETE', tariff_coverage: true, regulatory_coverage: true, retrieved_at:{gte:new Date(asOfDate.getTime()-policy.market_access.max_snapshot_age_days*86_400_000),lte:asOfDate},AND:[{OR: [{ hs_code_scope: hsCode }, { hs_code_scope: { startsWith: hsCode } }]},{OR: [{ expires_at: null }, { expires_at: { gt: asOfDate } }]}] }, include: { evidence:{where:{evidence_origin:{in:allowedEvidenceOrigins()}}} }, orderBy: { retrieved_at: 'desc' } }),
    })));
    for (const candidate of candidates) {
      const snapshot=accessSnapshots.find(item=>item.country===candidate.country_code)?.snapshot;
      candidate.marketAccess=snapshot?{snapshot_id:snapshot.id,completeness:snapshot.completeness_status,tariff_coverage:snapshot.tariff_coverage,regulatory_coverage:snapshot.regulatory_coverage,evidence_origin:snapshot.evidence_origin,provider:snapshot.provider,source_dataset:snapshot.source_dataset,source_run_id:snapshot.source_run_id,raw_response_checksum:snapshot.raw_response_checksum,policy:policy.market_access,evidence:snapshot.evidence.filter(e=>marketAccessScopeMatches(e.hs_code_scope,hsCode)).map(e=>({id:e.id,rule_type:e.rule_type,status:e.status,confidence:Number(e.confidence),tariff_rate_percent:e.tariff_rate_percent==null?null:Number(e.tariff_rate_percent),requirement_code:e.requirement_code,requirement_obtainable:e.requirement_obtainable,retrieved_at:e.retrieved_at,effective_at:e.effective_at,expires_at:e.expires_at,evidence_origin:e.evidence_origin}))}:null;
    }
    const logisticsEvidence=context.origin_country?await prisma.logisticsRouteEvidence.findMany({where:{origin_country:context.origin_country.toUpperCase(),destination_country:{in:candidates.map(candidate=>candidate.country_code)},status:{not:'superseded'},evidence_origin:{in:allowedEvidenceOrigins()},AND:[{OR:[{hs_code_scope:null},{hs_code_scope:hsCode},{hs_code_scope:{startsWith:hsCode}},{hs_code_scope:{equals:hsCode.slice(0,2)}}]},{OR:[{exporter_org_id:input.exporter_org_id??'__no_tenant__'},{exporter_org_id:null,assertion_class:'authoritative_public'}]}]}}):[];
    for(const candidate of candidates)candidate.logisticsRoutes=logisticsEvidence.filter(route=>route.destination_country===candidate.country_code).map(route=>({id:route.id,origin_country:route.origin_country,origin_state:route.origin_state,origin_city:route.origin_city,origin_location_code:route.origin_location_code,origin_gateway:route.origin_gateway,destination_country:route.destination_country,destination_port:route.destination_port,transport_mode:route.transport_mode,route_available:route.route_available,transit_time_min_days:route.transit_time_min_days,transit_time_max_days:route.transit_time_max_days,freight_amount:route.freight_amount==null?null:Number(route.freight_amount),freight_currency:route.freight_currency,freight_rate_basis:route.freight_rate_basis,freight_retrieved_at:route.freight_retrieved_at,freight_valid_until:route.freight_valid_until,assumed_shipment_value_amount:route.assumed_shipment_value_amount==null?null:Number(route.assumed_shipment_value_amount),assumed_shipment_value_currency:route.assumed_shipment_value_currency,provider:route.provider,source_reference:route.source_reference,retrieved_at:route.retrieved_at,valid_until:route.valid_until,equipment_assumption:route.equipment_assumption,supported_product_constraint_codes:route.supported_product_constraint_codes,confidence:Number(route.confidence),status:route.status}));
    const riskSignals=await prisma.marketRiskSignal.findMany({where:{country_code:{in:candidates.map(candidate=>candidate.country_code)},status:{not:'superseded'},evidence_origin:{in:allowedEvidenceOrigins()},OR:[{hs_code_scope:null},{hs_code_scope:hsCode},{hs_code_scope:{startsWith:hsCode}},{hs_code_scope:{equals:hsCode.slice(0,2)}}]}});
    for(const candidate of candidates)candidate.riskSignals=riskSignals.filter(signal=>signal.country_code===candidate.country_code).map(signal=>({id:signal.id,dimension:signal.dimension,metric:signal.metric,value:Number(signal.value),unit:signal.unit,observation_date:signal.observation_date,period_start:signal.period_start,period_end:signal.period_end,retrieved_at:signal.retrieved_at,valid_until:signal.valid_until,provider:signal.provider,source_reference:signal.source_reference,source_version:signal.source_version,normalization_method:signal.normalization_method,confidence:Number(signal.confidence),status:signal.status}));
    const fitBenchmarks=await prisma.exporterMarketFitBenchmark.findMany({where:{country_code:{in:candidates.map(candidate=>candidate.country_code)},status:{not:'superseded'},evidence_origin:{in:allowedEvidenceOrigins()},OR:[{hs_code_scope:hsCode},{hs_code_scope:{startsWith:hsCode}},{hs_code_scope:{equals:hsCode.slice(0,2)}}]}});
    for(const candidate of candidates)candidate.fitBenchmarks=fitBenchmarks.filter(benchmark=>benchmark.country_code===candidate.country_code).map(benchmark=>({id:benchmark.id,benchmark_type:benchmark.benchmark_type,minimum_value:benchmark.minimum_value==null?null:Number(benchmark.minimum_value),maximum_value:benchmark.maximum_value==null?null:Number(benchmark.maximum_value),unit:benchmark.unit,currency:benchmark.currency,required:benchmark.required,requirement_code:benchmark.requirement_code,provider:benchmark.provider,source_reference:benchmark.source_reference,source_version:benchmark.source_version,observed_at:benchmark.observed_at,retrieved_at:benchmark.retrieved_at,valid_until:benchmark.valid_until,confidence:Number(benchmark.confidence),status:benchmark.status}));
    const rules = await prisma.marketEligibilityRule.findMany({ where: { country_code: { in: candidates.map(c => c.country_code) }, is_active: true, OR: [{ effective_from: null }, { effective_from: { lte: new Date() } }], AND: [{ OR: [{ effective_to: null }, { effective_to: { gt: new Date() } }] }] } });
    const scored: ScoredMarket[] = [];
    const ineligible = new Map<string, typeof rules>();
    for (const candidate of candidates) {
      const applicable = rules.filter(rule => rule.country_code === candidate.country_code && (!rule.hs_code_prefix || hsCode.startsWith(rule.hs_code_prefix)));
      const held = new Set((context.certifications ?? []).filter(c => c.status === 'held'&&Boolean(c.evidence_ref)&&(!c.valid_until||new Date(c.valid_until)>new Date())).map(c => c.code.toUpperCase()));
      const blockers = applicable.filter(rule => rule.rule_type === 'sanctions_restricted' || rule.rule_type === 'import_prohibited' || (rule.rule_type === 'mandatory_certification' && rule.certification_obtainable === false && (!rule.required_certification || !held.has(rule.required_certification.toUpperCase()))));
      const accessBlockers=marketAccessHardBlockers(candidate.marketAccess,held);
      if(accessBlockers.length){ineligible.set(candidate.country_code,accessBlockers.map(e=>({id:e.id,rule_type:e.rule_type,source:'market_access_evidence',source_ref:e.id})) as unknown as typeof rules);continue;}
      if (blockers.length) { ineligible.set(candidate.country_code, blockers); continue; }
      const candidateYear=Math.max(...candidate.totalRows.map(row=>row.year));const denominator=fixedDenominators.get(candidateYear)??{values:[],evidenceIds:[]};
      const result = scoreCandidateByModel({candidate,demandDenominator:{metric:'candidate_market_share',total:denominator.values.reduce((sum,value)=>sum+value,0),values:denominator.values,hs_code:hsCode,year:candidateYear,completeness:'PARTIAL',evidence_ids:[...new Set(denominator.evidenceIds)]},asOfDate,context,policy,weights:weightProfile.weights,legacyNewestYear:newestYearInRun});
      if (result) scored.push(result);
      else missing.push(`${candidate.country_code} had no scoreable criteria and was excluded.`);
    }

    scored.sort((a, b) => b.overall_score - a.overall_score || a.country_code.localeCompare(b.country_code));
    signal?.onProgress?.(75);

    // --- Rationales ------------------------------------------------------------
    const productContext = input.description?.trim() || `HS ${effectiveScope}`;
    const assessments: MarketAssessmentDraft[] = [];
    let modelWriterUsed: string | null = null;
    let anyFellBack = false;

    for (const [index, market] of scored.entries()) {
      const marketCandidate=candidates.find(item=>item.reporter===market.reporter)!;
      const appliedTotal=Object.values(market.weights_applied).reduce((sum,value)=>sum+value,0);
      const decorate=(key:keyof import('@/lib/config').DiscoveryComponentWeights,provenance:unknown)=>{
        const value=provenance as Record<string,unknown>;const tradeRows=[...marketCandidate.totalRows,...marketCandidate.indiaRows,...marketCandidate.supplierRowsLatestYear];
        return {...value,component_weight:weightProfile.weights[key],effective_renormalized_weight:market.weights_applied[key]==null?0:market.weights_applied[key]/appliedTotal,source_origins:[...new Set([...(key==='market_access'&&marketCandidate.marketAccess?.evidence_origin?[marketCandidate.marketAccess.evidence_origin]:[]),...tradeRows.map(row=>row.evidence_origin??'unknown_legacy')])],source_timestamps:[...new Set([...(typeof value.retrieved_at==='string'?[value.retrieved_at]:[]),...tradeRows.map(row=>row.ingested_at.toISOString())])],evidence_ids:Array.isArray(value.evidence_ids)?value.evidence_ids:[...new Set(tradeRows.map(row=>row.acquisition_id).filter((id):id is string=>Boolean(id)))]};
      };
      const evidenceOrigins = [...new Set((() => {
        const candidate = candidates.find((item) => item.reporter === market.reporter);
        return candidate ? [...[...candidate.totalRows, ...candidate.indiaRows, ...candidate.supplierRowsLatestYear].map((row) => row.evidence_origin ?? 'unknown_legacy'),...(candidate.marketAccess?.evidence_origin?[candidate.marketAccess.evidence_origin]:[])] : ['unknown_legacy' as const];
      })())];
      const rationale = await composeRationale(market, productContext, index < policy.rationale_top_n);
      if (index < policy.rationale_top_n) modelWriterUsed = rationale.writer;
      if (rationale.fell_back) anyFellBack = true;

      assessments.push({
        evidence_origins: evidenceOrigins,
        country_code: market.country_code,
        overall_score: market.overall_score,
        demand_score: market.demand.score,
        growth_score: market.growth.score,
        competition_score: market.competition.score,
        market_access_score: market.market_access.score,
        export_economics_score: market.export_economics.score,
        exporter_market_fit_score: market.exporter_market_fit.score,
        logistics_feasibility_score: market.logistics_feasibility.score,
        risk_resilience_score: market.risk_resilience.score,
        confidence_score: market.confidence_score,
        eligibility_status: 'eligible',
        eligibility_reasons: [],
        model_version: policy.model_version,
        weight_profile_key: weightProfileKey,
        weight_profile_version: weightProfile.version,
        as_of_date:asOfDate.toISOString(),
        scoring_policy_version:configured.version,
        scoring_policy_hash:policyHash,
        scoring_policy_snapshot:policy as unknown as Record<string,unknown>,
        reproducibility_status:'reproducible',
        india_share: market.india_share_pct,
        price_band_min: market.price_band?.min ?? null,
        price_band_max: market.price_band?.max ?? null,
        price_band_currency: market.price_band?.currency ?? null,
        tariff_summary: market.market_access.score==null?{status:'unavailable',reason:(market.market_access.provenance as {reason?:string}).reason??'Authoritative tariff coverage unavailable.'}:{status:'available',formula_version:'market-access-v1',evidence_ids:'evidence_ids' in market.market_access.provenance?market.market_access.provenance.evidence_ids:[]},
        certification_requirements: candidates.find(c=>c.reporter===market.reporter)?.marketAccess?.evidence.filter(e=>e.rule_type==='mandatory_certification'&&e.status==='verified').map(e=>({evidence_id:e.id,requirement_code:e.requirement_code}))??[],
        logistics_summary: market.logistics_feasibility.score==null?{status:'unavailable',reason:'reason' in market.logistics_feasibility.provenance?market.logistics_feasibility.provenance.reason:'No current logistics evidence.'}:{status:'available',score:market.logistics_feasibility.score,formula_version:'formula_version' in market.logistics_feasibility.provenance?market.logistics_feasibility.provenance.formula_version:null,confidence_score:'confidence_score' in market.logistics_feasibility.provenance?market.logistics_feasibility.provenance.confidence_score:null,evidence_ids:'evidence_ids' in market.logistics_feasibility.provenance?market.logistics_feasibility.provenance.evidence_ids:[]},
        rationale: rationale.text,
        field_provenance: {
          overall_score: {
            source: 'comtrade',
            basis: `Weighted sum of the criteria below; weights applied: ${JSON.stringify(market.weights_applied)}.`,
            formula_version:policy.model_version,
            input_evidence:{base_weights:weightProfile.weights,effective_weights:Object.fromEntries(Object.entries(market.weights_applied).map(([key,value])=>[key,value/Object.values(market.weights_applied).reduce((sum,item)=>sum+item,0)])),policy_hash:policyHash},
          },
          demand_score: decorate('demand_strength',market.demand.provenance),
          growth_score: decorate('growth_momentum',market.growth.provenance),
          competition_score: decorate('competitive_opportunity',market.competition.provenance),
          india_share: decorate('competitive_opportunity',market.india_share.provenance),
          price_band: decorate('export_economics',market.price_band_provenance),
          market_access: decorate('market_access',market.market_access.provenance),
          export_economics: decorate('export_economics',market.export_economics.provenance),
          exporter_market_fit: decorate('exporter_market_fit',market.exporter_market_fit.provenance),
          logistics_feasibility: decorate('logistics_feasibility',market.logistics_feasibility.provenance),
          risk_resilience: decorate('risk_resilience',market.risk_resilience.provenance),
          confidence_score: { basis: 'Separate evidence-quality score from frozen-date recency, reporting completeness, buyer coverage and component missingness.',formula_version:policy.confidence.formula_version,input_evidence:{as_of_date:asOfDate.toISOString(),latest_data_period:market.latest_year,reporting_lag_years:Math.max(0,asOfDate.getUTCFullYear()-market.latest_year),freshness_policy_version:policy.confidence.freshness_policy_version} },
          tariff_summary: market.market_access.provenance,
          certification_requirements: market.market_access.provenance,
          logistics_summary: market.logistics_feasibility.provenance,
          rationale: {
            source: 'generated',
            writer: rationale.writer,
            note: 'Prose is generated and carries no figures; every number in the rationale is computed from trade data.',
            ...(rationale.fell_back ? { fell_back_from_model: true, reason: rationale.fallback_reason } : {}),
          },
        },
      });
    }
    for (const [countryCode, blockers] of ineligible) assessments.push({ country_code: countryCode, overall_score: null, demand_score: null, growth_score: null, competition_score: null, market_access_score: null, export_economics_score: null, exporter_market_fit_score: null, logistics_feasibility_score: null, risk_resilience_score: null, confidence_score: 0, eligibility_status: 'ineligible', eligibility_reasons: blockers.map(rule => ({ type: rule.rule_type, source: rule.source, source_ref: rule.source_ref })), model_version: policy.model_version, weight_profile_key: weightProfileKey, weight_profile_version: weightProfile.version,as_of_date:asOfDate.toISOString(),scoring_policy_version:configured.version,scoring_policy_hash:policyHash,scoring_policy_snapshot:policy as unknown as Record<string,unknown>,reproducibility_status:'reproducible', tariff_summary: { status: 'unavailable', reason: 'Not evaluated after hard eligibility filter.' }, certification_requirements: [], logistics_summary: { status: 'unavailable', reason: 'Not evaluated after hard eligibility filter.' }, rationale: 'This destination is ineligible under a hard market-entry rule.', field_provenance: { eligibility: { source: 'eligibility_rules', rules: blockers.map(r => r.id) } } });

    signal?.onProgress?.(100);

    return {
      assessments,
      // Partial whenever anything was skipped — an exporter deciding on a shortlist needs
      // to know a country was dropped for lack of data rather than for lack of merit.
      partial: missing.length > 0,
      missing: missing.length ? missing : undefined,
      provenance: {
        engine: this.name,
        source: 'comtrade',
        generated: 'computed',
        hs_scope: effectiveScope,
        data_years: [...new Set(worldRows.map((r) => r.year))].sort(),
        newest_data_year: newestYearInRun,
        candidates_considered: byReporter.size,
        candidates_scored: assessments.length,
        volume_floor_usd: policy.volume_floor_usd,
        scoring_weights: weightProfile.weights,
        model_version: policy.model_version,
        config_version: configured.version,
        scoring_policy_hash:policyHash,
        scoring_policy_snapshot:policy as unknown as Record<string,unknown>,
        as_of_date:asOfDate.toISOString(),
        weight_profile_key: weightProfileKey,
        weight_profile_version: weightProfile.version,
        exporter_market_fit_input_confidence: exporterFitInputConfidence,
        exporter_market_fit_missing_inputs: missingExporterFitInputs,
        rationale_writer: modelWriterUsed ?? 'template-v1',
        ...(anyFellBack ? { rationale_fallback_used: true } : {}),
        note: 'Scores are computed only from eligible server-side evidence. Unsupported or unavailable component evidence remains unavailable and its weight redistributes.',
      },
    };
  }
}
