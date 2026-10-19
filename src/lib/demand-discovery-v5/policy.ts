/**
 * Demand Discovery v5 policy (docs/36). Every number the score uses lives here, is frozen into
 * each run with its hash, and changes only through a new policy version — never by editing the
 * values a past run was computed with.
 */
import { createHash } from 'node:crypto';

export const DEMAND_DISCOVERY_V5_MODEL = 'market-opportunity-v5';

export type MetricKey =
  | 'market_size' | 'growth' | 'stability'
  | 'india_foothold' | 'price_headroom' | 'openness'
  | 'duty' | 'distance_fit' | 'logistics'
  | 'country_risk'
  | 'price_fit' | 'volume_fit';

export type PartKey = 'demand' | 'india_opportunity' | 'access' | 'risk' | 'exporter_fit';

export interface DemandDiscoveryV5Policy {
  policy_version: string;
  model_version: typeof DEMAND_DISCOVERY_V5_MODEL;
  /** Points per metric (D-012). They sum to 100. */
  points: Record<MetricKey, number>;
  parts: Record<PartKey, MetricKey[]>;
  window_years: number;
  size: { average_years: number; floor_usd: number };
  growth: { cagr_weight: number; momentum_weight: number; floor_percent: number; ceiling_percent: number };
  stability: { minimum_rates: number; ceiling_pp: number };
  foothold: { share_weight: number; trend_weight: number; zero_share_score: number; full_share_percent: number; trend_floor_pp_per_year: number; trend_ceiling_pp_per_year: number; minimum_trend_points: number };
  prices: { neutral_ratio: number; full_ratio: number; minimum_suppliers_with_quantity: number; outlier_iqr_multiple: number };
  openness: { supplier_coverage_min: number; supplier_coverage_max: number };
  /**
   * `official_minimum_confidence`: the evidence confidence (percent) an official tariff row needs,
   * the deep assessment's own minimum (`country_truth.phase_1h` tariff policy).
   * `score_india_preference` (v6, D-026): score India's published preference, when it is not a
   * tariff quota, instead of the ordinary rate (`official-duty.ts`).
   */
  duty: { ceiling_percent: number; comprehensive_agreement_factor: number; partial_agreement_factor: number; primary_hs_chapters_through: number; official_minimum_confidence: number; score_india_preference: boolean };
  distance: { minimum_weight_covered: number };
  /** `lsci_fallback_minimum_pairs` (v5): markets with both LPI and LSCI needed before the LSCI estimate is used (`logistics-fallback.ts`). */
  logistics: { lpi_min: number; lpi_max: number; lsci_fallback_minimum_pairs: number };
  /**
   * D-021 (R-20): a World Bank value older than `max_age_years` on the run's date counts as missing.
   * Applies to the logistics index and both tariff averages, which countries report irregularly.
   */
  world_bank: { max_age_years: number };
  /**
   * Markets in a customs union whose common external tariff stands in for a World Bank average the
   * market lacks: the estimate uses `reference_market`'s average, for `hs_chapters` only when the
   * union covers part of the tariff. Each entry names its legal basis.
   */
  customs_unions: Record<string, { union: string; reference_market: string; hs_chapters?: [number, number]; basis: string }>;
  /**
   * Markets whose duty on imports follows from a published rule rather than a tariff line: free
   * ports that charge no customs duty except on listed goods, and markets with one rate for all
   * goods. A rule covers the product unless its HS code starts with one of `except_hs` (the goods the
   * rule leaves out: there the market's own tariff applies, so the duty falls back to the
   * estimate). Official tariff evidence for the line, when usable, always comes first. After
   * `review_by` a rule is not applied until it is checked again. Each entry names its source.
   */
  rule_rates: Record<string, { duty_percent: number; except_hs: string[]; rule: string; basis: string; source_url: string; checked_on: string; review_by: string }>;
  risk: { grade_scores: Record<string, number>; restricted_group_i_cap: number; restricted_group_ii_cap: number };
  volume: { full_share: number; zero_share: number; minimum_quantity_coverage: number };
  ranking: { minimum_live_points: number; required_metrics: MetricKey[]; handoff_count: number };
  confidence: { recency_decay_per_year: number };
  /** §5.3: a newest-year change beyond this factor either way is treated as a provisional-data error. */
  chain_link: { max_change_ratio: number };
  quality: { baci_market_reported: number; baci_partner_only: number; comtrade_fallback: number; chain_linked: number; duty_estimate: number; logistics_lpi: number; logistics_lsci_estimate: number; official: number; official_agent_recorded: number; official_common_tariff: number };
  hs_revision: { max_total_divergence: number };
  labels: { big_size_score: number; big_growth_score: number; india_sells_share_percent: number; pays_above_ratio: number; low_duty_percent: number; hub_reexport_ratio: number };
  /** Markets excluded outright (D-016): comprehensive UN sanctions. */
  excluded_markets: Record<string, string>;
}

export const DEMAND_DISCOVERY_V5_DEFAULT_POLICY: DemandDiscoveryV5Policy = {
  // v2 (13 Oct 2026): adds duty.official_minimum_confidence for Customs Atlas duty. No run used v1.
  // v3 (14 Oct 2026): adds world_bank.max_age_years = 10 (D-021, R-20).
  // v4 (14 Oct 2026): adds customs_unions — duty estimates from a union's common external tariff.
  // v5 (17 Oct 2026): adds rule_rates — free ports and one-rate markets (D-024) — the quality of an
  // official line an agent read (D-024) and the logistics estimate from shipping connectivity where
  // no LPI exists (D-025). No run used v4.
  // v6 (18 Oct 2026): duty.score_india_preference — India's published preference, when it is not a
  // tariff quota, is scored instead of the ordinary rate (D-026).
  //     v6 also carries quality.official_common_tariff (D-028): a customs union's common external
  //     tariff read as the official rate for a member, below full quality because national
  //     exceptions are not modelled. No run used v6 before this was added.
  policy_version: 'demand-discovery-v5-policy-v6',
  model_version: DEMAND_DISCOVERY_V5_MODEL,
  points: {
    market_size: 20, growth: 10, stability: 5,
    india_foothold: 10, price_headroom: 10, openness: 5,
    duty: 10, distance_fit: 5, logistics: 5,
    country_risk: 10,
    price_fit: 5, volume_fit: 5,
  },
  parts: {
    demand: ['market_size', 'growth', 'stability'],
    india_opportunity: ['india_foothold', 'price_headroom', 'openness'],
    access: ['duty', 'distance_fit', 'logistics'],
    risk: ['country_risk'],
    exporter_fit: ['price_fit', 'volume_fit'],
  },
  window_years: 6,
  size: { average_years: 3, floor_usd: 100_000 },
  growth: { cagr_weight: 70, momentum_weight: 30, floor_percent: -20, ceiling_percent: 20 },
  stability: { minimum_rates: 4, ceiling_pp: 50 },
  foothold: { share_weight: 70, trend_weight: 30, zero_share_score: 40, full_share_percent: 10, trend_floor_pp_per_year: -5, trend_ceiling_pp_per_year: 5, minimum_trend_points: 3 },
  prices: { neutral_ratio: 1, full_ratio: 1.5, minimum_suppliers_with_quantity: 3, outlier_iqr_multiple: 1.5 },
  openness: { supplier_coverage_min: 0.95, supplier_coverage_max: 1.05 },
  duty: { ceiling_percent: 25, comprehensive_agreement_factor: 0.5, partial_agreement_factor: 0.8, primary_hs_chapters_through: 27, official_minimum_confidence: 50, score_india_preference: true },
  distance: { minimum_weight_covered: 0.8 },
  logistics: { lpi_min: 1, lpi_max: 5, lsci_fallback_minimum_pairs: 30 },
  world_bank: { max_age_years: 10 },
  // Every EU member carries the same World Bank value for the common external tariff; Germany's stands in.
  customs_unions: {
    LU: { union: 'EU', reference_market: 'DE', basis: 'EU member state: the common customs tariff applies (Council Regulation (EEC) No 2658/87).' },
    MQ: { union: 'EU', reference_market: 'DE', basis: 'French overseas department, inside the Union customs territory (Regulation (EU) No 952/2013, Art. 4).' },
    SM: { union: 'EU', reference_market: 'DE', basis: 'Customs union with the EU (Agreement on Cooperation and Customs Union, in force 1 April 2002).' },
    AD: { union: 'EU', reference_market: 'DE', hs_chapters: [25, 97], basis: 'Customs union with the EU for HS chapters 25–97 only (EEC–Andorra Agreement, 1990).' },
  },
  // Each rule was read from the named official page on 14 Oct 2026. Excepted goods fall back to the estimate.
  rule_rates: {
    HK: {
      duty_percent: 0, except_hs: ['22', '24', '27', '290511', '87'],
      rule: 'Hong Kong is a free port: only liquor, tobacco, hydrocarbon oil, methyl alcohol and motor vehicles are taxed on import.',
      basis: "Customs and Excise Department: 'In general, imports into HKSAR are tax-free' except motor vehicles (first registration tax) and the four dutiable commodities (Dutiable Commodities Ordinance, Cap. 109).",
      source_url: 'https://www.customs.gov.hk/en/service-enforcement-information/cargo-clearance/faqs/index.html', checked_on: '2026-10-14', review_by: '2027-10-14',
    },
    MO: {
      duty_percent: 0, except_hs: ['22', '24', '87'],
      rule: 'Macao is a free port: only tobacco, strong alcoholic drinks and motor vehicles are taxed on import.',
      basis: "Macao Trade and Investment Promotion Institute: 'No duties are levied on imported goods'; consumption tax applies to tobacco and to alcoholic beverages of 30% or more (Regulation of Consumption Tax).",
      source_url: 'https://investhere.ipim.gov.mo/en/macau/investmentinformation/foreigntrade', checked_on: '2026-10-14', review_by: '2027-10-14',
    },
    SG: {
      duty_percent: 0, except_hs: ['22', '24', '27', '3826', '87'],
      rule: 'Singapore charges duty only on alcoholic drinks, tobacco, motor vehicles and petroleum products.',
      basis: 'Singapore Customs: customs and excise duty apply to intoxicating liquors, tobacco products, motor vehicles, and petroleum products and biodiesel blends; other goods are non-dutiable.',
      source_url: 'https://www.customs.gov.sg/businesses/valuation-duties-taxes-and-fees/duties-and-dutiable-goods/', checked_on: '2026-10-14', review_by: '2027-10-14',
    },
    SX: {
      duty_percent: 0, except_hs: ['27'],
      rule: 'Sint Maarten charges no import duty; its customs taxes only petrol.',
      basis: "Government of Sint Maarten, Customs: 'The only tax levied by Customs Sint Maarten is tax/excise on unleaded gasoline.'",
      source_url: 'https://www.sintmaartengov.org/Ministries/Departments/Pages/Customs.aspx', checked_on: '2026-10-14', review_by: '2027-10-14',
    },
    BQ: {
      duty_percent: 0, except_hs: ['22', '24', '27'],
      rule: 'Bonaire, Sint Eustatius and Saba charge import duty at 0% on all goods; their general expenditure tax applies to local goods too.',
      basis: "Belastingdienst Caribisch Nederland: 'The import tax rate due is set at nil (0%) for all goods'; excise applies to petrol, alcohol and tobacco.",
      source_url: 'https://english.belastingdienst-cn.nl/topics/customs-business/company-import-tax', checked_on: '2026-10-14', review_by: '2027-10-14',
    },
    VA: {
      duty_percent: 0, except_hs: [],
      rule: 'Goods from abroad for the Vatican City cross Italy free of customs duties.',
      basis: 'Lateran Treaty between the Holy See and Italy, 11 February 1929, Art. 20.',
      source_url: 'https://spcp.prf.cuni.cz/dokument/lateran.htm', checked_on: '2026-10-14', review_by: '2027-10-14',
    },
    TL: {
      duty_percent: 5, except_hs: ['190110', '9619'],
      rule: 'Timor-Leste charges one customs duty rate on the value of all imports.',
      basis: "Customs Authority of Timor-Leste: import duty 'is calculated at a rate of 5% of the value of the goods' (Taxes and Duties Act, Decree-Law 8/2008; rate set in the annual State Budget). Infant formula and sanitary products are exempt.",
      source_url: 'https://customs.gov.tl/doing-business/duties-taxes/', checked_on: '2026-10-14', review_by: '2027-01-31',
    },
    BL: {
      duty_percent: 5, except_hs: [],
      rule: 'Saint-Barthélemy charges a dock duty (droit de quai) on all goods brought onto the island.',
      basis: "French customs: Saint-Barthélemy has been outside the EU customs territory since 1 January 2012 and levies a 5% 'droit de quai' on 'toutes les marchandises introduites dans l'île'.",
      source_url: 'https://www.douane.gouv.fr/fiche/cas-particuliers-de-lile-de-saint-martin-et-de-lile-de-saint-barthelemy', checked_on: '2026-10-14', review_by: '2027-10-14',
    },
  },
  risk: { grade_scores: { A1: 100, A2: 85, B1: 70, B2: 55, C1: 40, C2: 20, D: 0 }, restricted_group_i_cap: 40, restricted_group_ii_cap: 20 },
  volume: { full_share: 0.02, zero_share: 0.25, minimum_quantity_coverage: 0.8 },
  ranking: { minimum_live_points: 60, required_metrics: ['market_size', 'growth'], handoff_count: 10 },
  confidence: { recency_decay_per_year: 0.8 },
  chain_link: { max_change_ratio: 10 },
  quality: { baci_market_reported: 1, baci_partner_only: 0.85, comtrade_fallback: 0.9, chain_linked: 0.95, duty_estimate: 0.5, logistics_lpi: 0.9, logistics_lsci_estimate: 0.5, official: 1, official_agent_recorded: 0.9, official_common_tariff: 0.8 },
  hs_revision: { max_total_divergence: 0.02 },
  labels: { big_size_score: 70, big_growth_score: 60, india_sells_share_percent: 1, pays_above_ratio: 1.2, low_duty_percent: 5, hub_reexport_ratio: 0.5 },
  excluded_markets: { KP: 'Comprehensive UN Security Council sanctions (resolution 1718 and successors)' },
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

export function policyHash(policy: DemandDiscoveryV5Policy): string {
  return createHash('sha256').update(JSON.stringify(canonical(policy))).digest('hex');
}

/** Structural checks a policy must pass before any run uses it. */
export function assertPolicy(policy: DemandDiscoveryV5Policy) {
  const total = Object.values(policy.points).reduce((sum, points) => sum + points, 0);
  if (Math.abs(total - 100) > 1e-9) throw new Error(`v5 points sum to ${total}, not 100.`);
  const inParts = Object.values(policy.parts).flat();
  const keys = Object.keys(policy.points) as MetricKey[];
  if (inParts.length !== keys.length || keys.some((key) => !inParts.includes(key))) throw new Error('Every metric must belong to exactly one part.');
  if (policy.growth.cagr_weight + policy.growth.momentum_weight !== 100) throw new Error('Growth weights must sum to 100.');
  if (policy.foothold.share_weight + policy.foothold.trend_weight !== 100) throw new Error('Foothold weights must sum to 100.');
  if (!(policy.prices.full_ratio > policy.prices.neutral_ratio)) throw new Error('The full price ratio must exceed the neutral ratio.');
  if (!(policy.volume.full_share < policy.volume.zero_share)) throw new Error('Volume full share must be below the zero share.');
  if (!(policy.chain_link.max_change_ratio > 1)) throw new Error('The chain-link change limit must exceed 1.');
  if (!(policy.ranking.minimum_live_points > 0 && policy.ranking.minimum_live_points <= 100)) throw new Error('Minimum live points must be in (0, 100].');
  if (policy.ranking.required_metrics.some((key) => !(key in policy.points))) throw new Error('Required metrics must be policy metrics.');
  if (!(policy.window_years >= 2)) throw new Error('The window needs at least two years.');
  if (!(policy.duty.official_minimum_confidence >= 0 && policy.duty.official_minimum_confidence <= 100)) throw new Error('The official duty confidence minimum must be a percentage.');
  if (typeof policy.duty.score_india_preference !== 'boolean') throw new Error('duty.score_india_preference must be true or false.');
  for (const [key, value] of Object.entries(policy.quality)) if (!(value > 0 && value <= 1)) throw new Error(`quality.${key} must be in (0, 1].`);
  if (!(policy.quality.official_common_tariff < policy.quality.official)) throw new Error('A common external tariff must score below a national official tariff.');
  if (!(Number.isInteger(policy.world_bank.max_age_years) && policy.world_bank.max_age_years >= 0)) throw new Error('The World Bank age limit must be a whole number of years.');
  if (!(Number.isInteger(policy.logistics.lsci_fallback_minimum_pairs) && policy.logistics.lsci_fallback_minimum_pairs >= 10)) throw new Error('The logistics estimate needs at least ten markets to fit on.');
  for (const [market, entry] of Object.entries(policy.customs_unions)) {
    if (entry.reference_market === market) throw new Error(`${market}'s customs-union reference must be another market.`);
    if (entry.hs_chapters && !(entry.hs_chapters[0] >= 1 && entry.hs_chapters[0] <= entry.hs_chapters[1] && entry.hs_chapters[1] <= 99)) throw new Error(`${market}'s customs-union chapters are not a valid range.`);
  }
  const day = /^\d{4}-\d{2}-\d{2}$/;
  for (const [market, entry] of Object.entries(policy.rule_rates)) {
    if (!(entry.duty_percent >= 0 && entry.duty_percent <= 100)) throw new Error(`${market}'s rule rate must be a percentage.`);
    if (entry.except_hs.some((prefix) => !/^\d{2}(\d{2}){0,2}$/.test(prefix))) throw new Error(`${market}'s rule exceptions must be HS chapters, headings or subheadings.`);
    if (!entry.rule.trim() || !entry.basis.trim() || !entry.source_url.startsWith('https://')) throw new Error(`${market}'s rule must state itself, its basis and an https source.`);
    if (!day.test(entry.checked_on) || !day.test(entry.review_by) || entry.review_by <= entry.checked_on) throw new Error(`${market}'s rule needs a check date and a later review date.`);
  }
}
