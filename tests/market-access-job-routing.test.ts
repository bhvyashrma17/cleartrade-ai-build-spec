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
const fetchNzMarketAccess = vi.fn();
const fetchJapanMarketAccess = vi.fn();
const fetchAustraliaMarketAccess = vi.fn();
const fetchNorwayMarketAccess = vi.fn();
const fetchKoreaMarketAccess = vi.fn();
const fetchTaiwanMarketAccess = vi.fn();
const fetchGeorgiaMarketAccess = vi.fn();
const fetchIsraelMarketAccess = vi.fn();
const fetchPeruMarketAccess = vi.fn();
const persistMarketAccessIngest = vi.fn();

vi.mock('@/lib/market-access/uk-tariff', async () => {
  const actual = await vi.importActual<typeof import('@/lib/market-access/uk-tariff')>('@/lib/market-access/uk-tariff');
  return { UK_TARIFF_DESTINATIONS: actual.UK_TARIFF_DESTINATIONS, fetchUkMarketAccess };
});
vi.mock('@/lib/market-access/us-hts', async () => {
  const actual = await vi.importActual<typeof import('@/lib/market-access/us-hts')>('@/lib/market-access/us-hts');
  return { US_HTS_DESTINATIONS: actual.US_HTS_DESTINATIONS, fetchUsMarketAccess };
});
vi.mock('@/lib/market-access/taric/service', async () => {
  const actual = await vi.importActual<typeof import('@/lib/market-access/taric/service')>('@/lib/market-access/taric/service');
  return { EU_TARIC_DESTINATIONS: actual.EU_TARIC_DESTINATIONS, fetchEuTaricMarketAccess };
});
vi.mock('@/lib/market-access/providers/canada-service', () => ({ fetchCanadaMarketAccess }));
vi.mock('@/lib/market-access/providers/nz-service', () => ({ fetchNzMarketAccess }));
vi.mock('@/lib/market-access/providers/japan-service', () => ({ fetchJapanMarketAccess }));
vi.mock('@/lib/market-access/providers/australia-service', () => ({ fetchAustraliaMarketAccess }));
vi.mock('@/lib/market-access/providers/norway-service', () => ({ fetchNorwayMarketAccess }));
vi.mock('@/lib/market-access/providers/korea-service', () => ({ fetchKoreaMarketAccess }));
vi.mock('@/lib/market-access/providers/taiwan-service', () => ({ fetchTaiwanMarketAccess }));
vi.mock('@/lib/market-access/providers/geo-service', () => ({ fetchGeorgiaMarketAccess }));
vi.mock('@/lib/market-access/providers/israel-service', () => ({ fetchIsraelMarketAccess }));
vi.mock('@/lib/market-access/providers/peru-service', () => ({ fetchPeruMarketAccess }));
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
  fetchNzMarketAccess.mockReset();
  fetchJapanMarketAccess.mockReset();
  fetchAustraliaMarketAccess.mockReset();
  fetchNorwayMarketAccess.mockReset();
  fetchKoreaMarketAccess.mockReset();
  fetchTaiwanMarketAccess.mockReset();
  fetchGeorgiaMarketAccess.mockReset();
  fetchIsraelMarketAccess.mockReset();
  fetchPeruMarketAccess.mockReset();
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
    expect(fetchUkMarketAccess).toHaveBeenCalledWith('090111', { now: undefined, destination_country: 'GB' });
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
    expect(fetchUsMarketAccess).toHaveBeenCalledWith('090111', { now: undefined, destination_country: 'US' });
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

  test('NZ routes to the CusMod authority-release adapter', async () => {
    fetchNzMarketAccess.mockResolvedValue(ingestFixture({ country_code: 'NZ', jurisdiction: 'NZ', provider: 'nz_customs_cusmod' }));
    persistMarketAccessIngest.mockResolvedValue({ id: 'snap-nz', tariff_lines: [], evidence: [] });
    const outcome = await runMarketAccessIngest(ctx({ country_code: 'NZ', hs_code: '090111' }));
    expect(outcome.status).toBe(JobStatus.completed);
    expect(fetchNzMarketAccess).toHaveBeenCalledWith('090111', { now: undefined, origin_country: undefined });
    expect(fetchCanadaMarketAccess).not.toHaveBeenCalled();
    expect(fetchJapanMarketAccess).not.toHaveBeenCalled();
  });

  test('JP routes to the dated-chapter authority-release adapter', async () => {
    fetchJapanMarketAccess.mockResolvedValue(ingestFixture({ country_code: 'JP', jurisdiction: 'JP', provider: 'japan_customs_tariff_schedule' }));
    persistMarketAccessIngest.mockResolvedValue({ id: 'snap-jp', tariff_lines: [], evidence: [] });
    const outcome = await runMarketAccessIngest(ctx({ country_code: 'JP', hs_code: '090111' }));
    expect(outcome.status).toBe(JobStatus.completed);
    expect(fetchJapanMarketAccess).toHaveBeenCalledWith('090111', { now: undefined, origin_country: undefined });
    expect(fetchNzMarketAccess).not.toHaveBeenCalled();
  });

  test('AU routes to the ABF composite chapter adapter', async () => {
    fetchAustraliaMarketAccess.mockResolvedValue(ingestFixture({ country_code: 'AU', jurisdiction: 'AU', provider: 'au_abf_working_tariff' }));
    persistMarketAccessIngest.mockResolvedValue({ id: 'snap-au', tariff_lines: [], evidence: [] });
    const outcome = await runMarketAccessIngest(ctx({ country_code: 'AU', hs_code: '610120' }));
    expect(outcome.status).toBe(JobStatus.completed);
    expect(fetchAustraliaMarketAccess).toHaveBeenCalledWith('610120', { now: undefined, origin_country: undefined });
    expect(fetchJapanMarketAccess).not.toHaveBeenCalled();
    expect(fetchNzMarketAccess).not.toHaveBeenCalled();
  });

  test('NO routes to the Tolletaten open-data adapter', async () => {
    fetchNorwayMarketAccess.mockResolvedValue(ingestFixture({ country_code: 'NO', jurisdiction: 'NO', provider: 'no_tolletaten_customs_tariff' }));
    persistMarketAccessIngest.mockResolvedValue({ id: 'snap-no', tariff_lines: [], evidence: [] });
    const outcome = await runMarketAccessIngest(ctx({ country_code: 'NO', hs_code: '610910' }));
    expect(outcome.status).toBe(JobStatus.completed);
    expect(fetchNorwayMarketAccess).toHaveBeenCalledWith('610910', { now: undefined, origin_country: undefined });
    expect(fetchAustraliaMarketAccess).not.toHaveBeenCalled();
    expect(fetchEuTaricMarketAccess).not.toHaveBeenCalled();
  });

  // KR moved from the unconfigured-source bucket to a real adapter (Wave 3 activation, manual
  // XLSX AuthorityRelease acquisition): it now routes exactly like every other authority-release
  // source rather than falling through to `unconfiguredSourceForCountry`. The API-credential path
  // (korea-acquisition.ts) is unaffected and stays covered by
  // tests/korea-acquisition-credential-gate.test.ts.
  test('KR routes to the KCS authority-release adapter', async () => {
    fetchKoreaMarketAccess.mockResolvedValue(ingestFixture({ country_code: 'KR', jurisdiction: 'KR', provider: 'kr_kcs_customs_tariff' }));
    persistMarketAccessIngest.mockResolvedValue({ id: 'snap-kr', tariff_lines: [], evidence: [] });
    const outcome = await runMarketAccessIngest(ctx({ country_code: 'KR', hs_code: '854449' }));
    expect(outcome.status).toBe(JobStatus.completed);
    expect(fetchKoreaMarketAccess).toHaveBeenCalledWith('854449', { now: undefined, origin_country: undefined });
    expect(fetchNorwayMarketAccess).not.toHaveBeenCalled();
    expect(fetchEuTaricMarketAccess).not.toHaveBeenCalled();
  });

  test('TW routes to the Taiwan Customs retained CSV adapter', async () => {
    fetchTaiwanMarketAccess.mockResolvedValue(ingestFixture({ country_code: 'TW', jurisdiction: 'TW', provider: 'tw_customs_import_duty' }));
    persistMarketAccessIngest.mockResolvedValue({ id: 'snap-tw', tariff_lines: [], evidence: [] });
    const outcome = await runMarketAccessIngest(ctx({ country_code: 'TW', hs_code: '010121' }));
    expect(outcome.status).toBe(JobStatus.completed);
    expect(fetchTaiwanMarketAccess).toHaveBeenCalledWith('010121', { now: undefined, origin_country: undefined });
  });

  test('GE routes to the Matsne Article 197 retained-release adapter', async () => {
    fetchGeorgiaMarketAccess.mockResolvedValue(ingestFixture({ country_code: 'GE', jurisdiction: 'GE', provider: 'ge_matsne_tax_code_article_197' }));
    persistMarketAccessIngest.mockResolvedValue({ id: 'snap-ge', tariff_lines: [], evidence: [] });
    const outcome = await runMarketAccessIngest(ctx({ country_code: 'GE', hs_code: '220410' }));
    expect(outcome.status).toBe(JobStatus.completed);
    expect(fetchGeorgiaMarketAccess).toHaveBeenCalledWith('220410', { now: undefined, origin_country: undefined });
  });

  test('IL routes to the Tax Authority retained CKAN bundle adapter', async () => {
    fetchIsraelMarketAccess.mockResolvedValue(ingestFixture({ country_code: 'IL', jurisdiction: 'IL', provider: 'il_tax_authority_customs_book' }));
    persistMarketAccessIngest.mockResolvedValue({ id: 'snap-il', tariff_lines: [], evidence: [] });
    const outcome = await runMarketAccessIngest(ctx({ country_code: 'IL', hs_code: '090111' }));
    expect(outcome.status).toBe(JobStatus.completed);
    expect(fetchIsraelMarketAccess).toHaveBeenCalledWith('090111', { now: undefined, origin_country: undefined });
  });

  test('PE routes to the SUNAT retained consolidated-tariff adapter', async () => {
    fetchPeruMarketAccess.mockResolvedValue(ingestFixture({ country_code: 'PE', jurisdiction: 'PE', provider: 'pe_sunat_customs_tariff' }));
    persistMarketAccessIngest.mockResolvedValue({ id: 'snap-pe', tariff_lines: [], evidence: [] });
    const outcome = await runMarketAccessIngest(ctx({ country_code: 'PE', hs_code: '100630', origin_country: 'IN' }));
    expect(outcome.status).toBe(JobStatus.completed);
    expect(fetchPeruMarketAccess).toHaveBeenCalledWith('100630', { now: undefined, origin_country: 'IN' });
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

  test.each(['AX', 'MC'])('%s routes to TARIC while preserving the associated destination', async (country) => {
    fetchEuTaricMarketAccess.mockResolvedValue(ingestFixture({ country_code: country, jurisdiction: 'EU', provider: 'eu_taric' }));
    persistMarketAccessIngest.mockResolvedValue({ id: `snap-${country}`, tariff_lines: [], evidence: [] });
    await runMarketAccessIngest(ctx({ country_code: country, hs_code: '090111', origin_country: 'IN' }));
    expect(fetchEuTaricMarketAccess).toHaveBeenCalledWith('090111', { now: undefined, destination_country: country, origin_country: 'IN' });
  });

  test.each(['GG', 'IM', 'JE'])('%s routes to the UK common-external-tariff adapter with its own scope', async (country) => {
    fetchUkMarketAccess.mockResolvedValue(ingestFixture({ country_code: country, jurisdiction: 'UK_CD_CUSTOMS_UNION' }));
    persistMarketAccessIngest.mockResolvedValue({ id: `snap-${country}`, tariff_lines: [], evidence: [] });
    await runMarketAccessIngest(ctx({ country_code: country, hs_code: '090111' }));
    expect(fetchUkMarketAccess).toHaveBeenCalledWith('090111', { now: undefined, destination_country: country });
  });

  test('PR routes to the USITC schedule as its own destination inside US customs territory', async () => {
    fetchUsMarketAccess.mockResolvedValue(ingestFixture({ country_code: 'PR', jurisdiction: 'US_CUSTOMS_TERRITORY', provider: 'usitc_hts' }));
    persistMarketAccessIngest.mockResolvedValue({ id: 'snap-PR', tariff_lines: [], evidence: [] });
    await runMarketAccessIngest(ctx({ country_code: 'PR', hs_code: '090111' }));
    expect(fetchUsMarketAccess).toHaveBeenCalledWith('090111', { now: undefined, destination_country: 'PR' });
  });

  test.each(['SA', 'AE', 'BR', 'UA', 'KZ', 'RU', 'BY', 'AM', 'KG', 'PH', 'CH', 'SG', 'TH'])('%s is a completed source/licence-or-credential determination, never evidence', async (country) => {
    const outcome = await runMarketAccessIngest(ctx({ country_code: country, hs_code: '090111' }));
    expect(outcome.status).toBe(JobStatus.completed);
    expect((outcome.result as Record<string, unknown>).provider_state).toBe('provider_unconfigured_or_license_pending');
    expect((outcome.result as Record<string, unknown>).snapshot_id).toBeNull();
    expect(fetchUkMarketAccess).not.toHaveBeenCalled();
    expect(fetchUsMarketAccess).not.toHaveBeenCalled();
    expect(fetchEuTaricMarketAccess).not.toHaveBeenCalled();
    expect(fetchCanadaMarketAccess).not.toHaveBeenCalled();
    expect(fetchNzMarketAccess).not.toHaveBeenCalled();
    expect(fetchJapanMarketAccess).not.toHaveBeenCalled();
    expect(fetchAustraliaMarketAccess).not.toHaveBeenCalled();
    expect(fetchNorwayMarketAccess).not.toHaveBeenCalled();
    expect(fetchKoreaMarketAccess).not.toHaveBeenCalled();
    expect(fetchTaiwanMarketAccess).not.toHaveBeenCalled();
    expect(fetchGeorgiaMarketAccess).not.toHaveBeenCalled();
    expect(fetchIsraelMarketAccess).not.toHaveBeenCalled();
    expect(persistMarketAccessIngest).not.toHaveBeenCalled();
  });

  test('a genuinely unknown destination fails rather than guessing a source', async () => {
    const outcome = await runMarketAccessIngest(ctx({ country_code: 'ZZ', hs_code: '090111' }));
    expect(outcome.status).toBe(JobStatus.failed);
    expect(JSON.stringify(outcome.result)).toMatch(/No authoritative market-access source/);
  });
});
