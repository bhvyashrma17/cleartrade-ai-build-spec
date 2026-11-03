/**
 * D-028 — the retained bundle of one customs-union release: the official source files exactly as
 * retrieved, the lines read from them (`customs-union-parsers.ts`, assembled in
 * `customs-union-sources.ts`) and a manifest authenticating both.
 *
 * Reading a bundle checks every file against the checksums pinned for the release, so a bundle
 * built from another edition, or edited after it was built, is refused before anything is stored.
 * The lines are not re-read from the PDFs here (a 500-page parse does not belong on the worker); the
 * build is the qualification, and its line count is pinned too. The bundle is deterministic: the
 * same files give the same bytes on any machine, so a build can be reproduced and compared.
 */
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import type { ParsedDuty } from '@/lib/market-access/tariff-semantics';
import type { CustomsUnionKey, CustomsUnionLine, CustomsUnionSource } from './customs-union-sources';

export const CUSTOMS_UNION_BUNDLE_VERSION = 'customs-union-bundle-v1' as const;
export const CUSTOMS_UNION_READER_VERSION = 'customs-union-bundle-reader-v1' as const;
const NORMALIZED = 'normalized-lines.json';
const MANIFEST = 'manifest.json';

export class CustomsUnionBundleError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'CustomsUnionBundleError';
  }
}

interface Manifest {
  bundle_version: typeof CUSTOMS_UNION_BUNDLE_VERSION;
  union: CustomsUnionKey;
  release_identifier: string;
  reference_date: string;
  effective_from: string;
  valid_until: string | null;
  source_url: string;
  provenance: string;
  members: string[];
  artifacts: { name: string; role: string; url: string; size_bytes: number; sha256: string }[];
  line_count: number;
  exception_count: number;
  scope: { tariff_treatment_complete: false; national_exceptions_modelled: false; regulatory_coverage_complete: false };
}

export interface CustomsUnionBundle {
  checksum: string;
  size_bytes: number;
  union: CustomsUnionKey;
  release_identifier: string;
  effective_from: string;
  valid_until: string | null;
  source_url: string;
  provenance: string;
  files: readonly { name: string; role: string; url: string; size_bytes: number; sha256: string }[];
  lines: ReadonlyMap<string, CustomsUnionLine>;
  exception_count: number;
  reader_version: typeof CUSTOMS_UNION_READER_VERSION;
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const ZIP_OPTIONS = { date: new Date('1980-01-01T00:00:00.000Z'), createFolders: false } as const;

function serialize(lines: readonly CustomsUnionLine[]) {
  return Buffer.from(`${JSON.stringify([...lines].sort((a, b) => a.code.localeCompare(b.code)))}\n`, 'utf8');
}

function pinned(source: CustomsUnionSource, name: string, bytes: Buffer) {
  const file = source.release.files.find((item) => item.name === name);
  if (!file) throw new CustomsUnionBundleError('unexpected_file', `${name} is not a source file of the ${source.key} release ${source.release.identifier}.`);
  const digest = sha256(bytes);
  if (digest !== file.sha256 || bytes.length !== file.size_bytes) throw new CustomsUnionBundleError('source_checksum_mismatch', `${name} is ${bytes.length} bytes with SHA-256 ${digest}; the ${source.key} release ${source.release.identifier} pins ${file.size_bytes} bytes and ${file.sha256}.`);
  return file;
}

/** Package the official files and the lines read from them. Refuses any file but the release's own. */
export async function buildCustomsUnionBundle(args: { source: CustomsUnionSource; files: readonly { name: string; bytes: Buffer }[]; lines: readonly CustomsUnionLine[] }) {
  const { source } = args;
  const names = args.files.map((file) => file.name).sort();
  if (names.join('|') !== source.release.files.map((file) => file.name).sort().join('|')) throw new CustomsUnionBundleError('unexpected_manifest', `The ${source.key} release needs exactly ${source.release.files.map((file) => file.name).join(', ')}.`);
  for (const file of args.files) pinned(source, file.name, file.bytes);
  if (args.lines.length !== source.release.line_count) throw new CustomsUnionBundleError('line_count_changed', `${args.lines.length} lines were read from the ${source.key} release; ${source.release.line_count} are pinned.`);
  if (new Set(args.lines.map((line) => line.code)).size !== args.lines.length) throw new CustomsUnionBundleError('duplicate_code', `The ${source.key} lines repeat a code.`);
  const normalized = serialize(args.lines);
  const manifest: Manifest = {
    bundle_version: CUSTOMS_UNION_BUNDLE_VERSION, union: source.key, release_identifier: source.release.identifier,
    reference_date: source.release.reference_date, effective_from: source.release.effective_from, valid_until: source.release.valid_until,
    source_url: source.release.source_url, provenance: source.release.provenance, members: [...source.members],
    artifacts: [
      ...source.release.files.map((file) => ({ name: file.name, role: file.role, url: file.url, size_bytes: file.size_bytes, sha256: file.sha256 })),
      { name: NORMALIZED, role: 'lines_read_from_the_official_files', url: source.release.source_url, size_bytes: normalized.length, sha256: sha256(normalized) },
    ],
    line_count: args.lines.length,
    exception_count: args.lines.filter((line) => line.exception).length,
    scope: { tariff_treatment_complete: false, national_exceptions_modelled: false, regulatory_coverage_complete: false },
  };
  const zip = new JSZip();
  for (const file of [...args.files].sort((a, b) => a.name.localeCompare(b.name))) zip.file(file.name, file.bytes, ZIP_OPTIONS);
  zip.file(NORMALIZED, normalized, ZIP_OPTIONS);
  zip.file(MANIFEST, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), ZIP_OPTIONS);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 }, platform: 'UNIX' }));
}

function isDuty(value: unknown): value is ParsedDuty {
  const duty = value as ParsedDuty | null;
  return !!duty && typeof duty === 'object' && ['ad_valorem', 'specific', 'compound', 'mixed', 'none', 'unparsed'].includes(duty.kind) && typeof duty.expression === 'string';
}

/** Authenticate a bundle against its release's pinned files and return its lines. */
export async function readCustomsUnionBundle(args: { bytes: Buffer; source: CustomsUnionSource; release_identifier: string }): Promise<CustomsUnionBundle> {
  const { source } = args;
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(args.bytes); } catch { throw new CustomsUnionBundleError('corrupt_archive', 'The customs-union bundle is not a readable ZIP archive.'); }
  const expected = [...source.release.files.map((file) => file.name), NORMALIZED, MANIFEST].sort();
  const present = Object.values(zip.files).filter((entry) => !entry.dir).map((entry) => entry.name).sort();
  if (present.join('|') !== expected.join('|')) throw new CustomsUnionBundleError('unexpected_manifest', `The ${source.key} bundle must contain exactly ${expected.join(', ')}.`);
  const read = async (name: string) => Buffer.from(await zip.file(name)!.async('nodebuffer'));
  let manifest: Manifest;
  try { manifest = JSON.parse((await read(MANIFEST)).toString('utf8')) as Manifest; } catch { throw new CustomsUnionBundleError('invalid_manifest', 'The customs-union manifest is not valid JSON.'); }
  if (manifest.bundle_version !== CUSTOMS_UNION_BUNDLE_VERSION || manifest.union !== source.key || manifest.release_identifier !== args.release_identifier || manifest.release_identifier !== source.release.identifier) {
    throw new CustomsUnionBundleError('unexpected_release', `The bundle does not identify the ${source.key} release ${args.release_identifier}.`);
  }
  if (manifest.scope?.national_exceptions_modelled !== false || manifest.scope?.tariff_treatment_complete !== false) throw new CustomsUnionBundleError('wrong_scope', 'A customs-union bundle must say that national exceptions are not modelled.');
  const files: CustomsUnionBundle['files'][number][] = [];
  for (const entry of manifest.artifacts ?? []) {
    if (!expected.includes(entry.name) || entry.name === MANIFEST) throw new CustomsUnionBundleError('unexpected_manifest', `The manifest lists ${entry.name}.`);
    const bytes = await read(entry.name);
    if (entry.name !== NORMALIZED) pinned(source, entry.name, bytes);
    if (bytes.length !== entry.size_bytes || sha256(bytes) !== entry.sha256) throw new CustomsUnionBundleError('artifact_integrity_failure', `The manifest does not authenticate ${entry.name}.`);
    files.push({ name: entry.name, role: entry.role, url: entry.url, size_bytes: entry.size_bytes, sha256: entry.sha256 });
  }
  if (files.length !== expected.length - 1) throw new CustomsUnionBundleError('unexpected_manifest', 'The manifest does not authenticate every file once.');
  let rows: CustomsUnionLine[];
  try { rows = JSON.parse((await read(NORMALIZED)).toString('utf8')) as CustomsUnionLine[]; } catch { throw new CustomsUnionBundleError('invalid_lines', 'The customs-union lines are not valid JSON.'); }
  const lines = new Map<string, CustomsUnionLine>();
  for (const [index, row] of rows.entries()) {
    const exceptionValid = row?.exception == null || (Array.isArray(row.exception.members) && row.exception.members.every((member) => source.members.includes(member)) && typeof row.exception.reason === 'string' && row.exception.reason.length > 10);
    if (!row || !/^\d{8}(?:\d{2})?$/.test(row.code) || !isDuty(row.duty) || typeof row.raw_rate !== 'string' || !row.locator || !exceptionValid) throw new CustomsUnionBundleError('invalid_line', `Line ${index + 1} of the ${source.key} bundle is malformed.`);
    if (lines.has(row.code)) throw new CustomsUnionBundleError('duplicate_code', `The ${source.key} bundle repeats ${row.code}.`);
    lines.set(row.code, row);
  }
  if (lines.size !== source.release.line_count || lines.size !== manifest.line_count) throw new CustomsUnionBundleError('line_count_changed', `The ${source.key} bundle holds ${lines.size} lines; ${source.release.line_count} are pinned.`);
  return {
    checksum: sha256(args.bytes), size_bytes: args.bytes.length, union: source.key, release_identifier: manifest.release_identifier,
    effective_from: manifest.effective_from, valid_until: manifest.valid_until, source_url: manifest.source_url, provenance: manifest.provenance,
    files, lines, exception_count: [...lines.values()].filter((line) => line.exception).length, reader_version: CUSTOMS_UNION_READER_VERSION,
  };
}

export function readCustomsUnionRelease(args: Parameters<typeof readCustomsUnionBundle>[0] & { reader_version: string }) {
  if (args.reader_version !== CUSTOMS_UNION_READER_VERSION) throw new CustomsUnionBundleError('unsupported_reader_version', `Unsupported customs-union reader version ${args.reader_version}.`);
  return readCustomsUnionBundle(args);
}
