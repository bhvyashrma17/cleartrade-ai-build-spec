import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import {
  parseVietnamAifta, parseVietnamChapter98, parseVietnamOutOfQuota, parseVietnamRateTable,
  VIETNAM_BASE_FROM, VIETNAM_EXPECTED_AIFTA_ENTRIES, VIETNAM_EXPECTED_SECTION_I_LINES, VIETNAM_PARSER_VERSION,
  type VietnamChapter98Line, type VietnamPage, type VietnamRateVersion, type VietnamTariffLine,
} from './vietnam-bundle';
import { VIETNAM_DECREE72_HAND_VERIFIED, VIETNAM_EVIDENCE_PINS, VIETNAM_GAZETTE_PINS, VIETNAM_REMEDY_DECISION_URLS, VIETNAM_TRAV_REVIEWED_MEASURE_NOTICES } from './vietnam-evidence';
import { VIETNAM_REMEDY_REGISTER_URL, VIETNAM_TRADE_REMEDY_MANIFEST } from './vietnam-remedies';

export const VIETNAM_ACQUISITION_VERSION = 'vn-congbao-public-acquisition-v1' as const;
const CONGBAO = 'https://congbao.chinhphu.vn/van-ban/';
const VANBAN_SEARCH = 'https://vanban.chinhphu.vn/he-thong-van-ban?classid=1&mode=1';
const ALLOWED_HOSTS = new Set(['congbao.chinhphu.vn', 'congbaocdn.chinhphu.vn', 'vanban.chinhphu.vn', 'datafiles.chinhphu.vn', 'trav.gov.vn', 'www.trav.gov.vn']);

/** Every instrument that touches the Decree 26/2023 import schedule or the AIFTA schedule, with its Official Gazette page. */
export const VIETNAM_INSTRUMENTS = {
  decree26: { slug: 'nghi-dinh-so-26-2023-nd-cp-39522', files: 14, role: 'official_base_mfn_schedule_decree_26_2023' },
  aifta122: { slug: 'nghi-dinh-so-122-2022-nd-cp-38802', files: 11, role: 'official_aifta_schedule_decree_122_2022' },
  decree144: { slug: 'nghi-dinh-so-144-2024-nd-cp-43109', files: 1, role: 'official_mfn_amendment_effective_2024_12_16' },
  decree21: { slug: 'nghi-dinh-so-21-2025-nd-cp-44155', files: 1, role: 'official_conditional_automotive_programme_not_mfn' },
  decree73: { slug: 'nghi-dinh-so-73-2025-nd-cp-44643', files: 1, role: 'official_mfn_amendment_effective_2025_03_31' },
  decree108: { slug: 'nghi-dinh-so-108-2025-nd-cp-44916', files: 1, role: 'official_export_only_amendment' },
  decree199: { slug: 'nghi-dinh-so-199-2025-nd-cp-45464', files: 1, role: 'official_mfn_amendment_effective_2025_07_08' },
  decree260: { slug: 'nghi-dinh-so-260-2025-nd-cp-46374', files: 1, role: 'official_export_only_amendment' },
  decree72: { slug: 'nghi-dinh-so-72-2026-nd-cp-469066', files: 1, role: 'official_temporary_fuel_mfn_rates' },
  resolution25: { slug: 'nghi-quyet-so-25-2026-nq-cp-469472', files: 1, role: 'official_fuel_rate_extension_to_2026_06_30' },
  resolution34: { slug: 'nghi-quyet-so-34-2026-nq-cp-469928', files: 1, role: 'official_fuel_rate_extension_to_2026_09_30' },
  decree201: { slug: 'nghi-dinh-so-201-2026-nd-cp-469729', files: 1, role: 'official_export_only_amendment' },
  resolution29: { slug: 'nghi-quyet-so-29-2026-nq-cp-469779', files: 1, role: 'official_currentness_evidence_no_import_duty' },
  decree272: { slug: 'nghi-dinh-so-272-2026-nd-cp-469999', files: 1, role: 'official_currentness_evidence_no_import_duty' },
} as const;
/** Documents found by the official search that reference Decree 26/2023 or the 2026 fuel import-rate chain; any other hit must be reviewed first. */
const VANBAN_26_2023 = new Set(['208020', '211569', '212714', '213245', '213700', '214494', '215575', '217144', '217967', '218369']);
const VANBAN_122_2022 = new Set(['207163']);
/** Every 2026 instrument the official search returns for "thuế nhập khẩu", with its reviewed role. */
const VANBAN_2026_IMPORT_DUTY: Readonly<Record<string, string>> = {
  '217144': 'Decree 72/2026 temporary fuel MFN rates (modelled)', '217967': 'Resolution 25/2026 fuel extension (modelled)', '218640': 'Resolution 34/2026 fuel extension to 2026-09-30 (modelled)',
  '218369': 'Decree 201/2026 export duties only', '216953': 'Decree 56/2026 Viet Nam–Cambodia bilateral special preferential schedule (not MFN, not India)',
  '218021': 'Decree 143/2026 Viet Nam–UAE CEPA special preferential schedule (not MFN, not India)',
};

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
const plain = (code: string) => code.replace(/\./g, '');
export function vietnamOfficialUrl(value: string) { const url = new URL(value); if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) throw new Error(`Vietnam authority acquisition rejects ${url.hostname}.`); return url.toString(); }

type Expect = 'html' | 'pdf' | 'doc';
async function request(url: string, options: { fetch_impl: typeof fetch; attempts: number; expect: Expect; max_bytes?: number; post?: { body: string; cookie: string } }) {
  let last: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      const headers: Record<string, string> = { accept: '*/*', 'user-agent': 'Mozilla/5.0 ClearTrade-Customs-Atlas/1.0' };
      if (options.post) Object.assign(headers, { 'content-type': 'application/x-www-form-urlencoded', cookie: options.post.cookie });
      const response = await options.fetch_impl(vietnamOfficialUrl(url), { method: options.post ? 'POST' : 'GET', body: options.post?.body, headers, signal: AbortSignal.timeout(120_000) });
      if (response.url) vietnamOfficialUrl(response.url);
      if (!response.ok) { if (response.status !== 429 && response.status < 500) throw new Error(`non-retryable HTTP ${response.status}`); throw new Error(`retryable HTTP ${response.status}`); }
      const type = response.headers.get('content-type') ?? '';
      const expected = options.expect === 'html' ? /text\/html/i : options.expect === 'pdf' ? /application\/pdf|octet-stream/i : /msword|octet-stream/i;
      if (!expected.test(type)) throw new Error(`non-retryable unexpected content type ${type}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw new Error('empty response');
      if (bytes.length > (options.max_bytes ?? 16 * 1024 * 1024)) throw new Error('response exceeded bounded size');
      if (options.expect === 'pdf' && !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('non-retryable response is not a PDF (error page)');
      return { bytes, headers: response.headers };
    } catch (error) {
      last = error;
      if (attempt === options.attempts || /non-retryable|exceeded/.test(String(error))) throw new Error(`Vietnam authority acquisition failed for ${url} after ${attempt} attempt(s): ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      await new Promise(resolve => setTimeout(resolve, attempt * 500));
    }
  }
  throw last;
}
async function pooled<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>) {
  const out: R[] = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { for (;;) { const index = next++; if (index >= items.length) return; out[index] = await run(items[index]!); } }));
  return out;
}
function pinned(name: string, bytes: Buffer, pins: Readonly<Record<string, { bytes: number; sha256: string }>>) {
  const pin = pins[name];
  if (!pin) throw new Error(`Vietnam artifact ${name} has no reviewed pin; a republished or new instrument must be reviewed before acquisition.`);
  if (bytes.length !== pin.bytes || sha256(bytes) !== pin.sha256) throw new Error(`Vietnam artifact ${name} no longer matches its reviewed copy.`);
}

export async function extractVietnamPages(documents: readonly Buffer[]): Promise<VietnamPage[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const out: VietnamPage[] = []; let number = 0;
  for (const bytes of documents) {
    const document = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0, useSystemFonts: true }).promise;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber), viewport = page.getViewport({ scale: 1 }), content = await page.getTextContent();
      const all = content.items.filter((item): item is Extract<typeof item, { str: string }> => 'str' in item);
      out.push({ page_number: ++number, width: viewport.width, height: viewport.height, text: all.map(item => item.str).join('').normalize('NFC'),
        items: all.filter(item => item.str.trim()).map(item => ({ str: item.str.normalize('NFC'), x: item.transform[4], y: item.transform[5], w: item.width })) });
    }
  }
  return out;
}

async function gazette(key: keyof typeof VIETNAM_INSTRUMENTS, fetch_impl: typeof fetch, attempts: number) {
  const instrument = VIETNAM_INSTRUMENTS[key];
  const page = (await request(`${CONGBAO}${instrument.slug}.htm`, { fetch_impl, attempts, expect: 'html', max_bytes: 4 * 1024 * 1024 })).bytes.toString('utf8');
  const urls = [...new Set(page.match(/https:\/\/congbaocdn\.chinhphu\.vn\/[^"'\s<>]+\.pdf/g) ?? [])].sort((a, b) => a.split('/').pop()!.localeCompare(b.split('/').pop()!));
  if (urls.length !== instrument.files) throw new Error(`Official Gazette page for ${key} lists ${urls.length} PDF parts instead of ${instrument.files}.`);
  const files = await pooled(urls, 3, async url => { const bytes = (await request(url, { fetch_impl, attempts, expect: 'pdf' })).bytes; const name = decodeURIComponent(url.split('/').pop()!); pinned(name, bytes, VIETNAM_GAZETTE_PINS); return { name, url, bytes }; });
  return { key, role: instrument.role, files };
}

const decodeAttr = (value: string) => value.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/&quot;/g, '"').replace(/&amp;/g, '&');
/** The Government Portal's public document search is an ASP.NET WebForms form; it is submitted exactly as a browser does. */
async function vanbanSearch(keyword: string, year: string, fetch_impl: typeof fetch, attempts: number) {
  const first = await request(VANBAN_SEARCH, { fetch_impl, attempts, expect: 'html', max_bytes: 4 * 1024 * 1024 });
  const setCookie = typeof first.headers.getSetCookie === 'function' ? first.headers.getSetCookie() : [first.headers.get('set-cookie') ?? ''];
  const cookie = setCookie.map(value => value.split(';')[0]!).filter(Boolean).join('; ');
  const html = first.bytes.toString('utf8'), form = new URLSearchParams();
  for (const input of html.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) { const name = /name="([^"]+)"/.exec(input[0])?.[1]; if (name) form.set(decodeAttr(name), decodeAttr(/value="([^"]*)"/.exec(input[0])?.[1] ?? '')); }
  for (const select of html.matchAll(/<select[^>]*name="([^"]+)"[\s\S]*?<\/select>/g)) form.set(decodeAttr(select[1]!), /<option[^>]*selected="selected"[^>]*value="([^"]*)"/.exec(select[0])?.[1] ?? /<option[^>]*value="([^"]*)"/.exec(select[0])?.[1] ?? '');
  const field = [...form.keys()].find(name => name.endsWith('$txtSearchKeyword')) ?? /name="([^"]*\$txtSearchKeyword)"/.exec(html)?.[1];
  const button = /name="([^"]*\$btnSearch)"/.exec(html)?.[1], perPage = [...form.keys()].find(name => name.endsWith('$drdRecordPerPage')), yearField = [...form.keys()].find(name => name.endsWith('$drdDocYear'));
  if (!field || !button || !perPage || !yearField) throw new Error('vanban.chinhphu.vn search form layout changed.');
  form.set(field, keyword); form.set(button, 'Tìm kiếm'); form.set(perPage, '200'); form.set(yearField, year);
  const result = (await request(VANBAN_SEARCH, { fetch_impl, attempts, expect: 'html', max_bytes: 6 * 1024 * 1024, post: { body: form.toString(), cookie } })).bytes.toString('utf8');
  const docs = new Map<string, string>();
  for (const match of result.matchAll(/docid=(\d+)[^>]*>([\s\S]{0,400}?)<\/a>/g)) docs.set(match[1]!, `${docs.get(match[1]!) ?? ''} ${clean(decodeAttr(match[2]!.replace(/<[^>]+>/g, ' ')))}`.trim());
  if (!docs.size) throw new Error(`vanban.chinhphu.vn search for "${keyword}" returned no parsable documents.`);
  return docs;
}

const MEASURE_NOTICE = /(áp dụng (thuế|biện pháp)[^|]*(chính thức|tạm thời))|kết quả rà soát|chấm dứt|không gia hạn|gia hạn áp dụng|gia hạn thêm|hoàn tất điều tra|giữ nguyên việc áp dụng|Duy trì biện pháp|công bố kết quả|chưa áp dụng|không áp dụng/i;
const NOT_MEASURE = /miễn trừ|Bản câu hỏi|tham vấn|Biên bản|gia hạn thời (gian|hạn)|Gia hạn thời|lấy ý kiến|tiếp nhận hồ sơ|Tiếp nhận hồ sơ/i;
/** Walks every page of TRAV's "Vietnam investigations" stream; a measure-changing notice not already reviewed fails closed. */
async function travEnumeration(fetch_impl: typeof fetch, attempts: number) {
  // Every page repeats a sidebar of recent news, so the walk ends when a batch of pages adds no new notice.
  const items = new Map<string, string>();
  let pages = 0;
  for (let page = 1; page <= 200; page += 4) {
    const batch = await pooled([page, page + 1, page + 2, page + 3], 4, async number => (await request(`${VIETNAM_REMEDY_REGISTER_URL}&p=${number}`, { fetch_impl, attempts, expect: 'html', max_bytes: 4 * 1024 * 1024 })).bytes.toString('utf8'));
    const before = items.size;
    for (const html of batch) for (const match of html.matchAll(/<a[^>]*href="[^"]*news-detail[^"]*id=([0-9a-f-]{36})"[^>]*>([\s\S]*?)<\/a>/g)) { const title = clean(decodeAttr(match[2]!.replace(/<[^>]+>/g, ' '))); if (title) items.set(match[1]!, title); }
    pages = page + 3;
    if (items.size === before) break;
    if (page + 4 > 200) throw new Error('TRAV notice stream did not end within 200 pages.');
  }
  const measureNotices = [...items].filter(([, title]) => MEASURE_NOTICE.test(title) && !NOT_MEASURE.test(title));
  const unreviewed = measureNotices.filter(([id]) => !VIETNAM_TRAV_REVIEWED_MEASURE_NOTICES.has(id));
  if (unreviewed.length) throw new Error(`TRAV lists ${unreviewed.length} measure-changing notice(s) not yet reviewed: ${unreviewed.map(([, title]) => title).join(' | ')}`);
  if (measureNotices.length < VIETNAM_TRAV_REVIEWED_MEASURE_NOTICES.size) throw new Error(`TRAV enumeration returned only ${measureNotices.length} of ${VIETNAM_TRAV_REVIEWED_MEASURE_NOTICES.size} reviewed measure notices; the stream was not fully walked.`);
  return { pages_walked: pages, items: items.size, measure_notices: measureNotices.length };
}

/** The Gazette text layer joins wrapped lines without a space, so markers are compared with all whitespace removed. */
const squash = (value: string) => value.replace(/\s+/g, '');
function textOf(pages: readonly VietnamPage[]) { return squash(pages.map(page => page.text).join('')); }
function requireMarkers(label: string, text: string, markers: readonly (string | RegExp)[]) {
  const missing = markers.filter(marker => (typeof marker === 'string' ? !text.includes(squash(marker)) : !marker.test(text)));
  if (missing.length) throw new Error(`${label} no longer supports the reviewed determination (missing: ${missing.map(String).join(' | ')}).`);
}
/** "0%. Từ ngày 01/9/2025 áp dụng mức thuế suất 7%." → versions from the instrument date and from each stated date. */
function phasedVersions(expression: string, from: string, instrument: string): VietnamRateVersion[] {
  if (/^\d+(?:[.,]\d+)?$/.test(expression) || /^Theo hướng/.test(expression)) return [{ from, until: null, expression, instrument }];
  const first = /^(\d+(?:[.,]\d+)?)\s*%/.exec(expression);
  const phases = [...expression.matchAll(/Từ ngày (\d{1,2})\/(\d{1,2})\/(\d{4}) áp dụng mức thuế suất (\d+(?:[.,]\d+)?)\s*%/g)];
  if (!first || !phases.length) throw new Error(`${instrument} publishes an unrecognised rate cell "${expression}".`);
  return [{ from, until: null, expression: first[1]!, instrument }, ...phases.map(match => ({ from: `${match[3]}-${match[2]!.padStart(2, '0')}-${match[1]!.padStart(2, '0')}`, until: null, expression: match[4]!, instrument }))];
}

export async function acquireVietnamAuthorityBundle(options: { release_identifier?: string; fetch_impl?: typeof fetch; attempts?: number } = {}) {
  const release_identifier = options.release_identifier ?? '2026-09-23';
  if (release_identifier !== '2026-09-23') throw new Error('Vietnam qualification release_identifier must be the bounded 2026-09-23 reference date.');
  const fetch_impl = options.fetch_impl ?? fetch, attempts = options.attempts ?? 3;

  // Completeness of the instrument chain, from the Government Portal's own search.
  const hits26 = await vanbanSearch('26/2023/NĐ-CP', '0', fetch_impl, attempts);
  const unknown26 = [...hits26.keys()].filter(id => !VANBAN_26_2023.has(id));
  if (unknown26.length || [...VANBAN_26_2023].some(id => !hits26.has(id))) throw new Error(`Decree 26/2023 amendment chain changed on vanban.chinhphu.vn (unreviewed: ${unknown26.map(id => hits26.get(id)).join(' | ') || 'none'}).`);
  const hits122 = await vanbanSearch('122/2022/NĐ-CP', '0', fetch_impl, attempts);
  if ([...hits122.keys()].some(id => !VANBAN_122_2022.has(id)) || !VANBAN_122_2022.has([...hits122.keys()][0] ?? '')) throw new Error('Decree 122/2022 (AIFTA) search result changed; an amending instrument must be reviewed.');
  const hits2026 = await vanbanSearch('thuế nhập khẩu', '2026', fetch_impl, attempts);
  const unknown2026 = [...hits2026.keys()].filter(id => !VANBAN_2026_IMPORT_DUTY[id]);
  if (unknown2026.length || Object.keys(VANBAN_2026_IMPORT_DUTY).some(id => !hits2026.has(id))) throw new Error(`2026 import-duty instruments changed on vanban.chinhphu.vn (unreviewed: ${unknown2026.map(id => hits2026.get(id)).join(' | ') || 'none'}).`);

  const instruments = Object.fromEntries(await pooled(Object.keys(VIETNAM_INSTRUMENTS) as (keyof typeof VIETNAM_INSTRUMENTS)[], 2, async key => [key, await gazette(key, fetch_impl, attempts)] as const)) as Record<keyof typeof VIETNAM_INSTRUMENTS, Awaited<ReturnType<typeof gazette>>>;
  const pagesOf = (key: keyof typeof VIETNAM_INSTRUMENTS) => extractVietnamPages(instruments[key].files.map(file => file.bytes));

  // Base schedule, Chapter 98 and Annex IV.
  const base = await pagesOf('decree26');
  const section1 = parseVietnamRateTable(base, { start: /Phụ lục II[\s\S]*BIỂU THUẾ NHẬP KHẨU ƯU ĐÃI/, stop: /CHƯƠNG 98 - QUY ĐỊNH MÃ HÀNG/, label: 'Decree 26/2023 Annex II Section I' });
  if (section1.size !== VIETNAM_EXPECTED_SECTION_I_LINES) throw new Error(`Decree 26/2023 Section I yielded ${section1.size} lines instead of ${VIETNAM_EXPECTED_SECTION_I_LINES}.`);
  const chapter98 = new Map<string, VietnamChapter98Line>(parseVietnamChapter98(base, { start: /CHƯƠNG 98 - QUY ĐỊNH MÃ HÀNG/, stop: /Phụ lục III/, instrument: 'Decree 26/2023/NĐ-CP Annex II Section II' }).map(line => [line.code, line]));
  if (chapter98.size !== 460) throw new Error(`Decree 26/2023 Chapter 98 yielded ${chapter98.size} lines instead of 460.`);
  const outOfQuota = parseVietnamOutOfQuota(base);
  if (outOfQuota.size !== 31) throw new Error(`Decree 26/2023 Annex IV yielded ${outOfQuota.size} out-of-quota lines instead of 31.`);
  requireMarkers('Decree 26/2023 Annex III', textOf(base), ['Phụ lục III', 'X + 10.000USD', 'X + 15.000USD', '200% hoặc 150% + 10.000USD']);

  // Amendments (permanent), temporary fuel chain and conditional/export-only instruments.
  const versions = new Map<string, VietnamRateVersion[]>();
  const addVersions = (code: string, list: VietnamRateVersion[]) => { const key = plain(code); if (!section1.has(code)) throw new Error(`${list[0]!.instrument} amends ${code}, which is not a Decree 26/2023 line (additions are not modelled).`); versions.set(key, [...(versions.get(key) ?? []), ...list]); };
  const p144 = await pagesOf('decree144');
  requireMarkers('Decree 144/2024', textOf(p144), ['có hiệu lực từ ngày 16 tháng 12 năm 2024', 'các mặt hàng có mã HS 8543.40.00', 'được phép nhập khẩu vào Việt Nam']);
  const t144 = parseVietnamRateTable(p144, { start: /Phụ lục II[\s\S]*BIỂU THUẾ NHẬP KHẨU ƯU ĐÃI/, stop: /Mục II/, label: 'Decree 144/2024 Annex II' });
  if (t144.size !== 58) throw new Error(`Decree 144/2024 Annex II yielded ${t144.size} rows instead of 58.`);
  for (const [code, row] of t144) addVersions(code, phasedVersions(row.expression, '2024-12-16', 'Decree 144/2024/NĐ-CP'));
  for (const line of parseVietnamChapter98(p144, { start: /Mục II/, stop: /$^/, instrument: 'Decree 144/2024/NĐ-CP Annex II Section II' })) chapter98.set(line.code, line);
  const p73 = await pagesOf('decree73');
  const text73 = textOf(p73);
  requireMarkers('Decree 73/2025', text73, ['có hiệu lực thi hành kể từ ngày ký ban hành', /9853\.00\.00Ethane2711\.19\.000/]);
  // Section II of Decree 73/2025 is the single Ethane row printed on the final page; any other Chapter 98 row must be reviewed.
  if ((text73.slice(text73.lastIndexOf('MụcII')).match(/98\d{2}\.\d{2}\.\d{2}/g) ?? []).join() !== '9853.00.00') throw new Error('Decree 73/2025 Section II no longer consists of the single reviewed Ethane row.');
  const t73 = parseVietnamRateTable(p73, { start: /Mục I/, stop: /Mục II/, label: 'Decree 73/2025 Annex Section I' });
  if (t73.size !== 603) throw new Error(`Decree 73/2025 yielded ${t73.size} rows instead of 603.`);
  for (const [code, row] of t73) addVersions(code, phasedVersions(row.expression, '2025-03-31', 'Decree 73/2025/NĐ-CP'));
  chapter98.set('98530000', { code: '98530000', description: 'Ethane', corresponding_codes: ['27111900'], expression: '0', instrument: 'Decree 73/2025/NĐ-CP Annex Section II' });
  const p199 = await pagesOf('decree199');
  requireMarkers('Decree 199/2025', textOf(p199), ['có hiệu lực thi hành kể từ ngày ký ban hành']);
  const t199 = parseVietnamRateTable(p199, { start: /Phụ lục II[\s\S]*THUẾ NHẬP KHẨU ƯU ĐÃI/, stop: /$^/, label: 'Decree 199/2025 Annex II' });
  if (t199.size !== 34) throw new Error(`Decree 199/2025 Annex II yielded ${t199.size} rows instead of 34.`);
  for (const [code, row] of t199) addVersions(code, phasedVersions(row.expression, '2025-07-08', 'Decree 199/2025/NĐ-CP'));
  const p72 = await pagesOf('decree72'), t72 = parseVietnamRateTable(p72, { start: /Phụ lục/, stop: /$^/, label: 'Decree 72/2026 Annex' });
  requireMarkers('Decree 72/2026', textOf(p72), ['đến ngày 30 tháng 4 năm 2026']);
  if (t72.size !== Object.keys(VIETNAM_DECREE72_HAND_VERIFIED).length || [...t72].some(([code, row]) => VIETNAM_DECREE72_HAND_VERIFIED[code] !== row.expression)) throw new Error('Decree 72/2026 Gazette table no longer matches the hand-verified signed scan.');
  const r25 = textOf(await pagesOf('resolution25')), r34 = textOf(await pagesOf('resolution34'));
  requireMarkers('Resolution 25/2026', r25, ['đến hết ngày 30 tháng 6 năm 2026', /2710\.19\.20[\s\S]{0,80}2710\.19\.89[\s\S]{0,80}2711\.19\.00[\s\S]{0,40}là0%/]);
  requireMarkers('Resolution 34/2026', r34, ['Nghị định số 72/2026/NĐ-CP', 'đến hết ngày 30 tháng 9 năm 2026']);
  const FUEL_UNTIL = '2026-09-30', fuelInstrument = 'Decree 72/2026/NĐ-CP, extended by Resolutions 25/2026/NQ-CP and 34/2026/NQ-CP';
  for (const [code, row] of t72) addVersions(code, [{ from: '2026-03-09', until: FUEL_UNTIL, expression: row.expression, instrument: fuelInstrument }]);
  for (const code of ['2710.19.20', '2710.19.89', '2711.19.00']) addVersions(code, [{ from: '2026-05-01', until: FUEL_UNTIL, expression: '0', instrument: 'Resolution 25/2026/NQ-CP art. 2, extended by Resolution 34/2026/NQ-CP' }]);
  const r21 = textOf(await pagesOf('decree21'));
  requireMarkers('Decree 21/2025', r21, ['Chương trình ưu đãi thuế công nghiệp hỗ trợ ô tô', '31 tháng 12 năm 2027']);
  for (const key of ['decree108', 'decree260', 'decree201'] as const) { const text = textOf(await pagesOf(key)); requireMarkers(key, text, ['thuế xuất khẩu']); if (/PhụlụcII[\s\S]{0,300}NHẬPKHẨUƯUĐÃI/.test(text)) throw new Error(`${key} now carries an import-rate annex and must be reviewed.`); }
  for (const key of ['resolution29', 'decree272'] as const) { if (/Biểuthuếnhậpkhẩuưuđãi|thuếsuấtthuếnhậpkhẩu/i.test(textOf(await pagesOf(key)))) throw new Error(`${key} now changes an import rate and must be reviewed.`); }

  // AIFTA schedule.
  const aiftaPages = await pagesOf('aifta122'), aifta = parseVietnamAifta(aiftaPages);
  if (aifta.size !== VIETNAM_EXPECTED_AIFTA_ENTRIES) throw new Error(`Decree 122/2022 yielded ${aifta.size} AIFTA entries instead of ${VIETNAM_EXPECTED_AIFTA_ENTRIES}.`);
  requireMarkers('Decree 122/2022', textOf(aiftaPages), ['Cộng hòa Ấn Độ', 'Mẫu AI', 'Ký hiệu “*”']);

  // Remedies: complete TRAV walk, and pinned decision artifacts.
  const trav = await travEnumeration(fetch_impl, attempts);
  for (const measure of VIETNAM_TRADE_REMEDY_MANIFEST.measures) for (const code of measure.tariff_codes) if (!section1.has(`${code.slice(0, 4)}.${code.slice(4, 6)}.${code.slice(6)}`)) throw new Error(`Remedy ${measure.id} names ${code}, which is not a Decree 26/2023 line.`);
  const decisions = await pooled(Object.entries(VIETNAM_REMEDY_DECISION_URLS), 3, async ([name, url]) => { const bytes = (await request(url, { fetch_impl, attempts, expect: 'pdf' })).bytes; pinned(name, bytes, VIETNAM_EVIDENCE_PINS); return { name, url, bytes }; });

  // Rights: Law on Intellectual Property article 15(2), with both amending laws.
  const rightsSources = [
    ['l50.doc', 'https://datafiles.chinhphu.vn/cpp/files/vbpq/2007/07/31054_l50qh.doc', 'doc'],
    ['luat07.pdf', 'https://datafiles.chinhphu.vn/cpp/files/vbpq/2022/07/07-2022-qh15..pdf', 'pdf'],
    ['luat131.pdf', 'https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/01/luat131-2025.pdf', 'pdf'],
  ] as const;
  const rights = await pooled(rightsSources, 3, async ([name, url, expect]) => { const bytes = (await request(url, { fetch_impl, attempts, expect })).bytes; pinned(`ip/${name}`, bytes, VIETNAM_EVIDENCE_PINS); return { name, url, bytes }; });

  const schedule_lines: VietnamTariffLine[] = [...section1].map(([code, row]) => ({
    code: plain(code), description: row.description, base_expression: row.expression, versions: (versions.get(plain(code)) ?? []).sort((a, b) => a.from.localeCompare(b.from)),
    import_condition: /^2404/.test(plain(code)) || plain(code) === '85434000' ? 'Decree 144/2024 art. 2(2): the rate applies only where the goods are permitted to be imported into Viet Nam under the law.' : null,
    out_of_quota_expression: outOfQuota.get(plain(code)) ?? null, used_vehicle_annex_iii: /^870[23]/.test(plain(code)),
  })).sort((a, b) => a.code.localeCompare(b.code));
  const normalized = { schedule_lines, chapter98: [...chapter98.values()].sort((a, b) => a.code.localeCompare(b.code)), aifta: [...aifta.values()].sort((a, b) => a.code.localeCompare(b.code)), remedies: VIETNAM_TRADE_REMEDY_MANIFEST };
  const normalizedBytes = Buffer.from(JSON.stringify(normalized), 'utf8');
  const evidence = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2), 'utf8');
  const retained = [
    ...Object.values(instruments).flatMap(item => item.files.map(file => ({ name: `gazette/${item.key}/${file.name}`, role: item.role, url: file.url, bytes: file.bytes }))),
    ...decisions.filter(item => item.name === 'qd2174.pdf' || item.name === 'sorbitol-2144.pdf').map(item => ({ name: `remedies/${item.name}`, role: 'official_trade_remedy_decision', url: item.url, bytes: item.bytes })),
    { name: 'remedies/decision-identities.json', role: 'official_trade_remedy_decision_identities', url: VIETNAM_REMEDY_REGISTER_URL, bytes: evidence(decisions.map(item => ({ name: item.name, url: item.url, size_bytes: item.bytes.length, sha256: sha256(item.bytes) }))) },
    { name: 'remedies/trav-enumeration.json', role: 'official_trade_remedy_enumeration_evidence', url: VIETNAM_REMEDY_REGISTER_URL, bytes: evidence(trav) },
    ...rights.map(item => ({ name: `rights/${item.name}`, role: 'official_vietnam_intellectual_property_law', url: item.url, bytes: item.bytes })),
    { name: 'chain-evidence.json', role: 'official_instrument_chain_completeness', url: VANBAN_SEARCH, bytes: evidence({ decree_26_2023_hits: Object.fromEntries(hits26), decree_122_2022_hits: Object.fromEntries(hits122), import_duty_2026_hits: Object.fromEntries([...hits2026].map(([id, title]) => [id, { title, reviewed_role: VANBAN_2026_IMPORT_DUTY[id] }])) }) },
    { name: 'normalized.json', role: 'deterministic_normalized_tariff_bundle', url: `${CONGBAO}${VIETNAM_INSTRUMENTS.decree26.slug}.htm`, bytes: normalizedBytes },
  ];
  const artifacts = retained.map(item => ({ name: item.name, role: item.role, url: item.url, size_bytes: item.bytes.length, sha256: sha256(item.bytes) }));
  const manifest = {
    acquisition_version: VIETNAM_ACQUISITION_VERSION, release_identifier, effective_base: VIETNAM_BASE_FROM, acquired_as_current_on: release_identifier,
    reader_version: 'vn-congbao-bundle-reader-v1', parser_version: VIETNAM_PARSER_VERSION, artifacts,
    base_evidence: { instrument: 'Decree 26/2023/NĐ-CP Annex II (Official Gazette text layer)', section_i_lines: section1.size, chapter98_lines: chapter98.size, out_of_quota_lines: outOfQuota.size, annex_iii: 'used passenger vehicles of ≤15 seats: absolute/mixed USD duties, modelled as a conditional line' },
    amendment_evidence: {
      permanent: { 'Decree 144/2024 (2024-12-16)': t144.size, 'Decree 73/2025 (2025-03-31)': t73.size, 'Decree 199/2025 (2025-07-08)': t199.size },
      temporary: { 'Decree 72/2026 (2026-03-09, extended to 2026-09-30)': t72.size, 'Resolution 25/2026 art. 2 (2026-05-01, extended to 2026-09-30)': 3 },
      conditional_programme: 'Decree 21/2025 (automotive supporting-industry 0% programme to 2027-12-31; registration and refund based, not an MFN change)',
      export_only: ['Decree 108/2025', 'Decree 260/2025', 'Decree 201/2026'], no_import_duty: ['Resolution 29/2026/NQ-CP', 'Decree 272/2026/NĐ-CP'],
    },
    rights_evidence: { law_article: 'Vietnam Law on Intellectual Property article 15(2)', source: 'Law 50/2005/QH11 as amended by Laws 07/2022/QH15 and 131/2025/QH15 (Government Portal)', rule: 'Legal normative documents, administrative documents, other documents in the judicial field and their official translations are not protected by copyright. Law 131/2025 only adds clause 4 (ideas, slogans, standalone titles).' },
    india_preference_evidence: { status: 'potentially_applicable_requires_origin_proof', instrument: 'Decree 122/2022/NĐ-CP (AIFTA 2022–2027)', conditions: 'import from an AIFTA party (India listed), rules of origin incl. direct consignment, C/O Form AI; lines marked "*" are ineligible' },
    trade_remedy_evidence: { register_enumeration_complete: true, enumeration: trav, active_measures: VIETNAM_TRADE_REMEDY_MANIFEST.measures.length, india_measures: VIETNAM_TRADE_REMEDY_MANIFEST.measures.filter(item => item.origin_countries.includes('IN')).map(item => item.case_code) },
    scope: { tariff_treatment_complete: true, regulatory_coverage_complete: false, omitted_regulatory_layer: 'VAT, excise, environmental protection tax, import licensing and specialised inspection are outside this tariff pack.' },
  };
  const zip = new JSZip();
  for (const item of retained) zip.file(item.name, item.bytes);
  zip.file('acquisition.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 }, platform: 'UNIX', streamFiles: true }));
}

export const __test__ = { phasedVersions, pinned, travEnumeration, vanbanSearch, requireMarkers };
