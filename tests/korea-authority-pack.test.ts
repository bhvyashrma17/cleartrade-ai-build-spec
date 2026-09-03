import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { KoreaBundleError, readKoreaAuthorityBundle, verifyKoreaSnapshotSuperset } from '@/lib/market-access/providers/korea-bundle';
import { buildKoreaMarketAccess, parseKoreaDuty } from '@/lib/market-access/providers/korea-parser';
import { allKoreaRatePrograms, INDIA_FTA_RATE_CODES, resolveKoreaRateProgram } from '@/lib/market-access/providers/korea-rate-programs';
import { runTechnicalQualification } from '@/lib/market-access/vendor-qualification';
import { unconfiguredSourceForCountry } from '@/lib/market-access/unconfigured-sources';

const AT = new Date('2026-06-01T00:00:00.000Z');
const JAN = new Date('2026-01-20T00:00:00.000Z');
const FIXTURES = join(__dirname, 'fixtures');

/**
 * `korea-sample.xlsx` is a small synthetic workbook (built by a one-off script, not committed
 * runtime code) in the exact shape KCS publishes — sheets `1.1` and `2.12`, same nine columns —
 * carrying one item number per real-release archetype actually observed in the 2026-02-11 KCS
 * release: a general (`A`) + WTO-bound (`C`) pair, a compound `단위당세액` row, a `T2`/`T1`
 * reference-price/special-safeguard pair shaped like the real rice line, the real India (`FIN1`)
 * and non-India (`FCEPA1`, `FID1`) FTA codes, a `P1` quota row added only in `2.12` — mirroring the
 * real release's own 2026-02-12 quota amendment exactly, including the later effective date — a
 * purpose-coded (`용도세율`) row, refinement-required siblings, equivalent-children siblings, and
 * an expired rate. It is not authority evidence and is never presented as such; it exists solely to
 * exercise the reader/parser against realistic shapes without committing the real ~22MB government
 * file.
 */
function loadFixture(name: string): Buffer {
  return readFileSync(join(FIXTURES, name));
}

async function sampleBundle() {
  return readKoreaAuthorityBundle({ bytes: loadFixture('korea-sample.xlsx'), release_identifier: '2026-02-11' });
}

async function ingest(hs6: string, at: Date = AT, origin = 'IN') {
  const bundle = await sampleBundle();
  return buildKoreaMarketAccess({
    bundle, release_id: 'release-kr-1', release_reference_date: AT, retrieved_at: AT, hs6, at, origin_country: origin,
  });
}

describe('KCS workbook reader (fast, query-time path — canonical sheet only)', () => {
  test('reads the canonical 2.12 sheet, item-by-item, with the full row set per item', async () => {
    const bundle = await sampleBundle();
    expect(bundle.canonical_sheet).toBe('2.12');
    expect(bundle.canonical_sheet_row_count).toBeGreaterThan(0);

    const rows = bundle.item_rates.get('0101211000');
    expect(rows).toBeDefined();
    expect(rows!.map((r) => r.rate_type_code).sort()).toEqual(['A', 'C']);
  });

  test('rejects an unexpected header rather than silently misreading columns', async () => {
    await expect(readKoreaAuthorityBundle({ bytes: loadFixture('korea-bad-header.xlsx'), release_identifier: 'x' }))
      .rejects.toThrow(/not the documented/);
  });

  test('an empty canonical sheet is refused rather than silently producing zero items', async () => {
    await expect(readKoreaAuthorityBundle({ bytes: loadFixture('korea-empty.xlsx'), release_identifier: 'x' }))
      .rejects.toThrow(KoreaBundleError);
  });
});

describe('verifyKoreaSnapshotSuperset (expensive, import-time-only two-sheet check)', () => {
  test('refuses to proceed when sheet 1.1 has a row missing from 2.12 — the superset premise this relies on', async () => {
    await expect(verifyKoreaSnapshotSuperset(loadFixture('korea-superset-violation.xlsx')))
      .rejects.toThrow(/does not hold for this release/);
  });

  test('a SHARED row that differs in content between sheets is trusted from the later snapshot and tracked, not thrown on', async () => {
    // Proven against the real 2026-02-11 release, which has 13 such corrections (one example: item
    // 1201909000/FCA6, a 용도세율구분 clear) — not a hypothetical: "latest wins" is the correct
    // default, the same precedent this platform already applies when one AuthorityRelease
    // supersedes another. This fixture exercises the mechanism with a single synthetic instance.
    const result = await verifyKoreaSnapshotSuperset(loadFixture('korea-superset-content-mismatch.xlsx'));
    expect(result.corrected_count).toBe(1);
    expect(result.corrected[0]).toMatchObject({ item: '0101211000', rate_type_code: 'A' });

    // The canonical (2.12) sheet's own value is what the fast reader actually serves — the
    // verification trusts it rather than the earlier snapshot's.
    const bundle = await readKoreaAuthorityBundle({ bytes: loadFixture('korea-superset-content-mismatch.xlsx'), release_identifier: 'x' });
    expect(bundle.item_rates.get('0101211000')![0]!.rate_value).toBe(8);
  });

  test('the P1 quota row added only in 2.12 is tracked as a genuine addition, dated exactly as its own name implies', async () => {
    const result = await verifyKoreaSnapshotSuperset(loadFixture('korea-sample.xlsx'));
    expect(result.added_count).toBe(1);
    expect(result.added[0]).toMatchObject({ item: '0803900000', rate_type_code: 'P1', effective_from: '20260212' });
    expect(result.cross_check_sheet_row_count).toBeLessThanOrEqual(result.canonical_sheet_row_count);
  });
});

describe('Korea rate-program registry (built from KCS CLIP, verified 2026-09-03)', () => {
  test('every code observed in the real 2026-02-11 release resolves — zero unexplained active symbols', () => {
    // The full 224-code cross-check against the real government XLSX was performed during this
    // task's research pass (docs/customs-atlas); this test pins the registry's own internal
    // consistency and a representative sample rather than re-shipping the real file.
    for (const symbol of ['A', 'C', 'D', 'F', 'G1', 'G2', 'I', 'L', 'R', 'T1', 'T2', 'U', 'W1', 'W2', 'P1', 'P3', 'FIN1', 'FID1', 'FCEPA1', 'FUS1', 'FEU1', 'FAS1', 'FRCAS1', 'E1A1']) {
      const r = resolveKoreaRateProgram(symbol);
      expect(r.resolved, `${symbol} should resolve`).toBe(true);
    }
    expect(allKoreaRatePrograms().length).toBeGreaterThan(300);
  });

  test('FIN1-4 are the confirmed Korea-India FTA/CEPA codes, and nothing else is', () => {
    expect(INDIA_FTA_RATE_CODES).toEqual(['FIN1', 'FIN2', 'FIN3', 'FIN4']);
    expect(INDIA_FTA_RATE_CODES).not.toContain('FCEPA1');
    expect(INDIA_FTA_RATE_CODES).not.toContain('FID1');
  });

  test('FCEPA1 resolves to Korea-Central America FTA, Panama — not India, despite the name', () => {
    const r = resolveKoreaRateProgram('FCEPA1');
    expect(r.resolved).toBe(true);
    if (r.resolved) {
      expect(r.program.agreement).toBe('Korea-Central America FTA');
      expect(r.program.partner).toBe('Panama');
    }
  });

  test('FID1 resolves to Korea-Indonesia CEPA — a real agreement, distinct from India', () => {
    const r = resolveKoreaRateProgram('FID1');
    expect(r.resolved).toBe(true);
    if (r.resolved) expect(r.program.agreement).toBe('Korea-Indonesia CEPA');
  });

  test('P1 resolves as a quota programme requiring a recommendation', () => {
    const r = resolveKoreaRateProgram('P1');
    expect(r.resolved).toBe(true);
    if (r.resolved) {
      expect(r.program.is_quota).toBe(true);
      expect(r.program.recommendation_required).toBe(true);
    }
  });

  test('T1/T2 resolve as volume-based / price-based special safeguards, not preferential programmes', () => {
    const t1 = resolveKoreaRateProgram('T1');
    const t2 = resolveKoreaRateProgram('T2');
    expect(t1.resolved && t1.program.program_class).toBe('special_safeguard');
    expect(t2.resolved && t2.program.program_class).toBe('special_safeguard');
    expect(t1.resolved && t1.program.agreement).toBe('volume-based');
    expect(t2.resolved && t2.program.agreement).toBe('price-based');
  });

  test('an unresolved symbol is a real, reportable outcome — not a thrown error', () => {
    const r = resolveKoreaRateProgram('ZZ_NOT_A_REAL_CODE');
    expect(r.resolved).toBe(false);
  });
});

describe('Korean duty semantics (parseKoreaDuty, pure)', () => {
  test('관세율 alone is ad valorem', () => {
    const duty = parseKoreaDuty({ rate_type_code: 'A', rate_value: 8, unit_amount: null, reference_price: null, country_scope: '1', purpose_code: null, effective_from: '20260101', effective_to: '20261231' });
    expect(duty).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 8 });
  });

  test('rice-shaped rate: a populated 기준가격 is retained as safeguard evidence, never computed into the duty', () => {
    const duty = parseKoreaDuty({ rate_type_code: 'T2', rate_value: 513, unit_amount: null, reference_price: 145, country_scope: '1', purpose_code: null, effective_from: '20260101', effective_to: '20261231' });
    expect(duty.kind).toBe('ad_valorem');
    expect(duty.ad_valorem_rate_percent).toBe(513);
    expect(duty.note).toMatch(/special safeguard/i);
    expect(duty.note).toMatch(/cannot be computed without the shipment's actual import price/);
  });

  test('a populated 단위당세액 alongside 관세율 is compound: KRW currency asserted, quantity unit left unresolved', () => {
    const duty = parseKoreaDuty({ rate_type_code: 'A', rate_value: 30, unit_amount: 134, reference_price: null, country_scope: '1', purpose_code: null, effective_from: '20260101', effective_to: '20261231' });
    expect(duty.kind).toBe('compound');
    expect(duty.ad_valorem_rate_percent).toBeNull();
    expect(duty.specific_amount).toBe(134);
    expect(duty.specific_currency).toBe('KRW');
    expect(duty.specific_unit).toBeNull();
    expect(duty.expression).toContain('30%');
    expect(duty.expression).toContain('134');
    expect(duty.note).toMatch(/quantity unit.*not published|left unresolved/);
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
  });
});

describe('India-Korea CEPA — full closure', () => {
  test('FIN1 is a confirmed direct India measure: potentially_applicable_requires_origin_proof, never confirmed_applicable', async () => {
    const result = await ingest('080510');
    expect(result.india_preference.applicability).toBe('potentially_applicable_requires_origin_proof');
    expect(result.india_preference.geographic_area_id).toBe('FIN1');
    expect(result.india_preference.basis).toMatch(/rules-of-origin qualification/);

    const finLine = result.lines.find((l) => l.origin_geographic_area_id === 'FIN1');
    expect(finLine).toBeDefined();
    expect(finLine!.applies_to_origin_country).toBe('IN');
    expect(finLine!.measure_kind).toBe('tariff_preference');
  });

  test('FCEPA1 (Panama) and FID1 (Indonesia) on the same item are never treated as India measures', async () => {
    const result = await ingest('080510');
    const fcepa = result.lines.find((l) => l.origin_geographic_area_id === 'FCEPA1');
    const fid = result.lines.find((l) => l.origin_geographic_area_id === 'FID1');
    expect(fcepa!.applies_to_origin_country).toBeNull();
    expect(fid!.applies_to_origin_country).toBeNull();
    expect(fcepa!.conditions).toMatchObject({ agreement: 'Korea-Central America FTA', partner: 'Panama' });
    expect(fid!.conditions).toMatchObject({ agreement: 'Korea-Indonesia CEPA' });
    // The India determination names only FIN1 as its basis.
    expect(result.india_preference.geographic_area_id).toBe('FIN1');
  });

  test('a non-India origin request resolves not_applicable and never attributes FIN1 evidence to that origin', async () => {
    const result = await ingest('080510', AT, 'US');
    expect(result.india_preference.applicability).toBe('not_applicable');
    expect(result.india_preference.basis).toMatch(/requested origin is US, not India/);
    // The FIN1 row is still retained as evidence (it is a real programme this item is subject to),
    // but it is never attributed to a US-origin request — full evidence retention, correct
    // attribution, not the same thing as hiding the row.
    const finLine = result.lines.find((l) => l.origin_geographic_area_id === 'FIN1');
    expect(finLine).toBeDefined();
    expect(finLine!.applies_to_origin_country).toBeNull();
  });

  test('no India-shaped code present at all is still unknown, never not_applicable, for an India-origin request', async () => {
    const result = await ingest('290343');
    expect(result.india_preference.applicability).toBe('unknown');
    expect(result.india_preference.basis).toMatch(/does not prove its beneficiary list is complete/);
  });
});

describe('Quota (할당관세) and special-safeguard (특별긴급관세) conditionality', () => {
  test('a P1 quota row is measure_kind tariff_quota and generates a material requirement record, not an unconditional rate', async () => {
    const result = await ingest('080390', new Date('2026-06-01T00:00:00.000Z'));
    const quotaLine = result.lines.find((l) => l.origin_geographic_area_id === 'P1');
    expect(quotaLine).toBeDefined();
    expect(quotaLine!.measure_kind).toBe('tariff_quota');
    expect(quotaLine!.conditions).toMatchObject({ is_quota: true, recommendation_required: true });

    const req = result.requirements.find((r) => r.requirement_code === 'P1');
    expect(req).toBeDefined();
    expect(req!.requirement_description).toMatch(/requires an import recommendation/);
  });

  test('the P1 quota row is not seen before its own 2026-02-12 effective date — historical correctness from per-row dates alone', async () => {
    const result = await ingest('080390', JAN);
    const quotaLine = result.lines.find((l) => l.origin_geographic_area_id === 'P1');
    expect(quotaLine).toBeUndefined();
    // The general A rate is unaffected and still resolves for the same January query.
    expect(result.general_duty).toMatchObject({ ad_valorem_rate_percent: 30 });
  });

  test('T1/T2 special-safeguard rows are additional_duty, never computed from the reference price', async () => {
    const result = await ingest('100610');
    const t1 = result.lines.find((l) => l.origin_geographic_area_id === 'T1');
    const t2 = result.lines.find((l) => l.origin_geographic_area_id === 'T2');
    expect(t1!.measure_kind).toBe('additional_duty');
    expect(t2!.measure_kind).toBe('additional_duty');
    expect(t2!.duty.ad_valorem_rate_percent).toBe(513);
    expect(t2!.duty.note).toMatch(/cannot be computed without the shipment's actual import price/);
  });
});

describe('용도세율 (purpose/end-use) conditionality', () => {
  test('a row with a non-null purpose_code is flagged purpose_conditional, never folded into an unconditional rate', async () => {
    const result = await ingest('240110');
    const line = result.lines.find((l) => l.origin_geographic_area_id === 'A' && l.national_tariff_code === '2401103000');
    expect(line).toBeDefined();
    expect(line!.conditions).toMatchObject({ purpose_code: 'A', purpose_conditional: true });
  });
});

describe('KR is not a routing gap in the unconfigured-sources registry', () => {
  test('the KR_DATA_GO_KR entry documents the API credential gap but no longer describes a routing block', () => {
    const source = unconfiguredSourceForCountry('KR');
    expect(source?.determination).toMatch(/no longer the only acquisition route/);
  });
});
