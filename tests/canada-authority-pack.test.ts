import JSZip from 'jszip';
import { describe, expect, test, vi } from 'vitest';
import { acquireCanadaAuthorityBundle } from '@/lib/market-access/providers/canada-acquisition';
import {
  CANADA_TPHS_COLUMNS,
  readCanadaAuthorityBundle,
  type CanadaAuthorityBundle,
  type CanadaTariffRow,
} from '@/lib/market-access/providers/canada-bundle';
import { buildCanadaMarketAccess, parseCanadaDuty } from '@/lib/market-access/providers/canada-parser';
import { runTechnicalQualification } from '@/lib/market-access/vendor-qualification';

const AT = new Date('2026-09-02T00:00:00.000Z');

function row(over: Partial<CanadaTariffRow> & Pick<CanadaTariffRow, 'TARIFF'>): CanadaTariffRow {
  const { TARIFF, ...rest } = over;
  return {
    TARIFF,
    EFF_DATE: new Date('2026-09-01T00:00:00.000Z'),
    CHANGE: 1,
    SUB_CHAP: '', DESC1: 'Authority fixture', DESC2: null, DESC3: null, FOOTNOTE: null, UOM: '',
    MFN: null,
    ...rest,
  } as CanadaTariffRow;
}

function authorityBundle(rows: CanadaTariffRow[]): CanadaAuthorityBundle {
  return {
    checksum: 'a'.repeat(64),
    size_bytes: 1234,
    files: [{ name: 'official.accdb', sha256: 'b'.repeat(64), size_bytes: 1000, role: 'official_access_database' }],
    release_identifier: 'T2026-2',
    tariff_url: 'https://www.cbsa-asfc.gc.ca/trade-commerce/tariff-tarif/2026/01-99/01-99-2026-2-eng.zip',
    country_treatments_url: 'https://www.cbsa-asfc.gc.ca/trade-commerce/tariff-tarif/2026/html/countries-pays-eng.html',
    rows,
    india_treatment: { mfn: true, gpt: false, ldct: false, other_treatments: [], source_row_text: 'India yes no no' },
    reader_version: 'cbsa-access-bundle-reader-v1',
  };
}

function ingest(rows: CanadaTariffRow[], hs6: string) {
  return buildCanadaMarketAccess({
    bundle: authorityBundle(rows),
    release_id: 'release-ca-1',
    release_reference_date: new Date('2026-09-01T00:00:00.000Z'),
    retrieved_at: AT,
    hs6,
    at: AT,
  });
}

const TREATMENTS_HTML = `<!doctype html><html><h1>List of countries and applicable tariff treatments</h1>
<table><thead><tr><th>Country Name</th><th>MFN</th><th>GPT</th><th>LDCT</th><th>Other</th></tr></thead>
<tbody><tr><th scope="row">India</th><td>yes</td><td><span>no</span></td><td><span>no</span></td><td>&nbsp;</td></tr></tbody></table></html>`;

describe('CBSA acquisition and retained bundle reader', () => {
  test('acquires only official CBSA bytes and validates the Access schema plus India treatment table', async () => {
    const inner = new JSZip();
    inner.file('01-99-2026-2-eng.accdb', Buffer.from('fake-access-for-injected-reader'));
    const sourceZip = await inner.generateAsync({ type: 'nodebuffer' });
    const fetchImpl = vi.fn(async (input: string | URL | Request) => new Response(
      String(input).includes('tariff.zip') ? new Uint8Array(sourceZip) : TREATMENTS_HTML,
      { status: 200 },
    ));
    const request = {
      release_identifier: 'T2026-2',
      tariff_url: 'https://www.cbsa-asfc.gc.ca/tariff.zip',
      country_treatments_url: 'https://www.cbsa-asfc.gc.ca/treatments.html',
    };
    const bytes = await acquireCanadaAuthorityBundle(request, { fetch_impl: fetchImpl });
    const repeated = await acquireCanadaAuthorityBundle(request, { fetch_impl: fetchImpl });
    expect(repeated.equals(bytes)).toBe(true);
    const decoded = await readCanadaAuthorityBundle(bytes, {
      access_decoder: () => ({
        columns: [...CANADA_TPHS_COLUMNS],
        rows: [row({ TARIFF: '1006.30.00', DESC1: 'Semi-milled rice', MFN: 'Free' })],
      }),
    });
    expect(decoded.release_identifier).toBe('T2026-2');
    expect(decoded.india_treatment).toMatchObject({ mfn: true, gpt: false, ldct: false, other_treatments: [] });
    expect(decoded.files.map((file) => file.role)).toEqual([
      'official_tariff_release', 'official_access_database',
      'official_origin_treatment_enumeration', 'acquisition_manifest',
    ]);
  });

  test('retries an authority failure, but rejects a non-CBSA source before any request', async () => {
    const inner = new JSZip();
    inner.file('release.accdb', 'x');
    const sourceZip = await inner.generateAsync({ type: 'nodebuffer' });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response(TREATMENTS_HTML, { status: 200 }))
      .mockResolvedValueOnce(new Response(new Uint8Array(sourceZip), { status: 200 }));
    await expect(acquireCanadaAuthorityBundle({
      release_identifier: 'T2026-2',
      tariff_url: 'https://www.cbsa-asfc.gc.ca/release.zip',
      country_treatments_url: 'https://www.cbsa-asfc.gc.ca/treatments.html',
    }, { fetch_impl: fetchImpl, attempts: 2 })).resolves.toBeInstanceOf(Buffer);
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    await expect(acquireCanadaAuthorityBundle({
      release_identifier: 'T2026-2',
      tariff_url: 'https://example.com/not-authority.zip',
      country_treatments_url: 'https://www.cbsa-asfc.gc.ca/treatments.html',
    }, { fetch_impl: fetchImpl })).rejects.toThrow(/only accepts HTTPS sources/);
  });
});

describe('Canada tariff semantics from real T2026-2 source-row shapes', () => {
  test('Free is an observed zero, while a missing MFN is not zero', () => {
    expect(parseCanadaDuty('Free')).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0, expression: 'Free' });
    expect(parseCanadaDuty('')).toMatchObject({ kind: 'none', ad_valorem_rate_percent: null });
  });

  test('a real rice shape resolves statistical children, preserves release/effective identity, and does not fabricate an India preference', () => {
    const result = ingest([
      row({ TARIFF: '1006.30.00', DESC1: 'Semi-milled or wholly milled rice', MFN: 'Free', UST: 'Free', CEUT: 'Free', 'General Tariff': '35%' }),
      row({ TARIFF: '1006.30.00.11', DESC1: 'Long grain', UOM: 'TNE', EFF_DATE: new Date('1998-01-01T00:00:00Z') }),
      row({ TARIFF: '1006.30.00.19', DESC1: 'Other, including mixtures', UOM: 'TNE', EFF_DATE: new Date('1998-01-01T00:00:00Z') }),
    ], '100630');
    expect(result.resolution.resolution).toBe('all_children_equivalent');
    expect(result.resolution.candidates.map((candidate) => candidate.national_tariff_code)).toEqual(['1006300011', '1006300019']);
    expect(result.general_duty).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0, expression: 'Free' });
    expect(result.india_preference).toMatchObject({ applicability: 'not_applicable', duty: null });
    expect(result.india_preference.basis).toMatch(/MFN=yes, GPT=no, LDCT=no/);
    expect(result.source_release_id).toBe('release-ca-1');
    expect(result.national_code_system).toBe('CA_CUSTOMS_TARIFF');
    expect(result.regulatory_coverage_complete).toBe(false);
    expect(runTechnicalQualification(result, 'cbsa-rice-zero').passed).toBe(true);
  });

  test('specific, compound and mixed duties preserve their real CBSA expressions and never become fabricated percentages', () => {
    const specific = ingest([
      row({ TARIFF: '1905.10.29', DESC1: 'Other', MFN: '13.51 ¢/kg', LDCT: 'Free' }),
      row({ TARIFF: '1905.10.29.00', DESC1: 'Other', UOM: 'KGM' }),
    ], '190510');
    expect(specific.general_duty).toMatchObject({ kind: 'specific', specific_amount: 0.1351, specific_currency: 'CAD', specific_unit: 'kg', ad_valorem_rate_percent: null, expression: '13.51 ¢/kg' });

    const compound = ingest([
      row({ TARIFF: '1904.10.29', DESC1: 'Other', MFN: '11.64 ¢/kg plus 8.5 %', LDCT: 'Free' }),
      row({ TARIFF: '1904.10.29.10', DESC1: 'Containing cane and/or beet sugar', UOM: 'KGM' }),
      row({ TARIFF: '1904.10.29.90', DESC1: 'Other', UOM: 'KGM' }),
    ], '190410');
    expect(compound.general_duty).toMatchObject({ kind: 'compound', ad_valorem_rate_percent: null, specific_amount: null, expression: '11.64 ¢/kg plus 8.5 %' });

    const mixed = ingest([
      row({ TARIFF: '0709.52.90', DESC1: 'Other', MFN: '8.43 ¢/kg but not less than 8.5 %', CCCT: 'Free' }),
      row({ TARIFF: '0709.52.90.00', DESC1: 'Other', UOM: 'KGM' }),
    ], '070952');
    expect(mixed.general_duty).toMatchObject({ kind: 'mixed', ad_valorem_rate_percent: null, specific_amount: null, expression: '8.43 ¢/kg but not less than 8.5 %' });
  });

  test('a within-access rate is a quota-conditioned line, never an unconditional general duty', () => {
    const result = ingest([
      row({ TARIFF: '2106.90.51', DESC1: 'Within access commitment', MFN: '6.68 ¢/kg' }),
      row({ TARIFF: '2106.90.51.00', DESC1: 'Within access commitment', UOM: 'KGM' }),
    ], '210690');
    expect(result.resolution.resolution).toBe('exact');
    expect(result.general_duty).toBeNull();
    expect(result.lines.find((line) => line.measure_kind === 'tariff_quota')).toMatchObject({
      duty: { kind: 'specific', expression: '6.68 ¢/kg' },
      conditions: expect.objectContaining({ quota_condition: 'WITHIN_ACCESS_COMMITMENT', unconditional_rate: false }),
    });
  });

  test('non-rice products do not assume kg, food, sea freight or one ad-valorem line', () => {
    const rows = [
      row({ TARIFF: '7419.80.10', DESC1: 'Anodes for electroplating', MFN: 'Free' }),
      row({ TARIFF: '7419.80.10.00', DESC1: 'Anodes for electroplating', UOM: 'KGM' }),
      row({ TARIFF: '8479.89.10', DESC1: 'Industrial machinery', MFN: 'Free' }),
      row({ TARIFF: '8479.89.10.00', DESC1: 'Industrial machinery', UOM: 'NMB' }),
      row({ TARIFF: '8544.49.00', DESC1: 'Electrical cable', MFN: 'Free' }),
      row({ TARIFF: '8544.49.00.11', DESC1: 'For voltage exceeding 600 V', UOM: 'KGM' }),
      row({ TARIFF: '2915.90.00', DESC1: 'Industrial chemical', MFN: 'Free' }),
      row({ TARIFF: '2915.90.00.90', DESC1: 'Other', UOM: 'KGM' }),
    ];
    for (const hs6 of ['741980', '847989', '854449', '291590']) {
      const result = ingest(rows, hs6);
      expect(result.resolution.resolved_line).not.toBeNull();
      expect(result.source_reference).not.toMatch(/rice|sea/i);
    }
    expect(ingest(rows, '847989').lines[0]!.conditions).toMatchObject({ unit_of_measure: 'NMB' });
  });
});
