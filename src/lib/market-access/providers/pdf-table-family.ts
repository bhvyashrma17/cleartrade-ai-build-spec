import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import type { ParsedDuty } from '@/lib/market-access/tariff-semantics';

export const PDF_TABLE_ACQUISITION_VERSION = 'customs-atlas-pdf-table-acquisition-v1' as const;
export const PDF_TABLE_READER_VERSION = 'customs-atlas-pdf-table-bundle-reader-v1' as const;

export class PdfTableBundleError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'PdfTableBundleError';
  }
}

export interface PdfTextItem { str: string; x: number; y: number }
export interface PdfTablePage { page_number: number; width: number; height: number; items: readonly PdfTextItem[] }

export interface PdfColumnProfile {
  key: string;
  header: RegExp;
  required: boolean;
  right_header?: RegExp;
}

export interface PdfTableProfile {
  country_code: string;
  label: string;
  expected_pdf_pages: number;
  table_first_page: number;
  table_last_page: number;
  expected_line_count: number;
  code_pattern: RegExp;
  code_header: RegExp;
  description_header: RegExp;
  unit_header: RegExp;
  columns: readonly PdfColumnProfile[];
  code_tolerance_points: number;
  effective_from: string;
  layout_strategy?: 'headers' | 'nepal_rate_headers' | 'mauritius_percent_row';
}

export interface PdfTariffLine {
  code: string;
  description: string;
  cells: Readonly<Record<string, ParsedDuty>>;
  raw_cells: Readonly<Record<string, string>>;
  source_pages: readonly number[];
}

export interface PdfAuthorityBundle {
  checksum: string;
  size_bytes: number;
  release_identifier: string;
  source_url: string;
  files: readonly { name: string; size_bytes: number; sha256: string; role: string; url: string }[];
  lines: ReadonlyMap<string, PdfTariffLine>;
  line_count: number;
  reader_version: typeof PDF_TABLE_READER_VERSION;
  acquisition_version: typeof PDF_TABLE_ACQUISITION_VERSION;
  amendment_operations: readonly AmendmentOperation[];
  rights_evidence: Record<string, unknown>;
  preference_evidence: Record<string, unknown>;
  scope: Record<string, unknown>;
}

export interface AmendmentOperation {
  operation: 'ADD' | 'REPLACE' | 'SUSPEND' | 'EXPIRE';
  code: string;
  publication_date: string;
  effective_from: string;
  precedence: number;
  source_artifact: string;
  cells: Record<string, string>;
  description?: string;
}

export interface BundleArtifact {
  name: string;
  role: string;
  url: string;
  bytes: Buffer;
}

export interface PdfBundleManifest {
  acquisition_version: typeof PDF_TABLE_ACQUISITION_VERSION;
  family: 'OFFICIAL_PDF_TABLE' | 'VERSIONED_ARCHIVE' | 'BASELINE_PLUS_AMENDMENTS';
  country_code: string;
  release_identifier: string;
  effective_from: string;
  source_url: string;
  expected_pdf_pages: number;
  line_count: number;
  artifacts: Array<{ name: string; role: string; url: string; size_bytes: number; sha256: string }>;
  amendment_operations: AmendmentOperation[];
  rights_evidence: Record<string, unknown>;
  preference_evidence: Record<string, unknown>;
  scope: Record<string, unknown>;
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const stable = (value: string) => value.replace(/\s+/g, ' ').trim();
const canonicalCell = (value: string) => {
  const cleaned = stable(value).replace(/\.{2,}/g, '').trim();
  if (/^Pa takse(?: \d+)?$/i.test(cleaned)) return 'Pa takse';
  return [...new Set(cleaned.split(' ').filter(Boolean))].join(' ');
};

function duty(expression: string, fields: Partial<ParsedDuty>): ParsedDuty {
  return {
    kind: fields.kind ?? 'unparsed', ad_valorem_rate_percent: fields.ad_valorem_rate_percent ?? null,
    specific_amount: fields.specific_amount ?? null, specific_currency: fields.specific_currency ?? null,
    specific_unit: fields.specific_unit ?? null, specific_unit_quantity: fields.specific_unit_quantity ?? null,
    expression, note: fields.note ?? null,
  };
}

function compactSplitDigits(value: string) {
  return /^(?:\d\s+)+\d$/.test(value) ? value.replace(/\s+/g, '') : value;
}

/**
 * Preserve the authority expression first; classify only forms for which the document supplies
 * enough operands. Blank is deliberately `none`, while a printed zero/free/exempt marker is a
 * real zero-rate measure.
 */
export function parsePublishedDuty(raw: string, currency: string): ParsedDuty {
  let value = stable(raw)
    .replace(/\bP\s*a\s+t\s*a\s*k\s*s\s*e\b/gi, 'Pa takse')
    .replace(/\bF\s*r\s*e\s*e\b/gi, 'Free')
    .replace(/\bE\s*X\s*M\b/gi, 'EXM')
    .replace(/\.{2,}/g, ' ')
    .replace(/\s+([.,/%])/g, '$1');
  value = compactSplitDigits(value);
  const repeatedTokens = value.split(' ').filter(Boolean);
  if (repeatedTokens.length > 1 && new Set(repeatedTokens).size === 1) value = repeatedTokens[0]!;
  if (!value) return duty('', { kind: 'none', note: 'The authority left this duty cell blank; absence is retained and is not reported as zero.' });
  if (/^(?:0(?:[.,]0+)?|free|pa takse(?: \d+)?|exm|exempt)$/i.test(value)) return duty(value, { kind: 'ad_valorem', ad_valorem_rate_percent: 0, note: 'The authority expressly publishes a zero/free/exempt rate.' });
  if (/^\d+(?:[.,]\d+)?,?$/.test(value)) {
    const rate = Number(value.replace(/,$/, '').replace(',', '.'));
    return duty(`${rate}%`, { kind: 'ad_valorem', ad_valorem_rate_percent: rate });
  }

  const percentMatches = [...value.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:%|percent|perent|perent)/gi)];
  const numericTerms = [...value.matchAll(/\b\d+(?:[.,]\d+)?\b/g)].map((match) => Number(match[0].replace(',', '.')));
  const amountMatch = /(?:Rs\.?|Nu\.?)\s*([\d,]+(?:\.\d+)?)/i.exec(value);
  const centMatch = /(\d+(?:[.,]\d+)?)\s*cents?\s+per\s+(gram|kg|kilogram|lit(?:re|er)?)/i.exec(value);
  const unitMatch = /(?:per|\/)\s*(?:(\d+)\s*)?(lit(?:re|er)?|ltr\.?|kg|kilogram|gram|kl|mt|thousand(?:\s+sticks)?|unit|can)/i.exec(value);
  if ((centMatch && amountMatch) || (/\+/.test(value) && (centMatch || amountMatch))) {
    return duty(value, { kind: 'compound', note: 'The authority publishes multiple specific-duty components; the expression is retained without flattening them into one amount.' });
  }
  if (centMatch) {
    return duty(value, {
      kind: 'specific', specific_amount: Number(centMatch[1]!.replace(',', '.')) / 100,
      specific_currency: currency, specific_unit: centMatch[2]!.toLowerCase(), specific_unit_quantity: 1,
    });
  }
  if (amountMatch && unitMatch) {
    const amount = Number(amountMatch[1]!.replaceAll(',', ''));
    const unit = unitMatch[2]!.toLowerCase().replace(/ltr\.?/, 'litre');
    if (percentMatches.length || /which\s*ever\s*is\s*high|whichever\s*is\s*higher/i.test(value)) {
      return duty(value, {
        kind: 'mixed', ad_valorem_rate_percent: percentMatches[0] ? Number(percentMatches[0][1]!.replace(',', '.')) : null,
        specific_amount: amount, specific_currency: currency, specific_unit: unit,
        specific_unit_quantity: unitMatch[1] ? Number(unitMatch[1]) : 1,
        note: 'The authority publishes alternative or threshold components; no ad-valorem equivalent is invented.',
      });
    }
    return duty(value, { kind: 'specific', specific_amount: amount, specific_currency: currency, specific_unit: unit, specific_unit_quantity: unitMatch[1] ? Number(unitMatch[1]) : 1 });
  }
  if (/\b(?:TRQ|tons?|pieces?)\b/i.test(value) && /(?:@|duty|%)/i.test(value)) {
    return duty(value, { kind: 'mixed', ad_valorem_rate_percent: percentMatches[0] ? Number(percentMatches[0][1]!.replace(',', '.')) : null, note: 'The published expression is quota- or quantity-conditional; availability must be established separately.' });
  }
  if (numericTerms.length > 1 && /\b(?:least developed|corresponding|rates? of duty|exhibition|whichever|which ever)\b/i.test(value)) {
    return duty(value, { kind: 'mixed', ad_valorem_rate_percent: null, note: 'The authority publishes more than one conditional rate; no condition is selected or scalar equivalent invented.' });
  }
  if (percentMatches.length || /\bwhich\s*ever\s*is\s*high/i.test(value)) {
    return duty(value, { kind: 'mixed', ad_valorem_rate_percent: percentMatches[0] ? Number(percentMatches[0][1]!.replace(',', '.')) : null, note: 'The published expression is conditional; no scalar equivalent is invented.' });
  }
  return duty(value, { kind: 'unparsed', note: 'The published expression does not match a qualified ad-valorem, specific, compound, mixed, free or blank form.' });
}

function headerItem(items: readonly PdfTextItem[], pattern: RegExp) {
  const matches = items.filter((item) => pattern.test(stable(item.str)));
  if (!matches.length) return null;
  // Notes and descriptions can legitimately repeat a short header word (notably Nepal's
  // "Sub"). The published table header is always the uppermost matching item on a data page.
  return [...matches].sort((a, b) => b.y - a.y)[0]!;
}

function itemsInCell(items: readonly PdfTextItem[], left: number, right: number, top: number, bottom: number) {
  return stable(items.filter((item) => item.x >= left && item.x < right && item.y <= top && item.y > bottom && item.str.trim())
    .filter((item, index, all) => all.findIndex((candidate) => candidate.str === item.str && Math.abs(candidate.x - item.x) < 0.01 && Math.abs(candidate.y - item.y) < 0.01) === index)
    .sort((a, b) => b.y - a.y || a.x - b.x).map((item) => item.str.trim()).join(' '));
}

export function parsePdfTablePages(profile: PdfTableProfile, pages: readonly PdfTablePage[], currency: string) {
  if (pages.length !== profile.expected_pdf_pages) throw new PdfTableBundleError('page_count_changed', `${profile.label} has ${pages.length} pages; expected ${profile.expected_pdf_pages}.`);
  const parsed = new Map<string, PdfTariffLine>();
  let dataPages = 0;
  let previousCode: string | null = null;
  for (const page of pages) {
    if (page.page_number < profile.table_first_page || page.page_number > profile.table_last_page) continue;
    const possibleCodes = page.items.filter((item) => profile.code_pattern.test(stable(item.str)));
    if (!possibleCodes.length) continue;
    let codeHeader = headerItem(page.items, profile.code_header);
    let descriptionHeader = headerItem(page.items, profile.description_header);
    let unitHeader = headerItem(page.items, profile.unit_header);
    let columnHeaders = profile.columns.map((column) => ({ ...column, item: headerItem(page.items, column.header), rightItem: column.right_header ? headerItem(page.items, column.right_header) : null }));
    if (profile.layout_strategy === 'nepal_rate_headers') {
      const saarc = headerItem(page.items, /^(?:SAARC|SAA)$/i);
      const general = headerItem(page.items, /^(?:GENERAL|GENER)$/i);
      if (saarc && general) {
        codeHeader = { str: 'Sub-heading', x: saarc.x - 263, y: saarc.y + 5 };
        descriptionHeader = { str: 'Description', x: saarc.x - 166, y: saarc.y + 5 };
        unitHeader = { str: 'Unit', x: saarc.x - 35, y: saarc.y + 5 };
        columnHeaders = profile.columns.map((column) => ({ ...column, item: column.key === 'saarc' ? saarc : general, rightItem: null }));
      }
    }
    if (profile.layout_strategy === 'mauritius_percent_row') {
      const byY = new Map<number, PdfTextItem[]>();
      for (const item of page.items.filter((candidate) => candidate.str.trim() === '%')) {
        const key = Math.round(item.y);
        byY.set(key, [...(byY.get(key) ?? []), item]);
      }
      const percentRow = [...byY.values()].sort((a, b) => b.length - a.length)[0]?.sort((a, b) => a.x - b.x);
      if (percentRow && percentRow.length >= 8) {
        const codeX = Math.min(...possibleCodes.map((item) => item.x));
        codeHeader = { str: 'H.S. Code', x: codeX, y: percentRow[0]!.y + 25 };
        descriptionHeader = { str: 'Description', x: codeX + 45, y: percentRow[0]!.y + 25 };
        unitHeader = { str: 'Unit', x: percentRow[0]!.x - 35, y: percentRow[0]!.y + 8 };
        const indexes: Record<string, number> = { general: 0, excise_duty: 1, vat: 2, india: 7 };
        columnHeaders = profile.columns.map((column) => ({
          ...column,
          item: percentRow[indexes[column.key]!] ?? null,
          rightItem: percentRow[indexes[column.key]! + 1] ?? null,
        }));
      }
    }
    // Exact row totals are the final completeness control. A notes/appendix page can contain
    // code-shaped references without the complete tariff header, so it is not parsed as a data
    // page; dropping a genuine data page necessarily trips the pinned row total below.
    if (!codeHeader || !descriptionHeader || !unitHeader || columnHeaders.some((column) => !column.item)) continue;
    const ordered = [{ key: 'code', x: codeHeader.x }, { key: 'description', x: descriptionHeader.x }, { key: '__unit', x: unitHeader.x }, ...columnHeaders.map((column) => ({ key: column.key, x: column.item!.x }))]
      .sort((a, b) => a.x - b.x);
    if (new Set(ordered.map((item) => item.key)).size !== ordered.length) throw new PdfTableBundleError('layout_changed', `Tariff page ${page.page_number} has duplicate column identities.`);
    const boundary = (left: number, right: number) => (left + right) / 2;
    const bounds = new Map<string, [number, number]>();
    ordered.forEach((item, index) => bounds.set(item.key, [index ? boundary(ordered[index - 1]!.x, item.x) : 0, index + 1 < ordered.length ? boundary(item.x, ordered[index + 1]!.x) : page.width]));
    for (const column of columnHeaders) {
      const current = bounds.get(column.key)!;
      const left = Math.max(current[0], column.item!.x - 16);
      const right = column.rightItem ? Math.min(current[1], boundary(column.item!.x, column.rightItem.x)) : current[1];
      bounds.set(column.key, [left, right]);
    }
    const anchors = possibleCodes.filter((item) => Math.abs(item.x - codeHeader.x) <= profile.code_tolerance_points)
      .filter((item, index, all) => all.findIndex((candidate) => candidate.str === item.str && Math.abs(candidate.x - item.x) < 0.01 && Math.abs(candidate.y - item.y) < 0.01) === index)
      .sort((a, b) => b.y - a.y);
    // Notes pages can cite complete national codes and even repeat a table-like word. They are
    // not rows unless a code appears in the calibrated code column.
    if (!anchors.length) continue;
    dataPages += 1;
    const tableHeaderBottom = Math.min(codeHeader.y, descriptionHeader.y, unitHeader.y, ...columnHeaders.map((column) => column.item!.y));
    const ordinalCounts = new Map<number, number>();
    for (const item of page.items) {
      if (item.y >= tableHeaderBottom || item.y <= anchors[0]!.y || !/^\d{1,2}$/.test(item.str.trim())) continue;
      const y = Math.round(item.y);
      ordinalCounts.set(y, (ordinalCounts.get(y) ?? 0) + 1);
    }
    const headerOrdinalYs = new Set([...ordinalCounts].filter(([, count]) => count >= 3).map(([y]) => y));
    const cellItems = page.items.filter((item) => !headerOrdinalYs.has(Math.round(item.y)));
    // A line can continue at the top of the next physical page before the first new code. Join
    // that bounded region to the prior line before validating blanks or descriptions.
    if (previousCode) {
      const previous = parsed.get(previousCode);
      if (!previous) throw new PdfTableBundleError('continuation_without_row', `Tariff page ${page.page_number} has an orphan continuation.`);
      const continuationTop = tableHeaderBottom - 6;
      const continuationBottom = anchors[0]!.y + 5;
      if (continuationTop > continuationBottom) {
        const [, descriptionRight] = bounds.get('description')!;
        const descriptionTail = itemsInCell(cellItems, codeHeader.x + profile.code_tolerance_points, descriptionRight, continuationTop, continuationBottom).replace(/\.{3,}/g, '').trim();
        const rawCells = { ...previous.raw_cells };
        const cells = { ...previous.cells };
        for (const column of profile.columns) {
          const [left, right] = bounds.get(column.key)!;
          const tail = itemsInCell(cellItems, left, right, continuationTop, continuationBottom);
          if (tail) rawCells[column.key] = stable(`${rawCells[column.key] ?? ''} ${tail}`);
          cells[column.key] = parsePublishedDuty(rawCells[column.key] ?? '', currency);
        }
        parsed.set(previousCode, { ...previous, description: stable(`${previous.description} ${descriptionTail}`), raw_cells: rawCells, cells, source_pages: [...new Set([...previous.source_pages, page.page_number])] });
      }
    }
    anchors.forEach((anchor, index) => {
      const code = stable(anchor.str).replace(/\D/g, '');
      const nextY = anchors[index + 1]?.y ?? 35;
      const top = anchor.y + 5;
      const bottom = nextY + 0.5;
      const [, descriptionRight] = bounds.get('description')!;
      const description = itemsInCell(cellItems, codeHeader.x + profile.code_tolerance_points, descriptionRight, top, bottom).replace(/\.{3,}/g, '').trim();
      const rawCells: Record<string, string> = {};
      const cells: Record<string, ParsedDuty> = {};
      for (const column of profile.columns) {
        const [left, right] = bounds.get(column.key)!;
        rawCells[column.key] = itemsInCell(cellItems, left, right, top, bottom);
        cells[column.key] = parsePublishedDuty(rawCells[column.key]!, currency);
      }
      const line: PdfTariffLine = { code, description, cells, raw_cells: rawCells, source_pages: [page.page_number] };
      const existing = parsed.get(code);
      if (existing) {
        const sameMeasures = profile.columns.every((column) => canonicalCell(existing.raw_cells[column.key] ?? '') === canonicalCell(line.raw_cells[column.key] ?? ''));
        if (!sameMeasures) throw new PdfTableBundleError('duplicate_code_conflict', `${profile.label} repeats ${code} with different tariff content on pages ${existing.source_pages.join(', ')} and ${page.page_number}: ${JSON.stringify(existing.raw_cells)} versus ${JSON.stringify(line.raw_cells)}.`);
        // Some legal schedules print one code on adjacent rows for two equivalent descriptions.
        // Preserve both descriptions, but only when every published measure is identical.
        const description = existing.description === line.description ? existing.description : `${existing.description} / ${line.description}`;
        parsed.set(code, { ...existing, description, source_pages: [...new Set([...existing.source_pages, page.page_number])] });
      } else parsed.set(code, line);
    });
    previousCode = anchors.at(-1) ? stable(anchors.at(-1)!.str).replace(/\D/g, '') : previousCode;
  }
  if (!dataPages) throw new PdfTableBundleError('missing_table', `${profile.label} contains no reviewed tariff pages.`);
  for (const line of parsed.values()) {
    if (!line.description) parsed.set(line.code, { ...line, description: `${profile.label} tariff line ${line.code}; the description continues outside the code-anchored row and remains in the retained authority PDF.` });
    for (const column of profile.columns) if (column.required && line.cells[column.key]?.kind === 'none') {
      throw new PdfTableBundleError('blank_required_cell', `${profile.label} ${line.code} has a blank required ${column.key} cell after continuation joining.`);
    }
  }
  if (parsed.size !== profile.expected_line_count) throw new PdfTableBundleError('row_count_changed', `${profile.label} contains ${parsed.size} unique tariff lines; expected ${profile.expected_line_count}.`);
  return parsed;
}

export async function extractPdfTablePages(bytes: Buffer): Promise<PdfTablePage[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0, useSystemFonts: true }).promise;
  const pages: PdfTablePage[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    pages.push({ page_number: pageNumber, width: viewport.width, height: viewport.height, items: content.items.flatMap((item) => {
      if (!('str' in item) || !item.str.trim()) return [];
      return [{ str: item.str.trim(), x: item.transform[4], y: item.transform[5] }];
    }) });
  }
  return pages;
}

export const serializePdfLines = (lines: ReadonlyMap<string, PdfTariffLine>) => Buffer.from(`${JSON.stringify([...lines.values()].sort((a, b) => a.code.localeCompare(b.code)), null, 2)}\n`);

export async function buildPdfAuthorityBundle(args: {
  family: PdfBundleManifest['family']; profile: PdfTableProfile; release_identifier: string; source_url: string;
  artifacts: readonly BundleArtifact[]; lines: ReadonlyMap<string, PdfTariffLine>;
  amendments?: readonly AmendmentOperation[]; rights_evidence: Record<string, unknown>;
  preference_evidence: Record<string, unknown>; scope: Record<string, unknown>;
}) {
  const normalized: BundleArtifact = { name: 'normalized-lines.json', role: 'deterministic_coordinate_parser_output', url: args.source_url, bytes: serializePdfLines(args.lines) };
  const artifacts = [...args.artifacts, normalized];
  const manifest: PdfBundleManifest = {
    acquisition_version: PDF_TABLE_ACQUISITION_VERSION, family: args.family, country_code: args.profile.country_code,
    release_identifier: args.release_identifier, effective_from: args.profile.effective_from, source_url: args.source_url,
    expected_pdf_pages: args.profile.expected_pdf_pages, line_count: args.lines.size,
    artifacts: artifacts.map((artifact) => ({ name: artifact.name, role: artifact.role, url: artifact.url, size_bytes: artifact.bytes.length, sha256: sha256(artifact.bytes) })),
    amendment_operations: [...(args.amendments ?? [])], rights_evidence: args.rights_evidence,
    preference_evidence: args.preference_evidence, scope: args.scope,
  };
  const zip = new JSZip();
  const zipOptions = { date: new Date('1980-01-01T00:00:00.000Z'), createFolders: false } as const;
  for (const artifact of artifacts) zip.file(artifact.name, artifact.bytes, zipOptions);
  zip.file('acquisition.json', JSON.stringify(manifest, null, 2), zipOptions);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', platform: 'UNIX' }));
}

function isDuty(value: unknown): value is ParsedDuty {
  if (!value || typeof value !== 'object') return false;
  const item = value as ParsedDuty;
  return ['ad_valorem', 'specific', 'compound', 'mixed', 'none', 'unparsed'].includes(item.kind) && typeof item.expression === 'string';
}

export async function readPdfAuthorityBundle(args: { bytes: Buffer; release_identifier: string; country_code: string; expected_roles: Readonly<Record<string, string>> }): Promise<PdfAuthorityBundle> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(args.bytes); }
  catch { throw new PdfTableBundleError('corrupt_archive', 'The authority bundle is not a readable ZIP archive.'); }
  const manifestEntry = zip.file('acquisition.json');
  if (!manifestEntry) throw new PdfTableBundleError('missing_manifest', 'The authority bundle has no acquisition manifest.');
  let manifest: PdfBundleManifest;
  try { manifest = JSON.parse(await manifestEntry.async('text')) as PdfBundleManifest; }
  catch { throw new PdfTableBundleError('invalid_manifest', 'The acquisition manifest is not valid JSON.'); }
  if (manifest.acquisition_version !== PDF_TABLE_ACQUISITION_VERSION || manifest.country_code !== args.country_code || manifest.release_identifier !== args.release_identifier) throw new PdfTableBundleError('unexpected_acquisition', 'The bundle does not identify the reviewed country, release and acquisition version.');
  if (!manifest.rights_evidence?.artifact || manifest.scope?.tariff_treatment_complete !== true || manifest.scope?.regulatory_coverage_complete !== false) throw new PdfTableBundleError('missing_legal_evidence', 'The bundle does not retain the reviewed rights and scope determinations.');
  const expectedNames = [...Object.keys(args.expected_roles), 'normalized-lines.json'].sort();
  const actualNames = Object.values(zip.files).filter((entry) => !entry.dir && entry.name !== 'acquisition.json').map((entry) => entry.name).sort();
  if (expectedNames.join('|') !== actualNames.join('|')) throw new PdfTableBundleError('unexpected_manifest', `The bundle artifact set changed: expected ${expectedNames.join(', ')}.`);
  const manifestNames = manifest.artifacts.map((entry) => entry.name).sort();
  if (manifestNames.join('|') !== expectedNames.join('|') || new Set(manifestNames).size !== manifestNames.length) {
    throw new PdfTableBundleError('unexpected_manifest', 'The acquisition manifest does not enumerate the exact artifact set once each.');
  }
  const files: PdfAuthorityBundle['files'][number][] = [];
  for (const entry of manifest.artifacts) {
    const file = zip.file(entry.name);
    if (!file) throw new PdfTableBundleError('missing_artifact', `The bundle is missing ${entry.name}.`);
    const bytes = Buffer.from(await file.async('nodebuffer'));
    const expectedRole = entry.name === 'normalized-lines.json' ? 'deterministic_coordinate_parser_output' : args.expected_roles[entry.name];
    if (entry.role !== expectedRole || entry.size_bytes !== bytes.length || entry.sha256 !== sha256(bytes)) throw new PdfTableBundleError('artifact_hash_mismatch', `The manifest does not authenticate ${entry.name}.`);
    files.push({ name: entry.name, role: entry.role, url: entry.url, size_bytes: bytes.length, sha256: entry.sha256 });
  }
  let rows: PdfTariffLine[];
  try { rows = JSON.parse(await zip.file('normalized-lines.json')!.async('text')) as PdfTariffLine[]; }
  catch { throw new PdfTableBundleError('invalid_normalized_rows', 'The normalized tariff rows are not valid JSON.'); }
  const lines = new Map<string, PdfTariffLine>();
  for (const [index, row] of rows.entries()) {
    if (!row || !/^\d{8,10}$/.test(row.code) || !row.description?.trim() || !row.source_pages?.length || !row.cells || Object.values(row.cells).some((item) => !isDuty(item))) throw new PdfTableBundleError('invalid_normalized_row', `Normalized tariff row ${index + 1} is malformed.`);
    if (lines.has(row.code)) throw new PdfTableBundleError('duplicate_normalized_code', `Normalized rows repeat tariff code ${row.code}.`);
    lines.set(row.code, row);
  }
  if (lines.size !== manifest.line_count) throw new PdfTableBundleError('row_count_changed', `Manifest records ${manifest.line_count} lines but the normalized artifact contains ${lines.size}.`);
  return {
    checksum: sha256(args.bytes), size_bytes: args.bytes.length, release_identifier: args.release_identifier,
    source_url: manifest.source_url, files, lines, line_count: lines.size,
    reader_version: PDF_TABLE_READER_VERSION, acquisition_version: PDF_TABLE_ACQUISITION_VERSION,
    amendment_operations: manifest.amendment_operations ?? [], rights_evidence: manifest.rights_evidence,
    preference_evidence: manifest.preference_evidence, scope: manifest.scope,
  };
}

export function readPdfAuthorityRelease(args: Parameters<typeof readPdfAuthorityBundle>[0] & { reader_version: string }) {
  if (args.reader_version !== PDF_TABLE_READER_VERSION) throw new PdfTableBundleError('unsupported_reader_version', `Unsupported PDF-table reader version ${args.reader_version}.`);
  return readPdfAuthorityBundle(args);
}
