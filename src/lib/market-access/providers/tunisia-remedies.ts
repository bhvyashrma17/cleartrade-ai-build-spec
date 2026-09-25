import type { ParsedDuty } from '@/lib/market-access/tariff-semantics';

export const TUNISIA_REMEDY_REFERENCE_DATE = '2026-09-24' as const;
export const TUNISIA_REMEDY_MANIFEST_VERSION = 'tn-trade-remedies-2026-09-24-v1' as const;
const WTO = (symbol: string) => `https://docs.wto.org/dol2fe/Pages/SS/directdoc.aspx?filename=q:/${symbol}.pdf&Open=True`;
export const TUNISIA_TPR_URL = 'https://www.wto.org/french/news_f/news_docs/S479R1_f.pdf' as const;
export const TUNISIA_SAFEGUARD_NOTIFICATION_URL = WTO('G/SG/N8TUN1');
export const TUNISIA_TRQ_ADMINISTRATION_URL = WTO('G/AG/NTUN4');
export const TUNISIA_TRQ_LATEST_FILL_URL = WTO('G/AG/NTUN79');
export const TUNISIA_SSG_LATEST_URL = WTO('G/AG/NTUN74');
/**
 * The next symbol in each Tunisian WTO notification series. Each must still answer "The file is not
 * published"; a new investigation, measure, extension or agriculture notification fails acquisition closed.
 */
export const TUNISIA_NEXT_NOTIFICATION_PROBES: readonly { symbol: string; url: string }[] = Object.freeze(
  ['G/SG/N6TUN8', 'G/SG/N8TUN2', 'G/SG/N9TUN4', 'G/SG/N10TUN2', 'G/SG/N11TUN2', 'G/AG/NTUN80'].map(symbol => ({ symbol, url: WTO(symbol) })),
);

/** A quantitative restriction imposed as a safeguard: import volumes are capped per period. It is not a duty. */
export interface TunisiaSafeguardQuota {
  id: string; kind: 'SAFEGUARD_QUANTITATIVE_RESTRICTION'; product: string;
  tariff_codes: readonly string[]; effective_from: string; effective_until: string;
  periods: readonly { from: string; until: string; quantity_tonnes: number }[];
  /** Developing-country WTO Members are exempt only while their import shares stay under both thresholds. */
  developing_country_exemption: { individual_share_max_percent: number; collective_share_max_percent: number; text: string };
  instrument: string; source_url: string;
}
/**
 * A WTO-bound minimum-access tariff quota. Tunisia publishes the quota volume and its administration, but no
 * national source publishes the applied in-quota rate, so it is carried as unknown — never as zero and never
 * as the general rate. The "ex" scopes are the heading/subheading prefixes the notification names.
 */
export interface TunisiaTariffQuota {
  id: string; product: string; hs_prefixes: readonly string[]; ex_scope: boolean; quota_quantity_tonnes: number;
  in_quota_rate: null; in_quota_rate_status: 'not_published_by_national_authority';
  /** A rate Tunisia reported to the WTO for a past quota year: provenance only, never applied to a later date. */
  reported_in_quota_rate?: { year: number; rate_percent: number; source: string };
}
/** A line-scoped relief conditioned on the goods' use or the importer's approval; never the ordinary rate. */
export interface TunisiaConditionalRelief {
  id: string; instrument: string; code_prefixes: readonly string[]; ex_scope: boolean; from: string; until: string | null;
  /** The relieved customs-duty rate when the instrument fixes one; null when it grants an exemption whose effect depends on the regime. */
  rate_percent: number | null; condition: string; source_url: string;
}
export interface TunisiaClosedInvestigation { product: string; opened: string; outcome: string; source: string }
export interface TunisiaTradeRemedyManifest {
  version: typeof TUNISIA_REMEDY_MANIFEST_VERSION; reference_date: string; register_enumeration_complete: true;
  anti_dumping_measures: readonly never[]; countervailing_measures: readonly never[];
  safeguards: readonly TunisiaSafeguardQuota[];
  special_agricultural_safeguard: { invoked: false; latest_notification: string; latest_year_covered: number; source_url: string };
  closed_investigations: readonly TunisiaClosedInvestigation[];
  tariff_quotas: readonly TunisiaTariffQuota[];
  trq_administration: string;
  conditional_reliefs: readonly TunisiaConditionalRelief[];
  completeness_basis: readonly string[];
}

const LF2026 = 'https://www.douane.gov.tn/wp-content/uploads/2026/01/038_2025-2.pdf';
const trq = (id: string, product: string, hs_prefixes: string[], quota_quantity_tonnes: number, ex_scope = true, extra: Partial<TunisiaTariffQuota> = {}): TunisiaTariffQuota => ({ id, product, hs_prefixes, ex_scope, quota_quantity_tonnes, in_quota_rate: null, in_quota_rate_status: 'not_published_by_national_authority', ...extra });

export const TUNISIA_TRADE_REMEDY_MANIFEST: TunisiaTradeRemedyManifest = Object.freeze({
  version: TUNISIA_REMEDY_MANIFEST_VERSION,
  reference_date: TUNISIA_REMEDY_REFERENCE_DATE,
  register_enumeration_complete: true,
  anti_dumping_measures: [],
  countervailing_measures: [],
  safeguards: [{
    id: 'TN-SG-2023-STEEL-WIRE', kind: 'SAFEGUARD_QUANTITATIVE_RESTRICTION',
    product: 'Wire of iron or non-alloy steel used in the manufacture of upholstery and mattress springs',
    tariff_codes: ['72171050002', '72171090100'], effective_from: '2023-11-28', effective_until: '2026-11-30',
    periods: [{ from: '2023-11-28', until: '2024-11-30', quantity_tonnes: 764 }, { from: '2024-12-01', until: '2025-11-30', quantity_tonnes: 1020 }, { from: '2025-12-01', until: '2026-11-30', quantity_tonnes: 1274 }],
    developing_country_exemption: { individual_share_max_percent: 3, collective_share_max_percent: 9, text: 'Imports from developing country WTO Members are not subject to the measure as long as each individual Member\'s exports do not exceed 3% of total imports into Tunisia and those countries collectively account for not more than 9%.' },
    instrument: 'Order of the Minister responsible for trade of 28 November 2023 (JORT No. 138-2023), notified as G/SG/N/8/TUN/1, G/SG/N/10/TUN/1, G/SG/N/11/TUN/1',
    source_url: TUNISIA_SAFEGUARD_NOTIFICATION_URL,
  }],
  special_agricultural_safeguard: { invoked: false, latest_notification: 'G/AG/N/TUN/74 (Table MA:5)', latest_year_covered: 2024, source_url: TUNISIA_SSG_LATEST_URL },
  closed_investigations: [
    { product: 'Glass bottles', opened: '2014-09-30', outcome: 'Closed without a measure (30/07/2015)', source: 'WT/TPR/S/479/Rev.1 table 3.6; G/SG/N/9/TUN/1' },
    { product: 'MDF wood fibreboard', opened: '2014-09-30', outcome: 'Closed without a measure (30/07/2015)', source: 'WT/TPR/S/479/Rev.1 table 3.6; G/SG/N/9/TUN/2' },
    { product: 'Ceramic tiles', opened: '2015-07-14', outcome: 'Closed without a measure (14/04/2016)', source: 'WT/TPR/S/479/Rev.1 table 3.6; G/SG/N/9/TUN/3' },
    { product: 'Minibuses', opened: '2021-10-01', outcome: 'Closed without a measure (19/07/2022)', source: 'WT/TPR/S/479/Rev.1 table 3.6; G/SG/N/6/TUN/6' },
  ],
  tariff_quotas: [
    trq('TUNQ001', 'Calves and young bulls', ['0102'], 3000), trq('TUNQ002', 'Meat of bovine animals', ['0201', '0202'], 8000),
    trq('TUNQ003', 'Meat of sheep', ['0204'], 380), trq('TUNQ004', 'Milk in powder', ['040210', '040221', '040229'], 20000),
    trq('TUNQ005', 'Butter', ['0405'], 4000, true, { reported_in_quota_rate: { year: 2024, rate_percent: 35, source: 'G/AG/N/TUN/79 note (1): in-quota 35% against the 36% ex-quota applied rate' } }), trq('TUNQ006', 'Cheese', ['0406'], 1500), trq('TUNQ007', 'Beans', ['071331'], 1300, false),
    trq('TUNQ008', 'Durum wheat', ['100111', '100119'], 300000), trq('TUNQ009', 'Common wheat', ['100191', '100199'], 600000),
    trq('TUNQ010', 'Barley', ['1003'], 200000), trq('TUNQ011', 'Sugar', ['1701'], 100000),
    trq('TUNQ012', 'Almonds, shelled', ['080212'], 1354, false), trq('TUNQ013', 'Tomato concentrate', ['200290'], 157, false),
  ],
  trq_administration: 'Decree No. 96-119 of 10 June 1996 (JORT No. 50 of 21 June 1996): a Ministry of Trade committee manages the quotas, allocated on traditional trade flows; a Special Tariff Quota Authorization valid two months is required to import at the reduced in-quota duty within Section I-B of the Schedule. Outside the quotas imports are effected with an import licence (G/AG/N/TUN/4). Cereals under quota are imported by the Office des céréales.',
  conditional_reliefs: [
    { id: 'TN-LF2026-ART47-4-EV-CHARGERS', instrument: 'Finance Law 2026 (Law No. 2025-17) article 47 paragraph 4', code_prefixes: ['85044055003', '853710'], ex_scope: true, from: '2026-01-01', until: '2028-12-31', rate_percent: 10, condition: 'Applies only to electric-vehicle chargers classified under 85044055003 and ex 8537.10 (VAT 7%), on a fiscal-privilege request at the import office (tax code 970, document code 275; BOD 039/2025). Tarifweb prints the general rate for these lines.', source_url: LF2026 },
    { id: 'TN-LF2026-ART46-LITHIUM-INPUTS', instrument: 'Finance Law 2026 (Law No. 2025-17) article 46', code_prefixes: ['391910', '392049', '392062', '760719', '850760', '853690', '8537'], ex_scope: true, from: '2026-01-01', until: null, rate_percent: null, condition: 'Exemption for inputs not manufactured locally that are necessary to manufacture lithium batteries; the beneficiary needs an annual programme approved by the Ministry of Industry. The exemption is a privileged regime, so the 15% legal minimum of collection in the autonomous tariff may limit it unless the regime is excepted; its effect is not determined here.', source_url: LF2026 },
  ],
  completeness_basis: [
    'WT/TPR/S/479/Rev.1 (14 October 2025) ¶3.51: Tunisia has taken no anti-dumping or countervailing action; ¶3.53 and table 3.6: one safeguard in force.',
    'The WTO safeguard notification series ends at G/SG/N/6/TUN/7, G/SG/N/8/TUN/1, G/SG/N/9/TUN/3, G/SG/N/10/TUN/1 and G/SG/N/11/TUN/1; the next symbol of each is probed and must be unpublished.',
    'Special agricultural safeguard not invoked (G/AG/N/TUN/73 for 2020, G/AG/N/TUN/74 for 2024). The agriculture series was read to its end: G/AG/N/TUN/75 (domestic support 2020) and 76–79 (quota fill 2021–2024, unchanged volumes); G/AG/N/TUN/80 is probed and must be unpublished.',
    'Tarifweb 2026 publishes no anti-dumping, countervailing, safeguard or supplementary-duty component on any of its lines.',
    'Every 2026 Bulletin officiel des douanes (001–034) and the Finance Law 2026 bulletin (038/2025) were reviewed; a new 2026 bulletin fails acquisition closed.',
  ],
}) as TunisiaTradeRemedyManifest;

export function validateTunisiaRemedyManifest(manifest: TunisiaTradeRemedyManifest) {
  if (manifest.version !== TUNISIA_REMEDY_MANIFEST_VERSION || manifest.register_enumeration_complete !== true) throw new Error('Tunisia trade-remedy manifest is not the reviewed complete enumeration.');
  for (const measure of manifest.safeguards) {
    if (!measure.tariff_codes.length || measure.tariff_codes.some(code => !/^\d{11}$/.test(code))) throw new Error(`Tunisia safeguard ${measure.id} lacks an eleven-digit tariff scope.`);
    if (!measure.periods.length || measure.periods.at(-1)!.until !== measure.effective_until) throw new Error(`Tunisia safeguard ${measure.id} lacks its quota calendar.`);
  }
  for (const quota of manifest.tariff_quotas) if (quota.in_quota_rate !== null) throw new Error(`Tunisia tariff quota ${quota.id} states an in-quota rate no national source publishes.`);
  if (manifest.tariff_quotas.length !== 13) throw new Error('Tunisia binds 13 WTO tariff quotas; the manifest does not list all of them.');
}

const covers = (prefixes: readonly string[], code: string) => prefixes.some(prefix => code.startsWith(prefix));
const within = (on: string, from: string, until: string | null) => from <= on && (!until || on <= until);

/** A safeguard quota applies to every origin; a developing-country exemption depends on import shares nobody here can observe. */
export function selectTunisiaSafeguards(manifest: TunisiaTradeRemedyManifest, code: string, at: Date) {
  const on = at.toISOString().slice(0, 10);
  return manifest.safeguards.filter(measure => measure.tariff_codes.includes(code) && measure.periods.some(period => within(on, period.from, period.until)));
}
export function tunisiaSafeguardPeriod(measure: TunisiaSafeguardQuota, at: Date) {
  const on = at.toISOString().slice(0, 10);
  return measure.periods.find(period => within(on, period.from, period.until)) ?? null;
}
export function selectTunisiaTariffQuotas(manifest: TunisiaTradeRemedyManifest, code: string) {
  return manifest.tariff_quotas.filter(quota => covers(quota.hs_prefixes, code));
}
export function selectTunisiaConditionalReliefs(manifest: TunisiaTradeRemedyManifest, code: string, at: Date) {
  const on = at.toISOString().slice(0, 10);
  return manifest.conditional_reliefs.filter(relief => covers(relief.code_prefixes, code) && within(on, relief.from, relief.until));
}

const empty = { specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null };
/** The relieved rate when the instrument fixes one; otherwise the relief is recorded verbatim, never as a percentage. */
export function tunisiaReliefDuty(relief: TunisiaConditionalRelief): ParsedDuty {
  if (relief.rate_percent !== null) return { kind: 'ad_valorem', ad_valorem_rate_percent: relief.rate_percent, ...empty, expression: `${relief.rate_percent}%`, note: `${relief.instrument}. ${relief.condition}` };
  return { kind: 'unparsed', ad_valorem_rate_percent: null, ...empty, expression: 'exemption (conditional)', note: `${relief.instrument}. ${relief.condition}` };
}
/** The in-quota rate is not published by any national source: unknown, never zero, never the general rate. */
export function tunisiaInQuotaDuty(quota: TunisiaTariffQuota): ParsedDuty {
  const reported = quota.reported_in_quota_rate ? ` Tunisia reported a ${quota.reported_in_quota_rate.rate_percent}% in-quota rate for ${quota.reported_in_quota_rate.year} (${quota.reported_in_quota_rate.source}); a past year's rate is not applied to a later date.` : '';
  return { kind: 'unparsed', ad_valorem_rate_percent: null, ...empty, expression: 'in-quota rate not published', note: `WTO tariff quota ${quota.id} (${quota.product}, ${quota.quota_quantity_tonnes.toLocaleString('en-US')} t/year). Tunisia publishes no applied in-quota rate for this date; access needs a Special Tariff Quota Authorization.${reported}` };
}
