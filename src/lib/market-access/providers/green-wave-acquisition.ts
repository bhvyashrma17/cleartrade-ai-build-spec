import { createHash } from 'node:crypto';
import { buildPdfAuthorityBundle, extractPdfTablePages, parsePdfTablePages, type AmendmentOperation, type BundleArtifact, type PdfTariffLine } from './pdf-table-family';
import { GREEN_WAVE_CONFIGS, GREEN_WAVE_SCOPE, type GreenWaveConfig, type GreenWaveCountry } from './green-wave-config';

const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;
const ALLOWED_HOSTS = new Set(['giwmscdnone.gov.np', 'repository.lawcommission.gov.np', 'www.commerce.gov.in', 'www.drc.gov.bt', 'www.moice.gov.bt', 'dogana.gov.al', 'www.wipo.int', 'www.mra.mu', 'www.govmu.org']);
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function authorityUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) throw new Error(`Green-wave acquisition does not accept ${url.hostname}.`);
  return url.toString();
}

async function fetchBytes(url: string, fetchImpl: typeof fetch, attempts: number) {
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(authorityUrl(url), { headers: { accept: '*/*', connection: 'close', 'user-agent': 'ClearTrade-Customs-Atlas/1.0' }, signal: AbortSignal.timeout(180_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_ARTIFACT_BYTES) throw new Error(`invalid byte length ${bytes.length}`);
      return bytes;
    } catch (error) {
      last = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }
  throw new Error(`Authority acquisition failed for ${url} after ${attempts} attempt(s): ${last instanceof Error ? last.message : String(last)}`, { cause: last });
}

const MAURITIUS_AMENDMENT_PROFILE = {
  country_code: 'MU', label: 'Mauritius 4 September 2026 VAT amendment annex', expected_pdf_pages: 1,
  table_first_page: 1, table_last_page: 1, expected_line_count: 6,
  code_pattern: /^\d{4}\.\d{2}\.\d{2}$/, code_header: /^H\.S\. Code$/i, description_header: /^Description$/i, unit_header: /^(?:Unit|Statistical)$/i,
  columns: [
    { key: 'general', header: /^General$/i, required: true },
    { key: 'excise_duty', header: /^Excise$/i, right_header: /^Levy$/i, required: false },
    { key: 'vat', header: /^VAT$/i, required: true },
    { key: 'india', header: /^INDIA$/i, required: true },
  ], code_tolerance_points: 28, effective_from: '2026-09-04',
} as const;

function applyMauritiusAmendments(lines: ReadonlyMap<string, PdfTariffLine>, replacements: ReadonlyMap<string, PdfTariffLine>) {
  const current = new Map(lines);
  const operations: AmendmentOperation[] = [];
  for (const replacement of replacements.values()) {
    const baseline = current.get(replacement.code);
    if (!baseline) throw new Error(`Mauritius VAT amendment replaces ${replacement.code}, which is absent from the retained 13 August baseline.`);
    const merged: PdfTariffLine = {
      ...baseline, description: replacement.description, cells: { ...baseline.cells, ...replacement.cells },
      raw_cells: { ...baseline.raw_cells, ...replacement.raw_cells }, source_pages: [...baseline.source_pages],
    };
    current.set(replacement.code, merged);
    operations.push({ operation: 'REPLACE', code: replacement.code, publication_date: '2026-09-04', effective_from: '2026-09-04',
      precedence: operations.length + 1, source_artifact: 'annex-vat-2026-09-04.pdf', cells: { ...replacement.raw_cells }, description: replacement.description });
  }
  return { lines: current, operations };
}

export async function acquireGreenWaveAuthorityBundle(country: GreenWaveCountry, options: { fetch_impl?: typeof fetch; attempts?: number; release_identifier?: string } = {}) {
  const config: GreenWaveConfig = GREEN_WAVE_CONFIGS[country];
  const fetchImpl = options.fetch_impl ?? fetch;
  const attempts = options.attempts ?? 3;
  const releaseIdentifier = options.release_identifier ?? '2026-09-15';
  if (!/^2026-\d{2}-\d{2}$/.test(releaseIdentifier)) throw new Error(`${country} release_identifier must be a 2026 ISO acquisition date.`);
  const artifacts: BundleArtifact[] = [];
  for (const source of config.artifacts) {
    const bytes = source.kind === 'evidence_json'
      ? Buffer.from(`${JSON.stringify({ source_url: authorityUrl(source.url), ...source.evidence }, null, 2)}\n`)
      : await fetchBytes(source.url, fetchImpl, attempts);
    if (source.kind === 'pdf' && !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error(`${source.name} is not a PDF artifact.`);
    artifacts.push({ name: source.name, role: source.role, url: authorityUrl(source.url), bytes });
  }
  const tariff = artifacts[0]!.bytes;
  if (sha256(tariff) !== config.tariff_sha256) throw new Error(`${config.profile.label} checksum changed from the reviewed ${config.tariff_sha256}.`);
  let lines = parsePdfTablePages(config.profile, await extractPdfTablePages(tariff), config.currency);
  let operations: AmendmentOperation[] = [];
  if (country === 'MU') {
    const annex = artifacts.find((artifact) => artifact.name === 'annex-vat-2026-09-04.pdf')!;
    const replacements = parsePdfTablePages(MAURITIUS_AMENDMENT_PROFILE, await extractPdfTablePages(annex.bytes), config.currency);
    const applied = applyMauritiusAmendments(lines, replacements);
    lines = applied.lines;
    operations = applied.operations;
  }
  return buildPdfAuthorityBundle({ family: config.family, profile: config.profile, release_identifier: releaseIdentifier,
    source_url: config.tariff_url, artifacts, lines, amendments: operations, rights_evidence: config.rights_evidence,
    preference_evidence: config.preference_evidence, scope: GREEN_WAVE_SCOPE });
}

export const acquireNepalAuthorityBundle = (options?: Parameters<typeof acquireGreenWaveAuthorityBundle>[1]) => acquireGreenWaveAuthorityBundle('NP', options);
export const acquireBhutanAuthorityBundle = (options?: Parameters<typeof acquireGreenWaveAuthorityBundle>[1]) => acquireGreenWaveAuthorityBundle('BT', options);
export const acquireAlbaniaAuthorityBundle = (options?: Parameters<typeof acquireGreenWaveAuthorityBundle>[1]) => acquireGreenWaveAuthorityBundle('AL', options);
export const acquireMauritiusAuthorityBundle = (options?: Parameters<typeof acquireGreenWaveAuthorityBundle>[1]) => acquireGreenWaveAuthorityBundle('MU', options);
