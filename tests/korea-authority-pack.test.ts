import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { KoreaBundleError, readKoreaAuthorityBundle } from '@/lib/market-access/providers/korea-bundle';
import { buildKoreaMarketAccess, parseKoreaDuty } from '@/lib/market-access/providers/korea-parser';
import { runTechnicalQualification } from '@/lib/market-access/vendor-qualification';
import { unconfiguredSourceForCountry } from '@/lib/market-access/unconfigured-sources';

const AT = new Date('2026-06-01T00:00:00.000Z');
const FIXTURES = join(__dirname, 'fixtures');

/**
 * `korea-sample.xlsx` is a small synthetic workbook (built by a one-off script, not committed
 * runtime code) in the exact shape KCS publishes — sheets `1.1` and `2.12`, same nine columns —
 * carrying one item number per real-release archetype actually observed in the 2026-02-11 KCS
 * release: a general (`A`) + WTO-bound (`C`) pair, a compound `단위당세액` row, a `T2`/reference-
 * price row shaped like the real rice line, plausible India-candidate codes, refinement-required
 * siblings, equivalent-children siblings, and an expired rate. It is not authority evidence and is
 * never presented as such; it exists solely to exercise the reader/parser against realistic shapes
 * without committing the real ~22MB government file.
 */
function loadFixture(name: string): Buffer {
  return readFileSync(join(FIXTURES, name));
}

async function sampleBundle() {
  return readKoreaAuthorityBundle({ bytes: loadFixture('korea-sample.xlsx'), release_identifier: '2026-02-11' });
}

async function ingest(hs6: string, at: Date = AT) {
  const bundle = await sampleBundle();
  return buildKoreaMarketAccess({
    bundle, release_id: 'release-kr-1', release_reference_date: AT, retrieved_at: AT, hs6, at, origin_country: 'IN',
  });
}

describe('KCS workbook reader', () => {
  test('reads the canonical 2.12 sheet, item-by-item, with the full row set per item', async () => {
    const bundle = await sampleBundle();
    expect(bundle.canonical_sheet).toBe('2.12');
    expect(bundle.canonical_sheet_row_count).toBeGreaterThan(0);
    expect(bundle.cross_check_sheet).toBe('1.1');
    // The fixture's 1.1 and 2.12 sheets are identical, so the cross-check must not flag a
    // violation on a release that genuinely satisfies the superset relationship.
    expect(bundle.cross_check_sheet_row_count).toBeLessThanOrEqual(bundle.canonical_sheet_row_count);

    const rows = bundle.item_rates.get('0101211000');
    expect(rows).toBeDefined();
    expect(rows!.map((r) => r.rate_type_code).sort()).toEqual(['A', 'C']);
  });

  test('rejects an unexpected header rather than silently misreading columns', async () => {
    await expect(readKoreaAuthorityBundle({ bytes: loadFixture('korea-bad-header.xlsx'), release_identifier: 'x' }))
      .rejects.toThrow(/not the documented/);
  });

  test('refuses to proceed when sheet 1.1 has MORE rows than 2.12 — the superset assumption this reader relies on', async () => {
    await expect(readKoreaAuthorityBundle({ bytes: loadFixture('korea-superset-violation.xlsx'), release_identifier: 'x' }))
      .rejects.toThrow(/no longer holds/);
  });

  test('an empty canonical sheet is refused rather than silently producing zero items', async () => {
    await expect(readKoreaAuthorityBundle({ bytes: loadFixture('korea-empty.xlsx'), release_identifier: 'x' }))
      .rejects.toThrow(KoreaBundleError);
  });
});

describe('Korean duty semantics (parseKoreaDuty, pure)', () => {
  test('관세율 alone is ad valorem', () => {
    const duty = parseKoreaDuty({ rate_type_code: 'A', rate_value: 8, unit_amount: null, reference_price: null, country_scope: '1', purpose_code: null, effective_from: '20260101', effective_to: '20261231' });
    expect(duty).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 8 });
  });

  test('rice-shaped rate: a populated 기준가격 is retained as evidence, never computed into the duty', () => {
    // Matches the real 2026-02-11 release: item 1006100000, code T2, rate 513, reference price 145.
    const duty = parseKoreaDuty({ rate_type_code: 'T2', rate_value: 513, unit_amount: null, reference_price: 145, country_scope: '1', purpose_code: null, effective_from: '20260101', effective_to: '20261231' });
    expect(duty.kind).toBe('ad_valorem');
    expect(duty.ad_valorem_rate_percent).toBe(513);
    expect(duty.note).toMatch(/reference price/i);
  });

  test('a populated 단위당세액 alongside 관세율 is compound, retaining both components verbatim', () => {
    // Matches the real release: item 0706101000, code A, rate 30, unit_amount 134.
    const duty = parseKoreaDuty({ rate_type_code: 'A', rate_value: 30, unit_amount: 134, reference_price: null, country_scope: '1', purpose_code: null, effective_from: '20260101', effective_to: '20261231' });
    expect(duty.kind).toBe('compound');
    expect(duty.ad_valorem_rate_percent).toBeNull();
    expect(duty.expression).toContain('30%');
    expect(duty.expression).toContain('134');
    expect(duty.note).toMatch(/does not document the currency/);
  });

  test('no rate at all is none, not zero', () => {
    const duty = parseKoreaDuty({ rate_type_code: 'A', rate_value: null, unit_amount: null, reference_price: null, country_scope: '1', purpose_code: null, effective_from: '20260101', effective_to: '20261231' });
    expect(duty.kind).toBe('none');
  });

  test('an observed zero rate is real evidence of duty-free treatment, not absence', () => {
    const duty = parseKoreaDuty({ rate_type_code: 'A', rate_value: 0, unit_amount: null, reference_price: null, country_scope: '1', purpose_code: null, effective_from: '20260101', effective_to: '20261231' });
    expect(duty.kind).toBe('ad_valorem');
    expect(duty.ad_valorem_rate_percent).toBe(0);
  });
});

describe('Korean national line resolution', () => {
  test('a single resolvable item uses code A as the general duty', async () => {
    const result = await ingest('010121');
    expect(result.resolution.resolution).toBe('exact');
    expect(result.general_duty).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 8 });
    expect(result.national_code_system).toBe('KR_TARIFF_ITEM');
  });

  test('code C (WTO bound) is preserved as its own line, distinct from and not folded into general duty', async () => {
    const result = await ingest('010121');
    const other = result.lines.find((l) => l.origin_geographic_area_id === 'C');
    expect(other).toBeDefined();
    expect(other!.measure_kind).toBe('other');
    expect(other!.duty.ad_valorem_rate_percent).toBe(5);
    expect(other!.applies_to_origin_country).toBeNull();
    // Never mixed into the resolved general duty, which stays A's rate.
    expect(result.general_duty?.ad_valorem_rate_percent).toBe(8);
  });

  test('non-equivalent children under one HS6 force refinement rather than an arbitrary pick', async () => {
    const result = await ingest('100630');
    expect(result.resolution.resolution).toBe('classification_refinement_required');
    expect(result.general_duty).toBeNull();
    expect(result.india_preference.applicability).toBe('unknown');
  });

  test('equivalent children resolve without refinement and qualify', async () => {
    const result = await ingest('854449');
    expect(result.resolution.resolution).toBe('all_children_equivalent');
    expect(result.general_duty).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0 });
    expect(runTechnicalQualification(result, 'kr-854449').passed).toBe(true);
  });

  test('an item whose only A row has expired resolves to none, not silently dropped', async () => {
    const result = await ingest('610910');
    expect(result.resolution.resolution).toBe('exact');
    expect(result.general_duty?.kind).toBe('none');
    expect(result.general_duty?.note).toMatch(/no currently-effective A/);
  });

  test('tariff coverage never implies regulatory completeness', async () => {
    const result = await ingest('010121');
    expect(result.regulatory_coverage_complete).toBe(false);
    expect(result.requirements).toHaveLength(0);
  });
});

describe('Korean provider-level codes: retained verbatim, never assigned a country identity', () => {
  test('a plausible-India code (FIN1) present is surfaced as unknown, never as a confirmed India rate', async () => {
    const result = await ingest('080510');
    expect(result.india_preference.applicability).toBe('unknown');
    expect(result.india_preference.basis).toMatch(/programme symbols/i);
    expect(result.india_preference.basis).toContain('FIN1');
    expect(result.india_preference.basis).toContain('FCEPA1');
    expect(result.india_preference.basis).toContain('FID1');
    // The raw evidence still carries the row so an operator can see exactly what was found.
    const preferenceLine = result.lines.find((l) => l.origin_geographic_area_id === 'FIN1');
    expect(preferenceLine).toBeDefined();
    expect(preferenceLine!.applies_to_origin_country).toBeNull();
  });

  test('no India-shaped code present at all is still unknown, never not_applicable', async () => {
    // Unlike Norway, KR cannot prove its code list enumerates every preference beneficiary, so
    // absence of the three candidate codes must not be read as "India does not qualify".
    const result = await ingest('290343');
    expect(result.india_preference.applicability).toBe('unknown');
    expect(result.india_preference.basis).toMatch(/does not prove its beneficiary list is complete/);
  });
});

describe('KR is not a routing gap in the unconfigured-sources registry', () => {
  test('the KR_DATA_GO_KR entry documents the API credential gap but no longer describes a routing block', () => {
    const source = unconfiguredSourceForCountry('KR');
    // unconfiguredSourceForCountry still finds the registry entry (it is retained as history),
    // but DESTINATION_ADAPTERS.KR is checked first by the job handler, so it never actually routes
    // there in production — this test pins that the entry's own text says so.
    expect(source?.determination).toMatch(/no longer the only acquisition route/);
  });
});
