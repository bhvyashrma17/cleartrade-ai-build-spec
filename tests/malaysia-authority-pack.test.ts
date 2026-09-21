import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { DESTINATION_ADAPTERS } from '@/lib/job-handlers/market-access';
import { unconfiguredSourceForCountry } from '@/lib/market-access/unconfigured-sources';
import { acquireMalaysiaLocalBundle, malaysiaOfficialUrl } from '@/lib/market-access/providers/malaysia-acquisition';
import {
  buildMalaysiaLocalBundle,
  MALAYSIA_BUNDLE_READER_VERSION,
  MALAYSIA_PDF_PARSER_VERSION,
  MALAYSIA_RIGHTS_STATUS,
  parseMalaysiaImportDuty,
  parseMalaysiaTrqPages,
  readMalaysiaAuthorityBundle,
  type MalaysiaAuthorityBundle,
} from '@/lib/market-access/providers/malaysia-bundle';
import { buildMalaysiaMarketAccess } from '@/lib/market-access/providers/malaysia-parser';
import { importMalaysiaRelease } from '@/lib/market-access/providers/malaysia-service';
import {
  MALAYSIA_ACTIVE_REMEDY_INSTRUMENTS,
  MALAYSIA_ACTIVE_TRADE_REMEDY_MANIFEST,
  MALAYSIA_REMEDY_MANIFEST_VERSION,
  MALAYSIA_REMEDY_REFERENCE_DATE,
  selectMalaysiaTradeRemedies,
  validateMalaysiaRemedyManifest,
  type MalaysiaTradeRemedyManifest,
} from '@/lib/market-access/providers/malaysia-remedies';
import type { PdfTablePage, PdfTariffLine } from '@/lib/market-access/providers/pdf-table-family';

const hash = 'a'.repeat(64);
const remedyManifest = (): MalaysiaTradeRemedyManifest => ({
  version: MALAYSIA_REMEDY_MANIFEST_VERSION, complete_as_of: MALAYSIA_REMEDY_REFERENCE_DATE,
  remedies: MALAYSIA_ACTIVE_REMEDY_INSTRUMENTS.map((source, index) => ({
    id: `${source.id}:CN`, instrument_id: source.id, instrument: source.instrument, amendments: source.amendments, source_url: `https://www.customs.gov.my/${source.id}-0.pdf`, source_sha256: hash,
    source_documents: [source.instrument, ...source.amendments].map((instrument, sourceIndex) => ({ instrument, url: `https://www.customs.gov.my/${source.id}-${sourceIndex}.pdf`, sha256: hash })),
    effective_from: source.effective_from, effective_to: source.effective_to, operation: 'ADD', description: source.product,
    tariff_codes: [`99${String(index).padStart(8, '0')}`], origin_country: 'CN',
    rates: [{ producer_or_exporter: 'Named Producer', rate_percent_cif: 4.5 + index, catch_all: false }, { producer_or_exporter: 'Other producers or exporters', rate_percent_cif: 20 + index, catch_all: true }],
  })),
});

const line = (code: string, expression: string): PdfTariffLine => ({
  code, description: `Synthetic qualification line ${code}`, unit: 'kg',
  cells: { import_duty: parseMalaysiaImportDuty(expression, 'kg') }, raw_cells: { import_duty: expression }, source_pages: [16],
});

describe('Malaysia Customs Duties Order implementation', () => {
  it('preserves ordinary, legal-zero, blank, specific, compound and mixed duty semantics without an AVE', () => {
    expect(parseMalaysiaImportDuty('5%', 'kg')).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 5 });
    expect(parseMalaysiaImportDuty('0%', 'u')).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0 });
    expect(parseMalaysiaImportDuty('', 'kg')).toMatchObject({ kind: 'none', ad_valorem_rate_percent: null });
    expect(parseMalaysiaImportDuty('RM0.60', 'kg')).toMatchObject({ kind: 'specific', specific_amount: 0.6, specific_currency: 'MYR', specific_unit: 'kg', ad_valorem_rate_percent: null });
    expect(parseMalaysiaImportDuty('5% and RM1.30', 'kg')).toMatchObject({ kind: 'compound', ad_valorem_rate_percent: 5, specific_amount: 1.3, specific_unit: 'kg' });
    expect(parseMalaysiaImportDuty('10% or RM2.00', 'kg')).toMatchObject({ kind: 'mixed', ad_valorem_rate_percent: 10, specific_amount: 2 });
    expect(parseMalaysiaImportDuty('2 0%', 'kg')).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 20 });
    expect(parseMalaysiaImportDuty('0% 0%', 'kg')).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0 });
  });

  it('maps all Appendix B rows to separate in/out rates and quota agencies', () => {
    const items: PdfTablePage['items'][number][] = [];
    for (let index = 0; index < 27; index += 1) {
      const y = 500 - index * 16; const code = `${String(index + 1).padStart(4, '0')}.00.00 00`;
      items.push({ str: code, x: 129, y }, { str: 'kg', x: 443, y }, { str: '10%', x: 502, y }, { str: '20%', x: 578, y }, { str: 'Quota Agency', x: 634, y });
    }
    const result = parseMalaysiaTrqPages([{ page_number: 1371, width: 760, height: 560, items }]);
    expect(result.size).toBe(27);
    expect(result.get('0001000000')).toMatchObject({ quota_agency: 'Quota Agency', in_quota_duty: { ad_valorem_rate_percent: 10 }, out_of_quota_duty: { ad_valorem_rate_percent: 20 } });
  });

  it('requires producer identity before selecting a producer-specific trade-remedy rate', () => {
    const manifest = remedyManifest(); const first = manifest.remedies[0]!; const at = new Date(`${first.effective_from}T12:00:00.000Z`);
    expect(selectMalaysiaTradeRemedies({ manifest, code: first.tariff_codes[0]!, origin_country: 'CN', at }).status).toBe('producer_refinement_required');
    const selected = selectMalaysiaTradeRemedies({ manifest, code: first.tariff_codes[0]!, origin_country: 'CN', at, producer_or_exporter: 'Named Producer' });
    expect(selected).toMatchObject({ status: 'applicable', remedies: [{ rate: { rate_percent_cif: 4.5, catch_all: false } }] });
  });

  it('ships the complete reviewed remedy schedules instead of requiring caller-supplied rows', () => {
    expect(validateMalaysiaRemedyManifest(MALAYSIA_ACTIVE_TRADE_REMEDY_MANIFEST)).toBe(MALAYSIA_ACTIVE_TRADE_REMEDY_MANIFEST);
    expect(new Set(MALAYSIA_ACTIVE_TRADE_REMEDY_MANIFEST.remedies.map((item) => item.instrument_id))).toEqual(new Set(MALAYSIA_ACTIVE_REMEDY_INSTRUMENTS.map((item) => item.id)));
    expect(MALAYSIA_ACTIVE_TRADE_REMEDY_MANIFEST.remedies).toHaveLength(20);
    expect(MALAYSIA_ACTIVE_TRADE_REMEDY_MANIFEST.remedies.every((item) => item.source_documents.length > 0)).toBe(true);
    expect(MALAYSIA_ACTIVE_TRADE_REMEDY_MANIFEST.remedies.find((item) => item.id === 'PUA267-2026:VN')?.rates).toContainEqual(expect.objectContaining({ producer_or_exporter: 'Nam Kim Steel Joint Stock Company', rate_percent_cif: 0 }));
  });

  it('builds deterministic, hashed local bundles and rejects altered artifacts', async () => {
    const lines = new Map([['0101210000', line('0101210000', '0%')]]); const trq = new Map();
    const args = { release_identifier: 'PUA384-2025-test', source_url: 'https://www.customs.gov.my/PUA_384.pdf', artifacts: [], lines, trq, remedies: remedyManifest() };
    const one = await buildMalaysiaLocalBundle(args); const two = await buildMalaysiaLocalBundle(args);
    expect(one.equals(two)).toBe(true);
    const read = await readMalaysiaAuthorityBundle({ bytes: one, release_identifier: args.release_identifier });
    expect(read).toMatchObject({ rights_status: MALAYSIA_RIGHTS_STATUS, reader_version: MALAYSIA_BUNDLE_READER_VERSION, parser_version: MALAYSIA_PDF_PARSER_VERSION });
    expect(read.lines.get('0101210000')?.cells.import_duty.ad_valorem_rate_percent).toBe(0);
    const zip = await JSZip.loadAsync(one); zip.file('normalized-lines.json', '[]');
    const altered = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
    await expect(readMalaysiaAuthorityBundle({ bytes: altered, release_identifier: args.release_identifier })).rejects.toMatchObject({ code: 'artifact_hash_mismatch' });
  });

  it('fails closed on MICECA mapping, keeps sales tax separate and marks regulatory coverage incomplete', () => {
    const lines = new Map([['0101210000', line('0101210000', '0%')]]);
    const bundle: MalaysiaAuthorityBundle = { checksum: hash, release_identifier: 'PUA384/2025', source_url: 'https://www.customs.gov.my/PUA_384.pdf', lines, trq: new Map(), remedies: remedyManifest(),
      rights_status: MALAYSIA_RIGHTS_STATUS, files: [], reader_version: MALAYSIA_BUNDLE_READER_VERSION, parser_version: MALAYSIA_PDF_PARSER_VERSION };
    const result = buildMalaysiaMarketAccess({ bundle, release_id: 'local-only', release_reference_date: new Date('2026-09-21'), retrieved_at: new Date('2026-09-21'), hs6: '010121', at: new Date('2026-09-21'), origin_country: 'IN' });
    expect(result.general_duty).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0 });
    expect(result.india_preference).toMatchObject({ applicability: 'potentially_applicable_requires_origin_proof', duty: null, geographic_area_id: 'MY_MICECA' });
    expect(result.regulatory_coverage_complete).toBe(false);
    expect(result.raw_evidence).toMatchObject({ sales_tax: { coverage: 'partial_separate', stacked_into_customs_duty: false }, rights_status: MALAYSIA_RIGHTS_STATUS });
  });

  it('hard-blocks retention/activation and remains absent from routing and staging', async () => {
    await expect(importMalaysiaRelease({} as never)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(DESTINATION_ADAPTERS.MY).toBeUndefined();
    expect(unconfiguredSourceForCountry('MY')).toMatchObject({ reason: 'license_pending' });
  });

  it('enforces HTTPS authority allowlisting and reports official-source failures', async () => {
    expect(() => malaysiaOfficialUrl('http://www.customs.gov.my/file.pdf')).toThrow(/rejects/);
    expect(() => malaysiaOfficialUrl('https://example.com/file.pdf')).toThrow(/rejects/);
    const fetchImpl = async () => new Response('unavailable', { status: 503 });
    await expect(acquireMalaysiaLocalBundle({ release_identifier: 'failure-test', remedies: remedyManifest(), fetch_impl: fetchImpl as typeof fetch, attempts: 1 })).rejects.toThrow(/official acquisition failed/);
    expect(() => parseMalaysiaTrqPages([{ page_number: 1371, width: 760, height: 560, items: [] }])).toThrow(/expected 27/);
  });
});
