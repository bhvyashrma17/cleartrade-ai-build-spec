import { describe, expect, test } from 'vitest';
import { CONFIG_DEFAULTS } from '../src/lib/config';
import { toIso2, WORLD_PARTNER } from '../src/lib/comtrade/areas';
import { calculateCountryTradeMetrics, type CountryMetricInput, type MetricFact } from '../src/lib/country-trade-metrics/calculator';

type Supplier = { code: string; value: number };

// Exact non-World supplier code/value sets persisted by the Phase 1E staging run.
const GERMANY = parse(`4:22427.900 32:109326.557 36:225966.699 40:195108.891 44:1047.506 50:81523.468 56:62888754.080 76:12725.044 100:177600.290 104:2188364.654 116:20699533.040 124:478.003 144:540504.968 156:1415227.182 191:2029.373 196:110.260 203:1385848.346 208:2498637.754 251:10017472.140 288:1894.023 300:2051183.881 348:452593.247 360:1542.595 364:1055382.080 368:27552.781 372:5.738 376:5838.919 380:151852101.277 392:2951321.460 398:137.554 400:22792.433 410:398074.407 418:89420.200 422:203248.652 428:2.249 440:157.715 442:216984.396 450:42.236 490:127513.045 504:434.380 524:286.798 528:72560609.340 566:724.825 579:58.301 586:27511349.599 591:10354.763 604:3602.731 608:416.500 616:4039558.571 620:1303825.867 642:381567.390 682:92859.104 688:2499.000 699:75675605.293 702:1586.887 704:13934611.670 705:23512.626 724:16617789.032 752:17341.622 757:15744.061 760:13830.625 764:22160092.893 784:61720.133 792:1487990.227 804:15789.460 807:13045.965 818:149369.370 826:617275.079 842:11276385.220 858:687505.379 899:719362.337`);
const USA = parse(`8:2744 32:35798754 36:1079393 50:3119339 51:24402 56:36391 70:6248 76:12311702 116:3800293 124:21198639 144:413137 156:29143357 170:29071 218:601701 222:129453 300:192137 320:535594 332:1017809 340:49479 344:145835 368:6269 376:205050 380:19859415 392:20296043 398:146355 400:24483 404:2304 410:4646487 417:16766 418:110793 422:135281 484:1865355 490:1589038 524:341047 566:12654 586:33067352 600:80367 604:414799 608:8735 616:29105 620:35096 643:41678 688:27563 699:389744512 704:24515683 724:5619557 764:944145089 784:489049 792:2885859 800:38341 804:10449 807:3948 818:193281 826:25986 834:10550 858:1069930 860:1058771`);

const AGGREGATE_CODES = new Set(['490', '899']);

function parse(value: string): Supplier[] {
  return value.split(/\s+/).map(item => {
    const [code, amount] = item.split(':');
    return { code, value: Number(amount) };
  });
}

function fact(overrides: Partial<MetricFact>): MetricFact {
  return {
    purpose: 'LATEST_SUPPLIER_DISTRIBUTION', reporter_code: '276', partner_code: '0',
    partner_iso2: null, partner_is_world: false, partner2_code: '0', period: 2025,
    hs_code: '100630', hs_revision: '2022', flow_direction: 'import', frequency: 'A',
    trade_value: 0, trade_value_status: 'observed', quantity: null, quantity_status: 'missing',
    quantity_unit: null, net_weight: null, source_evidence_id: 'supplier-evidence',
    observation_id: 'supplier-observation', retrieved_at: '2026-08-26T15:29:00.000Z',
    freshness_state: 'fresh', evidence_completeness: 'COMPLETE', cell_state: 'reusable',
    ...overrides,
  };
}

function run(reporterCode: string, world: number, suppliers: Supplier[]) {
  const facts: MetricFact[] = [fact({
    purpose: 'WORLD_IMPORT_HISTORY', reporter_code: reporterCode, partner_code: WORLD_PARTNER,
    partner_is_world: true, trade_value: world, source_evidence_id: 'world-evidence',
    observation_id: 'world-observation',
  })];
  suppliers.forEach(({ code, value }, index) => facts.push(fact({
    reporter_code: reporterCode, partner_code: code, partner_iso2: toIso2(code), trade_value: value,
    observation_id: `supplier-${index}`,
  })));
  // The provider's World row in the all-suppliers response must remain excluded.
  facts.push(fact({ reporter_code: reporterCode, partner_code: WORLD_PARTNER, partner_is_world: true,
    trade_value: world, observation_id: 'supplier-world-aggregate' }));
  const input: CountryMetricInput = { reporter_code: reporterCode, hs_code: '100630',
    hs_revision: '2022', period_set: [2021, 2022, 2023, 2024, 2025], latest_common_year: 2025,
    facts, policy: CONFIG_DEFAULTS['country_trade_metrics.policy'] };
  return calculateCountryTradeMetrics(input).supplier_hhi;
}

function independent(suppliers: Supplier[], world: number) {
  const accepted = suppliers.filter(row => toIso2(row.code) != null);
  const sum = accepted.reduce((total, row) => total + row.value, 0);
  return { accepted, sum, percentage: sum / world * 100,
    hhi: accepted.reduce((total, row) => total + (row.value / sum) ** 2, 0) };
}

describe('Phase 1E Comtrade supplier normalization', () => {
  test('maps every ISO country/area in the persisted sets and rejects aggregate identities', () => {
    for (const row of [...GERMANY, ...USA]) {
      if (!AGGREGATE_CODES.has(row.code)) expect(toIso2(row.code), row.code).not.toBeNull();
    }
    expect(toIso2('380')).toBe('IT');
    expect(toIso2('381')).toBe('IT');
    expect(toIso2(WORLD_PARTNER)).toBeNull();
    expect(toIso2('001')).toBeNull();
    expect(toIso2('490')).toBeNull();
    expect(toIso2('899')).toBeNull();
    expect(toIso2('not-a-code')).toBeNull();
  });

  test.each([
    ['Germany', '276', 511_317_180.090, GERMANY, 99.8343737675994, 0.1551588750986703],
    ['USA', '842', 1_562_408_518, USA, 99.89829561336275, 0.43044777923136446],
  ] as const)('%s reconciles and calculator HHI matches an independent calculation', (_country, reporter, world, suppliers, expectedCoverage, expectedHhi) => {
    const expected = independent(suppliers, world);
    expect(expected.percentage).toBeCloseTo(expectedCoverage, 10);
    expect(expected.percentage).toBeGreaterThanOrEqual(95);
    expect(expected.percentage).toBeLessThanOrEqual(105);
    expect(expected.hhi).toBeCloseTo(expectedHhi, 12);

    const persistedOutput = run(reporter, world, suppliers);
    expect(persistedOutput.status).toBe('complete');
    expect(persistedOutput.details?.coverage_ratio).toBeCloseTo(expected.percentage / 100, 12);
    // The calculator intentionally persists metric values rounded to 12 decimal places.
    expect(persistedOutput.value).toBeCloseTo(expected.hhi, 11);
    expect((persistedOutput.details?.excluded as Array<{ reason: string }>)).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: 'world_aggregate', partner_code: '0', observation_id: 'supplier-world-aggregate' })]),
    );
  });
});
