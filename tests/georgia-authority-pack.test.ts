import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { buildGeorgiaMarketAccess, parseGeorgiaDuty, readGeorgiaAuthorityText } from '@/lib/market-access/providers/geo-parser';

const table = (headers: string[], rows: string[][]) => `<table><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((row, i) => `<tr><td>${i + 1}</td>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</table>`;
function sourceShapedFixture() {
  const twelve = Array.from({ length: 150 }, (_, i) => [i === 0 ? '0105' : `${String(30 + Math.floor(i / 100)).padStart(2, '0')}${String(i % 100).padStart(2, '0')}`, `Twelve percent item ${i}`]);
  const five = Array.from({ length: 30 }, (_, i) => [i === 0 ? '0203' : `40${String(i).padStart(2, '0')}`, `Five percent item ${i}`]);
  const specific = Array.from({ length: 17 }, (_, i) => [i === 0 ? '2204 10' : `2208 ${String(20 + i).padStart(2, '0')}`, `Alcohol item ${i}`, i === 1 ? 'euro/l' : i > 8 ? '1.5 euro/l/HL' : '0.2 euro/l']);
  return Buffer.from(`<b>Article 197 &ndash; Import duty rates</b><p>1. A 12% rate of import duty</p>${table(['No', 'CN code', 'Description'], twelve)}<p>2. A 5% rate of import duty</p>${table(['No', 'Code', 'Name'], five)}<p>3. rates</p>${table(['No', 'Code', 'Name', 'Import duty rates'], specific)}<p>6. motor car</p><p>Law of Georgia No 4022 of 15 December 2023 - website, 28.12.2023</p><b>Article 198 &ndash; Procedure</b>`);
}
const AT = new Date('2026-09-01T00:00:00.000Z');
const bundle = () => readGeorgiaAuthorityText({ bytes: sourceShapedFixture(), release_identifier: 'consolidated-2026-09-01', source_url: 'https://matsne.gov.ge/en/document/view/1043717' });

describe('Georgia Tax Code Article 197', () => {
  test('parses only the bounded three-table Article 197 structure', () => {
    const parsed = bundle();
    expect(parsed.rules.filter((r) => r.paragraph === '1')).toHaveLength(150);
    expect(parsed.rules.filter((r) => r.paragraph === '2')).toHaveLength(30);
    expect(parsed.rules.filter((r) => r.paragraph === '3')).toHaveLength(17);
    expect(parsed.rules.find((r) => r.paragraph === '6')!.code).toBe('8703');
  });

  test('preserves EUR/litre, alcohol and vehicle formulas without AVE', () => {
    expect(parseGeorgiaDuty('0.2 euro/l')).toMatchObject({ kind: 'specific', specific_amount: 0.2, specific_currency: 'EUR', specific_unit: 'L', specific_unit_quantity: 1 });
    expect(parseGeorgiaDuty('1.5 euro/l/HL')).toMatchObject({ kind: 'specific', specific_amount: 1.5, specific_unit: '%VOL/HL', ad_valorem_rate_percent: null });
    expect(parseGeorgiaDuty('euro/l')).toMatchObject({ kind: 'unparsed', specific_amount: null });
    expect(parseGeorgiaDuty('GEL 0.05 per cm³ + 5% per year')).toMatchObject({ kind: 'compound', ad_valorem_rate_percent: null });
  });

  test('applies the longest legal scope and executes residual zero only when no exception matches', () => {
    const listed = buildGeorgiaMarketAccess({ bundle: bundle(), release_id: 'ge-release-1', release_reference_date: AT, retrieved_at: AT, hs6: '010511', at: AT });
    expect(listed.general_duty).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 12 });
    const residual = buildGeorgiaMarketAccess({ bundle: bundle(), release_id: 'ge-release-1', release_reference_date: AT, retrieved_at: AT, hs6: '999999', at: AT });
    expect(residual.general_duty).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0 });
    expect(residual.lines[0]!.conditions).toMatchObject({ residual: true });
    expect(residual.india_preference.applicability).toBe('unknown');
  });

  test('forces refinement when Article 197 enumerates national children below HS6', () => {
    const html = sourceShapedFixture().toString().replace('0105</td>', '0401 10 100 00</td>');
    const parsed = readGeorgiaAuthorityText({ bytes: Buffer.from(html), release_identifier: 'x', source_url: 'https://matsne.gov.ge/en/document/view/1043717' });
    const result = buildGeorgiaMarketAccess({ bundle: parsed, release_id: 'ge-release-1', release_reference_date: AT, retrieved_at: AT, hs6: '040110', at: AT });
    expect(result.resolution.resolution).toBe('classification_refinement_required');
    expect(result.general_duty).toBeNull();
  });

  test.runIf(Boolean(process.env.CLEARTRADE_GEORGIA_RELEASE))('real release canary: parses the official consolidated HTML', () => {
    const bytes = readFileSync(process.env.CLEARTRADE_GEORGIA_RELEASE!);
    const parsed = readGeorgiaAuthorityText({ bytes, release_identifier: 'real-local-canary', source_url: 'https://matsne.gov.ge/en/document/view/1043717' });
    expect(parsed.rules.length).toBeGreaterThan(190);
    expect(parsed.rules.some((r) => r.duty_expression === '12%')).toBe(true);
  });
});
