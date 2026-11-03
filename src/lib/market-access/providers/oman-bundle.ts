import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import type { ParsedDuty } from '@/lib/market-access/tariff-semantics';

export const OMAN_BUNDLE_READER_VERSION = 'rop-customs-pdf-bundle-reader-v1' as const;
export const OMAN_PDF_TABLE_VERSION = 'rop-customs-2026-coordinate-table-v1' as const;
export const OMAN_EXPECTED_PHYSICAL_ROWS = 14_364;
export const OMAN_EXPECTED_UNIQUE_CODES = 14_311;

export class OmanBundleError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'OmanBundleError';
  }
}

export type OmanIndiaCategory = 'A' | 'B' | 'C' | 'E' | 'X';

export interface OmanTariffLine {
  code: string;
  description: string;
  general_duty: ParsedDuty;
  additional_duty: ParsedDuty | null;
  india_category: OmanIndiaCategory | null;
  efta_category: string | null;
  singapore_category: string | null;
  usa_category: string | null;
  prohibited: boolean;
  source_pages: readonly number[];
}

export interface OmanAuthorityBundle {
  checksum: string;
  size_bytes: number;
  release_identifier: string;
  tariff_source_url: string;
  files: readonly { name: string; size_bytes: number; sha256: string; role: string }[];
  lines: ReadonlyMap<string, OmanTariffLine>;
  physical_row_count: number;
  reader_version: typeof OMAN_BUNDLE_READER_VERSION;
  table_parser_version: typeof OMAN_PDF_TABLE_VERSION;
}

export interface OmanPdfTextItem { str: string; x: number; y: number }
export interface OmanPdfPage { page_number: number; items: readonly OmanPdfTextItem[] }

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const stableText = (value: string) => value.replace(/\s+/g, ' ').trim();

function parsedDuty(expression: string, fields: Partial<ParsedDuty>): ParsedDuty {
  return {
    kind: fields.kind ?? 'unparsed', ad_valorem_rate_percent: fields.ad_valorem_rate_percent ?? null,
    specific_amount: fields.specific_amount ?? null, specific_currency: fields.specific_currency ?? null,
    specific_unit: fields.specific_unit ?? null, specific_unit_quantity: fields.specific_unit_quantity ?? null,
    expression, note: fields.note ?? null,
  };
}

export function parseOmanDutyCell(raw: string, field: 'general' | 'additional'): ParsedDuty {
  const value = stableText(raw)
    .replace(/ad\s*-?\s*valorem/gi, 'ad-valorem')
    .replace(/\bR\s*O\s*\.?(?=\s*\d)/gi, 'RO. ')
    .replace(/\s+([.,])/g, '$1');
  if (!value) return parsedDuty('', { kind: 'none', note: `The authority publishes no ${field} duty expression for this line; absence is not zero.` });
  if (/prohibited|ممنوع/i.test(value)) return parsedDuty(value, { kind: 'none', note: 'Import is prohibited; no customs-duty percentage is inferred.' });
  const percent = /^(\d+(?:[.,]\d+)?)\s*%$/.exec(value);
  if (percent) return parsedDuty(`${Number(percent[1]!.replace(',', '.'))}%`, { kind: 'ad_valorem', ad_valorem_rate_percent: Number(percent[1]!.replace(',', '.')) });

  const mixedPercent = /(\d+(?:[.,]\d+)?)\D{0,20}%/u.exec(value);
  const mixedMinimum = /minimum charge of\s*(?:RO\.\s*)?(\d+(?:[.,]\d+)?)\s*(?:per|for)\s*(?:(\d+)\s*)?(kg|cigar)/i.exec(value);
  if (mixedPercent && mixedMinimum) {
    const quantity = mixedMinimum[2] ? Number(mixedMinimum[2]) : 1;
    const unit = mixedMinimum[3]!.toLowerCase().includes('cigar') ? 'piece' : 'kg gross';
    const rate = Number(mixedPercent[1]!.replace(',', '.'));
    const minimum = Number(mixedMinimum[1]!.replace(',', '.'));
    return parsedDuty(value, {
      kind: 'mixed', ad_valorem_rate_percent: rate, specific_amount: minimum, specific_currency: 'OMR',
      specific_unit: unit, specific_unit_quantity: quantity,
      note: 'Apply the published ad-valorem duty subject to the published minimum specific charge; no ad-valorem equivalent is invented.',
    });
  }
  return parsedDuty(value, { kind: 'unparsed', note: 'The published Omani duty expression did not match the qualified percentage, prohibition or minimum-duty forms.' });
}

function cell(items: readonly OmanPdfTextItem[], x0: number, x1: number, low: number, high: number) {
  return stableText(items.filter((item) => item.x >= x0 && item.x < x1 && item.y >= low && item.y < high && item.str.trim())
    .sort((left, right) => right.y - left.y || left.x - right.x).map((item) => item.str.trim()).join(' '));
}

function dutyCell(items: readonly OmanPdfTextItem[], x0: number, x1: number, low: number, high: number, anchorY: number) {
  const candidates = items.filter((item) => item.x >= x0 && item.x < x1 && item.y >= low && item.y < high && item.str.trim());
  const joined = stableText([...candidates].sort((left, right) => right.y - left.y || left.x - right.x).map((item) => item.str.trim()).join(' '));
  if (/minimum charge/i.test(joined)) return joined;
  const direct = candidates.filter((item) => Math.abs(item.y - anchorY) <= 12 && (/^(?:\d+(?:[.,]\d+)?\s*%|PROHIBITED)$/i.test(item.str.trim()) || /ممنوع/.test(item.str)))
    .sort((left, right) => Math.abs(left.y - anchorY) - Math.abs(right.y - anchorY))[0];
  return direct?.str.trim() ?? '';
}

function symbolCell(items: readonly OmanPdfTextItem[], x0: number, x1: number, anchorY: number, allowed: RegExp) {
  return items
    .filter((item) => item.x >= x0 && item.x < x1 && Math.abs(item.y - anchorY) <= 12 && allowed.test(item.str.trim()))
    .sort((left, right) => Math.abs(left.y - anchorY) - Math.abs(right.y - anchorY) || left.x - right.x)[0]?.str.trim() ?? '';
}

/**
 * Parse the authority's fixed 2026 landscape table. Coordinates are deliberate source-schema
 * fields: a later layout must get a new parser version instead of being guessed through.
 */
export function parseOmanPdfPages(pages: readonly OmanPdfPage[], options: { minimum_rows?: number; require_reviewed_semantics?: boolean; require_complete_preferences?: boolean } = {}) {
  const physical: OmanTariffLine[] = [];
  for (const page of pages.filter((item) => item.page_number <= 314)) {
    const groups = new Map<string, OmanPdfTextItem[]>();
    const combined: Array<{ y: number; code: string }> = [];
    for (const item of page.items) {
      if (item.x < 675 || item.x >= 745) continue;
      if (/^(?:\d{2}\s+){5}\d{2}$/.test(item.str.trim())) {
        combined.push({ y: item.y, code: item.str.replace(/\s/g, '') });
        continue;
      }
      if (!/^\d{1,3}$/.test(item.str)) continue;
      // Individual glyph runs in the same code row can differ by a few hundredths of a point.
      // One decimal place is still far tighter than the smallest reviewed row height (~5 pt).
      const key = item.y.toFixed(1);
      const group = groups.get(key) ?? [];
      group.push(item);
      groups.set(key, group);
    }
    const anchors = [...groups.entries()].flatMap(([key, items]) => {
      const ordered = [...items].sort((left, right) => left.x - right.x);
      let code = ordered.map((item) => item.str).join('');
      // Three ceramic-tile rows in the authority PDF merge the fourth "00" group and
      // the first digit of the fifth group into a printed/extracted "009" token.
      // The column geometry and adjacent 12-digit sequence make the omitted zero explicit.
      if (code.length === 11 && ordered.length === 5 && ordered[3]!.str.length === 3) code = `${code.slice(0, 6)}0${code.slice(6)}`;
      return /^\d{12}$/.test(code) ? [{ y: Number(key), code }] : [];
    }).concat(combined).filter((item) => /^\d{12}$/.test(item.code)).sort((left, right) => right.y - left.y);

    anchors.forEach((anchor, index) => {
      const before = anchors[index - 1];
      const after = anchors[index + 1];
      const high = before ? (before.y + anchor.y) / 2 : anchor.y + Math.max(5, after ? (anchor.y - after.y) / 2 : 12);
      const low = after ? (anchor.y + after.y) / 2 : anchor.y - Math.max(5, before ? (before.y - anchor.y) / 2 : 12);
      const general = parseOmanDutyCell(dutyCell(page.items, 240, 295, low, high, anchor.y), 'general');
      const additional = parseOmanDutyCell(dutyCell(page.items, 295, 344.5, low, high, anchor.y), 'additional');
      const india = symbolCell(page.items, 145, 175, anchor.y, /^[ABCEX]$/);
      const efta = symbolCell(page.items, 175, 202, anchor.y, /^(?:[ABCPX]|RC)$/);
      const singapore = symbolCell(page.items, 202, 220, anchor.y, /^[ABC]$/);
      const usa = symbolCell(page.items, 220, 240, anchor.y, /^[ABCDEHI]$/);
      // Numeric strings in footnotes occasionally sit in the code column. A declarable tariff
      // line always has at least one treatment field; discard only anchors with none at all.
      if (general.kind === 'none' && additional.kind === 'none' && !india && !efta && !singapore && !usa) return;
      const prohibited = general.expression.toLowerCase().includes('prohibited') || /ممنوع/.test(general.expression)
        || additional.expression.toLowerCase().includes('prohibited') || /ممنوع/.test(additional.expression)
        || india === 'E';
      physical.push({
        code: anchor.code,
        // English is the primary display description. One reviewed ceramic remedy row has no
        // English text object in the consolidated PDF even though its Arabic description is
        // present; use that authority text rather than inventing a label or borrowing a sibling.
        description: cell(page.items, 344.5, 515, low, high) || cell(page.items, 515, 675, low, high) || `Omani tariff line ${anchor.code}`,
        general_duty: general,
        additional_duty: additional.kind === 'none' ? null : additional,
        india_category: /^[ABCEX]$/.test(india) ? india as OmanIndiaCategory : null,
        efta_category: efta || null,
        singapore_category: singapore || null,
        usa_category: usa || null,
        prohibited,
        source_pages: [page.page_number],
      });
    });
  }
  const minimumRows = options.minimum_rows ?? 14_000;
  if (physical.length < minimumRows) throw new OmanBundleError('incomplete_pdf_table', `The Omani tariff parser found only ${physical.length} physical rows.`);
  const lines = new Map<string, OmanTariffLine>();
  for (const row of physical) {
    const existing = lines.get(row.code);
    if (!existing) { lines.set(row.code, row); continue; }
    const comparable = (line: OmanTariffLine) => JSON.stringify({ general_duty: line.general_duty, additional_duty: line.additional_duty, india_category: line.india_category, efta_category: line.efta_category, singapore_category: line.singapore_category, usa_category: line.usa_category, prohibited: line.prohibited });
    if (comparable(existing) !== comparable(row)) throw new OmanBundleError('conflicting_duplicate_line', `Omani tariff code ${row.code} repeats with materially different treatment on page ${row.source_pages[0]}.`);
    lines.set(row.code, { ...existing, description: stableText(`${existing.description}; ${row.description}`), source_pages: [...existing.source_pages, ...row.source_pages] });
  }
  const unparsed = [...lines.values()].flatMap((line) => [line.general_duty, line.additional_duty].filter((item): item is ParsedDuty => Boolean(item)).filter((item) => item.kind === 'unparsed').map((duty) => ({ line, duty })));
  if (unparsed.length) throw new OmanBundleError('unparsed_duty_expression', `The Omani tariff contains ${unparsed.length} unparsed duty expressions; first: ${unparsed[0]!.line.code} page ${unparsed[0]!.line.source_pages[0]}: ${unparsed[0]!.duty.expression}`);
  const incompletePreferences = [...lines.values()].filter((line) => !line.india_category);
  if ((options.require_complete_preferences ?? false) && incompletePreferences.length) throw new OmanBundleError('incomplete_preference_columns', `The Omani tariff contains ${incompletePreferences.length} lines without a parsed India category; first: ${incompletePreferences[0]!.code} page ${incompletePreferences[0]!.source_pages[0]}.`);
  if ((options.require_reviewed_semantics ?? true) && (![...lines.values()].some((line) => line.general_duty.kind === 'mixed') || ![...lines.values()].some((line) => line.additional_duty?.kind === 'ad_valorem'))) {
    throw new OmanBundleError('missing_reviewed_semantics', 'The Omani tariff no longer contains the reviewed minimum-duty and anti-dumping forms.');
  }
  return { lines, physical_row_count: physical.length };
}

interface NormalizedArtifact { table_parser_version: string; physical_row_count: number; lines: Array<Omit<OmanTariffLine, 'general_duty' | 'additional_duty'> & { general_duty: ParsedDuty; additional_duty: ParsedDuty | null }> }

export function serializeOmanLines(parsed: ReturnType<typeof parseOmanPdfPages>) {
  const normalized: NormalizedArtifact = { table_parser_version: OMAN_PDF_TABLE_VERSION, physical_row_count: parsed.physical_row_count, lines: [...parsed.lines.values()].sort((left, right) => left.code.localeCompare(right.code)) };
  return Buffer.from(JSON.stringify(normalized), 'utf8');
}

const EXPECTED = [
  ['customs-tariff-2026.pdf', 'official_consolidated_national_tariff'],
  ['anti-dumping-current.pdf', 'official_current_national_trade_remedy_schedule'],
  ['gcc-anti-dumping-extension-55.pdf', 'official_gcc_trade_remedy_extension_instrument'],
  ['anti-dumping-tiles.xlsx', 'official_national_trade_remedy_legacy_cross_check'],
  ['user-guides.html', 'official_current_tariff_and_customs_fee_index'],
  ['india-cepa.html', 'official_effective_date_concession_and_origin_guidance'],
  ['india-cepa-rules-of-origin.pdf', 'official_agreement_rules_of_origin_chapter'],
  ['india-cepa-product-specific-rules.pdf', 'official_agreement_product_specific_rules'],
  ['copyright-law-article-4.txt', 'wipo_lex_reproduction_of_oman_law_article_4'],
  ['normalized-lines.json', 'deterministic_coordinate_parser_output'],
] as const;

export async function readOmanAuthorityBundle(args: { bytes: Buffer; release_identifier: string }): Promise<OmanAuthorityBundle> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(args.bytes); } catch { throw new OmanBundleError('corrupt_archive', 'The Oman authority bundle is not a readable ZIP archive.'); }
  const expectedNames = [...EXPECTED.map(([name]) => name), 'acquisition.json'].sort();
  const actualNames = Object.values(zip.files).filter((entry) => !entry.dir).map((entry) => entry.name).sort();
  if (actualNames.join('|') !== expectedNames.join('|')) throw new OmanBundleError('unexpected_manifest', `The Oman bundle must contain exactly ${expectedNames.join(', ')}.`);
  const manifestBytes = Buffer.from(await zip.file('acquisition.json')!.async('nodebuffer'));
  let manifest: { acquisition_version?: string; release_identifier?: string; artifacts?: Array<{ name?: string; role?: string; url?: string; size_bytes?: number; sha256?: string }>; rights_evidence?: Record<string, unknown>; trade_remedy_evidence?: Record<string, unknown>; india_preference_evidence?: Record<string, unknown> };
  try { manifest = JSON.parse(manifestBytes.toString('utf8')); } catch { throw new OmanBundleError('invalid_manifest', 'The Oman acquisition manifest is not valid JSON.'); }
  if (manifest.acquisition_version !== 'rop-customs-tariff-acquisition-v2' || manifest.release_identifier !== args.release_identifier) throw new OmanBundleError('unexpected_acquisition', 'The Oman manifest does not identify the reviewed release and acquisition version.');
  if (manifest.rights_evidence?.law_article !== 'Oman Copyright Law article 4'
    || manifest.trade_remedy_evidence?.producer_or_exporter_identity_required !== true
    || manifest.india_preference_evidence?.requires_origin_proof !== true
    || manifest.india_preference_evidence?.origin_criterion_must_be_established_from_product_specific_rules !== true) {
    throw new OmanBundleError('missing_legal_evidence', 'The Oman bundle does not retain the reviewed reuse, trade-remedy and India-origin evidence.');
  }
  const files: Array<{ name: string; size_bytes: number; sha256: string; role: string }> = [];
  for (const [name, role] of EXPECTED) {
    const bytes = Buffer.from(await zip.file(name)!.async('nodebuffer'));
    const entry = manifest.artifacts?.find((item) => item.name === name);
    if (!entry || entry.role !== role || entry.size_bytes !== bytes.length || entry.sha256 !== sha256(bytes)) throw new OmanBundleError('artifact_hash_mismatch', `The acquisition manifest does not authenticate ${name}.`);
    files.push({ name, role, size_bytes: bytes.length, sha256: sha256(bytes) });
  }
  files.push({ name: 'acquisition.json', role: 'acquisition_manifest', size_bytes: manifestBytes.length, sha256: sha256(manifestBytes) });
  const normalizedBytes = Buffer.from(await zip.file('normalized-lines.json')!.async('nodebuffer'));
  let normalized: NormalizedArtifact;
  try { normalized = JSON.parse(normalizedBytes.toString('utf8')); } catch { throw new OmanBundleError('invalid_normalized_rows', 'The Oman normalized row artifact is not valid JSON.'); }
  if (normalized.table_parser_version !== OMAN_PDF_TABLE_VERSION || normalized.physical_row_count !== OMAN_EXPECTED_PHYSICAL_ROWS || !Array.isArray(normalized.lines) || normalized.lines.length !== OMAN_EXPECTED_UNIQUE_CODES) throw new OmanBundleError('unsupported_normalized_rows', 'The Oman normalized row artifact has an unsupported schema or does not match the qualified full-release row controls.');
  const lines = new Map<string, OmanTariffLine>();
  for (const line of normalized.lines) {
    if (!/^\d{12}$/.test(line.code) || lines.has(line.code)) throw new OmanBundleError('invalid_normalized_line', `Invalid or duplicate normalized Omani tariff code ${line.code}.`);
    if (!['ad_valorem', 'specific', 'compound', 'mixed', 'none'].includes(line.general_duty.kind)
      || line.additional_duty?.kind === 'unparsed'
      || (line.india_category != null && !/^[ABCEX]$/.test(line.india_category))) {
      throw new OmanBundleError('invalid_normalized_line', `Omani tariff code ${line.code} has an unsupported duty or preference value.`);
    }
    lines.set(line.code, line);
  }
  if (![...lines.values()].some((line) => line.general_duty.kind === 'mixed')
    || ![...lines.values()].some((line) => line.additional_duty?.kind === 'ad_valorem')
    || !['A', 'B', 'C', 'E', 'X'].every((category) => [...lines.values()].some((line) => line.india_category === category))) {
    throw new OmanBundleError('missing_reviewed_semantics', 'The normalized Oman release no longer contains every reviewed duty and India-category semantic.');
  }
  const tariffSourceUrl = String(manifest.artifacts?.find((item) => item.name === 'customs-tariff-2026.pdf')?.url ?? '');
  return { checksum: sha256(args.bytes), size_bytes: args.bytes.length, release_identifier: args.release_identifier, tariff_source_url: tariffSourceUrl, files, lines, physical_row_count: normalized.physical_row_count, reader_version: OMAN_BUNDLE_READER_VERSION, table_parser_version: OMAN_PDF_TABLE_VERSION };
}

export function readOmanAuthorityRelease(args: { bytes: Buffer; release_identifier: string; reader_version: string }) {
  if (args.reader_version !== OMAN_BUNDLE_READER_VERSION) throw new OmanBundleError('unsupported_reader_version', `Unsupported Oman authority reader version ${args.reader_version}.`);
  return readOmanAuthorityBundle(args);
}
