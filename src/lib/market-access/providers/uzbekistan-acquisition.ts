import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { extractPdfTablePages } from './pdf-table-family';
import {
  UZBEKISTAN_BASE_FROM, UZBEKISTAN_EXPECTED_NOMENCLATURE_CODES, UZBEKISTAN_EXPECTED_RATE_PREFIXES, UZBEKISTAN_EXPECTED_RATE_ROWS,
  UZBEKISTAN_NON_MFN_ADDITIONAL_DUTY_FROM, UZBEKISTAN_PARSER_VERSION, parseUzbekistanNomenclature, parseUzbekistanRateGrid, resolveUzbekistanSchedule,
} from './uzbekistan-bundle';
import { UZBEKISTAN_TRADE_REMEDY_MANIFEST } from './uzbekistan-remedies';

export const UZBEKISTAN_ACQUISITION_VERSION = 'uz-lex-public-acquisition-v1' as const;
/** PP-3818 consolidated (official Uzbek) text; Annex 1 is the import-duty rate grid. */
export const UZBEKISTAN_PP3818_URL = 'https://lex.uz/docs/3802363' as const;
/** PP-181 of 2025-05-14, which approved the 2022 national TN VED and restated PP-3818 Annex 1. */
export const UZBEKISTAN_PP181_URL = 'https://lex.uz/docs/7533457' as const;
export const UZBEKISTAN_PP181_ANNEX1_ZIP_URL = 'https://lex.uz/files/7541055.zip' as const;
export const UZBEKISTAN_CUSTOMS_CODE_URL = 'https://lex.uz/docs/2876352' as const;
export const UZBEKISTAN_COPYRIGHT_LAW_URL = 'https://lex.uz/docs/1022944' as const;
export const UZBEKISTAN_PF174_URL = 'https://lex.uz/docs/8444993' as const;
export const UZBEKISTAN_PF175_URL = 'https://lex.uz/docs/8442717' as const;
export const UZBEKISTAN_RESOLUTION_416_URL = 'https://lex.uz/docs/8363347' as const;
export const UZBEKISTAN_INDIA_TRADE_AGREEMENT_URL = 'https://lex.uz/docs/2651526' as const;
/** Every page of each query is enumerated; together they cover all acts naming anti-dumping, countervailing or special duties. */
export const UZBEKISTAN_REMEDY_SEARCH_QUERIES = ['антидемпинговая пошлина', 'компенсационная пошлина', 'антидемпинговых'] as const;

const ALLOWED_HOSTS = new Set(['lex.uz', 'www.lex.uz']);
/**
 * PP-181 Annex 1 (the national nomenclature) is a static lex.uz file attachment. It is pinned by exact
 * byte length and SHA-256 so a silent re-upload can never change the 13,138-code universe unseen.
 */
const PP181_ANNEX1_ZIP_PIN = { bytes: 7_618_410, sha256: '80d89d0c0cac668e6ae33543f3b770cb7617b2ee633c64326c4b371161f0df6d' };
const PP181_ANNEX1_PDF_PIN = { bytes: 7_753_491, sha256: 'a5b78dbb990f106633bfc9fcc73e8316ade10900223df63d48f18aaac4058575' };

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
const stripHtml = (value: string) => clean(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
export function uzbekistanOfficialUrl(value: string) { const url = new URL(value); if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) throw new Error(`Uzbekistan authority acquisition rejects ${url.hostname}.`); return url.toString(); }

async function request(url: string, options: { fetch_impl: typeof fetch; attempts: number; expect: 'html' | 'zip'; max_bytes?: number; post?: { body: string; cookie: string } }) {
  return (await requestWithHeaders(url, options)).bytes;
}

async function requestWithHeaders(url: string, options: { fetch_impl: typeof fetch; attempts: number; expect: 'html' | 'zip'; max_bytes?: number; post?: { body: string; cookie: string } }) {
  let last: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      const headers: Record<string, string> = { accept: options.expect === 'zip' ? 'application/zip' : 'text/html', 'user-agent': 'Mozilla/5.0 ClearTrade-Customs-Atlas/1.0' };
      if (options.post) Object.assign(headers, { 'content-type': 'application/x-www-form-urlencoded', cookie: options.post.cookie });
      const response = await options.fetch_impl(uzbekistanOfficialUrl(url), { method: options.post ? 'POST' : 'GET', body: options.post?.body, headers, signal: AbortSignal.timeout(90_000) });
      if (!response.ok) { if (response.status !== 429 && response.status < 500) throw new Error(`non-retryable HTTP ${response.status}`); throw new Error(`retryable HTTP ${response.status}`); }
      const type = response.headers.get('content-type') ?? '';
      if (options.expect === 'html' && !/text\/html/i.test(type)) throw new Error(`non-retryable unexpected content type ${type}`);
      if (options.expect === 'zip' && !/application\/(zip|octet-stream)/i.test(type)) throw new Error(`non-retryable unexpected content type ${type}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw new Error('empty response');
      if (bytes.length > (options.max_bytes ?? 12 * 1024 * 1024)) throw new Error('response exceeded bounded size');
      return { bytes, headers: response.headers };
    } catch (error) {
      last = error;
      if (attempt === options.attempts || /non-retryable|exceeded/.test(String(error))) throw new Error(`Uzbekistan authority acquisition failed for ${url} after ${attempt} attempt(s): ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      await new Promise(resolve => setTimeout(resolve, attempt * 500));
    }
  }
  throw last;
}

const decodeAttr = (value: string) => value.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/&quot;/g, '"').replace(/&amp;/g, '&');
interface LexSearchHit { doc_id: string; title: string }
/**
 * Walks every page of a lex.uz national-legislation search. Page 1 is a plain GET; later pages are the
 * site's own public WebForms pager postbacks (the page's hidden fields plus its session cookie), the
 * same mechanism a browser uses. The collected unique acts must equal the "найдено N" total.
 */
async function searchLexAll(query: string, fetch_impl: typeof fetch, attempts: number) {
  const url = `https://lex.uz/ru/search/nat?query=${encodeURIComponent(query)}`;
  const first = await requestWithHeaders(url, { fetch_impl, attempts, expect: 'html', max_bytes: 4 * 1024 * 1024 });
  const setCookie = typeof first.headers.getSetCookie === 'function' ? first.headers.getSetCookie() : [first.headers.get('set-cookie') ?? ''];
  const cookie = setCookie.map(value => value.split(';')[0]!).filter(Boolean).join('; ');
  let html = first.bytes.toString('utf8');
  const total = Number(/найдено (\d+)/.exec(stripHtml(html))?.[1] ?? '0');
  const hits = new Map<string, LexSearchHit>();
  // lex.uz lists an act's other-language edition under the same id negated; both are one act.
  const collect = (page: string) => { for (const match of page.matchAll(/<a class="lx_link[^"]*" href="\/ru\/docs\/-?(\d+)\?query=[^"]*"[^>]*>([\s\S]*?)<\/a>/g)) if (!hits.has(match[1]!)) hits.set(match[1]!, { doc_id: match[1]!, title: stripHtml(match[2]!) }); };
  collect(html);
  for (let page = 2; hits.size < total && page <= 10; page += 1) {
    const target = new RegExp(`__doPostBack\\(&#39;(ucFoundActsControl\\$rptPaging\\$ctl\\d+\\$lbPaging)&#39;,&#39;&#39;\\)">${page}</a>`).exec(html)?.[1];
    if (!target) throw new Error(`lex.uz search "${query}" reports ${total} acts but exposes no pager link for page ${page}.`);
    const form = new URLSearchParams();
    for (const input of html.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
      const name = /name="([^"]+)"/.exec(input[0])?.[1];
      if (name) form.set(decodeAttr(name), decodeAttr(/value="([^"]*)"/.exec(input[0])?.[1] ?? ''));
    }
    form.set('__EVENTTARGET', target); form.set('__EVENTARGUMENT', '');
    html = (await request(url, { fetch_impl, attempts, expect: 'html', max_bytes: 4 * 1024 * 1024, post: { body: form.toString(), cookie } })).toString('utf8');
    collect(html);
  }
  if (hits.size !== total) throw new Error(`lex.uz search "${query}" enumerated ${hits.size} of ${total} acts; the remedy enumeration is incomplete.`);
  return { url, total, hits: [...hits.values()].sort((a, b) => a.doc_id.localeCompare(b.doc_id)) };
}

/** lex.uz lists every edition of an act, newest first, immediately after the "official publication source" label. */
function latestEdition(text: string) { return /Расмий нашр манбаси (\d{2}\.\d{2}\.\d{4})/.exec(text)?.[1] ?? /Источники опубликования (\d{2}\.\d{2}\.\d{4})/.exec(text)?.[1] ?? null; }
function requireMarkers(label: string, text: string, markers: readonly string[]) {
  const missing = markers.filter(marker => !text.includes(marker));
  if (missing.length) throw new Error(`${label} no longer supports the reviewed determination (missing: ${missing.join(' | ')}).`);
}
const evidence = (url: string, sourceText: string, markers: readonly string[], extra: Record<string, unknown> = {}) => Buffer.from(JSON.stringify({ source_url: url, source_text_sha256: sha256(Buffer.from(sourceText, 'utf8')), retention_rule: 'Only the factual markers used by the determination are retained; the legal text itself is not redistributed.', verified_markers: markers, ...extra }, null, 2), 'utf8');

export async function acquireUzbekistanAuthorityBundle(options: { release_identifier?: string; fetch_impl?: typeof fetch; attempts?: number } = {}) {
  const release_identifier = options.release_identifier ?? '2026-09-23';
  if (release_identifier !== '2026-09-23') throw new Error('Uzbekistan qualification release_identifier must be the bounded 2026-09-23 reference date.');
  const fetch_impl = options.fetch_impl ?? fetch, attempts = options.attempts ?? 3;

  // Base: PP-3818 Annex 1 rate grid, current consolidated edition.
  const pp3818Bytes = await request(UZBEKISTAN_PP3818_URL, { fetch_impl, attempts, expect: 'html' });
  const pp3818Html = pp3818Bytes.toString('utf8'), pp3818Text = stripHtml(pp3818Html);
  const pp3818Markers = ['ПҚ-3818-сон', 'ПҚ-58-сонли', '07/26/58/0143-сон', '2026 йил 1 январга қадар (шу муддат ҳам киради) 0 фоизни', '2027 йил 1 октябрга қадар (шу муддат ҳам киради) 0 фоизни', '2027 йил 1 январга қадар (шу муддат ҳам киради) 10 фоизни'] as const;
  requireMarkers('lex.uz PP-3818 consolidated text', pp3818Text, pp3818Markers);
  const pp3818Edition = latestEdition(pp3818Text);
  if (pp3818Edition !== '16.02.2026') throw new Error(`PP-3818's latest lex.uz edition is ${pp3818Edition ?? 'unreadable'}, not the reviewed 16.02.2026 (PP-58) edition; a newer amendment must be reviewed before acquisition.`);
  const grid = parseUzbekistanRateGrid(pp3818Html);
  if (grid.length !== UZBEKISTAN_EXPECTED_RATE_ROWS) throw new Error(`PP-3818 Annex 1 has ${grid.length} rate rows instead of ${UZBEKISTAN_EXPECTED_RATE_ROWS}.`);
  const prefixCount = new Set(grid.flatMap(row => row.codes)).size;
  if (prefixCount !== UZBEKISTAN_EXPECTED_RATE_PREFIXES) throw new Error(`PP-3818 Annex 1 lists ${prefixCount} code prefixes instead of ${UZBEKISTAN_EXPECTED_RATE_PREFIXES}.`);

  // Nomenclature: PP-181 Annex 1 (unamended since entry into force).
  const pp181Text = stripHtml((await request(UZBEKISTAN_PP181_URL, { fetch_impl, attempts, expect: 'html' })).toString('utf8'));
  const pp181Markers = ['ПҚ-181-сон', 'Ташқи иқтисодий фаолият товар номенклатурасини тасдиқлаш тўғрисида'] as const;
  requireMarkers('lex.uz PP-181 text', pp181Text, pp181Markers);
  if (latestEdition(pp181Text) !== '01.06.2025') throw new Error('PP-181 has a lex.uz edition later than its 2025-06-01 entry into force; the nomenclature must be re-reviewed.');
  const zipBytes = await request(UZBEKISTAN_PP181_ANNEX1_ZIP_URL, { fetch_impl, attempts, expect: 'zip' });
  if (zipBytes.length !== PP181_ANNEX1_ZIP_PIN.bytes || sha256(zipBytes) !== PP181_ANNEX1_ZIP_PIN.sha256) throw new Error('PP-181 Annex 1 archive no longer matches its reviewed copy.');
  const archive = await JSZip.loadAsync(zipBytes), entries = Object.values(archive.files).filter(file => !file.dir);
  if (entries.length !== 1) throw new Error('PP-181 Annex 1 archive no longer contains exactly one document.');
  const pdfBytes = Buffer.from(await entries[0]!.async('nodebuffer'));
  if (pdfBytes.length !== PP181_ANNEX1_PDF_PIN.bytes || sha256(pdfBytes) !== PP181_ANNEX1_PDF_PIN.sha256 || !pdfBytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('PP-181 Annex 1 PDF no longer matches its reviewed copy.');
  const nomenclature = parseUzbekistanNomenclature(await extractPdfTablePages(pdfBytes));
  if (nomenclature.size !== UZBEKISTAN_EXPECTED_NOMENCLATURE_CODES) throw new Error(`PP-181 Annex 1 yielded ${nomenclature.size} ten-digit codes instead of ${UZBEKISTAN_EXPECTED_NOMENCLATURE_CODES}.`);
  const schedule = resolveUzbekistanSchedule({ nomenclature, grid });
  for (const code of ['7106920000', '7113190000', '7114190000']) if (!schedule.find(line => line.code === code)?.temporary) throw new Error(`Uzbekistan footnote-governed line ${code} did not receive its temporary rate.`);

  // Origin treatment, currentness and remedy evidence (all National Database of Legislation).
  const customsCodeText = stripHtml((await request(UZBEKISTAN_CUSTOMS_CODE_URL, { fetch_impl, attempts, expect: 'html' })).toString('utf8'));
  const customsCodeMarkers = ['Применение режима наибольшего благоприятствования в торгово-экономических отношениях', 'дополнительная таможенная пошлина по следующим ставкам', 'до десяти процентов — пять процентов', 'от десяти до двадцати процентов — десять процентов', 'от двадцати до тридцати процентов — пятнадцать процентов', 'тридцати процентов и более — двадцать процентов', 'ЗРУ-1097', '28 февраля 2026 года', 'особые (специальные, антидемпинговые и компенсационные)'] as const;
  requireMarkers('lex.uz Customs Code', customsCodeText, customsCodeMarkers);
  const copyrightText = stripHtml((await request(UZBEKISTAN_COPYRIGHT_LAW_URL, { fetch_impl, attempts, expect: 'html' })).toString('utf8'));
  const copyrightMarkers = ['ЎРҚ-42-сон', 'Муаллифлик ҳуқуқи объектлари ҳисобланмайдиган материаллар', 'расмий ҳужжатлар (қонунлар, қарорлар, тўхтамлар ва шу кабилар), шунингдек уларнинг расмий таржималари'] as const;
  requireMarkers('lex.uz Law ZRU-42', copyrightText, copyrightMarkers);
  const pf174Text = stripHtml((await request(UZBEKISTAN_PF174_URL, { fetch_impl, attempts, expect: 'html' })).toString('utf8'));
  requireMarkers('lex.uz PF-174', pf174Text, ['ПФ-174-сон']);
  if (pf174Text.includes('3818')) throw new Error('PF-174 now references PP-3818; its effect on the Annex 1 grid must be reviewed.');
  const pf175Text = stripHtml((await request(UZBEKISTAN_PF175_URL, { fetch_impl, attempts, expect: 'html' })).toString('utf8'));
  const pf175Markers = ['ПФ-175-сон', 'Антидемпинг чораларини қўллашга доир қўшимча чора-тадбирлар тўғрисида', 'қонун ва Вазирлар Маҳкамаси қарори лойиҳаси', '2026 йил ноябрь'] as const;
  requireMarkers('lex.uz PF-175', pf175Text, pf175Markers);
  if (pf175Text.includes('3818')) throw new Error('PF-175 now references PP-3818; its effect on the Annex 1 grid must be reviewed.');
  const resolution416Text = stripHtml((await request(UZBEKISTAN_RESOLUTION_416_URL, { fetch_impl, attempts, expect: 'html' })).toString('utf8'));
  const resolution416Markers = ['416-сон 29.07.2026', 'Тариф квоталарини жорий этиш ва маъмурий бошқариш тартиби тўғрисида'] as const;
  requireMarkers('lex.uz Cabinet Resolution 416', resolution416Text, resolution416Markers);
  const indiaText = stripHtml((await request(UZBEKISTAN_INDIA_TRADE_AGREEMENT_URL, { fetch_impl, attempts, expect: 'html' })).toString('utf8'));
  const indiaMarkers = ['О торговом и экономическом сотрудничестве', 'Республики Индия', '24.05.1993'] as const;
  requireMarkers('lex.uz Uzbekistan–India trade agreement', indiaText, indiaMarkers);
  const searches = [];
  for (const query of UZBEKISTAN_REMEDY_SEARCH_QUERIES) searches.push({ query, ...(await searchLexAll(query, fetch_impl, attempts)) });
  if (searches.some(search => search.total === 0)) throw new Error('A lex.uz trade-remedy search returned no acts; the zero-remedy enumeration cannot be re-established.');
  const allHits = new Map(searches.flatMap(search => search.hits.map(hit => [hit.doc_id, hit.title] as const)));
  // A measure names a specific duty (singular) or the goods it applies to; enactment of the framework law
  // "О защитных мерах, антидемпинговых и компенсационных пошлинах" (2003) is not a measure.
  const imposing = [...allHits.values()].filter(title => !/в действие Закона/i.test(title) && (/(?:антидемпинговой|компенсационной|специальной(?: защитной)?) пошлины/i.test(title) || /(?:антидемпинг|компенсацион|защитн)\w*[^.]{0,80}в отношении/i.test(title)));
  if (imposing.length) throw new Error(`lex.uz now lists an act that may impose a trade-remedy duty: ${imposing.join(' | ')}`);

  const normalized = { schedule_lines: schedule, remedies: UZBEKISTAN_TRADE_REMEDY_MANIFEST };
  const normalizedBytes = Buffer.from(JSON.stringify(normalized), 'utf8');
  const retained = [
    { name: 'pp3818-consolidated.html', role: 'official_base_rate_grid_legal_instrument', url: UZBEKISTAN_PP3818_URL, bytes: pp3818Bytes },
    { name: 'pp181-annex1.zip', role: 'official_national_nomenclature_legal_instrument', url: UZBEKISTAN_PP181_ANNEX1_ZIP_URL, bytes: zipBytes },
    { name: 'pp181-edition.json', role: 'official_nomenclature_currentness_evidence', url: UZBEKISTAN_PP181_URL, bytes: evidence(UZBEKISTAN_PP181_URL, pp181Text, pp181Markers, { latest_edition: '01.06.2025' }) },
    { name: 'customs-code-art-300-1.json', role: 'official_origin_treatment_evidence', url: UZBEKISTAN_CUSTOMS_CODE_URL, bytes: evidence(UZBEKISTAN_CUSTOMS_CODE_URL, customsCodeText, customsCodeMarkers, { note: 'lex.uz renders article 300¹ in an unofficial Russian translation; the official Uzbek text of ZRU-1097 governs.' }) },
    { name: 'copyright-law-art-8.json', role: 'official_uzbekistan_copyright_law_article_8', url: UZBEKISTAN_COPYRIGHT_LAW_URL, bytes: evidence(UZBEKISTAN_COPYRIGHT_LAW_URL, copyrightText, copyrightMarkers) },
    { name: 'pf-174.json', role: 'official_currentness_evidence_no_grid_change', url: UZBEKISTAN_PF174_URL, bytes: evidence(UZBEKISTAN_PF174_URL, pf174Text, ['ПФ-174-сон'], { references_pp3818: false }) },
    { name: 'pf-175.json', role: 'official_future_trade_remedy_work_not_a_duty', url: UZBEKISTAN_PF175_URL, bytes: evidence(UZBEKISTAN_PF175_URL, pf175Text, pf175Markers, { references_pp3818: false }) },
    { name: 'resolution-416.json', role: 'official_tariff_quota_procedure_no_quota_volumes', url: UZBEKISTAN_RESOLUTION_416_URL, bytes: evidence(UZBEKISTAN_RESOLUTION_416_URL, resolution416Text, resolution416Markers) },
    { name: 'india-trade-agreement.json', role: 'official_india_bilateral_instrument_evidence', url: UZBEKISTAN_INDIA_TRADE_AGREEMENT_URL, bytes: evidence(UZBEKISTAN_INDIA_TRADE_AGREEMENT_URL, indiaText, indiaMarkers, { operative_text_published: false }) },
    { name: 'trade-remedy-search.json', role: 'official_trade_remedy_enumeration_evidence', url: searches[0]!.url, bytes: Buffer.from(JSON.stringify({ searches: searches.map(search => ({ query: search.query, source_url: search.url, reported_total: search.total, enumerated: search.hits })), union_acts: allHits.size, imposing_acts: imposing }, null, 2), 'utf8') },
    { name: 'normalized.json', role: 'deterministic_normalized_tariff_bundle', url: UZBEKISTAN_PP3818_URL, bytes: normalizedBytes },
  ];
  const artifacts = retained.map(item => ({ name: item.name, role: item.role, url: item.url, size_bytes: item.bytes.length, sha256: sha256(item.bytes) }));
  const manifest = {
    acquisition_version: UZBEKISTAN_ACQUISITION_VERSION, release_identifier, effective_base: UZBEKISTAN_BASE_FROM, acquired_as_current_on: release_identifier,
    reader_version: 'uz-lex-bundle-reader-v1', parser_version: UZBEKISTAN_PARSER_VERSION, artifacts,
    base_evidence: { instrument: 'Presidential Resolution PP-3818 of 2018-06-29, Annex 1 (import customs duty rates), restated by PP-181 of 2025-05-14 (in force 2025-06-01) and amended by PP-58 of 2026-02-11 (heading 2515)', latest_edition: pp3818Edition, rate_rows: grid.length, rate_prefixes: prefixCount, nomenclature_instrument: 'PP-181 Annex 1 (TN VED, 2022 edition)', nomenclature_codes: nomenclature.size },
    footnote_evidence: { spent_before_base: ['* (7101–7104: 0% until 2026-01-01)', '**** (selected 8703 lines: 0% until 2026-01-01)', '***** (selected 8703 lines: 5% until 2026-01-01)'], live: ['** (7106 92 000 0 ligatures used in jewellery: 0% until 2027-10-01; end-use conditional, non-declarable)', '*** (7113 19 000 0, 7114 19 000 0 finished jewellery: 10% until 2027-01-01)'] },
    currentness_evidence: { pp3818_latest_edition: pp3818Edition, pp181_latest_edition: '01.06.2025', pf174: 'customs-administration decree; does not amend PP-3818; its tariff items are list-conditioned exemptions or 2027 individual-import rules', pf175: 'item 36 (0% on pearls/precious stones) and item 37 (anti-dumping) are draft instruments only', resolution_416: 'tariff-quota procedure only; no quota volumes or in-quota rates are established' },
    origin_evidence: { non_mfn_additional_duty: { article: 'Customs Code art. 300¹ (ZRU-1097)', in_force_from: UZBEKISTAN_NON_MFN_ADDITIONAL_DUTY_FROM, bands_by_ad_valorem_rate: [[0, 10, 5], [10, 20, 10], [20, 30, 15], [30, null, 20]], boundary_note: 'The rendered text says "up to ten" and "from ten to twenty"; a rate of exactly 10% or 20% sits on an ambiguous band boundary.' }, india_mfn_status: 'unverified: the 1993 Uzbekistan–India Agreement on Trade and Economic Cooperation is in force but its operative text is not published in the National Database of Legislation' },
    rights_evidence: { law_article: 'Uzbekistan Law ZRU-42 on Copyright and Related Rights article 8', source: UZBEKISTAN_COPYRIGHT_LAW_URL, rule: 'Official documents (laws, resolutions, decisions and the like) and their official translations are not objects of copyright. ClearTrade retains the official legal instruments and narrowly normalized tariff facts; the tarif.customs.uz portal is not used as an executable source.' },
    india_preference_evidence: { status: 'not_applicable', basis: 'No free-trade or preferential tariff regime between Uzbekistan and India exists in the National Database of Legislation; the only bilateral trade instrument is the 1993 Agreement on Trade and Economic Cooperation. The Uzbekistan–Pakistan preferential arrangement does not extend to India.' },
    trade_remedy_evidence: { register_enumeration_complete: true, enumeration_basis: 'Every page of lex.uz national-legislation searches for anti-dumping/countervailing duty terms', searches: searches.map(search => ({ query: search.query, total: search.total })), union_acts: allHits.size, imposing_acts: 0, active_instruments: 0, pending_draft_work: 1 },
    scope: { executable_source: 'legal_instruments', portal_parity: 'not performed — tarif.customs.uz exposes only an interactive calculator; private browser calls are not used', tariff_treatment_complete_for_mfn_origins: true, regulatory_coverage_complete: false, omitted_regulatory_layer: 'VAT, excise, utilisation fees, certification and other non-tariff requirements are outside this tariff pack; absence is not evidence of no requirement.' },
  };
  const zip = new JSZip();
  for (const item of retained) zip.file(item.name, item.bytes);
  zip.file('acquisition.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 }, platform: 'UNIX', streamFiles: true }));
}

export const __test__ = { latestEdition, stripHtml };
