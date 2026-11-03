import { describe, expect, test } from 'vitest';
import type { MarketAccessIngestResult, MarketAccessLineRecord } from '@/lib/market-access/contract';
import { parseDutyExpression, type ParsedDuty } from '@/lib/market-access/tariff-semantics';
import {
  buildQualificationReport,
  blankQualificationReport,
  qualifyVendorCandidate,
  runTechnicalQualification,
  VENDOR_QUALIFICATION_HARNESS_VERSION,
  type VendorTechnicalQualification,
} from '@/lib/market-access/vendor-qualification';

/**
 * Step 2C: a provider-neutral harness that grades whatever a vendor adapter produces against the
 * canonical MarketAccessIngestResult contract, without knowing or caring which vendor it is.
 *
 * The EU Basmati case (HS 100630, origin India, destination Germany) is the same discriminator
 * that disqualified UNCTAD TRAINS in Step 2 — a real specific duty of roughly EUR 175 per tonne,
 * with no India preference because none exists. It anchors both the passing fixture and every
 * deliberately-broken variant below.
 */

const RETRIEVED = new Date('2026-08-20T00:00:00.000Z');

function specificEuRiceDuty(): ParsedDuty {
  return parseDutyExpression('EUR 175.00 / 1000 kg');
}

function euRiceLine(over: Partial<MarketAccessLineRecord> = {}): MarketAccessLineRecord {
  return {
    national_tariff_code: '10063092',
    description: 'Semi-milled or wholly milled rice, parboiled',
    declarable: true,
    measure_kind: 'third_country_duty',
    origin_geographic_area_id: null,
    origin_scope: 'erga_omnes',
    applies_to_origin_country: null,
    duty: specificEuRiceDuty(),
    conditions: {},
    effective_from: new Date('2026-01-01T00:00:00.000Z'),
    effective_to: null,
    source_reference: 'https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp?Lang=en',
    raw_measure: { code: '142600' },
    ...over,
  };
}

/** The passing candidate: a specific EU rice duty, correctly represented, no fabricated preference. */
function passingCandidate(over: Partial<MarketAccessIngestResult> = {}): MarketAccessIngestResult {
  const line = euRiceLine();
  return {
    jurisdiction: 'EU',
    country_code: 'DE',
    hs6: '100630',
    hs_revision: 'HS2022',
    provider: 'e2open',
    source_authority: 'European Commission — TARIC',
    source_dataset: 'global_knowledge',
    source_dataset_version: '2026-08-15',
    source_reference: line.source_reference,
    national_code_system: 'EU_TARIC',
    parser_version: 'e2open-adapter-v1',
    retrieved_at: RETRIEVED,
    evidence_class: 'authoritative_public',
    recorded_by_id: null,
    resolution: {
      resolution: 'exact',
      resolved_line: {
        national_tariff_code: line.national_tariff_code,
        description: line.description,
        declarable: true,
        effective_from: line.effective_from,
        effective_to: line.effective_to,
        general_duty: line.duty,
        control_codes: [],
        preference_area_ids: [],
      },
      candidates: [],
      candidate_count: 1,
      differences: [],
      reason: 'A single declarable line was established.',
    },
    general_duty: line.duty,
    india_preference: {
      applicability: 'not_applicable',
      duty: null,
      basis: 'No EU–India preferential measure is published for this line; India is absent from the enumerated beneficiary list.',
      geographic_area_id: null,
    },
    lines: [line],
    requirements: [],
    regulatory_coverage_complete: false,
    raw_evidence: { note: 'fixture' },
    ...over,
  };
}

const runsPassing = () => runTechnicalQualification(passingCandidate(), 'eu_basmati_de');

describe('the EU Basmati discriminator: passing candidate', () => {
  test('a correctly represented candidate passes every technical check', () => {
    const result = runsPassing();
    expect(result.passed).toBe(true);
    expect(result.checks.every((check) => check.passed)).toBe(true);
    expect(result.checks.length).toBeGreaterThanOrEqual(14);
  });

  test('the specific duty keeps its amount, currency and unit', () => {
    const check = runsPassing().checks.find((item) => item.code === 'specific_duty_representation');
    expect(check).toMatchObject({ passed: true });
    expect(check!.detail).toContain('EUR');
    expect(check!.detail).toContain('kg');
  });

  test('async resolution works identically for a live-sandbox-shaped source', async () => {
    const result = await qualifyVendorCandidate(async () => passingCandidate(), 'eu_basmati_de_async');
    expect(result.passed).toBe(true);
    expect(result.scenario).toBe('eu_basmati_de_async');
  });
});

describe('rejects: specific duty collapsed into a percentage', () => {
  test('a specific duty that also carries an ad-valorem percentage fails', () => {
    const broken = passingCandidate({ general_duty: { ...specificEuRiceDuty(), ad_valorem_rate_percent: 11.2 } });
    const result = runTechnicalQualification(broken, 'percentage_substituted');
    expect(result.passed).toBe(false);
    const check = result.checks.find((item) => item.code === 'specific_duty_representation');
    expect(check).toMatchObject({ passed: false });
    expect(check!.detail).toMatch(/substituted/);
  });

  test('a duty reported as ad_valorem when the source published a specific rate fails downstream expectations', () => {
    // A connector that silently reinterprets the specific expression as a percentage produces a
    // kind mismatch the harness cannot see directly, but the substitution check catches the
    // tell-tale sign: both a rate and a specific amount present on the same duty.
    const broken = passingCandidate({ general_duty: { kind: 'ad_valorem', ad_valorem_rate_percent: 11.2, specific_amount: 175, specific_currency: 'EUR', specific_unit: 'kg', specific_unit_quantity: 1000, expression: 'EUR 175.00 / 1000 kg', note: null } });
    const result = runTechnicalQualification(broken, 'kind_mismatch');
    expect(result.passed).toBe(false);
  });
});

describe('rejects: missing tariff represented as zero', () => {
  test('a zero duty with no verbatim expression cannot be traced and fails', () => {
    const broken = passingCandidate({ general_duty: { kind: 'ad_valorem', ad_valorem_rate_percent: 0, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null, expression: '', note: null } });
    const result = runTechnicalQualification(broken, 'untraceable_zero');
    expect(result.passed).toBe(false);
    expect(result.checks.find((item) => item.code === 'duty_free_vs_missing')).toMatchObject({ passed: false });
  });
});

describe('rejects: simple-average tariff statistics', () => {
  test('a duty whose note self-describes as a statistical average fails', () => {
    const broken = passingCandidate({ general_duty: { kind: 'unparsed', ad_valorem_rate_percent: null, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null, expression: '11.2', note: 'Simple average of 2 tariff lines' } });
    const result = runTechnicalQualification(broken, 'statistical_average');
    expect(result.passed).toBe(false);
    expect(result.checks.find((item) => item.code === 'not_a_statistical_average')).toMatchObject({ passed: false });
  });

  test('a dataset self-labelled as an average also fails, even with a clean duty', () => {
    const broken = passingCandidate({ source_dataset: 'wits_simple_average_tariff' });
    const result = runTechnicalQualification(broken, 'statistical_dataset');
    expect(result.passed).toBe(false);
  });
});

describe('rejects: compound/mixed duty reduced to a fabricated scalar', () => {
  test('a compound duty carrying a percentage instead of its verbatim expression fails', () => {
    const broken = passingCandidate({ general_duty: { kind: 'compound', ad_valorem_rate_percent: 10, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null, expression: '10% + 50 EUR / 1000 kg', note: 'Compound duty' } });
    const result = runTechnicalQualification(broken, 'compound_fabricated_scalar');
    expect(result.passed).toBe(false);
    expect(result.checks.find((item) => item.code === 'compound_mixed_duty_representation')).toMatchObject({ passed: false });
  });

  test('a compound duty that keeps only its verbatim expression passes that check', () => {
    const ok = passingCandidate({ general_duty: parseDutyExpression('10% + 50 EUR / 1000 kg') });
    const result = runTechnicalQualification(ok, 'compound_correct');
    expect(result.checks.find((item) => item.code === 'compound_mixed_duty_representation')).toMatchObject({ passed: true });
  });
});

describe('rejects: preferential treatment inferred merely because a scheme exists', () => {
  test('confirmed applicability with no duty or basis fails', () => {
    const broken = passingCandidate({
      india_preference: { applicability: 'confirmed_applicable', duty: null, basis: '', geographic_area_id: null },
    });
    const result = runTechnicalQualification(broken, 'inferred_preference');
    expect(result.passed).toBe(false);
    expect(result.checks.find((item) => item.code === 'origin_eligibility_determination')).toMatchObject({ passed: false });
  });

  test('a quota-linked line backing a confirmed determination fails — a quota is never unconditional', () => {
    const quotaLine = euRiceLine({ national_tariff_code: '10063094', measure_kind: 'tariff_quota', origin_scope: 'country', applies_to_origin_country: 'IN' });
    const broken = passingCandidate({
      lines: [euRiceLine(), quotaLine],
      resolution: {
        resolution: 'exact',
        resolved_line: { national_tariff_code: quotaLine.national_tariff_code, description: quotaLine.description, declarable: true, effective_from: quotaLine.effective_from, effective_to: null, general_duty: quotaLine.duty, control_codes: [], preference_area_ids: ['IN'] },
        candidates: [], candidate_count: 1, differences: [], reason: 'fixture',
      },
      india_preference: { applicability: 'confirmed_applicable', duty: quotaLine.duty, basis: 'Within the published India quota volume.', geographic_area_id: 'IN' },
    });
    const result = runTechnicalQualification(broken, 'quota_confirmed');
    expect(result.passed).toBe(false);
    expect(result.checks.find((item) => item.code === 'tariff_quota_representation')).toMatchObject({ passed: false });
  });

  test('potentially_applicable_requires_origin_proof is accepted — this is the honest unresolved state', () => {
    const ok = passingCandidate({
      india_preference: { applicability: 'potentially_applicable_requires_origin_proof', duty: specificEuRiceDuty(), basis: 'A preferential measure exists for a group India may belong to; origin proof has not been evidenced.', geographic_area_id: 'GRP-1' },
    });
    const result = runTechnicalQualification(ok, 'potentially_applicable');
    expect(result.checks.find((item) => item.code === 'origin_eligibility_determination')).toMatchObject({ passed: true });
  });
});

describe('rejects: untraceable rows lacking source or effective-date lineage', () => {
  test('a resolved duty with no effective_from fails', () => {
    const line = euRiceLine({ effective_from: null });
    const broken = passingCandidate({
      lines: [line],
      resolution: { resolution: 'exact', resolved_line: { national_tariff_code: line.national_tariff_code, description: line.description, declarable: true, effective_from: null, effective_to: null, general_duty: line.duty, control_codes: [], preference_area_ids: [] }, candidates: [], candidate_count: 1, differences: [], reason: 'fixture' },
    });
    const result = runTechnicalQualification(broken, 'no_effective_date');
    expect(result.passed).toBe(false);
    expect(result.checks.find((item) => item.code === 'effective_dates')).toMatchObject({ passed: false });
  });

  test('a line dated after its own retrieval fails', () => {
    const line = euRiceLine({ effective_from: new Date('2027-01-01T00:00:00.000Z') });
    const broken = passingCandidate({ lines: [line] });
    const result = runTechnicalQualification(broken, 'future_dated');
    expect(result.checks.find((item) => item.code === 'effective_dates')).toMatchObject({ passed: false });
  });

  test('a line with no source reference of its own fails attribution', () => {
    const broken = passingCandidate({ lines: [euRiceLine({ source_reference: '' })] });
    const result = runTechnicalQualification(broken, 'no_line_citation');
    expect(result.passed).toBe(false);
    expect(result.checks.find((item) => item.code === 'source_authority_attribution')).toMatchObject({ passed: false });
  });

  test('a candidate with no stable dataset version cannot be traced back to a release', () => {
    const broken = passingCandidate({ source_dataset_version: null });
    const result = runTechnicalQualification(broken, 'no_version');
    expect(result.checks.find((item) => item.code === 'stable_source_version_identifier')).toMatchObject({ passed: false });
  });
});

describe('national tariff-line identity and HS revision', () => {
  test('an HS6-only candidate with no declarable line does not falsely claim resolution', () => {
    const hs6Only = passingCandidate({
      resolution: { resolution: 'unavailable', resolved_line: null, candidates: [], candidate_count: 0, differences: [], reason: 'Only an HS6 average was available; no national line was resolved.' },
      general_duty: null,
    });
    const result = runTechnicalQualification(hs6Only, 'hs6_only');
    expect(result.checks.find((item) => item.code === 'national_tariff_line_identity')).toMatchObject({ passed: true });
    expect(result.checks.find((item) => item.code === 'duty_free_vs_missing')).toMatchObject({ passed: true });
  });

  test('a resolution claiming exact with no resolved line fails identity', () => {
    const broken = passingCandidate({ resolution: { resolution: 'exact', resolved_line: null, candidates: [], candidate_count: 0, differences: [], reason: 'fixture' } });
    const result = runTechnicalQualification(broken, 'exact_without_line');
    expect(result.checks.find((item) => item.code === 'national_tariff_line_identity')).toMatchObject({ passed: false });
  });

  test('a blank HS revision fails', () => {
    const broken = passingCandidate({ hs_revision: '' });
    expect(runTechnicalQualification(broken, 'blank_revision').checks.find((item) => item.code === 'hs_revision')).toMatchObject({ passed: false });
  });
});

describe('regulatory completeness metadata is explicit, never assumed', () => {
  test('an explicit false is accepted — it correctly claims nothing', () => {
    const ok = passingCandidate({ regulatory_coverage_complete: false });
    expect(runTechnicalQualification(ok, 'regulatory_false').checks.find((item) => item.code === 'regulatory_completeness_metadata')).toMatchObject({ passed: true });
  });

  test('a non-boolean value fails, since the question was never actually answered', () => {
    const broken = passingCandidate({ regulatory_coverage_complete: undefined as unknown as boolean });
    expect(runTechnicalQualification(broken, 'regulatory_undefined').checks.find((item) => item.code === 'regulatory_completeness_metadata')).toMatchObject({ passed: false });
  });
});

describe('the qualification report never grants approval on technical grounds alone', () => {
  function passingResults(): VendorTechnicalQualification[] {
    return [runsPassing()];
  }

  test('technical pass alone yields not_qualified, never approved', () => {
    const report = buildQualificationReport({ provider: 'e2open', technical_results: passingResults() });
    expect(report.technical_pass).toBe(true);
    expect(report.final_status).toBe('not_qualified');
    expect(report.final_status).not.toBe('approved');
    expect(report.contract_version).toBe(VENDOR_QUALIFICATION_HARNESS_VERSION);
  });

  test('any technical failure disqualifies regardless of commercial answers', () => {
    const failing = runTechnicalQualification(passingCandidate({ hs_revision: '' }), 'broken');
    const report = buildQualificationReport({
      provider: 'e2open', technical_results: [failing],
      licensing_pass: true, redistribution_pass: true, regulatory_completeness_pass: true,
    });
    expect(report.final_status).toBe('disqualified');
  });

  test('an explicit commercial failure disqualifies even with clean technical results', () => {
    const report = buildQualificationReport({
      provider: 'e2open', technical_results: passingResults(),
      licensing_pass: false, redistribution_pass: true,
    });
    expect(report.final_status).toBe('disqualified');
  });

  test('technical pass plus licensing and redistribution pass reaches pending-review, never approved', () => {
    const report = buildQualificationReport({
      provider: 'e2open', technical_results: passingResults(),
      licensing_pass: true, redistribution_pass: true, regulatory_completeness_pass: false,
      coverage: { destinations_covered: 118, national_line_resolution: true },
      pricing: { requires_sales_contact: true, note: 'No public pricing; sales engagement required.' },
      sandbox: { available: true, used_for_technical_results: true },
    });
    expect(report.final_status).toBe('technically_qualified_pending_commercial_review');
    expect(report.coverage?.destinations_covered).toBe(118);
    expect(report.pricing?.requires_sales_contact).toBe(true);
  });

  test('a blank report for an unevaluated provider is not_qualified with no technical pass claimed', () => {
    const report = blankQualificationReport('descartes_customsinfo');
    expect(report.technical_pass).toBe(false);
    expect(report.final_status).toBe('not_qualified');
    expect(report.technical_results).toHaveLength(0);
  });

  test('the report never contains a field that itself grants registry approval', () => {
    const report = buildQualificationReport({ provider: 'e2open', technical_results: passingResults(), licensing_pass: true, redistribution_pass: true });
    const values = Object.values(report).map((value) => JSON.stringify(value));
    expect(values.join(' ')).not.toMatch(/"approved"/);
  });
});

describe('the harness does not touch the licensed-provider registry', () => {
  test('this module never imports the registry it must not write to', async () => {
    // The module's own doc comment explains, in prose, that it deliberately does NOT touch the
    // registry — so the check is for an actual import statement, not any mention of the name.
    const source = await import('node:fs').then((fs) => fs.readFileSync('src/lib/market-access/vendor-qualification.ts', 'utf8'));
    expect(source).not.toMatch(/from\s+['"][^'"]*licensed-providers['"]/);
    expect(source).not.toContain('LICENSED_PROVIDER_APPROVALS');
  });
});
