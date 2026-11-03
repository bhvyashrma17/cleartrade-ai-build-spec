import { createHash, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { AuthorityReleaseStatus, OrgTier, UserRole } from '@prisma/client';
import { acquireTariffEvidence } from '@/lib/country-truth/tariff-acquisition';
import { DEMAND_DISCOVERY_V5_DEFAULT_POLICY as POLICY } from '@/lib/demand-discovery-v5/policy';
import { metricSentence } from '@/lib/demand-discovery-v5/explain';
import { scoreDuty } from '@/lib/demand-discovery-v5/metrics';
import { DESTINATION_ADAPTERS } from '@/lib/job-handlers/market-access';
import { buildCustomsUnionBundle, readCustomsUnionBundle } from '@/lib/market-access/providers/customs-union-bundle';
import { importCustomsUnionRelease, fetchCustomsUnionMarketAccess, setCustomsUnionSourceForTesting, __test__ as unionService } from '@/lib/market-access/providers/customs-union-service';
import { CUSTOMS_UNION_SOURCES, customsUnionSourceFor, type CustomsUnionLine, type CustomsUnionSource } from '@/lib/market-access/providers/customs-union-sources';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';

/**
 * D-028: a customs union's common external tariff serves its members from one retained release.
 * A fixture release (two small "official" files and four lines, pinned like the real ones) goes
 * through the real bundle, import, activation and market-access code; the real releases' pins and
 * membership are checked as configuration.
 */
const MARKER = `union-${randomUUID()}`;
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const TARIFF = Buffer.from(`%PDF-fixture common external tariff ${MARKER}`);
const GAZETTE = Buffer.from(`%PDF-fixture gazette ${MARKER}`);
const duty = (rate: number) => ({ kind: 'ad_valorem' as const, ad_valorem_rate_percent: rate, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null, expression: `${rate}%`, note: null });
const LINES: CustomsUnionLine[] = [
  { code: '10063000', description: 'Semi-milled rice', unit: 'kg', duty: duty(35), raw_rate: '35%', locator: 'p.60', exception: { members: ['KE'], reason: 'Named in EAC/160/2026 (table III): a stay of application for Kenya.' } },
  { code: '52051100', description: 'Cotton yarn', unit: 'kg', duty: duty(10), raw_rate: '10%', locator: 'p.270', exception: null },
  { code: '85235200', description: 'Smart cards', unit: 'u', duty: duty(25), raw_rate: '25%', locator: 'p.420', exception: { members: [], reason: 'Named in EAC/160/2026 (table I): not scored for any member.' } },
  { code: '62052000', description: 'Men’s cotton shirts', unit: 'u', duty: duty(25), raw_rate: '25%', locator: 'p.330', exception: null },
];
const SOURCE: CustomsUnionSource = {
  ...CUSTOMS_UNION_SOURCES.EAC,
  // Its own family, so other suites' EAC releases (if any) are not this file's.
  source_family: `EAC_CET_FIXTURE_${MARKER}`,
  release: {
    ...CUSTOMS_UNION_SOURCES.EAC.release,
    identifier: `fixture-${MARKER}`,
    files: [
      { name: 'tariff.pdf', role: 'official_common_external_tariff', url: 'https://example.test/cet.pdf', sha256: sha256(TARIFF), size_bytes: TARIFF.length },
      { name: 'gazette.pdf', role: 'official_gazette_yearly_measures', url: 'https://example.test/gazette.pdf', sha256: sha256(GAZETTE), size_bytes: GAZETTE.length },
    ],
    line_count: LINES.length,
  },
};
let ops: Principal;

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email: `${MARKER}@test.local`, name: 'Atlas ops', role: UserRole.ops_supervisor } });
  ops = { id: user.id, email: user.email, name: 'Atlas ops', role: UserRole.ops_supervisor, exporter_org_id: null, tier: OrgTier.paid };
});
afterEach(() => { setCustomsUnionSourceForTesting('EAC', null); unionService.clearCaches(); });
afterAll(async () => { await prisma.$disconnect(); });

const bundle = () => buildCustomsUnionBundle({ source: SOURCE, files: [{ name: 'gazette.pdf', bytes: GAZETTE }, { name: 'tariff.pdf', bytes: TARIFF }], lines: LINES });

describe('the customs-union bundle', () => {
  test('is deterministic and refuses another file, a changed line count, or tampering', async () => {
    const one = await bundle();
    expect((await bundle()).equals(one)).toBe(true);
    const read = await readCustomsUnionBundle({ bytes: one, source: SOURCE, release_identifier: SOURCE.release.identifier });
    expect(read).toMatchObject({ union: 'EAC', release_identifier: SOURCE.release.identifier, exception_count: 2, valid_until: '2027-06-30' });
    expect(read.files.map((file) => file.name)).toEqual(['tariff.pdf', 'gazette.pdf', 'normalized-lines.json']);
    await expect(buildCustomsUnionBundle({ source: SOURCE, files: [{ name: 'tariff.pdf', bytes: Buffer.from('another edition') }, { name: 'gazette.pdf', bytes: GAZETTE }], lines: LINES })).rejects.toMatchObject({ code: 'source_checksum_mismatch' });
    await expect(buildCustomsUnionBundle({ source: SOURCE, files: [{ name: 'tariff.pdf', bytes: TARIFF }, { name: 'gazette.pdf', bytes: GAZETTE }], lines: LINES.slice(1) })).rejects.toMatchObject({ code: 'line_count_changed' });
    // A bundle whose lines were edited after it was built no longer authenticates.
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(one);
    zip.file('normalized-lines.json', JSON.stringify(LINES.map((line) => ({ ...line, duty: duty(0) }))));
    const tampered = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
    await expect(readCustomsUnionBundle({ bytes: tampered, source: SOURCE, release_identifier: SOURCE.release.identifier })).rejects.toMatchObject({ code: 'artifact_integrity_failure' });
    await expect(readCustomsUnionBundle({ bytes: one, source: CUSTOMS_UNION_SOURCES.EAC, release_identifier: SOURCE.release.identifier })).rejects.toMatchObject({ code: 'unexpected_manifest' });
  });
});

describe('a member’s market access from its union’s release', () => {
  test('without a release the look-up is no_release; once imported, members read the common tariff, labelled, except where they apply a line their own way', async () => {
    setCustomsUnionSourceForTesting('EAC', SOURCE);
    const at = new Date('2026-10-18T00:00:00Z');
    const none = await acquireTariffEvidence({
      job_id: `job-${MARKER}`, hs6: '520511', destinations: ['TZ'], resolution_clock: at,
      policy: { policy_version: 'test', enabled: true, origin_country: 'IN', max_destinations: 1, live_fetch_timeout_ms: 5_000 }, completed: [], onOutcome: async () => undefined,
    });
    expect(none).toMatchObject([{ country_code: 'TZ', outcome: 'no_release', provider_key: 'eac_common_external_tariff', reason: 'No EAC common external tariff release has been imported and activated.' }]);

    const imported = await importCustomsUnionRelease('EAC', { actor: ops, bytes: await bundle(), release_identifier: SOURCE.release.identifier, reference_date: new Date('2026-06-30T00:00:00Z'), source_url: SOURCE.release.source_url, activate: true, correlation_id: MARKER, retrieved_at: new Date('2026-10-18T00:00:00Z') });
    expect(imported.release).toMatchObject({ status: AuthorityReleaseStatus.active, destination_scope: ['BI', 'KE', 'RW', 'TZ', 'UG'] });
    expect(imported.release.validation).toMatchObject({ union: 'EAC', tariff_line_count: 4, exception_count: 2, national_exceptions_modelled: false, valid_until: '2027-06-30' });

    const yarn = await fetchCustomsUnionMarketAccess('EAC', 'TZ', '520511', { now: at, origin_country: 'IN' });
    expect(yarn).toMatchObject({
      country_code: 'TZ', provider: 'eac_common_external_tariff', national_code_system: 'EAC_CET_HS2022', source_release_id: imported.release.id,
      resolution: { resolution: 'exact' }, general_duty: { kind: 'ad_valorem', ad_valorem_rate_percent: 10 },
      india_preference: { applicability: 'not_applicable' },
      raw_evidence: { common_tariff: { union: 'EAC', label: 'EAC common external tariff', member: 'TZ', national_exceptions_modelled: false, note: expect.stringContaining('Tanzania') } },
    });
    // The adapter a run uses reads the same release.
    const adapted = await DESTINATION_ADAPTERS.UG!.fetch({ hs6: '620520', destination_country: 'UG', origin_country: 'IN', now: at });
    expect(adapted).toMatchObject({ country_code: 'UG', general_duty: { ad_valorem_rate_percent: 25 } });

    // Kenya stays rice; Tanzania does not. A line stayed for every member is stated for none.
    expect(await fetchCustomsUnionMarketAccess('EAC', 'TZ', '100630', { now: at })).toMatchObject({ general_duty: { ad_valorem_rate_percent: 35 } });
    const kenyaRice = await fetchCustomsUnionMarketAccess('EAC', 'KE', '100630', { now: at });
    expect(kenyaRice).toMatchObject({ general_duty: null, resolution: { resolution: 'unavailable', reason: expect.stringContaining('10063000 not read automatically for KE') }, raw_evidence: { applied_differently: [{ code: '10063000' }] } });
    expect((await fetchCustomsUnionMarketAccess('EAC', 'RW', '852352', { now: at })).general_duty).toBeNull();
    // Past the year of measures the release states nothing.
    expect(await fetchCustomsUnionMarketAccess('EAC', 'TZ', '520511', { now: new Date('2027-07-01T00:00:00Z') })).toMatchObject({ general_duty: null, resolution: { reason: expect.stringContaining('covers measures to 2027-06-30') } });
    await expect(fetchCustomsUnionMarketAccess('EAC', 'SS', '520511', { now: at })).rejects.toThrow(/not served by the EAC release/);
  });
});

describe('the real releases', () => {
  test('pin their official files, and serve only members that apply the union tariff as their own', () => {
    const all = Object.values(CUSTOMS_UNION_SOURCES);
    const members = all.flatMap((source) => source.members);
    expect(members).toHaveLength(24);
    expect(new Set(members).size).toBe(24);
    expect(new Set(all.map((source) => source.provider)).size).toBe(3);
    for (const source of all) {
      expect(source.release.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256) && file.size_bytes > 100_000 && file.url.startsWith('https://')), source.key).toBe(true);
      expect(source.members.every((member) => source.member_notes[member]?.length > 20), source.key).toBe(true);
      for (const member of source.members) expect(DESTINATION_ADAPTERS[member], member).toMatchObject({ provider_key: source.provider, retrieval: 'retained_release' });
    }
    expect(CUSTOMS_UNION_SOURCES.ECOWAS.release.line_count).toBe(6_380);
    expect(CUSTOMS_UNION_SOURCES.EAC.release.line_count).toBe(5_961);
    expect(CUSTOMS_UNION_SOURCES.EAEU.release.line_count).toBe(13_007);
    // Cabo Verde keeps its own tariff and South Sudan applies the EAC CET only in part.
    expect(customsUnionSourceFor('CV')).toBeNull();
    expect(customsUnionSourceFor('SS')).toBeNull();
    expect(DESTINATION_ADAPTERS.CV).toBeUndefined();
    expect(DESTINATION_ADAPTERS.SS).toBeUndefined();
  });
});

describe('a common-tariff duty in Demand Discovery v5', () => {
  test('scores at the common-tariff quality and says whose tariff it is', () => {
    const common = { union: 'ECOWAS', label: 'ECOWAS common external tariff' };
    const quality = { official: POLICY.quality.official, estimate: POLICY.quality.duty_estimate, agent_recorded: POLICY.quality.official_agent_recorded, common_tariff: POLICY.quality.official_common_tariff };
    const result = scoreDuty({ kind: 'official', duty_percent: 10, source: 'UEMOA Commission 1006301000', preference: null, common_tariff: common }, POLICY, quality);
    expect(POLICY.quality.official_common_tariff).toBe(0.8);
    expect(result).toMatchObject({ score: 60, quality: 0.8, inputs: { basis: 'official', duty_percent: 10, common_tariff: 'ECOWAS common external tariff' } });
    expect(metricSentence(result)).toBe("Duty on Indian goods is 10% under the ECOWAS common external tariff; this market's own exceptions are not checked.");
    expect(scoreDuty({ kind: 'official', duty_percent: 10, source: 'national', preference: null }, POLICY, quality).quality).toBe(1);
  });
});
