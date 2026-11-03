/**
 * ECGC Country Risk Classification List, short term (docs/36 §2, §4 metric 10).
 *
 * ECGC publishes the list as a bilingual PDF circular (Hindi / English) on `main.ecgc.in`. The
 * parser reads the PDF's text as `pdftotext -layout` (Poppler) writes it, because the circular has
 * no machine-readable edition; the import records the PDF's own URL and sha256 next to the text's,
 * so a release can always be traced back to the publisher's file (data/reference/manifest.json).
 *
 * Layout facts, from the 1 July 2026 list (12 pages):
 *   - four tables, in this order: "Countries in Open Cover", "Restricted Cover - Group I",
 *     "Restricted Cover – Group II" and "Off-Cover Countries", each numbered from 1;
 *   - a row is `serial  <Hindi name> / <English name>  <grade>`, the grade one of A1 … D;
 *   - a long name wraps: the line above the serial holds the Hindi name and the first part of the
 *     English one, the line below holds the rest of the English name;
 *   - a dependent territory names its parent in brackets ("Anguilla (UK)");
 *   - "*" after a name points to a footnote ("Iran*": USD-denominated exports are not covered);
 *   - every page repeats the effective date and ends "Page n of N".
 *
 * Parsing is strict: a page missing, a serial skipped, a line that looks like a row but is not
 * read as one, a name with no ISO identity or two names on one ISO code each fail the import with
 * the reason. Nothing is repaired silently.
 */
import { getAlpha2Code, isValid } from 'i18n-iso-countries';
import { z } from 'zod';
import { ReferenceDatasetFormatError } from './parsers';

export const ECGC_PARSER_VERSION = 'ecgc-st-list-text-parser-v1';

export const ECGC_GRADES = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D'] as const;
export const ECGC_COVERS = ['open', 'restricted_group_i', 'restricted_group_ii', 'off_cover'] as const;
export type EcgcGrade = (typeof ECGC_GRADES)[number];
export type EcgcCoverSection = (typeof ECGC_COVERS)[number];

export const ecgcRatingRowSchema = z.object({
  iso2: z.string().regex(/^[A-Z]{2}$/),
  grade: z.enum(ECGC_GRADES),
  cover: z.enum(ECGC_COVERS),
  /** The English name exactly as the circular prints it, brackets and markers included. */
  published_name: z.string().min(2),
  /** The row's number within its table. */
  serial: z.number().int().positive(),
  /** A footnote or table note that applies to this row, verbatim. */
  note: z.string().nullable(),
});
export type EcgcRatingRow = z.infer<typeof ecgcRatingRowSchema>;

/**
 * ECGC's spellings that ISO 3166-1's English names (as `i18n-iso-countries` holds them) do not
 * match, mapped by hand. Each was read against the circular; the key is the name with any trailing
 * "(parent)" removed. A name not here and not an ISO English name fails the import, so a new
 * spelling is reviewed rather than guessed.
 */
export const ECGC_NAME_TO_ISO2: Readonly<Record<string, string>> = {
  'Bonaire, St. Eustatius and Saba': 'BQ',
  'British Pacific (Pitcairn) Islands': 'PN',
  'British Virgin Islands': 'VG',
  Brunei: 'BN',
  'Cocos/Keeling Island': 'CC',
  'Congo Republic': 'CG',
  'Cote D’Ivoire': 'CI',
  Curacao: 'CW',
  'Democratic Republic of Congo': 'CD',
  /** ISO's English name is "Falkland Islands (Malvinas)". */
  'Falkland Islands': 'FK',
  'French South Atlantic Territories': 'TF',
  'Guinea Bissau': 'GW',
  'Heard Island and McDonald Island': 'HM',
  Laos: 'LA',
  Micronesia: 'FM',
  Moldova: 'MD',
  'Niue Island': 'NU',
  'Reunion Islands': 'RE',
  'Sao Tome & Principe': 'ST',
  'Sint Maarten': 'SX',
  'St. Christopher and Nevis': 'KN',
  'St. Helena and Ascension': 'SH',
  'St. Lucia': 'LC',
  'St. Pierre and Miquelon': 'PM',
  'St. Vincent and the Grenadines': 'VC',
  Syria: 'SY',
  'Timor Leste': 'TL',
  /** ECGC's spelling of Tokelau. */
  Tokealu: 'TK',
  'Turks and Caicos': 'TC',
  'US Minor outlying Islands': 'UM',
  'US Virgin Islands': 'VI',
  'Vatican City': 'VA',
};

/** One published row that covers several ISO territories. */
export const ECGC_NAME_TO_SEVERAL_ISO2: Readonly<Record<string, readonly string[]>> = {
  /** ISO 3166-1 codes the Channel Islands as Guernsey and Jersey. */
  'Channel Isles': ['GG', 'JE'],
};

/** Published rows with no ISO 3166-1 identity of their own, and why they are left out. */
export const ECGC_NAME_EXCLUSIONS: Readonly<Record<string, string>> = {
  'Canary Islands': 'An autonomous community of Spain with no ISO 3166-1 code; Spain (ES) has its own row.',
};

const GRADE = '(A1|A2|B1|B2|C1|C2|D)';
const FULL_ROW = new RegExp(`^\\s*(\\d{1,3})\\s+(\\S.*?)\\s+${GRADE}\\s*$`);
const BARE_ROW = new RegExp(`^\\s*(\\d{1,3})\\s+${GRADE}\\s*$`);
const ENDS_WITH_GRADE = new RegExp(`\\s${GRADE}\\s*$`);
const LEADING_NUMBER = /^\s*\d{1,3}\s/;
const DEVANAGARI = /[ऀ-ॿ‌‍]/;
const LAST_DEVANAGARI = /[ऀ-ॿ‌‍](?!.*[ऀ-ॿ‌‍])/;
const EFFECTIVE = /Country Risk Classification List with effect from\s+([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})/;
const PAGE = /^\s*Page\s+(\d+)\s+of\s+(\d+)\s*$/;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function sectionOf(line: string): EcgcCoverSection | null {
  if (/Countries in Open Cover/.test(line)) return 'open';
  if (/Restricted Cover\s*[-–—]\s*Group II\b/.test(line)) return 'restricted_group_ii';
  if (/Restricted Cover\s*[-–—]\s*Group I(?!I)/.test(line)) return 'restricted_group_i';
  if (/Off-Cover Countries/.test(line)) return 'off_cover';
  return null;
}

/** The English half of a "Hindi / English" cell: everything after the last Devanagari character. */
function englishPart(cell: string): string {
  const match = LAST_DEVANAGARI.exec(cell);
  const tail = match ? cell.slice(match.index + 1) : cell;
  return tail.replace(/^[^A-Za-z]+/, '').replace(/\s+/g, ' ').trim();
}

export interface ParsedEcgcList {
  effective_from: string;
  pages: number;
  rows: EcgcRatingRow[];
  published_rows: number;
  sections: Record<EcgcCoverSection, number>;
  excluded: { published_name: string; reason: string }[];
  several: { published_name: string; iso2: string[] }[];
  named_by_table: { published_name: string; iso2: string }[];
}

interface PublishedRow { cover: EcgcCoverSection; serial: number; grade: EcgcGrade; name: string; line: number }

export function parseEcgcCountryRiskText(bytes: Buffer): ParsedEcgcList {
  const lines = bytes.toString('utf8').replace(/^﻿/, '').replace(/\f/g, '').split(/\r?\n/);
  const at = (index: number) => `line ${index + 1}`;

  // --- the document's own identity: effective date on every page, every page present ----------
  const dates = new Set<string>();
  let year = 0;
  const pages: { page: number; of: number }[] = [];
  for (const line of lines) {
    const effective = EFFECTIVE.exec(line);
    if (effective) {
      const month = MONTHS.indexOf(effective[1]);
      if (month < 0) throw new ReferenceDatasetFormatError(`The effective date names an unknown month "${effective[1]}".`);
      year = Number(effective[3]);
      dates.add(`${effective[3]}-${String(month + 1).padStart(2, '0')}-${effective[2].padStart(2, '0')}`);
    }
    const page = PAGE.exec(line);
    if (page) pages.push({ page: Number(page[1]), of: Number(page[2]) });
  }
  if (dates.size !== 1) throw new ReferenceDatasetFormatError(dates.size ? `The pages disagree on the effective date: ${[...dates].join(', ')}.` : 'No "Country Risk Classification List with effect from …" line: this is not the ECGC short-term list.');
  const effectiveFrom = [...dates][0];
  if (Number.isNaN(Date.parse(`${effectiveFrom}T00:00:00Z`))) throw new ReferenceDatasetFormatError(`The effective date ${effectiveFrom} is not a calendar date.`);
  const pageCount = pages[0]?.of ?? 0;
  if (!pageCount || pages.length !== pageCount || pages.some((page, index) => page.page !== index + 1 || page.of !== pageCount)) {
    throw new ReferenceDatasetFormatError(`The page footers are not "Page 1 of N" … "Page N of N" in order (${pages.map((page) => `${page.page}/${page.of}`).join(', ') || 'none found'}): the text is incomplete.`);
  }

  // --- rows -------------------------------------------------------------------------------------
  const order: EcgcCoverSection[] = [...ECGC_COVERS];
  let section: EcgcCoverSection | null = null;
  const published: PublishedRow[] = [];
  const consumed = new Set<number>();
  const footnoteLines: string[] = [];
  let footnoteOpen = false;
  const sectionNotes = new Map<EcgcCoverSection, string[]>();
  const nonBlank = (from: number, step: 1 | -1) => {
    for (let index = from + step; index >= 0 && index < lines.length; index += step) if (lines[index].trim()) return index;
    return -1;
  };

  for (const [index, line] of lines.entries()) {
    const heading = sectionOf(line);
    if (heading) {
      if (section && order.indexOf(heading) < order.indexOf(section)) throw new ReferenceDatasetFormatError(`${at(index)}: the "${heading}" table appears after "${section}"; the tables are out of order.`);
      section = heading;
      continue;
    }
    if (/^\s*\*\s/.test(line)) { footnoteOpen = true; footnoteLines.push(line.trim().replace(/^\*\s*/, '')); continue; }
    if (footnoteOpen) {
      if (line.trim()) { footnoteLines.push(line.trim()); continue; }
      footnoteOpen = false;
    }
    if (section === 'off_cover' && /cover stands withdrawn/i.test(line)) {
      sectionNotes.set(section, [...(sectionNotes.get(section) ?? []), line.trim()]);
      continue;
    }
    const full = FULL_ROW.exec(line);
    const bare = full ? null : BARE_ROW.exec(line);
    if (!full && !bare) continue;
    if (!section) throw new ReferenceDatasetFormatError(`${at(index)}: a row appears before any table heading.`);
    let name: string;
    if (full) name = englishPart(full[2]);
    else {
      // A wrapped row: the English name starts on the line above and ends on the line below.
      const above = nonBlank(index, -1);
      const below = nonBlank(index, 1);
      if (above < 0 || below < 0 || consumed.has(above) || !DEVANAGARI.test(lines[above]) || DEVANAGARI.test(lines[below]) || FULL_ROW.test(lines[above]) || FULL_ROW.test(lines[below]) || BARE_ROW.test(lines[below])) {
        throw new ReferenceDatasetFormatError(`${at(index)}: serial ${bare![1]} has a grade but no name, and the lines around it are not a wrapped name.`);
      }
      consumed.add(above).add(below);
      name = `${englishPart(lines[above])} ${lines[below].trim()}`.replace(/\s+/g, ' ').trim();
    }
    if (!/[A-Za-z]{2}/.test(name)) throw new ReferenceDatasetFormatError(`${at(index)}: no English name could be read for serial ${(full ?? bare)![1]}.`);
    consumed.add(index);
    published.push({ cover: section, serial: Number((full ?? bare)![1]), grade: (full ? full[3] : bare![2]) as EcgcGrade, name, line: index });
  }

  // --- nothing that looks like a row went unread ------------------------------------------------
  for (const [index, line] of lines.entries()) {
    if (consumed.has(index)) continue;
    const isDateLine = DEVANAGARI.test(line) && new RegExp(`\\b${year}\\b`).test(line) && !ENDS_WITH_GRADE.test(line);
    if ((LEADING_NUMBER.test(line) && !isDateLine) || ENDS_WITH_GRADE.test(line)) {
      throw new ReferenceDatasetFormatError(`${at(index)} looks like a table row but was not read as one: "${line.trim().slice(0, 120)}".`);
    }
  }

  // --- serials run 1…n in each table ------------------------------------------------------------
  const sections = Object.fromEntries(ECGC_COVERS.map((cover) => [cover, 0])) as Record<EcgcCoverSection, number>;
  for (const cover of ECGC_COVERS) {
    const serials = published.filter((row) => row.cover === cover).map((row) => row.serial);
    const broken = serials.findIndex((serial, index) => serial !== index + 1);
    if (broken >= 0) throw new ReferenceDatasetFormatError(`The "${cover}" table skips or repeats a serial: expected ${broken + 1}, found ${serials[broken]}.`);
    sections[cover] = serials.length;
  }
  if (!sections.open) throw new ReferenceDatasetFormatError('No rows were read from the open-cover table.');

  // --- notes --------------------------------------------------------------------------------------
  const footnote = footnoteLines.length ? footnoteLines.join(' ').replace(/\s+/g, ' ') : null;
  const starred = published.filter((row) => row.name.endsWith('*'));
  if (starred.length && !footnote) throw new ReferenceDatasetFormatError(`${starred.map((row) => row.name).join(', ')} carry "*" but the list has no footnote.`);
  if (footnote && !starred.length) throw new ReferenceDatasetFormatError('The list has a "*" footnote but no row is marked with "*".');

  // --- ISO identity -----------------------------------------------------------------------------
  const rows: EcgcRatingRow[] = [];
  const excluded: ParsedEcgcList['excluded'] = [];
  const several: ParsedEcgcList['several'] = [];
  const namedByTable: ParsedEcgcList['named_by_table'] = [];
  const unmatched: string[] = [];
  const owner = new Map<string, string>();
  for (const row of published) {
    const base = row.name.replace(/\*$/, '').replace(/\s*\([^()]*\)\s*$/, '').trim();
    const note = [row.name.endsWith('*') ? footnote : null, ...(sectionNotes.get(row.cover) ?? [])].filter(Boolean).join(' ') || null;
    if (ECGC_NAME_EXCLUSIONS[base]) { excluded.push({ published_name: row.name, reason: ECGC_NAME_EXCLUSIONS[base] }); continue; }
    let codes: string[];
    if (ECGC_NAME_TO_SEVERAL_ISO2[base]) { codes = [...ECGC_NAME_TO_SEVERAL_ISO2[base]]; several.push({ published_name: row.name, iso2: codes }); }
    else if (ECGC_NAME_TO_ISO2[base]) { codes = [ECGC_NAME_TO_ISO2[base]]; namedByTable.push({ published_name: row.name, iso2: codes[0] }); }
    else {
      const code = getAlpha2Code(base, 'en');
      if (!code) { unmatched.push(`"${row.name}" (${row.cover} ${row.serial})`); continue; }
      codes = [code];
    }
    for (const iso2 of codes) {
      if (!isValid(iso2)) throw new ReferenceDatasetFormatError(`"${row.name}" maps to ${iso2}, which is not an ISO 3166-1 code.`);
      const previous = owner.get(iso2);
      if (previous) throw new ReferenceDatasetFormatError(`"${row.name}" and "${previous}" both map to ${iso2}.`);
      owner.set(iso2, row.name);
      rows.push(ecgcRatingRowSchema.parse({ iso2, grade: row.grade, cover: row.cover, published_name: row.name, serial: row.serial, note }));
    }
  }
  if (unmatched.length) throw new ReferenceDatasetFormatError(`No ISO 3166-1 identity for ${unmatched.join(', ')}. Review the spelling and add it to ECGC_NAME_TO_ISO2 if it is a country.`);

  rows.sort((a, b) => a.iso2.localeCompare(b.iso2));
  return { effective_from: effectiveFrom, pages: pageCount, rows, published_rows: published.length, sections, excluded, several, named_by_table: namedByTable };
}
