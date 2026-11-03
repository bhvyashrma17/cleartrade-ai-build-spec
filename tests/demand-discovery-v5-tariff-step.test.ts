import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, test } from 'vitest';
import { setTariffAdapterResolverForTesting } from '../src/lib/country-truth/tariff-acquisition';
import { acquireV5Tariffs, summarizeTariffOutcomes } from '../src/lib/demand-discovery-v5/tariff-step';
import { validationError } from '../src/lib/errors';
import type { MarketAccessAdapter } from '../src/lib/job-handlers/market-access';
import type { MarketAccessIngestResult } from '../src/lib/market-access/contract';
import { prisma } from '../src/lib/prisma';

/**
 * Official tariffs looked up inside a v5 run (D-020). The adapters are in-process doubles shaped as
 * Customs Atlas adapters answer; what is under test is which markets are asked, in what order, what
 * is recorded for each, and the clock the evidence is admitted at.
 */
const adValorem = (rate: number) => ({ kind: 'ad_valorem' as const, ad_valorem_rate_percent: rate, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null, expression: `${rate}%`, note: null });

function tariffResult(country: string, hs6: string, rate: number, retrievedAt: Date): MarketAccessIngestResult {
  const line = { national_tariff_code: `${hs6}0000`, description: 'Fixture line', declarable: true, effective_from: new Date('2026-01-01T00:00:00Z'), effective_to: null, general_duty: adValorem(rate), control_codes: [], preference_area_ids: [] };
  return {
    jurisdiction: country, country_code: country, hs6, hs_revision: 'HS2022', provider: `fixture_${country.toLowerCase()}`,
    source_authority: `${country} fixture authority`, source_dataset: 'fixture', source_dataset_version: 'fixture-v1',
    source_reference: `https://example.test/${country}/${hs6}`, national_code_system: 'EU_TARIC', parser_version: 'fixture-v1',
    retrieved_at: retrievedAt, evidence_class: 'authoritative_public', recorded_by_id: null,
    resolution: { resolution: 'exact', resolved_line: line, candidates: [line], candidate_count: 1, differences: [], reason: 'fixture' },
    general_duty: adValorem(rate),
    india_preference: { applicability: 'not_applicable', duty: null, geographic_area_id: null, basis: 'fixture: no India preference' },
    lines: [], requirements: [], regulatory_coverage_complete: false, raw_evidence: { fixture: true },
  };
}

afterEach(() => setTariffAdapterResolverForTesting(null));

describe('v5 tariff look-up', () => {
  test('asks only markets with a source, one source at a time, records every outcome, and admits at the tariff clock', async () => {
    const hs6 = `9${String(Date.now()).slice(-5)}`;
    const asked: string[] = [];
    const released = new Date('2026-10-11T09:00:00Z');
    const bloc: MarketAccessAdapter = {
      provider_key: 'fixture_bloc', retrieval: 'retained_release',
      async fetch(request) {
        asked.push(request.destination_country);
        if (request.destination_country === 'FR') throw new Error('Fixture release could not be read.');
        expect(request.now?.toISOString()).toBe('2026-10-14T06:00:00.000Z');
        return tariffResult(request.destination_country, hs6, 6.5, released);
      },
    };
    const live: MarketAccessAdapter = {
      provider_key: 'fixture_live', retrieval: 'live_fetch',
      async fetch(request) {
        asked.push(request.destination_country);
        expect(request.now).toBeUndefined();
        return tariffResult(request.destination_country, hs6, 3, new Date('2026-10-14T06:01:00Z'));
      },
    };
    setTariffAdapterResolverForTesting((country) => (['AT', 'FR'].includes(country) ? bloc : country === 'DE' ? live : undefined));

    const step = await acquireV5Tariffs({
      job_id: `job-${randomUUID()}`, hs6, markets: ['FR', 'DE', 'AT', 'BT', 'de'], resolution_clock: new Date('2026-10-14T06:00:00Z'),
      live_fetch_timeout_ms: 5_000, now: () => new Date('2026-10-14T06:02:00Z'),
    });
    // Country order would be AT, DE, FR; one source at a time it is AT, FR (the bloc), then DE.
    expect(asked).toEqual(['AT', 'FR', 'DE']);
    expect(step.outcomes.map((item) => [item.country_code, item.outcome, item.provider_key])).toEqual([
      ['AT', 'acquired', 'fixture_bloc'], ['DE', 'acquired', 'fixture_live'], ['FR', 'failed', 'fixture_bloc'],
    ]);
    expect(step.outcomes.find((item) => item.country_code === 'FR')!.reason).toBe('Fixture release could not be read.');
    expect(step.tariff_clock.toISOString()).toBe('2026-10-14T06:02:00.000Z');
    expect(await prisma.marketAccessEvidenceSnapshot.count({ where: { hs6_code: hs6 } })).toBe(2);
  });

  test('a retained-release source with nothing imported yet is recorded as no release, not as a failure (D-029)', async () => {
    const saved: MarketAccessAdapter = {
      provider_key: 'fixture_window_release', retrieval: 'retained_release',
      async fetch() { throw validationError([{ field: 'release', code: 'missing', message: 'No official Singapore SSO tariff release has been imported and activated.' }]); },
    };
    const broken: MarketAccessAdapter = { provider_key: 'fixture_broken', retrieval: 'retained_release', async fetch() { throw validationError([{ field: 'bundle', code: 'corrupt_archive', message: 'unreadable' }]); } };
    setTariffAdapterResolverForTesting((country) => (country === 'SG' ? saved : country === 'KR' ? broken : undefined));
    const step = await acquireV5Tariffs({ job_id: `job-${randomUUID()}`, hs6: '100630', markets: ['SG', 'KR'], resolution_clock: new Date('2026-10-14T06:00:00Z'), live_fetch_timeout_ms: 5_000, now: () => new Date('2026-10-14T06:00:00Z') });
    expect(step.outcomes.map((item) => [item.country_code, item.outcome, item.reason])).toEqual([
      // A validation error's reason is what its fields say, not the generic envelope message.
      ['KR', 'failed', 'unreadable'],
      ['SG', 'no_release', 'No official Singapore SSO tariff release has been imported and activated.'],
    ]);
  });

  test('a source that does not cover the product for a market is recorded as not covered: the run is not degraded, and says so', async () => {
    // Andorra applies the EU tariff to HS chapters 25–97 only; the TARIC service refuses rice (chapter 10) by design.
    const partial: MarketAccessAdapter = {
      provider_key: 'fixture_partial_union', retrieval: 'retained_release',
      async fetch() { throw validationError([{ field: 'hs6', code: 'outside_customs_union', message: 'AD applies the EU common customs tariff only to HS chapters 25–97; its own tariff applies to chapter 10, so TARIC evidence must not be used for it.' }]); },
    };
    setTariffAdapterResolverForTesting((country) => (country === 'AD' ? partial : undefined));
    const step = await acquireV5Tariffs({ job_id: `job-${randomUUID()}`, hs6: '100630', markets: ['AD'], resolution_clock: new Date('2026-10-14T06:00:00Z'), live_fetch_timeout_ms: 5_000, now: () => new Date('2026-10-14T06:00:00Z') });
    expect(step.outcomes).toMatchObject([{ country_code: 'AD', outcome: 'not_covered', provider_key: 'fixture_partial_union', snapshot_id: null, reason: expect.stringContaining('only to HS chapters 25–97') }]);
    expect(summarizeTariffOutcomes(step.outcomes)).toEqual({
      degraded: false,
      notes: ["The connected tariff source does not cover this product for AD, where the market's own tariff applies, so that market's duty is not the official rate this run."],
    });
  });

  test('only a failed or timed-out look-up degrades the run', () => {
    const at = (country_code: string, outcome: 'acquired' | 'failed' | 'timed_out' | 'no_release' | 'not_covered') => ({ country_code, outcome, provider_key: null, retrieval: null, snapshot_id: null, snapshot_created_by_run: null, retrieved_at: null, source_version: null, authority_release_id: null, classification_resolution: null, tariff_coverage: null, reason: null, elapsed_ms: 0 });
    expect(summarizeTariffOutcomes([at('DE', 'acquired'), at('SG', 'no_release'), at('AD', 'not_covered')]).degraded).toBe(false);
    expect(summarizeTariffOutcomes([at('DE', 'acquired'), at('FR', 'failed'), at('US', 'timed_out')])).toEqual({
      degraded: true,
      notes: ["The official tariff look-up failed for FR, US, so those markets' duties are not the official rate this run."],
    });
    expect(summarizeTariffOutcomes([])).toEqual({ degraded: false, notes: [] });
  });

  test('with no market connected to a source, nothing is asked and the clock is the run clock or now', async () => {
    setTariffAdapterResolverForTesting(() => undefined);
    const step = await acquireV5Tariffs({ job_id: 'job-none', hs6: '100630', markets: ['US', 'GB'], resolution_clock: new Date('2026-10-14T06:00:00Z'), live_fetch_timeout_ms: 5_000, now: () => new Date('2026-10-14T05:00:00Z') });
    expect(step).toEqual({ outcomes: [], tariff_clock: new Date('2026-10-14T06:00:00Z') });
  });
});
