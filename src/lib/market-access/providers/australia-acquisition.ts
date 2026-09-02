import JSZip from 'jszip';

export const AUSTRALIA_ACQUISITION_VERSION = 'abf-acquisition-v1' as const;

export interface AustraliaAcquisitionRequest {
  release_identifier: string;
  chapter: string;
  /** Schedule 3 chapter page: the general (MFN) rate and national tariff-line identity. */
  chapter_url: string;
  /** Schedule 10A: Indian-originating goods under the Australia–India ECTA. */
  schedule_10a_url: string;
}

const ALLOWED_HOST = 'www.abf.gov.au';
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;

function officialUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== ALLOWED_HOST) {
    throw new Error(`Australia authority acquisition only accepts HTTPS sources from ${ALLOWED_HOST}.`);
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
        // ABF's edge rejects requests without a conventional browser Accept/UA pair. This is a
        // plain, identifying user-agent — not an attempt to disguise the client as a browser.
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'user-agent': 'Mozilla/5.0 (compatible; ClearTrade-Customs-Atlas/1.0)',
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        if (response.status !== 429 && response.status < 500) {
          throw new Error(`ABF returned non-retryable HTTP ${response.status} for ${url}.`);
        }
        throw new Error(`ABF returned retryable HTTP ${response.status} for ${url}.`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw new Error(`ABF returned an empty response for ${url}.`);
      if (bytes.length > MAX_SOURCE_BYTES) throw new Error(`ABF response exceeded ${MAX_SOURCE_BYTES} bytes for ${url}.`);
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
 * Acquire both official inputs for one chapter and retain their exact bytes together.
 *
 * Australia needs two documents that cannot substitute for each other: the Schedule 3 chapter page
 * carries national tariff-line identity, statistical codes, units and the general rate; Schedule
 * 10A carries the Australia–India ECTA treatment. Following the proven Canada composite pattern,
 * both are retained in a single immutable release, so the evidence records exactly which Schedule
 * 10A text was in force when that chapter was read — rather than joining a chapter against
 * whatever 10A happens to be current at query time.
 */
export async function acquireAustraliaAuthorityBundle(
  request: AustraliaAcquisitionRequest,
  options: { fetch_impl?: typeof fetch; attempts?: number } = {},
) {
  const chapterUrl = officialUrl(request.chapter_url);
  const scheduleUrl = officialUrl(request.schedule_10a_url);
  const [chapter, schedule] = await Promise.all([
    fetchOfficialBytes(chapterUrl, options),
    fetchOfficialBytes(scheduleUrl, options),
  ]);
  const acquisition = {
    acquisition_version: AUSTRALIA_ACQUISITION_VERSION,
    release_identifier: request.release_identifier.trim(),
    chapter: request.chapter.trim(),
    chapter_url: chapterUrl,
    schedule_10a_url: scheduleUrl,
  };
  const bundle = new JSZip();
  // Fixed entry metadata keeps the wrapper byte-stable so idempotency is driven by source identity
  // rather than by the wall-clock timestamp JSZip would otherwise stamp on each acquisition.
  const fileOptions = { date: new Date('1980-01-01T00:00:00.000Z'), createFolders: false } as const;
  bundle.file('schedule-3-chapter.html', chapter, fileOptions);
  bundle.file('schedule-10a-india.html', schedule, fileOptions);
  bundle.file('acquisition.json', Buffer.from(JSON.stringify(acquisition, null, 2), 'utf8'), fileOptions);
  return Buffer.from(await bundle.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', streamFiles: false }));
}
