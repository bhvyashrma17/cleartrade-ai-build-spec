export const JAPAN_ACQUISITION_VERSION = 'jp-customs-acquisition-v1' as const;

export interface JapanAcquisitionRequest {
  effective_date_label: string;
  chapter: string;
  chapter_url: string;
}

const ALLOWED_HOST = 'www.customs.go.jp';
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

function officialUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== ALLOWED_HOST) {
    throw new Error(`Japan authority acquisition only accepts HTTPS sources from ${ALLOWED_HOST}.`);
  }
  return url.toString();
}

/**
 * Retrieval is conservative and non-aggressive by design (PDL 1.0 is silent on automated access,
 * so no automated-access permission is assumed beyond reasonable, low-rate reads): one chapter
 * per call, standard retry-with-backoff, no concurrent multi-chapter fan-out here.
 */
export async function acquireJapanChapterBytes(
  request: JapanAcquisitionRequest,
  options: { fetch_impl?: typeof fetch; attempts?: number } = {},
) {
  const url = officialUrl(request.chapter_url);
  const fetchImpl = options.fetch_impl ?? fetch;
  const attempts = options.attempts ?? 3;
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { accept: 'text/html', 'user-agent': 'ClearTrade-Customs-Atlas/1.0 (conservative, single-chapter reads)' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        if (response.status !== 429 && response.status < 500) {
          throw new Error(`Japan Customs returned non-retryable HTTP ${response.status} for ${url}.`);
        }
        throw new Error(`Japan Customs returned retryable HTTP ${response.status} for ${url}.`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw new Error(`Japan Customs returned an empty response for ${url}.`);
      if (bytes.length > MAX_SOURCE_BYTES) throw new Error(`Japan Customs response exceeded ${MAX_SOURCE_BYTES} bytes for ${url}.`);
      return bytes;
    } catch (error) {
      last = error;
      if (attempt === attempts || /non-retryable|exceeded/.test(String(error))) throw error;
      // A longer, gentler backoff than Canada/NZ: PDL 1.0 does not document a rate-limit policy,
      // so retries stay infrequent rather than probing for one.
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw last;
}
