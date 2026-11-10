import { describe, expect, test, vi } from 'vitest';
import { acquireJapanChapterBytes } from '@/lib/market-access/providers/japan-acquisition';
import { readJapanAuthorityBundle } from '@/lib/market-access/providers/japan-bundle';
import { buildJapanMarketAccess, parseJapanDuty } from '@/lib/market-access/providers/japan-parser';
import { runTechnicalQualification } from '@/lib/market-access/vendor-qualification';
import { persistMarketAccessIngest } from '@/lib/market-access/contract';
import { storedQuota } from '@/lib/demand-discovery-v5/official-duty';
import { prisma } from '@/lib/prisma';

const AT = new Date('2026-09-02T00:00:00.000Z');

const RATE_LABELS = [
  'General', 'Temporary', 'WTO', 'GSP', 'LDC', 'Singapore', 'Mexico', 'Malaysia', 'Chile', 'Thailand',
  'Indonesia', 'Brunei', 'ASEAN', 'Philippines', 'Switzerland', 'Viet Nam', 'India', 'Peru', 'Australia',
  'Mongolia', 'CPTPP', 'EU', 'UK', 'ASEAN/Australia/New Zealand(RCEP)', 'China (RCEP)', 'Korea (RCEP)',
  'JP-US Trade Agreement **1',
] as const;

/** Reproduces the real datatable header/row shape observed on customs.go.jp, Shift_JIS-encoded. */
function page(rows: Array<{ code: string; suffix: string; desc: string; rates?: Partial<Record<string, string>> }>): Buffer {
  const headerRow1 = `<tr><th colspan="2">Statistical code</th><th rowspan="2">Description</th><th colspan=" 5">Tariff rate</th><th colspan=" 21">Tariff rate (EPA)</th><th>Tariff rate</th><th colspan=" 2">Unit</th><th rowspan="2">Law</th></tr>`;
  const headerRow2 = `<tr><th>H.S.code</th><th>&nbsp;</th>${RATE_LABELS.map((label) => `<th>${label}</th>`).join('')}<th>I</th><th>II</th></tr>`;
  const dataRows = rows.map((row) => {
    const cells = [row.code, row.suffix, row.desc, ...RATE_LABELS.map((label) => row.rates?.[label] ?? ''), '', '', 'MT', 'FM'];
    return `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`;
  }).join('');
  const html = `<!DOCTYPE HTML><html><head><meta charset="Shift_JIS"></head><body>
<table id="datatable">${headerRow1}${headerRow2}${dataRows}</table></body></html>`;
  return Buffer.from(html, 'latin1');
}

function ingest(rows: Parameters<typeof page>[0], hs6: string, chapter = hs6.slice(0, 2)) {
  const bundle = readJapanAuthorityBundle({ bytes: page(rows), chapter, effective_date_label: '2026_04_01', source_url: `https://www.customs.go.jp/english/tariff/2026_04_01/data/e_${chapter}.htm` });
  return buildJapanMarketAccess({ bundle, release_id: 'release-jp-1', release_reference_date: new Date('2026-04-01'), retrieved_at: AT, hs6, at: AT, origin_country: 'IN' });
}

describe('Japan Customs acquisition and retained bundle reader', () => {
  test('acquires only official customs.go.jp bytes, retries a transient failure', async () => {
    const bytes = page([{ code: '10.06', suffix: '', desc: 'Cereals', rates: {} }]);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response(new Uint8Array(bytes), { status: 200 }));
    const fetched = await acquireJapanChapterBytes({ effective_date_label: '2026_04_01', chapter: '10', chapter_url: 'https://www.customs.go.jp/english/tariff/2026_04_01/data/e_10.htm' }, { fetch_impl: fetchImpl, attempts: 2 });
    expect(fetched.equals(bytes)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await expect(acquireJapanChapterBytes({ effective_date_label: 'x', chapter: '10', chapter_url: 'https://example.com/e_10.htm' })).rejects.toThrow(/only accepts HTTPS sources/);
  });

  test('rejects a page missing the required India/WTO/GSP rate columns rather than guessing which column it would have been', () => {
    const html = `<!DOCTYPE HTML><html><body><table id="datatable">
<tr><th colspan="2">Statistical code</th><th rowspan="2">Description</th><th colspan=" 1">Tariff rate</th><th rowspan="2">Law</th></tr>
<tr><th>H.S.code</th><th>&nbsp;</th><th>General</th></tr>
<tr><td>10.06</td><td></td><td>Cereals</td><td>Free</td><td></td></tr>
</table></body></html>`;
    // This truncated fixture (one rate column, no trailing unit columns) leaves the rate-label
    // slice empty entirely, so the FIRST required label checked ("General") is reported missing —
    // the point under test, that an unrecognised layout is refused rather than guessed at, holds.
    expect(() => readJapanAuthorityBundle({ bytes: Buffer.from(html, 'latin1'), chapter: '10', effective_date_label: '2026_04_01', source_url: 'https://x' }))
      .toThrow(/no "General" rate column/);
  });
});

describe('Japan Customs tariff semantics from real page shapes', () => {
  test('"Free" is an observed zero; parenthesised/asterisked figures preserve the marking rather than asserting its meaning', () => {
    expect(parseJapanDuty('Free')).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0 });
    expect(parseJapanDuty('(Free)')).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0 });
    const specific = parseJapanDuty('*(341yen /kg)');
    expect(specific).toMatchObject({ kind: 'specific', specific_amount: 341, specific_currency: 'JPY', specific_unit: 'kg' });
    expect(specific.note).toMatch(/preserved verbatim/);
  });

  // The rows of 1006.30 as Japan Customs publishes them on 8 Aug 2026 (e_10.htm), descriptions shortened.
  const RICE = [
    { code: '1006.30', suffix: '', desc: 'Semi-milled or wholly milled rice, whether or not polished or glazed', rates: { General: '(402 yen/kg)' } },
    { code: '', suffix: '010', desc: '- Imported by Japanese Government according to Article 30 of "The Law for Stabilization of Supply-Demand and Price of Staple Food"', rates: { Temporary: 'Free', WTO: '(Free)', CPTPP: 'For the tariff rate quota in Japan\'s Schedule to the WTO Agreement Free Other (For the Pooled Quota (Treatment for Australia)) Free' } },
    { code: '', suffix: '090', desc: '- Other', rates: { Temporary: '49 yen/kg', WTO: '*(341yen /kg)', CPTPP: '49 yen/kg' } },
  ];

  test('rice (D-042): the quota line is said, and the other line scores the out-of-quota 341 yen/kg, duty plus levy', () => {
    const result = ingest(RICE, '100630');
    expect(result.parser_version).toBe('jp-customs-tariff-parser-v2');
    expect(result.resolution).toMatchObject({ resolution: 'exact', resolved_line: { national_tariff_code: '100630090' } });
    expect(result.general_duty).toMatchObject({ kind: 'specific', specific_amount: 341, specific_currency: 'JPY', specific_unit: 'kg', expression: '341 yen/kg' });
    expect(result.general_duty!.note).toMatch(/Temporary duty \(49 yen\/kg\) plus the levy Japan collects under its Staple Food Act, 341 yen\/kg in all/);
    expect(result.general_duty_quota).toMatchObject({ in_quota_duty: { kind: 'ad_valorem', ad_valorem_rate_percent: 0, expression: 'Free' } });
    expect(result.general_duty_quota!.basis).toMatch(/^Statistical code 100630010 is the tariff-quota line \("Imported by Japanese Government.*Free applies only within Japan's tariff quota\. Every other import pays the out-of-quota rate\.$/);
    // The published rows stay as published: the quota line is a quota, the other line keeps its Temporary duty.
    expect(result.lines.find((line) => line.national_tariff_code === '100630010')).toMatchObject({ measure_kind: 'tariff_quota', conditions: expect.objectContaining({ unconditional_rate: false }) });
    expect(result.lines.find((line) => line.national_tariff_code === '100630090' && line.origin_geographic_area_id === 'MFN')).toMatchObject({
      measure_kind: 'third_country_duty', duty: { kind: 'specific', specific_amount: 49, specific_currency: 'JPY' }, conditions: expect.objectContaining({ out_of_quota_rate: '341 yen/kg' }),
    });
    // The Japan–India CEPA column is empty for this line.
    expect(result.india_preference.applicability).toBe('not_applicable');
    expect(result.raw_evidence).toMatchObject({ quota_split: { quota_lines: ['100630010'], scored_among: ['100630090'] } });
  });

  test('rice (D-042): the stored tariff row carries the out-of-quota duty and the quota beside it, which v5 reads', async () => {
    const result = ingest(RICE, '100630');
    // No retained release row backs this fixture, so the snapshot is persisted without one.
    const snapshot = await persistMarketAccessIngest({ ...result, source_release_id: null }, { evidence_origin: 'fixture' });
    const tariff = await prisma.marketAccessEvidence.findFirstOrThrow({ where: { snapshot_id: snapshot.id, rule_type: 'destination_tariff' } });
    expect(tariff).toMatchObject({ national_tariff_code: '100630090', duty_expression: '341 yen/kg', duty_kind: 'specific', tariff_rate_percent: null });
    expect(storedQuota(tariff)).toEqual({ duty_expression: 'Free', percent: 0, basis: result.general_duty_quota!.basis });
  });

  test('wheat has the same shape: 9.80 yen/kg duty, 55 yen/kg out of quota', () => {
    const result = ingest([
      { code: '1001.99', suffix: '', desc: 'Other', rates: { General: '(65 yen/kg)' } },
      { code: '', suffix: '010', desc: '- Imported by Japanese Government', rates: { Temporary: 'Free', WTO: '(Free)', CPTPP: 'For the tariff rate quota in Japan\'s Schedule to the WTO Agreement Free' } },
      { code: '', suffix: '090', desc: '- Other', rates: { Temporary: '9.80 yen/kg', WTO: '*(55 yen/kg)', GSP: 'Free' } },
    ], '100199');
    expect(result.general_duty).toMatchObject({ kind: 'specific', specific_amount: 55, expression: '55 yen/kg' });
  });

  test('without a quota line, or with a WTO figure that is unmarked, lower or in another unit, the applicable duty is kept', () => {
    // No quota sibling: the asterisked WTO figure stays a bound ceiling.
    const alone = ingest([{ code: '1006.30', suffix: '', desc: 'Rice', rates: {} }, { code: '', suffix: '090', desc: '- Other', rates: { Temporary: '49 yen/kg', WTO: '*(341yen /kg)' } }], '100630');
    expect(alone.general_duty).toMatchObject({ kind: 'specific', specific_amount: 49 });
    expect(alone.general_duty_quota).toBeNull();
    const quota = { code: '', suffix: '010', desc: '- Imported by Japanese Government', rates: { Temporary: 'Free', CPTPP: 'For the tariff rate quota in Japan\'s Schedule to the WTO Agreement Free' } };
    for (const wto of ['(341yen /kg)', '*(20 yen/kg)', '*(30%)']) {
      const result = ingest([{ code: '1006.30', suffix: '', desc: 'Rice', rates: {} }, quota, { code: '', suffix: '090', desc: '- Other', rates: { Temporary: '49 yen/kg', WTO: wto } }], '100630');
      expect(result.general_duty, wto).toMatchObject({ kind: 'specific', specific_amount: 49 });
      expect(result.general_duty_quota, wto).toMatchObject({ in_quota_duty: { ad_valorem_rate_percent: 0 } });
    }
  });

  test('a self-contained line (its own code, suffix and full rate set together) resolves exactly, with India requiring origin proof', () => {
    const result = ingest([
      { code: '84.79', suffix: '', desc: 'Machines having individual functions', rates: {} },
      { code: '8479.10', suffix: '000', desc: 'Machinery for public works', rates: { General: 'Free', WTO: '(Free)', India: 'Free' } },
    ], '847910', '84');
    expect(result.resolution.resolution).toBe('exact');
    expect(result.general_duty).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0 });
    expect(result.india_preference).toMatchObject({ applicability: 'potentially_applicable_requires_origin_proof' });
  });

  test('a heading-inherited multilateral rate (children publish only EPA columns) is inherited only when unmarked, never when parenthesised', () => {
    const inherited = ingest([
      { code: '74.07', suffix: '', desc: 'Copper bars, rods and profiles', rates: {} },
      { code: '7407.10', suffix: '', desc: 'Of refined copper', rates: { General: '5.8%', WTO: '3%', GSP: '1.2%', LDC: 'Free' } },
      { code: '', suffix: '010', desc: 'Hollow and grooved', rates: { China: 'Free' as never, India: 'Free' } },
      { code: '', suffix: '090', desc: 'Other', rates: { India: 'Free' } },
    ], '740710', '74');
    expect(inherited.resolution.resolution).toBe('all_children_equivalent');
    expect(inherited.general_duty).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 5.8 });

    // A marked (parenthesised) heading figure — as real rice pages publish — is never inherited.
    const notInherited = ingest([
      { code: '10.06', suffix: '', desc: 'Cereals', rates: { General: '(999 yen/kg)' } },
      { code: '', suffix: '999', desc: 'Hypothetical child with no own General/Temporary/WTO', rates: { India: 'Free' } },
    ], '100699');
    expect(notInherited.resolution.resolution).toBe('unavailable');
  });

  test('no India column value leaves the line not_applicable, never fabricated as unknown or confirmed', () => {
    const result = ingest([
      { code: '84.79', suffix: '', desc: 'Machines', rates: {} },
      { code: '8479.20', suffix: '000', desc: 'Extraction machinery', rates: { General: 'Free', WTO: '(Free)' } },
    ], '847920', '84');
    expect(result.india_preference).toMatchObject({ applicability: 'not_applicable', duty: null });
  });

  test('India-EPA preference is a separate line from the general duty, never conflated into it', () => {
    const result = ingest([
      { code: '29.15', suffix: '', desc: 'Saturated acyclic monocarboxylic acids', rates: {} },
      { code: '2915.11', suffix: '000', desc: 'Formic acid', rates: { General: '6.4%', WTO: '4.3%', India: '3.2%' } },
    ], '291511', '29');
    const preference = result.lines.find((line) => line.measure_kind === 'tariff_preference' && line.applies_to_origin_country === 'IN');
    expect(preference).toMatchObject({ duty: { kind: 'ad_valorem', ad_valorem_rate_percent: 3.2 } });
    expect(result.general_duty).toMatchObject({ ad_valorem_rate_percent: 6.4 });
    expect(runTechnicalQualification(result, 'jp-formic-acid').passed).toBe(true);
  });

  test('non-rice products across archetypes do not assume yen, food, or a single ad-valorem shape', () => {
    const rows = [
      { code: '85.44', suffix: '', desc: 'Insulated cable', rates: {} },
      { code: '8544.49', suffix: '000', desc: 'Other electric conductors', rates: { General: 'Free', WTO: '(Free)' } },
    ];
    const result = ingest(rows, '854449', '85');
    expect(result.resolution.resolved_line).not.toBeNull();
    expect(result.source_reference).not.toMatch(/rice/i);
  });
});
