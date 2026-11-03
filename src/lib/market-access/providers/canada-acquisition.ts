import JSZip from 'jszip';

export const CANADA_ACQUISITION_VERSION = 'cbsa-acquisition-v1' as const;

export interface CanadaAcquisitionRequest {
  release_identifier: string;
  tariff_url: string;
  country_treatments_url: string;
}

const ALLOWED_HOST = 'www.cbsa-asfc.gc.ca';
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;

function officialUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== ALLOWED_HOST) {
    throw new Error(`Canada authority acquisition only accepts HTTPS sources from ${ALLOWED_HOST}.`);
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
          throw new Error(`CBSA returned non-retryable HTTP ${response.status} for ${url}.`);
        }
        throw new Error(`CBSA returned retryable HTTP ${response.status} for ${url}.`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw new Error(`CBSA returned an empty response for ${url}.`);
      if (bytes.length > MAX_SOURCE_BYTES) throw new Error(`CBSA response exceeded ${MAX_SOURCE_BYTES} bytes for ${url}.`);
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
 * Acquire both official inputs and retain their exact bytes in one immutable source bundle.
 * The Access database proves line/rate semantics; the country-treatment table proves which
 * schemes India is eligible for. Neither source can safely substitute for the other.
 */
export async function acquireCanadaAuthorityBundle(
  request: CanadaAcquisitionRequest,
  options: { fetch_impl?: typeof fetch; attempts?: number } = {},
) {
  const tariffUrl = officialUrl(request.tariff_url);
  const treatmentsUrl = officialUrl(request.country_treatments_url);
  const [tariff, treatments] = await Promise.all([
    fetchOfficialBytes(tariffUrl, options),
    fetchOfficialBytes(treatmentsUrl, options),
  ]);
  const acquisition = {
    acquisition_version: CANADA_ACQUISITION_VERSION,
    release_identifier: request.release_identifier.trim(),
    tariff_url: tariffUrl,
    country_treatments_url: treatmentsUrl,
  };
  const bundle = new JSZip();
  // Fixed ZIP entry metadata keeps the wrapper byte-stable. Idempotency must be driven by source
  // identity, not by the wall-clock timestamp JSZip otherwise inserts on every acquisition.
  const fileOptions = { date: new Date('1980-01-01T00:00:00.000Z'), createFolders: false } as const;
  bundle.file('cbsa-tariff-release.zip', tariff, fileOptions);
  bundle.file('countries-and-treatments.html', treatments, fileOptions);
  bundle.file('acquisition.json', JSON.stringify(acquisition, null, 2), fileOptions);
  return bundle.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', platform: 'UNIX' });
}
