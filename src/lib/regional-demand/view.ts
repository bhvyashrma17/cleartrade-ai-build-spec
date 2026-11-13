/**
 * The regional view, v2 (D-048, docs/38 §1.3): what a product's page shows for one market.
 *
 * - **Top 10.** A view lists its 10 largest areas and sums the rest, as Demand Discovery lists
 *   markets. The areas that together hold 80% are marked: the smallest set of the largest areas
 *   whose shares reach 80%. That set can run past the 10 listed, and the view says so.
 * - **Ranked by the product's imports.** A value view ranks by imports from all origins where every
 *   area has them, and otherwise by imports from India: when the all-countries figures could not be
 *   read, or for a run stored before v2, which kept only its top 15 by India and summed the rest. A
 *   list of importers ranks by the number of importers.
 * - **Evidence.** Every market carries one of six labels, from "Your product" (figures for the exact
 *   product code) to "Estimate" (nothing official) and "Not needed" (one search area).
 *
 * Stored runs are never rewritten: these rules are applied when a run is read.
 */
import type { ImporterArea, ImporterView, RegionalArea, RegionalDemandResultV1, RegionalView } from './census';

export const REGIONAL_VIEW_VERSION = 'regional-view-v2';
export const REGIONAL_TOP_AREAS = 10;
export const REGIONAL_CORE_SHARE_PERCENT = 80;

export type RegionalEvidence = 'your_product' | 'product_group' | 'traders' | 'all_goods' | 'estimate' | 'not_needed';

/** The six labels of docs/38 §1.3, in order of strength. */
export const REGIONAL_EVIDENCE: Readonly<Record<RegionalEvidence, { label: string; meaning: string }>> = {
  your_product: { label: 'Your product', meaning: 'Imports of the exact product code, by region' },
  product_group: { label: 'Product group', meaning: 'Imports of the wider group the product sits in, by region' },
  traders: { label: 'Traders', meaning: 'Importers or wholesalers counted by region' },
  all_goods: { label: 'All goods', meaning: "Each region's or port's total imports" },
  estimate: { label: 'Estimate', meaning: 'Nothing official: the main cities, ranked by size' },
  not_needed: { label: 'Not needed', meaning: 'One search area: the whole market' },
};

/** The evidence each official source gives. A source missing here has no label until one is set. */
export const SOURCE_EVIDENCE: Readonly<Record<string, RegionalEvidence>> = {
  us_census_intltrade: 'your_product',
  uk_hmrc_importers: 'traders',
  ca_cid_major_importers: 'traders',
};

export type RankedBy = 'all_origins_value' | 'india_value' | 'importers' | 'city_population';

export interface RankedMeta {
  code: string;
  rank: number;
  share_percent: number | null;
  cumulative_percent: number | null;
  /** One of the largest areas that together hold 80%. */
  in_core: boolean;
}

export interface CoreSummary {
  /** How many of the largest areas it takes to reach 80%, or null when a summed tail hides it. */
  count: number | null;
  /** The share held by the listed areas that are marked. */
  listed_share_percent: number | null;
}

interface Ranking {
  ranked_by: RankedBy;
  /** Total of the measure over every area, the summed tail included. */
  total: number;
  /** One entry per listed area, in the listed order. */
  ranked: RankedMeta[];
  core: CoreSummary;
}

export type PresentedValueView = RegionalView & Ranking;
export type PresentedImporterView = ImporterView & Ranking;
export type PresentedRegionalView = PresentedValueView | PresentedImporterView;

export interface PresentedRegionalResult extends Omit<RegionalDemandResultV1, 'views'> {
  view_version: string;
  evidence: RegionalEvidence;
  views: PresentedRegionalView[];
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Shares, the running total and the 80% marks for measures sorted largest first. `tail` is a summed
 * remainder whose areas are not known one by one.
 */
export function rankShares(codes: readonly string[], measures: readonly number[], tail = 0, listed = REGIONAL_TOP_AREAS): { total: number; ranked: RankedMeta[]; core: CoreSummary } {
  const total = measures.reduce((sum, value) => sum + value, 0) + tail;
  if (!(total > 0)) {
    return { total: 0, ranked: codes.slice(0, listed).map((code, index) => ({ code, rank: index + 1, share_percent: null, cumulative_percent: null, in_core: false })), core: { count: null, listed_share_percent: null } };
  }
  let running = 0;
  let coreCount: number | null = null;
  const cumulative = measures.map((value, index) => {
    running += value;
    if (coreCount === null && (running / total) * 100 >= REGIONAL_CORE_SHARE_PERCENT - 1e-9) coreCount = index + 1;
    return running;
  });
  // A summed tail can hide where 80% is reached: then every known area counts, and the count is unknown.
  const marked = coreCount ?? measures.length;
  const ranked = codes.slice(0, listed).map((code, index) => ({
    code, rank: index + 1,
    share_percent: round2((measures[index]! / total) * 100),
    cumulative_percent: round2((cumulative[index]! / total) * 100),
    in_core: index < marked,
  }));
  // The marked rows are always a prefix of the list.
  const listedCore = measures.slice(0, Math.min(marked, ranked.length)).reduce((sum, value) => sum + value, 0);
  return { total: round2(total), ranked, core: { count: coreCount, listed_share_percent: round2((listedCore / total) * 100) } };
}

function presentValueView(view: RegionalView): PresentedValueView {
  const known = view.areas;
  const worldTotal = known.reduce((sum, area) => sum + (area.world_value_usd ?? 0), 0);
  // All origins only when every area is listed with them; otherwise India, the order the run stored.
  const byWorld = view.others === null && known.length > 0 && known.every((area) => area.world_value_usd !== null) && worldTotal > 0;
  const measure = (area: RegionalArea) => (byWorld ? area.world_value_usd ?? 0 : area.india_value_usd);
  const sorted = [...known].sort((a, b) => measure(b) - measure(a) || (byWorld ? b.india_value_usd - a.india_value_usd : (b.world_value_usd ?? 0) - (a.world_value_usd ?? 0)) || byText(a.code, b.code));
  const tail = view.others ? view.others.india_value_usd : 0;
  const { total, ranked, core } = rankShares(sorted.map((area) => area.code), sorted.map(measure), tail);
  const rest = sorted.slice(REGIONAL_TOP_AREAS);
  const restCount = rest.length + (view.others?.count ?? 0);
  const worldKnown = rest.every((area) => area.world_value_usd !== null) && (view.others === null || view.others.world_value_usd !== null);
  return {
    ...view,
    areas: sorted.slice(0, REGIONAL_TOP_AREAS),
    others: restCount > 0
      ? {
          count: restCount,
          india_value_usd: round2(rest.reduce((sum, area) => sum + area.india_value_usd, 0) + (view.others?.india_value_usd ?? 0)),
          world_value_usd: worldKnown ? round2(rest.reduce((sum, area) => sum + (area.world_value_usd ?? 0), 0) + (view.others?.world_value_usd ?? 0)) : null,
        }
      : null,
    ranked_by: byWorld ? 'all_origins_value' : 'india_value',
    total, ranked, core,
  };
}

function presentImporterView(view: ImporterView): PresentedImporterView {
  const sorted = [...view.areas].sort((a: ImporterArea, b: ImporterArea) => b.importer_count - a.importer_count || byText(a.name, b.name));
  const { total, ranked, core } = rankShares(sorted.map((area) => area.code), sorted.map((area) => area.importer_count), view.others?.importer_count ?? 0);
  const rest = sorted.slice(REGIONAL_TOP_AREAS);
  const restCount = rest.length + (view.others?.count ?? 0);
  return {
    ...view,
    areas: sorted.slice(0, REGIONAL_TOP_AREAS),
    others: restCount > 0 ? { count: restCount, importer_count: rest.reduce((sum, area) => sum + area.importer_count, 0) + (view.others?.importer_count ?? 0) } : null,
    ranked_by: 'importers',
    total, ranked, core,
  };
}

/** A stored run as the page shows it. Refuses a source with no evidence label rather than guessing one. */
export function presentRegionalResult(result: RegionalDemandResultV1): PresentedRegionalResult {
  const evidence = SOURCE_EVIDENCE[result.source.key];
  if (!evidence) throw new Error(`The regional source ${result.source.key} has no evidence label.`);
  return {
    ...result,
    view_version: REGIONAL_VIEW_VERSION,
    evidence,
    views: result.views.map((view) => (view.measure === 'importers' ? presentImporterView(view) : presentValueView(view))),
  };
}
