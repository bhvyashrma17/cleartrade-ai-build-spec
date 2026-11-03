import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  DEFAULT_COUNTRY_TRUTH_PROVIDER_REGISTRY,
  assertCountryTruthProviderIdentityAllowed,
  getCountryTruthProviderRegistry,
  setCountryTruthProviderRegistryForTests,
  type CountryTruthProviderIdentity,
  type FxProvider,
  type MarketAccessAcquisitionRequest,
  type MarketFitBenchmarkAcquisitionRequest,
  type PartnerFreightQuoteAcquisitionRequest,
  type FxAcquisitionRequest,
} from '../src/lib/country-truth/providers';

const env = (APP_ENV: string) => ({ NODE_ENV: 'test', APP_ENV }) as NodeJS.ProcessEnv;

const marketAccessRequest: MarketAccessAcquisitionRequest = {
  request_id: 'market-access-request',
  destination_country_code: 'GB',
  origin_country_code: 'IN',
  hs6_code: '090111',
  hs_revision: 'HS2022',
  effective_at: '2026-08-29T00:00:00.000Z',
  requested_at: '2026-08-29T00:00:00.000Z',
  include_tariffs: true,
  include_regulatory_requirements: true,
};

const fxRequest: FxAcquisitionRequest = {
  request_id: 'fx-request',
  evidence_class: 'authoritative_public',
  base_currency: 'INR',
  quote_currency: 'USD',
  rate_kind: 'reference',
  rate_date: '2026-08-29',
  requested_at: '2026-08-29T00:00:00.000Z',
};

const freightRequest: PartnerFreightQuoteAcquisitionRequest = {
  request_id: 'freight-request',
  evidence_class: 'partner_quote',
  exporter_org_id: 'org-1',
  product_id: 'product-1',
  product_classification_id: 'classification-1',
  deal_id: null,
  partner_id: 'freight-partner-1',
  quote_request_reference: 'request-1',
  route: {
    destination_country_code: 'GB',
    origin_country_code: 'IN',
    hs6_code: '090111',
    hs_revision: 'HS2022',
    effective_at: '2026-09-05T00:00:00.000Z',
    origin_location_code: 'INMUN',
    origin_gateway_code: 'INMUN',
    destination_location_code: 'GBFXT',
    transport_mode: 'ocean',
    equipment_code: '22G1',
  },
  shipment_ready_at: '2026-09-05T00:00:00.000Z',
  cargo_quantity: '1000',
  cargo_quantity_unit: 'kg',
  cargo_weight_kg: '1000',
  cargo_volume_m3: null,
  goods_value_amount: '10000',
  goods_value_currency: 'USD',
  requested_quote_currency: 'USD',
  requested_incoterm: 'CIF',
  requested_at: '2026-08-29T00:00:00.000Z',
};

const marketFitRequest: MarketFitBenchmarkAcquisitionRequest = {
  request_id: 'fit-request',
  evidence_class: 'authoritative_public',
  destination_country_code: 'GB',
  origin_country_code: 'IN',
  hs6_code: '090111',
  hs_revision: 'HS2022',
  effective_at: '2026-08-29T00:00:00.000Z',
  requested_at: '2026-08-29T00:00:00.000Z',
  benchmark_types: ['order_value', 'order_quantity'],
};

afterEach(() => {
  setCountryTruthProviderRegistryForTests(null);
});

describe('Country Truth Phase 1H provider boundary', () => {
  test('the default registry performs no I/O and reports every provider as explicitly unavailable', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const registry = getCountryTruthProviderRegistry(env('production'));

    const results = await Promise.all([
      registry.market_access.acquire(marketAccessRequest),
      registry.fx.acquire(fxRequest),
      registry.route_freight.acquire(freightRequest),
      registry.market_fit_benchmark.acquire(marketFitRequest),
    ]);

    expect(registry).toBe(DEFAULT_COUNTRY_TRUTH_PROVIDER_REGISTRY);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(results).toHaveLength(4);
    for (const result of results) {
      expect(result.status).toBe('unavailable');
      if (result.status === 'unavailable') {
        expect(result.provider_identity.mode).toBe('unavailable');
        expect(result.provider_identity.evidence_class).toBe('none');
        expect(result.reason).toMatchObject({
          code: 'provider_not_configured',
          retryable: false,
          details: { domain: result.provider_identity.domain },
        });
      }
    }
  });

  test('a mock provider may be injected only in a non-real test environment', async () => {
    const identity: CountryTruthProviderIdentity<'fx'> = {
      domain: 'fx',
      provider_key: 'fx_test_fixture',
      display_name: 'FX test fixture',
      mode: 'mock',
      evidence_class: 'test_fixture',
      source_authority: null,
      source_dataset: 'test-only',
      source_contract_version: 'test-v1',
      parser_version: 'test-parser-v1',
      credential_fingerprint: null,
    };
    const provider: FxProvider = {
      identity,
      async acquire(request) {
        return {
          status: 'available',
          provider_identity: identity,
          artifact: {
            source_reference: 'fixture://fx',
            source_dataset: 'test-only',
            source_dataset_version: 'v1',
            source_contract_version: 'test-v1',
            parser_version: 'test-parser-v1',
            retrieved_at: request.requested_at,
            effective_at: request.rate_date,
            raw_response_checksum: 'fixture-checksum',
            completeness: 'COMPLETE',
          },
          facts: [],
        };
      },
    };

    setCountryTruthProviderRegistryForTests({ fx: provider }, env('test'));
    const result = await getCountryTruthProviderRegistry(env('test')).fx.acquire(fxRequest);
    expect(result).toMatchObject({ status: 'available', provider_identity: { mode: 'mock', evidence_class: 'test_fixture' } });

    expect(() => getCountryTruthProviderRegistry(env('production'))).toThrow(/injected.*forbidden/i);
  });

  test('staging and production reject test injection and fixture or mock identities', () => {
    const mockIdentity: CountryTruthProviderIdentity<'fx'> = {
      domain: 'fx',
      provider_key: 'mock-fx',
      display_name: 'Mock FX',
      mode: 'mock',
      evidence_class: 'test_fixture',
      source_authority: null,
      source_dataset: 'fixture',
      source_contract_version: 'fixture-v1',
      parser_version: 'fixture-parser-v1',
      credential_fingerprint: null,
    };
    const fixtureIdentity: CountryTruthProviderIdentity<'market_access'> = {
      ...mockIdentity,
      domain: 'market_access',
      provider_key: 'fixture-market-access',
      display_name: 'Fixture market access',
      mode: 'fixture',
    };

    expect(() => assertCountryTruthProviderIdentityAllowed(mockIdentity, env('production'))).toThrow(/mock.*forbidden/i);
    expect(() => assertCountryTruthProviderIdentityAllowed(fixtureIdentity, env('staging'))).toThrow(/fixture.*forbidden/i);
    expect(() => setCountryTruthProviderRegistryForTests({ fx: { identity: mockIdentity, acquire: async () => ({ status: 'unavailable', provider_identity: mockIdentity, reason: { code: 'provider_disabled', message: 'test', retryable: false, details: {} } }) } }, env('production'))).toThrow(/injection.*forbidden/i);
  });

  test('authoritative public facts and real partner quotes cannot share an evidence identity', () => {
    const publicIdentity: CountryTruthProviderIdentity<'route_freight'> = {
      domain: 'route_freight',
      provider_key: 'public-route-schedule',
      display_name: 'Public route schedule',
      mode: 'public_real',
      evidence_class: 'authoritative_public',
      source_authority: 'Port authority',
      source_dataset: 'Published schedules',
      source_contract_version: 'schedule-v1',
      parser_version: 'schedule-parser-v1',
      credential_fingerprint: null,
    };
    const partnerIdentity: CountryTruthProviderIdentity<'route_freight'> = {
      domain: 'route_freight',
      provider_key: 'partner-freight-quotes',
      display_name: 'Freight partner quotes',
      mode: 'partner_quote_real',
      evidence_class: 'partner_quote',
      source_authority: 'Contracted freight partner',
      source_dataset: 'Quote API',
      source_contract_version: 'quote-v1',
      parser_version: 'quote-parser-v1',
      credential_fingerprint: 'non-secret-fingerprint',
    };

    expect(() => assertCountryTruthProviderIdentityAllowed(publicIdentity, env('test'))).not.toThrow();
    expect(() => assertCountryTruthProviderIdentityAllowed(partnerIdentity, env('test'))).not.toThrow();
    expect(publicIdentity.evidence_class).not.toBe(partnerIdentity.evidence_class);
    expect(freightRequest).toMatchObject({
      evidence_class: 'partner_quote',
      exporter_org_id: 'org-1',
      product_classification_id: 'classification-1',
      partner_id: 'freight-partner-1',
      route: {
        origin_country_code: 'IN',
        destination_country_code: 'GB',
        hs6_code: '090111',
        hs_revision: 'HS2022',
      },
    });
  });
});
