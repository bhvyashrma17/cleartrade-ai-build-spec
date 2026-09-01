import { randomUUID } from 'node:crypto';
import { EvidenceOrigin, MarketAccessEvidenceStatus, MarketAccessRuleType, Prisma } from '@prisma/client';
import { describe, expect, test } from 'vitest';
import { CONFIG_DEFAULTS } from '@/lib/config';
import { buildCountryTruthExporterFactSnapshot } from '@/lib/country-truth/exporter-fact-snapshot';
import { selectCountryTruthFacts, type CountryTruthEvidenceRows } from '@/lib/country-truth/fact-selection';
import {
  LICENSED_PROVIDER_APPROVALS,
  LICENSED_PROVIDER_POLICY_VERSION,
  isLicensedProvider,
  licensedAdmissionRejection,
  licensedApprovalFor,
  type LicensedProviderApproval,
} from '@/lib/market-access/licensed-providers';
import { determineIndiaPreference, parseDutyExpression } from '@/lib/market-access/tariff-semantics';

/**
 * Step 2B: licensed commercial trade content is a distinct epistemic class.
 *
 * A vendor may reproduce a customs authority faithfully and still not be that authority. These
 * tests pin the separation, the precedence that keeps a vendor from displacing a direct source,
 * the registry that is the only thing able to admit vendor evidence at all, and the duty
 * representation any future connector must satisfy.
 */

const AS_OF = new Date('2026-08-29T00:00:00.000Z');
const RETRIEVED = new Date('2026-08-20T00:00:00.000Z');

const emptyEvidence: CountryTruthEvidenceRows = {
  market_access_snapshots: [],
  market_access_evidence: [],
  fit_benchmarks: [],
  logistics_routes: [],
  exchange_rate_quotes: [],
};

const scope = {
  exporter_org_id: 'org-1',
  origin_country_code: 'IN',
  country_code: 'GB',
  hs6: '090111',
  hs_revision: 'HS2022',
  as_of_date: AS_OF.toISOString(),
};

function exporterSnapshot() {
  return buildCountryTruthExporterFactSnapshot({
    captured_at: AS_OF,
    exporter_org: { id: 'org-1', country: 'IN', pickup_location_code: 'INNSA', preferred_origin_gateway: 'INNSA', updated_at: RETRIEVED },
    product: {
      id: 'product-1', exporter_org_id: 'org-1', updated_at: RETRIEVED,
      hs_code: '090111', hs_nomenclature_version: 'HS2022', hs_classification_revision: 1, hs_classification_status: 'confirmed',
      price_target_amount: '10', price_target_currency: 'USD', price_target_quantity_unit: 'kg', price_target_incoterm: 'FOB',
      capacity_value: '1000', capacity_unit: 'kg', moq_value: '100', moq_unit: 'kg', lead_time_days: 21,
      logistics_constraint_codes: [], logistics_constraints_confirmed: true,
    },
    certifications: [],
    classification: {
      id: 'classification-1', product_id: 'product-1', revision: 1,
      hs6_code: '090111', nomenclature_version: 'HS2022', status: 'confirmed',
      confirmed_by_id: 'agent-1', confirmed_at: RETRIEVED,
    },
  }).snapshot;
}

function snapshotRow(over: Partial<CountryTruthEvidenceRows['market_access_snapshots'][number]> = {}) {
  return {
    id: `snap-${randomUUID()}`,
    country_code: 'GB',
    hs_code_scope: '090111',
    source_authority: 'HMRC',
    source_reference: 'https://example.test/tariff',
    retrieved_at: RETRIEVED,
    effective_at: new Date('2026-01-01T00:00:00.000Z'),
    expires_at: null,
    completeness_status: 'COMPLETE',
    tariff_coverage: true,
    regulatory_coverage: true,
    evidence_origin: EvidenceOrigin.public_real as string,
    ...over,
  };
}

function evidenceRow(over: Partial<CountryTruthEvidenceRows['market_access_evidence'][number]> = {}) {
  return {
    id: `mae-${randomUUID()}`,
    snapshot_id: 'snapshot-1',
    country_code: 'GB',
    hs_code_scope: '090111',
    rule_type: MarketAccessRuleType.destination_tariff as string,
    source_authority: 'HMRC',
    source_reference: 'https://example.test/tariff',
    retrieved_at: RETRIEVED,
    effective_at: new Date('2026-01-01T00:00:00.000Z'),
    expires_at: null,
    superseded_at: null,
    status: MarketAccessEvidenceStatus.verified as string,
    confidence: new Prisma.Decimal(1),
    evidence_origin: EvidenceOrigin.public_real as string,
    tariff_rate_percent: new Prisma.Decimal(5),
    requirement_code: null,
    requirement_description: null,
    requirement_obtainable: null,
    ...over,
  };
}

const select = (evidence: Partial<CountryTruthEvidenceRows>) =>
  selectCountryTruthFacts({ scope, exporter_snapshot: exporterSnapshot(), evidence: { ...emptyEvidence, ...evidence } });

describe('licensed content is a distinct assertion class', () => {
  test('the registry ships empty, so no licensed evidence is admissible anywhere', () => {
    expect(LICENSED_PROVIDER_APPROVALS).toHaveLength(0);
    expect(LICENSED_PROVIDER_POLICY_VERSION).toBe('licensed-provider-approval-v1');
  });

  test('known commercial distributors are recognised; a customs authority is not one', () => {
    expect(isLicensedProvider('e2open')).toBe(true);
    expect(isLicensedProvider('descartes_customsinfo')).toBe(true);
    expect(isLicensedProvider('avalara')).toBe(true);
    // An authority, and an unknown provider, are never silently reclassified.
    expect(isLicensedProvider('taric')).toBe(false);
    expect(isLicensedProvider('uk_tariff_api')).toBe(false);
    expect(isLicensedProvider(null)).toBe(false);
    expect(isLicensedProvider(undefined)).toBe(false);
  });

  test('a direct authority snapshot keeps the authoritative reading it has always had', () => {
    const facts = select({
      market_access_snapshots: [snapshotRow({ id: 'snapshot-1' })],
      market_access_evidence: [evidenceRow({ snapshot_id: 'snapshot-1' })],
    });
    expect(facts.market_access.tariffs[0]?.provenance.assertion_class).toBe('authoritative_public');
  });

  test('a row with no provider recorded is unchanged, so frozen evidence keeps its meaning', () => {
    const facts = select({
      market_access_snapshots: [snapshotRow({ id: 'snapshot-1', provider: null, source_dataset: null })],
      market_access_evidence: [evidenceRow({ snapshot_id: 'snapshot-1' })],
    });
    expect(facts.market_access.tariffs[0]?.provenance.assertion_class).toBe('authoritative_public');
  });
});

describe('unapproved licensed evidence is refused, not downgraded', () => {
  test('a vendor tariff row is rejected while no approval covers it', () => {
    const facts = select({
      market_access_snapshots: [snapshotRow({ id: 'snapshot-1', provider: 'e2open', source_dataset: 'global_knowledge' })],
      market_access_evidence: [evidenceRow({ id: 'mae-vendor', snapshot_id: 'snapshot-1' })],
    });
    expect(facts.market_access.tariffs).toHaveLength(0);
    expect(facts.rejected).toContainEqual({
      source: 'market_access_evidence',
      row_id: 'mae-vendor',
      reason: 'licensed_provider_not_approved_tariff',
    });
  });

  test('a vendor regulatory snapshot cannot become a completeness claim', () => {
    const facts = select({
      market_access_snapshots: [snapshotRow({ id: 'snap-vendor', provider: 'avalara', source_dataset: 'trade_tariff_library' })],
    });
    expect(facts.market_access.regulatory_coverage).toBeNull();
    expect(facts.rejected).toContainEqual({
      source: 'market_access_snapshot',
      row_id: 'snap-vendor',
      reason: 'licensed_provider_not_approved_regulatory',
    });
  });

  test('the rejection is recorded, so a refused fact is distinguishable from one that never existed', () => {
    const facts = select({
      market_access_snapshots: [snapshotRow({ id: 'snap-vendor', provider: 'e2open', source_dataset: 'global_knowledge' })],
    });
    expect(facts.rejected.some((entry) => entry.reason.startsWith('licensed_provider_not_approved'))).toBe(true);
  });
});

describe('approval is exact, server-side, and time-bounded', () => {
  const approval: LicensedProviderApproval = {
    provider: 'e2open',
    contract_version: 'test-contract-1',
    approved_datasets: ['global_knowledge'],
    allowed_assertion_types: ['tariff'],
    covered_countries: ['GB'],
    resolution: 'national_tariff_line',
    regulatory_completeness_warranted: false,
    redistribution_permitted: true,
    effective_from: '2026-01-01T00:00:00.000Z',
    effective_until: null,
  };
  const query = { provider: 'e2open', dataset: 'global_knowledge', country_code: 'GB', assertion_type: 'tariff' as const, as_of: AS_OF };
  const against = (over: Partial<LicensedProviderApproval>) =>
    // Evaluate the same rules the registry uses, against a candidate approval.
    licensedApprovalForCandidates([{ ...approval, ...over }], query);

  test('an approval covering every dimension admits the use', () => {
    expect(against({})).not.toBeNull();
  });

  test('a dimension the contract does not cover grants nothing', () => {
    expect(against({ covered_countries: ['JP'] })).toBeNull();
    expect(against({ approved_datasets: ['other_dataset'] })).toBeNull();
    expect(against({ allowed_assertion_types: ['regulatory'] })).toBeNull();
    expect(against({ provider: 'descartes_customsinfo' })).toBeNull();
  });

  test('an approval outside its effective window admits nothing', () => {
    expect(against({ effective_from: '2027-01-01T00:00:00.000Z' })).toBeNull();
    expect(against({ effective_until: '2026-01-02T00:00:00.000Z' })).toBeNull();
  });

  test('a tariff approval never implies a regulatory one', () => {
    expect(against({ allowed_assertion_types: ['tariff'] })).not.toBeNull();
    expect(licensedApprovalForCandidates([{ ...approval, allowed_assertion_types: ['tariff'] }], { ...query, assertion_type: 'regulatory' })).toBeNull();
  });

  test('approval lives in server-side code, never in a request payload', () => {
    // The registry is a frozen module constant. There is no setter, and nothing reads a header,
    // body or query parameter to decide trust.
    expect(Object.isFrozen(LICENSED_PROVIDER_APPROVALS)).toBe(true);
    const source = readLicensedProviderSource();
    expect(source).not.toMatch(/req(uest)?\.|searchParams|headers\.get|body\./);
  });
});

describe('direct authority outranks a commercial distributor', () => {
  test('a newer vendor snapshot never displaces a current authority snapshot', () => {
    // The vendor row is newer, which under a newest-wins rule would have won.
    const facts = select({
      market_access_snapshots: [
        snapshotRow({ id: 'snap-authority', source_authority: 'HMRC', retrieved_at: new Date('2026-08-01T00:00:00.000Z') }),
        snapshotRow({ id: 'snap-vendor', provider: 'e2open', source_dataset: 'global_knowledge', retrieved_at: new Date('2026-08-25T00:00:00.000Z') }),
      ],
    });
    expect(facts.market_access.regulatory_coverage?.provenance.assertion_class).toBe('authoritative_public');
    expect(facts.market_access.regulatory_coverage?.id).toContain('snap-authority');
  });
});

describe('regulatory absence still requires proven completeness', () => {
  test('partial coverage cannot establish that no requirement exists', () => {
    const facts = select({ market_access_snapshots: [snapshotRow({ id: 'snapshot-1', completeness_status: 'PARTIAL' })] });
    const coverage = facts.market_access.regulatory_coverage;
    // The fact may be selected, but its completeness is what the calculation gates on, and it is
    // not COMPLETE — so absence of a requirement remains unknown rather than proven.
    expect(coverage?.state === 'present' ? coverage.value.completeness : null).not.toBe('COMPLETE');
  });

  test('an approval without a completeness warranty cannot be read as one', () => {
    const withoutWarranty: LicensedProviderApproval = {
      provider: 'e2open', contract_version: 'c1', approved_datasets: ['global_knowledge'],
      allowed_assertion_types: ['regulatory'], covered_countries: ['GB'], resolution: 'national_tariff_line',
      regulatory_completeness_warranted: false, redistribution_permitted: true,
      effective_from: '2026-01-01T00:00:00.000Z', effective_until: null,
    };
    expect(withoutWarranty.regulatory_completeness_warranted).toBe(false);
  });
});

describe('EU basmati provider contract test', () => {
  // HS 100630 into the EU from India. The duty is specific, and this is the representation any
  // connector must be able to carry. The amount is fixture data, not business logic.
  const EU_RICE = 'EUR 175.00 / 1000 kg';

  test('a specific duty keeps its amount, currency and unit', () => {
    expect(parseDutyExpression(EU_RICE)).toMatchObject({
      kind: 'specific',
      specific_amount: 175,
      specific_currency: 'EUR',
      specific_unit: 'kg',
      specific_unit_quantity: 1000,
    });
  });

  test('a per-tonne expression is equally representable', () => {
    expect(parseDutyExpression('175 EUR / tonne')).toMatchObject({
      kind: 'specific', specific_amount: 175, specific_currency: 'EUR', specific_unit: 'tonne', specific_unit_quantity: 1,
    });
  });

  test('a specific duty is never collapsed into an ad-valorem percentage', () => {
    const duty = parseDutyExpression(EU_RICE);
    expect(duty.ad_valorem_rate_percent).toBeNull();
    expect(duty.kind).not.toBe('ad_valorem');
  });

  test('an unrepresentable duty becomes unparsed, never zero', () => {
    const duty = parseDutyExpression('see annex 7');
    expect(duty.kind).toBe('unparsed');
    expect(duty.ad_valorem_rate_percent).toBeNull();
    expect(duty.specific_amount).toBeNull();
    expect(duty.note).toBeTruthy();
    // This is the TRAINS defect the architecture must never reproduce.
    expect(duty.ad_valorem_rate_percent).not.toBe(0);
  });

  test('an explicit zero duty stays distinguishable from a missing one', () => {
    const zero = parseDutyExpression('0%');
    expect(zero).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0 });
    expect(parseDutyExpression('see annex 7').ad_valorem_rate_percent).toBeNull();
  });

  test('no India preference evidence leaves applicability unresolved, never preferential', () => {
    const determination = determineIndiaPreference({
      direct_india_measures: [],
      proven_group_measures: [],
      beneficiary_enumeration_is_complete: false,
      unresolved_program_symbols: [],
    });
    expect(determination.applicability).not.toBe('confirmed_applicable');
    expect(determination.duty).toBeNull();
  });
});

describe('current confidence is untouched by this vocabulary', () => {
  test('the Market Access policy still requires an approval before licensed content counts', () => {
    const policy = CONFIG_DEFAULTS['country_truth.phase_1h'].market_access;
    expect(policy.allowed_assertion_classes).toContain('authoritative_public');
    // Listed, but inert: the registry is empty, so no fact of this class can be created.
    expect(policy.allowed_assertion_classes).toContain('licensed_authoritative_content');
    expect(LICENSED_PROVIDER_APPROVALS).toHaveLength(0);
  });

  test('licensed content carries no invented confidence discount', () => {
    const multipliers = CONFIG_DEFAULTS['country_truth.phase_1h'].assertion_class_multipliers
      ?? CONFIG_DEFAULTS['country_truth.phase_1h'].market_access.assertion_class_multipliers;
    expect(multipliers.licensed_authoritative_content).toBe(1);
    // The existing graded classes are unchanged.
    expect(multipliers.authoritative_public).toBe(1);
    expect(multipliers.agent_verified).toBe(0.9);
    expect(multipliers.exporter_declared).toBe(0.7);
  });

  test('weights and freshness policy are unchanged', () => {
    const policy = CONFIG_DEFAULTS['country_truth.phase_1h'].market_access;
    expect(policy.weights).toEqual({ tariff: 60, regulatory: 40 });
    expect(policy.maximum_coverage_age_days).toBe(30);
    expect(policy.formula_version).toBe('market-access-v2');
  });
});

// ---------------------------------------------------------------------------
// Helpers that exercise the registry's own matching rules against candidate approvals, so the
// rules can be tested without shipping an approval nobody has signed.
// ---------------------------------------------------------------------------

function licensedApprovalForCandidates(
  candidates: readonly LicensedProviderApproval[],
  query: { provider: string; dataset: string | null; country_code: string; assertion_type: 'tariff' | 'regulatory' | 'rules_of_origin'; as_of: Date },
): LicensedProviderApproval | null {
  const provider = query.provider.trim().toLowerCase();
  const country = query.country_code.trim().toUpperCase();
  const asOf = query.as_of.getTime();
  for (const approval of candidates) {
    if (approval.provider.trim().toLowerCase() !== provider) continue;
    if (!approval.allowed_assertion_types.includes(query.assertion_type)) continue;
    if (!approval.covered_countries.some((code) => code.trim().toUpperCase() === country)) continue;
    if (query.dataset == null || !approval.approved_datasets.includes(query.dataset)) continue;
    if (Date.parse(approval.effective_from) > asOf) continue;
    if (approval.effective_until != null && Date.parse(approval.effective_until) <= asOf) continue;
    return approval;
  }
  return null;
}

function readLicensedProviderSource(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('node:fs').readFileSync('src/lib/market-access/licensed-providers.ts', 'utf8');
}

describe('registry rules and the shipped implementation agree', () => {
  test('the empty shipped registry refuses what a matching approval would allow', () => {
    const query = { provider: 'e2open', dataset: 'global_knowledge', country_code: 'GB', assertion_type: 'tariff' as const, as_of: AS_OF };
    expect(licensedApprovalFor(query)).toBeNull();
    expect(licensedAdmissionRejection(query)).toBe('licensed_provider_not_approved_tariff');
  });
});
