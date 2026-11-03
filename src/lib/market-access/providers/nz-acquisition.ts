export const NZ_ACQUISITION_VERSION = 'nz-customs-acquisition-v1' as const;

export interface NzAcquisitionRequest {
  release_identifier: string;
  tariff_archive_url: string;
}

const ALLOWED_HOST = 'www.customs.govt.nz';
const MAX_SOURCE_BYTES = 32 * 1024 * 1024;

function officialUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== ALLOWED_HOST) {
    throw new Error(`New Zealand authority acquisition only accepts HTTPS sources from ${ALLOWED_HOST}.`);
  }
  return url.toString();
}

async function fetchOfficialBytes(
  url: string,
  options: { fetch_impl?: typeof fetch; attempts?: number } = {},
) {
  const fetchImpl = options.fetch_impl ?? fetch;
  const attempts = options.attempts ?? 3;
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(officialUrl(url), {
        headers: { accept: '*/*', 'user-agent': 'ClearTrade-Customs-Atlas/1.0' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        if (response.status !== 429 && response.status < 500) {
          throw new Error(`NZ Customs returned non-retryable HTTP ${response.status} for ${url}.`);
        }
        throw new Error(`NZ Customs returned retryable HTTP ${response.status} for ${url}.`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw new Error(`NZ Customs returned an empty response for ${url}.`);
      if (bytes.length > MAX_SOURCE_BYTES) throw new Error(`NZ Customs response exceeded ${MAX_SOURCE_BYTES} bytes for ${url}.`);
      return bytes;
    } catch (error) {
      last = error;
      if (attempt === attempts || /non-retryable|exceeded/.test(String(error))) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 100));
    }
  }
  throw last;
}

/**
 * Acquire the official nightly CusMod Tariff archive, exactly as published — a single
 * `.tar.gz` file, unlike Canada's two-source composite. Retained bytes are the authority's own,
 * never re-encoded.
 */
export async function acquireNzAuthorityBundle(
  request: NzAcquisitionRequest,
  options: { fetch_impl?: typeof fetch; attempts?: number } = {},
) {
  const url = officialUrl(request.tariff_archive_url);
  return fetchOfficialBytes(url, options);
}
