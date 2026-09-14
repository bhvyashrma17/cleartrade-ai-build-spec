import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import {
  ICELAND_ACQUISITION_VERSION,
  ICELAND_DEVIATIONS_URL,
  ICELAND_DRAWING_URL,
  ICELAND_KEYS_PAGE_URL,
  ICELAND_LAYOUT_URL,
  ICELAND_PRINTED_TARIFF_URL,
  ICELAND_SOFTWARE_GUIDE_URL,
  ICELAND_TEPA_NOTICE_URL,
} from './iceland-acquisition';

export const ICELAND_BUNDLE_READER_VERSION = 'skatturinn-fixed-width-bundle-reader-v1' as const;

export class IcelandBundleError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'IcelandBundleError';
  }
}

export interface IcelandRawMeasure { code: string; percent_hundredths: number; specific_hundredths: number }
export type IcelandFeeMeasure = IcelandRawMeasure;
export interface IcelandTariffLine {
  code: string;
  declarable: boolean;
  measures: ReadonlyMap<string, IcelandRawMeasure>;
  fees: readonly IcelandFeeMeasure[];
  permit_codes: readonly string[];
  prohibition_codes: readonly string[];
  flag_codes: readonly string[];
  quantity_codes: readonly string[];
  base_unit: 'kg' | 'piece';
  requires_vehicle_serial: boolean;
  requires_unit_count: boolean;
  requires_litres: boolean;
  requires_net_weight: boolean;
}
export interface IcelandAuthorityBundle {
  checksum: string;
  size_bytes: number;
  release_identifier: string;
  keys_source_url: string;
  files: readonly { name: string; size_bytes: number; sha256: string; role: string }[];
  lines: ReadonlyMap<string, IcelandTariffLine>;
  physical_record_count: number;
  record_type_counts: Readonly<Record<string, number>>;
  reader_version: typeof ICELAND_BUNDLE_READER_VERSION;
}

const EXPECTED = [
  ['tariff-keys.zip', 'official_effective_dated_tariff_keys', null],
  ['keys-publication.html', 'official_release_index_and_history', ICELAND_KEYS_PAGE_URL],
  ['record-layout.pdf', 'official_fixed_width_field_dictionary_and_reuse_statement', ICELAND_LAYOUT_URL],
  ['record-drawing.pdf', 'official_fixed_width_record_drawing', ICELAND_DRAWING_URL],
  ['known-deviations.pdf', 'official_scope_and_deviation_statement', ICELAND_DEVIATIONS_URL],
  ['printed-tariff.pdf', 'official_controlling_tariff_with_descriptions', ICELAND_PRINTED_TARIFF_URL],
  ['india-tepa-notice.html', 'official_india_tepa_effective_date_and_origin_conditions', ICELAND_TEPA_NOTICE_URL],
  ['software-guide.pdf', 'official_free_use_statement_for_customs_software', ICELAND_SOFTWARE_GUIDE_URL],
] as const;
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const chunks = (value: string, size: number) => Array.from({ length: Math.floor(value.length / size) }, (_, index) => value.slice(index * size, (index + 1) * size));
const tokens = (value: string, size: number) => chunks(value, size).map((item) => item.trim()).filter(Boolean);

function decimalDigits(value: string, field: string, record: number) {
  if (!/^\d+$/.test(value)) throw new IcelandBundleError('invalid_numeric_field', `Record ${record} has a non-numeric ${field}.`);
  return Number.parseInt(value, 10);
}

export async function readIcelandAuthorityBundle(args: { bytes: Buffer; release_identifier: string }): Promise<IcelandAuthorityBundle> {
  let bundleZip: JSZip;
  try { bundleZip = await JSZip.loadAsync(args.bytes); }
  catch { throw new IcelandBundleError('corrupt_archive', 'The Iceland authority bundle is not a readable ZIP archive.'); }
  const expectedNames = [...EXPECTED.map(([name]) => name), 'acquisition.json'].sort();
  const actualNames = Object.values(bundleZip.files).filter((entry) => !entry.dir).map((entry) => entry.name).sort();
  if (actualNames.join('|') !== expectedNames.join('|')) throw new IcelandBundleError('unexpected_manifest', `The Iceland bundle must contain exactly ${expectedNames.join(', ')}.`);

  const manifestBytes = Buffer.from(await bundleZip.file('acquisition.json')!.async('nodebuffer'));
  let manifest: { acquisition_version?: unknown; release_identifier?: unknown; effective_from?: unknown; artifacts?: Array<Record<string, unknown>>; rights_evidence?: Record<string, unknown>; india_preference_evidence?: Record<string, unknown> };
  try { manifest = JSON.parse(manifestBytes.toString('utf8')); }
  catch { throw new IcelandBundleError('invalid_manifest', 'The Iceland acquisition manifest is not valid JSON.'); }
  if (manifest.acquisition_version !== ICELAND_ACQUISITION_VERSION || manifest.release_identifier !== args.release_identifier || manifest.effective_from !== args.release_identifier) {
    throw new IcelandBundleError('unexpected_acquisition', 'The Iceland manifest does not identify the reviewed release and acquisition version.');
  }
  if (manifest.rights_evidence?.artifact !== 'record-layout.pdf' || manifest.india_preference_evidence?.authority_code !== 'YX' || manifest.india_preference_evidence?.requires_origin_proof !== true) {
    throw new IcelandBundleError('missing_legal_evidence', 'The Iceland bundle does not retain the reviewed reuse and India-origin evidence.');
  }

  const files: Array<{ name: string; size_bytes: number; sha256: string; role: string }> = [];
  for (const [name, role, url] of EXPECTED) {
    const bytes = Buffer.from(await bundleZip.file(name)!.async('nodebuffer'));
    const entry = manifest.artifacts?.find((item) => item.name === name);
    const entryUrl = typeof entry?.url === 'string' ? entry.url : '';
    const exactUrl = url === null ? /^https:\/\/www\.skatturinn\.is\/media\/tollamal\/TSKINN\d{8}\.zip$/.test(entryUrl) : entryUrl === url;
    if (!entry || entry.role !== role || !exactUrl || entry.size_bytes !== bytes.length || entry.sha256 !== sha256(bytes)) {
      throw new IcelandBundleError('artifact_hash_mismatch', `The acquisition manifest does not authenticate ${name}.`);
    }
    files.push({ name, role, size_bytes: bytes.length, sha256: sha256(bytes) });
  }
  files.push({ name: 'acquisition.json', role: 'acquisition_manifest', size_bytes: manifestBytes.length, sha256: sha256(manifestBytes) });

  const rawZipBytes = Buffer.from(await bundleZip.file('tariff-keys.zip')!.async('nodebuffer'));
  let rawZip: JSZip;
  try { rawZip = await JSZip.loadAsync(rawZipBytes); }
  catch { throw new IcelandBundleError('corrupt_tariff_keys', 'The retained Skatturinn tariff-key artifact is not a readable ZIP archive.'); }
  const rawEntries = Object.values(rawZip.files).filter((entry) => !entry.dir);
  const expectedRawName = `Tollsk${args.release_identifier.replaceAll('-', '')}.txt`;
  if (rawEntries.length !== 1 || rawEntries[0]!.name !== expectedRawName) throw new IcelandBundleError('unexpected_tariff_key_manifest', `The tariff-key ZIP must contain exactly ${expectedRawName}.`);
  const raw = Buffer.from(await rawEntries[0]!.async('nodebuffer')).toString('latin1');
  const records = raw.split(/\r?\n/).filter((line) => line.length > 0);
  if (!records.length) throw new IcelandBundleError('empty_release', 'The Skatturinn tariff-key file contains no records.');

  type Mutable = { code: string; declarable: boolean; measures: Map<string, IcelandRawMeasure>; fees: IcelandFeeMeasure[]; permit_codes: string[]; prohibition_codes: string[]; flag_codes: string[]; quantity_codes: string[]; base_unit: 'kg' | 'piece'; requires_vehicle_serial: boolean; requires_unit_count: boolean; requires_litres: boolean; requires_net_weight: boolean };
  const parsed = new Map<string, Mutable>();
  const counts: Record<string, number> = {};
  const lineFor = (code: string) => {
    let line = parsed.get(code);
    if (!line) {
      line = { code, declarable: false, measures: new Map(), fees: [], permit_codes: [], prohibition_codes: [], flag_codes: [], quantity_codes: [], base_unit: 'kg', requires_vehicle_serial: false, requires_unit_count: false, requires_litres: false, requires_net_weight: false };
      parsed.set(code, line);
    }
    return line;
  };

  records.forEach((source, index) => {
    const recordNumber = index + 1;
    const value = source.replace(/\0+$/g, '');
    const type = value[0] ?? '';
    const code = value.slice(1, 9);
    if (!/^[1-5]$/.test(type) || !/^\d{8}$/.test(code)) throw new IcelandBundleError('invalid_fixed_width_record', `Record ${recordNumber} has an invalid record type or tariff code.`);
    counts[type] = (counts[type] ?? 0) + 1;
    const line = lineFor(code);
    if (['1', '2', '3'].includes(type)) {
      if (type === '1') line.declarable = true;
      if (value.length < 243) throw new IcelandBundleError('truncated_fixed_width_record', `Duty record ${recordNumber} is shorter than the published 243-character layout.`);
      for (const field of chunks(value.slice(9, 243), 13)) {
        const measureCode = field.slice(0, 2).trim();
        if (!measureCode) continue;
        if (line.measures.has(measureCode)) throw new IcelandBundleError('duplicate_measure', `Tariff code ${code} repeats measure ${measureCode}.`);
        line.measures.set(measureCode, {
          code: measureCode,
          percent_hundredths: decimalDigits(field.slice(2, 7), 'percentage', recordNumber),
          specific_hundredths: decimalDigits(field.slice(7, 13), 'specific amount', recordNumber),
        });
      }
    } else if (type === '4') {
      if (value.length < 230) throw new IcelandBundleError('truncated_fixed_width_record', `Control record ${recordNumber} is shorter than the published 230-character layout.`);
      for (const field of chunks(value.slice(9, 169), 16)) {
        const measureCode = field.slice(0, 2).trim();
        if (!measureCode) continue;
        line.fees.push({ code: measureCode, percent_hundredths: decimalDigits(field.slice(2, 7), 'fee percentage', recordNumber), specific_hundredths: decimalDigits(field.slice(7, 16), 'fee specific amount', recordNumber) });
      }
      line.permit_codes = tokens(value.slice(169, 190), 3);
      line.prohibition_codes = tokens(value.slice(190, 199), 3);
      line.flag_codes = tokens(value.slice(199, 214), 5);
      line.requires_vehicle_serial = Boolean(value[214]?.trim());
      line.requires_unit_count = Boolean(value[215]?.trim());
      line.base_unit = value[227] === 'E' ? 'piece' : 'kg';
      line.requires_litres = Boolean(value[228]?.trim());
      line.requires_net_weight = Boolean(value[229]?.trim());
    } else {
      if (value.length < 99) throw new IcelandBundleError('truncated_fixed_width_record', `Quantity record ${recordNumber} is shorter than the published 99-character layout.`);
      line.quantity_codes.push(...tokens(value.slice(9, 99), 3));
    }
  });

  const tariffLines = [...parsed.values()].filter((line) => line.declarable);
  if (!tariffLines.length || !tariffLines.some((line) => line.measures.has('A'))) throw new IcelandBundleError('missing_general_duties', 'The Skatturinn file contains no declarable lines with general-duty (A) measures.');
  const keysSourceUrl = String(manifest.artifacts?.find((item) => item.name === 'tariff-keys.zip')?.url ?? '');
  return {
    checksum: sha256(args.bytes), size_bytes: args.bytes.length, release_identifier: args.release_identifier,
    keys_source_url: keysSourceUrl,
    files, lines: new Map(tariffLines.map((line) => [line.code, line])), physical_record_count: records.length,
    record_type_counts: counts, reader_version: ICELAND_BUNDLE_READER_VERSION,
  };
}

export function readIcelandAuthorityRelease(args: { bytes: Buffer; release_identifier: string; reader_version: string }) {
  if (args.reader_version !== ICELAND_BUNDLE_READER_VERSION) {
    throw new IcelandBundleError('unsupported_reader_version', `Unsupported Iceland authority reader version ${args.reader_version}.`);
  }
  return readIcelandAuthorityBundle(args);
}
