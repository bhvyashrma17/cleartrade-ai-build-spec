import { JobStatus } from '@prisma/client';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { MarketAccessIngestResult } from '@/lib/market-access/contract';

/**
 * Routing formalised into one declared destination→adapter table (docs audit §14): EU TARIC
 * previously needed its own branch because `fetchEuTaricMarketAccess` takes the destination as an
 * argument instead of having it baked in, unlike the UK/US fetchers. These tests pin that the
 * table now covers all three sources uniformly and that the two non-evidence outcomes — an
 * authoritative-but-unconfigured source, and a genuinely unknown destination — are unchanged.
 *
 * The underlying provider fetchers are mocked: this is routing/dispatch coverage, not a live
 * network or database test, and those fetchers already have their own test coverage.
 */

const fetchUkMarketAccess = vi.fn();
const fetchUsMarketAccess = vi.fn();
const fetchEuTaricMarketAccess = vi.fn();
const fetchCanadaMarketAccess = vi.fn();
const persistMarketAccessIngest = vi.fn();

vi.mock('@/lib/market-access/uk-tariff', () => ({ fetchUkMarketAccess }));
vi.mock('@/lib/market-access/us-hts', () => ({ fetchUsMarketAccess }));
vi.mock('@/lib/market-access/taric/service', async () => {
  const actual = await vi.importActual<typeof import('@/lib/market-access/taric/service')>('@/lib/market-access/taric/service');
  return { EU_TARIC_DESTINATIONS: actual.EU_TARIC_DESTINATIONS, fetchEuTaricMarketAccess };
});
vi.mock('@/lib/market-access/providers/canada-service', () => ({ fetchCanadaMarketAccess }));
vi.mock('@/lib/market-access/contract', async () => {
  const actual = await vi.importActual<typeof import('@/lib/market-access/contract')>('@/lib/market-access/contract');
  return { ...actual, persistMarketAccessIngest };
});

const { runMarketAccessIngest } = await import('@/lib/job-handlers/market-access');

function ctx(payload: unknown) {
  return {
    job_id: 'job-1', attempt_no: 1, payload: payload as never, exporter_org_id: null, target_id: null,
    correlation_id: 'corr-1', reportProgress: async () => {},
  };
}

function ingestFixture(over: Partial<MarketAccessIngestResult> = {}): MarketAccessIngestResult {
  return {
    jurisdiction: 'GB', country_code: 'GB', hs6: '090111', hs_revision: 'HS2022',
    provider: 'uk_tariff', source_authority: 'HMRC test', source_dataset: 'UK Integrated Online Tariff',
    source_dataset_version: 'vnd.hmrc.2.0', source_reference: 'https://example.test/uk/090111',
    national_code_system: 'UK_COMMODITY', parser_version: 'uk-tariff-v2', retrieved_at: new Date('2026-08-30T00:00:00Z'),
    evidence_class: 'authoritative_public', recorded_by_id: null,
    resolution: { resolution: 'unavailable', resolved_line: null, candidates: [], candidate_count: 0, differences: [], reason: 'fixture' },
    general_duty: null,
    india_preference: { applicability: 'unknown', duty: null, geographic_area_id: null, basis: 'fixture' },
    lines: [], requirements: [], regulatory_coverage_complete: false, raw_evidence: { test: true },
    ...over,
  };
}

afterEach(() => {
  fetchUkMarketAccess.mockReset();
  fetchUsMarketAccess.mockReset();
  fetchEuTaricMarketAccess.mockReset();
  fetchCanadaMarketAccess.mockReset();
  persistMarketAccessIngest.mockReset();
});

describe('market-access ingest routing', () => {
  test('rejects a malformed destination or HS6 before consulting any table', async () => {
    const bad = await runMarketAccessIngest(ctx({ country_code: 'GBR', hs_code: '090111' }));
    expect(bad.status).toBe(JobStatus.failed);
    const badHs = await runMarketAccessIngest(ctx({ country_code: 'GB', hs_code: '9011' }));
    expect(badHs.status).toBe(JobStatus.failed);
    expect(fetchUkMarketAccess).not.toHaveBeenCalled();
  });

  test('GB routes to the UK adapter, unwrapped through the common shape', async () => {
    fetchUkMarketAccess.mockResolvedValue(ingestFixture());
    persistMarketAccessIngest.mockResolvedValue({ id: 'snap-1', tariff_lines: [], evidence: [] });
    const outcome = await runMarketAccessIngest(ctx({ country_code: 'GB', hs_code: '090111' }));
    expect(outcome.status).toBe(JobStatus.completed);
    expect(fetchUkMarketAccess).toHaveBeenCalledWith('090111', { now: undefined });
    expect(fetchUsMarketAccess).not.toHaveBeenCalled();
    expect(fetchEuTaricMarketAccess).not.toHaveBeenCalled();
    expect((outcome.result as Record<string, unknown>).provider_state).toBe('authoritative_public');
    // The generic dispatch path now reports source_dataset_version for every source, not only
    // the one that previously had its own branch.
    expect((outcome.result as Record<string, unknown>).source_dataset_version).toBe('vnd.hmrc.2.0');
  });

  test('US routes to the US adapter', async () => {
    fetchUsMarketAccess.mockResolvedValue(ingestFixture({ country_code: 'US', jurisdiction: 'US', provider: 'us_hts' }));
    persistMarketAccessIngest.mockResolvedValue({ id: 'snap-2', tariff_lines: [], evidence: [] });
    const outcome = await runMarketAccessIngest(ctx({ country_code: 'US', hs_code: '090111' }));
    expect(outcome.status).toBe(JobStatus.completed);
    expect(fetchUsMarketAccess).toHaveBeenCalledWith('090111', { now: undefined });
    expect(fetchUkMarketAccess).not.toHaveBeenCalled();
    expect(fetchEuTaricMarketAccess).not.toHaveBeenCalled();
  });

  test('CA routes to the retained CBSA authority-release adapter', async () => {
    fetchCanadaMarketAccess.mockResolvedValue(ingestFixture({ country_code: 'CA', jurisdiction: 'CA', provider: 'canada_cbsa_customs_tariff' }));
    persistMarketAccessIngest.mockResolvedValue({ id: 'snap-ca', tariff_lines: [], evidence: [] });
    const outcome = await runMarketAccessIngest(ctx({ country_code: 'CA', hs_code: '090111' }));
    expect(outcome.status).toBe(JobStatus.completed);
    expect(fetchCanadaMarketAccess).toHaveBeenCalledWith('090111', { now: undefined, origin_country: undefined });
    expect(fetchUkMarketAccess).not.toHaveBeenCalled();
    expect(fetchUsMarketAccess).not.toHaveBeenCalled();
    expect(fetchEuTaricMarketAccess).not.toHaveBeenCalled();
  });

  test('an authority acquisition failure creates no canonical market evidence', async () => {
    fetchCanadaMarketAccess.mockRejectedValue(new Error('CBSA unavailable'));
    await expect(runMarketAccessIngest(ctx({ country_code: 'CA', hs_code: '090111' }))).rejects.toThrow('CBSA unavailable');
    expect(persistMarketAccessIngest).not.toHaveBeenCalled();
  });

  test.each(['DE', 'FR', 'IE', 'NL'])('%s routes to the EU TARIC adapter, passing the exact destination', async (country) => {
    fetchEuTaricMarketAccess.mockResolvedValue(ingestFixture({ country_code: country, jurisdiction: 'EU', provider: 'eu_taric' }));
    persistMarketAccessIngest.mockResolvedValue({ id: `snap-${country}`, tariff_lines: [], evidence: [] });
    const outcome = await runMarketAccessIngest(ctx({ country_code: country, hs_code: '090111' }));
    expect(outcome.status).toBe(JobStatus.completed);
    expect(fetchEuTaricMarketAccess).toHaveBeenCalledWith('090111', { now: undefined, destination_country: country, origin_country: undefined });
    expect(fetchUkMarketAccess).not.toHaveBeenCalled();
    expect(fetchUsMarketAccess).not.toHaveBeenCalled();
  });

  test.each(['SA', 'JP', 'AE', 'BR'])('%s is a completed source/licence determination, never evidence', async (country) => {
    const outcome = await runMarketAccessIngest(ctx({ country_code: country, hs_code: '090111' }));
    expect(outcome.status).toBe(JobStatus.completed);
    expect((outcome.result as Record<string, unknown>).provider_state).toBe('provider_unconfigured_or_license_pending');
    expect((outcome.result as Record<string, unknown>).snapshot_id).toBeNull();
    expect(fetchUkMarketAccess).not.toHaveBeenCalled();
    expect(fetchUsMarketAccess).not.toHaveBeenCalled();
    expect(fetchEuTaricMarketAccess).not.toHaveBeenCalled();
    expect(fetchCanadaMarketAccess).not.toHaveBeenCalled();
    expect(persistMarketAccessIngest).not.toHaveBeenCalled();
  });

  test('a genuinely unknown destination fails rather than guessing a source', async () => {
    const outcome = await runMarketAccessIngest(ctx({ country_code: 'ZZ', hs_code: '090111' }));
    expect(outcome.status).toBe(JobStatus.failed);
    expect(JSON.stringify(outcome.result)).toMatch(/No authoritative market-access source/);
  });
});
