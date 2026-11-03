import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import {
  parseQatarDecree63Tables, parseQatarSchedule, QATAR_PARSER_VERSION,
  type QatarPdfPage,
} from './qatar-bundle';
import { QATAR_ACTIVE_TRADE_REMEDY_MANIFEST } from './qatar-remedies';

export const QATAR_ACQUISITION_VERSION = 'qa-customs-public-acquisition-v1' as const;
export const QATAR_SCHEDULE_URL = 'https://www.customs.gov.qa/Arabic/Tariff/Documents/%D8%AC%D8%AF%D9%88%D9%84%20%D8%A7%D9%84%D8%AA%D8%B9%D8%B1%D9%81%D8%A9%20%D8%A7%D9%84%D8%AC%D9%85%D8%B1%D9%83%D9%8A%D8%A9%20%D8%A7%D9%84%D9%85%D8%AA%D9%83%D8%A7%D9%85%D9%84%D8%A9%20%D9%84%D8%AF%D9%88%D9%84%20%D9%85%D8%AC%D9%84%D8%B3%20%D8%A7%D9%84%D8%AA%D8%B9%D8%A7%D9%88%D9%86%20%D8%A7%D9%84%D8%AE%D9%84%D9%8A%D8%AC%D9%8A%202026%D9%85.pdf' as const;
export const QATAR_DECREE_98_URL = 'https://www.customs.gov.qa/English/Legislations/Documents/Executive%20Resolutions/2024/decree%2098%20of%202024.pdf' as const;
export const QATAR_DECREE_63_URL = 'https://www.customs.gov.qa/English/Legislations/Documents/Executive%20Resolutions/2025/Decree%20No.%20(63)%20of%202025.pdf' as const;
export const QATAR_DECREE_31_URL = 'https://www.customs.gov.qa/English/Legislations/Documents/Executive%20Resolutions/2026/Decree%20no%2031%20of%202026-the%20amendment%20of%20the%20integrated%20customs%20tariff.pdf' as const;
export const QATAR_DECREE_88_URL = 'https://www.customs.gov.qa/English/Legislations/Documents/Executive%20Resolutions/2024/Decree%20No.%20%2888%29%20of%202024.pdf' as const;
export const QATAR_DECISION_19_2025_URL = 'https://www.customs.gov.qa/English/Legislations/Documents/Executive%20Resolutions/2025/19_25_EN.pdf' as const;
export const QATAR_DECISION_48_2026_URL = 'https://www.customs.gov.qa/English/Legislations/Documents/Executive%20Resolutions/2026/Decision%20of%20the%20Minister%20of%20Commerce%20and%20Industry%20No.%20%2848%29%20of%202026%20.pdf' as const;
export const QATAR_AGREEMENTS_URL = 'https://www.customs.gov.qa/English/Legislations/Pages/Customs-Agreements.aspx' as const;
export const QATAR_RIGHTS_URL = 'https://www.almeezan.qa/LawView.aspx?LawID=2637&language=en&opt=' as const;
export const QATAR_DECISION_21_2024_URL = 'https://www.moci.gov.qa/sites/default/files/2026-06/%D9%82%D8%B1%D8%A7%D8%B1-21-%D9%84%D8%B3%D9%86%D8%A9-2024-%D8%A8%D8%B7%D8%A7%D8%B1%D9%8A%D8%A7%D8%AA-%D9%83%D9%88%D8%B1%D9%8A%D8%A747.pdf' as const;
export const QATAR_DECISION_22_2024_URL = 'https://www.moci.gov.qa/sites/default/files/2026-06/%D9%82%D8%B1%D8%A7%D8%B1-22-%D9%84%D8%B3%D9%86%D8%A9-2024-%D8%A8%D8%B7%D8%A7%D8%B1%D9%8A%D8%A7%D8%AA-%D8%A7%D9%84%D9%87%D9%86%D8%AF44.pdf' as const;
export const QATAR_DECISION_107_2024_URL = 'https://www.moci.gov.qa/sites/default/files/2026-06/%D9%82%D8%B1%D8%A7%D8%B1-%D8%B1%D9%82%D9%85-107-%D9%84%D8%B3%D9%86%D8%A9-2024-%D8%B3%D9%8A%D8%B1%D8%A7%D9%85%D9%8A%D9%83-%D9%88%D9%85%D8%B1%D9%81%D9%82%D8%A7%D8%AA%D9%87.pdf' as const;
const ALLOWED_HOSTS = new Set(['www.customs.gov.qa', 'customs.gov.qa', 'www.almeezan.qa', 'almeezan.qa', 'www.moci.gov.qa', 'moci.gov.qa']);

/**
 * Decisions 21/2024, 22/2024 and 107/2024 are scanned/image PDFs: MOCI's own text layer is only a
 * decorative watermark, so content cannot be verified by extracting semantic text markers the way
 * every other Qatar artifact in this acquisition is. They are instead pinned by exact byte length
 * and SHA-256, matching the reviewed copies whose producer rate tables were read directly from the
 * page images and hand-verified against the official artifact during this acquisition.
 */
const QATAR_PINNED_SCANNED_ARTIFACTS: Record<string, { bytes: number; sha256: string }> = {
  'decision-21-2024.pdf': { bytes: 1_590_963, sha256: '7c3c99f0ce805f59741fab48b215153c05d3ce7b3bffe7b2097a67ebb3a765f8' },
  'decision-22-2024.pdf': { bytes: 1_595_246, sha256: 'fce6b02bff34e5c90e60c90d6ea99348300c8a8624b695d014c5cb926a6b3893' },
  'decision-107-2024.pdf': { bytes: 7_859_238, sha256: 'e2898326e3720c218cc32c7d8e5468b426c771978a8fdf58a4ca2bc957fdb5ab' },
};

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
export function qatarOfficialUrl(value: string) { const url = new URL(value); if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) throw new Error(`Qatar authority acquisition rejects ${url.hostname}.`); return url.toString(); }

async function request(url: string, options: { fetch_impl: typeof fetch; attempts: number; max_bytes?: number }) {
  let last: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      const response = await options.fetch_impl(qatarOfficialUrl(url), { headers: { accept: '*/*', 'user-agent': 'ClearTrade-Customs-Atlas/1.0' }, signal: AbortSignal.timeout(180_000) });
      if (!response.ok) { if (response.status !== 429 && response.status < 500) throw new Error(`non-retryable HTTP ${response.status}`); throw new Error(`retryable HTTP ${response.status}`); }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw new Error('empty response');
      if (bytes.length > (options.max_bytes ?? 40 * 1024 * 1024)) throw new Error('response exceeded bounded size');
      return bytes;
    } catch (error) {
      last = error;
      if (attempt === options.attempts || /non-retryable|exceeded/.test(String(error))) throw new Error(`Qatar authority acquisition failed for ${url} after ${attempt} attempt(s): ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      await new Promise(resolve => setTimeout(resolve, attempt * 350));
    }
  }
  throw last;
}

const stripHtml = (value: string) => clean(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));

async function pdfPages(bytes: Buffer): Promise<QatarPdfPage[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0, useSystemFonts: true }).promise;
  const pages: QatarPdfPage[] = [];
  for (let page_number = 1; page_number <= document.numPages; page_number += 1) {
    const page = await document.getPage(page_number), viewport = page.getViewport({ scale: 1 }), content = await page.getTextContent();
    pages.push({ page_number, width: viewport.width, height: viewport.height, items: content.items.flatMap(item => 'str' in item && item.str ? [{ str: item.str, x: item.transform[4], y: item.transform[5] }] : []) });
  }
  return pages;
}

export async function acquireQatarAuthorityBundle(options: { release_identifier?: string; fetch_impl?: typeof fetch; attempts?: number } = {}) {
  const release_identifier = options.release_identifier ?? '2026-09-23';
  if (release_identifier !== '2026-09-23') throw new Error('Qatar qualification release_identifier must be the bounded 2026-09-23 reference date.');
  const fetch_impl = options.fetch_impl ?? fetch, attempts = options.attempts ?? 3;

  const sources = [
    ['schedule.pdf', 'official_current_integrated_tariff_schedule', QATAR_SCHEDULE_URL],
    ['decree-98.pdf', 'official_base_decree', QATAR_DECREE_98_URL],
    ['decree-63.pdf', 'official_2025_structural_amendment', QATAR_DECREE_63_URL],
    ['decree-31.pdf', 'official_2026_structural_amendment_text_only', QATAR_DECREE_31_URL],
    ['decree-88.pdf', 'official_2024_expired_national_rate_overlay', QATAR_DECREE_88_URL],
    ['decision-19-2025.pdf', 'official_active_trade_remedy', QATAR_DECISION_19_2025_URL],
    ['decision-48-2026.pdf', 'official_active_trade_remedy', QATAR_DECISION_48_2026_URL],
    ['decision-21-2024.pdf', 'official_active_trade_remedy', QATAR_DECISION_21_2024_URL],
    ['decision-22-2024.pdf', 'official_active_trade_remedy', QATAR_DECISION_22_2024_URL],
    ['decision-107-2024.pdf', 'official_expired_trade_remedy_historical_evidence', QATAR_DECISION_107_2024_URL],
    ['agreements.html', 'official_trade_agreement_inventory', QATAR_AGREEMENTS_URL],
    ['copyright-law.html', 'official_qatar_copyright_law_article_4', QATAR_RIGHTS_URL],
  ] as const;
  const raw = await Promise.all(sources.map(async ([name, role, url]) => ({ name, role, url: qatarOfficialUrl(url), bytes: await request(url, { fetch_impl, attempts, max_bytes: 40 * 1024 * 1024 }) })));
  const byName = (name: string) => raw.find(x => x.name === name)!.bytes;
  if (!byName('schedule.pdf').subarray(0, 5).equals(Buffer.from('%PDF-')) || !byName('decree-63.pdf').subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('Qatar official file source returned an unexpected content type.');
  for (const [name, pin] of Object.entries(QATAR_PINNED_SCANNED_ARTIFACTS)) {
    const bytes = byName(name);
    if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error(`Qatar official file source ${name} returned an unexpected content type.`);
    if (bytes.length !== pin.bytes || sha256(bytes) !== pin.sha256) throw new Error(`Qatar official file source ${name} no longer matches its reviewed, hand-verified copy.`);
  }

  const schedule = parseQatarSchedule(await pdfPages(byName('schedule.pdf')));
  const operations_2025 = parseQatarDecree63Tables(await pdfPages(byName('decree-63.pdf')));

  const decree31Text = clean((await pdfPages(byName('decree-31.pdf'))).flatMap(p => p.items.map(i => i.str)).join(' '));
  if (!decree31Text.includes('01/01/2026') || !decree31Text.includes('Regarding the Amendment of the Integrated Customs Tariff')) throw new Error('Qatar Decree 31/2026 no longer states the reviewed 2026-01-01 effective date.');
  const decree_31_2026 = {
    instrument: 'Decree No. (31) of 2026', effective_from: '2026-01-01', tables_machine_available: false as const,
    note: 'Decree 31/2026 amends descriptions and adds/deletes subheadings in the Integrated Customs Tariff effective 2026-01-01. Its own published PDF (English and Arabic, via customs.gov.qa) contains only the decree articles; the referenced Table (1)/(2)/(3) annexes were not separately published in machine-readable form on customs.gov.qa, almeezan.qa or moci.gov.qa at acquisition time. The cumulative effect of this decree is nonetheless captured because the current schedule artifact (dated after this decree) already reflects it; only the itemised 2026-01-01 add/delete/description operations are unavailable for historical replay.',
  };

  const agreementsText = stripHtml(byName('agreements.html').toString('utf8'));
  if (!agreementsText.includes('Republic of India') || !agreementsText.includes('Bilateral Agreements on Customs Cooperation') || /free trade|preferential tariff/i.test(agreementsText.replace(/customs cooperation/gi, ''))) {
    throw new Error('Qatar Customs Agreements register no longer supports the reviewed no-operative-India-preference conclusion.');
  }
  const rightsText = stripHtml(byName('copyright-law.html').toString('utf8'));
  if (!rightsText.includes('Article 4') || !rightsText.includes('shall not cover') || !rightsText.includes('Laws, legal provisions, administrative decisions')) throw new Error('Qatar Copyright Law source no longer contains the reviewed Article 4 exclusions.');

  const decision19Text = clean((await pdfPages(byName('decision-19-2025.pdf'))).flatMap(p => p.items.map(i => i.str)).join(' '));
  if (!decision19Text.includes('25/09/2029') || !decision19Text.includes('42%')) throw new Error('Qatar Decision 19/2025 no longer states its reviewed expiry/rate evidence.');
  const decision48Text = clean((await pdfPages(byName('decision-48-2026.pdf'))).flatMap(p => p.items.map(i => i.str)).join(' '));
  if (!decision48Text.includes('12/01/2031') || !decision48Text.includes('74%')) throw new Error('Qatar Decision 48/2026 no longer states its reviewed expiry/rate evidence.');

  const normalized = {
    schedule_lines: [...schedule.values()].sort((a, b) => a.code.localeCompare(b.code)),
    operations_2025, decree_31_2026, remedies: QATAR_ACTIVE_TRADE_REMEDY_MANIFEST,
  };
  const normalizedBytes = Buffer.from(JSON.stringify(normalized), 'utf8');
  const retained = [
    { name: 'schedule-evidence.json', role: 'canonical_factual_response_evidence', url: QATAR_SCHEDULE_URL, bytes: Buffer.from(JSON.stringify({ acquisition_version: QATAR_ACQUISITION_VERSION, source_pages: (await pdfPages(byName('schedule.pdf'))).length, unique_codes: schedule.size }, null, 2), 'utf8') },
    { name: 'agreements.json', role: 'official_trade_agreement_inventory', url: QATAR_AGREEMENTS_URL, bytes: Buffer.from(JSON.stringify({ source_url: QATAR_AGREEMENTS_URL, source_sha256: sha256(byName('agreements.html')), retention_rule: 'Only the factual bilateral/multilateral agreement markers used by the India-preference determination are retained; site chrome, scripts, styles and presentation are excluded.', verified_markers: ['Republic of India', 'Bilateral Agreements on Customs Cooperation'] }, null, 2), 'utf8') },
    { name: 'copyright-law-article-4.json', role: 'official_qatar_copyright_law_article_4', url: QATAR_RIGHTS_URL, bytes: Buffer.from(JSON.stringify({ source_url: QATAR_RIGHTS_URL, source_sha256: sha256(byName('copyright-law.html')), retention_rule: 'Only the official Article 4 exclusion text used by the rights qualification is retained from the multi-article compilation.', facts: rightsText.slice(rightsText.indexOf('Article 4'), rightsText.indexOf('Article 4') + 600) }, null, 2), 'utf8') },
    { name: 'decree-98.pdf', role: 'official_base_decree', url: QATAR_DECREE_98_URL, bytes: byName('decree-98.pdf') },
    { name: 'decree-63.pdf', role: 'official_2025_structural_amendment', url: QATAR_DECREE_63_URL, bytes: byName('decree-63.pdf') },
    { name: 'decree-31.pdf', role: 'official_2026_structural_amendment_text_only', url: QATAR_DECREE_31_URL, bytes: byName('decree-31.pdf') },
    { name: 'decree-88.pdf', role: 'official_2024_expired_national_rate_overlay', url: QATAR_DECREE_88_URL, bytes: byName('decree-88.pdf') },
    { name: 'decision-19-2025.pdf', role: 'official_active_trade_remedy', url: QATAR_DECISION_19_2025_URL, bytes: byName('decision-19-2025.pdf') },
    { name: 'decision-48-2026.pdf', role: 'official_active_trade_remedy', url: QATAR_DECISION_48_2026_URL, bytes: byName('decision-48-2026.pdf') },
    { name: 'decision-21-2024.pdf', role: 'official_active_trade_remedy', url: QATAR_DECISION_21_2024_URL, bytes: byName('decision-21-2024.pdf') },
    { name: 'decision-22-2024.pdf', role: 'official_active_trade_remedy', url: QATAR_DECISION_22_2024_URL, bytes: byName('decision-22-2024.pdf') },
    { name: 'decision-107-2024.pdf', role: 'official_expired_trade_remedy_historical_evidence', url: QATAR_DECISION_107_2024_URL, bytes: byName('decision-107-2024.pdf') },
    { name: 'normalized.json', role: 'deterministic_normalized_tariff_and_overlay_bundle', url: QATAR_SCHEDULE_URL, bytes: normalizedBytes },
  ];

  const artifacts = retained.map(item => ({ name: item.name, role: item.role, url: item.url, size_bytes: item.bytes.length, sha256: sha256(item.bytes) }));
  const manifest = {
    acquisition_version: QATAR_ACQUISITION_VERSION, release_identifier, effective_base: '2025-01-01', acquired_as_current_on: release_identifier,
    reader_version: 'qa-customs-bundle-reader-v1', parser_version: QATAR_PARSER_VERSION, artifacts,
    base_evidence: { decision: 'Decree No. (98) of 2024', current_schedule_unique_codes: schedule.size },
    overlay_evidence: {
      decree_63_2025: { effective_from: '2025-06-01', operations: { rate_replace: 32, add: 21, delete: 4 } },
      decree_31_2026: { effective_from: '2026-01-01', tables_machine_available: false },
      decree_88_2024_steel: { rate: '10%', effective_from: '2024-11-10', effective_until: '2025-05-30', status: 'expired_before_qualification_reference_date' },
      decree_68_2023_dairy: { status: 'asserted_in_intake_brief_not_independently_located', applied: false },
    },
    rights_evidence: { law_article: 'Qatar Copyright Law article 4', source: 'Al Meezan Qatari Legal Portal', rule: 'Official laws, legal provisions, administrative decisions, international treaties, official documents and un-collated data are excluded. ClearTrade retains narrowly normalized official tariff facts and instruments, not portal design, software, logos or creative arrangement.' },
    india_preference_evidence: { status: 'not_applicable', basis: 'Qatar Customs official Agreements register lists only a bilateral customs-cooperation (anti-smuggling/mutual-assistance) agreement with India, not a preferential goods tariff agreement, as at 2026-09-23.' },
    trade_remedy_evidence: {
      register_enumeration_complete: true,
      enumeration_basis: 'moci.gov.qa/Industry decisions-and-circulars resource page (complete, non-paginated) cross-referenced against customs.gov.qa Executive Decisions circulars.',
      active_instruments: 4, historical_expired_instruments: 1, active_safeguards: 0, active_countervailing: 0,
      note: 'Decisions 19/2025 and 48/2026 were retrieved from customs.gov.qa with a machine-readable text layer. Decisions 21/2024 (Korea), 22/2024 (India) and 107/2024 (ceramic tiles, China/India) were located on moci.gov.qa/Industry and are scanned/image PDFs verified by exact byte-length and SHA-256 pin against a hand-verified reviewed copy, since their own text layer is only a decorative watermark. Decision 107/2024 expired 2025-06-05 per its own Article 4 and is retained as historical evidence only, excluded from the active manifest. An amendment chain asserted for Decision 22/2024 (Decision 2/2025, Decision 21/2025) could not be independently located on the same primary channel that hosts every other verified instrument; the original 2024 producer table is retained as the current legal state pending a verifiable amendment artifact.',
    },
    scope: { tariff_treatment_complete: true, regulatory_coverage_complete: false, omitted_regulatory_layer: 'Ordinary Qatar permits, prohibitions (beyond the tariff schedule’s own explicit PROHIBITED lines) and product controls are outside this tariff pack; absence is not evidence of no restriction.' },
  };
  const zip = new JSZip();
  for (const item of retained) zip.file(item.name, item.bytes);
  zip.file('acquisition.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 }, platform: 'UNIX', streamFiles: true }));
}

export const __test__ = { stripHtml };
