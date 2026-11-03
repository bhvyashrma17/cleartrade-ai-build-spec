import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import type { ParsedDuty } from '@/lib/market-access/tariff-semantics';
import { validateTunisiaRemedyManifest, type TunisiaTradeRemedyManifest } from './tunisia-remedies';

export const TUNISIA_BUNDLE_READER_VERSION = 'tn-douane-bundle-reader-v1' as const;
export const TUNISIA_PARSER_VERSION = 'tn-tarifweb-2026-lf2026-remedies-v1' as const;
/** Tarifweb lists 97 chapters of the sixth Tunisian nomenclature (HS 2022); Chapter 77 is reserved and lists no line. */
export const TUNISIA_EXPECTED_CHAPTERS = 97;
export const TUNISIA_BASE_FROM = '2026-01-01' as const;
export const TUNISIA_ACQUISITION_VERSION = 'tn-douane-public-acquisition-v1' as const;
export const TUNISIA_RIGHTS_ARTICLE = 'Tunisia Law No. 94-36 on Literary and Artistic Property, as amended by Law No. 2009-33, Article premier' as const;

export class TunisiaBundleError extends Error { constructor(readonly code: string, message: string) { super(message); this.name = 'TunisiaBundleError'; } }

/** One row of a line's "Droits et taxes à l'importation" table: component code, its label, the printed value and its assessment basis (assiette). */
export interface TunisiaComponent { code: string; label: string; value: string; basis: string }
export interface TunisiaPreferenceEntry { origin_code: string; origin_label: string; value: string }
export interface TunisiaTariffLine {
  code: string; chapter: string; description: string;
  statistical_unit: string | null; usage_group: string | null; payment_mode: string | null;
  /** CCEC import status: "Libre" is the free-import regime; "Prohibé" is exclusion from it (prior import authorisation, a non-automatic licence). */
  import_status: 'free' | 'authorisation_required';
  /** The customs-duty rows (the DD family: DD, DD/VEH.AU, DD/MTK …), distinct. Normally exactly one; none or conflicting rows are never declared. */
  customs_duty: TunisiaComponent[];
  /** Every other import component (VAT, RPD, TPE, consumption duties, levies), sorted by code. Never folded into the customs duty. */
  other_components: TunisiaComponent[];
  preference_table_id: string;
  documents: { code: string; description: string }[];
  /** The page printed the same import table more than once; identical rows were merged. */
  duplicated_rows: boolean;
}
export interface TunisiaAuthorityBundle {
  checksum: string; size_bytes: number; release_identifier: string; source_url: string;
  files: readonly { name: string; role: string; size_bytes: number; sha256: string }[];
  schedule_lines: ReadonlyMap<string, TunisiaTariffLine>;
  preference_tables: ReadonlyMap<string, readonly TunisiaPreferenceEntry[]>;
  remedies: TunisiaTradeRemedyManifest;
  reader_version: typeof TUNISIA_BUNDLE_READER_VERSION; parser_version: typeof TUNISIA_PARSER_VERSION;
}

const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const NAMED: Readonly<Record<string, string>> = { amp: '&', quot: '"', apos: '\'', lt: '<', gt: '>', nbsp: ' ', eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', acirc: 'â', ccedil: 'ç', ocirc: 'ô', ucirc: 'û', icirc: 'î', iuml: 'ï', rsquo: '’', lsquo: '‘', laquo: '«', raquo: '»', deg: '°' };
export function decodeTunisiaHtml(value: string) {
  return value.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16))).replace(/&([a-z]+);/gi, (entity, name: string) => NAMED[name.toLowerCase()] ?? entity);
}
const text = (html: string) => decodeTunisiaHtml(html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const base = (expression: string, fields: Partial<ParsedDuty> = {}): ParsedDuty => ({ kind: 'unparsed', ad_valorem_rate_percent: null, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null, expression, note: null, ...fields });

/**
 * Tarifweb prints each component as "N %" (ad valorem on the stated basis) or "N dinars" (a specific amount per
 * the stated basis — kilogram, statistical or other unit). A specific amount is never converted into a
 * percentage, and anything else is kept verbatim. Blank is never zero.
 */
export function parseTunisiaValue(value: string, basis: string): ParsedDuty {
  const cleaned = value.replace(/\s+/g, ' ').trim();
  if (!cleaned) return base('', { kind: 'none', note: 'Tarifweb printed no value; blank is not zero.' });
  const percent = /^(\d+(?:\.\d+)?) %$/.exec(cleaned);
  if (percent) return base(cleaned, { kind: 'ad_valorem', ad_valorem_rate_percent: Number(percent[1]), note: basis ? `Assessed on: ${basis}.` : null });
  const dinars = /^(\d+(?:\.\d+)?) dinars$/.exec(cleaned);
  if (dinars) return base(cleaned, { kind: 'specific', specific_amount: Number(dinars[1]), specific_currency: 'TND', specific_unit: basis || null, specific_unit_quantity: 1, note: `Specific amount per assessment basis "${basis}"; it has no ad-valorem equivalent without the goods' quantity and value.` });
  return base(cleaned, { note: 'The printed value did not match a recognised Tarifweb form; it is retained verbatim rather than guessed.' });
}

/** The customs duty of a line: exactly one DD-family row. None published is unavailable (not zero); rows that disagree are an authority conflict. */
export function tunisiaCustomsDuty(line: Pick<TunisiaTariffLine, 'customs_duty'>): ParsedDuty {
  if (!line.customs_duty.length) return base('', { kind: 'none', note: 'Tarifweb publishes no customs-duty row for this line; blank is not zero.' });
  if (line.customs_duty.length > 1) return base(line.customs_duty.map(row => `${row.code} ${row.value}`).join(' / '), { note: 'Tarifweb prints conflicting customs-duty rows for this line; the authority conflict makes it non-declarable.' });
  const row = line.customs_duty[0]!;
  return parseTunisiaValue(row.value, row.basis);
}

function section(html: string, title: string) {
  const start = html.indexOf(`<div class="section-title">${title}</div>`);
  if (start < 0) return null;
  const end = html.indexOf('</table>', start);
  if (end < 0) throw new TunisiaBundleError('layout_changed', `Tarifweb section "${title}" is not closed.`);
  return html.slice(start, end);
}
const cells = (row: string) => [...row.matchAll(/<t([dh])[^>]*>([\s\S]*?)<\/t\1>/g)].map(match => ({ header: match[1] === 'h', html: match[2]! }));
const rows = (html: string) => [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(match => cells(match[1]!));

/** A chapter listing names each line through submit_frm_resultat('', '', '<11-digit code>'). */
export function parseTunisiaChapterListing(html: string) {
  return [...new Set([...html.matchAll(/submit_frm_resultat\('[^']*','[^']*','(\d{11})'\)/g)].map(match => match[1]!))];
}

const IMPORT_TITLE = 'DROITS ET TAXES À L\'IMPORTATION';
/**
 * Reads one Tarifweb line page structurally. The page must name the requested nomenclature code and carry its
 * general, CCEC, import and preference sections; each import row has exactly a component, a value and a basis.
 */
export function parseTunisiaLinePage(html: string, code: string): { line: Omit<TunisiaTariffLine, 'preference_table_id'>; preferences: TunisiaPreferenceEntry[] } {
  const named = /N° de la nomenclature:\s*(\d{11})/.exec(html)?.[1];
  if (named !== code) throw new TunisiaBundleError('code_mismatch', `Tarifweb page for ${code} names ${named ?? 'no code'}.`);
  const description = text(/class="product-description">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '');
  if (!description) throw new TunisiaBundleError('layout_changed', `Tarifweb page for ${code} has no product description.`);

  const general = section(html, 'INFORMATIONS GÉNÉRALES');
  const ccec = section(html, 'CCEC - COMMERCE EXTÉRIEUR');
  const imports = section(html, IMPORT_TITLE);
  const preferences = section(html, 'DROITS PRÉFÉRENTIELS PAR PAYS');
  if (!general || !ccec || !imports || !preferences) throw new TunisiaBundleError('layout_changed', `Tarifweb page for ${code} lacks a required section.`);

  const generalRows = rows(general), headers = generalRows.find(row => row.every(cell => cell.header))?.map(cell => text(cell.html.split(/<br\s*\/?>/i)[0]!)) ?? [];
  const values = generalRows.find(row => row.length && row.every(cell => !cell.header))?.map(cell => text(cell.html)) ?? [];
  const field = (name: string) => { const index = headers.indexOf(name); return index >= 0 ? values[index] || null : null; };

  const status = rows(ccec).find(row => row.length === 2 && row.every(cell => !cell.header));
  const importText = status ? text(status[0]!.html) : '';
  const import_status = /^Libre\b/.test(importText) ? 'free' as const : /^Prohib/.test(importText) ? 'authorisation_required' as const : null;
  if (!import_status) throw new TunisiaBundleError('layout_changed', `Tarifweb page for ${code} prints an unrecognised CCEC import status "${importText}".`);

  const components = new Map<string, TunisiaComponent>(); let printed = 0;
  for (const row of rows(imports)) {
    if (!row.length || row.every(cell => cell.header)) continue;
    if (row.length !== 3) throw new TunisiaBundleError('layout_changed', `Tarifweb page for ${code} prints an import row with ${row.length} cells.`);
    const [name, labelHtml] = row[0]!.html.split(/<br\s*\/?>/i);
    const component = { code: text(name!), label: text(labelHtml ?? ''), value: text(row[1]!.html), basis: text(row[2]!.html) };
    if (!component.code) throw new TunisiaBundleError('layout_changed', `Tarifweb page for ${code} prints an import row without a component code.`);
    printed += 1;
    components.set(JSON.stringify(component), component);
  }
  const all = [...components.values()].sort((a, b) => a.code.localeCompare(b.code) || a.value.localeCompare(b.value));
  const customs_duty = all.filter(component => /^DD(\/|$)/.test(component.code));

  const preferenceRows: TunisiaPreferenceEntry[] = [];
  for (const row of rows(preferences)) {
    if (!row.length || row.every(cell => cell.header)) continue;
    if (row.length !== 3) throw new TunisiaBundleError('layout_changed', `Tarifweb page for ${code} prints a preference row with ${row.length} cells.`);
    preferenceRows.push({ origin_code: text(row[0]!.html), origin_label: text(row[1]!.html), value: text(row[2]!.html) });
  }
  preferenceRows.sort((a, b) => Number(a.origin_code) - Number(b.origin_code) || a.value.localeCompare(b.value));

  const documentsSection = section(html, 'DOCUMENTS REQUIS'), documents: { code: string; description: string }[] = [];
  if (documentsSection) {
    // Document rows are printed without <tr> wrappers, so the table body is read cell by cell.
    const body = documentsSection.slice(documentsSection.indexOf('<tbody'));
    for (const match of body.matchAll(/<td[^>]*>\s*(\d+)\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/g)) documents.push({ code: match[1]!, description: text(match[2]!) });
  }
  documents.sort((a, b) => a.code.localeCompare(b.code));

  return {
    line: {
      code, chapter: code.slice(0, 2), description, statistical_unit: field('QCS'), usage_group: field('GU'), payment_mode: field('Mode de Paiement'), import_status,
      customs_duty, other_components: all.filter(component => !customs_duty.includes(component)), documents, duplicated_rows: printed > components.size,
    },
    preferences: preferenceRows,
  };
}
export const tunisiaPreferenceTableId = (entries: readonly TunisiaPreferenceEntry[]) => hash(JSON.stringify(entries)).slice(0, 16);

interface Normalized { schedule_lines: TunisiaTariffLine[]; preference_tables: Record<string, TunisiaPreferenceEntry[]>; remedies: TunisiaTradeRemedyManifest }
export async function readTunisiaAuthorityBundle(args: { bytes: Buffer; release_identifier: string }): Promise<TunisiaAuthorityBundle> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(args.bytes); } catch { throw new TunisiaBundleError('corrupt_archive', 'Tunisia authority bundle is not a readable ZIP.'); }
  let manifest: { acquisition_version?: string; release_identifier?: string; artifacts?: Array<{ name: string; role: string; size_bytes: number; sha256: string }>; line_pages?: Array<[string, number, string]>; rights_evidence?: Record<string, unknown>; scope?: Record<string, unknown>; base_evidence?: Record<string, unknown> };
  try { manifest = JSON.parse(Buffer.from(await zip.file('acquisition.json')?.async('nodebuffer') ?? []).toString('utf8')); } catch { throw new TunisiaBundleError('invalid_manifest', 'Tunisia acquisition manifest is invalid JSON.'); }
  if (manifest.acquisition_version !== TUNISIA_ACQUISITION_VERSION || manifest.release_identifier !== args.release_identifier || manifest.rights_evidence?.law_article !== TUNISIA_RIGHTS_ARTICLE
    || manifest.scope?.in_quota_rates_published !== false || manifest.base_evidence?.chapters !== TUNISIA_EXPECTED_CHAPTERS) {
    throw new TunisiaBundleError('unexpected_acquisition', 'Tunisia manifest lacks the reviewed identity, rights or completeness controls.');
  }
  for (const entry of manifest.artifacts ?? []) {
    const bytes = Buffer.from(await zip.file(entry.name)?.async('nodebuffer') ?? []);
    if (bytes.length !== entry.size_bytes || hash(bytes) !== entry.sha256) throw new TunisiaBundleError('artifact_hash_mismatch', `Tunisia artifact ${entry.name} failed its manifest hash.`);
  }
  let normalized: Normalized;
  try { normalized = JSON.parse(Buffer.from(await zip.file('normalized.json')?.async('nodebuffer') ?? []).toString('utf8')); } catch { throw new TunisiaBundleError('invalid_normalized', 'Tunisia normalized artifact is invalid JSON.'); }
  const schedule = new Map(normalized.schedule_lines.map(line => [line.code, line]));
  if (!schedule.size || schedule.size !== normalized.schedule_lines.length) throw new TunisiaBundleError('invalid_schedule', 'Tunisia normalized schedule is empty or has duplicate codes.');
  // Every line's page was fetched and hashed, and every line points at a preference table the bundle carries.
  const pages = new Set((manifest.line_pages ?? []).map(entry => entry[0]));
  if (pages.size !== schedule.size || [...schedule.keys()].some(code => !pages.has(code))) throw new TunisiaBundleError('incomplete_schedule', 'Tunisia normalized schedule does not match the fetched line pages.');
  if (new Set(normalized.schedule_lines.map(line => line.chapter)).size !== TUNISIA_EXPECTED_CHAPTERS - 1) throw new TunisiaBundleError('incomplete_schedule', 'Tunisia normalized schedule does not cover every Tarifweb chapter.');
  if (normalized.schedule_lines.some(line => !normalized.preference_tables[line.preference_table_id])) throw new TunisiaBundleError('invalid_schedule', 'A Tunisia line references a missing preference table.');
  validateTunisiaRemedyManifest(normalized.remedies);
  return {
    checksum: hash(args.bytes), size_bytes: args.bytes.length, release_identifier: args.release_identifier, source_url: 'https://www.douane.gov.tn/tarifweb2026/',
    files: (manifest.artifacts ?? []).map(x => ({ name: x.name, role: x.role, size_bytes: x.size_bytes, sha256: x.sha256 })),
    schedule_lines: schedule, preference_tables: new Map(Object.entries(normalized.preference_tables)), remedies: normalized.remedies,
    reader_version: TUNISIA_BUNDLE_READER_VERSION, parser_version: TUNISIA_PARSER_VERSION,
  };
}
