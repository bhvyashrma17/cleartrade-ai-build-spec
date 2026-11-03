import JSZip from 'jszip';

export const NORWAY_ACQUISITION_VERSION = 'tolletaten-acquisition-v1' as const;

/**
 * The four Tolletaten open datasets a Norwegian tariff answer needs. Each is published separately
 * on the customs authority's own CKAN portal under CC BY 4.0, and none substitutes for another:
 * rates carry the duty, goods carry line validity and units, groups translate a rate's country
 * group into something an origin can be tested against, and the trade-agreement file is the
 * authority's own statement of which agreements name a country.
 */
export interface NorwayAcquisitionRequest {
  release_identifier: string;
  rates_url: string;
  goods_url: string;
  country_groups_url: string;
  trade_agreements_url: string;
}

const ALLOWED_HOST = 'data.toll.no';
const MAX_SOURCE_BYTES = 96 * 1024 * 1024;

function officialUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== ALLOWED_HOST) {
    throw new Error(`Norwegian authority acquisition only accepts HTTPS sources from ${ALLOWED_HOST}.`);
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
        // data.toll.no rejects a request with no conventional user-agent. This is a plain,
        // identifying agent — not an attempt to look like a browser.
        headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; ClearTrade-Customs-Atlas/1.0)' },
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) {
        if (response.status !== 429 && response.status < 500) {
          throw new Error(`Tolletaten returned non-retryable HTTP ${response.status} for ${url}.`);
        }
        throw new Error(`Tolletaten returned retryable HTTP ${response.status} for ${url}.`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw new Error(`Tolletaten returned an empty response for ${url}.`);
      if (bytes.length > MAX_SOURCE_BYTES) throw new Error(`Tolletaten response exceeded ${MAX_SOURCE_BYTES} bytes for ${url}.`);
      return bytes;
    } catch (error) {
      last = error;
      if (attempt === attempts || /non-retryable|exceeded/.test(String(error))) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    }
  }
  throw last;
}

/**
 * Acquire all four official datasets and retain their exact bytes in one immutable release.
 *
 * Retaining them together matters for evidence integrity: a duty rate is only interpretable
 * against the country-group table that was current alongside it, and Norway republishes these
 * files independently. Joining a rate file against whatever group file happens to be current at
 * query time would silently mix vintages.
 */
export async function acquireNorwayAuthorityBundle(
  request: NorwayAcquisitionRequest,
  options: { fetch_impl?: typeof fetch; attempts?: number } = {},
) {
  const urls = {
    rates_url: officialUrl(request.rates_url),
    goods_url: officialUrl(request.goods_url),
    country_groups_url: officialUrl(request.country_groups_url),
    trade_agreements_url: officialUrl(request.trade_agreements_url),
  };
  const [rates, goods, groups, agreements] = await Promise.all([
    fetchOfficialBytes(urls.rates_url, options),
    fetchOfficialBytes(urls.goods_url, options),
    fetchOfficialBytes(urls.country_groups_url, options),
    fetchOfficialBytes(urls.trade_agreements_url, options),
  ]);
  const acquisition = {
    acquisition_version: NORWAY_ACQUISITION_VERSION,
    release_identifier: request.release_identifier.trim(),
    ...urls,
  };
  const bundle = new JSZip();
  // Fixed entry metadata keeps the wrapper byte-stable, so idempotency is driven by source
  // identity rather than the wall-clock timestamp JSZip would otherwise stamp on each run.
  const fileOptions = { date: new Date('1980-01-01T00:00:00.000Z'), createFolders: false } as const;
  bundle.file('tollavgiftssats.json', rates, fileOptions);
  bundle.file('varenummer.json', goods, fileOptions);
  bundle.file('landgruppe.json', groups, fileOptions);
  bundle.file('ratetradeagreements.json', agreements, fileOptions);
  bundle.file('acquisition.json', Buffer.from(JSON.stringify(acquisition, null, 2), 'utf8'), fileOptions);
  return Buffer.from(await bundle.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', streamFiles: false }));
}
