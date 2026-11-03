/**
 * D-028 — the customs unions whose common external tariff is read as an official rate for their
 * members, labelled as a common tariff and below full quality because national exceptions are not
 * modelled. One release serves every member, as EU TARIC serves 27 markets.
 *
 * Members are listed only where the member applies the union tariff as its own: Cabo Verde keeps
 * its own Pauta Aduaneira, and South Sudan applies the EAC CET only in part, so neither is served
 * from a union release (their directory entries stay the source; docs/37 §4).
 *
 * The releases are pinned to the official files read on 18 Oct 2026 (ledger E-022): a new edition
 * is a reviewed code change, with its own checksums and line counts, like every Customs Atlas pack.
 */
import type { ParsedDuty } from '@/lib/market-access/tariff-semantics';
import type { NationalCodeSystem } from '@/lib/market-access/contract';
import { parseUnionRate, type EacGazetteMeasures, type UnionSourceLine } from './customs-union-parsers';

export type CustomsUnionKey = 'EAEU' | 'ECOWAS' | 'EAC';

export interface CustomsUnionSourceFile {
  name: string;
  role: string;
  url: string;
  sha256: string;
  size_bytes: number;
}

export interface CustomsUnionSource {
  key: CustomsUnionKey;
  /** Shown wherever a duty from this release is explained. */
  label: string;
  name: string;
  members: readonly string[];
  provider: string;
  source_family: string;
  authority: string;
  national_code_system: NationalCodeSystem;
  release: {
    identifier: string;
    reference_date: string;
    /** When the tariff read here is in force from. */
    effective_from: string;
    /** After this the release is not used: the next yearly measures must be read first. */
    valid_until: string | null;
    source_url: string;
    files: readonly CustomsUnionSourceFile[];
    line_count: number;
    provenance: string;
  };
  /** What is not modelled for each member, said with every duty read for it. */
  member_notes: Readonly<Record<string, string>>;
  india_preference: { applicability: 'not_applicable' | 'unknown'; basis: string };
}

const ECOWAS_LEVIES = 'The statistical levy (1%), the UEMOA solidarity levy (0.8%) and the ECOWAS levy (0.5%) are charged on top and are not in this duty.';
const ECOWAS_NATIONAL = 'Applies the ECOWAS common external tariff; national supplementary measures and the ECOWAS levy (0.5%) are not in this duty.';
const EAC_STAYS = 'Its stays of application and specified rates under Legal Notice EAC/160/2026 are not scored automatically; nor is duty remission for registered manufacturers.';

export const CUSTOMS_UNION_SOURCES: Readonly<Record<CustomsUnionKey, CustomsUnionSource>> = Object.freeze({
  EAEU: {
    key: 'EAEU',
    label: 'EAEU common customs tariff',
    name: 'Common Customs Tariff of the Eurasian Economic Union (Council Decision No. 80 of 14 Sep 2021, consolidated)',
    members: ['AM', 'BY', 'KG', 'KZ', 'RU'],
    provider: 'eaeu_common_customs_tariff',
    source_family: 'EAEU_CCT',
    authority: 'Eurasian Economic Commission — Common Customs Tariff (Council Decision No. 80), consolidated text on Kazakhstan’s Legal Information System (Adilet)',
    national_code_system: 'EAEU_CN_FEA',
    release: {
      identifier: 'adilet-H21EV000080-2026-09-15',
      reference_date: '2026-09-15',
      effective_from: '2022-01-01',
      valid_until: null,
      source_url: 'https://adilet.zan.kz/rus/docs/H21EV000080',
      files: [{ name: 'adilet-H21EV000080.json', role: 'official_consolidated_legal_text', url: 'https://adilet.zan.kz/api/documents/73e0e02f-1a0d-48f8-8b28-fbccf4234c08', sha256: '3472477481dc3953e2350a13068f0876eda39606ad81028d0add59294af0ed88', size_bytes: 5_349_622 }],
      line_count: 13_007,
      provenance: 'The consolidated Russian text kept by the Institute of Legislation and Legal Information of Kazakhstan (portal status “upd”, last updated 15 Sep 2026), retrieved 18 Oct 2026 through the owner’s browser. Its editor’s note announces amendments to the nomenclature by Board Decision No. 43 of 7 Apr 2026 (in force no earlier than 1 Jul 2026) that the text did not yet carry.',
    },
    member_notes: {
      AM: 'Armenia applies rates below the common tariff on lines listed under its WTO commitments; those are not modelled.',
      BY: 'Belarus applies the common tariff; trade remedies and sanctions-related measures are not modelled.',
      KG: 'Kyrgyzstan applies rates below the common tariff on lines listed under its WTO commitments; those are not modelled.',
      KZ: 'Kazakhstan applies rates below the common tariff on lines listed under its WTO commitments; those are not modelled.',
      RU: 'Russia applies the common tariff; trade remedies and sanctions-related measures are not modelled.',
    },
    india_preference: { applicability: 'unknown', basis: 'EAEU tariff preferences for developing countries, where they cover Indian goods, are not modelled; the common tariff rate is used.' },
  },
  ECOWAS: {
    key: 'ECOWAS',
    label: 'ECOWAS common external tariff',
    name: 'ECOWAS common external tariff, UEMOA edition (Tarif Extérieur Commun 2022, version 4)',
    members: ['BF', 'BJ', 'CI', 'GH', 'GM', 'GN', 'GW', 'LR', 'ML', 'NE', 'NG', 'SL', 'SN', 'TG'],
    provider: 'ecowas_cet_uemoa_tec_2022',
    source_family: 'ECOWAS_CET_UEMOA_TEC',
    authority: 'UEMOA Commission — Tarif Extérieur Commun 2022 (version 4), the UEMOA edition of the ECOWAS common external tariff',
    national_code_system: 'ECOWAS_CET_NTS',
    release: {
      identifier: 'uemoa-tec-2022-v4',
      reference_date: '2024-09-01',
      effective_from: '2022-01-01',
      valid_until: null,
      source_url: 'https://e-docucenter.uemoa.int/sites/default/files/2024-09/UEMOA_TEC2022_V4.pdf',
      files: [{ name: 'UEMOA_TEC2022_V4.pdf', role: 'official_common_external_tariff', url: 'https://e-docucenter.uemoa.int/sites/default/files/2024-09/UEMOA_TEC2022_V4.pdf', sha256: 'e7774d3fbcc565adfd24b063bffe7f1f079c094b66116cecea0289bfb278c5ae', size_bytes: 2_739_663 }],
      line_count: 6_380,
      provenance: 'The UEMOA Commission’s document centre, retrieved 18 Oct 2026 through the owner’s browser. The DD column is the ECOWAS common external tariff, applied by all fourteen members listed.',
    },
    member_notes: {
      BF: ECOWAS_LEVIES, BJ: ECOWAS_LEVIES, CI: ECOWAS_LEVIES, GW: ECOWAS_LEVIES, ML: ECOWAS_LEVIES, NE: ECOWAS_LEVIES, SN: ECOWAS_LEVIES, TG: ECOWAS_LEVIES,
      GH: `${ECOWAS_NATIONAL} Ghana’s import adjustment measures on listed lines are not modelled.`,
      GM: ECOWAS_NATIONAL, GN: ECOWAS_NATIONAL, LR: ECOWAS_NATIONAL,
      NG: `${ECOWAS_NATIONAL} Nigeria’s import adjustment tax on listed lines is not modelled.`,
      SL: `${ECOWAS_NATIONAL} Sierra Leone’s annual Finance Act measures are not modelled.`,
    },
    india_preference: { applicability: 'not_applicable', basis: 'India has no trade agreement with ECOWAS or UEMOA; the common external tariff applies.' },
  },
  EAC: {
    key: 'EAC',
    label: 'EAC common external tariff',
    name: 'East African Community common external tariff (CET 2022 as updated June 2025, with Legal Notice EAC/160/2026)',
    members: ['BI', 'KE', 'RW', 'TZ', 'UG'],
    provider: 'eac_common_external_tariff',
    source_family: 'EAC_CET',
    authority: 'East African Community — Common External Tariff 2022 (updated June 2025) and EAC Gazette Vol. AT 1 No. 16 (30 June 2026)',
    national_code_system: 'EAC_CET_HS2022',
    release: {
      identifier: 'eac-cet-2022-jun2025-ln160-2026',
      reference_date: '2026-06-30',
      effective_from: '2026-07-01',
      valid_until: '2027-06-30',
      source_url: 'https://eabc-online.com/download/eac-common-external-tariff-version-2022-as-updated-june-2025/?wpdmdl=11694',
      files: [
        { name: 'EAC-CET-2022-updated-June-2025.pdf', role: 'official_common_external_tariff', url: 'https://eabc-online.com/download/eac-common-external-tariff-version-2022-as-updated-june-2025/?wpdmdl=11694', sha256: '9d894c290304a75b2a77db3d16eabc73aa172eeb3a09a0d76668e6fc95b9af9f', size_bytes: 4_818_693 },
        { name: 'EAC-Gazette-AT-1-No-16-2026-06-30.pdf', role: 'official_gazette_yearly_measures', url: 'https://eabc-online.com/download/eac-gazette-volume-at-1-no-16-30-june-2026/?wpdmdl=12936', sha256: '555b8fdd7cc817ae5f729762913c5f8205e503a28170bad86a8a0f66e4c93907', size_bytes: 2_034_714 },
      ],
      line_count: 5_961,
      provenance: 'Both official EAC publications were retrieved 18 Oct 2026 from the East African Business Council’s document library, because the EAC Secretariat’s repository did not answer. Schedule 1 carries CET amendments to 30 June 2026; Legal Notice EAC/160/2026 sets the year from 1 July 2026: its amendment table changes ten CET lines, and its stays of application are national exceptions.',
    },
    member_notes: {
      BI: `Burundi: ${EAC_STAYS}`, KE: `Kenya: ${EAC_STAYS}`, RW: `Rwanda: ${EAC_STAYS}`, TZ: `Tanzania: ${EAC_STAYS}`, UG: `Uganda: ${EAC_STAYS}`,
    },
    india_preference: { applicability: 'not_applicable', basis: 'India has no trade agreement with the East African Community; the common external tariff applies.' },
  },
});

export const CUSTOMS_UNION_PROVIDERS: ReadonlyMap<string, CustomsUnionSource> = new Map(Object.values(CUSTOMS_UNION_SOURCES).map((source) => [source.provider, source]));

export function customsUnionSourceFor(countryCode: string): CustomsUnionSource | null {
  const code = countryCode.trim().toUpperCase();
  return Object.values(CUSTOMS_UNION_SOURCES).find((source) => source.members.includes(code)) ?? null;
}

/** A published line with the duty it carries and, where one applies, who it is not scored for. */
export interface CustomsUnionLine {
  code: string;
  description: string;
  unit: string | null;
  duty: ParsedDuty;
  raw_rate: string;
  locator: string;
  /** Lines a member applies differently: `members` empty means every member. */
  exception: { members: readonly string[]; reason: string } | null;
}

/** The ECOWAS lines: the DD column, read as a percentage. */
export function assembleEcowasLines(lines: readonly UnionSourceLine[]): CustomsUnionLine[] {
  return lines.map((line) => ({ code: line.code, description: line.description, unit: line.unit, duty: parseUnionRate(line.raw_rate, 'ECOWAS'), raw_rate: line.raw_rate, locator: line.locator, exception: null }));
}

/** The EAEU lines; a rate carrying a footnote of the tariff is not scored, because the note sets or conditions it. */
export function assembleEaeuLines(lines: readonly UnionSourceLine[]): CustomsUnionLine[] {
  return lines.map((line) => ({
    code: line.code, description: line.description, unit: line.unit, duty: parseUnionRate(line.raw_rate, 'EAEU'), raw_rate: line.raw_rate, locator: line.locator,
    exception: line.notes?.length ? { members: [], reason: `The rate carries note ${line.notes.join(', ')} of the Common Customs Tariff, which sets a temporary or conditional rate that is not read automatically.` } : null,
  }));
}

/**
 * The EAC lines as in force from 1 July 2026: Schedule 1, its sensitive items at their Schedule 2
 * rate, the year's amendment table applied, and the year's stays recorded as exceptions for the
 * partner state named (every partner state where a table names them row by row).
 */
export function assembleEacLines(schedule1: readonly UnionSourceLine[], schedule2: readonly UnionSourceLine[], measures: EacGazetteMeasures): CustomsUnionLine[] {
  const sensitive = new Map(schedule2.map((line) => [line.code, line]));
  const amended = new Map(measures.amendments.map((item) => [item.code, item]));
  const stays = new Map<string, { members: Set<string>; all: boolean; tables: Set<string> }>();
  for (const stay of measures.stays) {
    const entry = stays.get(stay.code) ?? { members: new Set<string>(), all: false, tables: new Set<string>() };
    if (stay.members.length) for (const member of stay.members) entry.members.add(member); else entry.all = true;
    entry.tables.add(stay.table);
    stays.set(stay.code, entry);
  }
  return schedule1.map((line) => {
    let rate = line.raw_rate;
    let locator = line.locator;
    if (rate === 'SI') {
      const item = sensitive.get(line.code);
      if (item) { rate = item.raw_rate; locator = `${line.locator}; Schedule 2 ${item.locator}`; }
    }
    const amendment = amended.get(line.code);
    if (amendment) { rate = amendment.raw_rate; locator = `${locator}; ${amendment.locator}`; }
    const stay = stays.get(line.code);
    const exception = stay
      ? { members: stay.all ? [] : [...stay.members].sort(), reason: `Named in ${measures.notice} (table${stay.tables.size > 1 ? 's' : ''} ${[...stay.tables].join(', ')}): a stay of application or a specified national rate for the year from 1 July 2026${stay.all ? '; the partner states are not read row by row, so it is not scored for any member' : ''}.` }
      : null;
    return { code: line.code, description: line.description, unit: line.unit, duty: parseUnionRate(rate, 'EAC'), raw_rate: rate, locator, exception };
  });
}
