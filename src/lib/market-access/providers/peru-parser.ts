import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import type { MarketAccessIngestResult, MarketAccessLineRecord } from '@/lib/market-access/contract';
import { resolveNationalTariffLine, type CandidateTariffLine, type ParsedDuty } from '@/lib/market-access/tariff-semantics';

export const PERU_BUNDLE_READER_VERSION = 'sunat-arancel-2022-consolidated-xlsx-reader-v1' as const;
export const PERU_PARSER_VERSION = 'pe-sunat-tariff-parser-v1' as const;
export const PERU_PROVIDER = 'pe_sunat_customs_tariff' as const;
export const PERU_SOURCE_AUTHORITY = 'SUNAT / Ministerio de Economía y Finanzas del Perú' as const;
export const PERU_SOURCE_DATASET = 'Arancel de Aduanas 2022 consolidado and Sistema de Franja de Precios' as const;

const EXPECTED_SHEET = 'ARANCEL 2022';
const EXPECTED_HEADER = ['Subpartida Nacional', 'Descripcion del Arancel 2022', 'AD VALOREM'] as const;
const EXPECTED_ROW_COUNT = 8_017;
const GENERAL_RATES = new Set([0, 4, 6, 11]);
const SUNAT_XLSX_URL = 'https://www.sunat.gob.pe/orientacionaduanera/aranceles/Cap01-98-Descripcion.zip';
const MEF_CURRENTNESS_URL = 'https://www.mef.gob.pe/es/?id=287&option=com_content&view=article';
const FRANJA_RESOLUTION_URL = 'https://busquedas.elperuano.pe/dispositivo/NL/2545338-1';

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
  files: readonly { name: string; size_bytes: number }[];
  reader_version: typeof PERU_BUNDLE_READER_VERSION;
}

interface ParsedSunatTariff { rows: PeruTariffRow[]; file: { name: string; size_bytes: number } }

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
  return { rows, file: { name: files[0]!.name, size_bytes: workbookBytes.length } };
}

export async function readPeruAuthorityZip(args: { bytes: Buffer; release_identifier: string; source_url: string }): Promise<PeruAuthorityBundle> {
  let composite: JSZip;
  try { composite = await JSZip.loadAsync(args.bytes); }
  catch { throw new PeruBundleError('corrupt_archive', 'The Peru authority release is not a readable ZIP archive.'); }
  const entries = Object.values(composite.files).filter((entry) => !entry.dir);
  const expected = ['acquisition.json', 'franja-resolution.html', 'sunat-tariff.zip'];
  if (entries.map((entry) => entry.name).sort().join('|') !== expected.join('|')) {
    throw new PeruBundleError('unexpected_manifest', `The retained Peru release must contain exactly ${expected.join(', ')}.`);
  }
  const manifest = JSON.parse(await composite.file('acquisition.json')!.async('text')) as Record<string, unknown>;
  if (manifest.acquisition_version !== 'sunat-tariff-and-franja-acquisition-v2'
    || manifest.tariff_url !== SUNAT_XLSX_URL || manifest.franja_url !== FRANJA_RESOLUTION_URL) {
    throw new PeruBundleError('unexpected_acquisition', 'The Peru acquisition manifest does not identify the reviewed official sources and acquisition version.');
  }
  const tariffBytes = await composite.file('sunat-tariff.zip')!.async('nodebuffer');
  const franjaBytes = await composite.file('franja-resolution.html')!.async('nodebuffer');
  const franjaText = franjaBytes.toString('utf8').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ');
  for (const token of ['016-2026-EF/15.01', 'Derechos Variables Adicionales 0 64 100 (arroz cáscara) 142 (arroz pilado) 0', '2545338-1']) {
    if (!franjaText.includes(token)) throw new PeruBundleError('franja_mismatch', `The retained El Peruano decision is missing reviewed token ${token}.`);
  }
  const tariff = await readSunatTariffZip(tariffBytes);
  return {
    checksum: createHash('sha256').update(args.bytes).digest('hex'),
    size_bytes: args.bytes.length,
    release_identifier: args.release_identifier,
    source_url: args.source_url,
    rows: tariff.rows,
    files: [tariff.file, { name: 'sunat-tariff.zip', size_bytes: tariffBytes.length }, { name: 'franja-resolution.html', size_bytes: franjaBytes.length }, { name: 'acquisition.json', size_bytes: Buffer.byteLength(JSON.stringify(manifest)) }],
    reader_version: PERU_BUNDLE_READER_VERSION,
  };
}

function adValorem(rate: number): ParsedDuty {
  return { kind: 'ad_valorem', ad_valorem_rate_percent: rate, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null, expression: `${rate}%`, note: rate === 0 ? 'Observed legal zero published by SUNAT.' : null };
}

function franjaDuty(group: FranjaGroup): ParsedDuty {
  const amount = FRANJA_RATE_USD_PER_TONNE[group];
  return { kind: 'specific', ad_valorem_rate_percent: null, specific_amount: amount, specific_currency: 'USD', specific_unit: 'TNE', specific_unit_quantity: 1, expression: `USD ${amount} / TNE`, note: 'Monthly variable additional duty under RVM 016-2026-EF/15.01; retained separately from the general ad-valorem duty and subject to the legal price-band cap/rebate rules.' };
}

export function buildPeruMarketAccess(args: { bundle: PeruAuthorityBundle; release_id: string; release_reference_date: Date; retrieved_at: Date; hs6: string; at: Date; origin_country?: string; parser_version?: string }): MarketAccessIngestResult {
  const origin = (args.origin_country ?? 'IN').trim().toUpperCase();
  const tariffRows = args.bundle.rows.filter((row) => row.code.startsWith(args.hs6));
  const candidates: CandidateTariffLine[] = tariffRows.map((row) => {
    const franja = FRANJA_BY_CODE.get(row.code);
    return {
      national_tariff_code: row.code,
      description: row.description,
      declarable: true,
      effective_from: null,
      effective_to: null,
      general_duty: adValorem(row.ad_valorem_rate_percent),
      control_codes: franja ? [`PE_FRANJA:${franja}`] : [],
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
      effective_from: null,
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
    if (franja) {
      lines.push({
        ...common,
        effective_from: new Date('2026-08-20T00:00:00.000Z'),
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
  return {
    jurisdiction: 'PE', country_code: 'PE', hs6: args.hs6,
    hs_revision: 'HS 2022 · NANDINA 8-digit · Peru 10-digit national subpartidas',
    provider: PERU_PROVIDER, source_authority: PERU_SOURCE_AUTHORITY, source_dataset: PERU_SOURCE_DATASET,
    source_dataset_version: `${args.bundle.release_identifier}; 8017-line consolidated state verified 2026-09-10`,
    source_reference: `${args.bundle.source_url} · ${MEF_CURRENTNESS_URL} · ${FRANJA_RESOLUTION_URL} · ZIP sha256 ${args.bundle.checksum}`,
    national_code_system: 'PE_NATIONAL_SUBPARTIDA', parser_version: args.parser_version ?? PERU_PARSER_VERSION,
    source_release_id: args.release_id, request_identity: `origin=${origin};as_of=${args.at.toISOString().slice(0, 10)}`,
    retrieved_at: args.retrieved_at, evidence_class: 'authoritative_public', recorded_by_id: null,
    resolution, general_duty: generalDuty,
    india_preference: origin === 'IN'
      ? { applicability: 'not_applicable', duty: null, geographic_area_id: null, basis: 'Peru’s official in-force agreement inventory is complete and has no operative India agreement; the India–Peru agreement remains under negotiation as of 2026-09-10.' }
      : { applicability: 'not_applicable', duty: null, geographic_area_id: null, basis: `The requested origin is ${origin}, not India.` },
    lines, requirements: [], regulatory_coverage_complete: false,
    raw_evidence: {
      tariff_rows: tariffRows,
      amendment_chain: { baseline: 'D.S. 404-2021-EF', sunat_log: ['D.S. 163-2022-EF'], mef_complete_chain: ['D.S. 163-2022-EF', 'D.S. 194-2022-EF'], reconciled_by_consolidated_codes: ['9811000000', '0208900010', '0208900090'], current_line_count: EXPECTED_ROW_COUNT },
      rights_basis: 'Decreto Legislativo 822 Art. 9 excludes official legislative, administrative and judicial texts and simple facts/data; source attribution and text integrity are preserved, and third-party website/software/WCO assets are excluded.',
      franja_current_state: { resolution: 'RVM 016-2026-EF/15.01', published: '2026-08-20', rates_usd_per_tonne: FRANJA_RATE_USD_PER_TONNE, code_count: FRANJA_BY_CODE.size, table_authority: 'D.S. 338-2025-EF', table_valid_through: '2026-12-31' },
    },
  };
}

export const __test__ = { FRANJA_CODES, FRANJA_RATE_USD_PER_TONNE, EXPECTED_ROW_COUNT };
