import { createHash } from 'node:crypto';
import JSZip from 'jszip';

export const PERU_ACQUISITION_VERSION = 'sunat-tariff-franja-and-mincetur-acquisition-v4' as const;
export const PERU_TARIFF_URL = 'https://www.sunat.gob.pe/orientacionaduanera/aranceles/Cap01-98-Descripcion.zip' as const;
/** Static official PDF behind El Peruano's public decision page. */
export const PERU_FRANJA_URL = 'https://busquedas.elperuano.pe/api/archivo/file/4lM0IZjiKpl9iq1LmL_dX5/*/2545338-1.PDF' as const;
export const PERU_FRANJA_LANDING_URL = 'https://busquedas.elperuano.pe/dispositivo/NL/2545338-1' as const;
/** Official MINCETUR inventory page classifying the Peru–India agreement at acquisition time. */
export const PERU_MINCETUR_INDIA_STATUS_URL = 'https://www.acuerdoscomerciales.gob.pe/Negociacion/India/Sobre_Acuerdo.html' as const;

const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

async function fetchOfficialBytes(url: string, options: { fetch_impl?: typeof fetch; attempts?: number } = {}) {
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

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/**
 * Retain the general schedule and the monthly variable-duty decision in one immutable release.
 *
 * The decision is acquired from El Peruano's static PDF artifact, not its server-rendered landing
 * page. The landing page contains advertising, anti-bot and React state that changes independently
 * of the law. The PDF is the authoritative published document and has stable content identity.
 */
export async function acquirePeruAuthorityBundle(options: { fetch_impl?: typeof fetch; attempts?: number } = {}) {
  const [tariff, franja, minceturIndiaStatus] = await Promise.all([
    fetchOfficialBytes(PERU_TARIFF_URL, options),
    fetchOfficialBytes(PERU_FRANJA_URL, options),
    fetchOfficialBytes(PERU_MINCETUR_INDIA_STATUS_URL, options),
  ]);
  if (!franja.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw new Error('El Peruano did not return the RVM 016 official PDF artifact.');
  }
  const minceturText = minceturIndiaStatus.toString('utf8').toLowerCase();
  if (!['acuerdo comercial perú', 'india', 'en negociación', 'ministerio de comercio exterior'].every((token) => minceturText.includes(token))) {
    throw new Error('MINCETUR did not return the reviewed Peru–India agreement inventory page.');
  }
  const manifest = {
    acquisition_version: PERU_ACQUISITION_VERSION,
    artifacts: [
      { name: 'sunat-tariff.zip', role: 'official_consolidated_tariff', url: PERU_TARIFF_URL, size_bytes: tariff.length, sha256: sha256(tariff) },
      { name: 'franja-resolution.pdf', role: 'official_price_band_resolution', url: PERU_FRANJA_URL, landing_url: PERU_FRANJA_LANDING_URL, size_bytes: franja.length, sha256: sha256(franja) },
      { name: 'mincetur-india-agreement-status.html', role: 'official_trade_agreement_inventory_status', url: PERU_MINCETUR_INDIA_STATUS_URL, size_bytes: minceturIndiaStatus.length, sha256: sha256(minceturIndiaStatus) },
    ],
    legal_decision: {
      identifier: 'RVM 016-2026-EF/15.01',
      publication_date: '2026-08-20',
      effective_from: '2026-08-20',
      effective_to: '2026-12-31',
    },
    india_preference_evidence: {
      authority: 'Ministerio de Comercio Exterior y Turismo del Perú (MINCETUR)',
      artifact: 'mincetur-india-agreement-status.html',
      page_title: 'Acuerdo Comercial Perú – India — Sobre la negociación',
      observed_inventory_section: 'En negociación',
      assessment: 'no_operative_preferential_agreement_identified',
      temporal_context: 'Observed on acquisition; TaricRelease.retrieved_at and reference_date record the reproducible retrieval and release context.',
    },
  };
  const zip = new JSZip();
  const stable = { date: new Date('1980-01-01T00:00:00.000Z'), createFolders: false } as const;
  zip.file('sunat-tariff.zip', tariff, stable);
  zip.file('franja-resolution.pdf', franja, stable);
  zip.file('mincetur-india-agreement-status.html', minceturIndiaStatus, stable);
  zip.file('acquisition.json', JSON.stringify(manifest, null, 2), stable);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', platform: 'UNIX' });
}
