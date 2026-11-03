/**
 * Demand Discovery engine — the seam between the product and whatever actually ranks
 * markets.
 *
 * docs/02 is explicit: *"don't bind the frontend to an assumed AI provider or algorithm.
 * The UI contract is a `DiscoveryRun` resource plus ranked `MarketAssessment` records."*
 * This file is that contract expressed in code.
 *
 * Everything on the far side of this interface — the job system, the `MarketAssessment`
 * rows, the polling endpoint, the UI — depends only on `DiscoveryEngine`. Swapping the
 * mock for a real provider means writing one new class and changing one factory line; it
 * must not require touching a route, a schema, or a component. If a future change to this
 * interface would force the UI to know which engine produced a result, that change is
 * wrong.
 *
 * Note what is deliberately NOT here: no provider SDK types, no prompt shapes, no model
 * names, no API-key handling. Those belong inside an implementation.
 */

/** What the caller knows about the product being assessed. */
export interface DiscoveryInput {
  /** Tenant whose confidential operational evidence may be considered. */
  exporter_org_id?: string | null;
  /** Free-text product description. Always present — it is all a guest supplies. */
  description: string;
  /** Tariff classification, when known. Sharpens tariff/duty figures if the engine uses it. */
  hs_code?: string | null;
  /** ISO-3166 alpha-2 codes to restrict the search to. Empty means "engine decides". */
  target_countries?: string[];
  /** Origin country. India-first, but explicit rather than assumed. */
  origin_country?: string;
  origin_state?: string | null;
  origin_city?: string | null;
  origin_location_code?: string | null;
  origin_gateway?: string | null;
  price_target_amount?: number | null;
  price_target_currency?: string | null;
  price_target_quantity_unit?: string | null;
  price_target_incoterm?: string | null;
  capacity_value?:number|null;
  capacity_unit?:string|null;
  lead_time_days?: number | null;
  delivery_commitment_days?: number | null;
  logistics_constraint_codes?: string[];
  logistics_constraints_confirmed?: boolean;
  desired_order_size_amount?: number | null;
  desired_order_size_currency?: string | null;
  customization_capability?: string | null;
  packaging_capability?: string | null;
  moq_value?: number | null;
  moq_unit?: string | null;
  certifications?: { code: string; name: string; status: string; evidence_ref: string | null; valid_until?:string|null }[];
  as_of_date?:string;
}

/**
 * One ranked market. Mirrors the `MarketAssessment` field dictionary in docs/02 without
 * being a Prisma type — an engine implementation must not depend on the database schema.
 */
export interface MarketAssessmentDraft {
  country_code: string;
  overall_score: number | null;
  demand_score?: number | null;
  growth_score?: number | null;
  competition_score?: number | null;
  market_access_score?: number | null;
  export_economics_score?: number | null;
  exporter_market_fit_score?: number | null;
  logistics_feasibility_score?: number | null;
  risk_resilience_score?: number | null;
  confidence_score?: number;
  eligibility_status?: 'eligible' | 'ineligible';
  eligibility_reasons?: unknown[];
  model_version?: string;
  weight_profile_key?: string;
  weight_profile_version?: number;
  as_of_date?:string;
  scoring_policy_version?:number;
  scoring_policy_hash?:string;
  scoring_policy_snapshot?:Record<string,unknown>;
  reproducibility_status?:'reproducible'|'legacy_non_recomputable';
  evidence_origins?: Array<'unknown_legacy'|'fixture'|'mock'|'preview'|'authenticated_real'|'public_real'|'imported_real'|'manually_entered_real'>;
  india_share?: number | null;
  tariff_summary?: Record<string, unknown> | null;
  certification_requirements?: unknown[];
  logistics_summary?: Record<string, unknown> | null;
  price_band_min?: number | null;
  price_band_max?: number | null;
  price_band_currency?: string | null;
  /** Why this market ranks where it does. Required — docs/02 treats it as non-optional UX. */
  rationale: string;
  /**
   * Per-field source and retrieval date, keyed by field name — docs/04 EXP-04-AC03 asks for
   * "freshness/source metadata", and EXP-04-AC02 forbids fabricating a missing value, which
   * requires somewhere to say *that* a value is missing and why.
   *
   * Optional and additive: an engine that has no provenance to report omits it, every
   * existing caller compiles unchanged, and nothing downstream is obliged to read it. This
   * is the one extension to the interface the warehouse engine needed — the alternative was
   * either dropping the requirement or smuggling provenance through a field meant for
   * something else.
   */
  field_provenance?: Record<string, unknown> | null;
}

export interface DiscoveryResult {
  assessments: MarketAssessmentDraft[];
  /**
   * True when the engine returned usable but incomplete results — maps to the job's
   * `partial` state, which docs/09 §3 requires the UI to render as "here's what we got,
   * and here's what's missing" rather than as a success or a failure.
   */
  partial?: boolean;
  /** Which segments failed, when partial. Surfaced to the user, so keep it human-safe. */
  missing?: string[];
  /** Free-form provenance (engine name, model, data vintage) for AI-output labelling. */
  provenance?: Record<string, unknown>;
}

export interface DiscoveryEngine {
  /** Stable identifier recorded on the job result, so a stored result says what produced it. */
  readonly name: string;
  rank(input: DiscoveryInput, signal?: { onProgress?: (pct: number) => void }): Promise<DiscoveryResult>;
}
