/**
 * D-030 — retained tariff schedules read automatically so agents no longer check these markets,
 * one release per official publication, each serving one or more markets:
 *
 * - a market's own national tariff (`national_schedule`): scored like an agent's reading of the
 *   official tariff (D-031, quality 0.9) and said to leave trade remedies and temporary measures
 *   unchecked — China's 2026 tariff, Brazil's applied tariff;
 * - a customs union's common tariff (`common_tariff`, D-028, quality 0.8, labelled as such): the GCC
 *   unified customs tariff for the UAE and Bahrain, the Mercosur common external tariff for
 *   Argentina, Paraguay and Uruguay.
 *
 * India's preferential rate is read where the official text publishes it for India: the UAE's CEPA
 * schedule (Annex 2B) and China's Asia-Pacific Trade Agreement column. Releases are pinned to the
 * files read on 19 Oct 2026 (ledger E-025); a new edition is a reviewed code change.
 */
import type { NationalCodeSystem } from '@/lib/market-access/contract';
import type { ParsedDuty } from '@/lib/market-access/tariff-semantics';
import {
  TariffScheduleParseError, type BrazilCamexData, type CepaScheduleRow, type ChinaProvisionalEntry, type ChinaTariffRow, type GccTariffRow,
} from './tariff-schedule-readers';

export type TariffScheduleKey = 'GCC' | 'MERCOSUR' | 'CN' | 'BR';
export type ScheduleBasis = 'common_tariff' | 'national_schedule';

export interface TariffScheduleFile { name: string; role: string; url: string; sha256: string; size_bytes: number }

export interface TariffScheduleCountry {
  basis: ScheduleBasis;
  /** What is not modelled for this market, said with every duty read for it. */
  note: string;
  /** Used where the resolved line carries no India rate. */
  india_preference: { applicability: 'not_applicable' | 'unknown'; basis: string };
}

export interface TariffScheduleSource {
  key: TariffScheduleKey;
  /** Shown wherever a duty from this release is explained. */
  label: string;
  name: string;
  provider: string;
  source_family: string;
  authority: string;
  national_code_system: NationalCodeSystem;
  countries: Readonly<Record<string, TariffScheduleCountry>>;
  release: {
    identifier: string;
    reference_date: string;
    effective_from: string;
    valid_until: string | null;
    source_url: string;
    files: readonly TariffScheduleFile[];
    line_count: number;
    provenance: string;
    /** Why the files may be retained and their tariff facts used (each cluster's rights check, D-030). */
    rights: string;
  };
}

export interface ScheduleIndiaPreference {
  countries: readonly string[];
  program: string;
  /** direct: published for India by name (CEPA); group: published for an agreement the text says covers India (APTA). */
  scope: 'direct' | 'group';
  raw_rate: string;
  locator: string;
  is_quota: boolean;
  /** A single rate, or a staged schedule (rates for years 1–10 counted from entry into force). */
  duty?: ParsedDuty;
  staging?: { entry_into_force: string; years: readonly string[] };
}

export interface ScheduleDatedRate { from: string | null; to: string | null; duty: ParsedDuty; raw_rate: string; locator: string }

/** One published line, with what applies to it beyond its printed duty. */
export interface ScheduleLine {
  code: string;
  description: string;
  unit: string | null;
  duty: ParsedDuty;
  raw_rate: string;
  locator: string;
  /** Not scored automatically for the countries named (empty: every country the release serves). */
  exception: { countries: readonly string[]; reason: string } | null;
  /** Rates that replace the duty while in force; more than one distinct rate in force is not scored. */
  dated?: readonly ScheduleDatedRate[];
  /** Measures for part of the line or within a quota: said with it, never scored. */
  notes?: readonly string[];
  india_preference?: ScheduleIndiaPreference | null;
}

// --- duty helpers -------------------------------------------------------------------------------

const blank = { ad_valorem_rate_percent: null, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null, note: null } as const;
export const adValorem = (percent: number, expression: string, note: string | null = null): ParsedDuty => ({ ...blank, kind: 'ad_valorem', ad_valorem_rate_percent: percent, expression, note });
const unparsed = (expression: string, note: string): ParsedDuty => ({ ...blank, kind: 'unparsed', expression, note });
const specific = (amount: number, currency: string, unit: string, quantity: number, expression: string, note: string | null = null): ParsedDuty => ({ ...blank, kind: 'specific', specific_amount: amount, specific_currency: currency, specific_unit: unit, specific_unit_quantity: quantity, expression, note });
const number = (value: string) => Number(value.replace(',', '.'));
const NUMERIC = /^\d+(?:[.,]\d+)?$/;

// --- the four releases ----------------------------------------------------------------------------

const GCC_NOTE = 'The GCC unified customs tariff as Dubai Customs publishes it; this market’s own exemptions, trade remedies and other national measures are not modelled.';
const MERCOSUR_NOTE = (country: string) => `The Mercosur common external tariff (Annex I of Gecex Resolution 272/2021, as Brazil publishes it); ${country}’s national exception lists, capital-goods and IT regimes and trade remedies are not modelled.`;
const SCHEDULE_NOTE = 'Read from the official tariff; trade remedies (anti-dumping, countervailing and safeguard duties) and temporary measures outside it are not checked.';
const RETAINED = 'ClearTrade retains the official files as provenance and uses their tariff facts only; it claims no right in website presentation, software or any original compilation arrangement.';
const BRAZIL_RIGHTS = `Brazil Law 9.610/1998, Article 8(IV), excludes the texts of treaties, laws, decrees, regulations and other official acts from copyright protection; Gecex Resolution 272/2021 and its annexes are official acts. ${RETAINED}`;

const CAMEX_FILE: TariffScheduleFile = {
  name: 'camex-anexos-i-a-x-resolucao-gecex-272-21-2026-10-05.xlsx', role: 'official_tariff_workbook',
  url: 'https://www.gov.br/mdic/pt-br/assuntos/camex/estrategia-comercial/arquivos-listas/05-10-2026-anexos-i-a-x-resolucao-gecex-272-21.xlsx',
  sha256: '37954a6f4ee2b4aeeec8b44c93f25399a225690103a64d59b81389c0ec189716', size_bytes: 1_439_408,
};

export const TARIFF_SCHEDULE_SOURCES: Readonly<Record<TariffScheduleKey, TariffScheduleSource>> = Object.freeze({
  GCC: {
    key: 'GCC',
    label: 'GCC common customs tariff',
    name: 'GCC unified customs tariff (12-digit integrated tariff, Dubai Customs update of 23 Jul 2025), with the UAE’s CEPA schedule for Indian goods',
    provider: 'gcc_unified_customs_tariff',
    source_family: 'GCC_UNIFIED_TARIFF',
    authority: 'Dubai Customs — GCC Unified Customs Tariff (12-digit Integrated Customs Tariff); UAE Schedule of Specific Tariff Commitments under the India–UAE CEPA (Annex 2B)',
    national_code_system: 'GCC_INTEGRATED',
    countries: {
      AE: { basis: 'common_tariff', note: `${GCC_NOTE} India’s CEPA rate is read from the UAE’s schedule (Annex 2B) where its code matches the 2022 tariff.`, india_preference: { applicability: 'unknown', basis: 'The UAE’s CEPA schedule (HS 2017 codes) has no line matching this 2022 tariff line, so no CEPA rate is stated.' } },
      BH: { basis: 'common_tariff', note: GCC_NOTE, india_preference: { applicability: 'not_applicable', basis: 'India has no trade agreement with Bahrain or the GCC in force; the common tariff applies.' } },
    },
    release: {
      identifier: 'gcc-ict-dubai-2025-07-23-uae-cepa-annex2b',
      reference_date: '2025-07-23',
      effective_from: '2025-08-01',
      valid_until: null,
      source_url: 'https://www.dubaicustoms.gov.ae/en/PoliciesAndNotices/Documents/IntegratedCustomsTariff.pdf',
      files: [
        { name: 'IntegratedCustomsTariff.pdf', role: 'official_common_tariff', url: 'https://www.dubaicustoms.gov.ae/en/PoliciesAndNotices/Documents/IntegratedCustomsTariff.pdf', sha256: 'f1be90978149db7964713eff9d963745374637014ca00e50fa0fb9d625b5d5eb', size_bytes: 13_777_457 },
        { name: 'Schedule-of-UAE.pdf', role: 'official_preference_schedule', url: 'https://leatherindia.org/wp-content/uploads/2026/02/Schedule-of-UAE.pdf', sha256: 'b9cd37fdca216f5aa6864815b2fdd6a8193c19f85eb95c7dcd557dfbbb5cd475', size_bytes: 1_445_387 },
      ],
      line_count: 13_449,
      provenance: 'Both files retrieved 19 Oct 2026 through the owner’s browser. The tariff is the GCC unified customs tariff list (2022 nomenclature, 12-digit codes) issued by Dubai Customs on 23 Jul 2025 with its notice 10/2025 (12-digit codes from 1 Aug 2025). The CEPA schedule is the Ministry of Commerce and Industry’s “Schedule of Specific Tariff Commitments of the UAE” (Annex 2B, PDF of 3 Mar 2022), as circulated by the Council for Leather Exports (circular of 29 Mar 2022); the ministry’s own page no longer resolves.',
      rights: `UAE Federal Decree-Law No. 38 of 2021, Article 3(2), excludes official documents — texts of laws, regulations, resolutions and international conventions — from copyright protection; the GCC unified tariff and the UAE’s schedule under the India–UAE CEPA are such documents. ${RETAINED} Dubai Customs’ own website terms of use were not located (ledger E-025).`,
    },
  },
  MERCOSUR: {
    key: 'MERCOSUR',
    label: 'Mercosur common external tariff',
    name: 'Mercosur common external tariff (TEC, HS 2022), Annex I of Gecex Resolution 272/2021 as published by CAMEX on 5 Oct 2026',
    provider: 'mercosur_tec_camex',
    source_family: 'MERCOSUR_TEC',
    authority: 'Brazil, Gecex/CAMEX — Annex I (Tarifa Externa Comum) of Gecex Resolution 272/2021, consolidated workbook',
    national_code_system: 'MERCOSUR_NCM_TEC',
    countries: {
      AR: { basis: 'common_tariff', note: MERCOSUR_NOTE('Argentina'), india_preference: { applicability: 'unknown', basis: 'India–Mercosur Preferential Trade Agreement margins are not read; the common tariff rate is used.' } },
      PY: { basis: 'common_tariff', note: MERCOSUR_NOTE('Paraguay'), india_preference: { applicability: 'unknown', basis: 'India–Mercosur Preferential Trade Agreement margins are not read; the common tariff rate is used.' } },
      UY: { basis: 'common_tariff', note: MERCOSUR_NOTE('Uruguay'), india_preference: { applicability: 'unknown', basis: 'India–Mercosur Preferential Trade Agreement margins are not read; the common tariff rate is used.' } },
    },
    release: {
      identifier: 'camex-tec-2026-10-05',
      reference_date: '2026-10-05',
      effective_from: '2022-04-01',
      valid_until: null,
      source_url: CAMEX_FILE.url,
      files: [CAMEX_FILE],
      line_count: 10_516,
      provenance: 'The CAMEX consolidated workbook of Annexes I–X (updated 5 Oct 2026; Annex I updated through Gecex Resolution 926 of 24 Jun 2026), retrieved 19 Oct 2026 through the owner’s browser. Annex I is the TEC in force since 1 Apr 2022.',
      rights: BRAZIL_RIGHTS,
    },
  },
  CN: {
    key: 'CN',
    label: 'China’s 2026 customs tariff',
    name: 'Customs Import and Export Tariff of the People’s Republic of China (2026), with Annex 1 (provisional import rates) of the 2026 tariff adjustment plan',
    provider: 'cn_customs_tariff_2026',
    source_family: 'CN_CUSTOMS_TARIFF',
    authority: 'Customs Tariff Commission of the State Council (国务院关税税则委员会) — 中华人民共和国进出口税则（2026）, Announcement 2025 No. 12; 2026年关税调整方案, Announcement 2025 No. 11',
    national_code_system: 'CN_CUSTOMS_TARIFF',
    countries: {
      CN: { basis: 'national_schedule', note: SCHEDULE_NOTE, india_preference: { applicability: 'not_applicable', basis: 'The 2026 tariff prints no Asia-Pacific Trade Agreement (AP) rate for this line, so India-origin goods pay the MFN rate (provisional rate where one applies).' } },
    },
    release: {
      identifier: 'cn-tariff-2026',
      reference_date: '2025-12-31',
      effective_from: '2026-01-01',
      valid_until: '2026-12-31',
      source_url: 'https://gss.mof.gov.cn/gzdt/zhengcefabu/202512/t20251231_3981044.htm',
      files: [
        { name: 'CN-2026-import-export-tariff.pdf', role: 'official_tariff', url: 'https://gss.mof.gov.cn/gzdt/zhengcefabu/202512/P020251231607833453633.pdf', sha256: '76af4db0b3af966ef4f95f4ffc6b4b2e34f1a95ef47f68e7299670a18b337d57', size_bytes: 70_026_277 },
        { name: 'CN-2026-annex1-provisional-import-rates.pdf', role: 'official_provisional_rates', url: 'https://gss.mof.gov.cn/gzdt/zhengcefabu/202512/P020251229510521217364.pdf', sha256: '0600b251820fe1f2c838dc4bad38dbb261f144ecd9417b927308ca5f86f02e20', size_bytes: 517_981 },
      ],
      line_count: 8_972,
      provenance: 'Both files retrieved 19 Oct 2026 through the owner’s browser from the Ministry of Finance’s Customs Tariff Commission pages. The tariff book prints MFN, provisional (△), agreement, special and general rates for every 8-digit line in force from 1 Jan 2026; Annex 1 lists the provisional rates, including those for part of a line (ex). Later 2026 announcements found (zero tariffs for African partners, measures on Canadian goods) do not concern Indian goods.',
      rights: `The Copyright Law of the People’s Republic of China (2020), Article 5, does not apply to resolutions, decisions and orders of State organs, other documents of an administrative nature, or mere information about facts; the Customs Tariff Commission’s 2026 tariff and adjustment plan are such documents. ${RETAINED}`,
    },
  },
  BR: {
    key: 'BR',
    label: 'Brazil’s CAMEX applied tariff',
    name: 'Brazil’s applied import tariff: Annexes I–X of Gecex Resolution 272/2021 as published by CAMEX on 5 Oct 2026',
    provider: 'br_camex_applied_tariff',
    source_family: 'BR_CAMEX_TARIFF',
    authority: 'Brazil, Gecex/CAMEX — Gecex Resolution 272/2021, Annexes I–X (TEC, Brazil’s different rates, exception lists), consolidated workbook',
    national_code_system: 'BR_NCM_CAMEX',
    countries: {
      BR: { basis: 'national_schedule', note: `${SCHEDULE_NOTE} Ex-tarifários and quota reductions cover part of a line or a volume and are not scored.`, india_preference: { applicability: 'unknown', basis: 'India–Mercosur Preferential Trade Agreement margins are not read; the applied rate is used.' } },
    },
    release: {
      identifier: 'camex-applied-2026-10-05',
      reference_date: '2026-10-05',
      effective_from: '2022-04-01',
      valid_until: null,
      source_url: CAMEX_FILE.url,
      files: [CAMEX_FILE],
      line_count: 10_516,
      provenance: 'The CAMEX consolidated workbook of Annexes I–X (updated 5 Oct 2026), retrieved 19 Oct 2026 through the owner’s browser. A line’s rate is Annex II’s applied rate where listed, else the TEC; a whole-line entry of the national exception lists (Annexes V, VI, IX) replaces it while in force.',
      rights: BRAZIL_RIGHTS,
    },
  },
});

export const TARIFF_SCHEDULE_PROVIDERS: ReadonlyMap<string, TariffScheduleSource> = new Map(Object.values(TARIFF_SCHEDULE_SOURCES).map((source) => [source.provider, source]));

export function tariffScheduleSourceFor(countryCode: string): TariffScheduleSource | null {
  const code = countryCode.trim().toUpperCase();
  return Object.values(TARIFF_SCHEDULE_SOURCES).find((source) => code in source.countries) ?? null;
}

/** How v5 labels a duty from this provider for this market, or null when the provider is not a schedule. */
export function tariffScheduleBasisFor(provider: string, countryCode: string): { basis: ScheduleBasis; key: TariffScheduleKey; label: string } | null {
  const source = TARIFF_SCHEDULE_PROVIDERS.get(provider);
  const country = source?.countries[countryCode.trim().toUpperCase()];
  return source && country ? { basis: country.basis, key: source.key, label: source.label } : null;
}

// --- GCC unified tariff with the UAE's CEPA schedule -------------------------------------------

export const UAE_CEPA_ENTRY_INTO_FORCE = '2022-05-01';

function gccDuty(raw: string): { duty: ParsedDuty; exception: string | null } {
  const value = raw.trim();
  const percent = /^(\d+(?:\.\d+)?)%?$/.exec(value);
  if (percent) return { duty: adValorem(Number(percent[1]), `${Number(percent[1])}%`), exception: null };
  if (/^prohibited$/i.test(value)) return { duty: unparsed(value, 'The tariff marks the line PROHIBITED.'), exception: 'The tariff marks this line PROHIBITED: its import is not allowed.' };
  if (/^special goods$/i.test(value)) return { duty: unparsed(value, 'A special-goods line.'), exception: 'A special-goods line (imported only with special permission, under its own treatment): not read automatically.' };
  return { duty: unparsed(value, 'No rate is printed for this line.'), exception: null };
}

/**
 * The GCC lines, each with the UAE's CEPA rate for Indian goods where the schedule (HS 2017, eight
 * digits) has the same eight-digit code; an excluded line (category F, "EXC") carries none.
 */
export function assembleGccLines(rows: readonly GccTariffRow[], cepa: readonly CepaScheduleRow[]): ScheduleLine[] {
  const schedule = new Map(cepa.map((row) => [row.code, row]));
  return rows.map((row) => {
    const { duty, exception } = gccDuty(row.raw_rate);
    const commitment = schedule.get(row.code.slice(0, 8));
    let preference: ScheduleIndiaPreference | null = null;
    const notes: string[] = [];
    if (commitment) {
      if (commitment.years.every((year) => NUMERIC.test(year))) {
        preference = { countries: ['AE'], program: 'India–UAE CEPA, Annex 2B', scope: 'direct', raw_rate: `base ${commitment.base}, category ${commitment.category}`, locator: `Annex 2B ${commitment.locator} · ${commitment.code}`, is_quota: false, staging: { entry_into_force: UAE_CEPA_ENTRY_INTO_FORCE, years: commitment.years } };
      } else if (commitment.years.includes('EXC')) {
        notes.push(`Excluded from the UAE’s CEPA concessions (category ${commitment.category}, Annex 2B ${commitment.locator}).`);
      }
    }
    return { code: row.code, description: row.description, unit: row.unit, duty, raw_rate: row.raw_rate, locator: row.locator, exception: exception ? { countries: [], reason: exception } : null, ...(notes.length ? { notes } : {}), india_preference: preference };
  });
}

/** The CEPA year in force on a date, counting years from each anniversary of entry into force (the stricter reading). */
export function cepaYear(at: Date, entryIntoForce: string): number | null {
  const start = new Date(`${entryIntoForce}T00:00:00.000Z`);
  if (at < start) return null;
  let year = at.getUTCFullYear() - start.getUTCFullYear();
  const anniversary = Date.UTC(at.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  if (at.getTime() < anniversary) year -= 1;
  return year + 1;
}

// --- Mercosur common external tariff and Brazil's applied tariff -------------------------------

function tecDuty(raw: string): { duty: ParsedDuty; regime: 'BK' | 'BIT' | null } {
  const value = raw.replace(/\s+/g, '');
  const match = /^(\d+(?:[.,]\d+)?)(BK|BIT)?$/.exec(value);
  if (!match) return { duty: unparsed(raw, 'Not a TEC percentage.'), regime: null };
  return { duty: adValorem(number(match[1]!), `${number(match[1]!)}%`), regime: (match[2] as 'BK' | 'BIT' | undefined) ?? null };
}

/** The TEC lines for the common-tariff members; a capital-goods (BK) or IT (BIT) line is left to each member's own regime. */
export function assembleMercosurLines(data: BrazilCamexData): ScheduleLine[] {
  return data.tec.map((row) => {
    const { duty, regime } = tecDuty(row.raw);
    return {
      code: row.code, description: row.description, unit: null, duty, raw_rate: row.raw, locator: 'Anexo I (TEC)',
      exception: regime ? { countries: [], reason: `${regime === 'BK' ? 'A capital-goods (BK)' : 'An information-technology (BIT)'} line of the TEC: Mercosur members apply their own ${regime} regimes to it, so the common rate is not scored.` } : null,
    };
  });
}

const percentDuty = (raw: string, where: string) => {
  const value = raw.replace(/\s+/g, '').replace(/%$/, '');
  if (!NUMERIC.test(value)) throw new TariffScheduleParseError('unreadable_rate', `${where}: "${raw}" is not a percentage.`);
  return adValorem(number(value), `${number(value)}%`);
};

/**
 * Brazil's lines: Annex II's applied rate where the line is listed, else the TEC; whole-line entries of
 * Annexes V (LETEC), VI (LEBITBK) and IX (temporary increases) replace it between their dates; ex-tarifários,
 * quota reductions (IV, VIII, quota entries elsewhere) and the automotive ex list (X) are notes, not rates.
 */
export function assembleBrazilLines(data: BrazilCamexData): ScheduleLine[] {
  const applied = new Map(data.applied.map((row) => [row.code, row]));
  const exceptions = new Map<string, BrazilCamexData['exceptions']>();
  for (const entry of data.exceptions) exceptions.set(entry.code, [...(exceptions.get(entry.code) ?? []), entry]);
  return data.tec.map((row) => {
    const listed = applied.get(row.code);
    const duty = listed ? percentDuty(listed.applied_raw, `Annex II ${row.code}`) : tecDuty(row.raw).duty;
    const dated: ScheduleDatedRate[] = [];
    const notes: string[] = [];
    for (const entry of exceptions.get(row.code) ?? []) {
      const period = `${entry.from ?? '…'} to ${entry.to ?? 'open-ended'}`;
      const where = `Anexo ${entry.annex}${entry.act ? `, ${entry.act}` : ''}`;
      if (entry.ex === '-' && !entry.quota && ['V', 'VI', 'IX'].includes(entry.annex)) {
        dated.push({ from: entry.from, to: entry.to, duty: percentDuty(entry.raw_rate, `${where} ${row.code}`), raw_rate: entry.raw_rate, locator: where });
      } else if (entry.ex !== '-') {
        notes.push(`Ex ${entry.ex}: ${entry.raw_rate}% for “${entry.description}” (${where}; ${period}).`);
      } else {
        notes.push(`${entry.raw_rate}% within a quota of ${entry.quota} ${entry.quota_unit ?? ''}`.trim() + ` (${where}; ${period}).`);
      }
    }
    return {
      code: row.code, description: listed?.description || row.description, unit: null, duty, raw_rate: listed ? listed.applied_raw : row.raw,
      locator: listed ? 'Anexo II' : 'Anexo I (TEC)', exception: null, ...(dated.length ? { dated } : {}), ...(notes.length ? { notes } : {}),
    };
  });
}

// --- China ---------------------------------------------------------------------------------------

function chinaRate(raw: string, where: string): ParsedDuty {
  const value = raw.trim();
  if (NUMERIC.test(value)) return adValorem(number(value), `${number(value)}%`);
  const perKg = /^(?:最惠国|协定)?(?:暂定)?税率：\s*(\d+(?:\.\d+)?)\s*元\s*\/\s*千克。?$/.exec(value);
  if (perKg) return specific(Number(perKg[1]), 'CNY', 'kg', 1, value);
  const perSqm = /^(?:最惠国|协定)?(?:暂定)?税率：\s*(\d+(?:\.\d+)?)\s*元\s*\/\s*平方米。?$/.exec(value);
  if (perSqm) return specific(Number(perSqm[1]), 'CNY', 'm2', 1, value);
  const lower = /^最惠国暂定税率：\s*(\d+(?:\.\d+)?)%\s*或\s*(\d+(?:\.\d+)?)\s*元\s*\/\s*吨，两者从低。?$/.exec(value);
  if (lower) return { ...blank, kind: 'mixed', ad_valorem_rate_percent: Number(lower[1]), specific_amount: Number(lower[2]), specific_currency: 'CNY', specific_unit: 'kg', specific_unit_quantity: 1000, expression: value, note: 'The lower of the ad-valorem and the specific amount applies; no ad-valorem equivalent is invented.' };
  throw new TariffScheduleParseError('unreadable_rate', `${where}: "${raw}" is not a rate form read for China.`);
}

/**
 * China's lines as in force for 2026: the provisional rate where the book prints one for the whole
 * line (it replaces the MFN rate for MFN-treatment goods), else the MFN rate; the APTA rate is India's
 * preference (the tariff's rules name India among the agreement's beneficiaries). Annex 1 must agree
 * with the book on every whole-line provisional rate; its ex entries become notes.
 */
export function assembleChinaLines(rows: readonly ChinaTariffRow[], annex: readonly ChinaProvisionalEntry[]): ScheduleLine[] {
  const byCode = new Map(rows.map((row) => [row.code, row]));
  for (const entry of annex.filter((item) => !item.ex)) {
    const row = byCode.get(entry.code);
    if (!row) throw new TariffScheduleParseError('annex_code_missing', `Annex 1 lists ${entry.code}, which the tariff book does not print.`);
    if (!row.provisional) throw new TariffScheduleParseError('annex_disagrees', `Annex 1 gives ${entry.code} a provisional rate; the tariff book prints none.`);
    if (NUMERIC.test(entry.provisional) && entry.provisional !== row.provisional) throw new TariffScheduleParseError('annex_disagrees', `Annex 1 gives ${entry.code} ${entry.provisional}%; the tariff book prints △${row.provisional}.`);
  }
  const fullLine = new Set(annex.filter((item) => !item.ex).map((item) => item.code));
  for (const row of rows) if (row.provisional && !fullLine.has(row.code)) throw new TariffScheduleParseError('annex_disagrees', `The tariff book prints △ for ${row.code}; Annex 1 does not list it.`);
  const partial = new Map<string, ChinaProvisionalEntry[]>();
  for (const entry of annex.filter((item) => item.ex)) partial.set(entry.code, [...(partial.get(entry.code) ?? []), entry]);
  return rows.map((row) => {
    const where = `${row.code} (${row.locator})`;
    const mfn = chinaRate(row.mfn, where);
    const applied = row.provisional ? chinaRate(row.provisional, `${where} provisional`) : mfn;
    const notes: string[] = [];
    if (row.provisional) notes.push(`Provisional rate for 2026 in place of the MFN rate (${row.mfn}).`);
    if (row.mfn_note) notes.push(`Tariff-rate quota: ${row.mfn_note} The rate scored is the out-of-quota rate.`);
    for (const entry of partial.get(row.code) ?? []) notes.push(`A provisional rate of ${entry.provisional}% applies to part of this line only (“${entry.description}”, Annex 1 ${entry.locator}).`);
    const apta = row.apta
      ? { countries: ['CN'], program: 'Asia-Pacific Trade Agreement (亚太 AP)', scope: 'group' as const, raw_rate: row.apta, locator: `${row.locator} · agreement column`, is_quota: /配额/.test(row.apta), duty: chinaRate(row.apta, `${where} AP`) }
      : null;
    return {
      code: row.code, description: row.description, unit: null, duty: applied,
      raw_rate: row.provisional ? `MFN ${row.mfn}; provisional △${row.provisional}` : row.mfn, locator: row.locator,
      exception: row.ex ? { countries: [], reason: 'The line is printed with “ex”: its rate covers only the goods its description names.' } : null,
      ...(notes.length ? { notes } : {}), india_preference: apta,
    };
  });
}
