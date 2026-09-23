import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import {
  KUWAIT_EXPECTED_SCHEDULE_CODES, KUWAIT_PARSER_VERSION, normalizeKuwaitCode, parseKuwaitDuty,
  type KuwaitTariffLine,
} from './kuwait-bundle';
import { KUWAIT_ACTIVE_TRADE_REMEDY_MANIFEST } from './kuwait-remedies';

export const KUWAIT_ACQUISITION_VERSION = 'kw-customs-public-acquisition-v1' as const;
export const KUWAIT_HSCODE_URL = 'https://www.customs.gov.kw/HSCode/HsCode' as const;
export const KUWAIT_PAGE_FILTER_URL = 'https://www.customs.gov.kw/HSCode/PageFilter' as const;
export const KUWAIT_INSTRUCTION_57_URL = 'https://www.customs.gov.kw/Content/Files/CustomsAnnouncement/7231296200_pdfFile.pdf' as const;
export const KUWAIT_KOREA_2017_URL = 'https://www.customs.gov.kw/Content/Files/CustomsAnnouncement/1022017.pdf' as const;
export const KUWAIT_KOREA_2023_URL = 'https://www.customs.gov.kw/Content/Files/CustomsAnnouncement/5186437000_pdfFile.pdf' as const;
export const KUWAIT_ALUMINIUM_2025_URL = 'https://www.customs.gov.kw/Content/Files/CustomsAnnouncement/1920828500_pdfFile.pdf' as const;
export const KUWAIT_CEMENT_CERAMIC_2025_URL = 'https://www.customs.gov.kw/Content/Files/CustomsAnnouncement/5570593100_pdfFile.pdf' as const;
export const KUWAIT_SANITARY_2025_URL = 'https://www.customs.gov.kw/Content/Files/CustomsAnnouncement/9204589100_pdfFile.pdf' as const;
export const KUWAIT_BATTERY_2026_URL = 'https://www.customs.gov.kw/Content/Files/CustomsAnnouncement/129236100_pdfFile.pdf' as const;
export const KUWAIT_STEEL_2024_URL = 'https://www.customs.gov.kw/Content/Files/CustomsAnnouncement/8748162300_pdfFile.pdf' as const;
export const KUWAIT_PAPERBOARD_EXPIRY_URL = 'https://www.customs.gov.kw/Content/Files/CustomsAnnouncement/4833562700_pdfFile.pdf' as const;
export const KUWAIT_RIGHTS_DETAILS_URL = 'https://www.wipo.int/wipolex/en/legislation/details/19908' as const;
export const KUWAIT_INDIA_GCC_FTA_STATUS_URL = 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2223875&reg=3&lang=1' as const;

const ALLOWED_HOSTS = new Set(['www.customs.gov.kw', 'customs.gov.kw', 'www.wipo.int', 'wipo.int', 'wipolex-res.wipo.int', 'www.pib.gov.in', 'pib.gov.in']);

/**
 * The Kuwait Copyright Law PDF (WIPO Lex, Arabic — Kuwait’s only submitted official text) is a
 * scanned/image document served only via a short-lived (~minutes) presigned URL that the legislation
 * details page regenerates on every visit. Byte-length + SHA-256 pinning (below) is therefore the
 * only stable content identity across acquisitions; the URL itself is never stable. Its Article 4
 * exclusion clause (ideas, procedures, methods, abstract facts, data, judicial pleadings) was
 * hand-verified from the page images during this acquisition’s research, since the PDF’s Arabic
 * text layer extracts with corrupted character encoding.
 */
const KUWAIT_RIGHTS_PDF_PIN = { bytes: 708_998, sha256: '9bca7c25bb88cc03159bc1e43892cca3f2ee94e3d35efd42cf00642f821e8263' };

/**
 * Kuwait Customs' remedy instructions are scanned/photocopied artifacts whose producer rate tables
 * were read directly from the page images and hand-verified during this acquisition (their own text
 * layer, where extractable at all, is unreliable for automated marker checks). Each is pinned by
 * exact byte-length and SHA-256 against the reviewed copy rather than verified by text markers.
 */
const KUWAIT_PINNED_SCANNED_ARTIFACTS: Record<string, { bytes: number; sha256: string }> = {
  'korea-2017.pdf': { bytes: 234_067, sha256: '0cc0c500b93e09f38c1c02e13a8bd05b3c067379eef1f1ef38e41a063bff95c3' },
  'korea-2023.pdf': { bytes: 5_435_593, sha256: '4d562e4e39b18be25280f427535edf81244ebdebc8e970481773b9363278725b' },
  'aluminium-2025.pdf': { bytes: 507_964, sha256: '76cd0c6cadf3fda04a9bd93a5cd83e877a1f96c7f1481c99248bdd75a74305d7' },
  'cement-ceramic-2025.pdf': { bytes: 2_397_649, sha256: '2ba261c0551307811f1623dc4ab0f2303d367683222b56303395ab5242c46feb' },
  'sanitary-2025.pdf': { bytes: 900_941, sha256: '5f43a9c4e0b7d8b98750ca5c086a9cfa7eb0d0cd26cbd744c2eb0c0a7687064c' },
  'battery-2026.pdf': { bytes: 4_300_814, sha256: '08cf525c5e8e986f6b6ee4ce5e363757031e357b9fa9fb62600a516ab33cf819' },
  'steel-2024.pdf': { bytes: 536_494, sha256: '1d8ad05b7ad6f60b87851ec01dbe98f8e44d8fe180e07d5f00bf8cb4b2ed1b34' },
  'paperboard-expiry.pdf': { bytes: 10_790_726, sha256: 'd34d80925958249df1610318ed23d149cc1a7c0028bd28d7df9e562c7fbc8144' },
};

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
export function kuwaitOfficialUrl(value: string) { const url = new URL(value); if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) throw new Error(`Kuwait authority acquisition rejects ${url.hostname}.`); return url.toString(); }

async function request(url: string, options: { fetch_impl: typeof fetch; attempts: number; init?: RequestInit; max_bytes?: number }) {
  let last: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      const response = await options.fetch_impl(kuwaitOfficialUrl(url), { ...options.init, headers: { accept: '*/*', 'user-agent': 'Mozilla/5.0 ClearTrade-Customs-Atlas/1.0', ...options.init?.headers }, signal: AbortSignal.timeout(60_000) });
      if (!response.ok) { if (response.status !== 429 && response.status < 500) throw new Error(`non-retryable HTTP ${response.status}`); throw new Error(`retryable HTTP ${response.status}`); }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw new Error('empty response');
      if (bytes.length > (options.max_bytes ?? 40 * 1024 * 1024)) throw new Error('response exceeded bounded size');
      return bytes;
    } catch (error) {
      last = error;
      if (attempt === options.attempts || /non-retryable|exceeded/.test(String(error))) throw new Error(`Kuwait authority acquisition failed for ${url} after ${attempt} attempt(s): ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      await new Promise(resolve => setTimeout(resolve, attempt * 350));
    }
  }
  throw last;
}

interface PortalRow { code: string; rate: string; description: string }
function parsePortalRows(html: string): PortalRow[] {
  const rows: PortalRow[] = [];
  const re = /DataSearch=([\d.]+)"[^>]*>[^<]*<\/a>\s*<\/td>\s*<td>\s*([^<]*?)\s*<\/td>\s*<td>([^<]*)<\/td>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) rows.push({ code: normalizeKuwaitCode(m[1]!), rate: clean(m[2]!), description: clean(m[3]!) });
  return rows;
}

/** Bounded-concurrency crawl of Kuwait's public HS Code portal. Pagination is stateless: each page number is a self-contained query, verified by requesting page N and asserting codes strictly follow page N-1's last code with no gap/overlap. */
async function crawlKuwaitSchedule(fetch_impl: typeof fetch, attempts: number) {
  const first = await request(KUWAIT_HSCODE_URL, { fetch_impl, attempts, max_bytes: 2 * 1024 * 1024 });
  const byPage = new Map<number, PortalRow[]>();
  byPage.set(1, parsePortalRows(first.toString('utf8')));
  const evidence: Array<{ page: number; rows: number; sha256: string }> = [{ page: 1, rows: byPage.get(1)!.length, sha256: sha256(first) }];

  const CONCURRENCY = 6, MAX_PAGE = 2000;
  let nextPage = 2, consecutiveEmpty = 0, highestNonEmptyPage = 1;
  async function worker() {
    for (;;) {
      const page = nextPage++;
      if (page > MAX_PAGE || consecutiveEmpty >= 3) return;
      const bytes = await request(`${KUWAIT_PAGE_FILTER_URL}?page=${page}`, { fetch_impl, attempts, max_bytes: 2 * 1024 * 1024 });
      const rows = parsePortalRows(bytes.toString('utf8'));
      byPage.set(page, rows);
      evidence.push({ page, rows: rows.length, sha256: sha256(bytes) });
      if (rows.length) { consecutiveEmpty = 0; highestNonEmptyPage = Math.max(highestNonEmptyPage, page); } else { consecutiveEmpty += 1; }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const orderedPages = [...byPage.keys()].filter(p => p <= highestNonEmptyPage).sort((a, b) => a - b);
  const all: PortalRow[] = [];
  let lastCode: string | null = null;
  for (const page of orderedPages) {
    const rows = byPage.get(page);
    if (!rows || !rows.length) throw new Error(`Kuwait HS Code portal page ${page} is unexpectedly empty inside the verified range (missing-page detection).`);
    if (lastCode !== null && rows[0]!.code <= lastCode) throw new Error(`Kuwait HS Code portal page ${page} did not continue strictly after the previous page (pagination loop/overlap detection).`);
    all.push(...rows);
    lastCode = rows[rows.length - 1]!.code;
  }
  return { rows: all, evidence, pages_walked: orderedPages.length };
}

const stripHtml = (value: string) => clean(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));

async function fetchKuwaitRightsPdf(fetch_impl: typeof fetch, attempts: number) {
  const detailsHtml = (await request(KUWAIT_RIGHTS_DETAILS_URL, { fetch_impl, attempts, max_bytes: 2 * 1024 * 1024 })).toString('utf8');
  const match = /href="(https:\/\/wipolex-res\.wipo\.int\/edocs\/lexdocs\/laws\/ar\/kw\/kw016ar\.pdf\?[^"]*)"/.exec(detailsHtml);
  if (!match) throw new Error('Kuwait Copyright Law WIPO Lex page no longer links its presigned PDF artifact.');
  const signedUrl = match[1]!.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16))).replace(/&amp;/g, '&');
  return request(signedUrl, { fetch_impl, attempts, max_bytes: 5 * 1024 * 1024 });
}

export async function acquireKuwaitAuthorityBundle(options: { release_identifier?: string; fetch_impl?: typeof fetch; attempts?: number } = {}) {
  const release_identifier = options.release_identifier ?? '2026-09-23';
  if (release_identifier !== '2026-09-23') throw new Error('Kuwait qualification release_identifier must be the bounded 2026-09-23 reference date.');
  const fetch_impl = options.fetch_impl ?? fetch, attempts = options.attempts ?? 3;

  const schedule = await crawlKuwaitSchedule(fetch_impl, attempts);
  const scheduleByCode = new Map<string, KuwaitTariffLine>();
  for (const row of schedule.rows) {
    if (scheduleByCode.has(row.code)) throw new Error(`Kuwait HS Code portal returned duplicate/conflicting code ${row.code}; authority conflicts are non-declarable, never arbitrarily selected.`);
    const duty = parseKuwaitDuty(row.rate);
    if (duty.kind === 'none') throw new Error(`Kuwait line ${row.code} has a blank duty; blank is not zero.`);
    scheduleByCode.set(row.code, { code: row.code, description: row.description, declarable: duty.kind === 'ad_valorem', duty, source: 'Kuwait Customs public HS Code portal', source_pages: [], effective_from: '2025-01-01', effective_to: null });
  }
  if (scheduleByCode.size !== KUWAIT_EXPECTED_SCHEDULE_CODES) throw new Error(`Kuwait HS Code portal enumerated ${scheduleByCode.size} unique codes instead of ${KUWAIT_EXPECTED_SCHEDULE_CODES}.`);

  const remedySources = [
    ['instruction-57.pdf', 'official_base_instruction_word_tariff_on_magnetic_disk_only', KUWAIT_INSTRUCTION_57_URL],
    ['korea-2017.pdf', 'official_active_trade_remedy', KUWAIT_KOREA_2017_URL],
    ['korea-2023.pdf', 'official_active_trade_remedy_continuation', KUWAIT_KOREA_2023_URL],
    ['aluminium-2025.pdf', 'official_active_trade_remedy', KUWAIT_ALUMINIUM_2025_URL],
    ['cement-ceramic-2025.pdf', 'official_active_trade_remedy', KUWAIT_CEMENT_CERAMIC_2025_URL],
    ['sanitary-2025.pdf', 'official_active_trade_remedy', KUWAIT_SANITARY_2025_URL],
    ['battery-2026.pdf', 'official_active_trade_remedy', KUWAIT_BATTERY_2026_URL],
    ['steel-2024.pdf', 'official_expired_national_rate_overlay', KUWAIT_STEEL_2024_URL],
    ['paperboard-expiry.pdf', 'official_expired_trade_remedy_historical_evidence', KUWAIT_PAPERBOARD_EXPIRY_URL],
  ] as const;
  const rawRemedies = await Promise.all(remedySources.map(async ([name, role, url]) => ({ name, role, url: kuwaitOfficialUrl(url), bytes: await request(url, { fetch_impl, attempts, max_bytes: 16 * 1024 * 1024 }) })));
  for (const item of rawRemedies) {
    if (!item.bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error(`Kuwait official file source ${item.name} returned an unexpected content type.`);
    const pin = KUWAIT_PINNED_SCANNED_ARTIFACTS[item.name];
    if (pin && (item.bytes.length !== pin.bytes || sha256(item.bytes) !== pin.sha256)) throw new Error(`Kuwait official file source ${item.name} no longer matches its reviewed, hand-verified copy.`);
  }

  const rightsBytes = await fetchKuwaitRightsPdf(fetch_impl, attempts);
  if (!rightsBytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('Kuwait Copyright Law source returned an unexpected content type.');
  if (rightsBytes.length !== KUWAIT_RIGHTS_PDF_PIN.bytes || sha256(rightsBytes) !== KUWAIT_RIGHTS_PDF_PIN.sha256) throw new Error('Kuwait Copyright Law source no longer matches its reviewed, hand-verified copy.');

  const indiaFtaText = stripHtml((await request(KUWAIT_INDIA_GCC_FTA_STATUS_URL, { fetch_impl, attempts, max_bytes: 2 * 1024 * 1024 })).toString('utf8'));
  if (!indiaFtaText.includes('Terms of Reference') || !indiaFtaText.includes('India-GCC Free Trade Agreement')) throw new Error('India-GCC FTA status source no longer supports the reviewed not-yet-operative conclusion.');

  const normalized = {
    schedule_lines: [...scheduleByCode.values()].sort((a, b) => a.code.localeCompare(b.code)),
    remedies: KUWAIT_ACTIVE_TRADE_REMEDY_MANIFEST,
  };
  const normalizedBytes = Buffer.from(JSON.stringify(normalized), 'utf8');
  const retained = [
    { name: 'schedule-evidence.json', role: 'canonical_factual_response_evidence', url: KUWAIT_HSCODE_URL, bytes: Buffer.from(JSON.stringify({ acquisition_version: KUWAIT_ACQUISITION_VERSION, pages_walked: schedule.pages_walked, page_evidence: schedule.evidence, unique_codes: scheduleByCode.size }, null, 2), 'utf8') },
    ...rawRemedies.map(item => ({ name: item.name, role: item.role, url: item.url, bytes: item.bytes })),
    { name: 'copyright-law.pdf', role: 'official_kuwait_copyright_law_article_4', url: KUWAIT_RIGHTS_DETAILS_URL, bytes: rightsBytes },
    { name: 'india-gcc-fta-status.json', role: 'official_india_preference_evidence', url: KUWAIT_INDIA_GCC_FTA_STATUS_URL, bytes: Buffer.from(JSON.stringify({ source_url: KUWAIT_INDIA_GCC_FTA_STATUS_URL, source_sha256: sha256(Buffer.from(indiaFtaText, 'utf8')), retention_rule: 'Only the factual Terms-of-Reference/negotiation-status markers used by the India-preference determination are retained.', verified_markers: ['Terms of Reference', 'India-GCC Free Trade Agreement'] }, null, 2), 'utf8') },
    { name: 'normalized.json', role: 'deterministic_normalized_tariff_and_overlay_bundle', url: KUWAIT_HSCODE_URL, bytes: normalizedBytes },
  ];

  const artifacts = retained.map(item => ({ name: item.name, role: item.role, url: item.url, size_bytes: item.bytes.length, sha256: sha256(item.bytes) }));
  const manifest = {
    acquisition_version: KUWAIT_ACQUISITION_VERSION, release_identifier, effective_base: '2025-01-01', acquired_as_current_on: release_identifier,
    reader_version: 'kw-customs-bundle-reader-v1', parser_version: KUWAIT_PARSER_VERSION, artifacts,
    base_evidence: { instrument: 'Customs Instruction 57 of 2024', mechanism: 'live public HS Code portal (Instruction 57’s own Word tariff artifact was distributed only via internal magnetic disk, not publicly published)', pages_walked: schedule.pages_walked, unique_codes: scheduleByCode.size },
    overlay_evidence: { steel_2024_national_rate: { rate: '10%', effective_from: '2024-05-30', effective_until: '2025-05-30', status: 'expired_before_qualification_reference_date_current_portal_confirms_reversion_to_5_percent' } },
    rights_evidence: { law_article: 'Kuwait Copyright Law article 4', source: 'WIPO Lex (Kuwait Law No. 75 of 2019 on Copyright and Related Rights)', rule: 'Ideas, procedures, methods, mathematical concepts, principles, abstract facts, discoveries, data, and official legislative/administrative/judicial texts and their translations are excluded. ClearTrade retains narrowly normalized official tariff facts and instruments, not portal design, software, logos or creative arrangement.' },
    india_preference_evidence: { status: 'not_applicable', basis: 'The India-GCC Free Trade Agreement remains at Terms-of-Reference/negotiation stage as of 2026-09-23 (signed 2026-02-05, negotiations formally launched 2026-02-24); no operative preferential goods agreement exists between India and Kuwait, and Kuwait’s own tariff portal exposes no preferential-duty mechanism.' },
    trade_remedy_evidence: {
      register_enumeration_complete: true,
      enumeration_basis: 'customs.gov.kw/CustomAnnouncement complete non-paginated register (841 instruments, 2007-2026) searched for anti-dumping/safeguard/countervailing terminology.',
      active_instruments: 6, historical_expired_instruments: 1, active_safeguards: 0, active_countervailing: 0,
    },
    scope: { tariff_treatment_complete: true, regulatory_coverage_complete: false, omitted_regulatory_layer: 'Ordinary Kuwait permits, prohibitions and product controls are outside this tariff pack; absence is not evidence of no restriction.' },
  };
  const zip = new JSZip();
  for (const item of retained) zip.file(item.name, item.bytes);
  zip.file('acquisition.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 }, platform: 'UNIX', streamFiles: true }));
}

export const __test__ = { stripHtml, parsePortalRows };
