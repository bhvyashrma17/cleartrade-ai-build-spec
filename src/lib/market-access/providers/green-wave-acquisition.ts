import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { buildPdfAuthorityBundle, extractPdfTablePages, parsePdfTablePages, type AmendmentOperation, type BundleArtifact, type PdfTariffLine } from './pdf-table-family';
import { GREEN_WAVE_CONFIGS, GREEN_WAVE_SCOPE, type GreenWaveConfig, type GreenWaveCountry } from './green-wave-config';

const MAX_ARTIFACT_BYTES = 80 * 1024 * 1024;
const ALLOWED_HOSTS = new Set([
  'giwmscdnone.gov.np', 'repository.lawcommission.gov.np', 'www.commerce.gov.in', 'www.drc.gov.bt',
  'www.moice.gov.bt', 'dogana.gov.al', 'www.wipo.int', 'www.mra.mu', 'www.govmu.org',
  'www.customs.gov.lk', 'www.treasury.gov.lk', 'documents.gov.lk', 'www.documents.gov.lk',
  'www.ird.gov.lk', 'www.nipo.gov.lk',
]);
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

const SRI_LANKA_CHAPTER = /Chap_(\d{2})(?:N)?\.pdf$/i;

async function readSriLankaArchive(bytes: Buffer) {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes); }
  catch { throw new Error('Sri Lanka tariff artifact is not a readable ZIP archive.'); }
  const members = Object.values(zip.files).filter((entry) => !entry.dir);
  if (members.length !== 150) throw new Error(`Sri Lanka tariff archive contains ${members.length} files; expected the reviewed 150-member archive.`);
  for (const entry of members) {
    const original = (entry as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name;
    if (original.startsWith('/') || original.startsWith('\\') || original.split(/[\\/]/).includes('..')) throw new Error(`Sri Lanka tariff archive contains an unsafe member path: ${original}.`);
  }
  const manifest = [] as Array<{ name: string; size_bytes: number; sha256: string }>;
  for (const entry of [...members].sort((a, b) => a.name.localeCompare(b.name))) {
    const memberBytes = Buffer.from(await entry.async('nodebuffer'));
    manifest.push({ name: entry.name, size_bytes: memberBytes.length, sha256: sha256(memberBytes) });
  }
  const chapters = members.flatMap((entry) => {
    const match = SRI_LANKA_CHAPTER.exec(entry.name);
    return match ? [{ chapter: Number(match[1]), entry }] : [];
  }).sort((a, b) => a.chapter - b.chapter);
  const expectedChapters = Array.from({ length: 97 }, (_, index) => index + 1);
  if (chapters.map((item) => item.chapter).join(',') !== expectedChapters.join(',')) throw new Error('Sri Lanka tariff archive does not contain exactly one reviewed PDF for every chapter 01–97.');
  const pages = [] as Awaited<ReturnType<typeof extractPdfTablePages>>;
  let pageNumber = 0;
  for (const chapter of chapters) {
    const chapterBytes = Buffer.from(await chapter.entry.async('nodebuffer'));
    if (!chapterBytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error(`Sri Lanka chapter ${chapter.chapter} is not a PDF artifact.`);
    const chapterPages = await extractPdfTablePages(chapterBytes);
    for (const [index, page] of chapterPages.entries()) pages.push({ ...page, page_number: ++pageNumber, document_start: index === 0 });
  }
  if (pages.length !== 641) throw new Error(`Sri Lanka chapter PDFs contain ${pages.length} physical pages; expected 641.`);
  return {
    pages,
    memberManifest: Buffer.from(`${JSON.stringify({ archive_sha256: sha256(bytes), member_count: manifest.length, chapter_pdf_count: chapters.length, physical_page_count: pages.length, members: manifest }, null, 2)}\n`),
  };
}

function sriLankaAmendments(): AmendmentOperation[] {
  return [
    {
      operation: 'ADD', code: '87', publication_date: '2026-05-15', effective_from: '2026-05-16', effective_to: '2026-08-14', precedence: 1,
      source_artifact: 'gazette-2488-56.pdf', classification: 'TARIFF_AFFECTING', cells: { surcharge: '50% of applicable Customs Import Duty' },
      description: 'Revenue Protection Order No. 01/2026 vehicle surcharge', conditions: { schedule_scoped: true, pre_existing_letter_of_credit_exception: true },
    },
    {
      operation: 'AMEND_APPLICABILITY', code: '87', publication_date: '2026-05-17', effective_from: '2026-05-18', effective_to: '2026-08-14', precedence: 2,
      source_artifact: 'gazette-2488-69.pdf', classification: 'TARIFF_AFFECTING', cells: {},
      description: 'Gazette 2488/69 changes whether the 50% surcharge applies; it does not create another surcharge.',
      conditions: { amends_source_artifact: 'gazette-2488-56.pdf', numeric_rate_unchanged: true, letter_of_credit_vehicle_quantity_vin_model_and_year_conditions_amended: true },
    },
    {
      operation: 'REPLACE', code: '87', publication_date: '2026-08-14', effective_from: '2026-08-15', effective_to: '2026-12-31', precedence: 3,
      source_artifact: 'gazette-2501-88.pdf', classification: 'TARIFF_AFFECTING', cells: { surcharge: '50% of applicable Customs Import Duty' },
      description: 'Gazette 2501/88 replaces the expiring vehicle-surcharge period through 31 December 2026.',
      conditions: { schedule_scoped: true, letter_of_credit_and_on_board_date_conditions: true, numeric_rate_unchanged: true },
    },
  ];
}

export async function acquireGreenWaveAuthorityBundle(country: GreenWaveCountry, options: { fetch_impl?: typeof fetch; attempts?: number; release_identifier?: string } = {}) {
  const config: GreenWaveConfig = GREEN_WAVE_CONFIGS[country];
  const fetchImpl = options.fetch_impl ?? fetch;
  const attempts = options.attempts ?? 3;
  const releaseIdentifier = options.release_identifier ?? '2026-09-15';
  if (!/^2026-\d{2}-\d{2}$/.test(releaseIdentifier)) throw new Error(`${country} release_identifier must be a 2026 ISO acquisition date.`);
  const artifacts: BundleArtifact[] = [];
  let sriLankaArchive: Awaited<ReturnType<typeof readSriLankaArchive>> | null = null;
  for (const source of config.artifacts) {
    let bytes: Buffer;
    if (source.kind === 'evidence_json') bytes = Buffer.from(`${JSON.stringify({ source_url: authorityUrl(source.url), ...source.evidence }, null, 2)}\n`);
    else if (source.kind === 'generated_member_manifest') {
      const archive = artifacts.find((artifact) => artifact.name === 'import-tariff-guide-2026-05-16.zip');
      if (!archive) throw new Error('Sri Lanka member manifest cannot be generated before the tariff archive is retained.');
      sriLankaArchive ??= await readSriLankaArchive(archive.bytes);
      bytes = sriLankaArchive.memberManifest;
    } else bytes = await fetchBytes(source.url, fetchImpl, attempts);
    if (source.kind === 'pdf' && !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error(`${source.name} is not a PDF artifact.`);
    if (source.kind === 'zip' && !bytes.subarray(0, 2).equals(Buffer.from('PK'))) throw new Error(`${source.name} is not a ZIP artifact.`);
    artifacts.push({ name: source.name, role: source.role, url: authorityUrl(source.url), bytes });
  }
  const tariff = artifacts[0]!.bytes;
  if (sha256(tariff) !== config.tariff_sha256) throw new Error(`${config.profile.label} checksum changed from the reviewed ${config.tariff_sha256}.`);
  let lines = parsePdfTablePages(config.profile, country === 'LK' ? (sriLankaArchive ??= await readSriLankaArchive(tariff)).pages : await extractPdfTablePages(tariff), config.currency);
  let operations: AmendmentOperation[] = [];
  if (country === 'MU') {
    const annex = artifacts.find((artifact) => artifact.name === 'annex-vat-2026-09-04.pdf')!;
    const replacements = parsePdfTablePages(MAURITIUS_AMENDMENT_PROFILE, await extractPdfTablePages(annex.bytes), config.currency);
    const applied = applyMauritiusAmendments(lines, replacements);
    lines = applied.lines;
    operations = applied.operations;
  }
  if (country === 'LK') operations = sriLankaAmendments();
  return buildPdfAuthorityBundle({ family: config.family, profile: config.profile, release_identifier: releaseIdentifier,
    source_url: config.tariff_url, artifacts, lines, amendments: operations, rights_evidence: config.rights_evidence,
    preference_evidence: config.preference_evidence, scope: GREEN_WAVE_SCOPE });
}

export const acquireNepalAuthorityBundle = (options?: Parameters<typeof acquireGreenWaveAuthorityBundle>[1]) => acquireGreenWaveAuthorityBundle('NP', options);
export const acquireBhutanAuthorityBundle = (options?: Parameters<typeof acquireGreenWaveAuthorityBundle>[1]) => acquireGreenWaveAuthorityBundle('BT', options);
export const acquireAlbaniaAuthorityBundle = (options?: Parameters<typeof acquireGreenWaveAuthorityBundle>[1]) => acquireGreenWaveAuthorityBundle('AL', options);
export const acquireMauritiusAuthorityBundle = (options?: Parameters<typeof acquireGreenWaveAuthorityBundle>[1]) => acquireGreenWaveAuthorityBundle('MU', options);
export const acquireSriLankaAuthorityBundle = (options?: Parameters<typeof acquireGreenWaveAuthorityBundle>[1]) => acquireGreenWaveAuthorityBundle('LK', options);
