import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { OMAN_EXPECTED_PHYSICAL_ROWS, OMAN_EXPECTED_UNIQUE_CODES, parseOmanPdfPages, serializeOmanLines, type OmanPdfPage, type OmanTariffLine } from './oman-bundle';

export const OMAN_ACQUISITION_VERSION = 'rop-customs-tariff-acquisition-v2' as const;
export const OMAN_TARIFF_URL = 'https://www.customs.gov.om/media/gmglqkjb/2026-4.pdf' as const;
export const OMAN_USER_GUIDES_URL = 'https://www.customs.gov.om/en/user-guides/' as const;
export const OMAN_ANTIDUMPING_URL = 'https://www.customs.gov.om/media/hf4h01cy/imposing-final-anti-dumping-duties-against-imports-of-the-gcc-countries-on-products-of-ceramic-and-porcelain-tiles-exported-from-china-and-india.xlsx' as const;
export const OMAN_ANTIDUMPING_CURRENT_URL = 'https://www.customs.gov.om/media/uiibi3km/ceramic-dumping-list-3.pdf' as const;
export const GCC_ANTIDUMPING_EXTENSION_URL = 'https://www.gcc-sg.org/ar/JointGulf/Cooperation/TSAD/DocLib/%D8%A7%D9%84%D9%86%D8%B4%D8%B1%D8%A9%20%D8%A7%D9%84%D8%B1%D8%B3%D9%85%D9%8A%D8%A9%20%D8%A7%D9%84%D8%B9%D8%AF%D8%AF%2055%20%D8%A7%D9%84%D9%85%D8%B9%D8%AF%D9%84%D8%A9.pdf' as const;
export const OMAN_CEPA_URL = 'https://www.customs.gov.om/ar/agreements/cepa/' as const;
export const OMAN_CEPA_ROO_URL = 'https://www.commerce.gov.in/files/2025-12/7.-Chapter-3-Rules-Of-Origin.pdf' as const;
export const OMAN_CEPA_PSR_URL = 'https://www.commerce.gov.in/files/2025-12/9.-Annex-3B-Product-Specific-Rules.pdf' as const;
export const OMAN_COPYRIGHT_URL = 'https://www.wipo.int/wipolex/en/text/589897' as const;

const ALLOWED_HOSTS = new Set(['www.customs.gov.om', 'www.commerce.gov.in', 'www.gcc-sg.org', 'www.wipo.int']);
const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
const RANGE_CHUNK_BYTES = 1024 * 1024;
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function officialUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) throw new Error(`Oman authority acquisition does not accept ${url.hostname}.`);
  return url.toString();
}

async function fetchBytes(url: string, options: { fetch_impl?: typeof fetch; attempts?: number }) {
  const fetchImpl = options.fetch_impl ?? fetch;
  const attempts = options.attempts ?? 3;
  if (url === OMAN_TARIFF_URL) {
    try { return await fetchOmanTariffByRange(fetchImpl, attempts); }
    catch (error) { throw new Error(`Oman authority acquisition failed for ${url}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
  }
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(officialUrl(url), { headers: { accept: '*/*', connection: 'close', 'user-agent': 'ClearTrade-Customs-Atlas/1.0' }, signal: AbortSignal.timeout(120_000) });
      if (!response.ok) {
        if (response.status !== 429 && response.status < 500) throw new Error(`Oman source returned non-retryable HTTP ${response.status} for ${url}.`);
        throw new Error(`Oman source returned retryable HTTP ${response.status} for ${url}.`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw new Error(`Oman source returned an empty response for ${url}.`);
      if (bytes.length > MAX_SOURCE_BYTES) throw new Error(`Oman source exceeded ${MAX_SOURCE_BYTES} bytes for ${url}.`);
      return bytes;
    } catch (error) {
      last = error;
      if (attempt === attempts || /non-retryable|exceeded/.test(String(error))) {
        throw new Error(`Oman authority acquisition failed for ${url} after ${attempt} attempt(s): ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 350));
    }
  }
  throw last;
}

async function fetchOmanTariffByRange(fetchImpl: typeof fetch, attempts: number) {
  const url = officialUrl(OMAN_TARIFF_URL);
  const baseHeaders = { accept: 'application/pdf', connection: 'close', 'user-agent': 'ClearTrade-Customs-Atlas/1.0' };
  const head = await fetchImpl(url, { method: 'HEAD', headers: baseHeaders, signal: AbortSignal.timeout(30_000) });
  if (!head.ok) throw new Error(`Oman source returned ${head.status >= 500 || head.status === 429 ? 'retryable' : 'non-retryable'} HTTP ${head.status} for ${url}.`);
  const size = Number(head.headers.get('content-length'));
  const etag = head.headers.get('etag');
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_SOURCE_BYTES || head.headers.get('accept-ranges')?.toLowerCase() !== 'bytes') {
    throw new Error(`Oman tariff source did not publish the reviewed bounded byte-range contract for ${url}.`);
  }
  const chunks: Buffer[] = [];
  for (let start = 0; start < size; start += RANGE_CHUNK_BYTES) {
    const end = Math.min(size - 1, start + RANGE_CHUNK_BYTES - 1);
    let chunk: Buffer | null = null;
    let last: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await fetchImpl(url, {
          headers: { ...baseHeaders, range: `bytes=${start}-${end}`, ...(etag ? { 'if-range': etag } : {}) },
          signal: AbortSignal.timeout(60_000),
        });
        const expectedContentRange = `bytes ${start}-${end}/${size}`;
        if (response.status !== 206 || response.headers.get('content-range') !== expectedContentRange) {
          throw new Error(`Oman tariff range ${start}-${end} returned HTTP ${response.status} / ${response.headers.get('content-range') ?? 'no content-range'}.`);
        }
        if (etag && response.headers.get('etag') && response.headers.get('etag') !== etag) throw new Error('Oman tariff ETag changed during ranged acquisition.');
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length !== end - start + 1) throw new Error(`Oman tariff range ${start}-${end} returned ${bytes.length} bytes.`);
        chunk = bytes;
        break;
      } catch (error) {
        last = error;
        if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 350));
      }
    }
    if (!chunk) throw last;
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.length !== size) throw new Error(`Oman tariff ranged acquisition assembled ${bytes.length} bytes instead of ${size}.`);
  return bytes;
}

function retainedFragment(bytes: Buffer, startMarker: string, endMarker: string, label: string) {
  const html = bytes.toString('utf8').replace(/\r\n?/g, '\n');
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`Oman source did not return the reviewed ${label} structure.`);
  return canonicalHtml(html.slice(start, end + endMarker.length));
}

function canonicalHtml(value: string) {
  const canonical = value
    .replace(/<!--([\s\S]*?)-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/\s(?:nonce|integrity|data-request-id|data-timestamp)=(['"])[\s\S]*?\1/gi, '')
    .replace(/>\s+</g, '><')
    .replace(/[ \t]+/g, ' ')
    .trim();
  return Buffer.from(`${canonical}\n`, 'utf8');
}

function retainedCopyrightArticle(bytes: Buffer) {
  const html = bytes.toString('utf8').replace(/\r\n?/g, '\n');
  const start = html.indexOf('Article (4):');
  const end = html.indexOf('Chapter III', start);
  if (start < 0 || end < 0) throw new Error('WIPO Lex did not return the reviewed Oman Copyright Law article 4 structure.');
  const text = html.slice(start, end)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (!text.includes('data.') || !text.includes('Official documents')) throw new Error('WIPO Lex changed the reviewed Oman Copyright Law article 4 text.');
  return Buffer.from(`${text}\n`, 'utf8');
}

function retainedUserGuideTables(bytes: Buffer) {
  const html = bytes.toString('utf8').replace(/\r\n?/g, '\n');
  const start = html.indexOf('<h4>Customs Tariff</h4>');
  const fees = html.indexOf('<h4>Customs fees</h4>', start);
  const end = html.indexOf('</table>', fees);
  if (start < 0 || fees < 0 || end < 0) throw new Error('Oman Customs did not return the reviewed tariff and customs-fee index.');
  const retained = html.slice(start, end + '</table>'.length);
  if (!retained.includes('/media/gmglqkjb/2026-4.pdf') || !retained.includes('anti-dumping')) throw new Error('Oman Customs changed the reviewed current-source index.');
  return canonicalHtml(retained);
}

async function extractPdfPages(bytes: Buffer): Promise<OmanPdfPage[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0, useSystemFonts: true }).promise;
  if (document.numPages !== 315) throw new Error(`Oman Customs Tariff 2026 changed from the reviewed 315-page layout to ${document.numPages} pages.`);
  const pages: OmanPdfPage[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const content = await (await document.getPage(pageNumber)).getTextContent();
    pages.push({ page_number: pageNumber, items: content.items.flatMap((item) => 'str' in item && item.str ? [{ str: item.str, x: item.transform[4], y: item.transform[5] }] : []) });
  }
  return pages;
}

async function extractPdfText(bytes: Buffer, expectedPages: number, label: string) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0, useSystemFonts: true }).promise;
  if (document.numPages !== expectedPages) throw new Error(`${label} changed from the reviewed ${expectedPages}-page layout to ${document.numPages} pages.`);
  const chunks: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const content = await (await document.getPage(pageNumber)).getTextContent();
    chunks.push(content.items.flatMap((item) => 'str' in item ? [item.str] : []).join(' '));
  }
  return chunks.join('\n').replace(/\s+/g, ' ');
}

async function validateAntiDumpingCrossCheck(bytes: Buffer, lines: ReadonlyMap<string, OmanTariffLine>) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  if (workbook.worksheets.length !== 1) throw new Error('Oman anti-dumping workbook changed from the reviewed one-sheet layout.');
  const sheet = workbook.worksheets[0]!;
  const measures = [] as Array<{ hs8: string; rate: number }>;
  for (let rowNumber = 4; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const hs8 = String(row.getCell(2).value ?? '').replace(/\s/g, '');
    const rawRate = row.getCell(8).value;
    if (!/^69072[123]00$/.test(hs8) || typeof rawRate !== 'number') throw new Error(`Oman anti-dumping workbook row ${rowNumber} changed from the reviewed measure schema.`);
    measures.push({ hs8, rate: Number((rawRate * 100).toFixed(1)) });
  }
  if (measures.length !== 27) throw new Error(`Oman anti-dumping workbook contains ${measures.length} measures instead of the reviewed 27.`);
  const workbookExpectedRates = [0, 17.6, 23.5, 23.5, 37, 41.2, 53, 58, 70];
  const tariffExpectedRates = [0, 17.6, 23.5, 23.5, 37, 41.2, 53, 58, 70.2];
  for (const hs8 of ['69072100', '69072200', '69072300']) {
    const workbookRates = measures.filter((item) => item.hs8 === hs8).map((item) => item.rate).sort((a, b) => a - b);
    if (JSON.stringify(workbookRates) !== JSON.stringify(workbookExpectedRates)) throw new Error(`Oman anti-dumping workbook changed the reviewed rate set for ${hs8}.`);
    const tariffRates = [...lines.values()].filter((line) => line.code.startsWith(hs8.slice(0, 6)) && line.additional_duty?.kind === 'ad_valorem')
      .map((line) => line.additional_duty!.ad_valorem_rate_percent).filter((rate): rate is number => rate != null);
    if (!tariffExpectedRates.every((rate) => tariffRates.includes(rate))) throw new Error(`Oman tariff PDF and anti-dumping workbook no longer cross-check for ${hs8}.`);
  }
  if (!lines.has('690721000908') || !lines.has('690722000908') || !lines.has('690723000908')) {
    throw new Error('Oman tariff PDF no longer retains all reviewed India-producer anti-dumping sublines.');
  }
}

export async function acquireOmanAuthorityBundle(options: { fetch_impl?: typeof fetch; attempts?: number; release_identifier?: string } = {}) {
  const releaseIdentifier = options.release_identifier ?? '2026-09-14';
  if (!/^2026-\d{2}-\d{2}$/.test(releaseIdentifier)) throw new Error('Oman release_identifier must be a 2026 ISO acquisition date.');
  const sources = [
    ['customs-tariff-2026.pdf', 'official_consolidated_national_tariff', OMAN_TARIFF_URL],
    ['anti-dumping-current.pdf', 'official_current_national_trade_remedy_schedule', OMAN_ANTIDUMPING_CURRENT_URL],
    ['gcc-anti-dumping-extension-55.pdf', 'official_gcc_trade_remedy_extension_instrument', GCC_ANTIDUMPING_EXTENSION_URL],
    ['anti-dumping-tiles.xlsx', 'official_national_trade_remedy_legacy_cross_check', OMAN_ANTIDUMPING_URL],
    ['user-guides.html', 'official_current_tariff_and_customs_fee_index', OMAN_USER_GUIDES_URL],
    ['india-cepa.html', 'official_effective_date_concession_and_origin_guidance', OMAN_CEPA_URL],
    ['india-cepa-rules-of-origin.pdf', 'official_agreement_rules_of_origin_chapter', OMAN_CEPA_ROO_URL],
    ['india-cepa-product-specific-rules.pdf', 'official_agreement_product_specific_rules', OMAN_CEPA_PSR_URL],
    ['copyright-law-article-4.txt', 'wipo_lex_reproduction_of_oman_law_article_4', OMAN_COPYRIGHT_URL],
  ] as const;
  // Fetch sequentially. Oman Customs accepts HEADs concurrently but has repeatedly stalled one
  // response body when several large GETs arrive together. Sequential acquisition is slower but
  // bounded and reproducible, and avoids treating a provider-side connection race as source drift.
  const artifacts: Array<{ name: typeof sources[number][0]; role: typeof sources[number][1]; url: string; bytes: Buffer }> = [];
  for (const [name, role, url] of sources) {
    let bytes = await fetchBytes(url, options);
    if (name === 'user-guides.html') bytes = retainedUserGuideTables(bytes);
    if (name === 'india-cepa.html') bytes = retainedFragment(bytes, '<div class="accordion">', '</section>', 'India CEPA');
    if (name === 'copyright-law-article-4.txt') bytes = retainedCopyrightArticle(bytes);
    artifacts.push({ name, role, url: officialUrl(url), bytes });
  }
  const tariff = artifacts.find((item) => item.name === 'customs-tariff-2026.pdf')!.bytes;
  const roo = artifacts.find((item) => item.name === 'india-cepa-rules-of-origin.pdf')!.bytes;
  const psr = artifacts.find((item) => item.name === 'india-cepa-product-specific-rules.pdf')!.bytes;
  const antiDumping = artifacts.find((item) => item.name === 'anti-dumping-tiles.xlsx')!.bytes;
  const antiDumpingCurrent = artifacts.find((item) => item.name === 'anti-dumping-current.pdf')!.bytes;
  const gccExtension = artifacts.find((item) => item.name === 'gcc-anti-dumping-extension-55.pdf')!.bytes;
  if (![tariff, roo, psr, antiDumpingCurrent, gccExtension].every((artifact) => artifact.subarray(0, 5).equals(Buffer.from('%PDF-')))) throw new Error('Oman/India/GCC authorities did not return the reviewed PDF artifacts.');
  if (!antiDumping.subarray(0, 2).equals(Buffer.from('PK'))) throw new Error('Oman Customs did not return the reviewed anti-dumping workbook.');
  const currentRemedyText = await extractPdfText(antiDumpingCurrent, 7, 'Oman Customs current ceramic anti-dumping schedule');
  if (!['Lexus Granito', '70.20%', 'SunShine Tiles', '37.00%', 'Comet Granito', '17.60%', '41.20%'].every((marker) => currentRemedyText.includes(marker))) {
    throw new Error('Oman Customs changed the reviewed current ceramic anti-dumping producer/rate schedule.');
  }
  const extensionText = await extractPdfText(gccExtension, 36, 'GCC Anti-Dumping Official Gazette 55');
  if (!['Lexus', '70.2', '37', '17.6', '41.2', 'CIF'].every((marker) => extensionText.includes(marker))) {
    throw new Error('GCC Official Gazette 55 changed from the reviewed ceramic anti-dumping extension and rate table.');
  }
  const cepa = artifacts.find((item) => item.name === 'india-cepa.html')!.bytes.toString('utf8');
  if (!cepa.includes('1 يونيو 2026') || !cepa.includes('30/2026') || !cepa.includes('(PSR)') || !cepa.includes('(WO)')) throw new Error('Oman Customs changed the reviewed India CEPA evidence.');
  const copyright = artifacts.find((item) => item.name === 'copyright-law-article-4.txt')!.bytes.toString('utf8');
  if (!copyright.includes('Article (4):') || !copyright.includes('Official documents')) throw new Error('Oman copyright source no longer contains the reviewed article 4 rule.');

  const parsed = parseOmanPdfPages(await extractPdfPages(tariff));
  if (parsed.physical_row_count !== OMAN_EXPECTED_PHYSICAL_ROWS || parsed.lines.size !== OMAN_EXPECTED_UNIQUE_CODES) throw new Error(`Oman Customs Tariff 2026 changed from the reviewed ${OMAN_EXPECTED_PHYSICAL_ROWS.toLocaleString('en')} physical rows / ${OMAN_EXPECTED_UNIQUE_CODES.toLocaleString('en')} unique codes to ${parsed.physical_row_count} / ${parsed.lines.size}.`);
  await validateAntiDumpingCrossCheck(antiDumping, parsed.lines);
  const normalized = serializeOmanLines(parsed);
  const all = [...artifacts, { name: 'normalized-lines.json' as const, role: 'deterministic_coordinate_parser_output' as const, url: OMAN_TARIFF_URL, bytes: normalized }];
  const manifest = {
    acquisition_version: OMAN_ACQUISITION_VERSION, release_identifier: releaseIdentifier,
    effective_from: '2026-01-01', acquired_as_current_on: releaseIdentifier,
    artifacts: all.map(({ name, role, url, bytes }) => ({ name, role, url, size_bytes: bytes.length, sha256: sha256(bytes) })),
    rights_evidence: { artifact: 'copyright-law-article-4.txt', law_article: 'Oman Copyright Law article 4', registry: 'WIPO Lex', official_oman_law_page: 'https://www.mjla.gov.om/laws/ar/1/show/93', rule: 'Bare data and official documents including laws, regulations, decisions, agreements and treaties are outside protection; original selection or arrangement can remain protected. No claim is made to website presentation, software, or a third-party database structure.' },
    trade_remedy_evidence: { measure: 'GCC ceramic and porcelain tile anti-dumping duty', original_effective_from: '2020-06-06', continued_from_original_expiry_for_five_years: true, current_rates_are_percent_of_cif: true, producer_or_exporter_identity_required: true, current_rate_authority: 'gcc-anti-dumping-extension-55.pdf', national_implementation_cross_check: 'anti-dumping-current.pdf', legacy_workbook_known_difference: 'Lexus is 70% in the legacy workbook but 70.2% in the 2026 GCC extension and current Oman schedule; current instruments control.' },
    india_preference_evidence: { agreement: 'Oman–India CEPA', effective_from: '2026-06-01', tariff_categories: ['A', 'B', 'C', 'E', 'X'], requires_origin_proof: true, origin_criterion_must_be_established_from_product_specific_rules: true, possible_rule_classes_not_qualification: ['WO', 'PSR'], artifacts: ['customs-tariff-2026.pdf', 'india-cepa.html', 'india-cepa-rules-of-origin.pdf', 'india-cepa-product-specific-rules.pdf'] },
    scope: { tariff_treatment_complete: true, regulatory_coverage_complete: false, omitted_regulatory_layer: 'The live permit/requirements search is not retained as a complete versioned release; absence of a parsed requirement is not no restriction.' },
  };
  const zip = new JSZip();
  const stable = { date: new Date('1980-01-01T00:00:00.000Z'), createFolders: false } as const;
  for (const artifact of all) zip.file(artifact.name, artifact.bytes, stable);
  zip.file('acquisition.json', JSON.stringify(manifest, null, 2), stable);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', platform: 'UNIX' }));
}
