import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { describe, expect, test } from 'vitest';
import { DESTINATION_ADAPTERS } from '../src/lib/job-handlers/market-access';
import { unconfiguredSourceForCountry } from '../src/lib/market-access/unconfigured-sources';
import { __test__ as acquisition, moroccoOfficialUrl } from '../src/lib/market-access/providers/morocco-acquisition';
import { MOROCCO_BUNDLE_READER_VERSION, MOROCCO_PARSER_VERSION, moroccoSeason, parseMoroccoChapter, parseMoroccoDuty, readMoroccoAuthorityBundle, type MoroccoAuthorityBundle, type MoroccoPage, type MoroccoTariffLine } from '../src/lib/market-access/providers/morocco-bundle';
import { MOROCCO_REVIEWED_REMEDY_NOTICES } from '../src/lib/market-access/providers/morocco-evidence';
import { buildMoroccoMarketAccess, replayMoroccoTariff } from '../src/lib/market-access/providers/morocco-parser';
import { MOROCCO_TRADE_REMEDY_MANIFEST, moroccoRemedyDuty, selectMoroccoTradeRemedies, validateMoroccoRemedyManifest, type MoroccoTradeRemedyManifest } from '../src/lib/market-access/providers/morocco-remedies';

const line = (code: string, expression: string, extra: Partial<MoroccoTariffLine> = {}): MoroccoTariffLine => ({ code, chapter: code.slice(0, 2), description: `line ${code}`, expression, footnote: null, footnote_text: null, unit: 'kg', season: null, versions: [], quota_suspensions: [], partial_versions: [], pairing: 'same_row', inferred_segment: false, conflicting_expressions: null, ...extra });
function fixture(): MoroccoAuthorityBundle {
  const lines = [
    line('0910200010', '60'), line('1001990011', '2,5'),
    line('1001990019', '135 (f)', { footnote: 'f', footnote_text: 'Ce taux est appliqué à la tranche de la valeur inférieure ou égale à 1000 DH/tonne', versions: [{ from: '2026-01-01', until: '2026-05-31', expression: '0', instrument: '6241/211', kind: 'suspension' }, { from: '2026-06-01', until: '2026-08-31', expression: '135 (f)', instrument: '6761/211', kind: 'restoration' }, { from: '2026-09-01', until: null, expression: '0', instrument: '6761/211', kind: 'suspension' }] }),
    line('1001190010', '170 (b)', { footnote: 'b', season: { from_month_day: '06-01', until_month_day: '07-31' } }), line('1001190090', '2,5', { season: { from_month_day: '08-01', until_month_day: '05-31' } }),
    line('0102291000', '200', { quota_suspensions: [{ from: '2026-01-01', until: '2026-12-31', quota: '300,000 head', instrument: 'Finance Law 2026 art. 5 bis', condition: 'Domestic bovine animals only.' }] }),
    line('0204420010', '200', { versions: [{ from: '2026-07-27', until: '2026-12-31', expression: '0', instrument: '6762/211', kind: 'suspension' }] }),
    line('0206210000', '200', { partial_versions: [{ from: '2026-07-27', until: '2026-12-31', expression: '30', instrument: '6762/211', kind: 'rate_change', scope: 'offal of domestic bovine animals only' }] }),
    line('7208510000', '2,5'), line('7306619000', '30'), line('3904109000', '10'), line('6907210010', '40'), line('5703210010', '40'), line('8516600011', '40', { inferred_segment: true }),
    line('4412519921', '17,5', { pairing: 'uncertain' }), line('2305000000', '', { pairing: 'none' }), line('8544202100', '30', { conflicting_expressions: ['30', '10'] }),
  ];
  return { checksum: 'fixture', size_bytes: 1, release_identifier: '2026-09-23', source_url: 'https://www.douane.gov.ma/tarif/tarif/init.jsf', files: [], schedule_lines: new Map(lines.map(item => [item.code, item])), remedies: MOROCCO_TRADE_REMEDY_MANIFEST, reader_version: MOROCCO_BUNDLE_READER_VERSION, parser_version: MOROCCO_PARSER_VERSION };
}
const build = (hs6: string, at = '2026-09-23', origin = 'IN') => buildMoroccoMarketAccess({ bundle: fixture(), release_id: 'r1', release_reference_date: new Date('2026-09-23T00:00:00Z'), retrieved_at: new Date('2026-09-23T00:00:00Z'), hs6, at: new Date(`${at}T00:00:00Z`), origin_country: origin });
const third = (result: ReturnType<typeof build>) => result.lines.filter(entry => entry.measure_kind === 'third_country_duty').map(entry => [entry.national_tariff_code, entry.duty.expression, entry.declarable]);
const item = (str: string, x: number, y: number, w = str.length * 4.5) => ({ str, x, y, w });
const page = (items: ReturnType<typeof item>[], page_number = 1): MoroccoPage => ({ page_number, width: 595, height: 842, text: items.map(entry => entry.str).join(' '), items });
const header = [item('Codification', 55, 770), item('Désignation des Produits', 230, 770), item('Droit', 466, 766), item('Unité', 491, 766), item('d’Importation', 476, 756)];
const html = (body: string) => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });

describe('Morocco authority pack', () => {
  test('parses TDI rates; a footnoted rate is never a plain percentage and blank is never zero', () => {
    expect(parseMoroccoDuty('2,5')).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 2.5 });
    expect(parseMoroccoDuty('')).toMatchObject({ kind: 'none', ad_valorem_rate_percent: null });
    expect(parseMoroccoDuty('135 (f)', 'tranche ≤ 1000 DH/tonne')).toMatchObject({ kind: 'unparsed', ad_valorem_rate_percent: null, note: expect.stringMatching(/tranche/) });
    expect(moroccoSeason('– – – du 1er Juin au 31 Juillet')).toEqual({ from_month_day: '06-01', until_month_day: '07-31' });
  });

  test('assembles ten-digit codes from subheading, segment and suffix columns, pairs wrapped rates and records headings and blanks', () => {
    const rows = [
      item('08.01', 52, 734), item('Noix de coco', 166, 734),
      item('0801.11', 86, 710), item('00', 128, 710), item('– – Désséchées', 166, 710),
      item('1', 38, 690), item('10', 144, 690), item('– – – pulpe', 166, 690), item('10', 462, 690), item('kg', 491, 690),
      item('1', 38, 676), item('90', 144, 676), item('– – – autres', 166, 676), item('2,5', 462, 676), item('kg', 491, 676),
      item('1', 38, 650), item('0801.12', 86, 650), item('00', 128, 650), item('00', 144, 650), item('– – En coques internes', 166, 650),
      item('(endocarpe) sur deux lignes', 166, 638), item('10', 462, 638), item('kg', 491, 638),
      item('– – – rubrique répétant un taux', 166, 620), item('30', 462, 620), item('kg', 491, 620),
      item('0801.19', 86, 600), item('00', 128, 600), item('00', 144, 600), item('– – Autres (taux non imprimé)', 166, 600),
      item('0801.21', 86, 560), item('00', 128, 560), item('00', 144, 560), item('– – En coques', 166, 560), item('2,5', 462, 560), item('kg', 491, 560),
      item('0801.21', 86, 540), item('00', 128, 540), item('00', 144, 540), item('– – En coques', 166, 540), item('2,5', 462, 540), item('kg', 491, 540),
    ];
    const { rows: parsed, heading_rates, duplicates } = parseMoroccoChapter([page([...header, ...rows])], '08');
    expect(parsed.map(row => [row.code, row.expression, row.pairing])).toEqual([
      // The heading's neighbours are withheld: a heading that repeats a rate may equally be a displaced one.
      ['0801110010', '10', 'same_row'], ['0801110090', '2,5', 'same_row'], ['0801120000', '10', 'uncertain'], ['0801190000', '', 'uncertain'], ['0801210000', '2,5', 'same_row'],
    ]);
    expect(heading_rates).toEqual([expect.objectContaining({ rate: '30' })]);
    expect(duplicates).toEqual(['0801210000']);
    expect(() => parseMoroccoChapter([page(header)], '08')).toThrow(/no subheading column|yielded no lines/);
    expect(parseMoroccoChapter([page([item('Réservé pour une utilisation future éventuelle', 100, 700)])], '77')).toMatchObject({ rows: [], reserved: true });
  });

  test('replays 2026 decree overlays by date: suspensions, restorations, seasons, quotas and species-limited rates', () => {
    const at = (day: string) => replayMoroccoTariff(fixture(), new Date(`${day}T00:00:00Z`));
    expect(at('2025-12-31').size).toBe(0);
    expect(at('2026-09-23').get('1001990019')).toMatchObject({ declarable: true, duty: { kind: 'ad_valorem', ad_valorem_rate_percent: 0 } });
    expect(at('2026-07-15').get('1001990019')).toMatchObject({ declarable: false, duty: { kind: 'unparsed', ad_valorem_rate_percent: null } });
    expect(at('2026-07-15').get('1001190010')?.declarable).toBe(false);
    expect(at('2026-07-15').get('1001190090')).toMatchObject({ declarable: false, withheld: expect.stringMatching(/08-01 to 05-31/) });
    expect(at('2026-09-23').get('1001190090')?.declarable).toBe(true);
    expect(third(build('020442'))).toEqual([['0204420010', '0%', true]]);
    expect(third(build('020442', '2026-07-26'))).toEqual([['0204420010', '200%', true]]);
    const cattle = build('010229');
    expect(cattle.general_duty?.ad_valorem_rate_percent).toBe(200);
    expect(cattle.lines.find(entry => entry.measure_kind === 'tariff_quota')).toMatchObject({ declarable: false, duty: { ad_valorem_rate_percent: 0 }, conditions: { quota_availability_not_established: true } });
    expect(build('020621').lines.find(entry => entry.measure_kind === 'other')).toMatchObject({ declarable: false, duty: { ad_valorem_rate_percent: 30 } });
  });

  test('uncertain, blank, inferred and conflicting TDI lines are never declared', () => {
    const now = replayMoroccoTariff(fixture(), new Date('2026-09-23T00:00:00Z'));
    expect(now.get('4412519921')).toMatchObject({ declarable: false, withheld: expect.stringMatching(/cannot be established/) });
    expect(now.get('2305000000')).toMatchObject({ declarable: false, duty: { ad_valorem_rate_percent: null } });
    expect(now.get('8516600011')).toMatchObject({ declarable: false, withheld: expect.stringMatching(/omits part/) });
    expect(now.get('8544202100')).toMatchObject({ declarable: false, withheld: expect.stringMatching(/authority conflict/) });
  });

  test('India: MFN only; the hot-rolled safeguard applies and steps down, other safeguards exempt India, and the tiles investigation is not a duty', () => {
    const hotRolled = build('720851');
    expect(hotRolled.india_preference).toMatchObject({ applicability: 'not_applicable', duty: null });
    expect(hotRolled.lines.find(entry => entry.measure_kind === 'additional_duty')).toMatchObject({ applies_to_origin_country: 'IN', duty: { kind: 'ad_valorem', ad_valorem_rate_percent: 19 } });
    expect(build('720851', '2027-06-19').lines.find(entry => entry.measure_kind === 'additional_duty')?.duty.ad_valorem_rate_percent).toBe(18);
    expect(build('720851', '2029-06-19').lines.some(entry => entry.measure_kind === 'additional_duty')).toBe(false);
    expect(hotRolled.requirements.map(entry => entry.requirement_code)).toEqual(['MA_TRADE_REMEDY_EVIDENCE']);
    expect(hotRolled.raw_evidence).toMatchObject({ tariff_treatment_complete: false, remedy_status: 'additional_duty_applies' });
    expect(build('720851', '2026-09-23', 'TN').lines.some(entry => entry.measure_kind === 'additional_duty')).toBe(false);
    expect(build('730661').lines.some(entry => entry.measure_kind === 'additional_duty')).toBe(false);
    expect(build('730661', '2026-09-23', 'DE').lines.find(entry => entry.measure_kind === 'additional_duty')?.duty.ad_valorem_rate_percent).toBe(20);
    expect(build('730661', '2026-11-06', 'DE').lines.some(entry => entry.measure_kind === 'additional_duty')).toBe(false);
    expect(build('690721').lines.some(entry => entry.measure_kind === 'additional_duty')).toBe(false);
    expect(MOROCCO_TRADE_REMEDY_MANIFEST.pending.find(entry => entry.case === 'DDC/07/2026')).toMatchObject({ origin_countries: ['IN'], status: 'INVESTIGATION' });
    expect(build('091020').raw_evidence).toMatchObject({ tariff_treatment_complete: true });
    expect(build('091020').regulatory_coverage_complete).toBe(false);
  });

  test('anti-dumping duties are origin-wide only where the circular says so; producer or product identity otherwise', () => {
    expect(build('390410', '2026-09-23', 'US').lines.find(entry => entry.measure_kind === 'additional_duty')?.duty).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 24.88 });
    expect(build('390410', '2026-09-23', 'EG').lines.find(entry => entry.measure_kind === 'additional_duty')?.duty).toMatchObject({ kind: 'mixed', ad_valorem_rate_percent: null });
    expect(build('851660', '2026-09-23', 'TR').lines.find(entry => entry.measure_kind === 'additional_duty')?.duty).toMatchObject({ kind: 'mixed', expression: expect.stringMatching(/product scope/) });
    const carpets = MOROCCO_TRADE_REMEDY_MANIFEST.measures.find(measure => measure.id === 'MA-AD-CARPETS-CN-EG-JO')!;
    expect(moroccoRemedyDuty(carpets, 'CN', new Date('2026-09-23T00:00:00Z'))).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 144 });
    const panels = MOROCCO_TRADE_REMEDY_MANIFEST.measures.find(measure => measure.id === 'MA-SG-COATED-FIBREBOARD')!;
    expect(moroccoRemedyDuty(panels, 'CN', new Date('2026-09-23T00:00:00Z'))).toMatchObject({ kind: 'specific', specific_amount: 1, specific_currency: 'MAD', specific_unit: 'kg' });
    expect(selectMoroccoTradeRemedies({ manifest: MOROCCO_TRADE_REMEDY_MANIFEST, code: '4411120090', origin_country: 'IN', at: new Date('2026-09-23T00:00:00Z') })).toEqual([]);
  });

  test('the remedy manifest refuses incomplete enumeration, missing rates and investigations represented as duties', () => {
    expect(() => validateMoroccoRemedyManifest(MOROCCO_TRADE_REMEDY_MANIFEST)).not.toThrow();
    const pvc = MOROCCO_TRADE_REMEDY_MANIFEST.measures[1]!;
    expect(() => validateMoroccoRemedyManifest({ ...MOROCCO_TRADE_REMEDY_MANIFEST, register_enumeration_complete: false } as unknown as MoroccoTradeRemedyManifest)).toThrow(/complete enumeration/);
    expect(() => validateMoroccoRemedyManifest({ ...MOROCCO_TRADE_REMEDY_MANIFEST, measures: [{ ...pvc, origin_countries: ['US', 'CA'] }] })).toThrow(/every origin/);
    expect(() => validateMoroccoRemedyManifest({ ...MOROCCO_TRADE_REMEDY_MANIFEST, measures: [{ ...pvc, id: 'DDC/07/2026' }] })).toThrow(/pending/);
    expect(MOROCCO_TRADE_REMEDY_MANIFEST.historical.find(entry => entry.case === 'AD insulin')).toMatchObject({ status: 'SUSPENDED_UNDERTAKING' });
  });

  test('the bundle reader enforces identity, per-artifact hashes and chapter coverage', async () => {
    const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    const zipOf = async (manifest: Record<string, unknown>, normalized: Record<string, unknown>, tamper = false) => {
      const zip = new JSZip(), body = Buffer.from(JSON.stringify(normalized));
      zip.file('normalized.json', tamper ? Buffer.concat([body, Buffer.from(' ')]) : body);
      zip.file('acquisition.json', JSON.stringify({ ...manifest, artifacts: [{ name: 'normalized.json', role: 'normalized', size_bytes: body.length, sha256: sha(body) }] }));
      return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
    };
    const manifest = { acquisition_version: 'ma-adii-public-acquisition-v1', release_identifier: '2026-09-23', rights_evidence: { law_article: 'Morocco Law No. 2-00 on Copyright and Related Rights article 8' }, scope: { tariff_treatment_complete: true }, base_evidence: { chapters: 97 } };
    const chapters = Array.from({ length: 97 }, (_, index) => String(index + 1).padStart(2, '0')).filter(chapter => chapter !== '77');
    const normalized = { schedule_lines: chapters.map(chapter => line(`${chapter}01000000`, '10')), remedies: MOROCCO_TRADE_REMEDY_MANIFEST };
    expect((await readMoroccoAuthorityBundle({ bytes: await zipOf(manifest, normalized), release_identifier: '2026-09-23' })).schedule_lines.size).toBe(96);
    await expect(readMoroccoAuthorityBundle({ bytes: await zipOf(manifest, normalized, true), release_identifier: '2026-09-23' })).rejects.toMatchObject({ code: 'artifact_hash_mismatch' });
    await expect(readMoroccoAuthorityBundle({ bytes: await zipOf({ ...manifest, rights_evidence: {} }, normalized), release_identifier: '2026-09-23' })).rejects.toMatchObject({ code: 'unexpected_acquisition' });
    await expect(readMoroccoAuthorityBundle({ bytes: await zipOf(manifest, { ...normalized, schedule_lines: normalized.schedule_lines.slice(1) }), release_identifier: '2026-09-23' })).rejects.toMatchObject({ code: 'incomplete_schedule' });
  });

  test('allowlisted HTTPS only; delivery rewrites are reversed before pinning; markers are whitespace-insensitive', () => {
    expect(moroccoOfficialUrl('https://www.douane.gov.ma/tarif/tarif/init.jsf')).toMatch(/^https:/);
    expect(() => moroccoOfficialUrl('http://www.douane.gov.ma/')).toThrow(/rejects/);
    expect(() => moroccoOfficialUrl('https://www.douane.gov.ma.example.com/')).toThrow(/rejects/);
    const original = Buffer.from('%PDF-1.7 xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"'), rewritten = Buffer.from(original.toString('latin1').replace('http://', 'https://'), 'latin1');
    expect(acquisition.canonicalAdiiDocument(rewritten).equals(original)).toBe(true);
    const pin = { bytes: original.length, sha256: createHash('sha256').update(original).digest('hex') };
    expect(() => acquisition.pinned('x', acquisition.canonicalAdiiDocument(rewritten), pin)).not.toThrow();
    expect(() => acquisition.pinned('x', Buffer.from('changed'), pin)).toThrow(/reissued/);
    expect(() => acquisition.pinned('x', original, undefined)).toThrow(/no reviewed pin/);
    expect(() => acquisition.requireMarkers('x', 'Article5bis300000têtes', ['Article 5 bis', '300 000 têtes'])).not.toThrow();
  });

  test('the Ministry notice walk fails closed on an unreviewed notice and on a truncated stream', async () => {
    const reviewed = [...MOROCCO_REVIEWED_REMEDY_NOTICES];
    const cell = (title: string) => `<div>${title}</div><a href="/x.pdf">x.pdf</a><span>01-01-2026</span>`;
    const stream = (extra: string[], share = 1) => (async (input: RequestInfo | URL) => {
      const url = String(input), pageNumber = Number(/page=(\d+)/.exec(url)?.[1]);
      const titles = /antidumping/.test(url) && pageNumber === 0 ? [...reviewed.slice(0, Math.floor(reviewed.length * share)), ...extra] : [];
      return html(`<main>${titles.map(cell).join('')}</main>`);
    }) as typeof fetch;
    await expect(acquisition.remedyNotices(stream([]), 1)).resolves.toBe(reviewed.length);
    await expect(acquisition.remedyNotices(stream(['Avis public n° DDC/99/2026 relatif à l’ouverture d’une enquête antidumping sur les importations de X originaires de la République de l’Inde']), 1)).rejects.toThrow(/unreviewed trade-remedy notice.*DDC\/99\/2026/);
    await expect(acquisition.remedyNotices(stream([], 0.5), 1)).rejects.toThrow(/not fully walked/);
  });

  test('routes MA to the ADII provider and removes the stale unconfigured entry', () => {
    expect(DESTINATION_ADAPTERS.MA?.provider_key).toBe('ma_adii_tariff');
    expect(unconfiguredSourceForCountry('MA')).toBeNull();
  });
});
