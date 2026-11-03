import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { MOROCCO_BASE_FROM, MOROCCO_EXPECTED_CHAPTERS, MOROCCO_PARSER_VERSION, moroccoSeason, parseMoroccoChapter, type MoroccoPage, type MoroccoTariffLine } from './morocco-bundle';
import { MOROCCO_CHAPTER_PINS, MOROCCO_CIRCULAR_PINS, MOROCCO_LAW_2_00_PIN, MOROCCO_REVIEWED_2026_CIRCULARS, MOROCCO_REVIEWED_REMEDY_NOTICES } from './morocco-evidence';
import { MOROCCO_CIRCULAR_LISTING_URL, MOROCCO_TRADE_REMEDY_MANIFEST } from './morocco-remedies';

export const MOROCCO_ACQUISITION_VERSION = 'ma-adii-public-acquisition-v1' as const;
/** TDI lines read from the 96 tariff chapters (Chapter 77 is reserved) of the reviewed 2026 edition. */
export const MOROCCO_EXPECTED_LINES = 13_225;
const ADII = 'https://www.douane.gov.ma';
const TARIFF_INDEX = `${ADII}/tarif/tarif/init.jsf`;
const WIPO_LAW_PAGE = 'https://www.wipo.int/wipolex/fr/legislation/details/19766';
const MIC = 'https://www.mcinet.gov.ma/fr';
const ALLOWED_HOSTS = new Set(['www.douane.gov.ma', 'www.mcinet.gov.ma', 'www.wipo.int', 'wipolex-res.wipo.int']);

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
const squash = (value: string) => value.replace(/\s+/g, '');
const decode = (value: string) => value.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16))).replace(/&quot;/g, '"').replace(/&rsquo;/g, '’').replace(/&amp;/g, '&');
export function moroccoOfficialUrl(value: string) { const url = new URL(value); if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) throw new Error(`Morocco authority acquisition rejects ${url.hostname}.`); return url.toString(); }

type Expect = 'html' | 'pdf';
class Session { cookies = new Map<string, string>(); header() { return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '); } absorb(headers: Headers) { const raw = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [headers.get('set-cookie') ?? '']; for (const cookie of raw) { const pair = cookie.split(';')[0]!; const index = pair.indexOf('='); if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim()); } } }
async function request(url: string, options: { fetch_impl: typeof fetch; attempts: number; expect: Expect; session?: Session; form?: URLSearchParams; referer?: string; max_bytes?: number }) {
  let last: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      const headers: Record<string, string> = { accept: options.expect === 'pdf' ? 'application/pdf,*/*' : 'text/html,*/*', 'accept-language': 'fr-FR,fr;q=0.9', 'user-agent': 'Mozilla/5.0 ClearTrade-Customs-Atlas/1.0' };
      if (options.session?.cookies.size) headers.cookie = options.session.header();
      if (options.referer) headers.referer = options.referer;
      if (options.form) headers['content-type'] = 'application/x-www-form-urlencoded';
      const response = await options.fetch_impl(moroccoOfficialUrl(url), { method: options.form ? 'POST' : 'GET', body: options.form?.toString(), headers, signal: AbortSignal.timeout(120_000) });
      if (response.url) moroccoOfficialUrl(response.url);
      options.session?.absorb(response.headers);
      if (!response.ok) { if (response.status !== 429 && response.status < 500) throw new Error(`non-retryable HTTP ${response.status}`); throw new Error(`retryable HTTP ${response.status}`); }
      const type = response.headers.get('content-type') ?? '';
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw new Error('empty response');
      if (bytes.length > (options.max_bytes ?? 16 * 1024 * 1024)) throw new Error('response exceeded bounded size');
      if (/Request Rejected/.test(bytes.subarray(0, 4096).toString('latin1'))) throw new Error('non-retryable the authority\'s web application firewall rejected the request; it is not bypassed');
      if (options.expect === 'pdf' && (!/pdf|octet-stream/i.test(type) || !bytes.subarray(0, 5).equals(Buffer.from('%PDF-')))) throw new Error(`non-retryable response is not a PDF (${type})`);
      if (options.expect === 'html' && !/text\/html/i.test(type)) throw new Error(`non-retryable unexpected content type ${type}`);
      const text = options.expect === 'html' ? (/iso-8859-1/i.test(type) ? bytes.toString('latin1') : bytes.toString('utf8')) : '';
      return { bytes, text };
    } catch (error) {
      last = error;
      if (attempt === options.attempts || /non-retryable|exceeded/.test(String(error))) throw new Error(`Morocco authority acquisition failed for ${url} after ${attempt} attempt(s): ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }
  }
  throw last;
}
async function pooled<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>) {
  const out: R[] = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { for (;;) { const index = next++; if (index >= items.length) return; out[index] = await run(items[index]!); } }));
  return out;
}
/**
 * The ADII delivery path intermittently rewrites "http://" to "https://" inside served PDFs (in their XMP
 * metadata), shifting byte offsets. Reversing every such rewrite restores one canonical file whatever
 * variant was served; DMS documents are pinned, parsed and retained in that canonical form.
 */
export function canonicalAdiiDocument(bytes: Buffer) { return Buffer.from(bytes.toString('latin1').replaceAll('https://', 'http://'), 'latin1'); }
function pinned(label: string, bytes: Buffer, pin: { bytes: number; sha256: string } | undefined) {
  if (!pin) throw new Error(`Morocco artifact ${label} has no reviewed pin; a new or reissued publication must be reviewed before acquisition.`);
  if (bytes.length !== pin.bytes || sha256(bytes) !== pin.sha256) throw new Error(`Morocco artifact ${label} no longer matches its reviewed copy (the authority reissued it).`);
}
function hiddenFields(form: string) {
  const fields = new URLSearchParams();
  for (const input of form.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) { const name = /name="([^"]+)"/.exec(input[0])?.[1]; if (name) fields.set(decode(name), decode(/value="([^"]*)"/.exec(input[0])?.[1] ?? '')); }
  return fields;
}
function formOf(html: string, id: string) {
  const match = new RegExp(`<form[^>]*id="${id}"[^>]*action="([^"]+)"[\\s\\S]*?</form>`).exec(html);
  if (!match) throw new Error(`ADII page layout changed: form ${id} not found.`);
  return { action: `${ADII}${decode(match[1]!)}`, fields: hiddenFields(match[0]) };
}

export async function extractMoroccoPages(bytes: Buffer): Promise<MoroccoPage[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0, useSystemFonts: true }).promise;
  const out: MoroccoPage[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber), viewport = page.getViewport({ scale: 1 }), content = await page.getTextContent();
    const all = content.items.filter((item): item is Extract<typeof item, { str: string }> => 'str' in item);
    out.push({ page_number: pageNumber, width: viewport.width, height: viewport.height, text: all.map(item => item.str).join(' ').normalize('NFC'), items: all.filter(item => item.str.trim()).map(item => ({ str: item.str.normalize('NFC'), x: item.transform[4], y: item.transform[5], w: item.width })) });
  }
  return out;
}
const pdfText = async (bytes: Buffer) => squash((await extractMoroccoPages(bytes)).map(page => page.text).join(' '));
function requireMarkers(label: string, text: string, markers: readonly string[]) {
  const missing = markers.filter(marker => !text.includes(squash(marker)));
  if (missing.length) throw new Error(`${label} no longer supports the reviewed determination (missing: ${missing.join(' | ')}).`);
}

/** The TDI index lists each section's chapter PDFs behind a JSF postback; the order of the 97 chapter documents is the chapter order. */
async function chapterDocuments(fetch_impl: typeof fetch, attempts: number) {
  const session = new Session(), index = await request(TARIFF_INDEX, { fetch_impl, attempts, expect: 'html', session });
  const form = formOf(index.text, 'formTarifInit'), out: { document_id: string; label: string }[] = [];
  for (let section = 1; section <= 21; section += 1) {
    const fields = new URLSearchParams(form.fields); fields.set('formTarifInit', 'formTarifInit'); fields.set('formTarifInit:_idcl', `formTarifInit:l_${section}`); fields.set('idSection', String(section));
    const page = await request(form.action, { fetch_impl, attempts, expect: 'html', session, form: fields, referer: TARIFF_INDEX });
    for (const match of page.text.matchAll(/<a[^>]*href="\/dms\/loadDocument\?documentId=(\d+)&(?:amp;)?application=tarif"[^>]*>([\s\S]*?)<\/a>/g)) {
      const label = clean(decode(decode(match[2]!.replace(/<[^>]+>/g, ' '))));
      if (!/^Note/i.test(label)) out.push({ document_id: match[1]!, label });
    }
  }
  if (out.length !== MOROCCO_EXPECTED_CHAPTERS || new Set(out.map(item => item.document_id)).size !== out.length) throw new Error(`The ADII tariff index lists ${out.length} chapter documents instead of ${MOROCCO_EXPECTED_CHAPTERS}.`);
  return out;
}

/** The official circular system publishes an annual thematic listing; every 2026 circular must already have been reviewed. */
async function circularListing(year: string, fetch_impl: typeof fetch, attempts: number) {
  const session = new Session(), first = await request(MOROCCO_CIRCULAR_LISTING_URL, { fetch_impl, attempts, expect: 'html', session });
  const annual = formOf(first.text, 'rechFrm'); annual.fields.set('rechFrm:idReleveAnnuel', 'rechFrm:idReleveAnnuel');
  const panelPage = await request(annual.action, { fetch_impl, attempts, expect: 'html', session, form: annual.fields });
  const panel = formOf(panelPage.text, 'FrmPanel'); panel.fields.set('FrmPanel:AnTxt', year); panel.fields.set('FrmPanel:AnBt.x', '10'); panel.fields.set('FrmPanel:AnBt.y', '8');
  const listing = await request(panel.action, { fetch_impl, attempts, expect: 'html', session, form: panel.fields });
  const declared = /\((\d+) CIRCULAIRES\)/.exec(listing.text)?.[1];
  const numbers = new Map<string, { date: string; subject: string; document_id: string | null }>();
  for (const block of listing.text.split('<span class="titreCirculaire">').slice(1)) {
    const number = /titreCirculaireValue">\s*([^<]+?)\s*</.exec(block)?.[1]?.replace(/\s/g, ''), dated = /DateCirculaireValue">([^<]+)</.exec(block)?.[1];
    if (number && dated) numbers.set(number, { date: dated.trim(), subject: clean(decode((/<p>([\s\S]*?)<\/p>/.exec(block)?.[1] ?? '').replace(/<[^>]+>/g, ''))), document_id: /documentId=(\d+)&(?:amp;)?application=circulaire/.exec(block)?.[1] ?? null });
  }
  if (!declared || numbers.size !== Number(declared)) throw new Error(`The ADII ${year} circular listing declares ${declared ?? '?'} circulars but ${numbers.size} were read.`);
  return numbers;
}

/** Walks every page of the Ministry's anti-dumping, safeguard and countervailing notice streams. */
async function remedyNoticeTitles(fetch_impl: typeof fetch, attempts: number) {
  const titles = new Set<string>();
  for (const [path, id] of [['antidumping', 80], ['avis-sauvegarde', 82], ['antisubvention', 81]] as const) {
    for (let page = 0; page < 40; page += 1) {
      const html = (await request(`${MIC}/${path}?field_type_avis_target_id=${id}&page=${page}`, { fetch_impl, attempts, expect: 'html', max_bytes: 4 * 1024 * 1024 })).text;
      const text = decode(clean(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' | ')).replace(/(\s*\|\s*)+/g, ' | '));
      const found = [...text.matchAll(/(Avis public n° ?[^|]{5,400}?) \| [^|]*\.pdf \| (\d\d-\d\d-\d{4})/gi)].map(match => clean(match[1]!).slice(0, 140).trim());
      const before = titles.size; for (const title of found) titles.add(title);
      if (titles.size === before) break;
    }
  }
  return titles;
}
/** An unreviewed notice fails closed. */
async function remedyNotices(fetch_impl: typeof fetch, attempts: number) {
  const titles = await remedyNoticeTitles(fetch_impl, attempts);
  const unreviewed = [...titles].filter(title => !MOROCCO_REVIEWED_REMEDY_NOTICES.has(title));
  if (unreviewed.length) throw new Error(`The Ministry published ${unreviewed.length} unreviewed trade-remedy notice(s): ${unreviewed.join(' | ')}`);
  if (titles.size < MOROCCO_REVIEWED_REMEDY_NOTICES.size) throw new Error(`The Ministry notice walk returned ${titles.size} of ${MOROCCO_REVIEWED_REMEDY_NOTICES.size} reviewed notices; the streams were not fully walked.`);
  return titles.size;
}

const FINANCE_LAW_2026 = 'Finance Law 50-25 for 2026 (art. 5 bis), circular 6702/210';
/** 2026 decree overlays on the statutory TDI rates, each read from its pinned implementing circular. */
function applyOverlays(lines: Map<string, MoroccoTariffLine>) {
  const at = (code: string) => { const line = lines.get(code); if (!line) throw new Error(`A reviewed 2026 overlay names ${code}, which is not a TDI line.`); return line; };
  const where = (predicate: (code: string) => boolean) => [...lines.values()].filter(line => predicate(line.code));
  for (const code of ['1001990019', '1001990090']) {
    const line = at(code);
    line.versions = [
      { from: MOROCCO_BASE_FROM, until: '2026-05-31', expression: '0', instrument: 'Suspension in force since 2021-11-01 (circular 6241/211)', kind: 'suspension' },
      { from: '2026-06-01', until: '2026-08-31', expression: line.expression, instrument: 'Decrees 2.26.419 and 2.26.583, circulars 6739/211 and 6761/211', kind: 'restoration' },
      { from: '2026-09-01', until: null, expression: '0', instrument: 'Decree 2.26.583 of 2026-07-23, circular 6761/211', kind: 'suspension' },
    ];
  }
  const meat = where(code => code === '0104109010' || /^(0201|0202|0204|020860)/.test(code));
  if (meat.length < 20) throw new Error('Decree 2.26.584 scope matched too few TDI lines.');
  for (const line of meat) line.versions = [...line.versions, { from: '2026-07-27', until: '2026-12-31', expression: '0', instrument: 'Decree 2.26.584 of 2026-07-23, circular 6762/211', kind: 'suspension' }];
  for (const line of where(code => code.startsWith('0206') && !/^0206(30|41|49)/.test(code))) line.partial_versions = [...line.partial_versions, { from: '2026-07-27', until: '2026-12-31', expression: '30', instrument: 'Decree 2.26.584 of 2026-07-23, circular 6762/211', kind: 'rate_change', scope: 'offal of domestic bovine, ovine, caprine or camel animals only (Ex 02.06)' }];
  for (const line of where(code => code.startsWith('0102'))) line.quota_suspensions = [{ from: '2026-01-01', until: '2026-12-31', quota: '300,000 head', instrument: FINANCE_LAW_2026, condition: 'Import duty suspended for live domestic bovine animals within the quota, on a customs franchise request.' }];
  for (const line of where(code => code.startsWith('010613'))) line.quota_suspensions = [{ from: '2026-01-01', until: '2026-12-31', quota: '10,000 head', instrument: FINANCE_LAW_2026, condition: 'Import duty suspended for live domestic camelids within the quota, on a customs franchise request.' }];
}

/** Statutory rates the 2026 Finance Law (circular 6702/210, annex II) set; the chapter PDFs must already carry them. */
const FINANCE_LAW_CANARIES: Readonly<Record<string, string>> = { '0910200010': '60', '0910200090': '60', '3904109000': '10', '8517130030': '2,5', '8517180000': '2,5', '8418300020': '17,5', '8450200010': '17,5', '5404190010': '17,5', '6006311010': '30', '6006339093': '30', '7310219991': '17,5', '8708220000': '17,5', '3822121910': '17,5', '3822192910': '17,5' };

export async function acquireMoroccoAuthorityBundle(options: { release_identifier?: string; fetch_impl?: typeof fetch; attempts?: number } = {}) {
  const release_identifier = options.release_identifier ?? '2026-09-23';
  if (release_identifier !== '2026-09-23') throw new Error('Morocco qualification release_identifier must be the bounded 2026-09-23 reference date.');
  const fetch_impl = options.fetch_impl ?? fetch, attempts = options.attempts ?? 3;

  // Currentness: every 2026 circular must be one already reviewed for tariff, suspension, quota and remedy effect.
  const listing2026 = await circularListing('2026', fetch_impl, attempts);
  const unreviewed = [...listing2026.keys()].filter(number => !MOROCCO_REVIEWED_2026_CIRCULARS.has(number));
  if (unreviewed.length || [...MOROCCO_REVIEWED_2026_CIRCULARS].some(number => !listing2026.has(number))) throw new Error(`The ADII 2026 circular listing changed (unreviewed: ${unreviewed.map(number => `${number} ${listing2026.get(number)?.subject}`).join(' | ') || 'none'}).`);
  const notices = await remedyNotices(fetch_impl, attempts);

  const documents = await chapterDocuments(fetch_impl, attempts);
  const chapters = await pooled(documents, 3, async document => {
    const bytes = canonicalAdiiDocument((await request(`${ADII}/dms/loadDocument?documentId=${document.document_id}&application=tarif`, { fetch_impl, attempts, expect: 'pdf', max_bytes: 32 * 1024 * 1024 })).bytes);
    pinned(`chapter document ${document.document_id}`, bytes, MOROCCO_CHAPTER_PINS[document.document_id]);
    return { ...document, bytes };
  });
  const lines = new Map<string, MoroccoTariffLine>(), diagnostics: Record<string, unknown>[] = [];
  let reserved = 0;
  for (const chapter of chapters) {
    const pages = await extractMoroccoPages(chapter.bytes);
    const prefixes = new Map<string, number>();
    for (const page of pages) for (const item of page.items) { const match = /^(\d{2})\.?\d{2}\.\d{2}$/.exec(item.str.trim().split(/\s+/)[0]!); if (match && item.x < page.width * 0.4) prefixes.set(match[1]!, (prefixes.get(match[1]!) ?? 0) + 1); }
    const number = [...prefixes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '77';
    const parsed = parseMoroccoChapter(pages, number);
    if (parsed.reserved) { reserved += 1; continue; }
    diagnostics.push({ chapter: number, document_id: chapter.document_id, lines: parsed.rows.length, heading_rates: parsed.heading_rates.length, duplicates: parsed.duplicates });
    for (const row of parsed.rows) {
      if (lines.has(row.code)) throw new Error(`TDI line ${row.code} appears in two chapter documents.`);
      lines.set(row.code, { code: row.code, chapter: number, description: row.description, expression: row.expression, footnote: row.footnote, footnote_text: row.footnote ? parsed.footnotes.get(row.footnote) ?? null : null, unit: row.unit, season: moroccoSeason(row.description), versions: [], quota_suspensions: [], partial_versions: [], pairing: row.pairing, inferred_segment: row.inferred_segment, conflicting_expressions: row.conflicting_expressions });
    }
  }
  if (reserved !== 1 || lines.size !== MOROCCO_EXPECTED_LINES) throw new Error(`The TDI yielded ${lines.size} lines (${reserved} reserved chapter) instead of ${MOROCCO_EXPECTED_LINES}.`);
  const staleCanaries = Object.entries(FINANCE_LAW_CANARIES).filter(([code, rate]) => lines.get(code)?.expression !== rate);
  if (staleCanaries.length) throw new Error(`The TDI chapters do not carry the 2026 Finance Law rates for ${staleCanaries.map(([code]) => code).join(', ')}.`);

  // Circulars relied on: the Finance Law, 2026 decree overlays and every trade-remedy measure.
  const circulars = await pooled(Object.entries(MOROCCO_CIRCULAR_PINS), 3, async ([number, pin]) => {
    const bytes = canonicalAdiiDocument((await request(`${ADII}/dms/loadDocument?documentId=${pin.document_id}&application=circulaire`, { fetch_impl, attempts, expect: 'pdf' })).bytes);
    pinned(`circular ${number}`, bytes, pin);
    return { number, pin, bytes };
  });
  const textOf = async (number: string) => pdfText(circulars.find(item => item.number === number)!.bytes);
  requireMarkers('Circular 6702/210', await textOf('6702/210'), ['Article 5 bis', '300 000 têtes', '10 000 têtes', '31 décembre 2026']);
  requireMarkers('Circular 6761/211', await textOf('6761/211'), ['Décret n° 2.26.583', 'jusqu’au 31 août 2026', 'septembre 2026']);
  requireMarkers('Circular 6739/211', await textOf('6739/211'), ['1001.99.00.19', '1001.99.00.90']);
  requireMarkers('Circular 6762/211', await textOf('6762/211'), ['0104.10.90.10', '0208.60', '30%', '31 décembre 2026']);
  applyOverlays(lines);
  for (const measure of MOROCCO_TRADE_REMEDY_MANIFEST.measures) {
    const missing = measure.tariff_codes.filter(code => !lines.has(code));
    if (missing.length) throw new Error(`Remedy ${measure.id} names ${missing.join(', ')}, which are not TDI lines.`);
    if (measure.code_prefixes.some(prefix => ![...lines.keys()].some(code => code.startsWith(prefix)))) throw new Error(`Remedy ${measure.id} names a heading with no TDI line.`);
    if (measure.codes_not_in_schedule.some(code => lines.has(code))) throw new Error(`Remedy ${measure.id} records ${measure.codes_not_in_schedule.join(', ')} as unmatched, but a TDI line now exists.`);
  }

  // Rights: Law 2-00 article 8, from WIPO Lex's consolidated French text.
  const wipoPage = (await request(WIPO_LAW_PAGE, { fetch_impl, attempts, expect: 'html', max_bytes: 4 * 1024 * 1024 })).text;
  const lawUrl = /https:\/\/wipolex-res\.wipo\.int\/edocs\/lexdocs\/laws\/fr\/ma\/ma073fr_1\.pdf\?[^'"]+/.exec(wipoPage)?.[0];
  if (!lawUrl) throw new Error('WIPO Lex no longer links the consolidated French text of Law 2-00.');
  const law = (await request(decode(lawUrl), { fetch_impl, attempts, expect: 'pdf' })).bytes;
  pinned('Law 2-00 (WIPO Lex)', law, MOROCCO_LAW_2_00_PIN);
  requireMarkers('Law 2-00', await pdfText(law), ['Article 8', 'aux textes officiels de nature législative, administrative ou judiciaire']);

  const schedule_lines = [...lines.values()].sort((a, b) => a.code.localeCompare(b.code));
  const normalizedBytes = Buffer.from(JSON.stringify({ schedule_lines, remedies: MOROCCO_TRADE_REMEDY_MANIFEST }), 'utf8');
  const evidence = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2), 'utf8');
  const pairing = schedule_lines.reduce<Record<string, number>>((counts, line) => ({ ...counts, [line.pairing]: (counts[line.pairing] ?? 0) + 1 }), {});
  const retained = [
    ...chapters.map(item => ({ name: `tdi/${item.document_id}.pdf`, role: 'official_tdi_chapter', url: `${ADII}/dms/loadDocument?documentId=${item.document_id}&application=tarif`, bytes: item.bytes })),
    ...circulars.map(item => ({ name: `circulars/${item.number.replace('/', '-')}.pdf`, role: 'official_adii_circular', url: `${ADII}/dms/loadDocument?documentId=${item.pin.document_id}&application=circulaire`, bytes: item.bytes })),
    { name: 'rights/law-2-00-wipolex-fr.pdf', role: 'official_morocco_copyright_law', url: WIPO_LAW_PAGE, bytes: law },
    { name: 'circular-listing-2026.json', role: 'official_circular_enumeration', url: MOROCCO_CIRCULAR_LISTING_URL, bytes: evidence(Object.fromEntries(listing2026)) },
    { name: 'parse-diagnostics.json', role: 'deterministic_parse_diagnostics', url: TARIFF_INDEX, bytes: evidence({ chapters: diagnostics, pairing }) },
    { name: 'normalized.json', role: 'deterministic_normalized_tariff_bundle', url: TARIFF_INDEX, bytes: normalizedBytes },
  ];
  const artifacts = retained.map(item => ({ name: item.name, role: item.role, url: item.url, size_bytes: item.bytes.length, sha256: sha256(item.bytes) }));
  const manifest = {
    acquisition_version: MOROCCO_ACQUISITION_VERSION, release_identifier, effective_base: MOROCCO_BASE_FROM, acquired_as_current_on: release_identifier, reader_version: 'ma-adii-bundle-reader-v1', parser_version: MOROCCO_PARSER_VERSION, artifacts,
    delivery_normalization: 'ADII DMS documents are retained in canonical form: the delivery path\'s intermittent http→https rewriting inside served PDFs is reversed before pinning and parsing.',
    base_evidence: { chapters: MOROCCO_EXPECTED_CHAPTERS, reserved_chapters: ['77'], tdi_lines: lines.size, pairing, instrument: 'ADII TDI chapter PDFs, HS 2022 edition as amended by Finance Law 50-25 for 2026' },
    currentness_evidence: { circulars_2026: listing2026.size, overlays: ['Finance Law 2026 art. 5 bis (cattle 300,000 head, camelids 10,000 head)', 'Decrees 2.26.419/2.26.583 soft wheat', 'Decree 2.26.584 sheep, meat and offal'] },
    rights_evidence: { law_article: 'Morocco Law No. 2-00 on Copyright and Related Rights article 8', source: 'WIPO Lex consolidated French text (to Law 79-12)', rule: 'Protection does not extend to official texts of a legislative, administrative or judicial nature, nor to their official translations.' },
    india_preference_evidence: { status: 'not_applicable', basis: 'No preferential-origin circular for India in the complete ADII record 2015–2026; India-origin goods take the MFN rate.' },
    trade_remedy_evidence: { register_enumeration_complete: true, remedy_notices_reviewed: notices, active_measures: MOROCCO_TRADE_REMEDY_MANIFEST.measures.length, india_active_measures: MOROCCO_TRADE_REMEDY_MANIFEST.measures.filter(measure => measure.kind === 'SAFEGUARD' && !measure.exempt_origins.includes('IN')).map(measure => measure.id), india_pending: ['DDC/07/2026 ceramic tiles (investigation, not a duty)'] },
    scope: { tariff_treatment_complete: true, regulatory_coverage_complete: false, omitted_regulatory_layer: 'VAT, TIC, the parafiscal import tax, licensing and quantitative restrictions are outside this tariff pack.' },
  };
  const zip = new JSZip();
  for (const item of retained) zip.file(item.name, item.bytes);
  zip.file('acquisition.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 }, platform: 'UNIX', streamFiles: true }));
}

export const __test__ = { canonicalAdiiDocument, pinned, requireMarkers, applyOverlays, remedyNotices, remedyNoticeTitles, circularListing };
