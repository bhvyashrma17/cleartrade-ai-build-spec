import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { describe, expect, test } from 'vitest';
import { DESTINATION_ADAPTERS } from '../src/lib/job-handlers/market-access';
import { unconfiguredSourceForCountry } from '../src/lib/market-access/unconfigured-sources';
import { __test__ as acquisition, TUNISIA_REVIEWED_COMPONENTS, tunisiaBulletinLabels, tunisiaCurrentnessCanaries, tunisiaOfficialUrl } from '../src/lib/market-access/providers/tunisia-acquisition';
import { parseTunisiaChapterListing, parseTunisiaLinePage, parseTunisiaValue, readTunisiaAuthorityBundle, TUNISIA_ACQUISITION_VERSION, TUNISIA_BUNDLE_READER_VERSION, TUNISIA_PARSER_VERSION, TUNISIA_RIGHTS_ARTICLE, tunisiaCustomsDuty, tunisiaPreferenceTableId, type TunisiaAuthorityBundle, type TunisiaComponent, type TunisiaPreferenceEntry, type TunisiaTariffLine } from '../src/lib/market-access/providers/tunisia-bundle';
import { buildTunisiaMarketAccess } from '../src/lib/market-access/providers/tunisia-parser';
import { TUNISIA_TRADE_REMEDY_MANIFEST, validateTunisiaRemedyManifest, type TunisiaTradeRemedyManifest } from '../src/lib/market-access/providers/tunisia-remedies';

const component = (code: string, value: string, basis = 'VALEUR DOUANE DINARS', label = code): TunisiaComponent => ({ code, label, value, basis });
const VAT = component('TVA/AP', '19 %', 'VAL.DOU(D)+R(DT) GR.0'), RPD = component('RPD/IMPOR', '3 %', 'SOMME D.T (G=0.1.2.3.4.');
const PREFERENCES: TunisiaPreferenceEntry[] = [{ origin_code: '97', origin_label: 'GROUPE PAYS UNION EUROP', value: '0 %' }, { origin_code: '504', origin_label: 'MAROC', value: '0 %' }, { origin_code: '404', origin_label: 'KENYA', value: '40 %' }];
const TABLE = tunisiaPreferenceTableId(PREFERENCES);
const line = (code: string, duty: TunisiaComponent[], extra: Partial<TunisiaTariffLine> = {}): TunisiaTariffLine => ({ code, chapter: code.slice(0, 2), description: `line ${code}`, statistical_unit: 'KG', usage_group: null, payment_mode: 'MP5', import_status: 'free', customs_duty: duty, other_components: [RPD, VAT], preference_table_id: TABLE, documents: [], duplicated_rows: false, ...extra });
const DD = (value: string) => [component('DD', value, 'VALEUR DOUANE DINARS', 'DROIT DOUANE ADV.IMP')];
function fixture(remedies: TunisiaTradeRemedyManifest = TUNISIA_TRADE_REMEDY_MANIFEST): TunisiaAuthorityBundle {
  const lines = [
    line('90031100003', DD('10 %')), line('90041000005', DD('43 %')),
    line('87022010117', [component('DD/VEH.AU', '0 %')]), line('87022010913', [component('DD/VEH.AU', '43 %')]),
    line('85044055003', DD('43 %')), line('85044082005', DD('30 %')),
    line('84713000009', DD('0 %')), line('27090090967', [], { other_components: [component('DC/APP', '0.004 dinars', 'PN (KG)'), RPD, VAT] }),
    line('22083000017', DD('36 %'), { other_components: [component('DC/ALC', '5.7 dinars', 'QCI'), component('DCS/ALC', '0.8 dinars', 'QCI'), RPD, VAT] }),
    line('04069021003', DD('50 %')), line('72171050002', DD('30 %')), line('72171090100', DD('30 %')),
    line('93020000004', DD('36 %'), { import_status: 'authorisation_required', documents: [{ code: '602', description: 'PR PERMIS INTROD ARMES' }] }),
    line('85076000003', DD('30 %')), line('72254040000', DD('0 %'), { duplicated_rows: true }),
    line('39011000001', [component('DD', '15 %'), component('DD', '30 %')]),
  ];
  return { checksum: 'fixture', size_bytes: 1, release_identifier: '2026-09-24', source_url: 'https://www.douane.gov.tn/tarifweb2026/', files: [], schedule_lines: new Map(lines.map(item => [item.code, item])), preference_tables: new Map([[TABLE, PREFERENCES]]), remedies, reader_version: TUNISIA_BUNDLE_READER_VERSION, parser_version: TUNISIA_PARSER_VERSION };
}
const build = (hs6: string, at = '2026-09-24', origin = 'IN', bundle = fixture()) => buildTunisiaMarketAccess({ bundle, release_id: 'r1', release_reference_date: new Date('2026-09-24T00:00:00Z'), retrieved_at: new Date('2026-09-24T00:00:00Z'), hs6, at: new Date(`${at}T00:00:00Z`), origin_country: origin });
const kind = (result: ReturnType<typeof build>, measure: string) => result.lines.filter(entry => entry.measure_kind === measure).map(entry => [entry.national_tariff_code, entry.duty.kind, entry.duty.expression, entry.declarable]);

/** A line page in Tarifweb's real structure. */
function page(code: string, options: { status?: string; rows?: [string, string, string, string][]; preferences?: [string, string, string][]; documents?: [string, string][]; named?: string } = {}) {
  const rows = options.rows ?? [['TVA/AP', 'TAXE VALEUR AJOUTEE', '19 %', 'VAL.DOU(D)+R(DT) GR.0'], ['DD', 'DROIT DOUANE ADV.IMP', '10 %', 'VALEUR DOUANE DINARS'], ['RPD/IMPOR', 'REDEV.PREST.DOUA/IM', '3 %', 'SOMME D.T (G=0.1.2.3.4.']];
  const importRows = rows.map(([name, label, value, basis]) => `<tr>\n<td>${name} <br> <font class="lib_ass">   ${label}</font></td>\n<td style="font-weight: bold; font-size: 20px;">\n\t\t\t\t\t\t\t\t${value}\t\t\t\t\t\t\t</td>\n<td>${basis}</td>\n</tr>`).join('\n');
  const preferenceRows = (options.preferences ?? [['97', 'GROUPE PAYS UNION EUROP', '0 %'], ['504', 'MAROC', '0 %']]).map(([codeValue, label, value]) => `<tr><td style="font-weight: bold;">${codeValue}</td><td style="font-weight: bold;">${label}</td><td style="font-weight: bold;">\n${value}      </td></tr>`).join('\n');
  const documentRows = (options.documents ?? []).map(([codeValue, description]) => `<td style="font-weight: bold; font-size: 20px;">${codeValue}</td>\n<td>${description}</td>\n<td style="text-align:center;"><a href="/doc.pdf">📄</a></td>`).join('\n');
  return `<div class="container"><div class="header"><div class="nomenclature-title">Section N° 18 => Chapitre N° 90 => N° de la nomenclature: ${options.named ?? code}            </div>
<div class="product-description"><!-- echo $LIBEL; --> Montures de lunettes ou d&#039;articles similaires en matiÈres plastiques  </div></div>
<div class="info-section"><div class="section-title">INFORMATIONS GÉNÉRALES</div><div class="table-wrapper"><table class="info-table"><tr><th>QCS <br><font class="lib_ass"> Quantité</font></th><th>GU <br><font class="lib_ass"> Groupe</font></th><th>Mode de Paiement</th></tr><tr><td>PIECE</td><td>BIENS DE CONSOMMATION</td><td>MP5</td></tr></table></div></div>
<div class="info-section"><div class="section-title">CCEC - COMMERCE EXTÉRIEUR</div><div class="table-wrapper"><table class="info-table"><tr><th>IMPORT <br> <font class="lib_ass"></font></th><th>EXPORT</th></tr><tr><td><span style="color:green;">${options.status ?? 'Libre ✅'}</span></td><td><span>Libre ✅</span></td></tr></table></div></div>
<div class="info-section"><div class="section-title">DROITS ET TAXES À L'IMPORTATION</div><div class="table-wrapper"><table class="info-table"><thead><tr><th>DROITS / TAXES </th><th>Valeur</th><th>Assiette</th></tr></thead><tbody>${importRows}</tbody></table></div></div>
<div class="info-section"><div class="section-title">DROITS PRÉFÉRENTIELS PAR PAYS</div><div class="table-wrapper"><table class="info-table"><thead><tr><th>Code Pays</th><th>Pays</th><th>Taux Préférentiel</th></tr></thead><tbody>${preferenceRows}</tbody></table></div></div>
${options.documents ? `<div class="info-section"><div class="section-title">DOCUMENTS REQUIS</div><div class="table-wrapper"><table class="info-table"><thead><th>Code</th><th>Description</th><th> Document</th></thead><tbody>${documentRows}</tbody></table></div></div>` : ''}</div>`;
}

describe('Tunisia authority pack', () => {
  test('parses Tarifweb values: percentages are ad valorem, dinars are specific, blank is never zero', () => {
    expect(parseTunisiaValue('36 %', 'VALEUR DOUANE DINARS')).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 36 });
    expect(parseTunisiaValue('0 %', 'VALEUR DOUANE DINARS')).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0 });
    // A specific amount per unit is never a percentage and has no invented ad-valorem equivalent.
    expect(parseTunisiaValue('5.7 dinars', 'QCI')).toMatchObject({ kind: 'specific', ad_valorem_rate_percent: null, specific_amount: 5.7, specific_currency: 'TND', specific_unit: 'QCI' });
    expect(parseTunisiaValue('', 'x')).toMatchObject({ kind: 'none', ad_valorem_rate_percent: null });
    expect(parseTunisiaValue('selon barème', 'x')).toMatchObject({ kind: 'unparsed', ad_valorem_rate_percent: null });
    expect(tunisiaCustomsDuty({ customs_duty: [] })).toMatchObject({ kind: 'none', ad_valorem_rate_percent: null });
    expect(tunisiaCustomsDuty({ customs_duty: [component('DD', '15 %'), component('DD', '30 %')] })).toMatchObject({ kind: 'unparsed', ad_valorem_rate_percent: null });
  });

  test('reads a Tarifweb line page structurally and fails closed on layout, code or status drift', () => {
    const { line: parsed, preferences } = parseTunisiaLinePage(page('90031100003', { documents: [['677', 'ACC.PREA.IMPORT MC/MI/INSSPA']] }), '90031100003');
    expect(parsed).toMatchObject({ code: '90031100003', chapter: '90', description: 'Montures de lunettes ou d\'articles similaires en matiÈres plastiques', statistical_unit: 'PIECE', usage_group: 'BIENS DE CONSOMMATION', import_status: 'free', duplicated_rows: false, documents: [{ code: '677', description: 'ACC.PREA.IMPORT MC/MI/INSSPA' }] });
    expect(parsed.customs_duty).toEqual([{ code: 'DD', label: 'DROIT DOUANE ADV.IMP', value: '10 %', basis: 'VALEUR DOUANE DINARS' }]);
    // Other components are kept separately and sorted, so the page's row order does not change the result.
    expect(parsed.other_components.map(entry => entry.code)).toEqual(['RPD/IMPOR', 'TVA/AP']);
    expect(preferences.map(entry => entry.origin_code)).toEqual(['97', '504']);
    const duplicated = parseTunisiaLinePage(page('72254040000', { rows: [['DD', 'DROIT DOUANE ADV.IMP', '0 %', 'VALEUR DOUANE DINARS'], ['DD', 'DROIT DOUANE ADV.IMP', '0 %', 'VALEUR DOUANE DINARS']] }), '72254040000').line;
    expect(duplicated).toMatchObject({ duplicated_rows: true, customs_duty: [expect.objectContaining({ value: '0 %' })] });
    expect(parseTunisiaLinePage(page('93020000004', { status: 'Prohibé ❌' }), '93020000004').line.import_status).toBe('authorisation_required');
    expect(() => parseTunisiaLinePage(page('90031100003', { named: '90031100099' }), '90031100003')).toThrow(/names 90031100099/);
    expect(() => parseTunisiaLinePage(page('90031100003', { status: 'Suspendu' }), '90031100003')).toThrow(/unrecognised CCEC import status/);
    expect(() => parseTunisiaLinePage(page('90031100003').replace('DROITS PRÉFÉRENTIELS PAR PAYS', 'AUTRE'), '90031100003')).toThrow(/lacks a required section/);
    expect(parseTunisiaChapterListing(`<a onclick="submit_frm_resultat('','','01012100015')">x</a><a onclick="submit_frm_resultat('1','01','01')">y</a><a onclick="submit_frm_resultat('','','01012100015')">z</a>`)).toEqual(['01012100015']);
  });

  test('declares the printed conventional duty; legal zero is zero, a missing or conflicting duty is never declared', () => {
    expect(kind(build('900311'), 'third_country_duty')).toEqual([['90031100003', 'ad_valorem', '10 %', true]]);
    expect(build('900311').resolution.resolution).toBe('exact');
    expect(build('847130').general_duty).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0 });
    const crude = build('270900');
    expect(kind(crude, 'third_country_duty')).toEqual([['27090090967', 'none', '', false]]);
    expect(crude.resolution.resolution).toBe('unavailable');
    expect(crude.general_duty).toBeNull();
    expect(kind(build('390110'), 'third_country_duty')).toEqual([['39011000001', 'unparsed', 'DD 15 % / DD 30 %', false]]);
    // Plug-in and non-plug-in hybrids share an HS6 but not a rate: the exporter's product must decide.
    expect(build('870220').resolution.resolution).toBe('classification_refinement_required');
  });

  test('keeps other components separate; specific consumption duties stay specific', () => {
    const alcohol = build('220830'), conditions = alcohol.lines[0]!.conditions as { other_import_components: { code: string; parsed: { kind: string; ad_valorem_rate_percent: number | null; specific_currency: string | null } }[] };
    expect(alcohol.general_duty).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 36 });
    expect(conditions.other_import_components.filter(entry => entry.code.startsWith('DC')).map(entry => [entry.code, entry.parsed.kind, entry.parsed.ad_valorem_rate_percent, entry.parsed.specific_currency])).toEqual([['DC/ALC', 'specific', null, 'TND'], ['DCS/ALC', 'specific', null, 'TND']]);
    expect(alcohol.lines.every(entry => entry.measure_kind !== 'vat')).toBe(true);
  });

  test('the EV-charger relief is a conditional non-declarable overlay until 2028-12-31, never the ordinary rate', () => {
    const chargers = build('850440');
    expect(kind(chargers, 'third_country_duty')).toEqual([['85044055003', 'ad_valorem', '43 %', true], ['85044082005', 'ad_valorem', '30 %', true]]);
    expect(chargers.resolution.resolution).toBe('classification_refinement_required');
    const exact = build('850440', '2026-09-24', 'IN', { ...fixture(), schedule_lines: new Map([['85044055003', fixture().schedule_lines.get('85044055003')!]]) });
    expect(kind(exact, 'other')).toEqual([['85044055003', 'ad_valorem', '10%', false]]);
    expect(exact.general_duty).toMatchObject({ ad_valorem_rate_percent: 43 });
    expect(kind(build('850440', '2029-01-01', 'IN', { ...fixture(), schedule_lines: new Map([['85044055003', fixture().schedule_lines.get('85044055003')!]]) }), 'other')).toEqual([]);
    // The lithium-input exemption may be limited by the 15% legal minimum, so it is never shown as 0%.
    expect(kind(build('850760'), 'other')).toEqual([['85076000003', 'unparsed', 'exemption (conditional)', false]]);
  });

  test('a WTO tariff quota is carried with an unknown in-quota rate and a required authorization, never as zero', () => {
    const cheese = build('040690');
    expect(kind(cheese, 'tariff_quota')).toEqual([['04069021003', 'unparsed', 'in-quota rate not published', false]]);
    expect(cheese.lines.find(entry => entry.measure_kind === 'tariff_quota')!.duty.ad_valorem_rate_percent).toBeNull();
    expect(cheese.lines.find(entry => entry.measure_kind === 'tariff_quota')!.conditions).toMatchObject({ quota_id: 'TUNQ006', special_tariff_quota_authorization_required: true, quota_availability_not_established: true });
    expect(cheese.general_duty).toMatchObject({ ad_valorem_rate_percent: 50 });
    expect(cheese.requirements.map(entry => entry.requirement_code)).toContain('TN_TARIFF_QUOTA_AUTHORIZATION');
    expect((cheese.raw_evidence as Record<string, unknown>).tariff_treatment_complete).toBe(false);
    expect((build('900311').raw_evidence as Record<string, unknown>).tariff_treatment_complete).toBe(true);
    // A rate reported to the WTO for 2024 is provenance only: the 2026 in-quota rate stays unknown.
    const butter = build('040510', '2026-09-24', 'IN', { ...fixture(), schedule_lines: new Map([['04051000002', line('04051000002', DD('36 %'))]]) }).lines.find(entry => entry.measure_kind === 'tariff_quota')!;
    expect(butter.duty).toMatchObject({ kind: 'unparsed', ad_valorem_rate_percent: null, note: expect.stringMatching(/35% in-quota rate for 2024[\s\S]*not applied to a later date/) });
  });

  test('the steel-wire safeguard is a quantity restriction, never a duty, and ends on 2026-11-30', () => {
    const wire = build('721710');
    expect(wire.lines.some(entry => entry.measure_kind === 'additional_duty')).toBe(false);
    const quota = wire.requirements.filter(entry => entry.requirement_code === 'TN_SAFEGUARD_QUOTA');
    // Both wire lines carry the same duty and the same measure, so they resolve together to the first.
    expect(wire.resolution.resolution).toBe('all_children_equivalent');
    expect(quota.map(entry => [entry.national_tariff_code, entry.effective_to?.toISOString().slice(0, 10)])).toEqual([['72171050002', '2026-11-30']]);
    expect(quota[0]!.requirement_description).toMatch(/1,274 tonnes[\s\S]*not a duty[\s\S]*Quota existence is not quota availability/);
    expect((wire.raw_evidence as Record<string, unknown>).tariff_treatment_complete).toBe(false);
    expect(build('721710', '2026-12-01').requirements.some(entry => entry.requirement_code === 'TN_SAFEGUARD_QUOTA')).toBe(false);
    expect(build('721710', '2025-06-01').lines).toEqual([]);
  });

  test('India preference is unknown (GSTP/PTN), other origins never take a published preference from origin alone', () => {
    expect(build('900311').india_preference).toMatchObject({ applicability: 'unknown', duty: null, basis: expect.stringMatching(/GSTP/) });
    const morocco = build('900311', '2026-09-24', 'MA');
    expect(morocco.india_preference.applicability).toBe('not_applicable');
    expect(morocco.lines.some(entry => entry.measure_kind === 'tariff_preference')).toBe(false);
    expect(morocco.general_duty).toMatchObject({ ad_valorem_rate_percent: 10 });
    expect((morocco.lines[0]!.conditions as { published_preferences_not_applied: TunisiaPreferenceEntry[] }).published_preferences_not_applied).toContainEqual({ origin_code: '504', origin_label: 'MAROC', value: '0 %' });
  });

  test('an import excluded from the free regime needs an authorisation; required documents are carried', () => {
    const arms = build('930200');
    expect(arms.requirements.map(entry => entry.requirement_code)).toEqual(['TN_IMPORT_AUTHORISATION', 'TN_REQUIRED_DOCUMENTS']);
    expect(arms.regulatory_coverage_complete).toBe(false);
  });

  test('Tarifweb is the 2026 state and says nothing before it; outputs are deterministic', () => {
    expect(build('900311', '2025-12-31').lines).toEqual([]);
    expect(JSON.stringify(build('040690'))).toBe(JSON.stringify(build('040690')));
  });

  test('the remedy manifest is the reviewed complete enumeration and never states an unpublished in-quota rate', () => {
    expect(() => validateTunisiaRemedyManifest(TUNISIA_TRADE_REMEDY_MANIFEST)).not.toThrow();
    expect(TUNISIA_TRADE_REMEDY_MANIFEST.anti_dumping_measures).toEqual([]);
    expect(TUNISIA_TRADE_REMEDY_MANIFEST.tariff_quotas).toHaveLength(13);
    expect(() => validateTunisiaRemedyManifest({ ...TUNISIA_TRADE_REMEDY_MANIFEST, tariff_quotas: [{ ...TUNISIA_TRADE_REMEDY_MANIFEST.tariff_quotas[0]!, in_quota_rate: 27 as never }, ...TUNISIA_TRADE_REMEDY_MANIFEST.tariff_quotas.slice(1)] })).toThrow(/in-quota rate/);
    expect(() => validateTunisiaRemedyManifest({ ...TUNISIA_TRADE_REMEDY_MANIFEST, register_enumeration_complete: false as never })).toThrow(/complete enumeration/);
  });

  test('acquisition stays on the official hosts, detects error pages and unpublished-notification changes, and pins', async () => {
    expect(tunisiaOfficialUrl('https://www.douane.gov.tn/tarifweb2026/')).toBe('https://www.douane.gov.tn/tarifweb2026/');
    expect(() => tunisiaOfficialUrl('http://www.douane.gov.tn/tarifweb2026/')).toThrow(/rejects/);
    expect(() => tunisiaOfficialUrl('https://www.macmap.org/')).toThrow(/rejects/);
    let calls = 0;
    const flaky = (async () => { calls += 1; return calls === 1 ? new Response('<b>Warning</b>: mysqli_connect(): too many connections', { headers: { 'content-type': 'text/html' } }) : new Response('<html>ok</html>', { headers: { 'content-type': 'text/html' } }); }) as typeof fetch;
    await expect(acquisition.request('https://www.douane.gov.tn/x', { fetch_impl: flaky, attempts: 2, expect: 'html' })).resolves.toMatchObject({ text: '<html>ok</html>' });
    const published = (async () => new Response(Buffer.from('%PDF-1.7 new'), { headers: { 'content-type': 'application/PDF' } })) as typeof fetch;
    await expect(acquisition.request('https://docs.wto.org/x', { fetch_impl: published, attempts: 3, expect: 'unpublished' })).rejects.toThrow(/now published/);
    const unpublished = (async () => new Response('The file is not published\n<html></html>', { headers: { 'content-type': 'text/plain' } })) as typeof fetch;
    await expect(acquisition.request('https://docs.wto.org/x', { fetch_impl: unpublished, attempts: 1, expect: 'unpublished' })).resolves.toBeDefined();
    const notPdf = (async () => new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } })) as typeof fetch;
    await expect(acquisition.request('https://www.wto.org/x.pdf', { fetch_impl: notPdf, attempts: 3, expect: 'pdf' })).rejects.toThrow(/not a PDF/);
    expect(() => acquisition.pinned('x', Buffer.from('a'), { bytes: 1, sha256: '0'.repeat(64) })).toThrow(/reissued/);
    expect(() => acquisition.requireMarkers('rules', 'fixé à 15 %', ['fixé à 15%'])).not.toThrow();
    expect(() => acquisition.requireMarkers('rules', 'fixé à 20%', ['fixé à 15%'])).toThrow(/no longer supports/);
    expect(TUNISIA_REVIEWED_COMPONENTS.has('DD')).toBe(true);
    expect(TUNISIA_REVIEWED_COMPONENTS.has('DDS CHINE')).toBe(false);
  });

  test('bulletin labels and currentness canaries fail closed on an unreviewed edition', () => {
    const labels = tunisiaBulletinLabels('<td class="column-1">019_2026</td><td class="column-1">039_2025</td><td class="column-1">001_2026</td>');
    expect(labels.get(2026)).toEqual([19, 1]);
    expect(labels.get(2025)).toEqual([39]);
    const reviewed = new Map(Object.entries({
      '90031100003': line('90031100003', DD('10 %')), '87022010117': line('87022010117', [component('DD/VEH.AU', '0 %')]), '87022010913': line('87022010913', [component('DD/VEH.AU', '43 %')]),
      '85044055003': line('85044055003', DD('43 %')), '07011000007': line('07011000007', DD('50 %')), '54072011005': line('54072011005', DD('30 %'), { other_components: [component('TPE', '7 %'), RPD, VAT] }),
      ...Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`8471${String(index).padStart(7, '0')}`, line(`8471${String(index).padStart(7, '0')}`, DD(index < 9 ? '0 %' : '32 %'))])),
    }));
    const passing = tunisiaCurrentnessCanaries(reviewed);
    expect(passing.failures).toEqual([]);
    const reissued = new Map(reviewed); reissued.set('85044055003', line('85044055003', DD('10 %'))); reissued.set('07011000007', line('07011000007', DD('50 %'), { other_components: [component('TLF', '2 %')] }));
    expect(tunisiaCurrentnessCanaries(reissued).failures).toEqual(expect.arrayContaining([expect.stringMatching(/art\. 47 §4/), expect.stringMatching(/art\. 31/)]));
  });

  test('the bundle reader enforces manifest identity, artifact hashes and complete line coverage', async () => {
    const lines = Array.from({ length: 97 }, (_, index) => String(index + 1).padStart(2, '0')).filter(chapter => chapter !== '77').map(chapter => line(`${chapter}000000000`, DD('10 %')));
    const normalized = Buffer.from(JSON.stringify({ schedule_lines: lines, preference_tables: { [TABLE]: PREFERENCES }, remedies: TUNISIA_TRADE_REMEDY_MANIFEST }));
    const make = async (patch: Record<string, unknown> = {}, tamper = false) => {
      const zip = new JSZip(); zip.file('normalized.json', tamper ? Buffer.concat([normalized, Buffer.from(' ')]) : normalized);
      zip.file('acquisition.json', JSON.stringify({ acquisition_version: TUNISIA_ACQUISITION_VERSION, release_identifier: '2026-09-24', rights_evidence: { law_article: TUNISIA_RIGHTS_ARTICLE }, scope: { in_quota_rates_published: false }, base_evidence: { chapters: 97 }, artifacts: [{ name: 'normalized.json', role: 'n', size_bytes: normalized.length, sha256: createHash('sha256').update(normalized).digest('hex') }], line_pages: lines.map(entry => [entry.code, 1, 'x']), ...patch }));
      return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
    };
    const bundle = await readTunisiaAuthorityBundle({ bytes: await make(), release_identifier: '2026-09-24' });
    expect(bundle.schedule_lines.size).toBe(96);
    await expect(readTunisiaAuthorityBundle({ bytes: await make({ scope: { in_quota_rates_published: true } }), release_identifier: '2026-09-24' })).rejects.toMatchObject({ code: 'unexpected_acquisition' });
    await expect(readTunisiaAuthorityBundle({ bytes: await make({}, true), release_identifier: '2026-09-24' })).rejects.toMatchObject({ code: 'artifact_hash_mismatch' });
    await expect(readTunisiaAuthorityBundle({ bytes: await make({ line_pages: lines.slice(1).map(entry => [entry.code, 1, 'x']) }), release_identifier: '2026-09-24' })).rejects.toMatchObject({ code: 'incomplete_schedule' });
    await expect(readTunisiaAuthorityBundle({ bytes: Buffer.from('not a zip'), release_identifier: '2026-09-24' })).rejects.toMatchObject({ code: 'corrupt_archive' });
  });

  test('Tunisia is routed to the Tarifweb adapter and no longer reported as unconfigured', () => {
    expect(DESTINATION_ADAPTERS.TN?.provider_key).toBe('tn_douane_tarifweb');
    expect(unconfiguredSourceForCountry('TN')).toBeNull();
  });
});
