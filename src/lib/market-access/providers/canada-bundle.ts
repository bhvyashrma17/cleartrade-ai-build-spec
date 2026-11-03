import { createHash } from 'node:crypto';
import MDBReader from 'mdb-reader';
import JSZip from 'jszip';
import { CANADA_ACQUISITION_VERSION } from './canada-acquisition';

export const CANADA_BUNDLE_READER_VERSION = 'cbsa-access-bundle-reader-v1' as const;

const OUTER_FILES = new Set([
  'cbsa-tariff-release.zip',
  'countries-and-treatments.html',
  'acquisition.json',
]);

export const CANADA_TPHS_COLUMNS = [
  'TARIFF', 'EFF_DATE', 'CHANGE', 'SUB_CHAP', 'DESC1', 'DESC2', 'DESC3', 'FOOTNOTE', 'UOM',
  'MFN', 'AUT', 'NZT', 'CCCT', 'LDCT', 'GPT', 'UST', 'MXT', 'CIAT', 'CT', 'CRT', 'IT', 'NT',
  'SLT', 'PT', 'COLT', 'JT', 'PAT', 'HNT', 'KRT', 'CEUT', 'CPTPT', 'UKT', 'row_id', 'UAT',
  'General Tariff', 'CPUKT',
] as const;

export type CanadaTariffRow = Record<string, string | number | Date | null> & {
  TARIFF: string;
  EFF_DATE: Date;
  CHANGE: number;
  MFN: string | null;
  UOM: string | null;
  DESC1: string | null;
  DESC2: string | null;
  DESC3: string | null;
  FOOTNOTE: string | null;
};

export interface CanadaIndiaTreatment {
  mfn: boolean;
  gpt: boolean;
  ldct: boolean;
  other_treatments: string[];
  source_row_text: string;
}
export interface CanadaAuthorityBundle {
  checksum: string;
  size_bytes: number;
  files: Array<{ name: string; sha256: string; size_bytes: number; role: string }>;
  release_identifier: string;
  tariff_url: string;
  country_treatments_url: string;
  rows: CanadaTariffRow[];
  india_treatment: CanadaIndiaTreatment;
  reader_version: typeof CANADA_BUNDLE_READER_VERSION;
}

export class CanadaBundleError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'CanadaBundleError';
  }
}

type AccessDecoder = (bytes: Buffer) => { columns: string[]; rows: CanadaTariffRow[] };

const defaultAccessDecoder: AccessDecoder = (bytes) => {
  const database = new MDBReader(bytes);
  if (!database.getTableNames().includes('TPHS')) {
    throw new CanadaBundleError('missing_tphs', 'The CBSA Access database has no TPHS tariff table.');
  }
  const table = database.getTable('TPHS');
  return { columns: table.getColumnNames(), rows: table.getData<CanadaTariffRow>() };
};

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/\s+/g, ' ').trim();
}

export function parseCanadaIndiaTreatment(html: string): CanadaIndiaTreatment {
  if (!/List of countries and applicable tariff treatments/i.test(html)
      || !/<th[^>]*>\s*MFN\s*<\/th>/i.test(html)
      || !/<th[^>]*>\s*GPT\s*<\/th>/i.test(html)
      || !/<th[^>]*>\s*LDCT\s*<\/th>/i.test(html)) {
    throw new CanadaBundleError('unexpected_treatment_schema', 'The CBSA country-treatment table headers changed.');
  }
  const row = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((match) => match[1] ?? '')
    .find((candidate) => /<th[^>]*[^>]*>\s*India\s*<\/th>/i.test(candidate));
  if (!row) throw new CanadaBundleError('missing_india_treatment', 'The CBSA country-treatment table has no India row.');
  const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => stripHtml(match[1] ?? ''));
  if (cells.length < 4) throw new CanadaBundleError('unexpected_india_treatment', 'The CBSA India treatment row has fewer than four treatment columns.');
  const yes = (value: string) => /^yes$/i.test(value);
  return {
    mfn: yes(cells[0]!),
    gpt: yes(cells[1]!),
    ldct: yes(cells[2]!),
    other_treatments: cells[3] ? cells[3]!.split(/[,;]\s*/).filter(Boolean) : [],
    source_row_text: stripHtml(row),
  };
}

/** Validate and decode the retained composite bundle without guessing around schema drift. */
export async function readCanadaAuthorityBundle(
  bytes: Buffer,
  options: { access_decoder?: AccessDecoder } = {},
): Promise<CanadaAuthorityBundle> {
  let outer: JSZip;
  try {
    outer = await JSZip.loadAsync(bytes);
  } catch {
    throw new CanadaBundleError('corrupt_archive', 'The Canada authority bundle is not a readable ZIP archive.');
  }
  const names = Object.values(outer.files).filter((entry) => !entry.dir).map((entry) => entry.name);
  if (names.some((name) => name.includes('/') || !OUTER_FILES.has(name)) || names.length !== OUTER_FILES.size) {
    throw new CanadaBundleError('unexpected_bundle_files', 'The Canada authority bundle must contain exactly the official tariff ZIP, treatment HTML and acquisition manifest.');
  }
  const sourceZip = Buffer.from(await outer.file('cbsa-tariff-release.zip')!.async('uint8array'));
  const treatmentBytes = Buffer.from(await outer.file('countries-and-treatments.html')!.async('uint8array'));
  const acquisitionBytes = Buffer.from(await outer.file('acquisition.json')!.async('uint8array'));
  let acquisition: Record<string, unknown>;
  try {
    acquisition = JSON.parse(acquisitionBytes.toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new CanadaBundleError('invalid_acquisition_manifest', 'The Canada acquisition manifest is not valid JSON.');
  }
  if (acquisition.acquisition_version !== CANADA_ACQUISITION_VERSION
      || typeof acquisition.release_identifier !== 'string'
      || typeof acquisition.tariff_url !== 'string'
      || typeof acquisition.country_treatments_url !== 'string') {
    throw new CanadaBundleError('invalid_acquisition_manifest', 'The Canada acquisition manifest is incomplete or from an unsupported acquisition version.');
  }

  let source: JSZip;
  try {
    source = await JSZip.loadAsync(sourceZip);
  } catch {
    throw new CanadaBundleError('corrupt_cbsa_archive', 'The retained official CBSA tariff download is not a readable ZIP archive.');
  }
  const sourceFiles = Object.values(source.files).filter((entry) => !entry.dir);
  if (sourceFiles.length !== 1 || sourceFiles[0]!.name.includes('/') || !/\.accdb$/i.test(sourceFiles[0]!.name)) {
    throw new CanadaBundleError('unexpected_cbsa_archive', 'The official CBSA release must contain exactly one root-level Access database.');
  }
  const accessBytes = Buffer.from(await sourceFiles[0]!.async('uint8array'));
  let decoded;
  try {
    decoded = (options.access_decoder ?? defaultAccessDecoder)(accessBytes);
  } catch (error) {
    if (error instanceof CanadaBundleError) throw error;
    throw new CanadaBundleError('unreadable_access_database', `The CBSA Access database could not be read: ${String(error)}`);
  }
  if (decoded.columns.length !== CANADA_TPHS_COLUMNS.length
      || decoded.columns.some((column, index) => column !== CANADA_TPHS_COLUMNS[index])) {
    throw new CanadaBundleError('unexpected_tphs_schema', 'The CBSA TPHS column order changed; refusing to parse the wrong fields.');
  }
  if (!decoded.rows.length) throw new CanadaBundleError('empty_tphs', 'The CBSA TPHS tariff table is empty.');

  const file = (name: string, data: Buffer, role: string) => ({
    name,
    sha256: createHash('sha256').update(data).digest('hex'),
    size_bytes: data.length,
    role,
  });
  return {
    checksum: createHash('sha256').update(bytes).digest('hex'),
    size_bytes: bytes.length,
    files: [
      file('cbsa-tariff-release.zip', sourceZip, 'official_tariff_release'),
      file(sourceFiles[0]!.name, accessBytes, 'official_access_database'),
      file('countries-and-treatments.html', treatmentBytes, 'official_origin_treatment_enumeration'),
      file('acquisition.json', acquisitionBytes, 'acquisition_manifest'),
    ],
    release_identifier: acquisition.release_identifier,
    tariff_url: acquisition.tariff_url,
    country_treatments_url: acquisition.country_treatments_url,
    rows: decoded.rows,
    india_treatment: parseCanadaIndiaTreatment(treatmentBytes.toString('utf8')),
    reader_version: CANADA_BUNDLE_READER_VERSION,
  };
}
