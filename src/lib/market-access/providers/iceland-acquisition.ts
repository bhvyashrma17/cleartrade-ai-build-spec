import { createHash } from 'node:crypto';
import JSZip from 'jszip';

export const ICELAND_ACQUISITION_VERSION = 'skatturinn-tollskrarlyklar-acquisition-v1' as const;
export const ICELAND_KEYS_URL = 'https://www.skatturinn.is/media/tollamal/TSKINN01092026.zip' as const;
export const ICELAND_KEYS_PAGE_URL = 'https://www.skatturinn.is/fagadilar/tollamal/hugbunadarhus/tollskrarlyklar/' as const;
export const ICELAND_LAYOUT_URL = 'https://www.skatturinn.is/media/annad/Tollskrarlyklar_INNFL_Faerslulysing_01_03_2013.pdf' as const;
export const ICELAND_DRAWING_URL = 'https://www.skatturinn.is/media/annad/Tollsk_Faerslut_2013_INN.pdf' as const;
export const ICELAND_DEVIATIONS_URL = 'https://www.skatturinn.is/media/annad/tollskrarlyklar_fyrirvarar_fravik.pdf' as const;
export const ICELAND_PRINTED_TARIFF_URL = 'https://www.skatturinn.is/media/tollamal/Tollskra-2022-3.pdf' as const;
export const ICELAND_TEPA_NOTICE_URL = 'https://www.skatturinn.is/fagadilar/tollamal/hugbunadarhus/tilkynningar-til-hugbunadarhusa/tollskrarlyklar-med-gildistoku-1.-oktober-2025-friverslunarsamningur-vid-indland-og-fleira' as const;
export const ICELAND_SOFTWARE_GUIDE_URL = 'https://www.skatturinn.is/media/annad/SAD_SMT_Tollskyrsluforrit-innfl-villuprof.pdf' as const;

const ALLOWED_HOST = 'www.skatturinn.is';
const MAX_SOURCE_BYTES = 32 * 1024 * 1024;

export function icelandKeysUrlForRelease(releaseIdentifier: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(releaseIdentifier);
  if (!match) throw new Error('Iceland release_identifier must be an ISO date.');
  return `https://${ALLOWED_HOST}/media/tollamal/TSKINN${match[3]}${match[2]}${match[1]}.zip`;
}

function officialUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== ALLOWED_HOST) {
    throw new Error(`Iceland authority acquisition only accepts HTTPS sources from ${ALLOWED_HOST}.`);
  }
  return url.toString();
}

async function fetchOfficialBytes(url: string, options: { fetch_impl?: typeof fetch; attempts?: number }) {
  const fetchImpl = options.fetch_impl ?? fetch;
  const attempts = options.attempts ?? 3;
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(officialUrl(url), {
        headers: { accept: '*/*', 'user-agent': 'ClearTrade-Customs-Atlas/1.0' },
        signal: AbortSignal.timeout(90_000),
      });
      if (!response.ok) {
        if (response.status !== 429 && response.status < 500) throw new Error(`Skatturinn returned non-retryable HTTP ${response.status} for ${url}.`);
        throw new Error(`Skatturinn returned retryable HTTP ${response.status} for ${url}.`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw new Error(`Skatturinn returned an empty response for ${url}.`);
      if (bytes.length > MAX_SOURCE_BYTES) throw new Error(`Skatturinn response exceeded ${MAX_SOURCE_BYTES} bytes for ${url}.`);
      return bytes;
    } catch (error) {
      last = error;
      if (attempt === attempts || /non-retryable|exceeded/.test(String(error))) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    }
  }
  throw last;
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/**
 * Retain the executable keys, their official schema/limitations, the controlling printed tariff,
 * the authority's software-use statement and the India-TEPA notice as one immutable release.
 */
export async function acquireIcelandAuthorityBundle(options: { fetch_impl?: typeof fetch; attempts?: number; release_identifier?: string; keys_url?: string } = {}) {
  const releaseIdentifier = options.release_identifier ?? '2026-09-01';
  const keysUrl = options.keys_url ?? icelandKeysUrlForRelease(releaseIdentifier);
  const sources = [
    ['tariff-keys.zip', 'official_effective_dated_tariff_keys', keysUrl],
    ['keys-publication.html', 'official_release_index_and_history', ICELAND_KEYS_PAGE_URL],
    ['record-layout.pdf', 'official_fixed_width_field_dictionary_and_reuse_statement', ICELAND_LAYOUT_URL],
    ['record-drawing.pdf', 'official_fixed_width_record_drawing', ICELAND_DRAWING_URL],
    ['known-deviations.pdf', 'official_scope_and_deviation_statement', ICELAND_DEVIATIONS_URL],
    ['printed-tariff.pdf', 'official_controlling_tariff_with_descriptions', ICELAND_PRINTED_TARIFF_URL],
    ['india-tepa-notice.html', 'official_india_tepa_effective_date_and_origin_conditions', ICELAND_TEPA_NOTICE_URL],
    ['software-guide.pdf', 'official_free_use_statement_for_customs_software', ICELAND_SOFTWARE_GUIDE_URL],
  ] as const;
  const artifacts = await Promise.all(sources.map(async ([name, role, url]) => {
    const bytes = await fetchOfficialBytes(url, options);
    return { name, role, url: officialUrl(url), bytes };
  }));

  const keys = artifacts.find((item) => item.name === 'tariff-keys.zip')!.bytes;
  if (!keys.subarray(0, 2).equals(Buffer.from('PK'))) throw new Error('Skatturinn did not return the reviewed tariff-key ZIP artifact.');
  for (const artifact of artifacts.filter((item) => item.name.endsWith('.pdf'))) {
    if (!artifact.bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error(`Skatturinn did not return a PDF for ${artifact.name}.`);
  }
  const tepaText = artifacts.find((item) => item.name === 'india-tepa-notice.html')!.bytes.toString('utf8').toLowerCase();
  if (!tepaText.includes('indland') || !tepaText.includes('1. okt')) throw new Error('Skatturinn did not return the reviewed India-TEPA notice.');

  const manifest = {
    acquisition_version: ICELAND_ACQUISITION_VERSION,
    release_identifier: releaseIdentifier,
    effective_from: releaseIdentifier,
    artifacts: artifacts.map(({ name, role, url, bytes }) => ({ name, role, url, size_bytes: bytes.length, sha256: sha256(bytes) })),
    rights_evidence: {
      artifact: 'record-layout.pdf',
      statement: 'The authority permits use of the text file in customs-declaration software and other similar uses.',
      corroborating_artifact: 'software-guide.pdf',
    },
    india_preference_evidence: {
      authority_code: 'YX',
      agreement: 'EFTA–India Trade and Economic Partnership Agreement',
      effective_from: '2025-10-01',
      requires_origin_proof: true,
      artifact: 'india-tepa-notice.html',
    },
  };
  const bundle = new JSZip();
  const stable = { date: new Date('1980-01-01T00:00:00.000Z'), createFolders: false } as const;
  for (const artifact of artifacts) bundle.file(artifact.name, artifact.bytes, stable);
  bundle.file('acquisition.json', JSON.stringify(manifest, null, 2), stable);
  return Buffer.from(await bundle.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', platform: 'UNIX' }));
}
