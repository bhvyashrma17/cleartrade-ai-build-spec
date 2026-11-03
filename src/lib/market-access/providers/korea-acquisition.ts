/**
 * Korea Customs Service tariff-schedule acquisition — READY, NOT WIRED.
 *
 * Rights are cleared (KOGL Type 1, confirmed against data.go.kr dataset 15051179 itself, not the
 * platform generally — see unconfigured-sources.ts KR_DATA_GO_KR). This module exists so the real
 * acquisition call is ready the moment ClearTrade Operations provisions a service key; it is
 * deliberately NOT joined by a parser or service layer, and NOT wired into DESTINATION_ADAPTERS.
 *
 * Building a parser against field names read only from a Swagger stub — with no live response
 * ever actually observed, because every call requires the key this environment does not have —
 * would be exactly the kind of fabricated structure this project refuses to ship. The correct next
 * step is a live authenticated call, then a parser built from what that call actually returns.
 */

export const KOREA_ACQUISITION_VERSION = 'kr-data-go-kr-acquisition-v1' as const;
export const KOREA_SERVICE_KEY_ENV_VAR = 'KCS_DATA_GO_KR_SERVICE_KEY' as const;

const API_BASE = 'https://api.odcloud.kr/api';
/** The dataset's current endpoint path must be re-confirmed at acquisition time: data.go.kr mints
 *  a new UDDI segment on every refresh of dataset 15051179, so this is not assumed stable. */
export const KOREA_TARIFF_DATASET_PUBLIC_DATA_PK = '15051179' as const;

export class KoreaCredentialNotConfiguredError extends Error {
  constructor() {
    super(`${KOREA_SERVICE_KEY_ENV_VAR} is not configured. Korea Customs rights are cleared (KOGL Type 1) but acquisition requires a data.go.kr service key ClearTrade has not provisioned — see unconfigured-sources.ts KR_DATA_GO_KR.`);
    this.name = 'KoreaCredentialNotConfiguredError';
  }
}

export interface KoreaAcquisitionRequest {
  /** The current dataset endpoint UDDI, as published on the dataset's own data.go.kr listing. */
  endpoint_uddi: string;
  page?: number;
  per_page?: number;
}

/**
 * Call the live odcloud API for this exact dataset. Fails closed with a named, distinguishable
 * error when no credential is configured — never silently substitutes a guess, and never falls
 * back to scraping the interactive data.go.kr page.
 */
export async function acquireKoreaTariffPage(
  request: KoreaAcquisitionRequest,
  options: { fetch_impl?: typeof fetch } = {},
): Promise<unknown> {
  const key = process.env[KOREA_SERVICE_KEY_ENV_VAR];
  if (!key) throw new KoreaCredentialNotConfiguredError();
  const fetchImpl = options.fetch_impl ?? fetch;
  const url = new URL(`${API_BASE}/${KOREA_TARIFF_DATASET_PUBLIC_DATA_PK}/v1/${request.endpoint_uddi}`);
  url.searchParams.set('page', String(request.page ?? 1));
  url.searchParams.set('perPage', String(request.per_page ?? 100));
  url.searchParams.set('serviceKey', key);
  const response = await fetchImpl(url.toString(), {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Korea Customs (data.go.kr) returned HTTP ${response.status} for dataset ${KOREA_TARIFF_DATASET_PUBLIC_DATA_PK}.`);
  }
  return response.json();
}
