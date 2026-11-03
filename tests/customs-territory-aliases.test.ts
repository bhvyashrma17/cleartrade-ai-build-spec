import { describe, expect, test } from 'vitest';
import { acquireTariffEvidence } from '@/lib/country-truth/tariff-acquisition';
import { EU_TARIC_ASSOCIATED_DESTINATIONS, EU_TARIC_MEMBER_DESTINATIONS, EU_TARIC_DESTINATIONS, EU_TARIC_PARTIAL_DESTINATIONS, fetchEuTaricMarketAccess } from '@/lib/market-access/taric/service';
import { fetchUkMarketAccess, UK_TARIFF_DESTINATIONS } from '@/lib/market-access/uk-tariff';
import { fetchUsMarketAccess, US_HTS_DESTINATIONS } from '@/lib/market-access/us-hts';

describe('customs-territory authority scopes', () => {
  test('EU member scope remains 27 and associated destinations are additive', () => {
    expect(EU_TARIC_MEMBER_DESTINATIONS).toHaveLength(27);
    expect(EU_TARIC_ASSOCIATED_DESTINATIONS).toEqual(['AX', 'MC', 'MQ', 'SM']);
    expect(Object.keys(EU_TARIC_PARTIAL_DESTINATIONS)).toEqual(['AD']);
    expect(EU_TARIC_DESTINATIONS).toHaveLength(32);
  });

  test('in a run, Andorra outside its chapters is recorded as not covered, not as a failure', async () => {
    const outcomes = await acquireTariffEvidence({
      job_id: 'job-andorra-rice', hs6: '100630', destinations: ['AD'], resolution_clock: new Date('2026-10-19T00:00:00Z'),
      policy: { policy_version: 'test', enabled: true, origin_country: 'IN', max_destinations: 1, live_fetch_timeout_ms: 5_000 }, completed: [], onOutcome: async () => undefined,
    });
    expect(outcomes).toMatchObject([{ country_code: 'AD', outcome: 'not_covered', provider_key: 'eu_taric', snapshot_id: null, reason: expect.stringContaining('only to HS chapters 25–97') }]);
  });

  test("Andorra is served TARIC evidence only inside its customs union's chapters 25–97", async () => {
    // Rice (chapter 10) is outside the union: refused before any release is read.
    await expect(fetchEuTaricMarketAccess('100630', { destination_country: 'AD' })).rejects.toMatchObject({ fields: [expect.objectContaining({ code: 'outside_customs_union' })] });
    // Brassware (chapter 74) in Andorra, and rice in San Marino (all chapters), pass the scope check.
    // What happens next depends on whether this database holds a TARIC release, so only the scope
    // refusal is asserted absent.
    const scopeCode = (work: Promise<unknown>) => work.then(() => null, (error: { fields?: { code: string }[] }) => error.fields?.[0]?.code ?? 'other');
    expect(await scopeCode(fetchEuTaricMarketAccess('741810', { destination_country: 'AD' }))).not.toBe('outside_customs_union');
    expect(await scopeCode(fetchEuTaricMarketAccess('100630', { destination_country: 'SM' }))).not.toBe('outside_customs_union');
  });

  test('UK and US authority scope lists name only destinations proved by their customs instruments', () => {
    expect(UK_TARIFF_DESTINATIONS).toEqual(['GB', 'GG', 'IM', 'JE']);
    expect(US_HTS_DESTINATIONS).toEqual(['US', 'PR']);
  });

  test('authority fetchers reject a destination outside their legal scope before network access', async () => {
    await expect(fetchUkMarketAccess('090111', { destination_country: 'GI' })).rejects.toThrow(/outside the UK/);
    await expect(fetchUsMarketAccess('090111', { destination_country: 'GU' })).rejects.toThrow(/outside the customs territory/);
  });
});
