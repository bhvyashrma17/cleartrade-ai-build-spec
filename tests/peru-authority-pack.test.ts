import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { acquirePeruAuthorityBundle, PERU_FRANJA_URL, PERU_TARIFF_URL } from '@/lib/market-access/providers/peru-acquisition';
import { buildPeruMarketAccess, PeruBundleError, readPeruAuthorityZip, type PeruAuthorityBundle } from '@/lib/market-access/providers/peru-parser';

const AT = new Date('2026-09-10T00:00:00.000Z');

function bundle(rows: PeruAuthorityBundle['rows']): PeruAuthorityBundle {
  return {
    checksum: 'fixture-checksum', size_bytes: 1, release_identifier: '2026-09-10-current-state',
    source_url: 'https://www.sunat.gob.pe/orientacionaduanera/aranceles/Cap01-98-Descripcion.zip',
    rows, files: [{ name: 'Cap01-98-Descripcion.xlsx', size_bytes: 1 }],
    reader_version: 'sunat-arancel-2022-consolidated-xlsx-reader-v1',
  };
}

describe('Peru SUNAT consolidated tariff', () => {
  test('keeps the monthly agricultural price-band duty separate and specific', () => {
    const result = buildPeruMarketAccess({
      bundle: bundle([{ code: '1006300000', description: 'Arroz semiblanqueado o blanqueado', ad_valorem_rate_percent: 0 }]),
      release_id: 'pe-release-1', release_reference_date: AT, retrieved_at: AT,
      hs6: '100630', at: AT, origin_country: 'IN',
    });
    expect(result.resolution.resolution).toBe('exact');
    expect(result.general_duty).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0, expression: '0%' });
    const franja = result.lines.find((line) => line.measure_kind === 'additional_duty');
    expect(franja?.duty).toMatchObject({ kind: 'specific', specific_amount: 142, specific_currency: 'USD', specific_unit: 'TNE', ad_valorem_rate_percent: null });
    expect(franja?.conditions).toMatchObject({ system: 'Sistema de Franja de Precios', product_group: 'rice_milled', no_ad_valorem_equivalent_inferred: true });
    expect(result.india_preference.applicability).toBe('not_applicable');
    expect(result.regulatory_coverage_complete).toBe(false);
  });

  test('preserves classification uncertainty when Peru national children differ', () => {
    const result = buildPeruMarketAccess({
      bundle: bundle([
        { code: '0208900010', description: 'Carne de cuy', ad_valorem_rate_percent: 6 },
        { code: '0208900090', description: 'Los demás', ad_valorem_rate_percent: 6 },
      ]),
      release_id: 'pe-release-1', release_reference_date: AT, retrieved_at: AT,
      hs6: '020890', at: AT,
    });
    expect(result.resolution.resolution).toBe('all_children_equivalent');
    expect(result.resolution.candidate_count).toBe(2);
    expect(result.general_duty?.ad_valorem_rate_percent).toBe(6);
  });

  test('rejects bytes that are not the official ZIP shape', async () => {
    await expect(readPeruAuthorityZip({ bytes: Buffer.from('not a zip'), release_identifier: 'x', source_url: 'https://example.test' }))
      .rejects.toEqual(expect.objectContaining<Partial<PeruBundleError>>({ code: 'corrupt_archive' }));
  });

  test('keeps an authority outage as an acquisition failure', async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      expect([PERU_TARIFF_URL, PERU_FRANJA_URL]).toContain(String(input));
      return new Response('unavailable', { status: 503 });
    }) as typeof fetch;
    await expect(acquirePeruAuthorityBundle({ fetch_impl: fetchImpl, attempts: 1 })).rejects.toThrow('retryable HTTP 503');
  });

  test.runIf(Boolean(process.env.CLEARTRADE_PERU_RELEASE))('real release canary: reconciles the official 8017-line workbook and both amendments', async () => {
    const parsed = await readPeruAuthorityZip({
      bytes: readFileSync(process.env.CLEARTRADE_PERU_RELEASE!), release_identifier: 'real-local-canary',
      source_url: 'https://www.sunat.gob.pe/orientacionaduanera/aranceles/Cap01-98-Descripcion.zip',
    });
    expect(parsed.rows).toHaveLength(8_017);
    expect(parsed.rows.some((row) => row.code === '9811000000')).toBe(true);
    expect(parsed.rows.some((row) => row.code === '0208900010')).toBe(true);
    expect(parsed.rows.some((row) => row.code === '0208900090')).toBe(true);
  });
});
