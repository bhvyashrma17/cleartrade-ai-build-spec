/**
 * Where each figure comes from, and for which years (docs/36 §6; stage 1, item 8). Pure: one stored
 * measure and its market's data context in, one short line out — "CEPII BACI, 2022–2024" — and an
 * estimate says it is one. Runs made before item 8 did not record every year with its measure; their
 * lines fall back to a year only where the stored row says exactly which, and otherwise name the
 * source without a year rather than guess one.
 */
import type { MetricResult } from './metrics';

export interface MarketDataContext {
  /** Where the market's trade figures come from (`score_breakdown.source`). */
  source: 'baci' | 'comtrade_fallback' | 'none' | null;
  /** The years growth and steadiness were measured over (`score_breakdown.window`). */
  window: number[];
  /** The year supplier mix, unit values and quantities come from. */
  structure_year: number | null;
  /** The newest year, linked from the market's own report to UN Comtrade (§5.3), when one was. */
  linked_year: number | null;
  /** The market reported nothing itself for the base year: its figures are its partners' reports. */
  partner_only: boolean;
  /** The run's date (YYYY-MM-DD): an official tariff is the one in force then. */
  as_of: string | null;
}

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null);
const int = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) ? value : null);
const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** The data context of a stored assessment, read defensively from `score_breakdown`. */
export function marketDataContext(scoreBreakdown: unknown, asOf: Date | null): MarketDataContext {
  const stored = record(scoreBreakdown);
  const source = stored?.source;
  return {
    source: source === 'baci' || source === 'comtrade_fallback' || source === 'none' ? source : null,
    window: Array.isArray(stored?.window) ? (stored!.window as unknown[]).map(int).filter((year): year is number => year != null) : [],
    structure_year: int(stored?.structure_year),
    linked_year: int(record(record(stored?.newest_year)?.linked)?.year),
    partner_only: record(stored?.facts)?.partner_only === true,
    as_of: asOf ? asOf.toISOString().slice(0, 10) : null,
  };
}

/** Measured over the market's whole window: the stored window is exactly their years. */
const TREND_METRICS = new Set(['growth', 'stability']);
/** Measured in the structure year alone. */
const STRUCTURE_METRICS = new Set(['price_headroom', 'openness', 'distance_fit', 'price_fit', 'volume_fit']);
const LINKED = "from the market's report to UN Comtrade (provisional)";

const span = (first: number, last: number) => (first === last ? String(first) : `${first}–${last}`);

/** "2020–2024; 2025 from the market's report to UN Comtrade (provisional)" when the last year is the linked one. */
function years(first: number, last: number, context: MarketDataContext): string {
  return context.linked_year != null && last === context.linked_year && first < last ? `${span(first, last - 1)}; ${last} ${LINKED}` : span(first, last);
}

/** The years a trade figure covers: as recorded with it, else only what the stored row says exactly (see top). */
function tradeYears(metric: MetricResult, context: MarketDataContext): string | null {
  const first = int(metric.inputs.first_year);
  const last = int(metric.inputs.last_year);
  if (first != null && last != null) return years(first, last, context);
  if (TREND_METRICS.has(metric.key) && context.window.length) return years(context.window[0], context.window[context.window.length - 1], context);
  if (STRUCTURE_METRICS.has(metric.key)) {
    const year = int(metric.inputs.year) ?? context.structure_year;
    return year == null ? null : String(year);
  }
  return null;
}

function dataset(context: MarketDataContext): string {
  if (context.source === 'comtrade_fallback') return "UN Comtrade (the market's own customs reports)";
  return context.partner_only ? "CEPII BACI (from the market's partners' reports)" : 'CEPII BACI';
}

const withYears = (what: string, when: string | null) => (when ? `${what}, ${when}` : what);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** `31 Oct 2026` (docs/10 §5) from a YYYY-MM-DD date; anything else is shown as stored. */
function displayDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match && MONTHS[Number(match[2]) - 1] ? `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}` : iso;
}

/** The ECGC list a grade comes from: its version is "ECGC short-term list w.e.f. YYYY-MM-DD" (`reference-datasets/registry.ts`). */
function ecgcSource(list: string | null): string {
  const effective = list ? /^ECGC short-term list w\.e\.f\. (\d{4}-\d{2}-\d{2})$/.exec(list) : null;
  if (effective) return `ECGC country risk classification, short-term list in force from ${displayDate(effective[1])}`;
  return list ? `ECGC country risk classification (${list})` : 'ECGC country risk classification';
}

function dutySource(metric: MetricResult, context: MarketDataContext): string {
  const inputs = metric.inputs;
  const inForce = context.as_of ? `, in force on ${displayDate(context.as_of)}` : '';
  if (inputs.basis === 'official') {
    if (inputs.recorded_by_agent === 'yes') return `Official tariff read by a ClearTrade agent${text(inputs.source) ? `: ${text(inputs.source)}` : ''}${inForce}`;
    if (text(inputs.common_tariff)) return `${text(inputs.common_tariff)}${inForce}`;
    if (text(inputs.schedule_read)) return `${text(inputs.schedule_read)}${inForce}`;
    return `Official tariff${text(inputs.source) ? `: ${text(inputs.source)}` : ''}${inForce}`;
  }
  if (inputs.basis === 'rule') return `Published rule${text(inputs.source) ? `: ${text(inputs.source)}` : ''}`;
  const year = int(inputs.sector_average_year);
  const union = text(inputs.customs_union);
  const agreement = text(inputs.agreement);
  return `Estimate: World Bank average applied tariff${union ? ` (the ${union}'s common external tariff)` : ''}${year != null ? `, ${year}` : ''}, ${agreement ? `with India's ${agreement}` : 'with no trade agreement in force'}`;
}

/** One line naming where a live measure comes from and for which years; null for a measure without data. */
export function metricSource(metric: MetricResult, context: MarketDataContext): string | null {
  if (metric.score == null) return null;
  const inputs = metric.inputs;
  const when = tradeYears(metric, context);
  switch (metric.key) {
    case 'market_size':
    case 'growth':
    case 'stability':
    case 'india_foothold':
    case 'india_sales':
      return withYears(dataset(context), when);
    case 'price_headroom':
      return withYears(`${dataset(context)} unit values, this market's and India's exports`, when);
    case 'openness':
      return withYears(`${dataset(context)} supplier shares`, when);
    case 'distance_fit':
      return withYears(`CEPII GeoDist capitals, weighted by ${dataset(context)} supplier shares`, when);
    case 'price_fit':
      return withYears(`Your price on the product form, against ${dataset(context)} unit values`, when);
    case 'volume_fit':
      return withYears(`Your capacity on the product form, against ${dataset(context)} quantities`, when);
    case 'duty':
      return dutySource(metric, context);
    case 'logistics':
      if (inputs.basis === 'lsci_estimate') return withYears('Estimate: UNCTAD liner shipping connectivity, fitted to the World Bank LPI', int(inputs.lsci_year)?.toString() ?? null);
      return withYears('World Bank Logistics Performance Index', int(inputs.lpi_year)?.toString() ?? null);
    case 'country_risk':
      return ecgcSource(text(inputs.list));
  }
}
