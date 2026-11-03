import type { ParsedDuty } from '@/lib/market-access/tariff-semantics';

export const KUWAIT_REMEDY_REFERENCE_DATE = '2026-09-23' as const;
export const KUWAIT_REMEDY_MANIFEST_VERSION = 'kw-customs-active-remedies-2026-09-23-v1' as const;
export const KUWAIT_REMEDY_SOURCE_URL = 'https://www.customs.gov.kw/CustomAnnouncement' as const;

export type KuwaitRemedyEvidenceGrade = 'rate_confirmed';

export interface KuwaitRemedyProducerRate { name: string; rate_percent: number }

export interface KuwaitTradeRemedy {
  id: string;
  kind: 'ANTI_DUMPING';
  evidence_grade: KuwaitRemedyEvidenceGrade;
  product: string;
  tariff_code_prefixes: readonly string[];
  excluded_code_prefixes?: readonly string[];
  origin_countries: readonly string[];
  effective_from: string;
  effective_until: string | null;
  ongoing_pending_sunset_review: boolean;
  published_range: string;
  rate_min_percent_cif: number;
  rate_max_percent_cif: number;
  producers: readonly KuwaitRemedyProducerRate[];
  other_producers_rate_percent: number | null;
  source_url: string;
  amendment_note: string | null;
  producer_or_exporter_identity_required: boolean;
}

/** A measure that was legally active at some point but has expired before the qualification date. */
export interface KuwaitHistoricalRemedy {
  id: string;
  kind: 'ANTI_DUMPING';
  status: 'EXPIRED';
  product: string;
  tariff_code_prefixes: readonly string[];
  origin_countries: readonly string[];
  effective_from: string;
  effective_until: string;
  source_url: string;
  note: string;
}

export interface KuwaitTradeRemedyManifest {
  version: typeof KUWAIT_REMEDY_MANIFEST_VERSION;
  complete_as_of: typeof KUWAIT_REMEDY_REFERENCE_DATE;
  register_enumeration_complete: true;
  enumeration_basis: string;
  measures: readonly KuwaitTradeRemedy[];
  historical_measures: readonly KuwaitHistoricalRemedy[];
  active_safeguard_count: 0;
  active_countervailing_count: 0;
}

const measure = (value: Omit<KuwaitTradeRemedy, 'kind' | 'evidence_grade' | 'producer_or_exporter_identity_required'>): KuwaitTradeRemedy => ({
  ...value, kind: 'ANTI_DUMPING', evidence_grade: 'rate_confirmed', producer_or_exporter_identity_required: true,
});
const historical = (value: Omit<KuwaitHistoricalRemedy, 'kind' | 'status'>): KuwaitHistoricalRemedy => ({ ...value, kind: 'ANTI_DUMPING', status: 'EXPIRED' });

/**
 * Complete Kuwait/GCC anti-dumping instrument enumeration as of 2026-09-23.
 *
 * Enumeration basis: customs.gov.kw/CustomAnnouncement is a single, non-paginated register page
 * (841 distinct circulars/instructions spanning 2007-2026, confirmed by full-page retrieval with no
 * pagination control present) searched for the Arabic anti-dumping/safeguard/countervailing terms
 * (مكافحة الإغراق، الإغراق، تدابير نهائية، رسوم نهائية، الوقاية، رسوم الوقاية، تدابير وقائية، تدابير
 * تعويضية، الممارسات الضارة) across every listed instrument, cross-referenced against the identical
 * underlying GCC-wide investigations independently verified for Saudi Arabia and Qatar in this same
 * Customs Atlas. Six tariff-affecting anti-dumping instruments were found active and independently
 * verified (rate tables read directly from each official scanned artifact); one (paperboard,
 * Spain/Poland) is confirmed expired 2024-05-21 and retained as historical evidence only. No
 * safeguard or countervailing measure is currently active (a 2018 provisional safeguard on
 * galvanized/painted steel sheet and a 2022 termination of a chemical-products safeguard were found
 * but both are long closed and pre-date the 2025-01-01 baseline). No GCC-wide measure is
 * double-counted against its Kuwait implementing instruction: each row is the single Kuwait-executable
 * instrument.
 */
export const KUWAIT_ACTIVE_TRADE_REMEDY_MANIFEST: KuwaitTradeRemedyManifest = Object.freeze({
  version: KUWAIT_REMEDY_MANIFEST_VERSION,
  complete_as_of: KUWAIT_REMEDY_REFERENCE_DATE,
  register_enumeration_complete: true,
  enumeration_basis: 'customs.gov.kw/CustomAnnouncement complete non-paginated register (841 instruments, 2007-2026) searched for Arabic anti-dumping/safeguard/countervailing terminology; 6 active anti-dumping instruments found, 1 historical/expired, 0 safeguard, 0 countervailing currently active.',
  active_safeguard_count: 0,
  active_countervailing_count: 0,
  measures: Object.freeze([
    measure({
      id: 'kw-batteries-kr',
      product: 'Lead-acid automotive starter batteries (including separators), capacity 35-115 Ah, whether or not rectangular/square',
      tariff_code_prefixes: ['85071000'], origin_countries: ['KR'],
      effective_from: '2017-08-17', effective_until: '2027-08-17', ongoing_pending_sunset_review: false,
      published_range: '12%-25% of CIF value', rate_min_percent_cif: 12, rate_max_percent_cif: 25,
      producers: [
        { name: 'ATLASBX CO. LTD (formerly Hankook & Company Co. Ltd)', rate_percent: 21 },
        { name: 'Sebang Global Battery Co. Ltd', rate_percent: 19 },
        { name: 'Hyundai Sungwoo Solite Co. Ltd', rate_percent: 12 },
      ],
      other_producers_rate_percent: 25,
      amendment_note: 'Customs Instruction 102/2017 imposed this measure for 5 years from its Official Gazette publication date (the instruction itself defers to a separately-numbered bulletin; 2017-08-17, this instruction’s own register date, is used as the best-evidenced proxy). Instruction 41/2023 continues it for a further 5 years "starting from the expiry date of the original five-year period" (Arabic: من تاريخ انتهاء فترة خمس السنوات الأصلية), not from the 2023 instruction’s own date — giving the 2027-08-17 estimate (2017-08-17 + 5y + 5y). Hankook & Company’s battery business was renamed ATLASBX; the original 2017 table already used the ATLASBX name.',
      source_url: 'https://www.customs.gov.kw/Content/Files/CustomsAnnouncement/1022017.pdf',
    }),
    measure({
      id: 'kw-aluminium-cn',
      product: 'Flat sheets, plates, coils and strips (including square forms), of coated or coloured aluminium alloys, thickness 0.2mm-8mm',
      tariff_code_prefixes: ['76061210', '76061220', '76061230'], origin_countries: ['CN'],
      effective_from: '2025-04-25', effective_until: '2030-04-25', ongoing_pending_sunset_review: false,
      published_range: '7.1%-20% of CIF value', rate_min_percent_cif: 7.1, rate_max_percent_cif: 20,
      producers: [
        { name: 'ZOUPING ZENWIN ALUMINIUM TECHNOLOGY CO. LTD', rate_percent: 7.6 },
        { name: 'LITONG ALUMINIUM INDUSTRIAL (GUANGDONG/WUXI/SHANGHAI) CO. LTD', rate_percent: 8 },
        { name: 'UNITED ALUMINUM CO. LTD', rate_percent: 7.1 },
      ],
      other_producers_rate_percent: 20,
      amendment_note: null,
      source_url: 'https://www.customs.gov.kw/Content/Files/CustomsAnnouncement/1920828500_pdfFile.pdf',
    }),
    measure({
      id: 'kw-cement-clinker-ir',
      product: 'Hydraulic cement of all kinds, including unground agglomerated cement known as clinker',
      tariff_code_prefixes: ['2523'], origin_countries: ['IR'],
      effective_from: '2025-05-08', effective_until: null, ongoing_pending_sunset_review: true,
      published_range: '67.5% of CIF value (all companies)', rate_min_percent_cif: 67.5, rate_max_percent_cif: 67.5,
      producers: [{ name: 'All companies (كل الشركات)', rate_percent: 67.5 }],
      other_producers_rate_percent: null,
      amendment_note: 'Instruction 22/2025, Article 1(3): the final anti-dumping duty "remains in effect until completion of the sunset review investigation" (وتظل سارية لحين الانتهاء من تحقيق مراجعة انتهاء المدة); no fixed expiry is legally stated as of 2026-09-23.',
      source_url: 'https://www.customs.gov.kw/Content/Files/CustomsAnnouncement/5570593100_pdfFile.pdf',
    }),
    measure({
      id: 'kw-ceramic-tiles-cn-in',
      product: 'Ceramic and porcelain tiles for paving/wall/stove cladding, whether or not on a backing, and finishing ceramics',
      tariff_code_prefixes: ['6907'], excluded_code_prefixes: ['69073000'], origin_countries: ['CN', 'IN'],
      effective_from: '2025-05-08', effective_until: null, ongoing_pending_sunset_review: true,
      published_range: 'China 23.5%-76%; India 17.6%-106% of CIF value', rate_min_percent_cif: 17.6, rate_max_percent_cif: 106,
      producers: [
        { name: 'Guangdong Winto Ceramics Co. Ltd. / Honghai Ceramics Industrial Co. Ltd. (CN)', rate_percent: 23.5 },
        { name: 'Enping FENGZE Ceramics Co. Ltd. (CN)', rate_percent: 58 },
        { name: 'Jiangxi SUN Ceramics Co. Ltd. (CN)', rate_percent: 53 },
        { name: 'Lexus Granito India Ltd (IN)', rate_percent: 70.2 },
        { name: 'Sunshine Tiles Company Pvt. Ltd (IN)', rate_percent: 37 },
        { name: 'Comet Granito Pvt. Ltd (IN)', rate_percent: 17.6 },
      ],
      other_producers_rate_percent: 106,
      amendment_note: 'Instruction 22/2025, Article 2(3): the final anti-dumping duty "remains in effect until completion of the sunset review investigation"; no fixed expiry is legally stated as of 2026-09-23. Cooperating non-sampled Chinese companies (annex) carry 23.5%; cooperating non-sampled Indian companies (annex) carry 41.2%; the 106% \"other\" rate applies to non-cooperating Indian exporters, 76% to non-cooperating Chinese exporters. This rate table is identical to the one independently verified for Qatar’s Decision 107/2024, confirming both are the same underlying GCC-wide investigation executed by each member state’s own instrument.',
      source_url: 'https://www.customs.gov.kw/Content/Files/CustomsAnnouncement/5570593100_pdfFile.pdf',
    }),
    measure({
      id: 'kw-sanitary-ware-cn-in',
      product: 'Ceramic sinks, wash basins, bathtubs, bidets, water closet pans, flushing cisterns, urinals and similar fixed sanitary ware',
      tariff_code_prefixes: ['69101000', '69109000'], origin_countries: ['CN', 'IN'],
      effective_from: '2025-07-08', effective_until: '2030-07-08', ongoing_pending_sunset_review: false,
      published_range: 'China 33.8%-38.7%; India 21.4%-69.5% of CIF value', rate_min_percent_cif: 21.4, rate_max_percent_cif: 69.5,
      producers: [
        { name: 'Guangdong Zhiru Technology Co. Ltd. (CN)', rate_percent: 35.6 },
        { name: 'Huida Sanitary Ware Co. Ltd. (CN)', rate_percent: 38.7 },
        { name: 'Guangdong Akit Sanitary Ware Technology Co. Ltd. (CN)', rate_percent: 33.8 },
        { name: 'Anchor Sanitary Ware Pvt. Ltd. (IN)', rate_percent: 47.4 },
        { name: 'Racy Sanitary Wares (IN)', rate_percent: 21.4 },
        { name: 'Eros For Sanitarywares (IN)', rate_percent: 69.5 },
      ],
      other_producers_rate_percent: null,
      amendment_note: 'The official artifact lists cooperating non-sampled rates (37.5% CN, 36.2% IN) but does not state a separate residual "other" rate for non-cooperating exporters; no rate is invented for that category, so an unmatched non-cooperating exporter falls to producer-refinement rather than any numeric default.',
      source_url: 'https://www.customs.gov.kw/Content/Files/CustomsAnnouncement/9204589100_pdfFile.pdf',
    }),
    measure({
      id: 'kw-batteries-cn-my',
      product: 'Electric accumulators (lead-acid, of a kind used for starting piston engines)',
      tariff_code_prefixes: ['85071000'], origin_countries: ['CN', 'MY'],
      effective_from: '2026-01-13', effective_until: '2031-01-13', ongoing_pending_sunset_review: false,
      published_range: 'China 25.8%-74%; Malaysia 43.2%-77% of CIF value', rate_min_percent_cif: 25.8, rate_max_percent_cif: 77,
      producers: [
        { name: 'Guangdog Aokly Group Co. Ltd (CN)', rate_percent: 63.7 },
        { name: 'Camel Group Xiangyang Storage Battery Co. Ltd (CN)', rate_percent: 50.7 },
        { name: 'Camel Group Huazhonge Storage Battery Co. Ltd (CN)', rate_percent: 50.7 },
        { name: 'Jujiang Power Group Co. Ltd / Zhejiang Jujiang Power Supply Manufacturing Co. Ltd (CN)', rate_percent: 25.8 },
        { name: 'Camel Power (M) Sdn. Bhd. (MY)', rate_percent: 68 },
        { name: 'Just Energy Sdn. Bhd. (MY)', rate_percent: 43.2 },
      ],
      other_producers_rate_percent: 77,
      amendment_note: 'Independently verified from Kuwait Instruction 64 (issued 2025-12-29, effective 2026-01-13) rather than copied from Qatar’s Decision 48/2026; the rate table is identical, confirming both execute the same GCC-wide investigation.',
      source_url: 'https://www.customs.gov.kw/Content/Files/CustomsAnnouncement/129236100_pdfFile.pdf',
    }),
  ]),
  historical_measures: Object.freeze([
    historical({
      id: 'kw-paperboard-es-pl-expired',
      product: 'Paper and paperboard (fluting or testliner), uncoated, in rolls or sheets ("cardboard paper")',
      tariff_code_prefixes: ['48051100', '48051910', '48051920', '48051990', '48052500'], origin_countries: ['ES', 'PL'],
      effective_from: '2019-04-23', effective_until: '2024-04-30',
      source_url: 'https://www.customs.gov.kw/Content/Files/CustomsAnnouncement/4833562700_pdfFile.pdf',
      note: 'Instruction 26/2024 confirms the end of the final anti-dumping duty application period (originally imposed by Instruction 54/2019, Ministerial Committee Decision No. 3 of 31 March 2019) against Council imports of paperboard originating in Spain and Poland, effective 2024-04-30. EXPIRED as of the 2026-09-23 qualification date; retained for historical replay/evidence only and never applied to a current determination.',
    }),
  ]),
});

export function validateKuwaitRemedyManifest(manifest: KuwaitTradeRemedyManifest) {
  if (manifest.version !== KUWAIT_REMEDY_MANIFEST_VERSION || manifest.complete_as_of !== KUWAIT_REMEDY_REFERENCE_DATE || manifest.measures.length !== 6) throw new Error('Kuwait active-remedy manifest is not the reviewed 2026-09-23 inventory.');
  if (manifest.register_enumeration_complete !== true) throw new Error('Kuwait remedy register enumeration completeness must be asserted true once the enumeration basis is proven.');
  if (manifest.historical_measures.length !== 1) throw new Error('Kuwait historical-remedy set is not the reviewed inventory.');
  if (new Set(manifest.measures.map((item) => item.id)).size !== manifest.measures.length) throw new Error('Kuwait active-remedy identities must be unique.');
  for (const item of manifest.measures) {
    if (!item.tariff_code_prefixes.length || !item.origin_countries.length || !item.producers.length) throw new Error(`Kuwait trade-remedy ${item.id} is incomplete.`);
    if (item.effective_until !== null && item.effective_until <= item.effective_from) throw new Error(`Kuwait trade-remedy ${item.id} has a non-positive effective window.`);
    if (item.ongoing_pending_sunset_review && item.effective_until !== null) throw new Error(`Kuwait trade-remedy ${item.id} cannot be both ongoing-pending-review and carry a fixed expiry.`);
  }
  for (const item of manifest.historical_measures) {
    if (item.effective_until >= KUWAIT_REMEDY_REFERENCE_DATE) throw new Error(`Kuwait historical remedy ${item.id} is not actually expired as of the reference date.`);
  }
  return manifest;
}

export type KuwaitRemedyDecision =
  | { status: 'not_applicable'; remedies: readonly [] }
  | { status: 'producer_refinement_required'; candidates: readonly KuwaitTradeRemedy[]; required_evidence: readonly string[] };

export function selectKuwaitTradeRemedies(args: { manifest: KuwaitTradeRemedyManifest; code: string; origin_country: string; at: Date }): KuwaitRemedyDecision {
  validateKuwaitRemedyManifest(args.manifest);
  const date = args.at.toISOString().slice(0, 10), origin = args.origin_country.trim().toUpperCase();
  const candidates = args.manifest.measures.filter((item) =>
    item.origin_countries.includes(origin) &&
    date >= item.effective_from &&
    (item.ongoing_pending_sunset_review || item.effective_until === null || date <= item.effective_until) &&
    item.tariff_code_prefixes.some((prefix) => args.code.startsWith(prefix)) &&
    !(item.excluded_code_prefixes ?? []).some((prefix) => args.code.startsWith(prefix)),
  );
  if (!candidates.length) return { status: 'not_applicable', remedies: [] };
  return { status: 'producer_refinement_required', candidates, required_evidence: ['producer_identity', 'exporter_identity', 'origin_country', 'exporting_country', 'commercial_invoice'] };
}

export function unresolvedKuwaitRemedyDuty(item: KuwaitTradeRemedy): ParsedDuty {
  return {
    kind: 'mixed', ad_valorem_rate_percent: null, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null,
    expression: item.published_range,
    note: 'The active anti-dumping schedule is producer/exporter-specific. The complete Kuwait Customs producer rate table (where resolvable from the official artifact) is retained as evidence, but no rate is selected without the shipment’s producer/exporter identity, origin/exporting country and commercial-invoice evidence.',
  };
}
