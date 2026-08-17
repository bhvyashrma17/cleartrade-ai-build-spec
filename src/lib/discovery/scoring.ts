/** Deterministic eight-component market scoring. No IO, models, clocks, or defaults. */
import type {
  DiscoveryComponentWeights,
  DiscoveryScoringPolicy,
} from "@/lib/config";

export interface ScoringRow {
  id?: string;
  acquisition_id?: string | null;
  ingest_run_id?: string | null;
  reporter: string;
  partner: string;
  hs_code: string;
  year: number;
  value: number;
  quantity: number | null;
  unit?: string | null;
  unit_value: number | null;
  ingested_at: Date;
  evidence_origin?:
    | "unknown_legacy"
    | "fixture"
    | "mock"
    | "preview"
    | "authenticated_real"
    | "public_real"
    | "imported_real"
    | "manually_entered_real";
}
export interface Unavailable {
  status: "unavailable";
  reason: string;
  formula_version?: string;
  confidence_score?: number;
  input_evidence?: Record<string, unknown>;
  currencies?: string[];
  fx?: Record<string, unknown>;
  quantity_basis?: Record<string, unknown>;
  incoterm_basis?: Record<string, unknown>;
  unavailable_reasons?: string[];
}
export interface FieldProvenance {
  source: "comtrade" | "product" | "official_market_access" | "risk_signal" | "combined";
  retrieved_at?: string;
  basis: string;
  row_count: number;
  evidence_ids?: string[];
  formula_version?: string;
  confidence_score?: number;
  input_evidence?: Record<string, unknown>;
  currencies?: string[];
  fx?: Record<string, unknown>;
  quantity_basis?: Record<string, unknown>;
  incoterm_basis?: Record<string, unknown>;
  unavailable_reasons?: string[];
}
export type Provenance = FieldProvenance | Unavailable;
export interface Subscore {
  score: number | null;
  provenance: Provenance;
}
export interface MarketAccessEvidenceInput {
  id: string;
  rule_type:
    | "destination_tariff"
    | "preferential_tariff_india"
    | "import_prohibition"
    | "import_restriction"
    | "mandatory_certification"
    | "material_non_tariff_requirement";
  status:
    "verified" | "not_applicable" | "needs_review" | "superseded" | "stale";
  confidence: number;
  tariff_rate_percent: number | null;
  requirement_code?: string | null;
  requirement_obtainable?: boolean | null;
  retrieved_at: Date;
  effective_at?: Date | null;
  expires_at?: Date | null;
  evidence_origin?: ScoringRow['evidence_origin'];
}
export interface MarketAccessInput {
  snapshot_id: string;
  completeness: "COMPLETE" | "PARTIAL" | "FAILED" | "STALE";
  tariff_coverage: boolean;
  regulatory_coverage: boolean;
  evidence: MarketAccessEvidenceInput[];
  evidence_origin?: ScoringRow['evidence_origin'];
  provider?: string;
  source_dataset?: string | null;
  source_run_id?: string | null;
  raw_response_checksum?: string | null;
  policy?: typeof DEFAULT_MARKET_ACCESS_POLICY;
}
export interface CandidateInput {
  reporter: string;
  country_code: string;
  totalRows: ScoringRow[];
  indiaRows: ScoringRow[];
  supplierRowsLatestYear: ScoringRow[];
  supplierCoverage?: SupplierCoverageInput | null;
  marketAccess?: MarketAccessInput | null;
  logisticsRoutes?: LogisticsRouteEvidenceInput[];
  riskSignals?:MarketRiskSignalInput[];
  fitBenchmarks?:ExporterMarketFitBenchmarkInput[];
}
export interface SupplierCoverageInput {
  assertion_id?:string;
  world_total_value:number;
  supplier_value_sum:number;
  partner_count:number;
  coverage_ratio:number|null;
  completeness:'COMPLETE'|'PARTIAL'|'FAILED'|'STALE';
  query_scope:Record<string,unknown>;
  acquisition_ids:string[];
  threshold_version:string;
}
export interface DemandDenominatorInput {
  metric:'candidate_market_share'|'global_import_share';
  total:number;
  values:number[];
  hs_code:string;
  year:number;
  completeness:'COMPLETE'|'PARTIAL'|'FAILED'|'STALE';
  evidence_ids:string[];
}
export interface ExporterMarketFitBenchmarkInput {
  id:string;
  benchmark_type:'order_value'|'order_quantity'|'production_lead_time'|'customization_required'|'packaging_required';
  minimum_value?:number|null;
  maximum_value?:number|null;
  unit?:string|null;
  currency?:string|null;
  required?:boolean|null;
  requirement_code?:string|null;
  provider:string;
  source_reference:string;
  source_version:string;
  observed_at:Date;
  retrieved_at:Date;
  valid_until?:Date|null;
  confidence:number;
  status:'verified'|'needs_review'|'superseded';
}
export interface MarketRiskSignalInput {
  id:string;
  dimension:'macro_volatility'|'payment_country_risk'|'supplier_dependency'|'route_fragility';
  metric:string;
  value:number;
  unit:string;
  observation_date:Date;
  period_start?:Date|null;
  period_end?:Date|null;
  retrieved_at:Date;
  valid_until?:Date|null;
  provider:string;
  source_reference:string;
  source_version:string;
  normalization_method:string;
  confidence:number;
  status:'verified'|'needs_review'|'superseded';
}
export interface LogisticsRouteEvidenceInput {
  id:string;
  origin_country:string;
  origin_state?:string|null;
  origin_city?:string|null;
  origin_location_code?:string|null;
  origin_gateway?:string|null;
  destination_country:string;
  destination_port?:string|null;
  transport_mode:'ocean'|'rail'|'road'|'air'|'multimodal';
  route_available:boolean;
  transit_time_min_days?:number|null;
  transit_time_max_days?:number|null;
  freight_amount?:number|null;
  freight_currency?:string|null;
  freight_rate_basis?:string|null;
  freight_retrieved_at?:Date|null;
  freight_valid_until?:Date|null;
  assumed_shipment_value_amount?:number|null;
  assumed_shipment_value_currency?:string|null;
  provider:string;
  source_reference:string;
  retrieved_at:Date;
  valid_until?:Date|null;
  equipment_assumption?:string|null;
  supported_product_constraint_codes:string[];
  confidence:number;
  status:'verified'|'needs_review'|'superseded';
}
export interface ExporterContext {
  price_target?: number | null;
  price_target_currency?: string | null;
  price_target_quantity_unit?: string | null;
  price_target_incoterm?: string | null;
  capacity?: number | null;
  capacity_unit?:string|null;
  lead_time_days?: number | null;
  delivery_commitment_days?:number|null;
  origin_country?:string|null;
  origin_state?:string|null;
  origin_city?:string|null;
  origin_location_code?:string|null;
  origin_gateway?:string|null;
  logistics_constraint_codes?:string[];
  logistics_constraints_confirmed?:boolean;
  desired_order_size_amount?: number | null;
  desired_order_size_currency?: string | null;
  customization_capability?: string | null;
  packaging_capability?: string | null;
  moq_value?: number | null;
  moq_unit?: string | null;
  certifications?: {
    code: string;
    name: string;
    status: string;
    evidence_ref: string | null;
    valid_until?:string|null;
  }[];
}
export interface ScoredMarket {
  reporter: string;
  country_code: string;
  overall_score: number;
  demand: Subscore;
  growth: Subscore;
  competition: Subscore;
  market_access: Subscore;
  export_economics: Subscore;
  exporter_market_fit: Subscore;
  logistics_feasibility: Subscore;
  risk_resilience: Subscore;
  confidence_score: number;
  india_share_pct: number | null;
  latest_total_value: number;
  latest_year: number;
  weights_applied: Record<string, number>;
  india_share: Subscore;
  price_band: { min: number; max: number; currency: "USD" } | null;
  price_band_provenance: Provenance;
}
const clamp = (n: number) => Math.max(1, Math.min(99, Math.round(n)));
const unavailable = (reason: string): Subscore => ({
  score: null,
  provenance: { status: "unavailable", reason },
});
const newest = (rows: ScoringRow[]) =>
  new Date(Math.max(...rows.map((r) => r.ingested_at.getTime()))).toISOString();
const totals = (rows: ScoringRow[]) => {
  const m = new Map<number, number>();
  for (const r of rows) m.set(r.year, (m.get(r.year) ?? 0) + r.value);
  return m;
};
const combine = (parts: Subscore[], weights: number[]) => {
  let n = 0,
    d = 0;
  parts.forEach((p, i) => {
    if (p.score != null) {
      n += p.score * weights[i];
      d += weights[i];
    }
  });
  return d ? clamp(n / d) : null;
};
export const MARKET_ACCESS_FORMULA_VERSION = "market-access-v1";
export const DEFAULT_MARKET_ACCESS_POLICY = {
  formula_version: MARKET_ACCESS_FORMULA_VERSION,
  tariff_weight: 70,
  regulatory_weight: 30,
  tariff_ceiling_percent: 25,
  certification_penalty: 20,
  restriction_penalty: 15,
  non_tariff_penalty: 10,
  max_snapshot_age_days: 7,
};
export const marketAccessScopeMatches = (evidenceScope: string, hs6: string) =>
  evidenceScope === hs6 ||
  evidenceScope.startsWith(hs6) ||
  hs6.startsWith(evidenceScope);

export function scoreMarketAccess(
  input: MarketAccessInput | null | undefined,
  now = new Date(),
  policy = DEFAULT_MARKET_ACCESS_POLICY,
): Subscore {
  policy = input?.policy ?? policy;
  if (!input)
    return unavailable(
      "No authoritative market-access snapshot supports this jurisdiction and HS scope.",
    );
  if (
    input.completeness !== "COMPLETE" ||
    !input.tariff_coverage ||
    !input.regulatory_coverage
  )
    return unavailable(
      `Market-access evidence coverage is ${input.completeness.toLowerCase()} or incomplete.`,
    );
  const current = input.evidence.filter(
    (e) =>
      e.status !== "superseded" &&
      e.status !== "stale" &&
      (!e.effective_at || e.effective_at <= now) &&
      (!e.expires_at || e.expires_at > now),
  );
  if (current.some((e) => e.status === "needs_review" || e.confidence < 0.8))
    return unavailable(
      "Official evidence contains a low-confidence or needs-review item.",
    );
  const ordinary = current.find(
    (e) =>
      e.rule_type === "destination_tariff" &&
      e.status === "verified" &&
      e.tariff_rate_percent != null,
  );
  const preference = current.find(
    (e) =>
      e.rule_type === "preferential_tariff_india" &&
      (e.status === "verified" || e.status === "not_applicable"),
  );
  if (!ordinary || !preference)
    return unavailable(
      "Ordinary tariff or India-preference applicability is not verified.",
    );
  const rate =
    preference.status === "verified" && preference.tariff_rate_percent != null
      ? preference.tariff_rate_percent
      : ordinary.tariff_rate_percent!;
  const tariffScore = clamp(
    100 -
      Math.min(Math.max(rate, 0), policy.tariff_ceiling_percent) *
        (100 / policy.tariff_ceiling_percent),
  );
  const restrictions = current.filter(
    (e) => e.rule_type === "import_restriction" && e.status === "verified",
  ).length;
  const certifications = current.filter(
    (e) => e.rule_type === "mandatory_certification" && e.status === "verified",
  ).length;
  const ntms = current.filter(
    (e) =>
      e.rule_type === "material_non_tariff_requirement" &&
      e.status === "verified",
  ).length;
  const regulatoryScore = clamp(
    100 -
      Math.min(60, certifications * policy.certification_penalty) -
      Math.min(30, restrictions * policy.restriction_penalty) -
      Math.min(30, ntms * policy.non_tariff_penalty),
  );
  const score = combine(
    [
      {
        score: tariffScore,
        provenance: {
          source: "official_market_access",
          basis: "Applicable verified tariff burden.",
          row_count: 2,
        },
      },
      {
        score: regulatoryScore,
        provenance: {
          source: "official_market_access",
          basis:
            "Verified certification, restriction and material non-tariff burden.",
          row_count: restrictions + certifications + ntms,
        },
      },
    ],
    [policy.tariff_weight, policy.regulatory_weight],
  );
  return {
    score,
    provenance: {
      source: "official_market_access",
      retrieved_at: new Date(
        Math.max(...current.map((e) => e.retrieved_at.getTime())),
      ).toISOString(),
      basis: `${policy.formula_version}: configured applicable-tariff and verified-regulatory burden.`,
      row_count: current.length,
      evidence_ids: current.map((e) => e.id),
      formula_version: policy.formula_version,
      input_evidence:{snapshot_id:input.snapshot_id,evidence_origin:input.evidence_origin??'unknown_legacy',provider:input.provider??null,source_dataset:input.source_dataset??null,source_run_id:input.source_run_id??null,raw_response_checksum:input.raw_response_checksum??null,completeness:input.completeness},
    },
  };
}
export function marketAccessHardBlockers(
  input: MarketAccessInput | null | undefined,
  heldCertifications = new Set<string>(),
) {
  return (input?.evidence ?? []).filter(
    (e) =>
      e.status === "verified" &&
      (e.rule_type === "import_prohibition" ||
        (e.rule_type === "mandatory_certification" &&
          e.requirement_obtainable === false &&
          (!e.requirement_code ||
            !heldCertifications.has(e.requirement_code.toUpperCase())))),
  );
}

export function scoreIndiaShare(
  rows: ScoringRow[],
  marketTotal: number,
  year: number,
): Subscore & { share_pct: number | null } {
  const latest = rows.filter((r) => r.year === year);
  if (!latest.length)
    return {
      ...unavailable(
        "No India-origin row for the latest year; absence is not treated as zero.",
      ),
      share_pct: null,
    };
  if (marketTotal <= 0)
    return {
      ...unavailable(
        "Market import total is zero, so India share is undefined.",
      ),
      share_pct: null,
    };
  const value = latest.reduce((s, r) => s + r.value, 0),
    share = (value / marketTotal) * 100;
  return {
    score: clamp(Math.min(share / 15, 1) * 100),
    share_pct: share,
    provenance: {
      source: "comtrade",
      retrieved_at: newest(latest),
      basis: `India-origin value divided by total market imports for ${year}.`,
      row_count: latest.length,
    },
  };
}
export function scoreCompetition(
  rows: ScoringRow[],
  coverage?: SupplierCoverageInput | null,
): Subscore & { hhi: number | null } {
  if (!coverage || coverage.completeness !== 'COMPLETE')
    return {
      score:null,
      provenance:{status:'unavailable',reason:'Supplier HHI requires a complete coverage assertion.',
        formula_version:'competitive-opportunity-v3',
        input_evidence:{supplier_coverage:coverage??null},
      },
      hhi:null,
    };
  if (!rows.length)
    return {
      ...unavailable("No supplier-country rows; concentration is unavailable."),
      hhi: null,
    };
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.partner, (by.get(r.partner) ?? 0) + r.value);
  const total = [...by.values()].reduce((a, b) => a + b, 0);
  if (total <= 0)
    return {
      ...unavailable("Supplier rows have no positive value."),
      hhi: null,
    };
  const hhi = [...by.values()].reduce((s, v) => s + (v / total) ** 2, 0);
  return {
    score: clamp((1 - hhi) * 100),
    hhi,
    provenance: {
      source: "comtrade",
      retrieved_at: newest(rows),
      basis: "One minus supplier-share HHI; high means fragmented.",
      row_count: rows.length,
      evidence_ids:coverage.acquisition_ids,
      formula_version:'competitive-opportunity-v3',
      input_evidence:{supplier_coverage:coverage},
    },
  };
}

function demandStrength(
  latest: number,
  denominator: DemandDenominatorInput,
  rows: ScoringRow[],
  policy:DiscoveryScoringPolicy['demand'],
): Subscore {
  if (!rows.length || latest <= 0)
    return unavailable("No latest-year import value.");
  const all=denominator.values;
  const logs = all.filter((v) => v > 0).map(Math.log10),
    lo = Math.min(...logs),
    hi = Math.max(...logs);
  const valueScore = clamp(
    5 + (hi === lo ? 1 : (Math.log10(latest) - lo) / (hi - lo)) * 94,
  );
  const denominatorTotal = denominator.total;
  const shares = all.map((v) => (denominatorTotal > 0 ? v / denominatorTotal : 0)),
    share = denominatorTotal > 0 ? latest / denominatorTotal : 0,
    max = Math.max(...shares);
  const shareScore = max > 0 ? clamp((share / max) * 99) : null;
  const score = combine(
    [
      {
        score: valueScore,
        provenance: {
          source: "comtrade",
          retrieved_at: newest(rows),
          basis: "Log-normalized latest import value.",
          row_count: rows.length,
        },
      },
      denominator.metric==='global_import_share'&&denominator.completeness!=='COMPLETE'
        ? unavailable('Global import share requires a complete authoritative denominator.')
        : shareScore == null
        ? unavailable(`${denominator.metric} is undefined.`)
        : {
            score: shareScore,
            provenance: {
              source: "comtrade",
              retrieved_at: newest(rows),
              basis: denominator.metric === 'global_import_share'
                ? 'Verified global import share.'
                : 'Candidate-market share across the fixed unfiltered warehouse reporter scope; not global import share.',
              row_count: rows.length,
              evidence_ids:denominator.evidence_ids,
              formula_version:policy.formula_version,
              input_evidence:{metric:denominator.metric,numerator:latest,denominator:denominatorTotal,year:denominator.year,hs_code:denominator.hs_code,completeness:denominator.completeness},
            },
          },
      unavailable("Buyer depth awaits the buyer-data source."),
    ],
    [policy.value_weight, policy.share_weight, policy.buyer_depth_weight],
  );
  return {
    score,
    provenance: {
      source: "comtrade",
      retrieved_at: newest(rows),
      basis:
        `Demand strength: import value and ${denominator.metric}; buyer depth unavailable and subweights renormalized.`,
      row_count: rows.length,
      formula_version:policy.formula_version,
      evidence_ids:[...new Set([...rows.map(row=>row.acquisition_id).filter((id):id is string=>Boolean(id)),...denominator.evidence_ids])],
      input_evidence:{share_metric:denominator.metric,share_numerator:latest,share_denominator:denominatorTotal,year:denominator.year,hs_code:denominator.hs_code,denominator_completeness:denominator.completeness},
    },
  };
}
function growthMomentum(
  rows: ScoringRow[],
  policy: DiscoveryScoringPolicy,
): Subscore {
  const series = totals(rows),
    years = [...series.keys()].sort((a, b) => a - b);
  if (years.length < 2) return unavailable("Growth needs at least two years.");
  const endY = years.at(-1)!,
    window = Math.max(1, Math.floor(policy.growth_window_years)),
    startY = years.find((y) => y >= endY - window) ?? years[0],
    windowYears = years.filter((y) => y >= startY),
    span = endY - startY,
    start = series.get(startY)!,
    end = series.get(endY)!;
  const cagr = span > 0 && start > 0 ? (end / start) ** (1 / span) - 1 : null;
  const cagrScore = cagr == null ? null : clamp(((cagr + 0.2) / 0.5) * 100);
  const changes: number[] = [];
  for (let i = 1; i < windowYears.length; i++) {
    const a = series.get(windowYears[i - 1])!,
      b = series.get(windowYears[i])!;
    if (a > 0) changes.push(b / a - 1);
  }
  let momentum: number | null = null;
  if (changes.length) {
    let n = 0,
      d = 0;
    changes.forEach((v, i) => {
      const w = i + 1;
      n += v * w;
      d += w;
    });
    momentum = clamp(((n / d + 0.2) / 0.5) * 100);
  }
  const score = combine(
    [
      cagrScore == null
        ? unavailable("Configured-window CAGR unavailable.")
        : {
            score: cagrScore,
            provenance: {
              source: "comtrade",
              retrieved_at: newest(rows),
              basis: `CAGR over the configured ${window}-year window.`,
              row_count: windowYears.length,
            },
          },
      momentum == null
        ? unavailable("Momentum unavailable.")
        : {
            score: momentum,
            provenance: {
              source: "comtrade",
              retrieved_at: newest(rows),
              basis: `Recency-weighted annual changes within the configured ${window}-year window.`,
              row_count: windowYears.length,
            },
          },
    ],
    [70, 30],
  );
  return {
    score,
    provenance: {
      source: "comtrade",
      retrieved_at: newest(rows),
      basis: `Growth combines CAGR and recency-weighted momentum over the configured ${window}-year window.`,
      row_count: windowYears.length,
    },
  };
}
export const EXPORTER_MARKET_FIT_FORMULA_VERSION='exporter-market-fit-v1';
const rangeFit=(value:number,min:number|null,max:number|null)=>{
  if(min!=null&&value<min)return clamp(value/min*100);
  if(max!=null&&value>max)return clamp(max/value*100);
  return 99;
};
export function scoreExporterMarketFit(candidate:CandidateInput,context:ExporterContext,policy:DiscoveryScoringPolicy['exporter_market_fit'],now=new Date()):Subscore{
  const cutoff=new Date(now.getTime()-policy.max_benchmark_age_days*86_400_000);
  const benchmarks=(candidate.fitBenchmarks??[]).filter(benchmark=>benchmark.status==='verified'&&benchmark.confidence>=.8&&benchmark.retrieved_at>=cutoff&&(!benchmark.valid_until||benchmark.valid_until>now));
  const latest=(type:ExporterMarketFitBenchmarkInput['benchmark_type'])=>benchmarks.filter(benchmark=>benchmark.benchmark_type===type).sort((a,b)=>b.observed_at.getTime()-a.observed_at.getTime())[0];
  const parts:Subscore[]=[];const weights:number[]=[];const missing:string[]=[];const evidenceIds:string[]=[];let qualityNumerator=0,availableWeight=0;
  const add=(score:number,weight:number,benchmark:ExporterMarketFitBenchmarkInput,basis:string,productConfidence=1)=>{parts.push({score,provenance:{source:'combined',retrieved_at:benchmark.retrieved_at.toISOString(),basis,row_count:1,evidence_ids:[benchmark.id]}});weights.push(weight);availableWeight+=weight;qualityNumerator+=weight*benchmark.confidence*productConfidence;evidenceIds.push(benchmark.id);};

  const orderValue=latest('order_value');
  if(orderValue&&context.desired_order_size_amount!=null&&context.desired_order_size_amount>0&&context.desired_order_size_currency&&orderValue.currency?.toUpperCase()===context.desired_order_size_currency.toUpperCase())add(rangeFit(context.desired_order_size_amount,orderValue.minimum_value??null,orderValue.maximum_value??null),policy.order_size_weight,orderValue,'Exporter desired order value compared with a sourced destination order-value range.');
  else missing.push('Order-size fit needs a same-currency destination order-value benchmark and exporter desired order value.');

  const orderQuantity=latest('order_quantity'),benchmarkUnit=canonicalQuantityUnit(orderQuantity?.unit),capacityUnit=canonicalQuantityUnit(context.capacity_unit),moqUnit=canonicalQuantityUnit(context.moq_unit);
  if(orderQuantity&&benchmarkUnit&&capacityUnit===benchmarkUnit&&moqUnit===benchmarkUnit&&context.capacity!=null&&context.capacity>0&&context.moq_value!=null&&context.moq_value>0){
    const capacityScore=orderQuantity.minimum_value!=null?clamp(context.capacity/orderQuantity.minimum_value*100):99;
    const moqScore=orderQuantity.maximum_value!=null?clamp(orderQuantity.maximum_value/context.moq_value*100):99;
    add(combine([{score:capacityScore,provenance:{source:'product',basis:'Capacity against sourced minimum typical order quantity.',row_count:1}},{score:moqScore,provenance:{source:'product',basis:'MOQ against sourced maximum typical order quantity.',row_count:1}}],[50,50])!,policy.capacity_moq_weight,orderQuantity,'Capacity and MOQ compared with a source-backed destination order-quantity range; no unit conversion applied.');
  }else missing.push('Capacity/MOQ fit needs compatible Product units and a destination order-quantity benchmark.');

  const requirements=(candidate.marketAccess?.evidence??[]).filter(e=>e.rule_type==='mandatory_certification'&&e.status==='verified'&&e.requirement_code);
  if(requirements.length){
    const certificationScores=requirements.map(requirement=>{const certification=(context.certifications??[]).find(item=>item.code.toUpperCase()===requirement.requirement_code!.toUpperCase());if(!certification)return 1;const expired=certification.status==='expired'||(certification.valid_until!=null&&new Date(certification.valid_until)<=now);if(expired)return 10;if(certification.status==='held')return certification.evidence_ref?99:85;if(certification.status==='in_progress')return 50;return 1;});
    const score=Math.round(certificationScores.reduce((sum,value)=>sum+value,0)/certificationScores.length);
    const requirementIds=requirements.map(requirement=>requirement.id),requirementConfidence=Math.min(...requirements.map(requirement=>requirement.confidence)),productConfidence=(context.certifications??[]).some(certification=>certification.evidence_ref)?1:.8;
    parts.push({score,provenance:{source:'combined',retrieved_at:new Date(Math.max(...requirements.map(requirement=>requirement.retrieved_at.getTime()))).toISOString(),basis:'Exporter certification states matched to current mandatory Market Access requirements.',row_count:requirements.length,evidence_ids:requirementIds}});weights.push(policy.certification_weight);availableWeight+=policy.certification_weight;qualityNumerator+=policy.certification_weight*requirementConfidence*productConfidence;evidenceIds.push(...requirementIds);
  }else missing.push('Certification fit needs a current destination mandatory-certification requirement.');

  const leadTime=latest('production_lead_time');
  if(leadTime&&context.lead_time_days!=null&&context.lead_time_days>0&&leadTime.maximum_value!=null&&leadTime.maximum_value>0)add(context.lead_time_days<=leadTime.maximum_value?99:clamp(leadTime.maximum_value/context.lead_time_days*100),policy.lead_time_weight,leadTime,'Production lead time compared with a sourced destination maximum; transit time is excluded.');
  else missing.push('Lead-time fit needs a destination production lead-time benchmark and exporter production lead time.');

  const customization=latest('customization_required');
  if(customization?.required===true)add(context.customization_capability?.trim()?85:1,policy.customization_weight,customization,'Destination evidence makes customization relevant; score reflects the exporter self-reported capability.',.7);else missing.push('Customization is not evidenced as relevant for this destination/product.');
  const packaging=latest('packaging_required');
  if(packaging?.required===true)add(context.packaging_capability?.trim()?85:1,policy.packaging_weight,packaging,'Destination evidence makes packaging readiness relevant; score reflects the exporter self-reported capability.',.7);else missing.push('Packaging/compliance readiness is not evidenced as relevant for this destination/product.');

  const score=combine(parts,weights);
  if(score==null)return {score:null,provenance:{status:'unavailable',reason:'No exporter-market fit subfactor has both Product and market evidence.',formula_version:policy.formula_version,confidence_score:0,unavailable_reasons:missing}};
  const totalWeight=policy.order_size_weight+policy.capacity_moq_weight+policy.certification_weight+policy.lead_time_weight+policy.customization_weight+policy.packaging_weight;
  const confidenceScore=Math.round(availableWeight/totalWeight*(qualityNumerator/availableWeight)*100);
  return {score,provenance:{source:'combined',retrieved_at:new Date(Math.max(...benchmarks.map(benchmark=>benchmark.retrieved_at.getTime()),...(candidate.marketAccess?.evidence??[]).map(evidence=>evidence.retrieved_at.getTime()))).toISOString(),basis:'Contextual exporter × product × market fit. Only subfactors with both Product capability and current destination evidence contribute; available weights renormalize.',row_count:evidenceIds.length,evidence_ids:[...new Set(evidenceIds)],formula_version:policy.formula_version,confidence_score:confidenceScore,input_evidence:{country_code:candidate.country_code,product:{desired_order_size_amount:context.desired_order_size_amount??null,desired_order_size_currency:context.desired_order_size_currency??null,capacity:context.capacity??null,capacity_unit:context.capacity_unit??null,moq_value:context.moq_value??null,moq_unit:context.moq_unit??null,lead_time_days:context.lead_time_days??null,customization_capability_present:Boolean(context.customization_capability?.trim()),packaging_capability_present:Boolean(context.packaging_capability?.trim()),certifications:(context.certifications??[]).map(certification=>({code:certification.code,status:certification.status,evidence_present:Boolean(certification.evidence_ref),valid_until:certification.valid_until??null}))},benchmark_ids:[...new Set(evidenceIds)]},unavailable_reasons:missing}};
}

export const EXPORT_ECONOMICS_FORMULA_VERSION = "export-economics-v1";
const PACKAGE_UNITS = new Set([
  "package",
  "packages",
  "pkg",
  "pkgs",
  "ctn",
  "carton",
  "cartons",
  "box",
  "boxes",
  "case",
  "cases",
]);
const UNIT_ALIASES: Record<string, string> = {
  kg: "kg",
  kgs: "kg",
  kilogram: "kg",
  kilograms: "kg",
  kgm: "kg",
  no: "No",
  nos: "No",
  number: "No",
  numbers: "No",
  nmb: "No",
  l: "l",
  lt: "l",
  ltr: "l",
  litre: "l",
  litres: "l",
  liter: "l",
  liters: "l",
  m2: "m2",
  "m²": "m2",
  sqm: "m2",
};
export function canonicalQuantityUnit(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/\.$/, "");
  if (!normalized || PACKAGE_UNITS.has(normalized)) return null;
  return UNIT_ALIASES[normalized] ?? null;
}
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b),
    mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const pricePlausibility = (offer: number, benchmark: number) =>
  clamp(100 * Math.exp(-Math.abs(Math.log(offer / benchmark))));
function applicableTariff(
  input: MarketAccessInput | null | undefined,
  now: Date,
) {
  if (!input || input.completeness !== "COMPLETE" || !input.tariff_coverage)
    return null;
  const current = input.evidence.filter(
    (e) =>
      e.status !== "superseded" &&
      e.status !== "stale" &&
      (!e.effective_at || e.effective_at <= now) &&
      (!e.expires_at || e.expires_at > now),
  );
  if (current.some((e) => e.status === "needs_review" || e.confidence < 0.8))
    return null;
  const ordinary = current.find(
    (e) =>
      e.rule_type === "destination_tariff" &&
      e.status === "verified" &&
      e.tariff_rate_percent != null,
  );
  const preference = current.find(
    (e) =>
      e.rule_type === "preferential_tariff_india" &&
      (e.status === "verified" || e.status === "not_applicable"),
  );
  if (!ordinary || !preference) return null;
  const rate =
    preference.status === "verified" && preference.tariff_rate_percent != null
      ? preference.tariff_rate_percent
      : ordinary.tariff_rate_percent!;
  return { rate, evidence: [ordinary, preference] };
}
export function scoreExportEconomics(
  candidate: CandidateInput,
  context: ExporterContext,
  policy: DiscoveryScoringPolicy["export_economics"],
  now = new Date(),
): Subscore {
  const reasons: string[] = [];
  const offer = context.price_target;
  if (offer == null || !Number.isFinite(offer) || offer <= 0)
    reasons.push("Exporter target price is missing or invalid.");
  const currency = context.price_target_currency?.trim().toUpperCase() ?? null;
  if (!currency) reasons.push("Exporter price currency is missing.");
  else if (currency !== "USD")
    reasons.push(
      `No sourced FX observation converts ${currency} to Comtrade USD values.`,
    );
  const offerUnit = canonicalQuantityUnit(context.price_target_quantity_unit);
  if (!offerUnit)
    reasons.push(
      "Exporter price quantity unit is missing, unknown, or a package-count unit.",
    );
  const incoterm = context.price_target_incoterm?.trim().toUpperCase() ?? null;
  if (!incoterm) reasons.push("Exporter price Incoterm is missing.");
  else if (incoterm !== "CIF")
    reasons.push(
      `Exporter ${incoterm} price cannot be compared with CIF-type import statistical values without sourced cost normalization.`,
    );
  const latestYear = Math.max(...candidate.totalRows.map((r) => r.year));
  const valid = (row: ScoringRow) =>
    row.year === latestYear &&
    row.quantity != null &&
    Number.isFinite(row.quantity) &&
    row.quantity > 0 &&
    row.unit_value != null &&
    Number.isFinite(row.unit_value) &&
    row.unit_value > 0 &&
    canonicalQuantityUnit(row.unit) === offerUnit;
  const marketValues = offerUnit
    ? candidate.totalRows.filter(valid).map((r) => r.unit_value!)
    : [];
  const indiaValues = offerUnit
    ? candidate.indiaRows.filter(valid).map((r) => r.unit_value!)
    : [];
  if (marketValues.length < policy.minimum_price_observations)
    reasons.push(
      "No sufficient latest-year destination unit values share the exporter quantity unit.",
    );
  if (indiaValues.length < policy.minimum_price_observations)
    reasons.push(
      "No sufficient latest-year India-origin unit values share the exporter quantity unit.",
    );
  const tariff = applicableTariff(candidate.marketAccess, now);
  if (!tariff)
    reasons.push(
      "A current verified destination tariff applicable to Indian origin is unavailable.",
    );
  if (reasons.length)
    return {
      score: null,
      provenance: {
        status: "unavailable",
        reason: reasons.join(" "),
        formula_version: policy.formula_version,
        confidence_score: 0,
        input_evidence: { exporter_price: offer ?? null, latest_year: latestYear },
        currencies: currency ? [currency] : [],
        fx: {
          required: currency != null && currency !== "USD",
          source: null,
          observed_at: null,
        },
        quantity_basis: {
          exporter: offerUnit,
          conversion_applied: false,
          package_units_rejected: true,
        },
        incoterm_basis: {
          exporter: incoterm,
          trade_import_values: "CIF-type",
          normalization_applied: false,
        },
        unavailable_reasons: reasons,
      },
    };
  const marketMedian = median(marketValues),
    indiaMedian = median(indiaValues);
  const marketScore = pricePlausibility(offer!, marketMedian),
    indiaScore = pricePlausibility(offer!, indiaMedian);
  const tariffScore = clamp(
    100 -
      Math.min(Math.max(tariff!.rate, 0), policy.tariff_ceiling_percent) *
        (100 / policy.tariff_ceiling_percent),
  );
  const score = combine(
    [
      {
        score: indiaScore,
        provenance: {
          source: "comtrade",
          basis:
            "Exporter CIF unit price versus latest India-origin import unit-value median.",
          row_count: indiaValues.length,
        },
      },
      {
        score: marketScore,
        provenance: {
          source: "comtrade",
          basis:
            "Exporter CIF unit price versus latest destination import unit-value median.",
          row_count: marketValues.length,
        },
      },
      {
        score: tariffScore,
        provenance: {
          source: "official_market_access",
          basis: "Verified tariff applicable to Indian origin.",
          row_count: tariff!.evidence.length,
        },
      },
    ],
    [
      policy.india_price_weight,
      policy.market_price_weight,
      policy.tariff_weight,
    ],
  );
  const confidence = Math.round(
    Math.min(1, indiaValues.length / 5) * 35 +
      Math.min(1, marketValues.length / 5) * 35 +
      (tariff!.evidence.reduce((s, e) => s + e.confidence, 0) /
        tariff!.evidence.length) *
        30,
  );
  return {
    score,
    provenance: {
      source: "combined",
      retrieved_at: newest([
        ...candidate.totalRows.filter(valid),
        ...candidate.indiaRows.filter(valid),
      ]),
      basis:
        "Commercial plausibility from basis-compatible exporter price, observed imports, and verified tariff; no freight, FX, or margin was inferred.",
      row_count:
        marketValues.length + indiaValues.length + tariff!.evidence.length,
      evidence_ids: tariff!.evidence.map((e) => e.id),
      formula_version: policy.formula_version,
      confidence_score: confidence,
      input_evidence: {
        exporter_price: offer,
        india_origin_unit_value_median: indiaMedian,
        destination_unit_value_median: marketMedian,
        applicable_tariff_percent: tariff!.rate,
        latest_year: latestYear,
      },
      currencies: ["USD"],
      fx: { required: false, source: null, observed_at: null },
      quantity_basis: {
        exporter: offerUnit,
        india_origin: offerUnit,
        destination: offerUnit,
        conversion_applied: false,
        package_units_rejected: true,
      },
      incoterm_basis: {
        exporter: "CIF",
        trade_import_values: "CIF-type",
        normalization_applied: false,
      },
      unavailable_reasons: [],
    },
  };
}
export const LOGISTICS_FORMULA_VERSION='logistics-feasibility-v1';
const locationMatches=(route:LogisticsRouteEvidenceInput,context:ExporterContext)=>{
  if(!context.origin_country||route.origin_country.toUpperCase()!==context.origin_country.toUpperCase())return false;
  if(context.origin_gateway&&route.origin_gateway?.toLowerCase()!==context.origin_gateway.toLowerCase())return false;
  if(route.origin_location_code)return Boolean(context.origin_location_code&&route.origin_location_code.toUpperCase()===context.origin_location_code.toUpperCase());
  if(route.origin_city)return Boolean(context.origin_city&&route.origin_city.toLowerCase()===context.origin_city.toLowerCase());
  if(route.origin_state)return Boolean(context.origin_state&&route.origin_state.toLowerCase()===context.origin_state.toLowerCase());
  return true;
};
export function scoreLogisticsFeasibility(candidate:CandidateInput,context:ExporterContext,policy:DiscoveryScoringPolicy['logistics'],now=new Date()):Subscore{
  if(!context.origin_country||(!context.origin_location_code&&!context.origin_city&&!context.origin_state))return {score:null,provenance:{status:'unavailable',reason:'Exporter pickup location is missing.',formula_version:policy.formula_version,confidence_score:0,unavailable_reasons:['Exporter pickup location is missing.']}};
  const all=(candidate.logisticsRoutes??[]).filter(route=>locationMatches(route,context)&&route.destination_country.toUpperCase()===candidate.country_code.toUpperCase());
  if(!all.length)return {score:null,provenance:{status:'unavailable',reason:'No sourced route evidence matches the exporter origin and destination.',formula_version:policy.formula_version,confidence_score:0,unavailable_reasons:['No matching route evidence.']}};
  const ageLimit=new Date(now.getTime()-policy.max_age_days*86_400_000);
  const current=all.filter(route=>route.status==='verified'&&route.confidence>=.8&&route.retrieved_at>=ageLimit&&(!route.valid_until||route.valid_until>now));
  if(!current.length)return {score:null,provenance:{status:'unavailable',reason:'Matching route evidence is stale, superseded, or needs review.',formula_version:policy.formula_version,confidence_score:0,input_evidence:{route_ids:all.map(r=>r.id),stale_route_count:all.length},unavailable_reasons:['No current verified route evidence.']}};
  const viable=current.filter(route=>route.route_available);
  const parts:Subscore[]=[];const weights:number[]=[];const missing:string[]=[];
  const routeScore=viable.length?Math.min(99,85+(viable.length-1)*7):1;
  parts.push({score:routeScore,provenance:{source:'combined',basis:'Verified route availability and route redundancy.',row_count:current.length}});weights.push(policy.route_weight);

  const transit=viable.filter(route=>route.transit_time_max_days!=null&&route.transit_time_max_days>0);
  if(transit.length&&context.lead_time_days!=null&&context.delivery_commitment_days!=null){
    const allowance=context.delivery_commitment_days-context.lead_time_days;
    const best=Math.min(...transit.map(route=>route.transit_time_max_days!));
    const transitScore=allowance<=0?1:best<=allowance?99:clamp(100*allowance/best);
    parts.push({score:transitScore,provenance:{source:'combined',basis:'Transit maximum compared with delivery commitment after subtracting production lead time.',row_count:transit.length}});weights.push(policy.transit_weight);
  }else missing.push('Transit-time compatibility needs current transit evidence plus separate production and delivery commitments.');

  const freshFreight=viable.filter(route=>route.freight_amount!=null&&route.freight_amount>0&&route.freight_currency&&route.freight_rate_basis==='per_shipment'&&route.assumed_shipment_value_amount!=null&&route.assumed_shipment_value_amount>0&&route.assumed_shipment_value_currency?.toUpperCase()===route.freight_currency.toUpperCase()&&route.freight_retrieved_at&&route.freight_retrieved_at>=ageLimit&&(!route.freight_valid_until||route.freight_valid_until>now));
  if(freshFreight.length){
    const burdens=freshFreight.map(route=>route.freight_amount!/route.assumed_shipment_value_amount!*100);
    const best=Math.min(...burdens);
    const burdenScore=clamp(100-Math.min(best,policy.freight_burden_ceiling_percent)*(100/policy.freight_burden_ceiling_percent));
    parts.push({score:burdenScore,provenance:{source:'combined',basis:'Sourced per-shipment freight as a share of its explicitly assumed shipment value; no FX or load factor inferred.',row_count:freshFreight.length}});weights.push(policy.burden_weight);
  }else missing.push('No fresh basis-compatible freight quote and assumed shipment value.');

  if(context.logistics_constraints_confirmed){
    const required=new Set((context.logistics_constraint_codes??[]).map(code=>code.toUpperCase()));
    const compatible=viable.filter(route=>[...required].every(code=>route.supported_product_constraint_codes.map(item=>item.toUpperCase()).includes(code)));
    parts.push({score:compatible.length?99:1,provenance:{source:'combined',basis:'Verified route/equipment support for explicitly confirmed product logistics constraints.',row_count:viable.length}});weights.push(policy.compatibility_weight);
  }else missing.push('Product logistics constraints have not been explicitly confirmed.');

  const score=combine(parts,weights);
  if(score==null)return unavailable('No logistics subfactor is sourceable.');
  const availableWeight=weights.reduce((sum,weight)=>sum+weight,0),totalWeight=policy.route_weight+policy.transit_weight+policy.burden_weight+policy.compatibility_weight;
  const evidenceConfidence=current.reduce((sum,route)=>sum+route.confidence,0)/current.length;
  const componentConfidence=Math.round(availableWeight/totalWeight*evidenceConfidence*100);
  const newestRoute=new Date(Math.max(...current.map(route=>route.retrieved_at.getTime()))).toISOString();
  return {score,provenance:{source:'combined',retrieved_at:newestRoute,basis:'Available logistics subfactors are deterministically renormalized; production and transit time remain separate.',row_count:current.length,evidence_ids:current.map(route=>route.id),formula_version:policy.formula_version,confidence_score:componentConfidence,input_evidence:{origin:{country:context.origin_country,state:context.origin_state,city:context.origin_city,location_code:context.origin_location_code,gateway:context.origin_gateway},destination_country:candidate.country_code,routes:current.map(route=>({id:route.id,provider:route.provider,source_reference:route.source_reference,origin_gateway:route.origin_gateway,destination_port:route.destination_port,mode:route.transport_mode,route_available:route.route_available,transit_time_min_days:route.transit_time_min_days,transit_time_max_days:route.transit_time_max_days,freight_amount:route.freight_amount,freight_currency:route.freight_currency,freight_rate_basis:route.freight_rate_basis,equipment_assumption:route.equipment_assumption,retrieved_at:route.retrieved_at.toISOString(),valid_until:route.valid_until?.toISOString()??null,freight_valid_until:route.freight_valid_until?.toISOString()??null})),production_lead_time_days:context.lead_time_days??null,delivery_commitment_days:context.delivery_commitment_days??null},unavailable_reasons:missing}};
}

export const RISK_RESILIENCE_FORMULA_VERSION='risk-resilience-v1';
export function scoreRiskResilience(candidate:CandidateInput,policy:DiscoveryScoringPolicy['risk_resilience'],now=new Date()):Subscore{
  const series=totals(candidate.totalRows),years=[...series.keys()].sort((a,b)=>a-b);
  const reasons:string[]=[];
  if(years.length<policy.minimum_trade_years)reasons.push(`Demand stability requires at least ${policy.minimum_trade_years} annual trade observations.`);
  if(years.some((year,index)=>index>0&&year!==years[index-1]+1))reasons.push('Demand stability requires consecutive annual observations.');
  const latestYear=years.at(-1);
  const lag=latestYear==null?Infinity:now.getUTCFullYear()-latestYear;
  if(lag>policy.max_trade_lag_years)reasons.push('Trade observations are too stale for resilience scoring.');
  if(reasons.length)return {score:null,provenance:{status:'unavailable',reason:reasons.join(' '),formula_version:policy.formula_version,confidence_score:0,unavailable_reasons:reasons}};

  const changes:number[]=[];
  for(let index=1;index<years.length;index++){const before=series.get(years[index-1])!,after=series.get(years[index])!;if(before<=0||after<0)return {score:null,provenance:{status:'unavailable',reason:'Demand stability cannot be computed from non-positive annual trade values.',formula_version:policy.formula_version,confidence_score:0,unavailable_reasons:['Non-positive annual trade value.']}};changes.push(after/before-1);}
  const mean=changes.reduce((sum,value)=>sum+value,0)/changes.length;
  const volatility=Math.sqrt(changes.reduce((sum,value)=>sum+(value-mean)**2,0)/changes.length);
  const demandScore=clamp(100-Math.min(volatility,policy.growth_volatility_ceiling)*(100/policy.growth_volatility_ceiling));
  const parts:Subscore[]=[{score:demandScore,provenance:{source:'comtrade',retrieved_at:newest(candidate.totalRows),basis:'Standard deviation of consecutive annual import growth rates; trend direction is scored separately in Growth.',row_count:years.length}}];
  const weights:number[]=[policy.demand_stability_weight];
  const cutoff=new Date(now.getTime()-policy.max_signal_age_days*86_400_000);
  const supported=(candidate.riskSignals??[]).filter(signal=>signal.status==='verified'&&signal.confidence>=.8&&signal.retrieved_at>=cutoff&&(!signal.valid_until||signal.valid_until>now)&&signal.unit==='index_0_100'&&signal.normalization_method==='linear_0_100_risk_inverse_v1'&&Number.isFinite(signal.value)&&signal.value>=0&&signal.value<=100);
  const latestFor=(dimension:MarketRiskSignalInput['dimension'])=>supported.filter(signal=>signal.dimension===dimension).sort((a,b)=>b.observation_date.getTime()-a.observation_date.getTime())[0];
  const macro=latestFor('macro_volatility'),payment=latestFor('payment_country_risk');
  if(macro){parts.push({score:clamp(100-macro.value),provenance:{source:'risk_signal',retrieved_at:macro.retrieved_at.toISOString(),basis:macro.normalization_method,row_count:1,evidence_ids:[macro.id]}});weights.push(policy.macro_resilience_weight);}else reasons.push('No current supported macro-volatility signal.');
  if(payment){parts.push({score:clamp(100-payment.value),provenance:{source:'risk_signal',retrieved_at:payment.retrieved_at.toISOString(),basis:payment.normalization_method,row_count:1,evidence_ids:[payment.id]}});weights.push(policy.payment_resilience_weight);}else reasons.push('No current supported payment/country-risk signal.');
  const score=combine(parts,weights)!;
  const totalWeight=policy.demand_stability_weight+policy.macro_resilience_weight+policy.payment_resilience_weight,availableWeight=weights.reduce((sum,weight)=>sum+weight,0);
  const tradeFreshness=Math.max(0,1-lag/(policy.max_trade_lag_years+1));
  const evidenceConfidence=(policy.demand_stability_weight*tradeFreshness+(macro?policy.macro_resilience_weight*macro.confidence:0)+(payment?policy.payment_resilience_weight*payment.confidence:0))/availableWeight;
  const confidenceScore=Math.round(availableWeight/totalWeight*evidenceConfidence*100);
  const used=[macro,payment].filter((signal):signal is MarketRiskSignalInput=>Boolean(signal));
  return {score,provenance:{source:'combined',retrieved_at:new Date(Math.max(...candidate.totalRows.map(row=>row.ingested_at.getTime()),...used.map(signal=>signal.retrieved_at.getTime()))).toISOString(),basis:'Soft commercial resilience from demand instability and supported independent macro/payment signals. Current supplier HHI and logistics-route evidence are intentionally excluded to prevent double counting.',row_count:years.length+used.length,evidence_ids:used.map(signal=>signal.id),formula_version:policy.formula_version,confidence_score:confidenceScore,input_evidence:{trade_years:years,annual_growth_rates:changes,demand_growth_volatility:volatility,signals:used.map(signal=>({id:signal.id,dimension:signal.dimension,metric:signal.metric,value:signal.value,unit:signal.unit,provider:signal.provider,source_reference:signal.source_reference,source_version:signal.source_version,observation_date:signal.observation_date.toISOString(),period_start:signal.period_start?.toISOString()??null,period_end:signal.period_end?.toISOString()??null,retrieved_at:signal.retrieved_at.toISOString(),normalization_method:signal.normalization_method}))},unavailable_reasons:reasons}};
}

export function combineScores(
  subscores: Record<string, Subscore>,
  weights: Record<string, number>,
) {
  let weighted = 0,
    total = 0;
  const applied: Record<string, number> = {};
  for (const [k, s] of Object.entries(subscores)) {
    const w = weights[k] ?? 0;
    if (s.score == null || w <= 0) continue;
    weighted += s.score * w;
    total += w;
    applied[k] = w;
  }
  return {
    overall: total ? clamp(weighted / total) : 0,
    weightsApplied: applied,
  };
}
function confidence(
  candidate: CandidateInput,
  asOfDate: Date,
  components: Record<string, Subscore>,
  weights: DiscoveryComponentWeights,
  policy:DiscoveryScoringPolicy['confidence'],
) {
  const years = [...totals(candidate.totalRows).keys()];
  const latest = Math.max(...years);
  const reportingLagYears=Math.max(0,asOfDate.getUTCFullYear()-latest);
  if(policy.formula_version==='assessment-confidence-v2'){
    const recency=clamp(100*Math.max(0,1-reportingLagYears/5));
    const completeness=clamp(Math.min(years.length/4,1)*70+(candidate.supplierRowsLatestYear.length?30:0));
    const totalW=Object.values(weights).reduce((a,b)=>a+b,0),availableW=Object.entries(components).reduce((sum,[key,value])=>sum+(value.score==null?0:(weights[key as keyof DiscoveryComponentWeights]??0)),0);
    return Math.max(0,Math.min(100,Math.round(recency*.35+completeness*.35+(availableW/totalW*100)*.15)));
  }
  const excessLag=Math.max(0,reportingLagYears-policy.accepted_reporting_lag_years);
  const decaySpan=Math.max(1,policy.stale_after_lag_years-policy.accepted_reporting_lag_years);
  const recency=clamp(100*(1-Math.min(1,excessLag/decaySpan)));
  const completeness = clamp(
    Math.min(years.length / 4, 1) * 70 +
      (candidate.supplierCoverage?.completeness==='COMPLETE' ? 30 : 0),
  );
  const buyerCoverage = 0;
  const totalW = Object.values(weights).reduce((a, b) => a + b, 0),
    availableW = Object.entries(components).reduce(
      (s, [k, v]) => {
        if(v.score==null)return s;
        const quality='confidence_score' in v.provenance&&v.provenance.confidence_score!=null?v.provenance.confidence_score/100:1;
        return s+(weights[k as keyof DiscoveryComponentWeights]??0)*quality;
      },
      0,
    );
  const missingness = clamp((availableW / totalW) * 100);
  return Math.max(
    0,
    Math.min(
      100,
      Math.round(
        recency * policy.recency_weight/100 +
          completeness * policy.reporting_completeness_weight/100 +
          buyerCoverage * policy.buyer_coverage_weight/100 +
          missingness * policy.missingness_weight/100,
      ),
    ),
  );
}
export function scoreCandidate(
  candidate: CandidateInput,
  demandDenominator: DemandDenominatorInput,
  asOfDate: Date,
  context: ExporterContext,
  policy: DiscoveryScoringPolicy,
  weights: DiscoveryComponentWeights,
): ScoredMarket | null {
  const by = totals(candidate.totalRows),
    years = [...by.keys()].sort((a, b) => a - b);
  if (!years.length) return null;
  const year = years.at(-1)!,
    latest = by.get(year)!,
    latestRows = candidate.totalRows.filter((r) => r.year === year);
  const india = scoreIndiaShare(candidate.indiaRows, latest, year),
    fragment = scoreCompetition(candidate.supplierRowsLatestYear,policy.model_version==='market-attractiveness-v2'?{world_total_value:latest,supplier_value_sum:candidate.supplierRowsLatestYear.reduce((sum,row)=>sum+row.value,0),partner_count:new Set(candidate.supplierRowsLatestYear.map(row=>row.partner)).size,coverage_ratio:null,completeness:'COMPLETE',query_scope:{legacy_v2:true},acquisition_ids:[],threshold_version:'legacy-v2-unverified'}:candidate.supplierCoverage);
  const competition: Subscore = {
    score: combine([fragment, india], [policy.competition.hhi_weight, policy.competition.india_share_weight]),
    provenance: {
      source: "comtrade",
      retrieved_at: newest(candidate.totalRows),
      basis:
        "Competitive opportunity combines fragmented supply and India share.",
      row_count:
      candidate.supplierRowsLatestYear.length + candidate.indiaRows.length,
      formula_version:policy.competition.formula_version,
      evidence_ids:[...new Set([...candidate.supplierRowsLatestYear,...candidate.indiaRows].map(row=>row.acquisition_id).filter((id):id is string=>Boolean(id)))],
      input_evidence:{supplier_coverage:candidate.supplierCoverage??null,hhi_available:fragment.score!=null,india_share_available:india.score!=null},
    },
  };
  const priceBandUnits = new Set(
    latestRows.map((row) => canonicalQuantityUnit(row.unit)).filter(Boolean),
  );
  const unitValues = latestRows
    .filter((row) =>
      priceBandUnits.size === 1 &&
      row.quantity != null &&
      Number.isFinite(row.quantity) &&
      row.quantity > 0 &&
      canonicalQuantityUnit(row.unit) != null,
    )
    .map((r) => r.unit_value)
    .filter((v): v is number => v != null && Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  const price_band = unitValues.length
    ? {
        min: unitValues[Math.floor(unitValues.length * 0.1)],
        max: unitValues[
          Math.min(unitValues.length - 1, Math.floor(unitValues.length * 0.9))
        ],
        currency: "USD" as const,
      }
    : null;
  const price_band_provenance: Provenance = price_band
    ? {
        source: "comtrade",
        retrieved_at: newest(latestRows),
        basis: `Tenth-to-ninetieth percentile observed unit values per ${[...priceBandUnits][0]}; no unit conversion applied.`,
        row_count: unitValues.length,
      }
    : {
        status: "unavailable",
        reason: priceBandUnits.size > 1
          ? "Observed unit values use incompatible quantity units."
          : "No reported positive quantities with a known quantity unit for unit-value calculation.",
      };
  const components = {
    demand_strength: demandStrength(latest, demandDenominator, latestRows,policy.demand),
    growth_momentum: growthMomentum(candidate.totalRows, policy),
    competitive_opportunity: competition,
    market_access: scoreMarketAccess(candidate.marketAccess),
    export_economics: scoreExportEconomics(
      candidate,
      context,
      policy.export_economics,
    ),
    exporter_market_fit: scoreExporterMarketFit(
      candidate,
      context,
      policy.exporter_market_fit,
    ),
    logistics_feasibility: scoreLogisticsFeasibility(
      candidate,
      context,
      policy.logistics,
    ),
    risk_resilience: scoreRiskResilience(
      candidate,
      policy.risk_resilience,
    ),
  };
  const combined = combineScores(
    components,
    weights as unknown as Record<string, number>,
  );
  if (!Object.keys(combined.weightsApplied).length) return null;
  return {
    reporter: candidate.reporter,
    country_code: candidate.country_code,
    overall_score: combined.overall,
    demand: components.demand_strength,
    growth: components.growth_momentum,
    competition: components.competitive_opportunity,
    market_access: components.market_access,
    export_economics: components.export_economics,
    exporter_market_fit: components.exporter_market_fit,
    logistics_feasibility: components.logistics_feasibility,
    risk_resilience: components.risk_resilience,
    confidence_score: confidence(
      candidate,
      asOfDate,
      components,
      weights,
      policy.confidence,
    ),
    india_share_pct: india.share_pct,
    india_share: india,
    price_band,
    price_band_provenance,
    latest_total_value: latest,
    latest_year: year,
    weights_applied: combined.weightsApplied,
  };
}

export const __test__ = { growthMomentum };

export function scoreCandidateByModel(args:{candidate:CandidateInput;demandDenominator:DemandDenominatorInput;asOfDate:Date;context:ExporterContext;policy:DiscoveryScoringPolicy;weights:DiscoveryComponentWeights;legacyNewestYear?:number}){
  if(args.policy.model_version==='market-attractiveness-v3'||args.policy.model_version.startsWith('test'))return scoreCandidate(args.candidate,args.demandDenominator,args.asOfDate,args.context,args.policy,args.weights);
  if(args.policy.model_version==='market-attractiveness-v2'){
    const legacyPolicy={...args.policy,demand:{...args.policy.demand,formula_version:'demand-strength-v2'},competition:{...args.policy.competition,formula_version:'competitive-opportunity-v2'},confidence:{...args.policy.confidence,formula_version:'assessment-confidence-v2'}};
    const legacyClock=new Date(Date.UTC(args.legacyNewestYear??args.asOfDate.getUTCFullYear(),0,1));
    return scoreCandidate(args.candidate,args.demandDenominator,legacyClock,args.context,legacyPolicy,args.weights);
  }
  throw new Error(`Unsupported Demand Discovery model version ${args.policy.model_version}.`);
}
