import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import type { ParsedDuty } from '@/lib/market-access/tariff-semantics';
import {
  extractPdfTablePages,
  parsePdfTablePages,
  type PdfTablePage,
  type PdfTariffLine,
  type PdfTableProfile,
} from './pdf-table-family';
import {
  MALAYSIA_REMEDY_MANIFEST_VERSION,
  validateMalaysiaRemedyManifest,
  type MalaysiaTradeRemedyManifest,
} from './malaysia-remedies';

export const MALAYSIA_ACQUISITION_VERSION = 'my-jkdm-cdo-2025-acquisition-v1' as const;
export const MALAYSIA_BUNDLE_READER_VERSION = 'my-jkdm-cdo-2025-bundle-reader-v1' as const;
export const MALAYSIA_PDF_PARSER_VERSION = 'my-jkdm-first-schedule-coordinate-v1' as const;
export const MALAYSIA_RIGHTS_STATUS = 'COMMERCIAL_REUSE_PERMISSION_PENDING' as const;
export const MALAYSIA_EXPECTED_LINE_COUNT = 11_441;
export const MALAYSIA_EXPECTED_TRQ_LINE_COUNT = 27;

export const MALAYSIA_TABLE_PROFILE: PdfTableProfile = Object.freeze({
  country_code: 'MY', label: 'Malaysia Customs Duties Order 2025 P.U. (A) 384/2025',
  expected_pdf_pages: 1466, table_first_page: 16, table_last_page: 1366,
  expected_line_count: MALAYSIA_EXPECTED_LINE_COUNT,
  code_pattern: /^\d{4}\.\d{2}\.\d{2}\s+\d{2}$/,
  code_header: /^Subheading$/i, description_header: /^Description$/i,
  unit_header: /^Unit$/i,
  columns: [{ key: 'import_duty', header: /^import duty$/i, right_header: /^export dut(?:y)?$/i, required: false }],
  code_tolerance_points: 22, effective_from: '2025-11-01',
});

export class MalaysiaBundleError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'MalaysiaBundleError'; }
}

function duty(expression: string, fields: Partial<ParsedDuty>): ParsedDuty {
  return { kind: fields.kind ?? 'unparsed', ad_valorem_rate_percent: fields.ad_valorem_rate_percent ?? null,
    specific_amount: fields.specific_amount ?? null, specific_currency: fields.specific_currency ?? null,
    specific_unit: fields.specific_unit ?? null, specific_unit_quantity: fields.specific_unit_quantity ?? null,
    expression, note: fields.note ?? null };
}

const number = (value: string) => Number(value.replaceAll(',', ''));
const clean = (value: string) => value.replace(/\s+/g, ' ').trim();

/** Column (5) only. Column (6), export duty, never reaches this function. */
export function parseMalaysiaImportDuty(raw: string, scheduleUnit: string): ParsedDuty {
  const value = clean(raw).replace(/\b(\d)\s+(?=\d\s*%)/g, '$1').replace(/\s+%/g, '%').replace(/RM\s+/gi, 'RM');
  if (!value) return duty('', { kind: 'none', note: 'The First Schedule import-duty cell is blank; blank is retained and is not treated as zero.' });
  if (/^TRQ\s+as\s+specified\s+in\s+Appendix\s+B$/i.test(value)) return duty(value, { kind: 'mixed', note: 'Appendix B supplies separate in-quota and out-of-quota rates; quota availability must be established separately.' });
  if (/^(?:Nil|Free|0(?:\.0+)?%)$/i.test(value)) return duty(value, { kind: 'ad_valorem', ad_valorem_rate_percent: 0, note: 'The authority expressly publishes a zero rate.' });
  const percentage = /(\d+(?:\.\d+)?)%/.exec(value);
  const ringgit = /RM\s*(\d[\d,]*(?:\.\d+)?)(?:\s*(?:\/|per)\s*(?:(\d+(?:\.\d+)?)\s*)?([A-Za-z][A-Za-z0-9 ]*))?/i.exec(value);
  if (percentage && ringgit && /\b(?:and|plus)\b|\+/i.test(value)) return duty(value, {
    kind: 'compound', ad_valorem_rate_percent: number(percentage[1]!), specific_amount: number(ringgit[1]!), specific_currency: 'MYR',
    specific_unit_quantity: ringgit[2] ? number(ringgit[2]) : 1, specific_unit: clean(ringgit[3] || scheduleUnit) || null,
    note: 'The published ad-valorem and specific components apply together; no ad-valorem equivalent is invented.',
  });
  if (percentage && ringgit) return duty(value, {
    kind: 'mixed', ad_valorem_rate_percent: number(percentage[1]!), specific_amount: number(ringgit[1]!), specific_currency: 'MYR',
    specific_unit_quantity: ringgit[2] ? number(ringgit[2]) : 1, specific_unit: clean(ringgit[3] || scheduleUnit) || null,
    note: 'The published expression is conditional; no component is selected and no ad-valorem equivalent is invented.',
  });
  if (percentage && /^\d+(?:\.\d+)?%$/.test(value)) return duty(value, { kind: 'ad_valorem', ad_valorem_rate_percent: number(percentage[1]!) });
  const percentages = [...value.matchAll(/(\d+(?:\.\d+)?)%/g)].map((match) => number(match[1]!));
  if (percentages.length && percentages.every((rate) => rate === percentages[0]) && !/\b(?:and|plus|or|whichever|maximum|minimum|TRQ)\b|RM/i.test(value)) {
    return duty(value, { kind: 'ad_valorem', ad_valorem_rate_percent: percentages[0], note: 'A repeated rate or adjacent PDF footnote fragment was normalized; the complete raw cell remains retained.' });
  }
  if (ringgit && /^RM/i.test(value)) return duty(value, {
    kind: 'specific', specific_amount: number(ringgit[1]!), specific_currency: 'MYR',
    specific_unit_quantity: ringgit[2] ? number(ringgit[2]) : 1, specific_unit: clean(ringgit[3] || scheduleUnit) || null,
    note: scheduleUnit ? 'Specific duty denominator is the First Schedule unit of quantity.' : 'Specific duty unit was not established; execution must fail closed.',
  });
  if (/\bor\b|whichever|maximum|minimum/i.test(value)) return duty(value, { kind: 'mixed', note: 'The published duty is conditional; no scalar rate is invented.' });
  return duty(value, { kind: 'unparsed', note: 'The published import-duty expression is outside the qualified parser forms and must fail closed.' });
}

export interface MalaysiaTrqLine {
  code: string;
  unit: string;
  in_quota_duty: ParsedDuty;
  out_of_quota_duty: ParsedDuty;
  quota_agency: string;
  source_page: number;
}

const cell = (page: PdfTablePage, left: number, right: number, top: number, bottom: number) => clean(page.items
  .filter((item) => item.x >= left && item.x < right && item.y <= top && item.y > bottom)
  .sort((a, b) => b.y - a.y || a.x - b.x).map((item) => item.str).join(' '));

export function parseMalaysiaTrqPages(pages: readonly PdfTablePage[]) {
  const result = new Map<string, MalaysiaTrqLine>();
  for (const page of pages.filter((item) => item.page_number >= 1371 && item.page_number <= 1376)) {
    const anchors = page.items.filter((item) => /^\d{4}\.\d{2}\.\d{2}\s+\d{2}$/.test(clean(item.str)) && item.x > 100 && item.x < 170).sort((a, b) => b.y - a.y);
    anchors.forEach((anchor, index) => {
      const top = anchor.y + 5; const bottom = (anchors[index + 1]?.y ?? 45) + 0.5;
      const code = anchor.str.replace(/\D/g, '');
      const unit = cell(page, 410, 480, top, bottom);
      const inQuota = cell(page, 480, 550, top, bottom);
      const outQuota = cell(page, 550, 625, top, bottom);
      const agency = cell(page, 625, page.width, top, bottom);
      if (!inQuota || !outQuota || !agency) throw new MalaysiaBundleError('trq_layout_changed', `Appendix B row ${code} on page ${page.page_number} is incomplete.`);
      if (result.has(code)) throw new MalaysiaBundleError('duplicate_trq_code', `Appendix B repeats ${code}.`);
      result.set(code, { code, unit, in_quota_duty: parseMalaysiaImportDuty(inQuota, unit), out_of_quota_duty: parseMalaysiaImportDuty(outQuota, unit), quota_agency: agency, source_page: page.page_number });
    });
  }
  if (result.size !== MALAYSIA_EXPECTED_TRQ_LINE_COUNT) throw new MalaysiaBundleError('trq_row_count_changed', `Appendix B contains ${result.size} TRQ lines; expected ${MALAYSIA_EXPECTED_TRQ_LINE_COUNT}.`);
  return result;
}

export async function parseMalaysiaOrderPdf(bytes: Buffer) {
  const pages = await extractPdfTablePages(bytes);
  const generic = parsePdfTablePages(MALAYSIA_TABLE_PROFILE, pages, 'MYR');
  const lines = new Map<string, PdfTariffLine>();
  for (const [code, line] of generic) lines.set(code, { ...line, cells: { import_duty: parseMalaysiaImportDuty(line.raw_cells.import_duty ?? '', line.unit ?? '') } });
  const trq = parseMalaysiaTrqPages(pages);
  for (const [code, row] of trq) {
    const line = lines.get(code);
    if (!line || !/^TRQ\b/i.test(line.raw_cells.import_duty ?? '')) throw new MalaysiaBundleError('trq_mapping_changed', `Appendix B code ${code} does not map to a First Schedule TRQ marker.`);
    if (!['ad_valorem', 'specific', 'compound', 'mixed'].includes(row.in_quota_duty.kind) || !['ad_valorem', 'specific', 'compound', 'mixed'].includes(row.out_of_quota_duty.kind)) throw new MalaysiaBundleError('unparsed_trq_rate', `Appendix B code ${code} has an unparsed quota rate.`);
  }
  return { lines, trq, pages: pages.length };
}

export interface MalaysiaAuthorityBundle {
  checksum: string; release_identifier: string; source_url: string;
  lines: ReadonlyMap<string, PdfTariffLine>; trq: ReadonlyMap<string, MalaysiaTrqLine>;
  remedies: MalaysiaTradeRemedyManifest; rights_status: typeof MALAYSIA_RIGHTS_STATUS;
  files: readonly { name: string; role: string; url: string; size_bytes: number; sha256: string }[];
  reader_version: typeof MALAYSIA_BUNDLE_READER_VERSION; parser_version: typeof MALAYSIA_PDF_PARSER_VERSION;
}

interface Manifest {
  acquisition_version: string; release_identifier: string; source_url: string;
  rights_status: string; tariff_line_count: number; trq_line_count: number;
  files: Array<{ name: string; role: string; url: string; size_bytes: number; sha256: string }>;
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export const serializeMalaysiaLines = (lines: ReadonlyMap<string, PdfTariffLine>) => Buffer.from(`${JSON.stringify([...lines.values()].sort((a, b) => a.code.localeCompare(b.code)), null, 2)}\n`);

export async function buildMalaysiaLocalBundle(args: { release_identifier: string; source_url: string; artifacts: readonly { name: string; role: string; url: string; bytes: Buffer }[]; lines: ReadonlyMap<string, PdfTariffLine>; trq: ReadonlyMap<string, MalaysiaTrqLine>; remedies: MalaysiaTradeRemedyManifest }) {
  validateMalaysiaRemedyManifest(args.remedies);
  const generated = [
    { name: 'normalized-lines.json', role: 'deterministic_coordinate_parser_output', url: args.source_url, bytes: serializeMalaysiaLines(args.lines) },
    { name: 'appendix-b-trq.json', role: 'deterministic_appendix_b_parser_output', url: args.source_url, bytes: Buffer.from(`${JSON.stringify([...args.trq.values()].sort((a, b) => a.code.localeCompare(b.code)), null, 2)}\n`) },
    { name: 'active-trade-remedies.json', role: 'reviewed_complete_active_trade_remedy_manifest', url: 'https://traderemedies.miti.gov.my/', bytes: Buffer.from(`${JSON.stringify(args.remedies, null, 2)}\n`) },
  ];
  const all = [...args.artifacts, ...generated];
  const files = all.map(({ bytes, ...item }) => ({ ...item, size_bytes: bytes.length, sha256: sha256(bytes) }));
  const manifest: Manifest = { acquisition_version: MALAYSIA_ACQUISITION_VERSION, release_identifier: args.release_identifier.trim(), source_url: args.source_url,
    rights_status: MALAYSIA_RIGHTS_STATUS, tariff_line_count: args.lines.size, trq_line_count: args.trq.size, files };
  const zip = new JSZip(); const options = { date: new Date('1980-01-01T00:00:00.000Z'), createFolders: false } as const;
  for (const artifact of all) zip.file(artifact.name, artifact.bytes, options);
  zip.file('acquisition.json', `${JSON.stringify(manifest, null, 2)}\n`, options);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 }, platform: 'UNIX' }));
}

export async function readMalaysiaAuthorityBundle(args: { bytes: Buffer; release_identifier: string }): Promise<MalaysiaAuthorityBundle> {
  let zip: JSZip; try { zip = await JSZip.loadAsync(args.bytes); } catch { throw new MalaysiaBundleError('corrupt_archive', 'Malaysia authority bundle is not a ZIP archive.'); }
  const manifestFile = zip.file('acquisition.json'); if (!manifestFile) throw new MalaysiaBundleError('missing_manifest', 'Malaysia authority bundle has no manifest.');
  const manifest = JSON.parse(await manifestFile.async('text')) as Manifest;
  if (manifest.acquisition_version !== MALAYSIA_ACQUISITION_VERSION || manifest.release_identifier !== args.release_identifier || manifest.rights_status !== MALAYSIA_RIGHTS_STATUS) throw new MalaysiaBundleError('unexpected_manifest', 'Malaysia bundle identity or rights status changed.');
  for (const item of manifest.files) { const entry = zip.file(item.name); if (!entry) throw new MalaysiaBundleError('missing_artifact', `Malaysia bundle is missing ${item.name}.`); const bytes = Buffer.from(await entry.async('nodebuffer')); if (bytes.length !== item.size_bytes || sha256(bytes) !== item.sha256) throw new MalaysiaBundleError('artifact_hash_mismatch', `${item.name} failed checksum validation.`); }
  const rows = JSON.parse(await zip.file('normalized-lines.json')!.async('text')) as PdfTariffLine[];
  const trqRows = JSON.parse(await zip.file('appendix-b-trq.json')!.async('text')) as MalaysiaTrqLine[];
  const remedies = validateMalaysiaRemedyManifest(JSON.parse(await zip.file('active-trade-remedies.json')!.async('text')) as MalaysiaTradeRemedyManifest);
  const lines = new Map(rows.map((row) => [row.code, row])); const trq = new Map(trqRows.map((row) => [row.code, row]));
  if (lines.size !== manifest.tariff_line_count || trq.size !== manifest.trq_line_count) throw new MalaysiaBundleError('row_count_changed', 'Malaysia normalized row totals do not match the manifest.');
  return { checksum: sha256(args.bytes), release_identifier: args.release_identifier, source_url: manifest.source_url, lines, trq, remedies,
    rights_status: MALAYSIA_RIGHTS_STATUS, files: manifest.files, reader_version: MALAYSIA_BUNDLE_READER_VERSION, parser_version: MALAYSIA_PDF_PARSER_VERSION };
}

export function readMalaysiaAuthorityRelease(args: Parameters<typeof readMalaysiaAuthorityBundle>[0] & { reader_version: string }) {
  if (args.reader_version !== MALAYSIA_BUNDLE_READER_VERSION) throw new MalaysiaBundleError('unsupported_reader_version', `Unsupported Malaysia bundle reader ${args.reader_version}.`);
  return readMalaysiaAuthorityBundle(args);
}

export const MALAYSIA_REMEDY_SCHEMA_VERSION = MALAYSIA_REMEDY_MANIFEST_VERSION;
