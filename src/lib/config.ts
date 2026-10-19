/**
 * Runtime business configuration.
 *
 * docs/01 §2 is explicit: fees, agent share, SLA durations, thresholds and the document
 * type registry are business settings, NOT constants. Nothing in this file is imported
 * as a literal by feature code — callers read through `getConfig()` / `getFeePolicy()`,
 * which hit the ConfigSetting / FeePolicy tables.
 *
 * The DEFAULTS below exist only to seed the database and to keep a freshly cloned dev
 * environment bootable. They are the "current/default assumption" column of docs/01 §2,
 * not a source of truth at runtime.
 */

import { prisma } from '@/lib/prisma';
import { WORLD_PARTNER } from '@/lib/comtrade/areas';
import { COMTRADE_REPORTER_REGISTRY_VERSION } from '@/lib/comtrade/reporter-registry';
import { COUNTRY_SCREENING_ALGORITHM_VERSION } from '@/lib/country-screening/ranking';
import { COUNTRY_SCREENING_UNIVERSE_VERSION, type CountryScreeningExclusionReason } from '@/lib/country-screening/universe';
import { INDIA_ORIGIN_UNIT_VALUE_VERSION } from '@/lib/country-trade-metrics/calculator';
import { DEFAULT_PLAN_PRICING, type PlanPricing } from '@/lib/billing/plans';
import type {
  AssertionClass,
  ExportEconomicsV3Policy,
  ExporterMarketFitV3Policy,
  LogisticsV3Policy,
  MarketAccessV2Policy,
} from '@/lib/country-truth/phase-1h-calculations';
import type { Money } from '@/types';
import { DEMAND_DISCOVERY_V5_DEFAULT_POLICY, type DemandDiscoveryV5Policy } from '@/lib/demand-discovery-v5/policy';

// ---------------------------------------------------------------------------
// Config keys and their value shapes
// ---------------------------------------------------------------------------

export interface SlaThreshold {
  /** Hours from creation until due_at. */
  due_in_hours: number;
  /** Hours from creation until the "due soon" warning fires. */
  warning_in_hours: number;
  /** Hours past due_at before the task escalates to Ops. */
  escalate_after_hours: number;
}

export interface DocTypeRegistryEntry {
  doc_type: string;
  /** Plain-language label first; the technical term goes in helper text (docs/10 §5). */
  label: string;
  technical_label: string;
  default_owner_role: string;
  approval_required: boolean;
  filing_applicable: boolean;
}

export interface UploadPolicy {
  max_size_mb: number;
  allowed_mime_types: string[];
}

export interface PaginationPolicy {
  default_per_page: number;
  max_per_page: number;
}

export interface FitScoreWeights {
  country_match: number;
  category_match: number;
  verification: number;
  import_recency: number;
  /** Below this, the UI should not present the buyer as a recommended match. */
  min_display_score: number;
}

/**
 * When an agent's commission becomes payable (AGT-08 / OPS-05).
 *
 * docs/06 OPS-05 states the dependency exists ("Pending realization | Waiting on buyer
 * payment realization, **if policy requires**") but deliberately leaves the rule itself
 * to the business — so it is expressed here as data, not baked into a predicate. Reading
 * these three flags tells you the whole rule; there is no second place to check.
 */
export interface PayoutEligibilityPolicy {
  /**
   * Require the buyer payment to be `realized` (bank-confirmed), not merely `received`.
   * The conservative default: ClearTrade should not owe commission on money that could
   * still be reversed.
   */
  require_payment_realized: boolean;
  /** Require the deal to have reached a closed-won/shipped terminal state. */
  require_deal_closed_won: boolean;
  /**
   * Require no open dispute on the deal. A payout computed while the underlying deal is
   * contested is the exact scenario that turns into a compensation argument later.
   */
  require_no_open_dispute: boolean;
  /** Days after eligibility before finance is expected to approve — surfaced, not enforced. */
  approval_target_days: number;
}

export interface ConfigShape {
  'agent.capacity': {
    /** Advisory staffing target only; assignment authorization never reads this as a gate. */
    target_exporters_per_agent: number;
  };
  'sla.thresholds': Record<string, SlaThreshold>;
  'payout.eligibility': PayoutEligibilityPolicy;
  'documents.registry': DocTypeRegistryEntry[];
  'uploads.policy': UploadPolicy;
  'pagination.policy': PaginationPolicy;
  /**
   * @deprecated Dead configuration. Nothing reads this key.
   *
   * It describes an older model (country/category/verification/recency) while the live scorer
   * combines volume/price/certification/outcome as an unweighted mean. Retained so that any
   * persisted ConfigSetting row still parses and remains readable as history — removing the
   * shape would orphan stored rows — but it is excluded from every editable surface. BuyerFit
   * scoring is code-owned: see BUYER_FIT_POLICY in src/lib/buyer-intelligence.ts.
   */
  'buyers.fit_score_weights': FitScoreWeights;
  'leads.outreach': {
    /** Days without activity before a lead is flagged stale (AGT-03 "stale lead"). */
    stale_after_days: number;
    /** Auto-created follow-up task offset after an outreach activity (docs/13 E5). */
    follow_up_due_in_hours: number;
  };
  'guest.policy': GuestPolicy;
  'jobs.policy': JobsPolicy;
  'comtrade.policy': ComtradePolicy;
  'country_evidence.policy': CountryEvidencePolicy;
  'country_period_selection.policy': CountryPeriodSelectionPolicy;
  'country_screening.policy': CountryScreeningPolicy;
  'country_trade_metrics.policy': CountryTradeMetricPolicy;
  'country_truth.scoring_v4': CountryTruthScoringV4Policy;
  'country_truth.phase_1h': CountryTruthPhase1HPolicy;
  'country_truth.market_access_orchestration': CountryTruthMarketAccessOrchestrationPolicy;
  'discovery.scoring': DiscoveryScoringPolicy;
  'market_estimate.policy': MarketEstimatePolicy;
  'demand_discovery.v5': DemandDiscoveryV5Config;
  'market_access.authority_refresh': AuthorityRefreshConfig;
  /**
   * Membership prices. Here — not in `src/lib/billing/plans.ts` — because money is never a
   * literal in application code (docs/01 §2), and because Ops must be able to reprice
   * without a deploy. `Subscription.amount` snapshots the value at subscribe time, so a
   * change here never reaches backward into an existing member's agreed price.
   */
  'billing.plans': PlanPricing;
}

/**
 * Pre-membership market estimate — the public, no-LLM surface described in docs/14 §3
 * (`market_estimate.run`, guest tier). Deliberately tiny compared to `discovery.scoring`:
 * this reads the warehouse and reports observed history, it does not rank or score
 * anything, so there are no weights here — only how much to show and how to bucket the
 * cache key.
 */
/**
 * Demand Discovery v5 (docs/36). The scoring policy is frozen into every run with its hash; the
 * switches decide when v5 runs and which providers it may call. `enabled: false` returns new runs
 * to the earlier engine without a deploy.
 */
export interface DemandDiscoveryV5Config {
  enabled: boolean;
  /** D-018: confirming a product's classification starts a run (paid tier only). */
  auto_start_on_classification: boolean;
  /** D-010/R-14: use Comtrade for the newest year (§5.3). */
  comtrade_newest_year: boolean;
  /** D-010/R-14: use a market's own Comtrade series where BACI lacks it (§3.3). */
  comtrade_market_fallback: boolean;
  /** maxRecords for one batched Comtrade call (the free key allows 100,000). */
  comtrade_max_records: number;
  /** How far back an FX observation may be walked for the exporter's price (days). */
  fx_max_lookback_days: number;
  /**
   * Fetch the ECB reference rates a run needs when the environment holds none for its date
   * (`demand-discovery-v5/fx.ts`). The ECB API is public and keyless, and its terms allow reuse
   * with attribution. Off: a price outside US dollars stays uncompared until rates are stored.
   */
  fx_fetch_missing: boolean;
  /**
   * D-028: convert a floating currency the ECB does not publish (and no peg covers) with the US
   * Treasury reporting rate (`src/lib/fx/treasury.ts`; public domain, quarterly). With
   * `fx_fetch_missing` on, a run that finds none stored fetches the Treasury list once.
   */
  fx_treasury_fallback: boolean;
  /** How far back a Treasury rate may be (days): a quarter plus the weeks before the next one is published. */
  fx_treasury_max_lookback_days: number;
  /**
   * D-020: look up the product's official tariff in every market with a Customs Atlas source inside
   * each run (`demand-discovery-v5/tariff-step.ts`). Off: a run reads only tariff evidence ingested
   * earlier, and every other market's duty is the labelled estimate.
   */
  tariff_acquisition: boolean;
  /** Ceiling for one live tariff fetch (UK, US) inside a run, in milliseconds. */
  tariff_live_fetch_timeout_ms: number;
  policy: DemandDiscoveryV5Policy;
}

/**
 * D-029: official tariffs whose authority allows automated fetching only inside a window. The worker
 * fetches them there and saves them as authority releases, so a run at any hour reads the saved copy
 * (`market-access/providers/singapore-refresh.ts`). Written through the audited config API or
 * `scripts/authority-refresh.ts`; not an Ops-console setting.
 */
export interface AuthorityRefreshConfig {
  singapore: {
    /** Off by default: nothing is fetched from Singapore Statutes Online until this is switched on. */
    enabled: boolean;
    /** The active ops supervisor or admin account saved releases are imported as. */
    actor_email: string | null;
    /** The first saved copy becomes the one runs read once it passes qualification. */
    activate_first_release: boolean;
    /**
     * A changed tariff becomes the one runs read automatically. Off: it is saved and held for
     * review, because a saved release records only the amendments reviewed in code (to S 67/2026).
     */
    activate_changed_tariff: boolean;
    /** Failed attempts allowed in one night's window. */
    max_attempts_per_window: number;
    /** Wait between a failed attempt and the next. */
    minutes_between_attempts: number;
  };
}

export interface MarketEstimatePolicy {
  /** How many top-importing markets the estimate names. */
  top_n_markets: number;
  /** Same floor `discovery.scoring` uses — a market too small to matter is too small here too. */
  volume_floor_usd: number;
  /**
   * Breakpoints (ascending) that bucket the form's `monthly_quantity` into a coarse band
   * for the CACHE KEY only — see the note on `quantityBand()` in `market-estimate.ts` for
   * why quantity never enters the arithmetic itself.
   */
  quantity_band_breakpoints: number[];
}

/**
 * Demand Discovery scoring weights and thresholds.
 *
 * These are business constants in the docs/01 §2 sense — the relative importance of demand
 * vs. growth vs. competition is a product judgement Ops must be able to retune as the
 * market model is calibrated, not a number compiled into the ranking code. Versioned
 * through `ConfigSetting`, so OPS-07 can publish a new version and every prior version
 * stays in the table (a run scored under v1 is visibly a different rule from one scored
 * under v2, rather than an unexplained difference between two rankings).
 */
export interface DiscoveryScoringPolicy {
  /**
   * Relative weight of each subscore in the overall score. They need not sum to 1 — the
   * engine renormalizes over whichever subscores it could actually compute, so a market
   * with no price data is ranked on its available evidence rather than penalised to zero
   * for a gap in the warehouse.
   */
  model_version: string;
  base_weights: DiscoveryComponentWeights;
  archetype_profiles: Record<string, { version: number; hs_chapters: string[]; weights: DiscoveryComponentWeights }>;
  /**
   * Minimum annual import value (USD) for a country to enter the candidate set at all.
   * Below this a market is too small to be worth an exporter's attention, and its
   * percentage-based subscores get noisy enough to be misleading.
   */
  volume_floor_usd: number;
  /** Years of history the CAGR is computed over (docs: "5yr CAGR"). */
  growth_window_years: number;
  /**
   * Per-year multiplicative decay applied to the recency subscore. 0.8 means data one year
   * stale scores 80% of fresh, two years 64%, and so on.
   */
  recency_decay_per_year: number;
  /** How many top-ranked markets get an LLM-written rationale. The rest get the deterministic one. */
  rationale_top_n: number;
  demand: { formula_version:string; share_metric:'candidate_market_share'; value_weight:number; share_weight:number; buyer_depth_weight:number };
  competition: { formula_version:string; hhi_weight:number; india_share_weight:number; minimum_supplier_coverage_ratio:number; maximum_supplier_coverage_ratio:number; minimum_partner_count:number; coverage_policy_version:string };
  confidence: { formula_version:string; freshness_policy_version:string; accepted_reporting_lag_years:number; stale_after_lag_years:number; recency_weight:number; reporting_completeness_weight:number; buyer_coverage_weight:number; missingness_weight:number };
  market_access: { formula_version:string; tariff_weight:number; regulatory_weight:number; tariff_ceiling_percent:number; certification_penalty:number; restriction_penalty:number; non_tariff_penalty:number; max_snapshot_age_days:number };
  export_economics: { formula_version:string; india_price_weight:number; market_price_weight:number; tariff_weight:number; tariff_ceiling_percent:number; minimum_price_observations:number };
  logistics: { formula_version:string; route_weight:number; transit_weight:number; burden_weight:number; compatibility_weight:number; max_age_days:number; freight_burden_ceiling_percent:number };
  risk_resilience: { formula_version:string; demand_stability_weight:number; macro_resilience_weight:number; payment_resilience_weight:number; minimum_trade_years:number; max_trade_lag_years:number; max_signal_age_days:number; growth_volatility_ceiling:number };
  exporter_market_fit: { formula_version:string; order_size_weight:number; capacity_moq_weight:number; certification_weight:number; lead_time_weight:number; customization_weight:number; packaging_weight:number; max_benchmark_age_days:number };
}

export interface DiscoveryComponentWeights {
  demand_strength: number;
  growth_momentum: number;
  competitive_opportunity: number;
  market_access: number;
  export_economics: number;
  exporter_market_fit: number;
  logistics_feasibility: number;
  risk_resilience: number;
}

/**
 * Background job execution policy (docs/09 §3). Retry counts and timeouts are operational
 * settings Ops must be able to retune when a provider degrades, so they live here rather
 * than as constants in the worker.
 */
export interface JobsPolicy {
  /**
   * How long a job may sit in `processing` before it is considered abandoned and
   * reclaimable. This is what stops a worker crash from stranding a job forever — it
   * must be comfortably longer than the slowest legitimate run.
   */
  stale_after_seconds: number;
  /** Default attempt ceiling; a job may override it at enqueue time. */
  max_attempts: number;
  /** Base delay for exponential backoff between attempts. */
  retry_backoff_seconds: number;
  /** How often the worker polls for claimable work when idle. */
  worker_poll_interval_ms: number;
  /** Suggested client polling interval, returned to the UI so backoff is server-driven. */
  client_poll_interval_ms: number;
}

/**
 * Comtrade ingest rate-limit behaviour — the free tier's caps are Ops' problem to retune
 * (an upgraded key, a provider change), not a redeploy.
 */
export interface ComtradePolicy {
  /** Hard timeout for each physical provider call. */
  request_timeout_ms?: number;
  /** Reuse only complete evidence newer than this threshold. */
  evidence_cache_ttl_hours?: number;
  /** Pause between successive requests within one ingest run, staying under the free-tier rate cap. */
  request_delay_ms: number;
  /** How many times a single request retries a 429/5xx before the run records it as a failure. */
  max_retries: number;
  /** Base delay for exponential backoff between retries. */
  retry_backoff_ms: number;
  /** Explicit HS6 codes per API call. Kept configurable as provider limits change. */
  hs_codes_per_request: number;
  /** Conservative local ceiling below the advertised free-key quota. */
  daily_request_budget: number;
  /**
   * Calls a batch must leave unspent. A batch that would drop the day's remaining allowance
   * below this floor defers instead of executing, so an interactive acquisition can never
   * consume the headroom a retry or an operational query still needs.
   *
   * Deliberately here rather than in `country_evidence.policy`: that policy is hashed into
   * every plan_key, so adding a field there would make every historical plan irreproducible.
   * Quota headroom is a provider-account concern and changes no evidence identity.
   */
  minimum_request_reserve?: number;
  /** Highest-value chapters first; the full ingest script consumes this exact order. */
  chapter_priority: string[];
}

/** Versioned acquisition policy. It chooses evidence, never scores a country. */
export interface CountryEvidencePolicy {
  policy_version: string;
  history_years: number;
  annual_release_month_utc: number;
  minimum_candidate_coverage_ratio: number;
  latest_period_freshness_days: number;
  closed_period_freshness_days: number;
  supplier_distribution_freshness_days: number;
  supplier_coverage_min_ratio: number;
  supplier_coverage_max_ratio: number;
  india_partner_code: string;
  world_partner_code: string;
  all_suppliers_partner_code: string;
  candidate_strategy: 'explicit_candidates_v1';
  allow_partial_execution: boolean;
}

/**
 * Latest-usable-period selection (Phase 1G).
 *
 * Owns the answer to "which annual period should THIS country be judged on?", separately from
 * how any country is scored. It exists because a globally-common latest year silently excludes
 * every reporter that files late, which is a property of national statistics offices rather
 * than of demand.
 *
 * The two numeric constants are derived from policy this repository already holds rather than
 * invented: `discovery.scoring.confidence.accepted_reporting_lag_years` (2) sets how far back
 * the walk may go, and `discovery.scoring.recency_decay_per_year` (0.8) sets what a year of age
 * costs in evidence confidence. Nothing here ever alters a raw trade value.
 */
export interface CountryPeriodSelectionPolicy {
  policy_version: string;
  selection_rule: 'first_usable_walking_back_v1';
  /** Annual data becomes eligible only from this UTC month. */
  annual_release_month_utc: number;
  /** How many years older than the preferred period the walk may reach. */
  max_fallback_lookback_years: number;
  /** Cell statuses that answer the question. Anything else is not a usable observation. */
  usable_cell_statuses: string[];
  /** A measured zero is an answer; searching past it would manufacture demand. Must stay true. */
  observed_zero_terminates_selection: boolean;
  /** Suppression says a value exists and is withheld — not that the market is absent. */
  suppressed_permits_fallback: boolean;
  /** An HS-revision mismatch is a real incompatibility at that year, so an older year may serve. */
  incompatible_permits_fallback: boolean;
  /** Our own outage is never evidence about a country. Must stay false. */
  provider_failure_permits_fallback: boolean;
  /** Evidence weight decay per year of lag. Mirrors discovery.scoring.recency_decay_per_year. */
  recency_decay_per_year: number;
  /** Freshness label per lag, index 0 = preferred period. */
  freshness_states_by_lag: string[];
  /** Label applied once the lookback is exhausted. */
  beyond_lookback_state: string;
  /**
   * How long acquired evidence for a CLOSED (non-preferred) period stays reusable. A closed
   * year does not change, so re-acquiring it on the preferred period's 90-day clock would
   * re-buy the same immutable fact forever — and would do it to exactly the lagging countries
   * this policy exists to serve.
   */
  closed_period_freshness_days: number;
}

/**
 * Stage A global country screening (Phase 1F).
 *
 * This policy decides which countries are worth spending deep Country Truth quota on. It is
 * NOT an attractiveness model: it names one cheap trade signal (latest usable World import
 * value for the confirmed HS6, by reporter), the evidence that signal is allowed to come
 * from, and how many markets survive to the deep pipeline. Every constant that changes a
 * screening outcome lives here rather than in service code, so a historical run can be
 * reproduced from its frozen snapshot alone.
 */
export interface CountryScreeningPolicy {
  policy_version: string;
  /** Names the stage so a later regional-discovery stage cannot be confused with this one. */
  screening_stage: 'stage_a_global_demand_v1';
  universe_version: string;
  /** Reporter identity comes from the provider's own reference, never from an alias map. */
  reporter_identity_strategy: 'comtrade_reporter_reference_v1';
  reporter_registry_version: string;
  /** ISO 3166-1 alpha-2 → why that identity can never be a ClearTrade target market. */
  excluded_iso2_codes: Record<string, CountryScreeningExclusionReason>;
  /** ClearTrade exports FROM India; India is not one of its own target markets. */
  exclude_origin_country: boolean;
  /** Canonical ISO identity. The reporter code for it is resolved through the registry. */
  origin_country_iso2: string;
  /** Guard against a universe that silently explodes past what quota planning assumes. */
  max_countries_per_run: number;
  /** Deep-analysis shortlist target. Fewer markets ship when fewer qualify. */
  shortlist_target_size: number;
  max_shortlist_size: number;
  /** Minimum evidence requirement: a real observation at or above this annual import value. */
  minimum_import_value_usd: number;
  world_partner_code: string;
  /** Annual data becomes eligible only from this UTC month, matching country_evidence. */
  annual_release_month_utc: number;
  /**
   * Retained for historical run snapshots only. Phase 1G moved the lookback into
   * `country_period_selection.policy`; this field must stay 0 so a v1 snapshot still parses
   * and no second, disagreeing lookback can be configured here.
   */
  period_fallback_lookback_years: number;
  latest_period_freshness_days: number;
  /** v1 screens on complete responses only; relaxing it would be a new policy version. */
  require_complete_evidence: boolean;
  required_parser_version: string;
  required_normalization_version: string;
  screening_algorithm_version: string;
  /** Market-size transformation. Screening rank is explicitly not a v4 country score. */
  demand_signal: { method: 'world_import_value_log10_v1'; floor_usd: number; ceiling_usd: number };
  tie_breaker: 'selection_score_desc_then_screening_score_desc_then_import_value_desc_then_period_lag_asc_then_reporter_code_asc_v2';
  /** The period-selection policy this screening policy is pinned to. */
  period_selection_policy_version: string;
  max_acquisition_attempts_per_country: number;
  allow_partial_execution: boolean;
}

export interface CountryTradeMetricPolicy {
  policy_version: string;
  calculation_version: string;
  expected_history_years: number;
  cagr_method: 'endpoint_geometric_v1';
  recent_momentum_method: 'latest_year_simple_growth_v1';
  india_share_method: 'india_over_world_percent_v1';
  india_share_trend_method: 'ols_slope_and_endpoint_pp_v1';
  supplier_hhi_method: 'sum_normalized_supplier_share_squared_v1';
  supplier_coverage_min_ratio: number;
  supplier_coverage_max_ratio: number;
  require_mappable_supplier_country: boolean;
  volatility_method: 'population_stddev_simple_annual_growth_v1';
  minimum_volatility_observations: number;
  unit_value_preference: 'net_weight_then_compatible_quantity_v1';
  weight_based_hs_chapters: string[];
  accepted_quantity_units_by_hs_chapter: Record<string,string[]>;
  minimum_unit_value_observations: number;
  unit_value_low_percentile: number;
  unit_value_high_percentile: number;
  unit_value_outlier_method: 'tukey_1_5_iqr_v1';
  stale_input_behavior: 'metric_stale';
  zero_value_behavior: 'explicit_zero_only';
}

export interface CountryTruthScoringV4Policy {
  model_version:'market-attractiveness-v4';formula_version:string;
  base_component_weights:DiscoveryComponentWeights;
  demand:{method:'absolute_log10_usd_v1';floor_usd:number;ceiling_usd:number};
  growth:{cagr_weight:number;recent_momentum_weight:number;floor_percent:number;ceiling_percent:number};
  competition:{hhi_weight:number;india_share_weight:number;india_share_trend_weight:number;trend_floor_pp_per_year:number;trend_ceiling_pp_per_year:number};
  risk:{trade_stability_weight:number;macro_resilience_weight:number;payment_resilience_weight:number;volatility_ceiling_pp:number};
  export_economics:{existing_economics_weight:number;unit_value_weight:number;benchmark_ratio_ceiling:number};
  ranking:{minimum_available_base_weight:number;require_demand:boolean;require_growth_or_competition:boolean};
  confidence:{formula_version:string;/** Confidence decay per year the analysis window lags the preferred period. */recency_decay_per_year:number};
}

/**
 * WP2: Customs Atlas acquisition inside the deep Country Truth run (docs/35 E-004).
 *
 * Off by default. When enabled at request time the policy is frozen into the job payload, the
 * deep run acquires tariff evidence for its own shortlisted destinations, and tariff evidence is
 * admitted up to the run's tariff clock rather than the screen's as-of date (owner decision D-004).
 * With it off, payloads, fact manifests and assessments are byte-identical to the pre-WP2 path.
 */
export interface CountryTruthMarketAccessOrchestrationPolicy {
  policy_version: string;
  enabled: boolean;
  /** Origin every acquisition is requested for; Country Truth assesses Indian exports only. */
  origin_country: 'IN';
  /** Destinations beyond this count are recorded as skipped, never silently dropped. */
  max_destinations: number;
  /**
   * Ceiling for one LIVE fetch (UK, US). Release-backed sources read retained artifacts and are
   * not raced: abandoning one mid-decode would leave it running in the background.
   */
  live_fetch_timeout_ms: number;
}

/**
 * Phase 1H non-trade pillar policy.
 *
 * Every sub-policy carries its own formula/calculation version because a change to any of them
 * changes the meaning of a persisted score. `policy_version` names the bundle; the config row
 * version and this object's canonical hash together form the identity that a frozen assessment
 * records, so an Ops edit produces a NEW assessment rather than reinterpreting an old one.
 */
export interface CountryTruthPhase1HPolicy {
  policy_version: string;
  calculation_version: string;
  /** Schema version of the persisted CountryTruthFactSnapshot payload. */
  facts_schema_version: string;
  /**
   * Version of the supplemental India-origin unit-value statistic Phase 1H records in its own
   * fact manifest. It lives here, not in country_trade_metrics.policy, so revising it changes
   * Phase 1H manifest identity only and never a CountryTradeMetrics identity.
   */
  india_origin_unit_value_version: string;
  /**
   * Destinations whose reported import statistics are known to be valued CIF, and are therefore
   * comparable to a landed-cost buildup. Empty by default: a unit value whose valuation basis is
   * unrecorded is not published as a benchmark rather than being assumed CIF.
   */
  trade_statistical_import_valuation_by_country: Record<string, 'CIF' | 'FOB'>;
  market_access: MarketAccessV2Policy;
  export_economics: ExportEconomicsV3Policy;
  exporter_market_fit: ExporterMarketFitV3Policy;
  logistics_feasibility: LogisticsV3Policy;
}

/**
 * Guest-tier limits. These bound real money — an anonymous caller triggering an AI job
 * spends on every run — so they are business settings that Ops must be able to retune
 * under load without a deploy, exactly like fees and SLAs (docs/01 §2).
 */
export interface GuestPolicy {
  /** Discovery runs allowed per IP per window. */
  discovery_runs_per_ip: number;
  /**
   * Window length. Rolling rather than lifetime on purpose: Indian mobile carriers use
   * CGNAT, so one address fronts very large numbers of real users and a lifetime cap
   * would permanently lock out legitimate prospects in the primary market.
   */
  quota_window_hours: number;
  /** How long an unconverted guest org and its runs are retained before the purge job deletes them. */
  run_retention_days: number;
  /** Guest session lifetime. Longer than a login — it is a low-value credential. */
  session_days: number;
  /** Max rows a guest may page through, to blunt scraping of the buyer dataset. */
  max_buyer_results: number;
}

export type ConfigKey = keyof ConfigShape;

/**
 * Seed values only. docs/01 §2 "current/default assumption" column, plus the concrete
 * SLA starting values from AGT-07 (docs/13 E4).
 */
/**
 * Evidence authority multipliers. They reduce CONFIDENCE only — never a pillar score — so that
 * "we are less sure" can never be mistaken for "this market is worse". `unknown_legacy` is
 * pinned to zero because a row whose authorship was never recorded may not lend credibility.
 */
const PHASE_1H_ASSERTION_CONFIDENCE: Record<AssertionClass, number> = {
  authoritative_public: 1,
  // Our own fee under a versioned policy is not an uncertain observation of the world; it is a
  // definition. It still cannot raise a pillar on its own — it is one required component of many.
  system_derived: 1,
  agent_verified: 0.9,
  partner_quote: 0.8,
  exporter_declared: 0.7,
  // Deliberately 1, not a discount. The multipliers above grade how likely an assertion is to be
  // WRONG about the world: an exporter describing its own capacity (0.7) can be mistaken in a way
  // a government API response (1) cannot. Licensed content is not a weaker observation — it is the
  // authority's own published value, relayed under contract. The ways it actually degrades are
  // already modelled precisely elsewhere: staleness by the freshness policy, unproven regulatory
  // completeness by `completeness_status`, and HS6-only content by classification resolution.
  // Applying an invented 0.8 or 0.9 on top would double-count those, and would understate
  // confidence we genuinely have, which is its own dishonesty. The real control is binary and
  // lives in `licensed-providers.ts`: either an approval covers this provider, dataset,
  // destination and assertion type, or the fact is never admitted at all. If a provider's
  // transcription error rate is ever measured, a multiplier can be introduced from that evidence.
  licensed_authoritative_content: 1,
  unknown_legacy: 0,
};

// v4 accompanies country-truth-fact-selection-v4. The pillar formulas are still unchanged; the
// identity moves because route tenancy, frozen shipment basis and available-capacity selection
// changed which evidence can be admitted, and every earlier
// manifest must stay reproducible under exactly the rules that produced it.
const PHASE_1H_CALCULATION_VERSION = 'country-truth-phase-1h-v4';

const PHASE_1H_TARIFF_POLICY = {
  formula_version: 'applicable-india-tariff-v2',
  calculation_version: PHASE_1H_CALCULATION_VERSION,
  minimum_evidence_confidence: 50,
};

/**
 * Cost components already carried by an exporter price quoted at each Incoterm.
 *
 * DAP/DPU/DDP are listed deliberately even though they cannot currently be used: naming what
 * they bundle lets the calculation reject them with the real reason (the price already contains
 * post-customs cost that we refuse to invent a split for) instead of a vague "unknown Incoterm".
 */
const PHASE_1H_INCOTERM_COST_OWNERSHIP: CountryTruthPhase1HPolicy['export_economics']['incoterm_cost_ownership'] = {
  EXW: [],
  FCA: ['packaging', 'inland_transport'],
  FAS: ['packaging', 'inland_transport'],
  FOB: ['packaging', 'inland_transport', 'origin_charges'],
  CFR: ['packaging', 'inland_transport', 'origin_charges', 'international_freight'],
  CPT: ['packaging', 'inland_transport', 'origin_charges', 'international_freight'],
  CIF: ['packaging', 'inland_transport', 'origin_charges', 'international_freight', 'insurance'],
  CIP: ['packaging', 'inland_transport', 'origin_charges', 'international_freight', 'insurance'],
  DAP: ['packaging', 'inland_transport', 'origin_charges', 'international_freight', 'insurance', 'destination_charges'],
  DPU: ['packaging', 'inland_transport', 'origin_charges', 'international_freight', 'insurance', 'destination_charges'],
  DDP: ['packaging', 'inland_transport', 'origin_charges', 'international_freight', 'insurance', 'destination_charges'],
};

const PHASE_1H_DEFAULT_POLICY: CountryTruthPhase1HPolicy = {
  policy_version: 'country-truth-phase-1h-v4',
  calculation_version: PHASE_1H_CALCULATION_VERSION,
  facts_schema_version: 'country-truth-facts-v1',
  india_origin_unit_value_version: INDIA_ORIGIN_UNIT_VALUE_VERSION,
  trade_statistical_import_valuation_by_country: {},
  market_access: {
    formula_version: 'market-access-v2',
    calculation_version: PHASE_1H_CALCULATION_VERSION,
    assertion_class_multipliers: PHASE_1H_ASSERTION_CONFIDENCE,
    weights: { tariff: 60, regulatory: 40 },
    tariff_policy: PHASE_1H_TARIFF_POLICY,
    tariff_zero_score_percent: 25,
    requirement_penalties: { restriction: 25, mandatory_certification: 15, other_document: 5 },
    unresolved_obtainability_penalty: 10,
    maximum_requirement_age_days: 180,
    maximum_coverage_age_days: 30,
    // Licensed content is listed for Market Access only, and listing is not trust. A fact in that
    // class is created solely when `licensed-providers.ts` records an approval covering the
    // provider, dataset, destination and assertion type; with the registry empty no such fact can
    // exist, so this entry admits nothing today. The registry is the gate, this is the vocabulary.
    allowed_assertion_classes: ['authoritative_public', 'licensed_authoritative_content'],
  },
  export_economics: {
    formula_version: 'export-economics-v3',
    calculation_version: PHASE_1H_CALCULATION_VERSION,
    assertion_class_multipliers: PHASE_1H_ASSERTION_CONFIDENCE,
    tariff_policy: PHASE_1H_TARIFF_POLICY,
    incoterm_cost_ownership: PHASE_1H_INCOTERM_COST_OWNERSHIP,
    // Every component is required. A component left out of this list is added to the landed
    // cost as nothing at all, which is exactly the "missing becomes zero" defect — and it
    // biases the score OPTIMISTICALLY, because a cost we failed to record makes the market
    // look cheaper. Relaxing an entry here is a deliberate, versioned Ops decision.
    required_cost_components: [
      'packaging',
      'inland_transport',
      'origin_charges',
      'international_freight',
      'insurance',
      'destination_charges',
      'financing',
      'cleartrade_fee',
    ],
    allowed_price_assertion_classes: ['exporter_declared', 'agent_verified'],
    allowed_benchmark_assertion_classes: ['authoritative_public'],
    allowed_cost_assertion_classes: ['authoritative_public', 'system_derived', 'agent_verified', 'partner_quote', 'exporter_declared'],
    allowed_customs_basis_assertion_classes: ['authoritative_public'],
    // Deliberately empty. Ops must state a destination's valuation rule with a citation before
    // duty is taken on it; seeding a guess here would be indistinguishable from fabricated data.
    customs_valuation_basis_by_country: {},
    allowed_fx_assertion_classes: ['authoritative_public'],
    maximum_price_age_days: 180,
    // Customs statistics publish in arrears; the benchmark's age is measured from the end of
    // the period it describes, so this window has to admit the normal reporting lag.
    maximum_benchmark_age_days: 1100,
    maximum_cost_component_age_days: 90,
    maximum_customs_basis_age_days: 400,
    maximum_fx_age_days: 7,
    full_score_at_or_below_ratio: 0.9,
    zero_score_at_or_above_ratio: 1.6,
  },
  exporter_market_fit: {
    formula_version: 'exporter-market-fit-v3',
    calculation_version: PHASE_1H_CALCULATION_VERSION,
    assertion_class_multipliers: PHASE_1H_ASSERTION_CONFIDENCE,
    weights: { capacity: 20, moq: 15, production_lead_time: 15, price: 20, packaging: 10, certification: 20 },
    certification_scores: { held_documented: 100, held_undocumented: 70, in_progress: 40, not_started: 10, confirmed_absent: 0, expired: 5 },
    packaging_scores: { capability_matches: 100, capability_does_not_match: 20 },
    allowed_benchmark_assertion_classes: ['authoritative_public'],
    allowed_exporter_assertion_classes: ['exporter_declared', 'agent_verified'],
    allowed_fx_assertion_classes: ['authoritative_public'],
    maximum_benchmark_age_days: 365,
    maximum_exporter_fact_age_days: 365,
    maximum_fx_age_days: 7,
  },
  logistics_feasibility: {
    formula_version: 'logistics-feasibility-v3',
    calculation_version: PHASE_1H_CALCULATION_VERSION,
    assertion_class_multipliers: PHASE_1H_ASSERTION_CONFIDENCE,
    weights: { route_availability: 40, transit_time: 20, freight_burden: 25, handling_compatibility: 15 },
    route_available_score: 100,
    route_unavailable_score: 0,
    transit_zero_score_days: 90,
    freight_burden_zero_score_percent: 20,
    handling_scores: { supported: 100, unsupported: 20 },
    maximum_route_age_days: 30,
    maximum_freight_quote_age_days: 30,
    allowed_route_assertion_classes: ['authoritative_public', 'partner_quote'],
    allowed_freight_quote_assertion_classes: ['partner_quote', 'agent_verified'],
  },
};

export const CONFIG_DEFAULTS: ConfigShape = {
  'agent.capacity': { target_exporters_per_agent: 10 },
  'sla.thresholds': {
    default: { due_in_hours: 24, warning_in_hours: 18, escalate_after_hours: 24 },
    buyer_outreach_first_contact: { due_in_hours: 24, warning_in_hours: 16, escalate_after_hours: 24 },
    buyer_lead_follow_up: { due_in_hours: 48, warning_in_hours: 36, escalate_after_hours: 48 },
    exporter_document_approval: { due_in_hours: 48, warning_in_hours: 36, escalate_after_hours: 24 },
    agent_document_review: { due_in_hours: 8, warning_in_hours: 4, escalate_after_hours: 8 },
    cha_query: { due_in_hours: 4, warning_in_hours: 2, escalate_after_hours: 4 },
    exporter_input_request: { due_in_hours: 24, warning_in_hours: 18, escalate_after_hours: 24 },
    shipment_exception: { due_in_hours: 4, warning_in_hours: 2, escalate_after_hours: 4 },
    payment_overdue_follow_up: { due_in_hours: 24, warning_in_hours: 12, escalate_after_hours: 24 },
    dispute_response: { due_in_hours: 24, warning_in_hours: 12, escalate_after_hours: 24 },
  },
  'payout.eligibility': {
    require_payment_realized: true,
    require_deal_closed_won: false,
    require_no_open_dispute: true,
    approval_target_days: 14,
  },
  'documents.registry': [
    {
      doc_type: 'PI',
      label: 'Proforma invoice',
      technical_label: 'PI',
      default_owner_role: 'agent',
      approval_required: true,
      filing_applicable: false,
    },
    {
      doc_type: 'CI',
      label: 'Commercial invoice',
      technical_label: 'CI',
      default_owner_role: 'agent',
      approval_required: true,
      filing_applicable: false,
    },
    {
      doc_type: 'packing_list',
      label: 'Packing list',
      technical_label: 'Packing List',
      default_owner_role: 'agent',
      approval_required: true,
      filing_applicable: false,
    },
    {
      doc_type: 'shipping_bill_draft',
      label: 'Customs shipping bill (draft)',
      technical_label: 'Shipping Bill / ICEGATE filing',
      default_owner_role: 'agent',
      approval_required: true,
      filing_applicable: true,
    },
    {
      doc_type: 'COO_draft',
      label: 'Certificate of origin (draft)',
      technical_label: 'COO',
      default_owner_role: 'agent',
      approval_required: true,
      filing_applicable: true,
    },
    {
      doc_type: 'declaration',
      label: 'Export declaration',
      technical_label: 'Declaration',
      default_owner_role: 'agent',
      approval_required: true,
      filing_applicable: true,
    },
    {
      doc_type: 'insurance_declaration',
      label: 'Insurance declaration',
      technical_label: 'Insurance Declaration',
      default_owner_role: 'agent',
      approval_required: false,
      filing_applicable: false,
    },
    {
      doc_type: 'shipping_instructions',
      label: 'Shipping instructions',
      technical_label: 'Shipping Instructions',
      default_owner_role: 'agent',
      approval_required: true,
      filing_applicable: false,
    },
    {
      doc_type: 'vgm_declaration',
      label: 'VGM declaration',
      technical_label: 'Verified Gross Mass Declaration',
      default_owner_role: 'agent',
      approval_required: true,
      filing_applicable: false,
    },
    {
      doc_type: 'bill_of_exchange',
      label: 'Bill of exchange',
      technical_label: 'Bill of Exchange',
      default_owner_role: 'agent',
      approval_required: true,
      filing_applicable: false,
    },
    {
      doc_type: 'carrier_instructions',
      label: 'Carrier instructions',
      technical_label: 'B/L or AWB Instructions',
      default_owner_role: 'agent',
      approval_required: true,
      filing_applicable: false,
    },
    {
      doc_type: 'bank_collection_letter',
      label: 'Bank document presentation letter',
      technical_label: 'Collection / Presentation Cover Letter',
      default_owner_role: 'agent',
      approval_required: true,
      filing_applicable: false,
    },
  ],
  'uploads.policy': {
    max_size_mb: 25,
    allowed_mime_types: [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
    ],
  },
  'pagination.policy': { default_per_page: 25, max_per_page: 100 },
  // @deprecated — see the ConfigShape declaration above. Kept only so stored rows parse.
  'buyers.fit_score_weights': {
    country_match: 40,
    category_match: 30,
    verification: 20,
    import_recency: 10,
    min_display_score: 0,
  },
  'leads.outreach': { stale_after_days: 14, follow_up_due_in_hours: 48 },
  'guest.policy': {
    discovery_runs_per_ip: 2,
    quota_window_hours: 24,
    run_retention_days: 30,
    session_days: 30,
    max_buyer_results: 50,
  },
  'jobs.policy': {
    stale_after_seconds: 300,
    max_attempts: 3,
    retry_backoff_seconds: 15,
    worker_poll_interval_ms: 1000,
    client_poll_interval_ms: 1500,
  },
  'comtrade.policy': {
    request_timeout_ms: 20_000,
    evidence_cache_ttl_hours: 168,
    request_delay_ms: 2000,
    max_retries: 3,
    retry_backoff_ms: 2000,
    hs_codes_per_request: 50,
    daily_request_budget: 450,
    minimum_request_reserve: 100,
    chapter_priority: [
      '84', '85', '27', '30', '87', '71', '39', '29', '72', '73', '61', '62', '63', '09',
      '01', '02', '03', '04', '05', '06', '07', '08', '10', '11', '12', '13', '14', '15',
      '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '28', '31', '32',
      '33', '34', '35', '36', '37', '38', '40', '41', '42', '43', '44', '45', '46', '47',
      '48', '49', '50', '51', '52', '53', '54', '55', '56', '57', '58', '59', '60', '64',
      '65', '66', '67', '68', '69', '70', '74', '75', '76', '78', '79', '80', '81', '82',
      '83', '86', '88', '89', '90', '91', '92', '93', '94', '95', '96', '97', '99',
    ],
  },
  'country_evidence.policy': {
    policy_version: 'country-evidence-acquisition-v1',
    history_years: 5,
    annual_release_month_utc: 8,
    minimum_candidate_coverage_ratio: 0.8,
    latest_period_freshness_days: 90,
    closed_period_freshness_days: 3650,
    supplier_distribution_freshness_days: 90,
    supplier_coverage_min_ratio: 0.95,
    supplier_coverage_max_ratio: 1.05,
    india_partner_code: '699',
    world_partner_code: '0',
    all_suppliers_partner_code: 'all',
    candidate_strategy: 'explicit_candidates_v1',
    allow_partial_execution: false,
  },
  'country_period_selection.policy': {
    policy_version: 'country-period-selection-policy-v1',
    selection_rule: 'first_usable_walking_back_v1',
    annual_release_month_utc: 8,
    // discovery.scoring.confidence.accepted_reporting_lag_years
    max_fallback_lookback_years: 2,
    usable_cell_statuses: ['observed', 'observed_zero'],
    observed_zero_terminates_selection: true,
    suppressed_permits_fallback: false,
    incompatible_permits_fallback: true,
    provider_failure_permits_fallback: false,
    // discovery.scoring.recency_decay_per_year -> lag 0 = 1.0, lag 1 = 0.8, lag 2 = 0.64
    recency_decay_per_year: 0.8,
    freshness_states_by_lag: ['current', 'recent', 'aged'],
    beyond_lookback_state: 'stale',
    closed_period_freshness_days: 3650,
  },
  'country_screening.policy': {
    policy_version: 'country-screening-policy-v2',
    screening_stage: 'stage_a_global_demand_v1',
    universe_version: COUNTRY_SCREENING_UNIVERSE_VERSION,
    reporter_identity_strategy: 'comtrade_reporter_reference_v1',
    reporter_registry_version: COMTRADE_REPORTER_REGISTRY_VERSION,
    // Uninhabited or civilian-population-free territories cannot import commercially, and
    // XK/983 is an ISO user-assigned code the UN never assigned. Nothing else is removed:
    // a market with no authenticated evidence is reported as `unavailable`, not deleted.
    excluded_iso2_codes: {
      AQ: 'no_resident_population', BV: 'no_resident_population', GS: 'no_resident_population',
      HM: 'no_resident_population', IO: 'no_resident_population', TF: 'no_resident_population',
      UM: 'no_resident_population', XK: 'not_un_m49_identity',
    },
    exclude_origin_country: true,
    origin_country_iso2: 'IN',
    max_countries_per_run: 300,
    shortlist_target_size: 20,
    max_shortlist_size: 30,
    minimum_import_value_usd: 100_000,
    world_partner_code: WORLD_PARTNER,
    annual_release_month_utc: 8,
    period_fallback_lookback_years: 0,
    latest_period_freshness_days: 90,
    require_complete_evidence: true,
    required_parser_version: 'comtrade-parser-v2',
    required_normalization_version: 'comtrade-normalization-v2',
    screening_algorithm_version: COUNTRY_SCREENING_ALGORITHM_VERSION,
    demand_signal: { method: 'world_import_value_log10_v1', floor_usd: 100_000, ceiling_usd: 10_000_000_000 },
    tie_breaker: 'selection_score_desc_then_screening_score_desc_then_import_value_desc_then_period_lag_asc_then_reporter_code_asc_v2',
    period_selection_policy_version: 'country-period-selection-policy-v1',
    max_acquisition_attempts_per_country: 2,
    allow_partial_execution: false,
  },
  'country_trade_metrics.policy': {
    // Frozen at v1. The India-origin unit value Phase 1H needs is a SEPARATE supplemental
    // statistic (see calculateIndiaOriginUnitValues) precisely so that this identity — and
    // therefore every CountryTradeMetrics row Phase 1G has already validated — is unchanged.
    policy_version: 'country-trade-metrics-v1',
    calculation_version: 'country-trade-calculator-v1',
    expected_history_years: 5,
    cagr_method: 'endpoint_geometric_v1',
    recent_momentum_method: 'latest_year_simple_growth_v1',
    india_share_method: 'india_over_world_percent_v1',
    india_share_trend_method: 'ols_slope_and_endpoint_pp_v1',
    supplier_hhi_method: 'sum_normalized_supplier_share_squared_v1',
    supplier_coverage_min_ratio: 0.95,
    supplier_coverage_max_ratio: 1.05,
    require_mappable_supplier_country: true,
    volatility_method: 'population_stddev_simple_annual_growth_v1',
    minimum_volatility_observations: 4,
    unit_value_preference: 'net_weight_then_compatible_quantity_v1',
    weight_based_hs_chapters: ['01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','25','26','27','28','29','30','31','32','33','34','35','36','37','38','39','40','41','42','43','44','45','46','47','48','50','51','52','53','54','55','56','57','58','59','60','61','62','63','68','69','70','71','72','73','74','75','76','78','79','80','81','82','83'],
    accepted_quantity_units_by_hs_chapter: {'09':['kg']},
    minimum_unit_value_observations: 3,
    unit_value_low_percentile: 0.1,
    unit_value_high_percentile: 0.9,
    unit_value_outlier_method: 'tukey_1_5_iqr_v1',
    stale_input_behavior: 'metric_stale',
    zero_value_behavior: 'explicit_zero_only',
  },
  'country_truth.scoring_v4': {
    model_version:'market-attractiveness-v4',formula_version:'country-truth-scoring-v4',
    base_component_weights:{demand_strength:25,growth_momentum:10,competitive_opportunity:10,market_access:10,export_economics:15,exporter_market_fit:15,logistics_feasibility:10,risk_resilience:5},
    demand:{method:'absolute_log10_usd_v1',floor_usd:100_000,ceiling_usd:10_000_000_000},
    growth:{cagr_weight:70,recent_momentum_weight:30,floor_percent:-20,ceiling_percent:20},
    competition:{hhi_weight:50,india_share_weight:30,india_share_trend_weight:20,trend_floor_pp_per_year:-5,trend_ceiling_pp_per_year:5},
    risk:{trade_stability_weight:60,macro_resilience_weight:20,payment_resilience_weight:20,volatility_ceiling_pp:50},
    export_economics:{existing_economics_weight:80,unit_value_weight:20,benchmark_ratio_ceiling:2},
    ranking:{minimum_available_base_weight:45,require_demand:true,require_growth_or_competition:true},
    confidence:{formula_version:'weighted_component_evidence_coverage_and_recency_v5',recency_decay_per_year:0.8},
  },
  'country_truth.phase_1h': PHASE_1H_DEFAULT_POLICY,
  'country_truth.market_access_orchestration': {
    policy_version: 'market-access-orchestration-v1',
    enabled: false,
    origin_country: 'IN',
    max_destinations: 30,
    live_fetch_timeout_ms: 60_000,
  },
  'discovery.scoring': {
    model_version: 'market-attractiveness-v3',
    base_weights: { demand_strength: 25, growth_momentum: 10, competitive_opportunity: 10, market_access: 10, export_economics: 15, exporter_market_fit: 15, logistics_feasibility: 10, risk_resilience: 5 },
    archetype_profiles: {
      agriculture_food: { version: 1, hs_chapters: ['01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24'], weights: { demand_strength: 25, growth_momentum: 10, competitive_opportunity: 10, market_access: 10, export_economics: 15, exporter_market_fit: 15, logistics_feasibility: 10, risk_resilience: 5 } },
      chemicals_pharma: { version: 1, hs_chapters: ['28','29','30','31','32','33','34','35','36','37','38'], weights: { demand_strength: 25, growth_momentum: 10, competitive_opportunity: 10, market_access: 10, export_economics: 15, exporter_market_fit: 15, logistics_feasibility: 10, risk_resilience: 5 } },
      plastics_rubber: { version: 1, hs_chapters: ['39','40'], weights: { demand_strength: 25, growth_momentum: 10, competitive_opportunity: 10, market_access: 10, export_economics: 15, exporter_market_fit: 15, logistics_feasibility: 10, risk_resilience: 5 } },
      leather_wood_paper: { version: 1, hs_chapters: ['41','42','43','44','45','46','47','48','49'], weights: { demand_strength: 25, growth_momentum: 10, competitive_opportunity: 10, market_access: 10, export_economics: 15, exporter_market_fit: 15, logistics_feasibility: 10, risk_resilience: 5 } },
      textiles_apparel: { version: 1, hs_chapters: ['50','51','52','53','54','55','56','57','58','59','60','61','62','63'], weights: { demand_strength: 25, growth_momentum: 10, competitive_opportunity: 10, market_access: 10, export_economics: 15, exporter_market_fit: 15, logistics_feasibility: 10, risk_resilience: 5 } },
      minerals_metals: { version: 1, hs_chapters: ['25','26','27','68','69','70','71','72','73','74','75','76','78','79','80','81','82','83'], weights: { demand_strength: 25, growth_momentum: 10, competitive_opportunity: 10, market_access: 10, export_economics: 15, exporter_market_fit: 15, logistics_feasibility: 10, risk_resilience: 5 } },
      machinery_electrical: { version: 1, hs_chapters: ['84','85'], weights: { demand_strength: 25, growth_momentum: 10, competitive_opportunity: 10, market_access: 10, export_economics: 15, exporter_market_fit: 15, logistics_feasibility: 10, risk_resilience: 5 } },
      transport: { version: 1, hs_chapters: ['86','87','88','89'], weights: { demand_strength: 25, growth_momentum: 10, competitive_opportunity: 10, market_access: 10, export_economics: 15, exporter_market_fit: 15, logistics_feasibility: 10, risk_resilience: 5 } },
      instruments_furniture: { version: 1, hs_chapters: ['90','91','92','94','95','96'], weights: { demand_strength: 25, growth_momentum: 10, competitive_opportunity: 10, market_access: 10, export_economics: 15, exporter_market_fit: 15, logistics_feasibility: 10, risk_resilience: 5 } },
      general: { version: 1, hs_chapters: [], weights: { demand_strength: 25, growth_momentum: 10, competitive_opportunity: 10, market_access: 10, export_economics: 15, exporter_market_fit: 15, logistics_feasibility: 10, risk_resilience: 5 } },
    },
    volume_floor_usd: 250_000,
    growth_window_years: 5,
    recency_decay_per_year: 0.8,
    rationale_top_n: 5,
    demand: { formula_version:'demand-strength-v3',share_metric:'candidate_market_share',value_weight:60,share_weight:20,buyer_depth_weight:20 },
    competition: { formula_version:'competitive-opportunity-v3',hhi_weight:70,india_share_weight:30,minimum_supplier_coverage_ratio:0.95,maximum_supplier_coverage_ratio:1.05,minimum_partner_count:2,coverage_policy_version:'supplier-coverage-v1' },
    confidence: { formula_version:'assessment-confidence-v3',freshness_policy_version:'comtrade-reporting-lag-v1',accepted_reporting_lag_years:2,stale_after_lag_years:5,recency_weight:35,reporting_completeness_weight:35,buyer_coverage_weight:15,missingness_weight:15 },
    market_access: { formula_version:'market-access-v1',tariff_weight:70,regulatory_weight:30,tariff_ceiling_percent:25,certification_penalty:20,restriction_penalty:15,non_tariff_penalty:10,max_snapshot_age_days:7 },
    export_economics: { formula_version:'export-economics-v1',india_price_weight:45,market_price_weight:35,tariff_weight:20,tariff_ceiling_percent:25,minimum_price_observations:1 },
    logistics: { formula_version:'logistics-feasibility-v1',route_weight:35,transit_weight:25,burden_weight:25,compatibility_weight:15,max_age_days:30,freight_burden_ceiling_percent:20 },
    risk_resilience: { formula_version:'risk-resilience-v1',demand_stability_weight:60,macro_resilience_weight:20,payment_resilience_weight:20,minimum_trade_years:4,max_trade_lag_years:3,max_signal_age_days:180,growth_volatility_ceiling:0.5 },
    exporter_market_fit: { formula_version:'exporter-market-fit-v1',order_size_weight:20,capacity_moq_weight:20,certification_weight:25,lead_time_weight:15,customization_weight:10,packaging_weight:10,max_benchmark_age_days:365 },
  },
  'market_estimate.policy': {
    top_n_markets: 5,
    volume_floor_usd: 250_000,
    quantity_band_breakpoints: [100, 1_000, 10_000],
  },
  'billing.plans': DEFAULT_PLAN_PRICING,
  'demand_discovery.v5': {
    enabled: true,
    auto_start_on_classification: true,
    comtrade_newest_year: true,
    comtrade_market_fallback: true,
    comtrade_max_records: 100_000,
    fx_max_lookback_days: 7,
    fx_fetch_missing: true,
    fx_treasury_fallback: true,
    fx_treasury_max_lookback_days: 120,
    tariff_acquisition: true,
    tariff_live_fetch_timeout_ms: 60_000,
    policy: DEMAND_DISCOVERY_V5_DEFAULT_POLICY,
  },
  'market_access.authority_refresh': {
    singapore: { enabled: false, actor_email: null, activate_first_release: true, activate_changed_tariff: false, max_attempts_per_window: 3, minutes_between_attempts: 30 },
  },
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Read the active version of a config key. Falls back to the seed default only when the
 * row is missing, so a fresh environment still boots — a production deployment should
 * fail its config check rather than silently run on defaults.
 */
export async function getConfig<K extends ConfigKey>(key: K): Promise<ConfigShape[K]> {
  const row = await prisma.configSetting.findFirst({
    where: { key, is_active: true },
    orderBy: { version: 'desc' },
  });
  if (!row) return CONFIG_DEFAULTS[key];
  // Additive provider controls must remain safe when an older versioned config row is
  // still active during deployment. Explicit stored values continue to win.
  if (key === 'comtrade.policy') {
    return { ...CONFIG_DEFAULTS['comtrade.policy'], ...(row.value as object) } as ConfigShape[K];
  }
  if (key === 'country_evidence.policy') {
    return { ...CONFIG_DEFAULTS['country_evidence.policy'], ...(row.value as object) } as ConfigShape[K];
  }
  if (key === 'country_period_selection.policy') {
    return { ...CONFIG_DEFAULTS['country_period_selection.policy'], ...(row.value as object) } as ConfigShape[K];
  }
  if (key === 'country_screening.policy') {
    const defaults=CONFIG_DEFAULTS['country_screening.policy'],stored=row.value as Partial<CountryScreeningPolicy>;
    return {...defaults,...stored,excluded_iso2_codes:{...defaults.excluded_iso2_codes,...(stored.excluded_iso2_codes??{})},demand_signal:{...defaults.demand_signal,...(stored.demand_signal??{})}} as ConfigShape[K];
  }
  if (key === 'country_trade_metrics.policy') {
    return { ...CONFIG_DEFAULTS['country_trade_metrics.policy'], ...(row.value as object) } as ConfigShape[K];
  }
  if (key === 'country_truth.scoring_v4') {
    const defaults=CONFIG_DEFAULTS['country_truth.scoring_v4'],stored=row.value as Partial<CountryTruthScoringV4Policy>;
    return {...defaults,...stored,base_component_weights:{...defaults.base_component_weights,...(stored.base_component_weights??{})},demand:{...defaults.demand,...(stored.demand??{})},growth:{...defaults.growth,...(stored.growth??{})},competition:{...defaults.competition,...(stored.competition??{})},risk:{...defaults.risk,...(stored.risk??{})},export_economics:{...defaults.export_economics,...(stored.export_economics??{})},ranking:{...defaults.ranking,...(stored.ranking??{})},// A stored row predating the recency term has no decay key. Taking the whole confidence block
    // from defaults keeps `formula_version` and the arithmetic describing the same thing.
    confidence:(stored.confidence&&'recency_decay_per_year' in stored.confidence)?{...defaults.confidence,...stored.confidence}:defaults.confidence} as ConfigShape[K];
  }
  if (key === 'country_truth.phase_1h') {
    // Each pillar block is merged whole-field over defaults so a stored row written before a
    // new knob existed still yields a complete, hashable policy rather than an undefined field
    // that would silently disable a guard.
    const defaults=CONFIG_DEFAULTS['country_truth.phase_1h'],stored=row.value as Partial<CountryTruthPhase1HPolicy>;
    return {
      ...defaults,
      ...stored,
      market_access:{...defaults.market_access,...(stored.market_access??{})},
      export_economics:{...defaults.export_economics,...(stored.export_economics??{})},
      exporter_market_fit:{...defaults.exporter_market_fit,...(stored.exporter_market_fit??{})},
      logistics_feasibility:{...defaults.logistics_feasibility,...(stored.logistics_feasibility??{})},
    } as ConfigShape[K];
  }
  if (key === 'demand_discovery.v5') {
    // A stored row replaces the policy whole when it carries one: a partial policy would hash as
    // a version nobody wrote. Switches merge over defaults so an older row stays complete.
    const defaults = CONFIG_DEFAULTS['demand_discovery.v5'], stored = row.value as Partial<DemandDiscoveryV5Config>;
    return { ...defaults, ...stored, policy: stored.policy ?? defaults.policy } as ConfigShape[K];
  }
  if (key === 'country_truth.market_access_orchestration') {
    return { ...CONFIG_DEFAULTS['country_truth.market_access_orchestration'], ...(row.value as object) } as ConfigShape[K];
  }
  if (key === 'market_access.authority_refresh') {
    const defaults = CONFIG_DEFAULTS['market_access.authority_refresh'], stored = row.value as Partial<AuthorityRefreshConfig>;
    return { ...defaults, ...stored, singapore: { ...defaults.singapore, ...(stored.singapore ?? {}) } } as ConfigShape[K];
  }
  if (key === 'documents.registry') {
    const stored = row.value as unknown as DocTypeRegistryEntry[];
    const storedTypes = new Set(stored.map((entry) => entry.doc_type));
    return [
      ...stored,
      ...CONFIG_DEFAULTS['documents.registry'].filter((entry) => !storedTypes.has(entry.doc_type)),
    ] as ConfigShape[K];
  }
  if (key === 'discovery.scoring') {
    const stored=row.value as Partial<DiscoveryScoringPolicy>;
    if(!stored.base_weights)return CONFIG_DEFAULTS['discovery.scoring'] as ConfigShape[K];
    const defaults=CONFIG_DEFAULTS['discovery.scoring'];
    return {
      ...defaults,
      ...stored,
      demand:{...defaults.demand,...(stored.demand??{})},
      competition:{...defaults.competition,...(stored.competition??{})},
      confidence:{...defaults.confidence,...(stored.confidence??{})},
      market_access:{...defaults.market_access,...(stored.market_access??{})},
      export_economics:{...defaults.export_economics,...(stored.export_economics??{})},
      logistics:{...defaults.logistics,...(stored.logistics??{})},
      risk_resilience:{...defaults.risk_resilience,...(stored.risk_resilience??{})},
      exporter_market_fit:{...defaults.exporter_market_fit,...(stored.exporter_market_fit??{})},
    } as ConfigShape[K];
  }
  return row.value as ConfigShape[K];
}

export async function getConfigWithVersion<K extends ConfigKey>(key: K): Promise<{ value: ConfigShape[K]; version: number }> {
  const row = await prisma.configSetting.findFirst({ where: { key, is_active: true }, orderBy: { version: 'desc' } });
  const value = await getConfig(key);
  return { value, version: row?.version ?? 1 };
}

export interface FeePolicySnapshot {
  version: number;
  commitment_fee: Money;
  commitment_fee_status: string;
  success_fee_rate: string;
  small_shipment_threshold: Money;
  small_shipment_rate: string;
  small_shipment_flat: Money;
  agent_share_rate: string;
  minimum_shipment: Money;
  effective_from: string;
}

/** The fee policy in force right now. Snapshotted onto a Deal at lock time. */
export async function getFeePolicy(): Promise<FeePolicySnapshot> {
  const policy = await prisma.feePolicy.findFirst({
    where: { is_active: true },
    orderBy: { version: 'desc' },
  });
  if (!policy) {
    throw new Error(
      'No active FeePolicy. Run `npm run db:seed` — fee terms must never fall back to a hardcoded constant.',
    );
  }
  return {
    version: policy.version,
    commitment_fee: {
      amount: policy.commitment_fee_amount.toString(),
      currency: policy.commitment_fee_currency,
    },
    commitment_fee_status: policy.commitment_fee_status,
    success_fee_rate: policy.success_fee_rate.toString(),
    small_shipment_threshold: {
      amount: policy.small_shipment_threshold_amount.toString(),
      currency: policy.small_shipment_threshold_currency,
    },
    small_shipment_rate: policy.small_shipment_rate.toString(),
    small_shipment_flat: {
      amount: policy.small_shipment_flat_amount.toString(),
      currency: policy.small_shipment_flat_amount ? policy.small_shipment_threshold_currency : 'INR',
    },
    agent_share_rate: policy.agent_share_rate.toString(),
    minimum_shipment: {
      amount: policy.minimum_shipment_amount.toString(),
      currency: policy.minimum_shipment_currency,
    },
    effective_from: policy.effective_from.toISOString(),
  };
}

/**
 * Fee calculation returns source amount, rate AND result — docs/01 §2 requires the UI to
 * render the quoted terms rather than recalculate them.
 */
export interface FeeCalculation {
  basis: Money;
  rule: 'success_fee' | 'small_shipment_rate' | 'small_shipment_flat';
  rate?: string;
  result: Money;
  policy_version: number;
}

export async function calculateSuccessFee(shipmentValue: Money): Promise<FeeCalculation> {
  const policy = await getFeePolicy();
  const value = Number(shipmentValue.amount);
  const threshold = Number(policy.small_shipment_threshold.amount);

  // Below the small-shipment threshold the policy is "rate or flat, whichever is greater".
  if (shipmentValue.currency === policy.small_shipment_threshold.currency && value < threshold) {
    const byRate = value * Number(policy.small_shipment_rate);
    const flat = Number(policy.small_shipment_flat.amount);
    return byRate >= flat
      ? {
          basis: shipmentValue,
          rule: 'small_shipment_rate',
          rate: policy.small_shipment_rate,
          result: { amount: byRate.toFixed(2), currency: shipmentValue.currency },
          policy_version: policy.version,
        }
      : {
          basis: shipmentValue,
          rule: 'small_shipment_flat',
          result: { amount: flat.toFixed(2), currency: policy.small_shipment_flat.currency },
          policy_version: policy.version,
        };
  }

  return {
    basis: shipmentValue,
    rule: 'success_fee',
    rate: policy.success_fee_rate,
    result: {
      amount: (value * Number(policy.success_fee_rate)).toFixed(2),
      currency: shipmentValue.currency,
    },
    policy_version: policy.version,
  };
}

/** Resolve pagination params against the configured policy — no magic numbers in handlers. */
export async function resolvePagination(params: {
  page?: string | number | null;
  per_page?: string | number | null;
}): Promise<{ page: number; per_page: number; skip: number; take: number }> {
  const policy = await getConfig('pagination.policy');
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const requested = Number(params.per_page ?? policy.default_per_page) || policy.default_per_page;
  const per_page = Math.min(Math.max(1, requested), policy.max_per_page);
  return { page, per_page, skip: (page - 1) * per_page, take: per_page };
}

/** Problems with a `market_access.authority_refresh` value, empty when valid (config API and script). */
export function authorityRefreshConfigProblems(value: unknown): string[] {
  const config = value as Partial<AuthorityRefreshConfig> | null;
  if (!config || typeof config !== 'object' || Array.isArray(config)) return ['The value must be an object.'];
  const sg = config.singapore as Partial<AuthorityRefreshConfig['singapore']> | undefined;
  if (!sg || typeof sg !== 'object' || Array.isArray(sg)) return ['singapore must be an object.'];
  const problems: string[] = [];
  for (const field of ['enabled', 'activate_first_release', 'activate_changed_tariff'] as const) {
    if (sg[field] !== undefined && typeof sg[field] !== 'boolean') problems.push(`singapore.${field} must be true or false.`);
  }
  if (sg.actor_email !== undefined && sg.actor_email !== null && (typeof sg.actor_email !== 'string' || !/^[^@\s]+@[^@\s]+$/.test(sg.actor_email))) problems.push('singapore.actor_email must be an email address or null.');
  if (sg.enabled === true && !sg.actor_email) problems.push('singapore.actor_email is required when the refresh is enabled.');
  if (sg.max_attempts_per_window !== undefined && (!Number.isInteger(sg.max_attempts_per_window) || sg.max_attempts_per_window < 1 || sg.max_attempts_per_window > 6)) problems.push('singapore.max_attempts_per_window must be a whole number from 1 to 6.');
  if (sg.minutes_between_attempts !== undefined && (!Number.isInteger(sg.minutes_between_attempts) || sg.minutes_between_attempts < 10 || sg.minutes_between_attempts > 120)) problems.push('singapore.minutes_between_attempts must be a whole number from 10 to 120.');
  return problems;
}

/**
 * Problems with a stored `country_truth.market_access_orchestration` value, empty when valid.
 * Used by the config API before a version is written and by the deep request before a policy is
 * frozen into a job, so a malformed switch fails loudly instead of half-enabling acquisition.
 */
export function marketAccessOrchestrationPolicyProblems(value: unknown): string[] {
  const policy = value as Partial<CountryTruthMarketAccessOrchestrationPolicy> | null;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return ['The policy must be an object.'];
  const problems: string[] = [];
  if (typeof policy.policy_version !== 'string' || !policy.policy_version.trim()) problems.push('policy_version must be a non-empty string.');
  if (typeof policy.enabled !== 'boolean') problems.push('enabled must be true or false.');
  if (policy.origin_country !== 'IN') problems.push('origin_country must be IN.');
  if (!Number.isInteger(policy.max_destinations) || policy.max_destinations! < 1 || policy.max_destinations! > 100) problems.push('max_destinations must be a whole number from 1 to 100.');
  if (!Number.isInteger(policy.live_fetch_timeout_ms) || policy.live_fetch_timeout_ms! < 1_000 || policy.live_fetch_timeout_ms! > 300_000) problems.push('live_fetch_timeout_ms must be a whole number from 1000 to 300000.');
  return problems;
}

/**
 * Config keys that exist in the shape but must never be presented as live settings.
 *
 * `buyers.fit_score_weights` is read by nothing: the BuyerFit scorer combines
 * volume/price/certification/outcome as an unweighted mean, while this key lists
 * country/category/verification/recency from an earlier model. It stayed in the Ops console
 * long enough that an operator could have edited it and reasonably believed they had retuned
 * BuyerFit scoring — a control that silently does nothing is worse than no control.
 *
 * Exported so both the editable-key allowlist and its guarding test read the same source, and
 * so adding a key here is all that is needed to retire another one safely.
 */
export const DEPRECATED_CONFIG_KEYS = ['buyers.fit_score_weights'] as const satisfies readonly ConfigKey[];

export function isDeprecatedConfigKey(key: string): boolean {
  return (DEPRECATED_CONFIG_KEYS as readonly string[]).includes(key);
}

/**
 * Config keys the Ops console offers as live, tunable settings.
 *
 * Derived from the editable set minus anything deprecated, so a retired key cannot reappear in
 * the console by being forgotten in a second hand-maintained list. Exported so the page and its
 * test read the same value — a test that greps the page source for a key name would match the
 * comment explaining why the key is absent.
 */
export const OPS_TUNABLE_CONFIG_KEYS: readonly ConfigKey[] = ([
  'agent.capacity',
  'sla.thresholds',
  'payout.eligibility',
  'documents.registry',
  'uploads.policy',
  'pagination.policy',
  'buyers.fit_score_weights',
  'leads.outreach',
  'guest.policy',
  'jobs.policy',
  'billing.plans',
] as const).filter((key) => !isDeprecatedConfigKey(key));
