import JSZip from 'jszip';

export const PERU_ACQUISITION_VERSION = 'sunat-tariff-and-franja-acquisition-v2' as const;
export const PERU_TARIFF_URL = 'https://www.sunat.gob.pe/orientacionaduanera/aranceles/Cap01-98-Descripcion.zip' as const;
export const PERU_FRANJA_URL = 'https://busquedas.elperuano.pe/dispositivo/NL/2545338-1' as const;

const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

async function fetchOfficialBytes(url: typeof PERU_TARIFF_URL | typeof PERU_FRANJA_URL, options: { fetch_impl?: typeof fetch; attempts?: number } = {}) {
  const fetchImpl = options.fetch_impl ?? fetch;
  const attempts = options.attempts ?? 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { accept: '*/*', 'user-agent': 'ClearTrade-Customs-Atlas/1.0' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        if (response.status !== 429 && response.status < 500) throw new Error(`Peru authority returned non-retryable HTTP ${response.status} for ${url}.`);
        throw new Error(`Peru authority returned retryable HTTP ${response.status} for ${url}.`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw new Error(`Peru authority returned an empty response for ${url}.`);
      if (bytes.length > MAX_SOURCE_BYTES) throw new Error(`Peru authority response exceeded ${MAX_SOURCE_BYTES} bytes for ${url}.`);
      return bytes;
    } catch (error) {
      lastError = error;
      if (attempt === attempts || /non-retryable|exceeded/.test(String(error))) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 100));
    }
  }
  throw lastError;
}

/** Retain the general schedule and the monthly variable-duty decision in one immutable release. */
export async function acquirePeruAuthorityBundle(options: { fetch_impl?: typeof fetch; attempts?: number } = {}) {
  const [tariff, franja] = await Promise.all([
    fetchOfficialBytes(PERU_TARIFF_URL, options),
    fetchOfficialBytes(PERU_FRANJA_URL, options),
  ]);
  const zip = new JSZip();
  const stable = { date: new Date('1980-01-01T00:00:00.000Z'), createFolders: false } as const;
  zip.file('sunat-tariff.zip', tariff, stable);
  zip.file('franja-resolution.html', franja, stable);
  zip.file('acquisition.json', JSON.stringify({ acquisition_version: PERU_ACQUISITION_VERSION, tariff_url: PERU_TARIFF_URL, franja_url: PERU_FRANJA_URL }, null, 2), stable);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', platform: 'UNIX' });
}
