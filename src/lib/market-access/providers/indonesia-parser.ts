import { MarketAccessRuleType } from '@prisma/client';
import type { MarketAccessIngestResult, MarketAccessLineRecord } from '@/lib/market-access/contract';
import { parsePublishedDuty, extractPdfTablePages, type PdfTablePage } from './pdf-table-family';
import { resolveNationalTariffLine, type ParsedDuty } from '@/lib/market-access/tariff-semantics';
import type { IndonesiaAuthorityBundle, IndonesiaTariffLine } from './indonesia-bundle';
import { selectIndonesiaTradeRemedies } from './indonesia-remedies';

export const INDONESIA_PARSER_VERSION = 'id-btki-2022-pmk50-2026-aifta-remedies-v1' as const;
export const INDONESIA_SOURCE_AUTHORITY = 'Kementerian Keuangan Republik Indonesia' as const;
export const INDONESIA_EXPECTED_MFN_ROWS = 11_702;
// The instrument's printed serials end at 11,546, but six inserted declarable sublines are
// intentionally unnumbered. The machine identity is therefore 11,552 unique eight-digit lines.
export const INDONESIA_EXPECTED_PMK62_ROWS = 11_552;
export const INDONESIA_EXPECTED_AIFTA_SCHEDULE_ENTRIES = 11_414;
export const INDONESIA_EXPECTED_AIFTA_PARSED_COORDINATE_ENTRIES = 11_412;
export const INDONESIA_EXPECTED_AIFTA_CODES = 11_401;

const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
const digits = (value: string) => value.replace(/\D/g, '');
const cell = (page: PdfTablePage, left: number, right: number, y: number, tolerance = 2) => clean(page.items
  .filter((item) => item.x >= left && item.x < right && Math.abs(item.y - y) <= tolerance)
  .sort((a, b) => a.x - b.x).map((item) => item.str).join(' '));

const BASE_RATE_REPAIRS: Readonly<Record<string, number>> = Object.freeze({
  '07102100': 5, '12119099': 5, '14012029': 0, '19012030': 5, '19012040': 5,
  '21011111': 5, '22089091': 150, '24012050': 5, '24041210': 5,
  '29034600': 5, '29034800': 5, '29211200': 5, '29211300': 5, '29211400': 5,
  '29262000': 5, '62103040': 20, '72061090': 0, '85176291': 10,
  '87021042': 5, '87045211': 10,
});

const EARLY_BASE_RATE_REPAIRS: Readonly<Record<string, number>> = Object.freeze({
  '01022919': 5, '01023100': 0, '01029010': 0, '01029090': 5, '01031000': 0,
  '01041010': 0, '01041090': 5, '01042010': 0, '01042090': 5,
  '01051110': 0, '01051190': 5, '01051210': 0, '01051290': 5,
  '01051310': 0, '01051390': 5,
});

function parseIndonesiaDuty(raw: string): ParsedDuty {
  const value=clean(raw).replace(/^so(?=,)/i,'50').replace(/^s(?=,)/i,'5').replace(/[qQ]/g,'0');
  const rupiah=/^(?:Rp\.?\s*)?([\d.]+),-\s*\/\s*([A-Za-z]+)$/i.exec(value);
  if(rupiah){const amount=Number(rupiah[1]!.replaceAll('.',''));const unit=rupiah[2]!.toLowerCase();return {kind:'specific',ad_valorem_rate_percent:null,specific_amount:amount,specific_currency:'IDR',specific_unit:unit,specific_unit_quantity:1,expression:`IDR ${amount}/${unit}`,note:null};}
  const firstNumber=/^(\d+(?:[.,]\d+)?)/.exec(value);
  if(firstNumber){const rate=Number(firstNumber[1]!.replace(',','.'));return {kind:'ad_valorem',ad_valorem_rate_percent:rate,specific_amount:null,specific_currency:null,specific_unit:null,specific_unit_quantity:null,expression:`${rate}%`,note:/^\d+(?:[.,]\d+)?%$/.test(value)?null:`Normalized from source glyphs: ${value}`};}
  return parsePublishedDuty(value.replace(',','.'),'IDR');
}

function repairedDuty(code: string, raw: string) {
  const known = BASE_RATE_REPAIRS[code] ?? EARLY_BASE_RATE_REPAIRS[code];
  if (known !== undefined) return parsePublishedDuty(`${known}%`, 'IDR');
  return parseIndonesiaDuty(raw);
}

function baseRows(pages: readonly PdfTablePage[]) {
  if (pages.length !== 673) throw new Error(`PMK 26/2022 has ${pages.length} pages; expected 673.`);
  const rows = new Map<string, IndonesiaTariffLine>();
  for (const page of pages.slice(229)) {
    const ys: number[] = [];
    for (const y of page.items.filter((item) => item.x >= 110 && item.x < 171 && item.str.trim()).map((item) => item.y).sort((a, b) => b - a)) {
      if (!ys.some((seen) => Math.abs(seen - y) < 0.7)) ys.push(y);
    }
    for (const y of ys) {
      const rawCode = cell(page, 110, 171, y, 0.7);
      const code = digits(rawCode);
      if (code.length !== 8) continue;
      const rawDuty = cell(page, 470, page.width, y, 2);
      const duty = repairedDuty(code, rawDuty);
      if (!rawDuty && !(code in EARLY_BASE_RATE_REPAIRS)) continue;
      const description = cell(page, 316, 470, y, 2);
      if (!rows.has(code) || rawDuty) rows.set(code, { code, description, duty, raw_duty: rawDuty || duty.expression, source_pages: [page.page_number] });
    }
  }
  for (const [code, rate] of Object.entries(BASE_RATE_REPAIRS)) {
    if (!rows.has(code)) rows.set(code, { code, description: '', duty: parsePublishedDuty(`${rate}%`, 'IDR'), raw_duty: `${rate}%`, source_pages: [] });
  }
  return rows;
}

/** PMK 50 Annex II is a complete replacement snapshot: every numbered row is retained. */
interface IndonesiaLineOperation {
  instrument: 'PMK 62/2025' | 'PMK 50/2026';
  precedence: 2 | 3;
  operation: 'ADD' | 'DELETE' | 'REPLACE' | 'CORRECTION';
  code: string;
  before: string | null;
  after: string | null;
  source_page: number | null;
}

function overlayRows(args: {
  pages: readonly PdfTablePage[];
  firstTablePage: number;
  expectedPages: number;
  expectedRows: number;
  instrument: IndonesiaLineOperation['instrument'];
  precedence: IndonesiaLineOperation['precedence'];
  prior: ReadonlyMap<string, IndonesiaTariffLine>;
}) {
  if (args.pages.length !== args.expectedPages) throw new Error(`${args.instrument} has ${args.pages.length} pages; expected ${args.expectedPages}.`);
  const rows = new Map<string, IndonesiaTariffLine>();
  const operations: IndonesiaLineOperation[] = [];
  for (const page of args.pages.slice(args.firstTablePage - 1)) {
    const serials = page.items.filter((item) => item.x >= 80 && item.x < 116 && /^\d+$/.test(item.str.trim())).sort((a, b) => b.y - a.y);
    const ys: number[] = [];
    for (const serial of serials) if (!ys.some((seen) => Math.abs(seen - serial.y) < 0.8)) ys.push(serial.y);
    for (const y of ys) {
      const code = digits(cell(page, 115, 180, y, 0.8));
      if (code.length !== 8) continue;
      const rawDuty = cell(page, 478, page.width, y, 2).replace(/\s+/g, '');
      const unchanged = /Tetap|Notchange/i.test(rawDuty);
      const prior = args.prior.get(code);
      if (unchanged && !prior) throw new Error(`${args.instrument} marks ${code} unchanged but the preceding schedule has no rate.`);
      const description = cell(page, 337, 478, y, 2);
      const descriptionUnchanged = /Tetap|Not change/i.test(description);
      const next = {
        code, description: descriptionUnchanged ? (prior?.description ?? '') : description,
        duty: unchanged ? prior!.duty : parseIndonesiaDuty(rawDuty),
        raw_duty: unchanged ? prior!.raw_duty : rawDuty, source_pages: [page.page_number],
      };
      rows.set(code, next);
      if (!prior) operations.push({ instrument: args.instrument, precedence: args.precedence, operation: 'ADD', code, before: null, after: next.duty.expression, source_page: page.page_number });
      else if (prior.duty.expression !== next.duty.expression || prior.description !== next.description) operations.push({ instrument: args.instrument, precedence: args.precedence,
        operation: prior.duty.expression === next.duty.expression ? 'CORRECTION' : 'REPLACE', code,
        before: prior.duty.expression, after: next.duty.expression, source_page: page.page_number });
    }
  }
  if (rows.size !== args.expectedRows) throw new Error(`${args.instrument} schedule yielded ${rows.size} rows; expected ${args.expectedRows}.`);
  for (const [code, before] of args.prior) if (!rows.has(code)) operations.push({ instrument: args.instrument, precedence: args.precedence,
    operation: 'DELETE', code, before: before.duty.expression, after: null, source_page: null });
  return { rows, operations };
}

export async function parseIndonesiaMfnPdfs(basePdf: Buffer, secondAmendmentPdf: Buffer, currentPdf: Buffer) {
  const base = baseRows(await extractPdfTablePages(basePdf));
  const second = overlayRows({ pages: await extractPdfTablePages(secondAmendmentPdf), firstTablePage: 77,
    expectedPages: 263, expectedRows: INDONESIA_EXPECTED_PMK62_ROWS, instrument: 'PMK 62/2025', precedence: 2, prior: base });
  const current = overlayRows({ pages: await extractPdfTablePages(currentPdf), firstTablePage: 46,
    expectedPages: 431, expectedRows: INDONESIA_EXPECTED_MFN_ROWS, instrument: 'PMK 50/2026', precedence: 3, prior: second.rows });
  const unresolved = [...current.rows.values()].filter((line) => ['none', 'unparsed'].includes(line.duty.kind));
  if (unresolved.length) throw new Error(`PMK 50 replay left ${unresolved.length} current MFN duties blank or unparsed: ${unresolved.slice(0,20).map((line)=>`${line.code}=${line.raw_duty}`).join(', ')}.`);
  return { base, second_amendment: second.rows, current: current.rows, operations: [...second.operations, ...current.operations] };
}

export async function parseIndonesiaAiftaPdf(pdf: Buffer) {
  const pages = await extractPdfTablePages(pdf);
  if (pages.length !== 451) throw new Error(`PMK 47/2022 has ${pages.length} pages; expected 451.`);
  const lines = new Map<string, IndonesiaTariffLine>();
  let scheduleEntries = 0;
  for (const page of pages.slice(7)) {
    const rowYs: number[] = [];
    for (const y of page.items.filter((item) => item.x >= 70 && item.x < 100 && /\d/.test(item.str) && item.y < 825).map((item) => item.y).sort((a,b)=>b-a)) {
      if (!rowYs.some((seen) => Math.abs(seen-y) < 0.7)) rowYs.push(y);
    }
    for (const y of rowYs) {
      const codeCandidates = page.items.filter((item) => item.x >= 95 && item.x < 160 && /[\d.]/.test(item.str) && Math.abs(item.y-y) <= 5);
      if (!codeCandidates.length) continue;
      const codeY = [...codeCandidates].sort((a,b)=>Math.abs(a.y-y)-Math.abs(b.y-y))[0]!.y;
      const code = digits(cell(page, 95, 160, codeY, 0.7));
      if (code.length !== 8) continue;
      const dutyCandidates = page.items.filter((item) => item.x >= 455 && /(?:MFN|\d|%)/i.test(item.str) && Math.abs(item.y-codeY) <= 5);
      if (!dutyCandidates.length) continue;
      const dutyY = [...dutyCandidates].sort((a,b)=>Math.abs(a.y-codeY)-Math.abs(b.y-codeY))[0]!.y;
      const rawDuty = cell(page, 455, page.width, dutyY, 0.7).replace(',', '.');
      if (!rawDuty || !/(?:MFN|\d)/i.test(rawDuty)) continue;
      scheduleEntries += 1;
      const duty = /^MFN$/i.test(clean(rawDuty))
        ? parsePublishedDuty('MFN', 'IDR')
        : parsePublishedDuty(rawDuty, 'IDR');
      const next = { code, description: cell(page, 309, 455, codeY, 2), duty, raw_duty: clean(rawDuty), source_pages: [page.page_number], variant_count: 1 };
      const prior = lines.get(code);
      if (!prior) lines.set(code, next);
      else if (prior.duty.expression === duty.expression) lines.set(code, { ...prior,
        description: [prior.description, next.description].filter(Boolean).join(' | '), source_pages: [...new Set([...prior.source_pages, page.page_number])], variant_count: (prior.variant_count ?? 1) + 1 });
      else lines.set(code, { code, description: [prior.description, next.description].filter(Boolean).join(' | '),
        duty: { kind:'mixed',ad_valorem_rate_percent:null,specific_amount:null,specific_currency:null,specific_unit:null,specific_unit_quantity:null,
          expression:`Product-scope variants: ${prior.duty.expression} | ${duty.expression}`,note:'The AIFTA schedule publishes multiple ex-scope rates under one national code; product refinement is required.' },
        raw_duty:`${prior.raw_duty} | ${clean(rawDuty)}`,source_pages:[...new Set([...prior.source_pages,page.page_number])],variant_count:(prior.variant_count??1)+1 });
    }
  }
  // PMK 92/2022 replaces, rather than duplicates, tariff line 9031.20.00. It creates two
  // ex-scope variants under the same national code, so product operation is required to select
  // 4% (electrically operated) or 0% (not electrically operated).
  const amended = lines.get('90312000');
  if (!amended) throw new Error('PMK 47 AIFTA schedule did not contain amended line 9031.20.00.');
  lines.set('90312000', { ...amended, variant_count: Math.max(amended.variant_count ?? 1, 2), duty: {
    kind: 'mixed', ad_valorem_rate_percent: null, specific_amount: null, specific_currency: null,
    specific_unit: null, specific_unit_quantity: null,
    expression: '4% if electrically operated; 0% if not electrically operated',
    note: 'PMK 92/2022 splits tariff line 9031.20.00 into two ex-scope product variants; product operation must be established.',
  }, raw_duty: 'PMK 92/2022: ex9031.20.00 electrically operated 4.00%; not electrically operated 0.00%' });
  if (lines.size !== INDONESIA_EXPECTED_AIFTA_CODES) throw new Error(`AIFTA schedule yielded ${lines.size} unique codes; expected ${INDONESIA_EXPECTED_AIFTA_CODES}.`);
  if (scheduleEntries !== INDONESIA_EXPECTED_AIFTA_PARSED_COORDINATE_ENTRIES) throw new Error(`AIFTA coordinate parser yielded ${scheduleEntries} entries; expected ${INDONESIA_EXPECTED_AIFTA_PARSED_COORDINATE_ENTRIES}.`);
  // Repeated ex-scope entries share national codes; the numbered official schedule contains 11,414 entries.
  return { lines, schedule_entries: INDONESIA_EXPECTED_AIFTA_SCHEDULE_ENTRIES, parsed_coordinate_entries: scheduleEntries };
}

function lineRecord(line: IndonesiaTariffLine, kind: 'third_country_duty' | 'tariff_preference', source: string): MarketAccessLineRecord {
  return { national_tariff_code: line.code, description: line.description, declarable: true, measure_kind: kind,
    origin_geographic_area_id: kind === 'tariff_preference' ? 'IN' : null, origin_scope: kind === 'tariff_preference' ? 'country' : 'erga_omnes',
    applies_to_origin_country: kind === 'tariff_preference' ? 'IN' : null, duty: line.duty, conditions: {}, effective_from: new Date('2026-07-28T00:00:00.000Z'), effective_to: null,
    source_reference: source, raw_measure: { raw_duty: line.raw_duty, source_pages: line.source_pages } };
}

export function buildIndonesiaMarketAccess(args: { bundle: IndonesiaAuthorityBundle; release_id: string; release_reference_date: Date; retrieved_at: Date; hs6: string; at: Date; origin_country?: string; producer_or_exporter?: string; parser_version?: string }): MarketAccessIngestResult {
  const mfn = [...args.bundle.mfn.values()].filter((line) => line.code.startsWith(args.hs6));
  const candidates = mfn.map((line) => ({ national_tariff_code: line.code, description: line.description, declarable: true, effective_from: new Date('2026-07-28T00:00:00.000Z'), effective_to: null,
    general_duty: line.duty, control_codes: [], preference_area_ids: args.bundle.aifta.has(line.code) ? ['AIFTA-IN'] : [] }));
  const resolution = resolveNationalTariffLine(candidates);
  const resolved = resolution.resolved_line ? args.bundle.mfn.get(resolution.resolved_line.national_tariff_code)! : null;
  const publishedPreference = resolution.resolved_line ? args.bundle.aifta.get(resolution.resolved_line.national_tariff_code) ?? null : null;
  const preference = publishedPreference && /^MFN$/i.test(publishedPreference.raw_duty)
    ? { ...publishedPreference, duty: resolved?.duty ?? publishedPreference.duty }
    : publishedPreference;
  const origin = args.origin_country?.trim().toUpperCase();
  const remedies = selectIndonesiaTradeRemedies({ manifest: args.bundle.remedies, code: resolution.resolved_line?.national_tariff_code ?? '', origin_country: origin ?? '', at: args.at, producer_or_exporter: args.producer_or_exporter });
  const source = `${args.bundle.source_url} (bundle sha256 ${args.bundle.checksum})`;
  const lines: MarketAccessLineRecord[] = mfn.map((line) => lineRecord(line, 'third_country_duty', source));
  if (preference) lines.push(lineRecord(preference, 'tariff_preference', source));
  if (remedies.status === 'applicable') for (const item of remedies.remedies) lines.push({
    national_tariff_code: resolution.resolved_line!.national_tariff_code, description: item.remedy.product, declarable: true,
    measure_kind: 'additional_duty', origin_geographic_area_id: item.rate.origin_country, origin_scope: item.rate.origin_country === '*' ? 'erga_omnes' : 'country', applies_to_origin_country: item.rate.origin_country === '*' ? null : item.rate.origin_country,
    duty: item.rate.duty, conditions: { component: item.remedy.kind, instrument: item.remedy.instrument, producer_or_exporter: item.rate.producer_or_exporter },
    effective_from: new Date(item.remedy.effective_from), effective_to: new Date(item.remedy.effective_until), source_reference: item.remedy.source_url, raw_measure: item.remedy,
  });
  return {
    jurisdiction: `Indonesia — ${args.bundle.release_identifier}`, country_code: 'ID', hs6: args.hs6, hs_revision: 'HS 2022 / AHTN 2022', provider: 'Indonesia BTKI legal schedule',
    source_authority: INDONESIA_SOURCE_AUTHORITY, source_dataset: 'PMK 26/2022 + PMK 10/2024 + PMK 62/2025 + PMK 50/2026; AIFTA PMK 47/2022 + PMK 92/2022 + PMK 35/2023',
    source_dataset_version: args.bundle.release_identifier, source_reference: source, national_code_system: 'ID_BTKI_2022', parser_version: args.parser_version ?? INDONESIA_PARSER_VERSION,
    source_release_id: args.release_id, request_identity: `origin=${origin ?? ''};producer=${args.producer_or_exporter ?? ''};as_of=${args.at.toISOString().slice(0, 10)}`,
    retrieved_at: args.retrieved_at, evidence_class: 'authoritative_public', recorded_by_id: null, resolution,
    general_duty: resolved?.duty ?? null,
    india_preference: preference && origin === 'IN' ? { applicability: 'potentially_applicable_requires_origin_proof', duty: preference.duty, basis: 'AIFTA preference exists, but PMK 35/2023 origin documentation and product-specific origin rules must be satisfied.', geographic_area_id: 'AIFTA-IN', source_authority: INDONESIA_SOURCE_AUTHORITY, source_reference: source }
      : { applicability: origin === 'IN' ? 'unknown' : 'not_applicable', duty: null, basis: origin === 'IN' ? 'No resolved AIFTA line was established.' : 'The request origin is not India.', geographic_area_id: null },
    lines, requirements: [
      ...(remedies.status === 'producer_refinement_required' ? [{ rule_type: MarketAccessRuleType.material_non_tariff_requirement, requirement_code: 'PRODUCER_IDENTITY', requirement_description: 'An active producer-specific Indonesian anti-dumping measure may apply; producer/exporter identity is required.', requirement_obtainable: true, national_tariff_code: resolution.resolved_line?.national_tariff_code ?? null, effective_from: null, effective_to: null, source_reference: source, raw: remedies.candidates }] : []),
      ...(remedies.status === 'origin_exemption_review_required' ? [{ rule_type: MarketAccessRuleType.material_non_tariff_requirement, requirement_code: 'SAFEGUARD_ORIGIN_EXEMPTION', requirement_description: 'An active Indonesian safeguard covers this product. The instrument annex and certificate of origin must be checked before determining whether India is exempt.', requirement_obtainable: true, national_tariff_code: resolution.resolved_line?.national_tariff_code ?? null, effective_from: null, effective_to: null, source_reference: source, raw: remedies.candidates }] : []),
      ...(preference && preference.variant_count && preference.variant_count > 1 && preference.duty.kind === 'mixed' ? [{ rule_type: MarketAccessRuleType.material_non_tariff_requirement, requirement_code: preference.code === '90312000' ? 'AIFTA_90312000_PRODUCT_VARIANT' : 'AIFTA_PRODUCT_VARIANT', requirement_description: preference.code === '90312000' ? 'PMK 92/2022 publishes 4% for electrically operated test benches and 0% otherwise under the same tariff code; product operation must be established.' : 'The AIFTA schedule publishes multiple ex-scope treatments under this national tariff code; product scope must be refined before selecting a preferential duty.', requirement_obtainable: true, national_tariff_code: preference.code, effective_from: preference.code === '90312000' ? new Date('2022-06-02T00:00:00.000Z') : null, effective_to: null, source_reference: source, raw: preference }] : []),
    ],
    regulatory_coverage_complete: false,
    raw_evidence: { authority_release_id: args.release_id, bundle_sha256: args.bundle.checksum, release_reference_date: args.release_reference_date.toISOString(), reader_version: args.bundle.reader_version, parser_version: args.parser_version ?? INDONESIA_PARSER_VERSION,
      mfn_row_count: args.bundle.mfn.size, aifta_unique_code_count: args.bundle.aifta.size, aifta_schedule_entry_count: args.bundle.aifta_schedule_entries, amendment_replay: args.bundle.amendment_operations,
      remedy_decision: remedies, tariff_treatment_complete: true, regulatory_coverage_complete: false, india_origin_proof_required: true },
  };
}
