import { afterEach, describe, expect, test, vi } from 'vitest';
import { parseDutyExpression } from '@/lib/market-access/tariff-semantics';
import { fetchUsMarketAccess } from '@/lib/market-access/us-hts';

/**
 * E-071: production's first turmeric run (11 Nov 2026) showed the US duty as a World Bank estimate.
 * The USITC publishes turmeric's General rate as "Free", which the shared parser could not read, so
 * every duty-free US line fell back to an estimate. "Free" is 0%.
 */
afterEach(() => vi.unstubAllGlobals());

describe('"Free" is a zero duty', () => {
  test('the shared parser reads "Free" and "Free (programmes)" as 0%, and nothing else that starts with free', () => {
    for (const expression of ['Free', 'free', 'FREE', 'Free (A+,AU,BH,CL,CO,D,E,IL,JO,KR,MA,OM,P,PA,PE,S,SG)']) {
      expect(parseDutyExpression(expression)).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0, expression });
    }
    expect(parseDutyExpression('Free of charge until 2027').kind).toBe('unparsed');
    expect(parseDutyExpression('Freedom 5%').kind).not.toBe('ad_valorem');
  });

  test('a US line published as "Free" gives an official 0% ordinary duty', async () => {
    const rows = [
      { htsno: '0910.30.00', indent: '1', description: 'Turmeric (curcuma)', general: 'Free', special: '', other: '4.4¢/kg', units: [], footnotes: [] },
      { htsno: '0910.30.00.00', indent: '2', description: '', general: '', special: '', other: '', units: ['kg'], footnotes: [] },
    ];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } })));
    const result = await fetchUsMarketAccess('091030', { now: new Date('2026-11-11T01:16:00Z') });
    expect(result.resolution.resolved_line?.national_tariff_code).toBe('09103000');
    expect(result.general_duty).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0, expression: 'Free' });
  });
});
