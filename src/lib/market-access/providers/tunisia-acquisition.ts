import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { decodeTunisiaHtml, parseTunisiaChapterListing, parseTunisiaLinePage, TUNISIA_ACQUISITION_VERSION, TUNISIA_BASE_FROM, TUNISIA_BUNDLE_READER_VERSION, TUNISIA_EXPECTED_CHAPTERS, TUNISIA_PARSER_VERSION, TUNISIA_RIGHTS_ARTICLE, tunisiaPreferenceTableId, type TunisiaPreferenceEntry, type TunisiaTariffLine } from './tunisia-bundle';
import { TUNISIA_LAST_REVIEWED_2025_BULLETIN, TUNISIA_PINS, TUNISIA_REVIEWED_2026_BULLETINS, type TunisiaPin } from './tunisia-evidence';
import { TUNISIA_NEXT_NOTIFICATION_PROBES, TUNISIA_SAFEGUARD_NOTIFICATION_URL, TUNISIA_SSG_LATEST_URL, TUNISIA_TPR_URL, TUNISIA_TRADE_REMEDY_MANIFEST, TUNISIA_TRQ_ADMINISTRATION_URL, TUNISIA_TRQ_LATEST_FILL_URL } from './tunisia-remedies';

/** Tarifweb lines of the reviewed 2026 edition; a changed count means the tariff was reissued and must be reviewed. */
export const TUNISIA_EXPECTED_LINES = 17_541;
const DOUANE = 'https://www.douane.gov.tn';
const TARIFWEB = `${DOUANE}/tarifweb2026/`;
const LISTING = (chapter: string) => `${DOUANE}/tarifwebnew/getresultat.php?choix=1&chap=${chapter}`;
const LINE = (code: string) => `${DOUANE}/tarifwebnew/getresultat.php?choix=&chap=&sel=${code}`;
const TARIFF_RULES = `${DOUANE}/tarif-douanier/`;
const BULLETIN_INDEX = `${DOUANE}/bulletin-officiel-des-douanes/`;
const FINANCE_LAW_2026 = `${DOUANE}/wp-content/uploads/2026/01/038_2025-2.pdf`;
const FINANCE_LAW_2026_APPLICATION = `${DOUANE}/wp-content/uploads/2025/12/2025_039.pdf`;
const WIPO_LAW_PAGE = 'https://www.wipo.int/wipolex/fr/legislation/details/21148';
const ALLOWED_HOSTS = new Set(['www.douane.gov.tn', 'www.wto.org', 'docs.wto.org', 'www.wipo.int', 'wipolex-res.wipo.int']);
/** Every component code Tarifweb printed in the reviewed edition. A new one (a supplementary, safeguard or other duty) must be reviewed before it is carried. */
export const TUNISIA_REVIEWED_COMPONENTS: ReadonlySet<string> = new Set([
  'AIR/IMPOR', 'D.S.V.', 'DC/ALC', 'DC/AP', 'DC/APP', 'DC/ESS', 'DC/GPL', 'DC/MTK', 'DC/RNTA', 'DC/VOIT', 'DCS/ALC', 'DCVBBA', 'DD', 'DD/AUT.CA', 'DD/FUEL', 'DD/MAZOUT', 'DD/MTK', 'DD/PET.BR', 'DD/RNTA', 'DD/VEH.AU',
  'DROIT ENCO CREATION LIT ET ART', 'DROIT LAMPES ET TUBES', 'DROIT SUR EXPORT HUILE USAGEE', 'DRT INSP RAYON/UNITE CHARGE', 'FDCSA/V', 'P/BEUR/FR', 'P/FRUITS', 'P/H.ACIDE', 'P/L0%', 'P/L26%', 'P/VIANDE', 'RPD/IMPOR',
  'T/MOTEURS ET P.RECHANGE USAGES', 'TAXE DERIVEES DU LAIT', 'TAXE SUR LE SUCRE', 'TAXE SUR PRODUITS DE FRIPERIE', 'TAXE SUR PRODUITS DE PECHE', 'TAXE/APP CONDITMNT AIR', 'TCA', 'TLF', 'TM/ABATT', 'TMTS', 'TPE',
  'TVA/ IMPORTATION DU PAPIER', 'TVA/AP', 'TVA/AUTO', 'TVA/MTK', 'TVA/PP', 'TVA/RNTA',
]);

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const squash = (value: string) => value.replace(/\s+/g, '');
const pageText = (html: string) => decodeTunisiaHtml(html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' '));
export function tunisiaOfficialUrl(value: string) { const url = new URL(value); if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) throw new Error(`Tunisia authority acquisition rejects ${url.hostname}.`); return url.toString(); }

/** Server-side failures the authority returns as an ordinary page. */
const ERROR_PAGE = /(Fatal error|Parse error|<b>Warning<\/b>:|<b>Notice<\/b>:|Service Unavailable|Request Rejected|Access Denied|Too Many Requests)/;
type Expect = 'html' | 'pdf' | 'unpublished';
async function request(url: string, options: { fetch_impl: typeof fetch; attempts: number; expect: Expect; referer?: string; max_bytes?: number }) {
  let last: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      const headers: Record<string, string> = { accept: options.expect === 'pdf' ? 'application/pdf,*/*' : 'text/html,*/*', 'accept-language': 'fr-FR,fr;q=0.9', 'user-agent': 'Mozilla/5.0 ClearTrade-Customs-Atlas/1.0' };
      if (options.referer) headers.referer = options.referer;
      // TLS is always verified. www.douane.gov.tn omits its intermediate; see the operational note (NODE_EXTRA_CA_CERTS), never rejectUnauthorized.
      const response = await options.fetch_impl(tunisiaOfficialUrl(url), { headers, signal: AbortSignal.timeout(120_000) });
      if (response.url) tunisiaOfficialUrl(response.url);
      if (!response.ok) { if (response.status !== 429 && response.status < 500) throw new Error(`non-retryable HTTP ${response.status}`); throw new Error(`retryable HTTP ${response.status}`); }
      const type = response.headers.get('content-type') ?? '';
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw new Error('empty response');
      if (bytes.length > (options.max_bytes ?? 16 * 1024 * 1024)) throw new Error('response exceeded bounded size');
      const head = bytes.subarray(0, 8192).toString('latin1');
      if (options.expect === 'unpublished') {
        if (bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('non-retryable a notification the reviewed enumeration treats as unpublished is now published');
        if (!/^The file is not published/.test(head)) throw new Error(`non-retryable unexpected WTO response (${type})`);
        return { bytes, text: '' };
      }
      if (ERROR_PAGE.test(head)) throw new Error('retryable the authority returned an error page');
      if (options.expect === 'pdf' && (!/pdf|octet-stream/i.test(type) || !bytes.subarray(0, 5).equals(Buffer.from('%PDF-')))) throw new Error(`non-retryable response is not a PDF (${type})`);
      if (options.expect === 'html' && !/text\/html/i.test(type)) throw new Error(`non-retryable unexpected content type ${type}`);
      return { bytes, text: options.expect === 'html' ? (/iso-8859-1/i.test(type) ? bytes.toString('latin1') : bytes.toString('utf8')) : '' };
    } catch (error) {
      last = error;
      const cause = error instanceof Error && error.cause instanceof Error ? ` (${(error.cause as Error & { code?: string }).code ?? error.cause.message})` : '';
      if (attempt === options.attempts || /non-retryable|exceeded/.test(String(error))) throw new Error(`Tunisia authority acquisition failed for ${url} after ${attempt} attempt(s): ${error instanceof Error ? error.message : String(error)}${cause}`, { cause: error });
      // Exponential backoff capped at a minute, so a brief authority outage (observed mid-run) is ridden out within a bounded ~3 minutes.
      await new Promise(resolve => setTimeout(resolve, Math.min(60_000, 2000 * 2 ** (attempt - 1))));
    }
  }
  throw last;
}
async function pooled<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>) {
  const out: R[] = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { for (;;) { const index = next++; if (index >= items.length) return; out[index] = await run(items[index]!); } }));
  return out;
}
function pinned(label: string, bytes: Buffer, pin: TunisiaPin) {
  if (bytes.length !== pin.bytes || sha256(bytes) !== pin.sha256) throw new Error(`Tunisia artifact ${label} no longer matches its reviewed copy (the authority reissued it).`);
}
function requireMarkers(label: string, text: string, markers: readonly string[]) {
  const haystack = squash(text), missing = markers.filter(marker => !haystack.includes(squash(marker)));
  if (missing.length) throw new Error(`${label} no longer supports the reviewed determination (missing: ${missing.join(' | ')}).`);
}
async function pdfText(bytes: Buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0, useSystemFonts: true }).promise;
  let out = '';
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) out += ` ${(await (await document.getPage(pageNumber)).getTextContent()).items.map(item => ('str' in item ? item.str : '')).join(' ')}`;
  return out.normalize('NFC');
}
/** Bulletin labels on the index ("019_2026"), by year. */
export function tunisiaBulletinLabels(html: string) {
  const out = new Map<number, number[]>();
  for (const match of html.matchAll(/<td class="column-1">\s*(\d{3})[_-](20\d{2})\s*<\/td>/g)) { const year = Number(match[2]); out.set(year, [...(out.get(year) ?? []), Number(match[1])]); }
  return out;
}
/**
 * The reviewed determinations the pack depends on. Each must still hold on the live tariff, or the edition has
 * changed underneath the review: Finance Law 2026 art. 72 (frames 10%), art. 47 §3 (plug-in hybrids 0%), art. 31
 * (no fruit-and-vegetable levy on potatoes) and art. 60 (TPE on polyolefin fabrics) are applied; art. 47 §4 (EV
 * chargers) is not, which is why it is an overlay; and the rate profile still matches the 2025 WTO review.
 */
export function tunisiaCurrentnessCanaries(lines: ReadonlyMap<string, Omit<TunisiaTariffLine, 'preference_table_id'>>) {
  const duty = (code: string) => { const line = lines.get(code); return line?.customs_duty.length === 1 ? `${line.customs_duty[0]!.code} ${line.customs_duty[0]!.value}` : null; };
  const has = (code: string, component: string) => !!lines.get(code)?.other_components.some(entry => entry.code === component);
  const failures: string[] = [];
  if (duty('90031100003') !== 'DD 10 %') failures.push('90031100003 frames are no longer 10% (Finance Law 2026 art. 72)');
  if (duty('87022010117') !== 'DD/VEH.AU 0 %' || duty('87022010913') !== 'DD/VEH.AU 43 %') failures.push('8702 plug-in hybrids are no longer 0% beside 43% non-plug-in (art. 47 §3)');
  if (duty('85044055003') !== 'DD 43 %') failures.push('85044055003 chargers no longer print the general 43% (art. 47 §4 overlay premise)');
  if (!lines.has('07011000007') || has('07011000007', 'TLF')) failures.push('07011000007 potatoes carry the fruit-and-vegetable levy again (art. 31)');
  if (!has('54072011005', 'TPE')) failures.push('54072011005 polyolefin fabric lost its TPE (art. 60)');
  const rates = [...lines.values()].filter(line => line.customs_duty.length === 1).map(line => Number(/^(\d+(?:\.\d+)?) %$/.exec(line.customs_duty[0]!.value)?.[1] ?? NaN));
  const average = rates.reduce((sum, rate) => sum + rate, 0) / rates.length, zero = rates.filter(rate => rate === 0).length / rates.length * 100;
  if (!(average >= 23 && average <= 24.5)) failures.push(`the simple average customs duty ${average.toFixed(2)}% left the 23.0–24.5% band around the WTO review's 23.8%`);
  if (!(zero >= 26.5 && zero <= 28.5)) failures.push(`the zero-rated share ${zero.toFixed(1)}% left the 26.5–28.5% band around the WTO review's 27.4%`);
  return { failures, average_customs_duty_percent: Number(average.toFixed(2)), zero_rated_share_percent: Number(zero.toFixed(1)) };
}

export async function acquireTunisiaAuthorityBundle(args: { release_identifier: string; fetch_impl?: typeof fetch; attempts?: number; line_concurrency?: number; on_progress?: (done: number, total: number) => void }) {
  const fetch_impl = args.fetch_impl ?? fetch, attempts = args.attempts ?? 8, release_identifier = args.release_identifier.trim();

  // Currentness: the Tarifweb 2026 entry page and the tariff's own rules on duty columns and the legal minimum.
  const landing = await request(TARIFWEB, { fetch_impl, attempts, expect: 'html' });
  requireMarkers('Tarifweb 2026', pageText(landing.text), ['Dernière mise à jour : 17 juin 2025', 'sixième version tunisienne de la nomenclature douanière']);
  const rules = await request(TARIFF_RULES, { fetch_impl, attempts, expect: 'html' });
  requireMarkers('Tarif douanier rules', pageText(rules.text), ['« droits en tarif autonome » et « droits en tarif conventionnel »', 'Lorsqu’ils sont inférieurs aux droits en tarif conventionnel', 'le minimum légal de perception des droits de douane en tarif autonome « ad-valorem » à l’importation est fixé à 15%']);

  // Base: every chapter listing, then every line page (bounded concurrency).
  const chapters = Array.from({ length: TUNISIA_EXPECTED_CHAPTERS }, (_, index) => String(index + 1).padStart(2, '0'));
  const listings = await pooled(chapters, 2, async chapter => ({ chapter, ...(await request(LISTING(chapter), { fetch_impl, attempts, expect: 'html', referer: TARIFWEB })) }));
  const codes: string[] = [];
  for (const listing of listings) {
    const listed = parseTunisiaChapterListing(listing.text);
    if (listing.chapter === '77' ? listed.length : !listed.length) throw new Error(`Tarifweb chapter ${listing.chapter} lists ${listed.length} lines, contrary to the reviewed edition.`);
    if (listed.some(code => code.slice(0, 2) !== listing.chapter)) throw new Error(`Tarifweb chapter ${listing.chapter} lists a line of another chapter.`);
    codes.push(...listed);
  }
  if (codes.length !== TUNISIA_EXPECTED_LINES || new Set(codes).size !== codes.length) throw new Error(`Tarifweb lists ${codes.length} lines instead of the reviewed ${TUNISIA_EXPECTED_LINES}; the tariff must be reviewed again.`);
  let done = 0;
  const pages = await pooled([...codes].sort(), args.line_concurrency ?? 3, async code => {
    const page = await request(LINE(code), { fetch_impl, attempts, expect: 'html', referer: TARIFWEB });
    const parsed = parseTunisiaLinePage(page.text, code);
    args.on_progress?.(++done, codes.length);
    return { code, size: page.bytes.length, sha256: sha256(page.bytes), ...parsed };
  });
  const unreviewed = [...new Set(pages.flatMap(page => [...page.line.customs_duty, ...page.line.other_components].map(component => component.code)))].filter(code => !TUNISIA_REVIEWED_COMPONENTS.has(code));
  if (unreviewed.length) throw new Error(`Tarifweb prints components not in the reviewed set (${unreviewed.join(', ')}); a new duty must be reviewed before it is carried.`);
  const canaries = tunisiaCurrentnessCanaries(new Map(pages.map(page => [page.code, page.line])));
  if (canaries.failures.length) throw new Error(`Tunisia currentness canaries failed: ${canaries.failures.join('; ')}.`);

  // Currentness: the bulletin index must list exactly the reviewed bulletins; the Finance Law 2026 and its application note are pinned.
  const index = await request(BULLETIN_INDEX, { fetch_impl, attempts, expect: 'html', max_bytes: 8 * 1024 * 1024 });
  const labels = tunisiaBulletinLabels(index.text), in2026 = [...new Set(labels.get(2026) ?? [])].sort((a, b) => a - b), in2025 = labels.get(2025) ?? [];
  if (in2026.length !== TUNISIA_REVIEWED_2026_BULLETINS || in2026.some((number, position) => number !== position + 1)) throw new Error(`The customs bulletin index lists 2026 bulletins ${in2026.join(', ')} instead of the reviewed 001–${String(TUNISIA_REVIEWED_2026_BULLETINS).padStart(3, '0')}.`);
  if (Math.max(...in2025) !== TUNISIA_LAST_REVIEWED_2025_BULLETIN) throw new Error('The customs bulletin index lists a 2025 bulletin after the reviewed 039/2025.');
  const financeLaw = (await request(FINANCE_LAW_2026, { fetch_impl, attempts, expect: 'pdf' })).bytes; pinned('Finance Law 2026 bulletin 038/2025', financeLaw, TUNISIA_PINS.finance_law_2026);
  const application = (await request(FINANCE_LAW_2026_APPLICATION, { fetch_impl, attempts, expect: 'pdf' })).bytes; pinned('Finance Law 2026 application note 039/2025', application, TUNISIA_PINS.finance_law_2026_application);

  // Remedies and quotas: the WTO record, and the next symbol of every series must still be unpublished.
  const wto = async (label: string, url: string, pin: TunisiaPin) => { const bytes = (await request(url, { fetch_impl, attempts, expect: 'pdf' })).bytes; pinned(label, bytes, pin); return bytes; };
  const tpr = await wto('WT/TPR/S/479/Rev.1', TUNISIA_TPR_URL, TUNISIA_PINS.tpr_2025);
  const safeguard = await wto('G/SG/N/8/TUN/1', TUNISIA_SAFEGUARD_NOTIFICATION_URL, TUNISIA_PINS.safeguard_notification);
  const trqAdministration = await wto('G/AG/N/TUN/4', TUNISIA_TRQ_ADMINISTRATION_URL, TUNISIA_PINS.trq_administration);
  const trqFill = await wto('G/AG/N/TUN/79', TUNISIA_TRQ_LATEST_FILL_URL, TUNISIA_PINS.trq_fill_2024);
  const ssg = await wto('G/AG/N/TUN/74', TUNISIA_SSG_LATEST_URL, TUNISIA_PINS.ssg_2024);
  for (const probe of TUNISIA_NEXT_NOTIFICATION_PROBES) await request(probe.url, { fetch_impl, attempts, expect: 'unpublished' });

  // Rights: Law 94-36 Article premier, from WIPO Lex's French text (a fresh signed link each run).
  const wipoPage = (await request(WIPO_LAW_PAGE, { fetch_impl, attempts, expect: 'html', max_bytes: 4 * 1024 * 1024 })).text;
  const lawUrl = /https:\/\/wipolex-res\.wipo\.int\/edocs\/lexdocs\/laws\/fr\/tn\/tn085fr_1\.pdf\?[^'"\s]+/.exec(wipoPage)?.[0];
  if (!lawUrl) throw new Error('WIPO Lex no longer links the French text of Law 94-36.');
  const law = (await request(decodeTunisiaHtml(lawUrl), { fetch_impl, attempts, expect: 'pdf' })).bytes;
  pinned('Law 94-36 (WIPO Lex)', law, TUNISIA_PINS.law_94_36);
  requireMarkers('Law 94-36', await pdfText(law), ['Article premier', 'textes officiels', 'administratif ou judiciaire']);

  const preference_tables: Record<string, TunisiaPreferenceEntry[]> = {};
  const schedule_lines: TunisiaTariffLine[] = pages.map(page => { const id = tunisiaPreferenceTableId(page.preferences); preference_tables[id] = page.preferences; return { ...page.line, preference_table_id: id }; });
  const sortedTables = Object.fromEntries(Object.entries(preference_tables).sort(([a], [b]) => a.localeCompare(b)));
  const normalizedBytes = Buffer.from(JSON.stringify({ schedule_lines, preference_tables: sortedTables, remedies: TUNISIA_TRADE_REMEDY_MANIFEST }), 'utf8');
  const evidence = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2), 'utf8');
  const retained = [
    ...listings.map(item => ({ name: `tarifweb/chapter-${item.chapter}.html`, role: 'official_tarifweb_chapter_listing', url: LISTING(item.chapter), bytes: item.bytes })),
    { name: 'tarifweb/landing.html', role: 'official_tarifweb_currentness', url: TARIFWEB, bytes: landing.bytes },
    { name: 'currentness/finance-law-2026-bod-038-2025.pdf', role: 'official_finance_law_2026', url: FINANCE_LAW_2026, bytes: financeLaw },
    { name: 'currentness/finance-law-2026-application-bod-039-2025.pdf', role: 'official_finance_law_2026_application', url: FINANCE_LAW_2026_APPLICATION, bytes: application },
    { name: 'remedies/wt-tpr-s-479-rev1-fr.pdf', role: 'wto_trade_policy_review', url: TUNISIA_TPR_URL, bytes: tpr },
    { name: 'remedies/g-sg-n-8-tun-1.pdf', role: 'wto_safeguard_notification', url: TUNISIA_SAFEGUARD_NOTIFICATION_URL, bytes: safeguard },
    { name: 'quotas/g-ag-n-tun-4.pdf', role: 'wto_trq_administration', url: TUNISIA_TRQ_ADMINISTRATION_URL, bytes: trqAdministration },
    { name: 'quotas/g-ag-n-tun-79.pdf', role: 'wto_trq_fill', url: TUNISIA_TRQ_LATEST_FILL_URL, bytes: trqFill },
    { name: 'quotas/g-ag-n-tun-74.pdf', role: 'wto_special_safeguard', url: TUNISIA_SSG_LATEST_URL, bytes: ssg },
    { name: 'rights/law-94-36-wipolex-fr.pdf', role: 'official_tunisia_copyright_law', url: WIPO_LAW_PAGE, bytes: law },
    { name: 'currentness/bulletin-labels.json', role: 'official_bulletin_enumeration', url: BULLETIN_INDEX, bytes: evidence({ bulletins_2026: in2026, last_bulletin_2025: Math.max(...in2025) }) },
    { name: 'normalized.json', role: 'deterministic_normalized_tariff_bundle', url: TARIFWEB, bytes: normalizedBytes },
  ];
  const artifacts = retained.map(item => ({ name: item.name, role: item.role, url: item.url, size_bytes: item.bytes.length, sha256: sha256(item.bytes) }));
  const manifest = {
    acquisition_version: TUNISIA_ACQUISITION_VERSION, release_identifier, effective_base: TUNISIA_BASE_FROM, acquired_as_current_on: release_identifier, reader_version: TUNISIA_BUNDLE_READER_VERSION, parser_version: TUNISIA_PARSER_VERSION, artifacts,
    // Line pages are the live tariff: each is identified by byte length and SHA-256 here, and its content is carried in normalized.json.
    line_pages: pages.map(page => [page.code, page.size, page.sha256]),
    base_evidence: { chapters: TUNISIA_EXPECTED_CHAPTERS, reserved_chapters: ['77'], tarifweb_lines: schedule_lines.length, preference_tables: Object.keys(sortedTables).length, authorisation_required_lines: schedule_lines.filter(line => line.import_status === 'authorisation_required').length, instrument: 'Tarifweb 2026 (sixth Tunisian nomenclature), labelled "Dernière mise à jour : 17 juin 2025", with Finance Law 2026 applied' },
    currentness_evidence: { canaries, bulletins_2026_reviewed: in2026.length, last_2025_bulletin: Math.max(...in2025), overlays: TUNISIA_TRADE_REMEDY_MANIFEST.conditional_reliefs.map(relief => relief.id) },
    rights_evidence: { law_article: TUNISIA_RIGHTS_ARTICLE, source: 'WIPO Lex French text (Law 94-36 as amended by Law 2009-33)', rule: 'Copyright protection does not cover official texts of a legislative, administrative or judicial nature, nor their official translations.' },
    india_preference_evidence: { status: 'unknown', basis: 'No India entry in any Tarifweb preference table; Tunisia and India are GSTP and PTN participants and no concession schedule is published by Tunisian Customs.' },
    trade_remedy_evidence: { register_enumeration_complete: true, anti_dumping: 0, countervailing: 0, safeguards: TUNISIA_TRADE_REMEDY_MANIFEST.safeguards.map(measure => measure.id), probes_unpublished: TUNISIA_NEXT_NOTIFICATION_PROBES.map(probe => probe.symbol), tariff_quotas: TUNISIA_TRADE_REMEDY_MANIFEST.tariff_quotas.length },
    scope: { in_quota_rates_published: false, regulatory_coverage_complete: false, omitted_regulatory_layer: 'VAT, consumption duties, the customs services fee and other components are carried separately and not assessed; privileged regimes and technical controls are outside this tariff pack.' },
  };
  const zip = new JSZip();
  for (const item of retained) zip.file(item.name, item.bytes);
  zip.file('acquisition.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 }, platform: 'UNIX', streamFiles: true }));
}

export const __test__ = { request, pinned, requireMarkers, ERROR_PAGE };
