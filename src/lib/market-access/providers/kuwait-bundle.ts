import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import type { ParsedDuty } from '@/lib/market-access/tariff-semantics';
import { KUWAIT_ACTIVE_TRADE_REMEDY_MANIFEST, validateKuwaitRemedyManifest, type KuwaitTradeRemedyManifest } from './kuwait-remedies';

export const KUWAIT_BUNDLE_READER_VERSION = 'kw-customs-bundle-reader-v1' as const;
export const KUWAIT_PARSER_VERSION = 'kw-integrated-tariff-parser-v1' as const;
export const KUWAIT_EXPECTED_SCHEDULE_CODES = 7_510;

export class KuwaitBundleError extends Error { constructor(readonly code: string, message: string) { super(message); this.name = 'KuwaitBundleError'; } }

export interface KuwaitTariffLine { code: string; description: string; declarable: boolean; duty: ParsedDuty; source: string; source_pages: readonly number[]; effective_from: string; effective_to: string | null }
export interface KuwaitAuthorityBundle {
  checksum: string; size_bytes: number; release_identifier: string; source_url: string;
  files: readonly { name: string; role: string; size_bytes: number; sha256: string }[];
  schedule_lines: ReadonlyMap<string, KuwaitTariffLine>;
  remedies: KuwaitTradeRemedyManifest;
  reader_version: typeof KUWAIT_BUNDLE_READER_VERSION; parser_version: typeof KUWAIT_PARSER_VERSION;
}

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
const emptyDuty = (expression: string, kind: ParsedDuty['kind'], note: string | null = null): ParsedDuty => ({ kind, ad_valorem_rate_percent: null, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null, expression, note });

/** Kuwait's live public HS Code portal publishes only ad-valorem percentages (0%, 5%, 100% observed) or blank cells; no prohibition marker appears in the duty column itself. */
export function parseKuwaitDuty(raw: string): ParsedDuty {
  const expression = clean(raw);
  if (!expression) return emptyDuty(expression, 'none', 'The authority published a blank duty cell; blank is not zero.');
  const pct = /(\d+(?:\.\d+)?)\s*%/.exec(expression);
  if (pct) return { ...emptyDuty(`${Number(pct[1])}%`, 'ad_valorem'), ad_valorem_rate_percent: Number(pct[1]) };
  if (/ممنوع|حظر/.test(expression)) return emptyDuty(expression, 'unparsed', 'Kuwait Customs designates this line as prohibited/restricted; this is a regulatory prohibition, not a zero or missing rate.');
  return emptyDuty(expression, 'unparsed', 'The published Kuwait duty expression did not match a recognised percentage or prohibition form.');
}

/** Normalises Kuwait's portal display code (e.g. "3926.20.90.00.01" or "9705.00.10") to a full 12-digit code, right-padding any trailing zero groups the site trims from display. */
export function normalizeKuwaitCode(displayCode: string): string {
  const groups = displayCode.split('.');
  if (groups.length < 1 || groups.length > 5) throw new KuwaitBundleError('invalid_code_format', `Kuwait portal code "${displayCode}" has an unexpected group structure.`);
  const digits = groups.join('');
  if (!/^\d+$/.test(digits) || digits.length > 12) throw new KuwaitBundleError('invalid_code_format', `Kuwait portal code "${displayCode}" is not numeric or exceeds 12 digits.`);
  return digits.padEnd(12, '0');
}

interface Normalized { schedule_lines: KuwaitTariffLine[]; remedies: KuwaitTradeRemedyManifest }
export async function readKuwaitAuthorityBundle(args: { bytes: Buffer; release_identifier: string }): Promise<KuwaitAuthorityBundle> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(args.bytes); } catch { throw new KuwaitBundleError('corrupt_archive', 'Kuwait authority bundle is not a readable ZIP.'); }
  const manifestBytes = Buffer.from(await zip.file('acquisition.json')?.async('nodebuffer') ?? []);
  let manifest: { acquisition_version?: string; release_identifier?: string; artifacts?: Array<{ name: string; role: string; size_bytes: number; sha256: string }>; rights_evidence?: Record<string, unknown>; scope?: Record<string, unknown> };
  try { manifest = JSON.parse(manifestBytes.toString('utf8')); } catch { throw new KuwaitBundleError('invalid_manifest', 'Kuwait acquisition manifest is invalid JSON.'); }
  if (manifest.acquisition_version !== 'kw-customs-public-acquisition-v1' || manifest.release_identifier !== args.release_identifier || manifest.rights_evidence?.law_article !== 'Kuwait Copyright Law article 4' || manifest.scope?.tariff_treatment_complete !== true) {
    throw new KuwaitBundleError('unexpected_acquisition', 'Kuwait manifest lacks the reviewed identity, rights or tariff-completeness controls.');
  }
  for (const entry of manifest.artifacts ?? []) {
    const bytes = Buffer.from(await zip.file(entry.name)?.async('nodebuffer') ?? []);
    if (bytes.length !== entry.size_bytes || hash(bytes) !== entry.sha256) throw new KuwaitBundleError('artifact_hash_mismatch', `Kuwait artifact ${entry.name} failed its manifest hash.`);
  }
  const normalizedBytes = Buffer.from(await zip.file('normalized.json')?.async('nodebuffer') ?? []);
  let normalized: Normalized;
  try { normalized = JSON.parse(normalizedBytes.toString('utf8')); } catch { throw new KuwaitBundleError('invalid_normalized', 'Kuwait normalized artifact is invalid JSON.'); }
  if (normalized.schedule_lines.length !== KUWAIT_EXPECTED_SCHEDULE_CODES) throw new KuwaitBundleError('incomplete_schedule', `Kuwait normalized schedule has ${normalized.schedule_lines.length} codes.`);
  const schedule = new Map(normalized.schedule_lines.map(x => [x.code, x]));
  if (schedule.size !== normalized.schedule_lines.length) throw new KuwaitBundleError('invalid_schedule', 'Kuwait normalized schedule has duplicate codes.');
  validateKuwaitRemedyManifest(normalized.remedies);
  return {
    checksum: hash(args.bytes), size_bytes: args.bytes.length, release_identifier: args.release_identifier,
    source_url: 'https://www.customs.gov.kw/HSCode/HsCode',
    files: (manifest.artifacts ?? []).map(x => ({ name: x.name, role: x.role, size_bytes: x.size_bytes, sha256: x.sha256 })),
    schedule_lines: schedule, remedies: normalized.remedies,
    reader_version: KUWAIT_BUNDLE_READER_VERSION, parser_version: KUWAIT_PARSER_VERSION,
  };
}
export const KUWAIT_DEFAULT_REMEDIES = KUWAIT_ACTIVE_TRADE_REMEDY_MANIFEST;
