import type { ParsedDuty } from '@/lib/market-access/tariff-semantics';

export const QATAR_REMEDY_REFERENCE_DATE = '2026-09-23' as const;
export const QATAR_REMEDY_MANIFEST_VERSION = 'qa-moci-active-remedies-2026-09-23-v2' as const;
export const QATAR_REMEDY_SOURCE_URL = 'https://www.moci.gov.qa/Industry' as const;

/**
 * `rate_confirmed`: the full ministerial decision text (producer rate table, effective_until) was
 * independently retrieved and verified directly from its official artifact (customs.gov.qa or
 * moci.gov.qa).
 */
export type QatarRemedyEvidenceGrade = 'rate_confirmed';

export interface QatarRemedyProducerRate { name: string; rate_percent: number }

export interface QatarTradeRemedy {
  id: string;
  kind: 'ANTI_DUMPING';
  evidence_grade: QatarRemedyEvidenceGrade;
  product: string;
  tariff_code_prefixes: readonly string[];
  excluded_code_prefixes?: readonly string[];
  excluded_battery_types?: readonly string[];
  origin_countries: readonly string[];
  effective_from: string;
  effective_until: string;
  published_range: string;
  rate_min_percent_cif: number;
  rate_max_percent_cif: number;
  producers: readonly QatarRemedyProducerRate[];
  other_producers_rate_percent: number;
  source_url: string;
  amendment_note: string | null;
  producer_or_exporter_identity_required: boolean;
}

/** A measure that was legally active at some point but has expired before the qualification date. */
export interface QatarHistoricalRemedy {
  id: string;
  kind: 'ANTI_DUMPING';
  status: 'EXPIRED';
  product: string;
  tariff_code_prefixes: readonly string[];
  excluded_code_prefixes?: readonly string[];
  origin_countries: readonly string[];
  effective_from: string;
  effective_until: string;
  source_url: string;
  note: string;
}

export interface QatarTradeRemedyManifest {
  version: typeof QATAR_REMEDY_MANIFEST_VERSION;
  complete_as_of: typeof QATAR_REMEDY_REFERENCE_DATE;
  register_enumeration_complete: true;
  enumeration_basis: string;
  measures: readonly QatarTradeRemedy[];
  historical_measures: readonly QatarHistoricalRemedy[];
  active_safeguard_count: 0;
  active_countervailing_count: 0;
}

const measure = (value: Omit<QatarTradeRemedy, 'kind' | 'evidence_grade' | 'producer_or_exporter_identity_required'>): QatarTradeRemedy => ({
  ...value, kind: 'ANTI_DUMPING', evidence_grade: 'rate_confirmed', producer_or_exporter_identity_required: true,
});
const historical = (value: Omit<QatarHistoricalRemedy, 'kind' | 'status'>): QatarHistoricalRemedy => ({ ...value, kind: 'ANTI_DUMPING', status: 'EXPIRED' });

/**
 * Complete Qatar/GCC anti-dumping instrument enumeration as of 2026-09-23.
 *
 * Enumeration basis: MOCI's official Industry Sector decisions-and-circulars resource
 * (moci.gov.qa/Industry, "القرارات والتعاميم" section) is a single non-paginated page — unlike
 * customs.gov.qa's Executive Decisions page, which only republishes a rolling recent window — and
 * lists every anti-dumping instrument alongside Qatar's other industrial-sector legal instruments.
 * All five GCC/Qatar anti-dumping decisions found there (21/2024, 22/2024, 107/2024, plus the
 * customs.gov.qa-hosted 19/2025 and 48/2026, cross-referenced) were independently retrieved and
 * hashed. No GCC-wide underlying measure is double-counted against its Qatar implementing decision:
 * each row below is the single Qatar-executable instrument. No safeguard or countervailing
 * instrument was found for Qatar in either source, consistent with the wider GCC pattern where
 * anti-dumping is the only trade-remedy type in current use.
 */
export const QATAR_ACTIVE_TRADE_REMEDY_MANIFEST: QatarTradeRemedyManifest = Object.freeze({
  version: QATAR_REMEDY_MANIFEST_VERSION,
  complete_as_of: QATAR_REMEDY_REFERENCE_DATE,
  register_enumeration_complete: true,
  enumeration_basis: 'moci.gov.qa/Industry decisions-and-circulars resource page (complete, non-paginated) cross-referenced against customs.gov.qa Executive Decisions circulars; 5 anti-dumping instruments found (4 active, 1 expired), 0 safeguard, 0 countervailing.',
  active_safeguard_count: 0,
  active_countervailing_count: 0,
  measures: Object.freeze([
    measure({
      id: 'qa-battery-wiring-devices-cn',
      product: 'Electrical wiring devices (switches, sockets, plugs and connectors), rated voltage not exceeding 1000V',
      tariff_code_prefixes: ['853669', '853650', '85444291', '85444221'], origin_countries: ['CN'],
      effective_from: '2025-03-28', effective_until: '2029-09-25',
      published_range: '11.3%-42% of CIF value', rate_min_percent_cif: 11.3, rate_max_percent_cif: 42,
      producers: [
        { name: 'ZHONGSHAN VISBO ELECTRICAL CO. LTD', rate_percent: 11.3 },
        { name: "FOSHAN VPON ELECTRIC CO. LTD", rate_percent: 17.1 },
        { name: "ZHEJIANG TAO'S ELECTRIC CO. LTD", rate_percent: 11.3 },
      ],
      other_producers_rate_percent: 42,
      amendment_note: null,
      source_url: 'https://www.customs.gov.qa/English/Legislations/Documents/Executive%20Resolutions/2025/19_25_EN.pdf',
    }),
    measure({
      id: 'qa-batteries-cn-my',
      product: 'Electric accumulators (lead-acid, of a kind used for starting piston engines)',
      tariff_code_prefixes: ['85071000'], origin_countries: ['CN', 'MY'],
      effective_from: '2026-06-08', effective_until: '2031-01-12',
      published_range: 'China 25.8%-74%; Malaysia 43.2%-77% of CIF value', rate_min_percent_cif: 25.8, rate_max_percent_cif: 77,
      producers: [
        { name: 'Guangdong Aokly Group Co., Ltd (CN)', rate_percent: 63.7 },
        { name: 'Camel Group Xiangyang Storage Battery Co. Ltd (CN)', rate_percent: 50.7 },
        { name: 'Jujiang Power Group Co., Ltd / Zhejiang Jujiang Power Supply Manufacturing Co., Ltd (CN)', rate_percent: 25.8 },
        { name: 'Camel Power (M) Sdn. Bhd. (MY)', rate_percent: 68 },
        { name: 'Just Energy Sdn. Bhd. (MY)', rate_percent: 43.2 },
      ],
      other_producers_rate_percent: 74,
      amendment_note: null,
      source_url: 'https://www.customs.gov.qa/English/Legislations/Documents/Executive%20Resolutions/2026/Decision%20of%20the%20Minister%20of%20Commerce%20and%20Industry%20No.%20%2848%29%20of%202026%20.pdf',
    }),
    measure({
      id: 'qa-batteries-kr',
      product: 'Lead-acid automotive starter batteries (including separators), capacity 35-115 Ah, whether or not rectangular/square',
      tariff_code_prefixes: ['85071000'], origin_countries: ['KR'],
      excluded_battery_types: ['AGM', 'EFB'],
      effective_from: '2024-08-11', effective_until: '2027-06-23',
      published_range: '12%-25% of CIF value', rate_min_percent_cif: 12, rate_max_percent_cif: 25,
      producers: [
        { name: 'HANKOOK & COMPANY CO., LTD', rate_percent: 21 },
        { name: 'SEBANG GLOBAL BATTERY CO., LTD', rate_percent: 19 },
        { name: 'HYUNDAI SUNGWOO SOLITE CO., LTD', rate_percent: 12 },
        { name: 'DN AUTOMOTIVE CORPORATION', rate_percent: 25 },
      ],
      other_producers_rate_percent: 25,
      amendment_note: null,
      source_url: 'https://www.moci.gov.qa/sites/default/files/2026-06/%D9%82%D8%B1%D8%A7%D8%B1-21-%D9%84%D8%B3%D9%86%D8%A9-2024-%D8%A8%D8%B7%D8%A7%D8%B1%D9%8A%D8%A7%D8%AA-%D9%83%D9%88%D8%B1%D9%8A%D8%A747.pdf',
    }),
    measure({
      id: 'qa-batteries-in',
      product: 'Lead-acid automotive starter batteries (including separators), capacity 32-225 Ah, whether or not rectangular/square',
      tariff_code_prefixes: ['85071000'], origin_countries: ['IN'],
      excluded_battery_types: ['AGM', 'EFB'],
      effective_from: '2024-08-11', effective_until: '2027-09-30',
      published_range: '8%-41% of CIF value', rate_min_percent_cif: 8, rate_max_percent_cif: 41,
      producers: [
        { name: 'Amara Raja Batteries Ltd', rate_percent: 8 },
        { name: 'Exide Industries Limited', rate_percent: 28.5 },
        { name: 'Livguard Batteries Pvt Ltd.', rate_percent: 22.4 },
      ],
      other_producers_rate_percent: 41,
      amendment_note: 'The intake brief for this acquisition asserted that Decision No. 2 of 2025 and Decision No. 21 of 2025 later amended this producer table (including renaming "Amara Raja Batteries Ltd" to "Amara Raja Energy & Mobility Limited"). Neither instrument could be independently located on moci.gov.qa’s Industry decisions-and-circulars page — the same primary channel that hosts every other verified Qatar remedy instrument in this manifest — nor via any other official or secondary Qatar source searched during this acquisition. The table above is read directly from the original, verified Decision No. 22 of 2024 legal text and is retained as the current legal state until a verifiable amendment artifact is found; it is not blindly assumed unamended, but no unverified substitute is used either.',
      source_url: 'https://www.moci.gov.qa/sites/default/files/2026-06/%D9%82%D8%B1%D8%A7%D8%B1-22-%D9%84%D8%B3%D9%86%D8%A9-2024-%D8%A8%D8%B7%D8%A7%D8%B1%D9%8A%D8%A7%D8%AA-%D8%A7%D9%84%D9%87%D9%86%D8%AF44.pdf',
    }),
  ]),
  historical_measures: Object.freeze([
    historical({
      id: 'qa-ceramic-tiles-cn-in-expired',
      product: 'Ceramic tiles and flags for paving or wall/stove cladding, whether or not on a backing, and finishing ceramics',
      tariff_code_prefixes: ['6907'], excluded_code_prefixes: ['69073000'], origin_countries: ['CN', 'IN'],
      effective_from: '2024-05-12', effective_until: '2025-06-05',
      source_url: 'https://www.moci.gov.qa/sites/default/files/2026-06/%D9%82%D8%B1%D8%A7%D8%B1-%D8%B1%D9%82%D9%85-107-%D9%84%D8%B3%D9%86%D8%A9-2024-%D8%B3%D9%8A%D8%B1%D8%A7%D9%85%D9%8A%D9%83-%D9%88%D9%85%D8%B1%D9%81%D9%82%D8%A7%D8%AA%D9%87.pdf',
      note: 'Decision No. (107) of 2024, Article (4), sets this measure’s expiry at 05/06/2025 — confirmed directly from the official artifact. It is EXPIRED as of the 2026-09-23 qualification date and is retained only for historical replay/evidence; it does not appear in `measures` and must never be applied to a current determination.',
    }),
  ]),
});

export function validateQatarRemedyManifest(manifest: QatarTradeRemedyManifest) {
  if (manifest.version !== QATAR_REMEDY_MANIFEST_VERSION || manifest.complete_as_of !== QATAR_REMEDY_REFERENCE_DATE || manifest.measures.length !== 4) throw new Error('Qatar active-remedy manifest is not the reviewed 2026-09-23 inventory.');
  if (manifest.register_enumeration_complete !== true) throw new Error('Qatar remedy register enumeration completeness must be asserted true once the enumeration basis is proven.');
  if (manifest.historical_measures.length !== 1) throw new Error('Qatar historical-remedy set is not the reviewed inventory.');
  if (new Set(manifest.measures.map((item) => item.id)).size !== manifest.measures.length) throw new Error('Qatar active-remedy identities must be unique.');
  for (const item of manifest.measures) {
    if (!item.tariff_code_prefixes.length || !item.origin_countries.length || !item.producers.length) throw new Error(`Qatar trade-remedy ${item.id} is incomplete.`);
    if (item.rate_min_percent_cif > item.rate_max_percent_cif) throw new Error(`Qatar trade-remedy ${item.id} has an inverted rate range.`);
    if (item.effective_until <= item.effective_from) throw new Error(`Qatar trade-remedy ${item.id} has a non-positive effective window.`);
  }
  for (const item of manifest.historical_measures) {
    if (item.effective_until >= QATAR_REMEDY_REFERENCE_DATE) throw new Error(`Qatar historical remedy ${item.id} is not actually expired as of the reference date.`);
  }
  return manifest;
}

export type QatarRemedyDecision =
  | { status: 'not_applicable'; remedies: readonly [] }
  | { status: 'producer_refinement_required'; candidates: readonly QatarTradeRemedy[]; required_evidence: readonly string[] };

export function selectQatarTradeRemedies(args: { manifest: QatarTradeRemedyManifest; code: string; origin_country: string; at: Date }): QatarRemedyDecision {
  validateQatarRemedyManifest(args.manifest);
  const date = args.at.toISOString().slice(0, 10), origin = args.origin_country.trim().toUpperCase();
  const candidates = args.manifest.measures.filter((item) =>
    item.origin_countries.includes(origin) &&
    date >= item.effective_from &&
    date <= item.effective_until &&
    item.tariff_code_prefixes.some((prefix) => args.code.startsWith(prefix)) &&
    !(item.excluded_code_prefixes ?? []).some((prefix) => args.code.startsWith(prefix)),
  );
  if (!candidates.length) return { status: 'not_applicable', remedies: [] };
  return { status: 'producer_refinement_required', candidates, required_evidence: ['producer_identity', 'exporter_identity', 'origin_country', 'exporting_country', 'commercial_invoice', 'battery_type_if_applicable'] };
}

export function unresolvedQatarRemedyDuty(item: QatarTradeRemedy): ParsedDuty {
  return {
    kind: 'mixed', ad_valorem_rate_percent: null, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null,
    expression: item.published_range,
    note: 'The active anti-dumping schedule is producer/exporter-specific (and, where applicable, excludes named battery constructions). The complete MOCI producer rate table is retained as evidence, but no rate is selected without the shipment’s producer/exporter identity, origin/exporting country and commercial-invoice evidence.',
  };
}
