import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import type { MarketAccessIngestResult, MarketAccessLineRecord } from '@/lib/market-access/contract';
import { resolveNationalTariffLine, type CandidateTariffLine, type ParsedDuty } from '@/lib/market-access/tariff-semantics';

export const PERU_RAW_BUNDLE_READER_VERSION = 'sunat-arancel-2022-consolidated-xlsx-reader-v1' as const;
export const PERU_COMPOSITE_BUNDLE_READER_VERSION_V2 = 'sunat-arancel-and-franja-pdf-bundle-reader-v2' as const;
export const PERU_BUNDLE_READER_VERSION = 'sunat-arancel-franja-and-mincetur-bundle-reader-v3' as const;
export const PERU_LEGACY_PARSER_VERSION = 'pe-sunat-tariff-parser-v1' as const;
export const PERU_COMPOSITE_PARSER_VERSION_V2 = 'pe-sunat-tariff-parser-v2' as const;
export const PERU_PARSER_VERSION = 'pe-sunat-tariff-parser-v3' as const;
export const PERU_PROVIDER = 'pe_sunat_customs_tariff' as const;
export const PERU_SOURCE_AUTHORITY = 'SUNAT / Ministerio de Economía y Finanzas del Perú' as const;
export const PERU_SOURCE_DATASET = 'Arancel de Aduanas 2022 consolidado and Sistema de Franja de Precios' as const;

const EXPECTED_SHEET = 'ARANCEL 2022';
const EXPECTED_HEADER = ['Subpartida Nacional', 'Descripcion del Arancel 2022', 'AD VALOREM'] as const;
const EXPECTED_ROW_COUNT = 8_017;
const GENERAL_RATES = new Set([0, 4, 6, 11]);
const SUNAT_XLSX_URL = 'https://www.sunat.gob.pe/orientacionaduanera/aranceles/Cap01-98-Descripcion.zip';
const FRANJA_RESOLUTION_URL = 'https://busquedas.elperuano.pe/dispositivo/NL/2545338-1';
const FRANJA_PDF_URL = 'https://busquedas.elperuano.pe/api/archivo/file/4lM0IZjiKpl9iq1LmL_dX5/*/2545338-1.PDF';
const MINCETUR_INDIA_STATUS_URL = 'https://www.acuerdoscomerciales.gob.pe/Negociacion/India/Sobre_Acuerdo.html';
const MINCETUR_AUTHORITY = 'Ministerio de Comercio Exterior y Turismo del Perú (MINCETUR)';
const FRANJA_EFFECTIVE_FROM = '2026-08-20';
const FRANJA_EFFECTIVE_TO = '2026-12-31';

type FranjaGroup = 'corn' | 'sugar' | 'rice_paddy' | 'rice_milled' | 'dairy';

const FRANJA_CODES: Readonly<Record<FranjaGroup, readonly string[]>> = Object.freeze({
  corn: ['1005901100', '1005901200', '1005901900', '1005909000', '1007900000', '1103130000', '1108120000', '1108130000', '1702302000', '2309909000', '3505100000'],
  sugar: ['1701120000', '1701140000', '1701999000', '1702904000', '1702600000', '1702902000', '1702903000'],
  rice_paddy: ['1006109000'],
  rice_milled: ['1006200000', '1006300000', '1006400000'],
  dairy: ['0401100000', '0401200000', '0402101000', '0402109000', '0402211100', '0402211900', '0402219100', '0402219900', '0402291100', '0402291900', '0402299100', '0402299900', '0402991000', '0404109000', '0405100000', '0405902000', '0405909000', '0406300000', '0406904000', '0406905000', '0406906000', '0406909000', '1901902000', '1901909000', '2106907900', '2106909000'],
});

const FRANJA_RATE_USD_PER_TONNE: Readonly<Record<FranjaGroup, number>> = Object.freeze({
  corn: 0,
  sugar: 64,
  rice_paddy: 100,
  rice_milled: 142,
  dairy: 0,
});

const FRANJA_BY_CODE = new Map<string, FranjaGroup>(
  Object.entries(FRANJA_CODES).flatMap(([group, codes]) => codes.map((code) => [code, group as FranjaGroup])),
);

export class PeruBundleError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'PeruBundleError';
  }
}

export interface PeruTariffRow {
  code: string;
  description: string;
  ad_valorem_rate_percent: number;
}

export interface PeruAuthorityBundle {
  checksum: string;
  size_bytes: number;
  release_identifier: string;
  source_url: string;
  rows: readonly PeruTariffRow[];
  files: readonly { name: string; size_bytes: number; sha256: string; role: string }[];
  reader_version: typeof PERU_RAW_BUNDLE_READER_VERSION | typeof PERU_COMPOSITE_BUNDLE_READER_VERSION_V2 | typeof PERU_BUNDLE_READER_VERSION;
  format: 'raw_sunat_zip' | 'composite_pdf_v3' | 'composite_pdf_html_v4';
  franja_decision_retained: boolean;
  india_preference_evidence: {
    authority: typeof MINCETUR_AUTHORITY;
    artifact: 'mincetur-india-agreement-status.html';
    page_title: string;
    source_url: typeof MINCETUR_INDIA_STATUS_URL;
    sha256: string;
  } | null;
}

interface ParsedSunatTariff { rows: PeruTariffRow[]; file: { name: string; size_bytes: number; sha256: string; role: string } }

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function plainCell(value: ExcelJS.CellValue): string {
  if (value == null) return '';
  if (typeof value === 'object') {
    if ('result' in value) return String(value.result ?? '').trim();
    if ('text' in value) return String(value.text ?? '').trim();
    throw new PeruBundleError('unexpected_cell', 'The SUNAT workbook contains an unsupported structured cell.');
  }
  return String(value).trim();
}

async function readSunatTariffZip(bytes: Buffer): Promise<ParsedSunatTariff> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes); }
  catch { throw new PeruBundleError('corrupt_archive', 'The SUNAT release is not a readable ZIP archive.'); }
  const files = Object.values(zip.files).filter((entry) => !entry.dir);
  if (files.length !== 1 || files[0]!.name !== 'Cap01-98-Descripcion.xlsx') {
    throw new PeruBundleError('unexpected_manifest', 'The SUNAT ZIP must contain exactly Cap01-98-Descripcion.xlsx.');
  }
  const workbookBytes = await files[0]!.async('nodebuffer');
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(workbookBytes as unknown as Parameters<typeof workbook.xlsx.load>[0]); }
  catch { throw new PeruBundleError('corrupt_workbook', 'The SUNAT archive does not contain a readable XLSX workbook.'); }
  if (workbook.worksheets.length !== 1 || workbook.worksheets[0]!.name !== EXPECTED_SHEET) {
    throw new PeruBundleError('unexpected_sheet', `The SUNAT workbook must contain only the ${EXPECTED_SHEET} worksheet.`);
  }
  const sheet = workbook.worksheets[0]!;
  const header = [1, 2, 3].map((column) => plainCell(sheet.getRow(1).getCell(column).value));
  if (!EXPECTED_HEADER.every((expected, index) => header[index] === expected)) {
    throw new PeruBundleError('unexpected_schema', `The SUNAT header ${JSON.stringify(header)} does not match ${JSON.stringify(EXPECTED_HEADER)}.`);
  }
  const rows: PeruTariffRow[] = [];
  const seen = new Set<string>();
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const displayedCode = plainCell(row.getCell(1).value);
    const code = displayedCode.replace(/\D/g, '');
    const description = plainCell(row.getCell(2).value);
    const rate = Number(plainCell(row.getCell(3).value));
    if (!/^\d{10}$/.test(code) || !description || !Number.isFinite(rate) || !GENERAL_RATES.has(rate)) {
      throw new PeruBundleError('invalid_row', `SUNAT row ${rowNumber} has an invalid code, description or ad-valorem rate.`);
    }
    if (seen.has(code)) throw new PeruBundleError('duplicate_code', `SUNAT publishes duplicate national code ${code}.`);
    seen.add(code);
    rows.push({ code, description, ad_valorem_rate_percent: rate });
  }
  if (rows.length !== EXPECTED_ROW_COUNT) {
    throw new PeruBundleError('incomplete_release', `SUNAT publishes ${rows.length} tariff rows; the MEF current-state control is ${EXPECTED_ROW_COUNT}.`);
  }
  for (const amendmentCode of ['0208900010', '0208900090', '9811000000']) {
    if (!seen.has(amendmentCode)) throw new PeruBundleError('amendment_missing', `The consolidated SUNAT workbook is missing amendment code ${amendmentCode}.`);
  }
  return { rows, file: { name: files[0]!.name, size_bytes: workbookBytes.length, sha256: sha256(workbookBytes), role: 'official_consolidated_tariff_workbook' } };
}

/** Reader for immutable releases imported before the franja document was bundled. */
export async function readPeruRawSunatZip(args: { bytes: Buffer; release_identifier: string; source_url: string }): Promise<PeruAuthorityBundle> {
  const tariff = await readSunatTariffZip(args.bytes);
  return {
    checksum: sha256(args.bytes), size_bytes: args.bytes.length,
    release_identifier: args.release_identifier, source_url: args.source_url,
    rows: tariff.rows, files: [tariff.file], reader_version: PERU_RAW_BUNDLE_READER_VERSION,
    format: 'raw_sunat_zip', franja_decision_retained: false, india_preference_evidence: null,
  };
}

interface CompositeManifest {
  acquisition_version?: unknown;
  artifacts?: Array<{ name?: unknown; role?: unknown; url?: unknown; landing_url?: unknown; size_bytes?: unknown; sha256?: unknown }>;
  legal_decision?: { identifier?: unknown; publication_date?: unknown; effective_from?: unknown; effective_to?: unknown };
  india_preference_evidence?: {
    authority?: unknown;
    artifact?: unknown;
    page_title?: unknown;
    observed_inventory_section?: unknown;
    assessment?: unknown;
    temporal_context?: unknown;
  };
}

function requireManifestArtifact(manifest: CompositeManifest, expected: { name: string; role: string; url: string }, bytes: Buffer) {
  const artifact = manifest.artifacts?.find((item) => item.name === expected.name);
  if (!artifact || artifact.role !== expected.role || artifact.url !== expected.url
    || artifact.size_bytes !== bytes.length || artifact.sha256 !== sha256(bytes)) {
    throw new PeruBundleError('artifact_hash_mismatch', `The acquisition manifest does not authenticate ${expected.name}.`);
  }
}

async function loadComposite(args: { bytes: Buffer }) {
  let composite: JSZip;
  try { composite = await JSZip.loadAsync(args.bytes); }
  catch { throw new PeruBundleError('corrupt_archive', 'The Peru authority release is not a readable ZIP archive.'); }
  return composite;
}

function requireReviewedFranja(bytes: Buffer) {
  const searchablePdf = bytes.toString('latin1');
  if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))
    || !['016-2026-EF/15.01', '2545338-1', 'derechos variables adicionales'].every((token) => searchablePdf.toLowerCase().includes(token.toLowerCase()))) {
    throw new PeruBundleError('franja_mismatch', 'The retained El Peruano PDF does not match the reviewed RVM 016 legal artifact.');
  }
}

function requireReviewedLegalDecision(manifest: CompositeManifest) {
  if (manifest.legal_decision?.identifier !== 'RVM 016-2026-EF/15.01'
    || manifest.legal_decision.publication_date !== '2026-08-20'
    || manifest.legal_decision.effective_from !== FRANJA_EFFECTIVE_FROM
    || manifest.legal_decision.effective_to !== FRANJA_EFFECTIVE_TO) {
    throw new PeruBundleError('unexpected_acquisition', 'The Peru acquisition manifest does not identify the reviewed RVM 016 legal decision.');
  }
}

async function readManifest(composite: JSZip) {
  const manifestBytes = await composite.file('acquisition.json')!.async('nodebuffer');
  let manifest: CompositeManifest;
  try { manifest = JSON.parse(manifestBytes.toString('utf8')) as CompositeManifest; }
  catch { throw new PeruBundleError('unexpected_acquisition', 'The Peru acquisition manifest is not valid JSON.'); }
  return { manifest, manifestBytes };
}

/** Immutable reader for v3 bundles already retained before MINCETUR evidence was added. */
export async function readPeruCompositeAuthorityZipV2(args: { bytes: Buffer; release_identifier: string; source_url: string }): Promise<PeruAuthorityBundle> {
  const composite = await loadComposite(args);
  const entries = Object.values(composite.files).filter((entry) => !entry.dir);
  const expected = ['acquisition.json', 'franja-resolution.pdf', 'sunat-tariff.zip'];
  if (entries.map((entry) => entry.name).sort().join('|') !== expected.join('|')) {
    throw new PeruBundleError('unexpected_manifest', `The retained Peru release must contain exactly ${expected.join(', ')}.`);
  }
  const { manifest, manifestBytes } = await readManifest(composite);
  if (manifest.acquisition_version !== 'sunat-tariff-and-franja-acquisition-v3') {
    throw new PeruBundleError('unexpected_acquisition', 'The Peru acquisition manifest does not identify the reviewed official sources and acquisition version.');
  }
  requireReviewedLegalDecision(manifest);
  const tariffBytes = await composite.file('sunat-tariff.zip')!.async('nodebuffer');
  const franjaBytes = await composite.file('franja-resolution.pdf')!.async('nodebuffer');
  requireManifestArtifact(manifest, { name: 'sunat-tariff.zip', role: 'official_consolidated_tariff', url: SUNAT_XLSX_URL }, tariffBytes);
  requireManifestArtifact(manifest, { name: 'franja-resolution.pdf', role: 'official_price_band_resolution', url: FRANJA_PDF_URL }, franjaBytes);
  requireReviewedFranja(franjaBytes);
  const tariff = await readSunatTariffZip(tariffBytes);
  return {
    checksum: sha256(args.bytes),
    size_bytes: args.bytes.length,
    release_identifier: args.release_identifier,
    source_url: args.source_url,
    rows: tariff.rows,
    files: [
      tariff.file,
      { name: 'sunat-tariff.zip', size_bytes: tariffBytes.length, sha256: sha256(tariffBytes), role: 'official_consolidated_tariff' },
      { name: 'franja-resolution.pdf', size_bytes: franjaBytes.length, sha256: sha256(franjaBytes), role: 'official_price_band_resolution' },
      { name: 'acquisition.json', size_bytes: manifestBytes.length, sha256: sha256(manifestBytes), role: 'acquisition_manifest' },
    ],
    reader_version: PERU_COMPOSITE_BUNDLE_READER_VERSION_V2,
    format: 'composite_pdf_v3', franja_decision_retained: true, india_preference_evidence: null,
  };
}

/** Current reader: SUNAT tariff + El Peruano decision + retained MINCETUR India status page. */
export async function readPeruCompositeAuthorityZip(args: { bytes: Buffer; release_identifier: string; source_url: string }): Promise<PeruAuthorityBundle> {
  const composite = await loadComposite(args);
  const entries = Object.values(composite.files).filter((entry) => !entry.dir);
  const expected = ['acquisition.json', 'franja-resolution.pdf', 'mincetur-india-agreement-status.html', 'sunat-tariff.zip'];
  if (entries.map((entry) => entry.name).sort().join('|') !== expected.join('|')) {
    throw new PeruBundleError('unexpected_manifest', `The retained Peru release must contain exactly ${expected.join(', ')}.`);
  }
  const { manifest, manifestBytes } = await readManifest(composite);
  if (manifest.acquisition_version !== 'sunat-tariff-franja-and-mincetur-acquisition-v4') {
    throw new PeruBundleError('unexpected_acquisition', 'The Peru acquisition manifest does not identify the reviewed official sources and acquisition version.');
  }
  requireReviewedLegalDecision(manifest);
  if (manifest.india_preference_evidence?.authority !== MINCETUR_AUTHORITY
    || manifest.india_preference_evidence.artifact !== 'mincetur-india-agreement-status.html'
    || manifest.india_preference_evidence.page_title !== 'Acuerdo Comercial Perú – India — Sobre la negociación'
    || manifest.india_preference_evidence.observed_inventory_section !== 'En negociación'
    || manifest.india_preference_evidence.assessment !== 'no_operative_preferential_agreement_identified'
    || typeof manifest.india_preference_evidence.temporal_context !== 'string') {
    throw new PeruBundleError('india_preference_evidence_mismatch', 'The manifest does not describe the reviewed MINCETUR India agreement evidence.');
  }
  const tariffBytes = await composite.file('sunat-tariff.zip')!.async('nodebuffer');
  const franjaBytes = await composite.file('franja-resolution.pdf')!.async('nodebuffer');
  const minceturBytes = await composite.file('mincetur-india-agreement-status.html')!.async('nodebuffer');
  requireManifestArtifact(manifest, { name: 'sunat-tariff.zip', role: 'official_consolidated_tariff', url: SUNAT_XLSX_URL }, tariffBytes);
  requireManifestArtifact(manifest, { name: 'franja-resolution.pdf', role: 'official_price_band_resolution', url: FRANJA_PDF_URL }, franjaBytes);
  requireManifestArtifact(manifest, { name: 'mincetur-india-agreement-status.html', role: 'official_trade_agreement_inventory_status', url: MINCETUR_INDIA_STATUS_URL }, minceturBytes);
  requireReviewedFranja(franjaBytes);
  const minceturText = minceturBytes.toString('utf8').toLowerCase();
  if (!['acuerdo comercial perú', 'india', 'en negociación', 'ministerio de comercio exterior'].every((token) => minceturText.includes(token))) {
    throw new PeruBundleError('india_preference_evidence_mismatch', 'The retained MINCETUR page does not match the reviewed Peru–India agreement inventory status.');
  }
  const tariff = await readSunatTariffZip(tariffBytes);
  const minceturSha256 = sha256(minceturBytes);
  return {
    checksum: sha256(args.bytes),
    size_bytes: args.bytes.length,
    release_identifier: args.release_identifier,
    source_url: args.source_url,
    rows: tariff.rows,
    files: [
      tariff.file,
      { name: 'sunat-tariff.zip', size_bytes: tariffBytes.length, sha256: sha256(tariffBytes), role: 'official_consolidated_tariff' },
      { name: 'franja-resolution.pdf', size_bytes: franjaBytes.length, sha256: sha256(franjaBytes), role: 'official_price_band_resolution' },
      { name: 'mincetur-india-agreement-status.html', size_bytes: minceturBytes.length, sha256: minceturSha256, role: 'official_trade_agreement_inventory_status' },
      { name: 'acquisition.json', size_bytes: manifestBytes.length, sha256: sha256(manifestBytes), role: 'acquisition_manifest' },
    ],
    reader_version: PERU_BUNDLE_READER_VERSION,
    format: 'composite_pdf_html_v4',
    franja_decision_retained: true,
    india_preference_evidence: {
      authority: MINCETUR_AUTHORITY,
      artifact: 'mincetur-india-agreement-status.html',
      page_title: manifest.india_preference_evidence.page_title,
      source_url: MINCETUR_INDIA_STATUS_URL,
      sha256: minceturSha256,
    },
  };
}

/** Current-format compatibility name retained for callers and fixtures. */
export const readPeruAuthorityZip = readPeruCompositeAuthorityZip;

export function readPeruAuthorityRelease(args: { bytes: Buffer; release_identifier: string; source_url: string; reader_version: string }) {
  if (args.reader_version === PERU_RAW_BUNDLE_READER_VERSION) return readPeruRawSunatZip(args);
  if (args.reader_version === PERU_COMPOSITE_BUNDLE_READER_VERSION_V2) return readPeruCompositeAuthorityZipV2(args);
  if (args.reader_version === PERU_BUNDLE_READER_VERSION) return readPeruCompositeAuthorityZip(args);
  throw new PeruBundleError('unsupported_reader_version', `Unsupported Peru reader version ${args.reader_version}.`);
}

function adValorem(rate: number): ParsedDuty {
  return { kind: 'ad_valorem', ad_valorem_rate_percent: rate, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null, expression: `${rate}%`, note: rate === 0 ? 'Observed legal zero published by SUNAT.' : null };
}

function franjaDuty(group: FranjaGroup): ParsedDuty {
  const amount = FRANJA_RATE_USD_PER_TONNE[group];
  return { kind: 'specific', ad_valorem_rate_percent: null, specific_amount: amount, specific_currency: 'USD', specific_unit: 'TNE', specific_unit_quantity: 1, expression: `USD ${amount} / TNE`, note: 'Monthly variable additional duty under RVM 016-2026-EF/15.01; retained separately from the general ad-valorem duty and subject to the legal price-band cap/rebate rules.' };
}

function utcDateOnly(value: Date) {
  if (Number.isNaN(value.getTime())) throw new PeruBundleError('invalid_effective_date', 'The Peru measure date is invalid.');
  return value.toISOString().slice(0, 10);
}

/** Legal dates are inclusive Peru publication dates represented as UTC date-only values. */
function isDateWithin(at: Date, effectiveFrom: string | null, effectiveTo: string | null) {
  const date = utcDateOnly(at);
  return (effectiveFrom === null || effectiveFrom <= date) && (effectiveTo === null || date <= effectiveTo);
}

export function buildPeruMarketAccess(args: { bundle: PeruAuthorityBundle; release_id: string; release_reference_date: Date; retrieved_at: Date; hs6: string; at: Date; origin_country?: string; parser_version?: string }): MarketAccessIngestResult {
  const origin = (args.origin_country ?? 'IN').trim().toUpperCase();
  const parserVersion = args.parser_version ?? PERU_PARSER_VERSION;
  if (![PERU_LEGACY_PARSER_VERSION, PERU_COMPOSITE_PARSER_VERSION_V2, PERU_PARSER_VERSION].includes(parserVersion as typeof PERU_PARSER_VERSION)) {
    throw new PeruBundleError('unsupported_parser_version', `Unsupported Peru parser version ${parserVersion}.`);
  }
  const legacyReplay = parserVersion === PERU_LEGACY_PARSER_VERSION;
  if (parserVersion === PERU_PARSER_VERSION && origin === 'IN' && !args.bundle.india_preference_evidence) {
    throw new PeruBundleError('india_preference_evidence_missing', 'Peru parser v3 requires the retained MINCETUR India agreement evidence artifact.');
  }
  const franjaInForce = isDateWithin(args.at, FRANJA_EFFECTIVE_FROM, FRANJA_EFFECTIVE_TO);
  const includeFranja = legacyReplay || (args.bundle.franja_decision_retained && franjaInForce);
  const generalEffectiveFrom = legacyReplay ? args.release_reference_date : null;
  const franjaEffectiveFrom = legacyReplay ? args.release_reference_date : new Date(`${FRANJA_EFFECTIVE_FROM}T00:00:00.000Z`);
  const franjaEffectiveTo = legacyReplay ? null : new Date(`${FRANJA_EFFECTIVE_TO}T00:00:00.000Z`);
  const tariffRows = args.bundle.rows.filter((row) => row.code.startsWith(args.hs6));
  const candidates: CandidateTariffLine[] = tariffRows.map((row) => {
    const franja = FRANJA_BY_CODE.get(row.code);
    return {
      national_tariff_code: row.code,
      description: row.description,
      declarable: true,
      effective_from: generalEffectiveFrom,
      effective_to: null,
      general_duty: adValorem(row.ad_valorem_rate_percent),
      control_codes: franja && includeFranja ? [`PE_FRANJA:${franja}`] : [],
      preference_area_ids: [],
    };
  });
  const resolution = resolveNationalTariffLine(candidates);
  const lines: MarketAccessLineRecord[] = [];
  for (const row of tariffRows) {
    const common = {
      national_tariff_code: row.code,
      description: row.description,
      declarable: true,
      applies_to_origin_country: origin,
      effective_from: generalEffectiveFrom,
      effective_to: null,
    };
    lines.push({
      ...common,
      measure_kind: 'third_country_duty',
      origin_geographic_area_id: null,
      origin_scope: 'erga_omnes',
      duty: adValorem(row.ad_valorem_rate_percent),
      conditions: { customs_value_basis: 'CIF', separate_from_franja_variable_duty: true },
      source_reference: `${SUNAT_XLSX_URL} · subpartida ${row.code}`,
      raw_measure: row,
    });
    const franja = FRANJA_BY_CODE.get(row.code);
    if (franja && includeFranja) {
      lines.push({
        ...common,
        effective_from: franjaEffectiveFrom,
        effective_to: franjaEffectiveTo,
        measure_kind: 'additional_duty',
        origin_geographic_area_id: null,
        origin_scope: 'erga_omnes',
        duty: franjaDuty(franja),
        conditions: {
          system: 'Sistema de Franja de Precios',
          product_group: franja,
          resolution: 'RVM 016-2026-EF/15.01',
          resolution_published: '2026-08-20',
          observed_price_period: '2026-07-01/2026-07-31',
          table_valid_through: '2026-12-31',
          maximum_total_duty_percent_of_cif: 40,
          conditional_description: ['1901902000', '1901909000'].includes(row.code) ? 'Source list applies when milk content is at least 50% by weight.' : null,
          no_ad_valorem_equivalent_inferred: true,
        },
        source_reference: `${FRANJA_RESOLUTION_URL} · ${franja}`,
        raw_measure: { code: row.code, group: franja, amount_usd_per_tonne: FRANJA_RATE_USD_PER_TONNE[franja], legal_basis: ['D.S. 115-2001-EF', 'D.S. 338-2025-EF', 'RVM 016-2026-EF/15.01'] },
      });
    }
  }
  const generalDuty = resolution.resolved_line?.general_duty ?? null;
  const minceturEvidence = args.bundle.india_preference_evidence;
  const preference = origin !== 'IN'
    ? { applicability: 'not_applicable' as const, duty: null, geographic_area_id: null, basis: `The requested origin is ${origin}, not India.` }
    : parserVersion === PERU_PARSER_VERSION && minceturEvidence
      ? {
        applicability: 'not_applicable' as const,
        duty: null,
        geographic_area_id: null,
        basis: `No operative preferential trade agreement applicable to imports from India was identified in MINCETUR's authoritative Peruvian trade-agreement inventory as of the ${utcDateOnly(args.release_reference_date)} release reference date.`,
        source_authority: minceturEvidence.authority,
        source_reference: `${minceturEvidence.source_url} · retained ${minceturEvidence.artifact} · SHA-256 ${minceturEvidence.sha256}`,
        raw_evidence: {
          authority: minceturEvidence.authority,
          artifact: minceturEvidence.artifact,
          page_title: minceturEvidence.page_title,
          retrieved_at: args.retrieved_at.toISOString(),
          release_reference_date: utcDateOnly(args.release_reference_date),
          source_reference: minceturEvidence.source_url,
          artifact_sha256: minceturEvidence.sha256,
          semantic_claim: 'no_operative_preferential_agreement_applicable_to_india_identified',
        },
      }
      : {
        applicability: 'not_applicable' as const,
        duty: null,
        geographic_area_id: null,
        basis: 'Historical Peru parser replay: the official in-force agreement inventory conclusion was recorded before its MINCETUR source page was retained in the authority bundle.',
      };
  return {
    jurisdiction: 'PE', country_code: 'PE', hs6: args.hs6,
    hs_revision: 'HS 2022 · NANDINA 8-digit · Peru 10-digit national subpartidas',
    provider: PERU_PROVIDER, source_authority: PERU_SOURCE_AUTHORITY, source_dataset: PERU_SOURCE_DATASET,
    source_dataset_version: `${args.bundle.release_identifier}; 8017 workbook rows validated`,
    source_reference: [
      args.bundle.source_url,
      ...(args.bundle.franja_decision_retained ? [FRANJA_RESOLUTION_URL] : []),
      ...(minceturEvidence ? [minceturEvidence.source_url] : []),
      `ZIP sha256 ${args.bundle.checksum}`,
    ].join(' · '),
    national_code_system: 'PE_NATIONAL_SUBPARTIDA', parser_version: parserVersion,
    source_release_id: args.release_id, request_identity: `origin=${origin};as_of=${args.at.toISOString().slice(0, 10)}`,
    retrieved_at: args.retrieved_at, evidence_class: 'authoritative_public', recorded_by_id: null,
    resolution, general_duty: generalDuty,
    india_preference: preference,
    lines, requirements: [], regulatory_coverage_complete: false,
    raw_evidence: {
      tariff_rows: tariffRows,
      workbook_validation: {
        row_count: EXPECTED_ROW_COUNT,
        amendment_code_presence_checked: ['9811000000', '0208900010', '0208900090'],
        mef_currentness_page_retained: false,
        amendment_texts_retained: false,
        automated_current_state_reconciliation: false,
      },
      rights_basis: 'Decreto Legislativo 822 Art. 9 excludes official legislative, administrative and judicial texts and simple facts/data; source attribution and text integrity are preserved, and third-party website/software/WCO assets are excluded.',
      franja_measure: {
        resolution: 'RVM 016-2026-EF/15.01', published: '2026-08-20',
        effective_from: FRANJA_EFFECTIVE_FROM, effective_to: FRANJA_EFFECTIVE_TO,
        applicable_on_requested_date: includeFranja,
        retained_in_authority_bundle: args.bundle.franja_decision_retained,
        rates_usd_per_tonne: FRANJA_RATE_USD_PER_TONNE, code_count: FRANJA_BY_CODE.size,
        table_authority: 'D.S. 338-2025-EF', table_valid_through: FRANJA_EFFECTIVE_TO,
        legacy_replay: legacyReplay,
      },
      india_preference_evidence: minceturEvidence ? (preference as { raw_evidence?: Record<string, unknown> }).raw_evidence : {
        retained_in_authority_bundle: false,
        historical_parser_replay: parserVersion !== PERU_PARSER_VERSION,
      },
    },
  };
}

export const __test__ = { FRANJA_CODES, FRANJA_RATE_USD_PER_TONNE, EXPECTED_ROW_COUNT, isDateWithin };
