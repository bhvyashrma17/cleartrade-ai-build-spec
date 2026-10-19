import { randomUUID } from 'node:crypto';
import { AuthorityReleaseChange, EvidenceOrigin, OrgTier, UserRole } from '@prisma/client';
import { afterAll, describe, expect, test } from 'vitest';
import { persistMarketAccessIngest, type MarketAccessIngestResult, type MarketAccessLineRecord, type MarketAccessRequirementRecord } from '../src/lib/market-access/contract';
import { buildManualAuthoritativeMarketAccess } from '../src/lib/market-access/manual-authoritative';
import { UNCONFIGURED_MARKET_ACCESS_SOURCES, unconfiguredSourceForCountry } from '../src/lib/market-access/unconfigured-sources';
import { DESTINATION_ADAPTERS, runMarketAccessIngest } from '../src/lib/job-handlers/market-access';
import { isEuTaricDestination } from '../src/lib/market-access/taric/service';
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
  test('one release/request/parser identity is idempotent and a reparse appends immutable evidence', async () => {
    const marker = randomUUID();
    const admin = await prisma.user.create({ data: { email: `authority-${marker}@example.test`, name: 'Authority importer', role: UserRole.admin } });
    const release = await prisma.authorityRelease.create({ data: {
      label: `CBSA ${marker}`, source_family: 'CA_CBSA', authority: 'Canada Border Services Agency (CBSA)',
      destination_scope: ['CA'], source_url: 'https://www.cbsa-asfc.gc.ca/test', release_identifier: `T-${marker}`,
      reference_date: new Date('2026-09-01T00:00:00Z'), source_distribution: 'test retained authority release',
      retrieved_at: new Date('2026-09-02T00:00:00Z'), source_format: 'zip+accdb+html', checksum: marker.replaceAll('-', '').padEnd(64, 'a').slice(0, 64),
      size_bytes: 10, artifact_object_key: `test/${marker}`, file_manifest: [], reader_version: 'reader-v1', parser_version: 'parser-v1',
      validation: { fixture: true }, change_classification: AuthorityReleaseChange.NEW_RELEASE, change_basis: { fixture: true }, imported_by_id: admin.id,
    } });
    const v1 = ingest({
      jurisdiction: 'CA', country_code: 'CA', national_code_system: 'CA_CUSTOMS_TARIFF', provider: 'canada_cbsa_customs_tariff',
      source_dataset_version: release.release_identifier, source_release_id: release.id, request_identity: 'origin=IN;as_of=2026-09-02', parser_version: 'parser-v1',
    });
    const first = await persistMarketAccessIngest(v1);
    const repeat = await persistMarketAccessIngest(v1);
    expect(repeat.id).toBe(first.id);
    expect(await prisma.marketAccessEvidenceSnapshot.count({ where: { authority_release_id: release.id } })).toBe(1);

    const reparsed = await persistMarketAccessIngest({ ...v1, parser_version: 'parser-v2' });
    expect(reparsed.id).not.toBe(first.id);
    expect(await prisma.marketAccessEvidenceSnapshot.count({ where: { authority_release_id: release.id } })).toBe(2);
    const changedRelease = await prisma.authorityRelease.create({ data: {
      label: `${release.label} changed`, source_family: release.source_family, authority: release.authority,
      destination_scope: release.destination_scope as never, source_url: release.source_url, release_identifier: release.release_identifier,
      reference_date: release.reference_date, source_distribution: release.source_distribution, retrieved_at: new Date('2026-09-02T01:00:00Z'),
      source_format: release.source_format, checksum: 'b'.repeat(64), size_bytes: 11, artifact_object_key: `test/${marker}-changed`,
      file_manifest: [], reader_version: release.reader_version, parser_version: release.parser_version, validation: { fixture: true },
      change_classification: AuthorityReleaseChange.CHANGED, change_basis: { previous: release.id }, previous_release_id: release.id, imported_by_id: admin.id,
    } });
    const changedSnapshot = await persistMarketAccessIngest({ ...v1, source_release_id: changedRelease.id });
    expect(changedSnapshot.id).not.toBe(first.id);
    await expect(prisma.marketAccessEvidenceSnapshot.update({ where: { id: first.id }, data: { parser_version: 'rewritten' } })).rejects.toThrow(/immutable/i);
  });

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

/**
 * Regression fixture approximating the live UK HS 1006.30 shape that made `persistMarketAccessIngest`
 * exceed Prisma's 5s default interactive-transaction timeout: 100 declarable candidates fanning out
 * into thousands of tariff-line rows and hundreds of evidence rows (the real ingest: 108 candidates,
 * ~7,221 lines, ~326 evidence rows). Proves the write path stays correct at that volume, not just fast.
 */
describe('high-fanout persistence (live-shape regression)', () => {
  const CANDIDATE_COUNT = 100;
  const LINES_PER_CANDIDATE = 20;
  const REQUIREMENT_COUNT = 300;
  const MEASURE_KINDS = ['third_country_duty', 'tariff_preference', 'tariff_quota', 'additional_duty', 'vat', 'other'] as const;

  function highFanoutCodes(): string[] {
    return Array.from({ length: CANDIDATE_COUNT }, (_, i) => `10063${String(10000 + i)}`);
  }

  function linesFor(code: string): MarketAccessLineRecord[] {
    return Array.from({ length: LINES_PER_CANDIDATE }, (_, i) => ({
      national_tariff_code: code, description: `Measure ${i} for ${code}`, declarable: true,
      measure_kind: MEASURE_KINDS[i % MEASURE_KINDS.length]!,
      origin_geographic_area_id: i % 3 === 0 ? '1013' : null,
      origin_scope: i % 3 === 0 ? 'group' : 'erga_omnes',
      applies_to_origin_country: null,
      duty: parseDutyExpression('121.00 GBP / 1000 kg'),
      conditions: {}, effective_from: null, effective_to: null,
      source_reference: 'https://example.test/uk/100630', raw_measure: { i },
    }));
  }

  function requirementsFor(codes: string[]): MarketAccessRequirementRecord[] {
    return Array.from({ length: REQUIREMENT_COUNT }, (_, i) => ({
      rule_type: 'mandatory_certification', requirement_code: `REQ-${i}`, requirement_description: `Requirement ${i}`,
      requirement_obtainable: null, national_tariff_code: codes[i % codes.length]!,
      effective_from: null, effective_to: null, source_reference: 'https://example.test/uk/100630', raw: { i },
    }));
  }

  function highFanoutIngest(codes: string[], over: Partial<MarketAccessIngestResult> = {}): MarketAccessIngestResult {
    const candidates = codes.map((code, i) => candidate({
      national_tariff_code: code,
      general_duty: parseDutyExpression(i % 2 === 0 ? '121.00 GBP / 1000 kg' : '145.00 GBP / 1000 kg'),
    }));
    const resolution = resolveNationalTariffLine(candidates);
    return ingest({
      resolution, general_duty: null, regulatory_coverage_complete: true,
      lines: codes.flatMap(linesFor), requirements: requirementsFor(codes),
      ...over,
    });
  }

  test('a live-UK-shaped ingest persists every row exactly once with no duplicate candidates', async () => {
    const codes = highFanoutCodes();
    const runId = `high-fanout-${randomUUID()}`;
    const snapshot = await persistMarketAccessIngest(highFanoutIngest(codes), { source_run_id: runId });

    // A 100-candidate spread with differing duties is exactly the live UK case: no single line can
    // be stated, so refinement is required and no destination_tariff row is published.
    expect(snapshot.classification_resolution).toBe('classification_refinement_required');
    expect(snapshot.candidate_line_count).toBe(CANDIDATE_COUNT);
    expect(snapshot.tariff_lines).toHaveLength(CANDIDATE_COUNT * LINES_PER_CANDIDATE);
    expect(snapshot.evidence).toHaveLength(REQUIREMENT_COUNT + 1); // + the one India-preference row

    // Independently confirmed against the database, not just the object the function returned.
    const [lineCount, evidenceCount] = await Promise.all([
      prisma.marketAccessTariffLine.count({ where: { snapshot_id: snapshot.id } }),
      prisma.marketAccessEvidence.count({ where: { snapshot_id: snapshot.id } }),
    ]);
    expect(lineCount).toBe(CANDIDATE_COUNT * LINES_PER_CANDIDATE);
    expect(evidenceCount).toBe(REQUIREMENT_COUNT + 1);

    // Every declared candidate survives the bulk write exactly once — this is the fingerprint
    // `recordClassificationRefinement` later validates a refinement's candidates against.
    const detail = snapshot.resolution_detail as { declarable_candidates: Array<{ code: string }> };
    const persistedCodes = detail.declarable_candidates.map((line) => line.code);
    expect(persistedCodes).toHaveLength(CANDIDATE_COUNT);
    expect(new Set(persistedCodes).size).toBe(CANDIDATE_COUNT);
    expect(persistedCodes.slice().sort()).toEqual(codes.slice().sort());
  });

  test('an injected mid-transaction failure leaves zero rows, and a corrected retry persists cleanly without duplication', async () => {
    const codes = highFanoutCodes();
    const runId = `high-fanout-rollback-${randomUUID()}`;
    const validRequirements = requirementsFor(codes);
    const broken = highFanoutIngest(codes, {
      // Not a real MarketAccessRuleType. The Prisma client rejects it deep inside
      // evidence.createMany — AFTER all `CANDIDATE_COUNT * LINES_PER_CANDIDATE` tariff-line rows
      // have already been written (uncommitted) earlier in the same transaction — so this proves
      // a later failure rolls back writes an earlier statement in the same transaction made.
      requirements: [...validRequirements.slice(0, -1), { ...validRequirements.at(-1)!, rule_type: 'not_a_real_rule_type' } as unknown as MarketAccessRequirementRecord],
    });

    const before = await Promise.all([
      prisma.marketAccessEvidenceSnapshot.count(),
      prisma.marketAccessTariffLine.count(),
      prisma.marketAccessEvidence.count(),
    ]);
    await expect(persistMarketAccessIngest(broken, { source_run_id: runId })).rejects.toThrow();
    const after = await Promise.all([
      prisma.marketAccessEvidenceSnapshot.count(),
      prisma.marketAccessTariffLine.count(),
      prisma.marketAccessEvidence.count(),
    ]);
    // Nothing from the failed attempt survived: not the snapshot, not one of the ~2,000 tariff-line
    // rows, not one evidence row. Postgres rolled back the whole write, not just the failed statement.
    expect(after).toEqual(before);
    expect(await prisma.marketAccessEvidenceSnapshot.findFirst({ where: { source_run_id: runId } })).toBeNull();

    // A retry with corrected data (same source_run_id, as a job retry would resubmit) succeeds and
    // produces exactly one clean copy — the rolled-back attempt left nothing behind to duplicate.
    const snapshot = await persistMarketAccessIngest(highFanoutIngest(codes), { source_run_id: runId });
    expect(snapshot.tariff_lines).toHaveLength(CANDIDATE_COUNT * LINES_PER_CANDIDATE);
    expect(snapshot.evidence).toHaveLength(REQUIREMENT_COUNT + 1);
    expect(await prisma.marketAccessEvidence.count({ where: { snapshot_id: snapshot.id } })).toBe(REQUIREMENT_COUNT + 1);
    expect(await prisma.marketAccessEvidenceSnapshot.count({ where: { source_run_id: runId } })).toBe(1);
  });

  test('a small US-style ingest still behaves unchanged next to the high-fanout write path', async () => {
    const resolution = resolveNationalTariffLine([
      candidate({ national_tariff_code: '10063010', general_duty: parseDutyExpression('11.2%') }),
      candidate({ national_tariff_code: '10063090', general_duty: parseDutyExpression('1.4c/kg'), declarable: false }),
    ]);
    const snapshot = await persistMarketAccessIngest(ingest({
      country_code: 'US', jurisdiction: 'US', national_code_system: 'US_HTS', provider: 'us_hts',
      resolution, general_duty: resolution.resolved_line!.general_duty,
    }));
    expect(snapshot.classification_resolution).toBe('exact');
    expect(snapshot.candidate_line_count).toBe(2);
    expect(snapshot.tariff_lines).toHaveLength(0);
    expect(snapshot.evidence.find((row) => row.rule_type === 'destination_tariff')).toMatchObject({ national_tariff_code: '10063010', duty_expression: '11.2%' });
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
  test('EU is no longer unconfigured — it has an authoritative TARIC provider', () => {
    // Phase 1 final: the Commission's official monthly extraction is machine-read, so EU member
    // states must NOT fall through to the unconfigured/manual path any more.
    for (const member of ['DE', 'FR', 'NL', 'IT', 'ES']) {
      expect(unconfiguredSourceForCountry(member)).toBeNull();
      expect(isEuTaricDestination(member)).toBe(true);
    }
    // A destination outside both EU members and proved associated customs territories must never
    // be served EU TARIC evidence.
    for (const outside of ['GB', 'US', 'SA', 'IN', 'CH', 'NO']) {
      expect(isEuTaricDestination(outside)).toBe(false);
    }
    for (const associated of ['AX', 'MC']) expect(isEuTaricDestination(associated)).toBe(true);
  });

  test('Saudi is activated while WTO retains its explicit licensing determination', () => {
    expect(unconfiguredSourceForCountry('SA')).toBeNull();
    expect(DESTINATION_ADAPTERS.SA?.provider_key).toBe('sa_zatca_integrated_tariff');
    expect(UNCONFIGURED_MARKET_ACCESS_SOURCES.WTO!.reason).toBe('license_pending');
    // WTO licensing is not treated as approved anywhere.
    expect(UNCONFIGURED_MARKET_ACCESS_SOURCES.WTO!.determination).toMatch(/No approval is recorded/);
    expect(unconfiguredSourceForCountry('GB')).toBeNull();
    expect(unconfiguredSourceForCountry('US')).toBeNull();
  });

  test('audited Peru-wave blockers cite the controlling reuse or official-text source', () => {
    const expectedControllingReferences: Record<string, RegExp> = {
      UY: /licencia-datos-abiertos-uruguay/,
      NG: /wipolex\/en\/legislation\/details\/21820/,
      JM: /laws\.moj\.gov\.jm\/legislation\/statutes\/C\/The%20Copyright%20Act\.pdf/,
      PA: /wipolex\/en\/legislation\/details\/15426/,
      DO: /wipolex\/en\/legislation\/details\/1191/,
      MK: /wipolex\/en\/legislation\/details\/10641/,
      TT: /wipolex\/en\/legislation\/details\/6639/,
    };
    for (const [country, controllingReference] of Object.entries(expectedControllingReferences)) {
      const source = unconfiguredSourceForCountry(country);
      expect(source, country).not.toBeNull();
      expect(source!.references.some((reference) => controllingReference.test(reference)), country).toBe(true);
    }

    const jamaica = unconfiguredSourceForCountry('JM')!;
    expect(jamaica.reason).toBe('license_pending');
    expect(jamaica.determination).toMatch(/official consolidated Copyright Act published by Jamaica's Ministry of Justice/);
    expect(jamaica.determination).toMatch(/section 13B[\s\S]*non-commercial/);

    const dominicanRepublic = unconfiguredSourceForCountry('DO')!;
    expect(dominicanRepublic.reason).toBe('source_insufficient');
    expect(dominicanRepublic.references[0]).toMatch(/^https:\/\/onda\.gob\.do\//);
    expect(dominicanRepublic.determination).toMatch(/WIPO Lex explicitly marks[\s\S]*unconsolidated/);
    expect(dominicanRepublic.determination).toMatch(/neither copy is represented here as definitive current consolidated law/);
  });

  test('Mega-Wave C blockers remain precise for the 17 destinations not since activated', () => {
    const expectedReasons = {
      MY: 'license_pending',
      HK: 'license_pending', TR: 'source_insufficient',
      CH: 'source_insufficient', RS: 'individual_investigation_required',
      BA: 'source_insufficient', MD: 'source_insufficient', XK: 'individual_investigation_required',
      CL: 'license_pending', MX: 'source_insufficient', ZA: 'license_pending',
      KE: 'source_insufficient',
      EG: 'no_documented_machine_interface', JO: 'no_documented_machine_interface',
      BH: 'bulk_distribution_only',
    } as const;

    for (const [country, reason] of Object.entries(expectedReasons)) {
      const source = unconfiguredSourceForCountry(country);
      expect(source, country).not.toBeNull();
      expect(source!.country_codes, country).toContain(country);
      expect(source!.reason, country).toBe(reason);
      expect(source!.authority.trim().length, country).toBeGreaterThan(20);
      expect(source!.determination.trim().length, country).toBeGreaterThan(100);
      expect(source!.references.length, country).toBeGreaterThan(0);
      expect(source!.references.every((reference) => reference.startsWith('https://')), country).toBe(true);
      expect(source!.unblocked_by.trim().length, country).toBeGreaterThan(40);
      // D-028: Kenya's national source stays researched; its duty is read from the EAC common tariff.
      if (country === 'KE') expect(DESTINATION_ADAPTERS.KE?.provider_key, country).toBe('eac_common_external_tariff');
      else expect(DESTINATION_ADAPTERS[country], country).toBeUndefined();
    }

    // Oman is now activated and should no longer be unconfigured
    expect(unconfiguredSourceForCountry('OM')).toBeNull();
    expect(DESTINATION_ADAPTERS.OM?.provider_key).toBe('om_rop_customs_tariff');
  });

  test('remaining Mega-Wave C blockers complete independently and never emit zero or market evidence', async () => {
    // KE left with D-028: its ingest reads the EAC common external tariff.
    const countries = ['MY', 'HK', 'TR', 'CH', 'RS', 'BA', 'MD', 'XK', 'CL', 'MX', 'ZA', 'EG', 'JO', 'BH'];
    const outcomes = await Promise.all(countries.map((country) => runMarketAccessIngest({
      job_id: `mega-wave-c-${country}`,
      payload: { country_code: country, hs_code: '100630', origin_country: 'IN' },
    } as never)));

    expect(outcomes).toHaveLength(14);
    for (const [index, outcome] of outcomes.entries()) {
      const result = outcome.result as Record<string, unknown>;
      expect(outcome.status, countries[index]).toBe('completed');
      expect(result.country_code, countries[index]).toBe(countries[index]);
      expect(result.snapshot_id, countries[index]).toBeNull();
      expect(result.provider_state, countries[index]).toBe('provider_unconfigured_or_license_pending');
      expect(result.next_step, countries[index]).toBe('authoritative_manual_capture');
      expect(result.reason, countries[index]).toBeTruthy();
      expect(result.authority, countries[index]).toBeTruthy();
      expect(result.references, countries[index]).toBeTruthy();
      expect(result, countries[index]).not.toHaveProperty('general_duty_expression');
      expect(result, countries[index]).not.toHaveProperty('tariff_rate_percent');
      expect(result, countries[index]).not.toHaveProperty('evidence_count');
    }
  });

  test('Mega-Wave D source gate retains precise fail-closed reasons for destinations not activated later', () => {
    const expectedReasons = {
      // SG left this list with D-029: it is read from the copy saved nightly in the SSO window.
      CN: 'individual_investigation_required',
TH: 'individual_investigation_required', BN: 'individual_investigation_required',
      KH: 'source_insufficient', LA: 'no_documented_machine_interface', MN: 'no_documented_machine_interface',
      AE: 'individual_investigation_required',
      LB: 'no_documented_machine_interface', BR: 'credential_not_provisioned',
      EC: 'no_documented_machine_interface', BO: 'individual_investigation_required', GT: 'no_documented_machine_interface',
      SV: 'individual_investigation_required', HN: 'no_documented_machine_interface', NI: 'no_documented_machine_interface',
      BZ: 'source_insufficient', GH: 'no_documented_machine_interface', CI: 'source_insufficient', SN: 'source_insufficient',
      TZ: 'individual_investigation_required', UG: 'individual_investigation_required', RW: 'individual_investigation_required',
      ZM: 'individual_investigation_required', BW: 'individual_investigation_required', NA: 'individual_investigation_required',
    } as const;

    expect(Object.keys(expectedReasons)).toHaveLength(25);
    for (const [country, reason] of Object.entries(expectedReasons)) {
      const source = unconfiguredSourceForCountry(country);
      expect(source, country).not.toBeNull();
      expect(source!.country_codes, country).toContain(country);
      expect(source!.reason, country).toBe(reason);
      expect(source!.authority.trim().length, country).toBeGreaterThan(20);
      expect(source!.determination.trim().length, country).toBeGreaterThan(100);
      expect(source!.references.length, country).toBeGreaterThan(0);
      expect(source!.references.every((reference) => reference.startsWith('https://')), country).toBe(true);
      expect(source!.unblocked_by.trim().length, country).toBeGreaterThan(40);
      // D-028: these members' national sources stay researched; their duty is read from their union's common tariff.
      const union = ({ GH: 'ecowas_cet_uemoa_tec_2022', CI: 'ecowas_cet_uemoa_tec_2022', SN: 'ecowas_cet_uemoa_tec_2022', TZ: 'eac_common_external_tariff', UG: 'eac_common_external_tariff', RW: 'eac_common_external_tariff' } as Record<string, string>)[country];
      if (union) expect(DESTINATION_ADAPTERS[country]?.provider_key, country).toBe(union);
      else expect(DESTINATION_ADAPTERS[country], country).toBeUndefined();
    }
  });

  test('Mega-Wave D blockers complete independently without tariff evidence or invented zeroes', async () => {
    // GH, CI, SN, TZ, UG and RW left with D-028: their ingest reads their union's common external tariff.
    const countries = ['CN', 'TH', 'BN', 'KH', 'LA', 'MN', 'AE', 'LB', 'BR', 'EC', 'BO', 'GT', 'SV', 'HN', 'NI', 'BZ', 'ZM', 'BW', 'NA'];
    const outcomes = await Promise.all(countries.map((country) => runMarketAccessIngest({
      job_id: `mega-wave-d-${country}`,
      payload: { country_code: country, hs_code: '100630', origin_country: 'IN' },
    } as never)));

    expect(outcomes).toHaveLength(19);
    for (const [index, outcome] of outcomes.entries()) {
      const result = outcome.result as Record<string, unknown>;
      expect(outcome.status, countries[index]).toBe('completed');
      expect(result.country_code, countries[index]).toBe(countries[index]);
      expect(result.snapshot_id, countries[index]).toBeNull();
      expect(result.provider_state, countries[index]).toBe('provider_unconfigured_or_license_pending');
      expect(result.next_step, countries[index]).toBe('authoritative_manual_capture');
      expect(result.reason, countries[index]).toBeTruthy();
      expect(result.authority, countries[index]).toBeTruthy();
      expect(result.references, countries[index]).toBeTruthy();
      expect(result, countries[index]).not.toHaveProperty('general_duty_expression');
      expect(result, countries[index]).not.toHaveProperty('tariff_rate_percent');
      expect(result, countries[index]).not.toHaveProperty('evidence_count');
    }
  });

  test('dual-lane access-queue destinations are explicit and fail closed', async () => {
    const expectedReasons = {
      JO: 'no_documented_machine_interface', LB: 'no_documented_machine_interface',
      GH: 'no_documented_machine_interface',
      EC: 'no_documented_machine_interface',
      MV: 'no_documented_machine_interface',
    } as const;

    for (const [country, reason] of Object.entries(expectedReasons)) {
      const source = unconfiguredSourceForCountry(country);
      expect(source, country).not.toBeNull();
      expect(source!.reason, country).toBe(reason);
      expect(source!.references.length, country).toBeGreaterThan(0);
      expect(source!.unblocked_by.trim().length, country).toBeGreaterThan(40);
      // D-028: Ghana's own tariff stays researched; its duty is read from the ECOWAS common tariff.
      if (country === 'GH') expect(DESTINATION_ADAPTERS.GH?.provider_key, country).toBe('ecowas_cet_uemoa_tec_2022');
      else expect(DESTINATION_ADAPTERS[country], country).toBeUndefined();
    }

    for (const country of ['MV']) {
      const outcome = await runMarketAccessIngest({
        job_id: `dual-lane-${country}`,
        payload: { country_code: country, hs_code: '100630', origin_country: 'IN' },
      } as never);
      expect(outcome.status, country).toBe('completed');
      expect(outcome.result, country).toMatchObject({
        country_code: country,
        snapshot_id: null,
        provider_state: 'provider_unconfigured_or_license_pending',
        next_step: 'authoritative_manual_capture',
      });
      expect(outcome.result, country).not.toHaveProperty('tariff_rate_percent');
    }
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
