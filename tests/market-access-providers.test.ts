import { randomUUID } from 'node:crypto';
import { EvidenceOrigin, OrgTier, UserRole } from '@prisma/client';
import { afterAll, describe, expect, test } from 'vitest';
import { persistMarketAccessIngest, type MarketAccessIngestResult } from '../src/lib/market-access/contract';
import { buildManualAuthoritativeMarketAccess } from '../src/lib/market-access/manual-authoritative';
import { UNCONFIGURED_MARKET_ACCESS_SOURCES, unconfiguredSourceForCountry } from '../src/lib/market-access/unconfigured-sources';
import { parseDutyExpression, resolveNationalTariffLine, type CandidateTariffLine } from '../src/lib/market-access/tariff-semantics';
import { CONFIG_DEFAULTS } from '../src/lib/config';
import { selectCountryTruthFacts } from '../src/lib/country-truth/fact-selection';
import { buildCountryTruthExporterFactSnapshot } from '../src/lib/country-truth/exporter-fact-snapshot';
import { selectApplicableIndiaTariff } from '../src/lib/country-truth/phase-1h-calculations';
import { prisma } from '../src/lib/prisma';

afterAll(() => prisma.$disconnect());

const candidate = (over: Partial<CandidateTariffLine> & { national_tariff_code: string }): CandidateTariffLine => ({
  description: 'Rice', declarable: true, general_duty: parseDutyExpression('121.00 GBP / 1000 kg'), control_codes: [], preference_area_ids: [], ...over,
});

function ingest(over: Partial<MarketAccessIngestResult> = {}): MarketAccessIngestResult {
  const resolution = resolveNationalTariffLine([candidate({ national_tariff_code: '1006302712' })]);
  return {
    jurisdiction: 'GB', country_code: 'GB', hs6: '100630', hs_revision: 'HS2022',
    provider: 'uk_trade_tariff', source_authority: 'HMRC test', source_dataset: 'UK Integrated Online Tariff',
    source_dataset_version: 'vnd.hmrc.2.0', source_reference: 'https://example.test/uk/100630',
    national_code_system: 'UK_COMMODITY', parser_version: 'uk-tariff-v2', retrieved_at: new Date('2026-08-30T00:00:00Z'),
    evidence_class: 'authoritative_public', recorded_by_id: null,
    resolution, general_duty: resolution.resolved_line!.general_duty,
    india_preference: { applicability: 'unknown', duty: null, geographic_area_id: null, basis: 'No India measure found.' },
    lines: [], requirements: [], regulatory_coverage_complete: true, raw_evidence: { test: true },
    ...over,
  };
}

describe('market access persistence', () => {
  test('a specific duty is stored verbatim and carries no invented percentage', async () => {
    const snapshot = await persistMarketAccessIngest(ingest());
    const tariff = snapshot.evidence.find((row) => row.rule_type === 'destination_tariff');
    expect(tariff).toBeTruthy();
    expect(tariff!.tariff_rate_percent).toBeNull();
    expect(tariff!.duty_expression).toBe('121.00 GBP / 1000 kg');
    expect(tariff!.duty_kind).toBe('specific');
    expect(tariff!.national_tariff_code).toBe('1006302712');
    expect(snapshot.classification_resolution).toBe('exact');
  });

  test('refinement required publishes no tariff determination at all', async () => {
    const resolution = resolveNationalTariffLine([
      candidate({ national_tariff_code: '1006301000', general_duty: parseDutyExpression('11.2%') }),
      candidate({ national_tariff_code: '1006309000', general_duty: parseDutyExpression('1.4c/kg') }),
    ]);
    const snapshot = await persistMarketAccessIngest(ingest({ resolution, general_duty: null }));
    expect(snapshot.classification_resolution).toBe('classification_refinement_required');
    expect(snapshot.tariff_coverage).toBe(false);
    // No destination_tariff row exists, so the calculator has nothing to mistake for a rate.
    expect(snapshot.evidence.filter((row) => row.rule_type === 'destination_tariff')).toHaveLength(0);
    // Both candidates are retained for whoever has to make the classification decision.
    const detail = snapshot.resolution_detail as { declarable_candidates: Array<{ code: string }> };
    expect(detail.declarable_candidates.map((line) => line.code).sort()).toEqual(['1006301000', '1006309000']);
  });

  test('an unresolved preference is recorded needs_review with its explicit applicability', async () => {
    const snapshot = await persistMarketAccessIngest(ingest({
      india_preference: { applicability: 'potentially_applicable_requires_origin_proof', duty: parseDutyExpression('0.00 %'), geographic_area_id: 'IN', basis: 'Quota, not an unconditional rate.' },
    }));
    const preference = snapshot.evidence.find((row) => row.rule_type === 'preferential_tariff_india')!;
    expect(preference.status).toBe('needs_review');
    expect(preference.preference_applicability).toBe('potentially_applicable_requires_origin_proof');
    // A 0% preference that still needs origin proof must NOT be published as the applied rate.
    expect(preference.tariff_rate_percent).toBeNull();
    expect(preference.verification_grade).toBe('discovery_grade');
  });

  test('a requirement is only asserted for the product once a line is established', async () => {
    const requirement = { rule_type: 'mandatory_certification' as const, requirement_code: 'N853', requirement_description: 'Phytosanitary certificate', requirement_obtainable: null, national_tariff_code: '1006302712', effective_from: null, effective_to: null, source_reference: 'ref', raw: {} };
    const resolved = await persistMarketAccessIngest(ingest({ requirements: [requirement] }));
    const admissible = resolved.evidence.find((row) => row.rule_type === 'mandatory_certification')!;
    // Scoped to the product's HS6 so fact selection can actually admit it, with the national
    // line it came from retained.
    expect(admissible.hs_code_scope).toBe('100630');
    expect(admissible.national_tariff_code).toBe('1006302712');

    const unresolved = await persistMarketAccessIngest(ingest({
      requirements: [requirement],
      resolution: resolveNationalTariffLine([
        candidate({ national_tariff_code: '1006301000', general_duty: parseDutyExpression('11.2%') }),
        candidate({ national_tariff_code: '1006309000', general_duty: parseDutyExpression('1.4c/kg') }),
      ]),
      general_duty: null,
    }));
    // No line established: the requirement stays at national scope and the snapshot is PARTIAL,
    // so an absent requirement reads as unknown rather than as "no restrictions".
    expect(unresolved.evidence.find((row) => row.rule_type === 'mandatory_certification')!.hs_code_scope).toBe('1006302712');
    expect(unresolved.completeness_status).toBe('PARTIAL');
  });

  test('execution grade requires a resolved line, complete coverage and a settled preference', async () => {
    const discovery = await persistMarketAccessIngest(ingest({ regulatory_coverage_complete: false }));
    expect(discovery.evidence.every((row) => row.verification_grade === 'discovery_grade')).toBe(true);

    const execution = await persistMarketAccessIngest(ingest({
      regulatory_coverage_complete: true,
      india_preference: { applicability: 'not_applicable', duty: null, geographic_area_id: null, basis: 'Beneficiary list is complete and excludes India.' },
    }));
    expect(execution.evidence.every((row) => row.verification_grade === 'execution_grade')).toBe(true);
  });
});

describe('authoritative manual capture', () => {
  async function reviewer(role: UserRole = UserRole.agent) {
    const marker = `manual-${randomUUID()}`;
    await prisma.exporterOrg.create({ data: { display_name: marker, tier: OrgTier.paid } });
    return prisma.user.create({ data: { email: `${marker}@example.test`, name: 'Reviewer', role } });
  }
  const base = (userId: string) => ({
    country_code: 'SA', jurisdiction: 'SA', hs6: '100630', hs_revision: 'HS2022',
    source_authority: 'ZATCA — Saudi Integrated Customs Tariff', source_reference: 'https://zatca.gov.sa/tariff/100630301000',
    source_dataset: 'Saudi Integrated Customs Tariff', national_code_system: 'GCC_INTEGRATED' as const,
    retrieved_at: new Date('2026-08-30T00:00:00Z'), reviewer_user_id: userId,
    beneficiary_enumeration_is_complete: false, regulatory_coverage_complete: false,
    lines: [{ national_tariff_code: '100630301000', description: 'Basmati rice', duty_expression: '0 %', effective_from: '2026-01-01' }],
  });

  test('files as agent_verified, never as a government response', async () => {
    const user = await reviewer();
    const result = await buildManualAuthoritativeMarketAccess(base(user.id));
    expect(result.evidence_class).toBe('agent_verified');
    expect(result.recorded_by_id).toBe(user.id);
    const snapshot = await persistMarketAccessIngest(result);
    expect(snapshot.evidence_origin).toBe(EvidenceOrigin.manually_entered_real);
    expect(snapshot.provider).toBe('authoritative_manual');
    // An automated public response would have been public_real; the two never collapse.
    expect(snapshot.evidence_origin).not.toBe(EvidenceOrigin.public_real);
  });

  test('refuses an HS6 echoed back as the national tariff line', async () => {
    const user = await reviewer();
    await expect(buildManualAuthoritativeMarketAccess({ ...base(user.id), lines: [{ national_tariff_code: '100630', description: 'Rice', duty_expression: '0 %', effective_from: '2026-01-01' }] }))
      .rejects.toMatchObject({ fields: [expect.objectContaining({ code: 'invalid' })] });
  });

  test('refuses a line outside the requested HS6, a missing citation and a non-reviewer', async () => {
    const user = await reviewer();
    await expect(buildManualAuthoritativeMarketAccess({ ...base(user.id), lines: [{ national_tariff_code: '100640101000', description: 'Other', duty_expression: '0 %', effective_from: '2026-01-01' }] })).rejects.toBeTruthy();
    await expect(buildManualAuthoritativeMarketAccess({ ...base(user.id), source_reference: '  ' })).rejects.toBeTruthy();
    const exporter = await reviewer(UserRole.exporter_owner);
    await expect(buildManualAuthoritativeMarketAccess(base(exporter.id))).rejects.toMatchObject({ fields: [expect.objectContaining({ code: 'forbidden' })] });
  });
});

describe('unconfigured authoritative sources', () => {
  test('EU, Saudi and WTO each carry an explicit determination rather than silence', () => {
    expect(unconfiguredSourceForCountry('DE')?.jurisdiction).toBe('EU');
    // Germany applies the EU tariff; there is no German national schedule to build separately.
    expect(unconfiguredSourceForCountry('DE')?.authority).toMatch(/TARIC/);
    expect(unconfiguredSourceForCountry('SA')?.reason).toBe('no_documented_machine_interface');
    expect(UNCONFIGURED_MARKET_ACCESS_SOURCES.WTO!.reason).toBe('license_pending');
    // WTO licensing is not treated as approved anywhere.
    expect(UNCONFIGURED_MARKET_ACCESS_SOURCES.WTO!.determination).toMatch(/No approval is recorded/);
    expect(unconfiguredSourceForCountry('GB')).toBeNull();
    expect(unconfiguredSourceForCountry('US')).toBeNull();
  });
});

describe('preference applicability reaches the calculator fail-closed', () => {
  const scope = { exporter_org_id: 'org', origin_country_code: 'IN', country_code: 'GB', hs6: '100630', hs_revision: 'HS2022', as_of_date: '2026-08-30T00:00:00.000Z' };
  const stamp = new Date('2026-08-01T00:00:00Z');
  // A real frozen exporter snapshot: the exporter facts are all absent, which is the true state
  // for this canary and keeps the test about tariff applicability alone.
  const exporterSnapshot = buildCountryTruthExporterFactSnapshot({
    exporter_org: { id: 'org', country: 'IN', state: null, city: null, pickup_location_code: null, preferred_origin_gateway: null, updated_at: stamp },
    product: { id: 'product', exporter_org_id: 'org', updated_at: stamp, evidence_origin: 'manually_entered_real', hs_code: '100630', hs_nomenclature_version: 'HS2022', hs_classification_revision: 1, hs_classification_status: 'confirmed', price_target_amount: null, price_target_currency: null, price_target_quantity_unit: null, price_target_incoterm: null, capacity_value: null, capacity_unit: null, moq_value: null, moq_unit: null, lead_time_days: null, delivery_commitment_days: null, logistics_constraint_codes: [], logistics_constraints_confirmed: false, desired_order_size_amount: null, desired_order_size_currency: null, customization_capability: null, packaging_capability: null, packaging: null },
    certifications: [],
    classification: { id: 'classification', product_id: 'product', revision: 1, hs6_code: '100630', nomenclature_version: 'HS2022', status: 'confirmed', confirmed_by_id: 'user', confirmed_at: stamp, evidence_refs: [] },
    captured_at: stamp,
  } as never).snapshot;
  const evidenceRow = (applicability: string, rate: number | null) => ({
    id: `row-${applicability}`, snapshot_id: 'snap', country_code: 'GB', hs_code_scope: '100630',
    rule_type: 'preferential_tariff_india', source_authority: 'HMRC', source_reference: 'ref',
    retrieved_at: new Date('2026-08-29T00:00:00Z'), effective_at: new Date('2026-01-01T00:00:00Z'), expires_at: null,
    superseded_at: null, status: 'needs_review', confidence: 1, evidence_origin: 'public_real',
    tariff_rate_percent: rate, preference_applicability: applicability, preference_basis: 'test',
    duty_expression: '0.00 %', duty_kind: 'ad_valorem', national_tariff_code: '1006302712', verification_grade: 'discovery_grade',
    requirement_code: null, requirement_description: null, requirement_obtainable: null,
  });

  const select = (applicability: string, rate: number | null) => selectCountryTruthFacts({
    scope,
    exporter_snapshot: exporterSnapshot,
    evidence: { market_access_snapshots: [], market_access_evidence: [evidenceRow(applicability, rate)], fit_benchmarks: [], logistics_routes: [], exchange_rate_quotes: [] } as never,
  } as never);

  test('a 0% preference awaiting origin proof never becomes the applied rate', () => {
    const facts = select('potentially_applicable_requires_origin_proof', 0);
    const result = selectApplicableIndiaTariff(scope, facts.market_access.tariffs, CONFIG_DEFAULTS['country_truth.phase_1h'].market_access.tariff_policy);
    expect(result.status).toBe('unavailable');
    expect(result.rate_percent).toBeNull();
    expect(result.reasons.join(' ')).toMatch(/unknown|unavailable/i);
  });

  test('a confirmed applicable preference is used', () => {
    const facts = select('confirmed_applicable', 0);
    const result = selectApplicableIndiaTariff(scope, facts.market_access.tariffs, CONFIG_DEFAULTS['country_truth.phase_1h'].market_access.tariff_policy);
    expect(result).toMatchObject({ status: 'available', rate_percent: 0, tariff_basis: 'india_preference' });
  });
});
