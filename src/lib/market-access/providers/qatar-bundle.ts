import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import type { ParsedDuty } from '@/lib/market-access/tariff-semantics';
import { QATAR_ACTIVE_TRADE_REMEDY_MANIFEST, validateQatarRemedyManifest, type QatarTradeRemedyManifest } from './qatar-remedies';

export const QATAR_BUNDLE_READER_VERSION = 'qa-customs-bundle-reader-v1' as const;
export const QATAR_PARSER_VERSION = 'qa-integrated-tariff-overlay-parser-v1' as const;
export const QATAR_EXPECTED_SCHEDULE_CODES = 13_958;
export const QATAR_EXPECTED_2025_OPERATIONS = { ADD_CODE: 21, DELETE_CODE: 4, RATE_REPLACE: 32 } as const;

export class QatarBundleError extends Error { constructor(readonly code: string, message: string) { super(message); this.name = 'QatarBundleError'; } }

export type QatarOperationKind = 'ADD_CODE' | 'DELETE_CODE' | 'DESCRIPTION_CHANGE' | 'RATE_REPLACE';
export interface QatarTariffLine { code: string; description: string; declarable: boolean; duty: ParsedDuty; source: string; source_pages: readonly number[]; effective_from: string; effective_to: string | null }
export interface QatarOverlayOperation { instrument: string; effective_from: string; operation: QatarOperationKind; code: string; description: string; declarable: boolean; duty: ParsedDuty | null; source_page: number }
export interface QatarAuthorityBundle {
  checksum: string; size_bytes: number; release_identifier: string; source_url: string;
  files: readonly { name: string; role: string; size_bytes: number; sha256: string }[];
  schedule_lines: ReadonlyMap<string, QatarTariffLine>;
  operations_2025: readonly QatarOverlayOperation[];
  decree_31_2026: { instrument: string; effective_from: string; tables_machine_available: false; note: string };
  remedies: QatarTradeRemedyManifest;
  reader_version: typeof QATAR_BUNDLE_READER_VERSION; parser_version: typeof QATAR_PARSER_VERSION;
}

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
const emptyDuty = (expression: string, kind: ParsedDuty['kind'], note: string | null = null): ParsedDuty => ({ kind, ad_valorem_rate_percent: null, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null, expression, note });

export function parseQatarDuty(raw: string): ParsedDuty {
  const expression = clean(raw);
  if (!expression || expression === '-' || expression === '—') return emptyDuty(expression, 'none', 'The authority published a blank duty cell; blank is not zero.');
  if (/^prohibited$/i.test(expression) || /import prohibited/i.test(expression) || expression.includes('ممنوع')) {
    return emptyDuty('PROHIBITED', 'unparsed', 'Qatar’s Integrated Customs Tariff explicitly designates this line as import-prohibited. This is a regulatory prohibition, not a zero or missing rate, and the line is never treated as declarable.');
  }
  if (/special goods/i.test(expression)) {
    return emptyDuty(expression, 'unparsed', 'Qatar designates this line as "Special Goods" without publishing a numeric customs-duty rate in the schedule; it remains unresolved and is never treated as zero.');
  }
  const pct = /(\d+(?:\.\d+)?)\s*%/.exec(expression);
  if (pct) return { ...emptyDuty(`${pct[1]}%`, 'ad_valorem'), ad_valorem_rate_percent: Number(pct[1]) };
  return emptyDuty(expression, 'unparsed', 'The published Qatar duty expression did not match a recognised percentage, prohibition or special-goods form.');
}

export interface QatarPdfItem { str: string; x: number; y: number } export interface QatarPdfPage { page_number: number; width: number; height: number; items: readonly QatarPdfItem[] }
const rowCell = (items: readonly QatarPdfItem[], x0: number, x1: number, low: number, high: number) => clean(items.filter(i => i.x >= x0 && i.x < x1 && i.y >= low && i.y < high && i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x).map(i => i.str.trim()).join(' '));

/** Parses the current bilingual GCC-format schedule Qatar Customs hosts as its national Integrated Customs Tariff. */
export function parseQatarSchedule(pages: readonly QatarPdfPage[]) {
  const lines: QatarTariffLine[] = [];
  for (const page of pages) {
    const codeAnchors = page.items.filter(i => i.x > 470 && i.x < 560 && /^\d{2}(\s\d{2}){5}$/.test(i.str.trim())).sort((a, b) => b.y - a.y);
    codeAnchors.forEach((anchor, index) => {
      const above = codeAnchors[index - 1], below = codeAnchors[index + 1];
      const high = above ? (above.y + anchor.y) / 2 + 3 : anchor.y + 8;
      const low = below ? (anchor.y + below.y) / 2 - 3 : anchor.y - 8;
      const code = anchor.str.replace(/\s+/g, '');
      const dutyRaw = rowCell(page.items, 0, 45, low, high);
      const description = rowCell(page.items, 100, 350, anchor.y - 2, anchor.y + 2);
      const duty = parseQatarDuty(dutyRaw);
      lines.push({ code, description, declarable: duty.kind === 'ad_valorem', duty, source: 'Qatar Customs Integrated Customs Tariff schedule', source_pages: [page.page_number], effective_from: '2025-01-01', effective_to: null });
    });
  }
  const byCode = new Map<string, QatarTariffLine>();
  for (const line of lines) { if (byCode.has(line.code)) throw new QatarBundleError('duplicate_schedule_code', `Qatar schedule has a duplicate code ${line.code}.`); byCode.set(line.code, line); }
  if (byCode.size !== QATAR_EXPECTED_SCHEDULE_CODES) throw new QatarBundleError('unexpected_schedule_count', `Qatar schedule parsed ${byCode.size} unique codes instead of ${QATAR_EXPECTED_SCHEDULE_CODES}.`);
  return byCode;
}

/**
 * Parses Decree 63/2025's three attached tables (modification / addition / deletion). Table (1)
 * (modifications) is laid out as Change | HS Code | Description | Duty Rate with the code column at
 * x≈186; Tables (2) and (3) (additions/deletions) drop the Change column and shift the code to
 * x≈78. The two tables share that same x-layout, so they are distinguished by the page on which
 * the "Table No. (3)" heading first appears.
 */
export function parseQatarDecree63Tables(pages: readonly QatarPdfPage[]): QatarOverlayOperation[] {
  const table3Page = pages.find(page => page.items.some(i => i.str.trim() === '(3)' && i.x > 300 && i.x < 330 && i.y > 740))?.page_number;
  if (!table3Page) throw new QatarBundleError('unexpected_decree63_layout', 'Decree 63/2025 annex did not contain a Table (3) heading.');
  const out: QatarOverlayOperation[] = [];
  for (const page of pages) {
    const table1Anchors = page.items.filter(i => i.x > 175 && i.x < 200 && /^\d{2}(\s\d{2}){5}$/.test(i.str.trim())).sort((a, b) => b.y - a.y);
    table1Anchors.forEach((anchor, index) => {
      const above = table1Anchors[index - 1], below = table1Anchors[index + 1];
      const high = above ? (above.y + anchor.y) / 2 + 2 : anchor.y + 8, low = below ? (anchor.y + below.y) / 2 - 2 : anchor.y - 8;
      const code = anchor.str.replace(/\s+/g, '');
      const description = rowCell(page.items, 270, 395, anchor.y - 2, anchor.y + 2), dutyRaw = rowCell(page.items, 395, 460, low, high);
      const duty = parseQatarDuty(dutyRaw);
      out.push({ instrument: 'Decree No. (63) of 2025', effective_from: '2025-06-01', operation: 'RATE_REPLACE', code, description, declarable: duty.kind === 'ad_valorem', duty: duty.kind === 'none' ? null : duty, source_page: page.page_number });
    });
    const table23Anchors = page.items.filter(i => i.x > 65 && i.x < 95 && /^\d{2}(\s\d{2}){5}$/.test(i.str.trim())).sort((a, b) => b.y - a.y);
    const operation: QatarOperationKind = page.page_number < table3Page ? 'ADD_CODE' : 'DELETE_CODE';
    table23Anchors.forEach((anchor, index) => {
      const above = table23Anchors[index - 1], below = table23Anchors[index + 1];
      const high = above ? (above.y + anchor.y) / 2 + 2 : anchor.y + 8, low = below ? (anchor.y + below.y) / 2 - 2 : anchor.y - 8;
      const code = anchor.str.replace(/\s+/g, '');
      const description = rowCell(page.items, 200, 340, anchor.y - 2, anchor.y + 2), dutyRaw = rowCell(page.items, 340, 410, low, high);
      const duty = operation === 'DELETE_CODE' ? null : parseQatarDuty(dutyRaw);
      out.push({ instrument: 'Decree No. (63) of 2025', effective_from: '2025-06-01', operation, code, description, declarable: operation === 'ADD_CODE' && duty?.kind === 'ad_valorem', duty, source_page: page.page_number });
    });
  }
  const counts = Object.fromEntries(Object.keys(QATAR_EXPECTED_2025_OPERATIONS).map(k => [k, out.filter(x => x.operation === k).length]));
  for (const [kind, count] of Object.entries(QATAR_EXPECTED_2025_OPERATIONS)) if (counts[kind] !== count) throw new QatarBundleError('incomplete_2025_operations', `Decree 63/2025 parsed ${counts[kind]} ${kind} rows instead of ${count}.`);
  return out;
}

interface Normalized { schedule_lines: QatarTariffLine[]; operations_2025: QatarOverlayOperation[]; decree_31_2026: QatarAuthorityBundle['decree_31_2026']; remedies: QatarTradeRemedyManifest }
export async function readQatarAuthorityBundle(args: { bytes: Buffer; release_identifier: string }): Promise<QatarAuthorityBundle> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(args.bytes); } catch { throw new QatarBundleError('corrupt_archive', 'Qatar authority bundle is not a readable ZIP.'); }
  const manifestBytes = Buffer.from(await zip.file('acquisition.json')?.async('nodebuffer') ?? []);
  let manifest: { acquisition_version?: string; release_identifier?: string; artifacts?: Array<{ name: string; role: string; size_bytes: number; sha256: string }>; rights_evidence?: Record<string, unknown>; scope?: Record<string, unknown> };
  try { manifest = JSON.parse(manifestBytes.toString('utf8')); } catch { throw new QatarBundleError('invalid_manifest', 'Qatar acquisition manifest is invalid JSON.'); }
  if (manifest.acquisition_version !== 'qa-customs-public-acquisition-v1' || manifest.release_identifier !== args.release_identifier || manifest.rights_evidence?.law_article !== 'Qatar Copyright Law article 4' || manifest.scope?.tariff_treatment_complete !== true) {
    throw new QatarBundleError('unexpected_acquisition', 'Qatar manifest lacks the reviewed identity, rights or tariff-completeness controls.');
  }
  for (const entry of manifest.artifacts ?? []) {
    const bytes = Buffer.from(await zip.file(entry.name)?.async('nodebuffer') ?? []);
    if (bytes.length !== entry.size_bytes || hash(bytes) !== entry.sha256) throw new QatarBundleError('artifact_hash_mismatch', `Qatar artifact ${entry.name} failed its manifest hash.`);
  }
  const normalizedBytes = Buffer.from(await zip.file('normalized.json')?.async('nodebuffer') ?? []);
  let normalized: Normalized;
  try { normalized = JSON.parse(normalizedBytes.toString('utf8')); } catch { throw new QatarBundleError('invalid_normalized', 'Qatar normalized artifact is invalid JSON.'); }
  if (normalized.schedule_lines.length !== QATAR_EXPECTED_SCHEDULE_CODES) throw new QatarBundleError('incomplete_schedule', `Qatar normalized schedule has ${normalized.schedule_lines.length} codes.`);
  const schedule = new Map(normalized.schedule_lines.map(x => [x.code, x]));
  if (schedule.size !== normalized.schedule_lines.length) throw new QatarBundleError('invalid_schedule', 'Qatar normalized schedule has duplicate codes.');
  for (const [kind, count] of Object.entries(QATAR_EXPECTED_2025_OPERATIONS)) if (normalized.operations_2025.filter(x => x.operation === kind).length !== count) throw new QatarBundleError('incomplete_2025_operations', 'Normalized Decree 63/2025 operations are incomplete.');
  validateQatarRemedyManifest(normalized.remedies);
  return {
    checksum: hash(args.bytes), size_bytes: args.bytes.length, release_identifier: args.release_identifier,
    source_url: 'https://www.customs.gov.qa/Arabic/Tariff/Pages/default.aspx',
    files: (manifest.artifacts ?? []).map(x => ({ name: x.name, role: x.role, size_bytes: x.size_bytes, sha256: x.sha256 })),
    schedule_lines: schedule, operations_2025: normalized.operations_2025, decree_31_2026: normalized.decree_31_2026, remedies: normalized.remedies,
    reader_version: QATAR_BUNDLE_READER_VERSION, parser_version: QATAR_PARSER_VERSION,
  };
}
export const QATAR_DEFAULT_REMEDIES = QATAR_ACTIVE_TRADE_REMEDY_MANIFEST;
