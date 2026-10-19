/**
 * D-030 — the retained bundle of one tariff-schedule release: the official files exactly as
 * retrieved, the lines read from them (`tariff-schedule-readers.ts`, assembled in
 * `tariff-schedule-sources.ts`) and a manifest authenticating both. Deterministic: the same files give
 * the same bytes on any machine, so a build can be reproduced and compared.
 *
 * At import, reading checks every file against the checksums pinned for the release, so a bundle
 * built from another edition, or edited afterwards, is refused before anything is stored. At run time
 * the stored artifact's own checksum has already been verified against its audited release, so the
 * reader checks that the manifest lists exactly the pinned files without re-hashing a 70 MB tariff
 * book, and decompresses only the lines.
 */
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import type { ParsedDuty } from '@/lib/market-access/tariff-semantics';
import type { ScheduleLine, TariffScheduleKey, TariffScheduleSource } from './tariff-schedule-sources';

export const TARIFF_SCHEDULE_BUNDLE_VERSION = 'tariff-schedule-bundle-v1' as const;
export const TARIFF_SCHEDULE_READER_VERSION = 'tariff-schedule-bundle-reader-v1' as const;
const NORMALIZED = 'normalized-lines.json';
const MANIFEST = 'manifest.json';

export class TariffScheduleBundleError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'TariffScheduleBundleError';
  }
}

interface Manifest {
  bundle_version: typeof TARIFF_SCHEDULE_BUNDLE_VERSION;
  schedule: TariffScheduleKey;
  release_identifier: string;
  reference_date: string;
  effective_from: string;
  valid_until: string | null;
  source_url: string;
  provenance: string;
  rights_basis: string;
  countries: Record<string, string>;
  artifacts: { name: string; role: string; url: string; size_bytes: number; sha256: string }[];
  line_count: number;
  exception_count: number;
  india_preference_count: number;
  scope: { tariff_treatment_complete: false; trade_remedies_modelled: false; regulatory_coverage_complete: false };
}

export interface TariffScheduleBundle {
  checksum: string;
  size_bytes: number;
  schedule: TariffScheduleKey;
  release_identifier: string;
  effective_from: string;
  valid_until: string | null;
  source_url: string;
  provenance: string;
  rights_basis: string;
  files: readonly { name: string; role: string; url: string; size_bytes: number; sha256: string }[];
  lines: ReadonlyMap<string, ScheduleLine>;
  exception_count: number;
  india_preference_count: number;
  reader_version: typeof TARIFF_SCHEDULE_READER_VERSION;
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const ZIP_OPTIONS = { date: new Date('1980-01-01T00:00:00.000Z'), createFolders: false } as const;
const serialize = (lines: readonly ScheduleLine[]) => Buffer.from(`${JSON.stringify([...lines].sort((a, b) => a.code.localeCompare(b.code)))}\n`, 'utf8');

function pin(source: TariffScheduleSource, name: string) {
  const file = source.release.files.find((item) => item.name === name);
  if (!file) throw new TariffScheduleBundleError('unexpected_file', `${name} is not a source file of the ${source.key} release ${source.release.identifier}.`);
  return file;
}

function checkPinned(source: TariffScheduleSource, name: string, bytes: Buffer) {
  const file = pin(source, name);
  const digest = sha256(bytes);
  if (digest !== file.sha256 || bytes.length !== file.size_bytes) throw new TariffScheduleBundleError('source_checksum_mismatch', `${name} is ${bytes.length} bytes with SHA-256 ${digest}; the ${source.key} release ${source.release.identifier} pins ${file.size_bytes} bytes and ${file.sha256}.`);
  return file;
}

/** Package the official files and the lines read from them. Refuses any file but the release's own. */
export async function buildTariffScheduleBundle(args: { source: TariffScheduleSource; files: readonly { name: string; bytes: Buffer }[]; lines: readonly ScheduleLine[] }) {
  const { source } = args;
  if (args.files.map((file) => file.name).sort().join('|') !== source.release.files.map((file) => file.name).sort().join('|')) throw new TariffScheduleBundleError('unexpected_manifest', `The ${source.key} release needs exactly ${source.release.files.map((file) => file.name).join(', ')}.`);
  for (const file of args.files) checkPinned(source, file.name, file.bytes);
  if (args.lines.length !== source.release.line_count) throw new TariffScheduleBundleError('line_count_changed', `${args.lines.length} lines were read for the ${source.key} release; ${source.release.line_count} are pinned.`);
  if (new Set(args.lines.map((line) => line.code)).size !== args.lines.length) throw new TariffScheduleBundleError('duplicate_code', `The ${source.key} lines repeat a code.`);
  const normalized = serialize(args.lines);
  const manifest: Manifest = {
    bundle_version: TARIFF_SCHEDULE_BUNDLE_VERSION, schedule: source.key, release_identifier: source.release.identifier,
    reference_date: source.release.reference_date, effective_from: source.release.effective_from, valid_until: source.release.valid_until,
    source_url: source.release.source_url, provenance: source.release.provenance, rights_basis: source.release.rights,
    countries: Object.fromEntries(Object.entries(source.countries).map(([code, country]) => [code, country.basis])),
    artifacts: [
      ...source.release.files.map((file) => ({ name: file.name, role: file.role, url: file.url, size_bytes: file.size_bytes, sha256: file.sha256 })),
      { name: NORMALIZED, role: 'lines_read_from_the_official_files', url: source.release.source_url, size_bytes: normalized.length, sha256: sha256(normalized) },
    ],
    line_count: args.lines.length,
    exception_count: args.lines.filter((line) => line.exception).length,
    india_preference_count: args.lines.filter((line) => line.india_preference).length,
    scope: { tariff_treatment_complete: false, trade_remedies_modelled: false, regulatory_coverage_complete: false },
  };
  const zip = new JSZip();
  for (const file of [...args.files].sort((a, b) => a.name.localeCompare(b.name))) zip.file(file.name, file.bytes, { ...ZIP_OPTIONS, compression: 'STORE' });
  zip.file(NORMALIZED, normalized, ZIP_OPTIONS);
  zip.file(MANIFEST, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), ZIP_OPTIONS);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 }, platform: 'UNIX' }));
}

const DUTY_KINDS = ['ad_valorem', 'specific', 'compound', 'mixed', 'none', 'unparsed'];
const isDuty = (value: unknown): value is ParsedDuty => !!value && typeof value === 'object' && DUTY_KINDS.includes((value as ParsedDuty).kind) && typeof (value as ParsedDuty).expression === 'string';

function validLine(row: ScheduleLine, source: TariffScheduleSource) {
  const served = Object.keys(source.countries);
  const countriesValid = (countries: unknown) => Array.isArray(countries) && countries.every((code) => served.includes(code));
  if (!row || !/^\d{8}(?:\d{2}){0,2}$/.test(row.code) || !isDuty(row.duty) || typeof row.raw_rate !== 'string' || !row.locator) return false;
  if (row.exception != null && !(countriesValid(row.exception.countries) && typeof row.exception.reason === 'string' && row.exception.reason.length > 10)) return false;
  if (row.dated != null && !(Array.isArray(row.dated) && row.dated.every((item) => isDuty(item.duty) && typeof item.locator === 'string'))) return false;
  if (row.notes != null && !(Array.isArray(row.notes) && row.notes.every((note) => typeof note === 'string'))) return false;
  const preference = row.india_preference;
  if (preference != null) {
    if (!countriesValid(preference.countries) || !preference.countries.length || !['direct', 'group'].includes(preference.scope) || typeof preference.program !== 'string') return false;
    const staged = preference.staging && Array.isArray(preference.staging.years) && preference.staging.years.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(preference.staging.entry_into_force);
    if (!staged && !isDuty(preference.duty)) return false;
  }
  return true;
}

/**
 * Authenticate a bundle and return its lines. `verify_files` re-hashes every official file against
 * the release's pins (at import); without it the manifest must still list exactly the pinned files.
 */
export async function readTariffScheduleBundle(args: { bytes: Buffer; source: TariffScheduleSource; release_identifier: string; verify_files?: boolean }): Promise<TariffScheduleBundle> {
  const { source } = args;
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(args.bytes); } catch { throw new TariffScheduleBundleError('corrupt_archive', 'The tariff-schedule bundle is not a readable ZIP archive.'); }
  const expected = [...source.release.files.map((file) => file.name), NORMALIZED, MANIFEST].sort();
  const present = Object.values(zip.files).filter((entry) => !entry.dir).map((entry) => entry.name).sort();
  if (present.join('|') !== expected.join('|')) throw new TariffScheduleBundleError('unexpected_manifest', `The ${source.key} bundle must contain exactly ${expected.join(', ')}.`);
  const read = async (name: string) => Buffer.from(await zip.file(name)!.async('nodebuffer'));
  let manifest: Manifest;
  try { manifest = JSON.parse((await read(MANIFEST)).toString('utf8')) as Manifest; } catch { throw new TariffScheduleBundleError('invalid_manifest', 'The tariff-schedule manifest is not valid JSON.'); }
  if (manifest.bundle_version !== TARIFF_SCHEDULE_BUNDLE_VERSION || manifest.schedule !== source.key || manifest.release_identifier !== args.release_identifier || manifest.release_identifier !== source.release.identifier) {
    throw new TariffScheduleBundleError('unexpected_release', `The bundle does not identify the ${source.key} release ${args.release_identifier}.`);
  }
  if (manifest.scope?.trade_remedies_modelled !== false || manifest.scope?.tariff_treatment_complete !== false) throw new TariffScheduleBundleError('wrong_scope', 'A tariff-schedule bundle must say that trade remedies are not modelled.');
  if (typeof manifest.rights_basis !== 'string' || manifest.rights_basis.trim().length < 80) throw new TariffScheduleBundleError('missing_rights_basis', 'A tariff-schedule bundle must record why its files may be retained and used.');
  const files: TariffScheduleBundle['files'][number][] = [];
  let normalized: Buffer | null = null;
  for (const entry of manifest.artifacts ?? []) {
    if (!expected.includes(entry.name) || entry.name === MANIFEST) throw new TariffScheduleBundleError('unexpected_manifest', `The manifest lists ${entry.name}.`);
    if (entry.name === NORMALIZED) {
      normalized = await read(NORMALIZED);
      if (normalized.length !== entry.size_bytes || sha256(normalized) !== entry.sha256) throw new TariffScheduleBundleError('artifact_integrity_failure', 'The manifest does not authenticate the lines.');
    } else {
      const file = pin(source, entry.name);
      if (entry.sha256 !== file.sha256 || entry.size_bytes !== file.size_bytes) throw new TariffScheduleBundleError('source_checksum_mismatch', `The manifest's ${entry.name} is not the file the ${source.key} release pins.`);
      if (args.verify_files) {
        const bytes = await read(entry.name);
        checkPinned(source, entry.name, bytes);
      }
    }
    files.push({ name: entry.name, role: entry.role, url: entry.url, size_bytes: entry.size_bytes, sha256: entry.sha256 });
  }
  if (files.length !== expected.length - 1 || !normalized) throw new TariffScheduleBundleError('unexpected_manifest', 'The manifest does not authenticate every file once.');
  let rows: ScheduleLine[];
  try { rows = JSON.parse(normalized.toString('utf8')) as ScheduleLine[]; } catch { throw new TariffScheduleBundleError('invalid_lines', 'The tariff-schedule lines are not valid JSON.'); }
  const lines = new Map<string, ScheduleLine>();
  for (const [index, row] of rows.entries()) {
    if (!validLine(row, source)) throw new TariffScheduleBundleError('invalid_line', `Line ${index + 1} of the ${source.key} bundle is malformed.`);
    if (lines.has(row.code)) throw new TariffScheduleBundleError('duplicate_code', `The ${source.key} bundle repeats ${row.code}.`);
    lines.set(row.code, row);
  }
  if (lines.size !== source.release.line_count || lines.size !== manifest.line_count) throw new TariffScheduleBundleError('line_count_changed', `The ${source.key} bundle holds ${lines.size} lines; ${source.release.line_count} are pinned.`);
  return {
    checksum: sha256(args.bytes), size_bytes: args.bytes.length, schedule: source.key, release_identifier: manifest.release_identifier,
    effective_from: manifest.effective_from, valid_until: manifest.valid_until, source_url: manifest.source_url, provenance: manifest.provenance, rights_basis: manifest.rights_basis, files, lines,
    exception_count: [...lines.values()].filter((line) => line.exception).length,
    india_preference_count: [...lines.values()].filter((line) => line.india_preference).length,
    reader_version: TARIFF_SCHEDULE_READER_VERSION,
  };
}

export function readTariffScheduleRelease(args: Parameters<typeof readTariffScheduleBundle>[0] & { reader_version: string }) {
  if (args.reader_version !== TARIFF_SCHEDULE_READER_VERSION) throw new TariffScheduleBundleError('unsupported_reader_version', `Unsupported tariff-schedule reader version ${args.reader_version}.`);
  return readTariffScheduleBundle(args);
}
