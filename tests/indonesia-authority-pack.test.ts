import { describe, expect, it } from 'vitest';
import { DESTINATION_ADAPTERS } from '@/lib/job-handlers/market-access';
import { unconfiguredSourceForCountry } from '@/lib/market-access/unconfigured-sources';
import {
  acquireIndonesiaOfficialPdf,
  indonesiaOfficialUrl,
  INDONESIA_PINNED_ARTIFACTS,
  INDONESIA_SOURCE_PRECEDENCE_VERSION,
} from '@/lib/market-access/providers/indonesia-acquisition';
import {
  INDONESIA_BUNDLE_READER_VERSION,
  type IndonesiaAuthorityBundle,
  type IndonesiaTariffLine,
} from '@/lib/market-access/providers/indonesia-bundle';
import { buildIndonesiaMarketAccess } from '@/lib/market-access/providers/indonesia-parser';
import {
  INDONESIA_ACTIVE_TRADE_REMEDY_MANIFEST,
  selectIndonesiaTradeRemedies,
  validateIndonesiaRemedyManifest,
} from '@/lib/market-access/providers/indonesia-remedies';
import { parsePublishedDuty } from '@/lib/market-access/providers/pdf-table-family';

const hash = 'a'.repeat(64);
const line = (code: string, rate: number, variantCount?: number): IndonesiaTariffLine => ({
  code,
  description: `Qualification line ${code}`,
  duty: parsePublishedDuty(`${rate}%`, 'IDR'),
  raw_duty: `${rate}%`,
  source_pages: [1],
  variant_count: variantCount,
});

function bundle(mfnLine: IndonesiaTariffLine, aiftaLine?: IndonesiaTariffLine): IndonesiaAuthorityBundle {
  return {
    checksum: hash,
    size_bytes: 1,
    release_identifier: '2026-09-21',
    source_url: 'https://peraturan.bpk.go.id/Details/215104/pmk-no-26pmk0102022',
    mfn: new Map([[mfnLine.code, mfnLine]]),
    aifta: new Map(aiftaLine ? [[aiftaLine.code, aiftaLine]] : []),
    aifta_schedule_entries: 11_414,
    remedies: INDONESIA_ACTIVE_TRADE_REMEDY_MANIFEST,
    files: [],
    amendment_operations: [],
    rights: {},
    reader_version: INDONESIA_BUNDLE_READER_VERSION,
  };
}

describe('Indonesia official-government-mirror authority pack', () => {
  it('pins the deterministic official source set and rejects non-government URLs', () => {
    expect(INDONESIA_SOURCE_PRECEDENCE_VERSION).toBe('id-government-mirror-precedence-v1');
    expect(Object.keys(INDONESIA_PINNED_ARTIFACTS)).toHaveLength(31);
    expect(indonesiaOfficialUrl('https://peraturan.bpk.go.id/Download/410515/2026pmkeuangan014.pdf')).toContain('peraturan.bpk.go.id');
    expect(() => indonesiaOfficialUrl('http://peraturan.bpk.go.id/file.pdf')).toThrow(/rejects/);
    expect(() => indonesiaOfficialUrl('https://example.com/file.pdf')).toThrow(/rejects/);
  });

  it('validates PDF integrity and hash pins during acquisition', async () => {
    const pdf = Buffer.from('%PDF-1.7\n'.padEnd(120, 'x'));
    const response = async () => new Response(pdf, { status: 200, headers: { 'content-type': 'application/pdf' } });
    const acquired = await acquireIndonesiaOfficialPdf({ url: 'https://peraturan.bpk.go.id/file.pdf', fetch_impl: response as typeof fetch, attempts: 1 });
    expect(acquired.size_bytes).toBe(120);
    await expect(acquireIndonesiaOfficialPdf({ url: 'https://peraturan.bpk.go.id/file.pdf', expected_sha256: hash, fetch_impl: response as typeof fetch, attempts: 1 })).rejects.toThrow(/SHA-256 changed/);
  });

  it('ships the complete reviewed active-remedy enumeration', () => {
    expect(validateIndonesiaRemedyManifest(INDONESIA_ACTIVE_TRADE_REMEDY_MANIFEST)).toBe(INDONESIA_ACTIVE_TRADE_REMEDY_MANIFEST);
    expect(INDONESIA_ACTIVE_TRADE_REMEDY_MANIFEST.remedies.filter((item) => item.kind === 'ANTI_DUMPING')).toHaveLength(15);
    expect(INDONESIA_ACTIVE_TRADE_REMEDY_MANIFEST.remedies.filter((item) => item.kind === 'SAFEGUARD')).toHaveLength(9);
    expect(INDONESIA_ACTIVE_TRADE_REMEDY_MANIFEST.remedies.every((item) => item.artifact_sha256.length === 64)).toBe(true);
  });

  it('requires producer identity for India-origin BOPET and selects normalized exact identities', () => {
    const args = { manifest: INDONESIA_ACTIVE_TRADE_REMEDY_MANIFEST, code: '39206210', origin_country: 'IN', at: new Date('2026-09-21T12:00:00.000Z') };
    expect(selectIndonesiaTradeRemedies(args).status).toBe('producer_refinement_required');
    expect(selectIndonesiaTradeRemedies({ ...args, producer_or_exporter: 'SRF LIMITED' })).toMatchObject({
      status: 'applicable', remedies: [{ remedy: { instrument: 'PMK 14/2026' }, rate: { duty: { ad_valorem_rate_percent: 8.5 } } }],
    });
  });

  it('applies the PMK 31 deletion and PMK 32 provisional Wuhan measure exactly once', () => {
    const result = selectIndonesiaTradeRemedies({ manifest: INDONESIA_ACTIVE_TRADE_REMEDY_MANIFEST, code: '72083990', origin_country: 'CN', at: new Date('2026-09-21T12:00:00.000Z'), producer_or_exporter: 'Wuhan Iron and Steel, Co., Ltd.' });
    expect(result).toMatchObject({ status: 'applicable', remedies: [{ remedy: { instrument: 'PMK 32/2026' }, rate: { duty: { ad_valorem_rate_percent: 17.5 } } }] });
    if (result.status === 'applicable') expect(result.remedies).toHaveLength(1);
    expect(selectIndonesiaTradeRemedies({ manifest: INDONESIA_ACTIVE_TRADE_REMEDY_MANIFEST, code: '72083990', origin_country: 'CN', at: new Date('2026-05-16T12:00:00.000Z'), producer_or_exporter: 'Wuhan Iron and Steel, Co., Ltd.' })).toMatchObject({
      status: 'applicable', remedies: [{ remedy: { instrument: 'PMK 103/2024' }, rate: { duty: { ad_valorem_rate_percent: 0 } } }],
    });
  });

  it('honours reviewed India safeguard exemptions and period-specific specific duties', () => {
    expect(selectIndonesiaTradeRemedies({ manifest: INDONESIA_ACTIVE_TRADE_REMEDY_MANIFEST, code: '55092200', origin_country: 'IN', at: new Date('2026-09-21T12:00:00.000Z') }).status).toBe('not_applicable');
    expect(selectIndonesiaTradeRemedies({ manifest: INDONESIA_ACTIVE_TRADE_REMEDY_MANIFEST, code: '63031200', origin_country: 'IN', at: new Date('2026-09-21T12:00:00.000Z') })).toMatchObject({
      status: 'applicable', remedies: [{ remedy: { instrument: 'PMK 36/2026' }, rate: { duty: { kind: 'specific', specific_amount: 9841, specific_currency: 'IDR', specific_unit: 'kg' } } }],
    });
  });

  it('keeps MFN, AIFTA and remedies separate and requires origin proof/product refinement', () => {
    const mfn = line('90312000', 5);
    const aifta = { ...line('90312000', 0, 2), duty: { ...parsePublishedDuty('0%', 'IDR'), kind: 'mixed' as const, expression: '4% if electrically operated; 0% otherwise' } };
    const result = buildIndonesiaMarketAccess({ bundle: bundle(mfn, aifta), release_id: 'local', release_reference_date: new Date('2026-09-21'), retrieved_at: new Date('2026-09-21'), hs6: '903120', at: new Date('2026-09-21'), origin_country: 'IN' });
    expect(result.general_duty).toMatchObject({ ad_valorem_rate_percent: 5 });
    expect(result.india_preference).toMatchObject({ applicability: 'potentially_applicable_requires_origin_proof', duty: { kind: 'mixed' } });
    expect(result.lines.map((item) => item.measure_kind)).toEqual(['third_country_duty', 'tariff_preference']);
    expect(result.requirements).toContainEqual(expect.objectContaining({ requirement_code: 'AIFTA_90312000_PRODUCT_VARIANT' }));
    expect(result.regulatory_coverage_complete).toBe(false);
  });

  it('is routed as an automated authority source and no longer listed as unconfigured', () => {
    expect(DESTINATION_ADAPTERS.ID).toBeDefined();
    expect(unconfiguredSourceForCountry('ID')).toBeNull();
  });
});
