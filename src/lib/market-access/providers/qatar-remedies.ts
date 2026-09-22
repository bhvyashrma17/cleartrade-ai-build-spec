import type { ParsedDuty } from '@/lib/market-access/tariff-semantics';

export const QATAR_REMEDY_REFERENCE_DATE = '2026-09-23' as const;
export const QATAR_REMEDY_MANIFEST_VERSION = 'qa-moci-active-remedies-2026-09-23-v1' as const;
export const QATAR_REMEDY_SOURCE_URL = 'https://www.customs.gov.qa/English/Legislations/Pages/Executive-Decisions.aspx';

/**
 * `rate_confirmed`: the full ministerial decision text (rate table, effective_until) was
 * independently retrieved and verified.
 * `scope_confirmed_rate_unconfirmed`: multiple independent Qatar government sources (QNA official
 * newswire, Gulf Times, The Peninsula Qatar) confirm the decision number, product and origin scope,
 * but the primary legal text (and therefore the exact rate table and expiry date) could not be
 * retrieved from customs.gov.qa, almeezan.qa or moci.gov.qa during this acquisition. The measure is
 * retained as active-but-unresolved rather than omitted, because omitting a real measure would
 * silently understate coverage; no rate is ever selected for it.
 */
export type QatarRemedyEvidenceGrade = 'rate_confirmed' | 'scope_confirmed_rate_unconfirmed';

export interface QatarTradeRemedy {
  id: string;
  kind: 'ANTI_DUMPING';
  evidence_grade: QatarRemedyEvidenceGrade;
  product: string;
  tariff_code_prefixes: readonly string[];
  origin_countries: readonly string[];
  effective_from: string;
  effective_until: string | null;
  published_range: string | null;
  rate_min_percent_cif: number | null;
  rate_max_percent_cif: number | null;
  source_url: string;
  producer_or_exporter_identity_required: boolean;
}

export interface QatarTradeRemedyManifest {
  version: typeof QATAR_REMEDY_MANIFEST_VERSION;
  complete_as_of: typeof QATAR_REMEDY_REFERENCE_DATE;
  register_enumeration_complete: false;
  measures: readonly QatarTradeRemedy[];
  active_safeguard_count: 0;
  active_countervailing_count: 0;
}

const measure = (value: Omit<QatarTradeRemedy, 'kind' | 'producer_or_exporter_identity_required'>): QatarTradeRemedy => ({
  ...value, kind: 'ANTI_DUMPING', producer_or_exporter_identity_required: true,
});

/**
 * Known active Qatar/GCC anti-dumping measures as of 2026-09-23. This is NOT certified as the
 * complete MOCI decisions register: moci.gov.qa rejected direct requests and the customs.gov.qa
 * "Executive Decisions" page only republishes a rolling recent window, not a full historical
 * archive. Decision 107/2024 (ceramic tiles, China/India) named in the intake brief could not be
 * independently corroborated by any primary or secondary Qatar source during this acquisition and
 * is deliberately excluded rather than asserted on the brief's word alone — see
 * `register_enumeration_complete: false` on the manifest.
 */
export const QATAR_ACTIVE_TRADE_REMEDY_MANIFEST: QatarTradeRemedyManifest = Object.freeze({
  version: QATAR_REMEDY_MANIFEST_VERSION,
  complete_as_of: QATAR_REMEDY_REFERENCE_DATE,
  register_enumeration_complete: false,
  active_safeguard_count: 0,
  active_countervailing_count: 0,
  measures: Object.freeze([
    measure({
      id: 'qa-battery-wiring-devices-cn', evidence_grade: 'rate_confirmed',
      product: 'Electrical wiring devices (switches, sockets, plugs and connectors), rated voltage not exceeding 1000V',
      tariff_code_prefixes: ['853669', '853650', '85444291', '85444221'], origin_countries: ['CN'],
      effective_from: '2025-03-28', effective_until: '2029-09-25',
      published_range: '11.3%-42% of CIF value', rate_min_percent_cif: 11.3, rate_max_percent_cif: 42,
      source_url: 'https://www.customs.gov.qa/English/Legislations/Documents/Executive%20Resolutions/2025/19_25_EN.pdf',
    }),
    measure({
      id: 'qa-batteries-cn-my', evidence_grade: 'rate_confirmed',
      product: 'Electric accumulators (lead-acid, of a kind used for starting piston engines)',
      tariff_code_prefixes: ['85071000'], origin_countries: ['CN', 'MY'],
      effective_from: '2026-06-08', effective_until: '2031-01-12',
      published_range: 'China 25.8%-74%; Malaysia 43.2%-77% of CIF value', rate_min_percent_cif: 25.8, rate_max_percent_cif: 77,
      source_url: 'https://www.customs.gov.qa/English/Legislations/Documents/Executive%20Resolutions/2026/Decision%20of%20the%20Minister%20of%20Commerce%20and%20Industry%20No.%20%2848%29%20of%202026%20.pdf',
    }),
    measure({
      id: 'qa-batteries-kr-scope-unconfirmed', evidence_grade: 'scope_confirmed_rate_unconfirmed',
      product: 'Automotive/starter batteries, capacity 35-115 ampere (Ministerial Decision No. 21 of 2024)',
      tariff_code_prefixes: ['85071000'], origin_countries: ['KR'],
      effective_from: '2024-08-27', effective_until: null,
      published_range: null, rate_min_percent_cif: null, rate_max_percent_cif: null,
      source_url: 'https://www.qna.org.qa/en/News-Area/News/2024-08/27/0061-moci-imposes%C2%A0anti-dumping-duties-on-imports%C2%A0of-certain-types-of-automotive-batteries-from-korea,-india',
    }),
    measure({
      id: 'qa-batteries-in-scope-unconfirmed', evidence_grade: 'scope_confirmed_rate_unconfirmed',
      product: 'Automotive/starter batteries, capacity 32-225 ampere (Ministerial Decision No. 22 of 2024)',
      tariff_code_prefixes: ['85071000'], origin_countries: ['IN'],
      effective_from: '2024-08-27', effective_until: null,
      published_range: null, rate_min_percent_cif: null, rate_max_percent_cif: null,
      source_url: 'https://www.qna.org.qa/en/News-Area/News/2024-08/27/0061-moci-imposes%C2%A0anti-dumping-duties-on-imports%C2%A0of-certain-types-of-automotive-batteries-from-korea,-india',
    }),
  ]),
});

export function validateQatarRemedyManifest(manifest: QatarTradeRemedyManifest) {
  if (manifest.version !== QATAR_REMEDY_MANIFEST_VERSION || manifest.complete_as_of !== QATAR_REMEDY_REFERENCE_DATE || manifest.measures.length !== 4) throw new Error('Qatar active-remedy manifest is not the reviewed 2026-09-23 inventory.');
  if (manifest.register_enumeration_complete !== false) throw new Error('Qatar remedy register enumeration completeness must not be asserted true.');
  if (new Set(manifest.measures.map((item) => item.id)).size !== manifest.measures.length) throw new Error('Qatar active-remedy identities must be unique.');
  for (const item of manifest.measures) {
    if (!item.tariff_code_prefixes.length || !item.origin_countries.length) throw new Error(`Qatar trade-remedy ${item.id} is incomplete.`);
    if (item.evidence_grade === 'rate_confirmed' && (item.rate_min_percent_cif === null || item.rate_max_percent_cif === null || item.effective_until === null)) throw new Error(`Qatar trade-remedy ${item.id} claims rate_confirmed without a complete rate/expiry.`);
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
    (item.effective_until === null || date <= item.effective_until) &&
    item.tariff_code_prefixes.some((prefix) => args.code.startsWith(prefix)),
  );
  if (!candidates.length) return { status: 'not_applicable', remedies: [] };
  return { status: 'producer_refinement_required', candidates, required_evidence: ['producer_identity', 'exporter_identity', 'origin_country', 'exporting_country', 'commercial_invoice'] };
}

export function unresolvedQatarRemedyDuty(item: QatarTradeRemedy): ParsedDuty {
  return {
    kind: 'mixed', ad_valorem_rate_percent: null, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null,
    expression: item.published_range ?? 'rate not yet independently confirmed from Qatar primary legal text',
    note: item.evidence_grade === 'rate_confirmed'
      ? 'The active anti-dumping schedule is producer/exporter-specific. The MOCI decision range is retained, but no rate is selected without the shipment identity evidence and applicable detailed schedule.'
      : 'This measure’s existence and scope are confirmed by independent Qatar government sources, but its primary legal text (and therefore its exact rate table and expiry) was not retrievable during acquisition. No rate is invented; producer/exporter identity plus primary-source confirmation are both required before this measure can be applied.',
  };
}
