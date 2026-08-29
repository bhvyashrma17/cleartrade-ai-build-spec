import { isRealWorkflowEnvironment } from '@/lib/evidence-environment';

/**
 * Phase 1H acquisition boundary.
 *
 * This module deliberately contains no live implementation and no `fetch` call. A provider that
 * has not been connected and operationally approved returns a typed unavailable result. Tests may
 * inject implementations through the explicitly test-only seam below; staging and production may
 * never use that seam.
 */

export type CountryTruthProviderDomain =
  | 'market_access'
  | 'fx'
  | 'route_freight'
  | 'market_fit_benchmark';

export type CountryTruthProviderMode =
  | 'unavailable'
  | 'fixture'
  | 'mock'
  | 'public_real'
  | 'authenticated_real'
  | 'partner_quote_real';

/**
 * Evidence authority is independent of transport mode. In particular, an authenticated API may
 * still publish an authoritative public fact, while a real authenticated freight quote remains a
 * tenant-scoped partner assertion. Exporter declarations and agent verifications do not enter via
 * this provider boundary and therefore intentionally have no member here.
 */
export type CountryTruthProviderEvidenceClass =
  | 'none'
  | 'authoritative_public'
  | 'partner_quote'
  | 'test_fixture';

export interface CountryTruthProviderIdentity<Domain extends CountryTruthProviderDomain = CountryTruthProviderDomain> {
  readonly domain: Domain;
  readonly provider_key: string;
  readonly display_name: string;
  readonly mode: CountryTruthProviderMode;
  readonly evidence_class: CountryTruthProviderEvidenceClass;
  readonly source_authority: string | null;
  readonly source_dataset: string | null;
  readonly source_contract_version: string;
  readonly parser_version: string | null;
  /** Stable, non-secret identity for quota/account isolation. Never a credential value. */
  readonly credential_fingerprint: string | null;
}

export type ProviderUnavailableCode =
  | 'provider_not_configured'
  | 'credentials_not_configured'
  | 'unsupported_scope'
  | 'quota_unavailable'
  | 'temporarily_unavailable'
  | 'provider_disabled';

export interface ProviderUnavailableReason {
  code: ProviderUnavailableCode;
  message: string;
  retryable: boolean;
  details: Readonly<Record<string, string | number | boolean | null>>;
}

export interface ProviderArtifactProvenance {
  source_reference: string;
  source_dataset: string;
  source_dataset_version: string | null;
  source_contract_version: string;
  parser_version: string;
  retrieved_at: string;
  effective_at: string;
  raw_response_checksum: string;
  completeness: 'COMPLETE' | 'PARTIAL';
}

export interface ProviderUnavailableResult<Domain extends CountryTruthProviderDomain> {
  status: 'unavailable';
  provider_identity: CountryTruthProviderIdentity<Domain>;
  reason: ProviderUnavailableReason;
}

export interface ProviderAvailableResult<Domain extends CountryTruthProviderDomain, Fact> {
  status: 'available';
  provider_identity: CountryTruthProviderIdentity<Domain>;
  artifact: ProviderArtifactProvenance;
  facts: readonly Fact[];
}

export type ProviderAcquisitionResult<Domain extends CountryTruthProviderDomain, Fact> =
  | ProviderUnavailableResult<Domain>
  | ProviderAvailableResult<Domain, Fact>;

/** Exact destination/product scope. Null or prefix HS identities are not accepted by this API. */
export interface ExactCountryProductScope {
  destination_country_code: string;
  origin_country_code: string;
  hs6_code: string;
  hs_revision: string;
  /** The date at which applicability must be evaluated, not the retrieval clock. */
  effective_at: string;
}

export interface MarketAccessAcquisitionRequest extends ExactCountryProductScope {
  request_id: string;
  requested_at: string;
  include_tariffs: boolean;
  include_regulatory_requirements: boolean;
}

export type MarketAccessFact =
  | {
      fact_type: 'tariff';
      scope: ExactCountryProductScope;
      tariff_kind: 'ordinary' | 'preferential';
      preferential_origin_country_code: string | null;
      applicability: 'applicable' | 'not_applicable' | 'unknown';
      ad_valorem_rate_percent: string | null;
      duty_expression: string;
      effective_from: string | null;
      effective_to: string | null;
      source_reference: string;
    }
  | {
      fact_type: 'market_access_requirement';
      scope: ExactCountryProductScope;
      requirement_type: 'prohibition' | 'restriction' | 'mandatory_certification' | 'other_document';
      requirement_code: string | null;
      description: string;
      obtainable: boolean | null;
      effective_from: string | null;
      effective_to: string | null;
      source_reference: string;
    };

export interface MarketAccessProvider {
  readonly identity: CountryTruthProviderIdentity<'market_access'>;
  acquire(request: MarketAccessAcquisitionRequest): Promise<ProviderAcquisitionResult<'market_access', MarketAccessFact>>;
}

interface FxRequestBase {
  request_id: string;
  base_currency: string;
  quote_currency: string;
  /** The date whose rate is required; it must not be replaced with retrieval time. */
  rate_date: string;
  requested_at: string;
}

export interface AuthoritativeFxAcquisitionRequest extends FxRequestBase {
  evidence_class: 'authoritative_public';
  rate_kind: 'reference' | 'customs_notified';
}

export interface PartnerFxQuoteAcquisitionRequest extends FxRequestBase {
  evidence_class: 'partner_quote';
  exporter_org_id: string;
  deal_id: string | null;
  partner_id: string;
  quote_request_reference: string;
}

export type FxAcquisitionRequest = AuthoritativeFxAcquisitionRequest | PartnerFxQuoteAcquisitionRequest;

export interface FxRateFact {
  evidence_class: 'authoritative_public' | 'partner_quote';
  base_currency: string;
  quote_currency: string;
  /** Decimal text avoids introducing binary floating-point semantics at the provider boundary. */
  rate: string;
  rate_date: string;
  effective_from: string;
  effective_to: string | null;
  exporter_org_id: string | null;
  deal_id: string | null;
  partner_id: string | null;
  quote_reference: string | null;
  source_reference: string;
}

export interface FxProvider {
  readonly identity: CountryTruthProviderIdentity<'fx'>;
  acquire(request: FxAcquisitionRequest): Promise<ProviderAcquisitionResult<'fx', FxRateFact>>;
}

export type FreightTransportMode = 'ocean' | 'air' | 'road' | 'rail' | 'multimodal';

export interface RouteScope extends ExactCountryProductScope {
  origin_location_code: string;
  origin_gateway_code: string | null;
  destination_location_code: string;
  transport_mode: FreightTransportMode;
  equipment_code: string | null;
}

export interface PublicRouteAcquisitionRequest {
  request_id: string;
  evidence_class: 'authoritative_public';
  route: RouteScope;
  requested_at: string;
}

/**
 * Every commercial quote dimension is explicit and tenant scoped. Unknown cargo assumptions are
 * represented as null values in the request identity; they are never silently defaulted.
 */
export interface PartnerFreightQuoteAcquisitionRequest {
  request_id: string;
  evidence_class: 'partner_quote';
  exporter_org_id: string;
  product_id: string;
  product_classification_id: string;
  deal_id: string | null;
  partner_id: string;
  quote_request_reference: string;
  route: RouteScope;
  shipment_ready_at: string;
  cargo_quantity: string | null;
  cargo_quantity_unit: string | null;
  cargo_weight_kg: string | null;
  cargo_volume_m3: string | null;
  goods_value_amount: string | null;
  goods_value_currency: string | null;
  requested_quote_currency: string;
  requested_incoterm: string | null;
  requested_at: string;
}

export type RouteFreightAcquisitionRequest = PublicRouteAcquisitionRequest | PartnerFreightQuoteAcquisitionRequest;

export type RouteFreightFact =
  | {
      fact_type: 'route';
      evidence_class: 'authoritative_public';
      route: RouteScope;
      route_availability: 'available' | 'unavailable' | 'unknown';
      transit_time_min_days: number | null;
      transit_time_max_days: number | null;
      effective_from: string;
      effective_to: string | null;
      source_reference: string;
    }
  | {
      fact_type: 'freight_quote';
      evidence_class: 'partner_quote';
      exporter_org_id: string;
      product_id: string;
      product_classification_id: string;
      deal_id: string | null;
      partner_id: string;
      route: RouteScope;
      quote_reference: string;
      amount: string;
      currency: string;
      rate_basis: string;
      included_charge_codes: readonly string[];
      excluded_charge_codes: readonly string[];
      issued_at: string;
      valid_until: string;
      source_reference: string;
    };

export interface RouteFreightProvider {
  readonly identity: CountryTruthProviderIdentity<'route_freight'>;
  acquire(request: RouteFreightAcquisitionRequest): Promise<ProviderAcquisitionResult<'route_freight', RouteFreightFact>>;
}

export type MarketFitBenchmarkType =
  | 'order_value'
  | 'order_quantity'
  | 'production_lead_time'
  | 'customization_required'
  | 'packaging_required';

export interface MarketFitBenchmarkAcquisitionRequest extends ExactCountryProductScope {
  request_id: string;
  evidence_class: 'authoritative_public';
  requested_at: string;
  benchmark_types: readonly MarketFitBenchmarkType[];
}

export interface MarketFitBenchmarkFact {
  evidence_class: 'authoritative_public';
  scope: ExactCountryProductScope;
  benchmark_type: MarketFitBenchmarkType;
  minimum_value: string | null;
  maximum_value: string | null;
  unit: string | null;
  currency: string | null;
  required: boolean | null;
  requirement_code: string | null;
  observed_at: string;
  valid_until: string | null;
  source_reference: string;
}

export interface MarketFitBenchmarkProvider {
  readonly identity: CountryTruthProviderIdentity<'market_fit_benchmark'>;
  acquire(
    request: MarketFitBenchmarkAcquisitionRequest,
  ): Promise<ProviderAcquisitionResult<'market_fit_benchmark', MarketFitBenchmarkFact>>;
}

export interface CountryTruthProviderRegistry {
  readonly market_access: MarketAccessProvider;
  readonly fx: FxProvider;
  readonly route_freight: RouteFreightProvider;
  readonly market_fit_benchmark: MarketFitBenchmarkProvider;
}

const DISPLAY_NAMES: Record<CountryTruthProviderDomain, string> = {
  market_access: 'market-access and tariff',
  fx: 'foreign-exchange',
  route_freight: 'route and freight',
  market_fit_benchmark: 'market-fit benchmark',
};

function unavailableIdentity<Domain extends CountryTruthProviderDomain>(
  domain: Domain,
): CountryTruthProviderIdentity<Domain> {
  return Object.freeze({
    domain,
    provider_key: `unavailable_${domain}`,
    display_name: `No ${DISPLAY_NAMES[domain]} provider configured`,
    mode: 'unavailable',
    evidence_class: 'none',
    source_authority: null,
    source_dataset: null,
    source_contract_version: 'unavailable-v1',
    parser_version: null,
    credential_fingerprint: null,
  });
}

function unavailableResult<Domain extends CountryTruthProviderDomain>(
  identity: CountryTruthProviderIdentity<Domain>,
): ProviderUnavailableResult<Domain> {
  return {
    status: 'unavailable',
    provider_identity: identity,
    reason: {
      code: 'provider_not_configured',
      message: `No approved ${DISPLAY_NAMES[identity.domain]} provider is configured.`,
      retryable: false,
      details: { domain: identity.domain, provider_key: identity.provider_key },
    },
  };
}

const unavailableMarketAccessIdentity = unavailableIdentity('market_access');
const unavailableFxIdentity = unavailableIdentity('fx');
const unavailableRouteFreightIdentity = unavailableIdentity('route_freight');
const unavailableMarketFitIdentity = unavailableIdentity('market_fit_benchmark');

/** The production default is intentionally inert and remains so until real adapters are wired. */
export const DEFAULT_COUNTRY_TRUTH_PROVIDER_REGISTRY: CountryTruthProviderRegistry = Object.freeze({
  market_access: Object.freeze({
    identity: unavailableMarketAccessIdentity,
    acquire: async (_request: MarketAccessAcquisitionRequest) => unavailableResult(unavailableMarketAccessIdentity),
  }),
  fx: Object.freeze({
    identity: unavailableFxIdentity,
    acquire: async (_request: FxAcquisitionRequest) => unavailableResult(unavailableFxIdentity),
  }),
  route_freight: Object.freeze({
    identity: unavailableRouteFreightIdentity,
    acquire: async (_request: RouteFreightAcquisitionRequest) => unavailableResult(unavailableRouteFreightIdentity),
  }),
  market_fit_benchmark: Object.freeze({
    identity: unavailableMarketFitIdentity,
    acquire: async (_request: MarketFitBenchmarkAcquisitionRequest) => unavailableResult(unavailableMarketFitIdentity),
  }),
});

const EXPECTED_EVIDENCE_CLASS: Record<CountryTruthProviderMode, CountryTruthProviderEvidenceClass> = {
  unavailable: 'none',
  fixture: 'test_fixture',
  mock: 'test_fixture',
  public_real: 'authoritative_public',
  authenticated_real: 'authoritative_public',
  partner_quote_real: 'partner_quote',
};

export function assertCountryTruthProviderIdentityAllowed(
  identity: CountryTruthProviderIdentity,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const expectedEvidenceClass = EXPECTED_EVIDENCE_CLASS[identity.mode];
  if (identity.evidence_class !== expectedEvidenceClass) {
    throw new Error(
      `Country Truth provider ${identity.provider_key} mode ${identity.mode} requires evidence class ${expectedEvidenceClass}, not ${identity.evidence_class}.`,
    );
  }
  if (isRealWorkflowEnvironment(env) && (identity.mode === 'fixture' || identity.mode === 'mock')) {
    throw new Error(
      `Country Truth ${identity.mode} provider ${identity.provider_key} is forbidden in staging/production.`,
    );
  }
  if (
    (identity.mode === 'public_real' || identity.mode === 'authenticated_real') &&
    (!identity.source_authority?.trim() || !identity.source_dataset?.trim())
  ) {
    throw new Error(`Authoritative provider ${identity.provider_key} requires a source authority and dataset identity.`);
  }
  if (identity.mode === 'partner_quote_real' && !identity.credential_fingerprint?.trim()) {
    throw new Error(`Partner-quote provider ${identity.provider_key} requires a non-secret credential fingerprint.`);
  }
}

function assertRegistryAllowed(registry: CountryTruthProviderRegistry, env: NodeJS.ProcessEnv): void {
  const providers: Array<[CountryTruthProviderDomain, CountryTruthProviderIdentity]> = [
    ['market_access', registry.market_access.identity],
    ['fx', registry.fx.identity],
    ['route_freight', registry.route_freight.identity],
    ['market_fit_benchmark', registry.market_fit_benchmark.identity],
  ];
  for (const [expectedDomain, identity] of providers) {
    if (identity.domain !== expectedDomain) {
      throw new Error(
        `Country Truth registry slot ${expectedDomain} received provider ${identity.provider_key} for ${identity.domain}.`,
      );
    }
    assertCountryTruthProviderIdentityAllowed(identity, env);
  }
}

let injectedTestRegistry: CountryTruthProviderRegistry | null = null;

export function getCountryTruthProviderRegistry(
  env: NodeJS.ProcessEnv = process.env,
): CountryTruthProviderRegistry {
  if (injectedTestRegistry && isRealWorkflowEnvironment(env)) {
    throw new Error('Injected Country Truth providers are forbidden in staging/production.');
  }
  const registry = injectedTestRegistry ?? DEFAULT_COUNTRY_TRUTH_PROVIDER_REGISTRY;
  assertRegistryAllowed(registry, env);
  return registry;
}

/**
 * Explicit test seam. Passing null is always allowed so cleanup cannot be blocked by a changed
 * environment; every non-null injection is rejected in staging and production.
 */
export function setCountryTruthProviderRegistryForTests(
  providers: Partial<CountryTruthProviderRegistry> | null,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (providers === null) {
    injectedTestRegistry = null;
    return;
  }
  if (isRealWorkflowEnvironment(env)) {
    throw new Error('Country Truth test provider injection is forbidden in staging/production.');
  }
  const registry: CountryTruthProviderRegistry = Object.freeze({
    ...DEFAULT_COUNTRY_TRUTH_PROVIDER_REGISTRY,
    ...providers,
  });
  assertRegistryAllowed(registry, env);
  injectedTestRegistry = registry;
}
