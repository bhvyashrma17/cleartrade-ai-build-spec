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
import type { Money } from '@/types';

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
  'discovery.scoring': DiscoveryScoringPolicy;
  'market_estimate.policy': MarketEstimatePolicy;
}

/**
 * Pre-membership market estimate — the public, no-LLM surface described in docs/14 §3
 * (`market_estimate.run`, guest tier). Deliberately tiny compared to `discovery.scoring`:
 * this reads the warehouse and reports observed history, it does not rank or score
 * anything, so there are no weights here — only how much to show and how to bucket the
 * cache key.
 */
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
  /** Highest-value chapters first; the full ingest script consumes this exact order. */
  chapter_priority: string[];
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
    request_delay_ms: 2000,
    max_retries: 3,
    retry_backoff_ms: 2000,
    hs_codes_per_request: 50,
    daily_request_budget: 450,
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
] as const).filter((key) => !isDeprecatedConfigKey(key));
