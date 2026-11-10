import { describe, expect, test, vi } from 'vitest';
import { DESTINATION_ADAPTERS } from '@/lib/job-handlers/market-access';
import {
  acquireSingaporeAuthorityBundle, assertSingaporeSsoAcquisitionWindow, buildSingaporeSavedCopyBundle, SingaporeAcquisitionWindowError,
  SINGAPORE_CLASSIFICATION_URL, SINGAPORE_DUTIABLE_GOODS_URL, SINGAPORE_ORDER_URL, SINGAPORE_S49_URL, SINGAPORE_S67_URL, SINGAPORE_SAVED_PAGES, SINGAPORE_TERMS_URL,
} from '@/lib/market-access/providers/singapore-acquisition';
import { parseSingaporeDutyCell, parseSingaporeScheduleHtml, readSingaporeAuthorityBundle } from '@/lib/market-access/providers/singapore-bundle';
import { aggregateSingaporeImportDuty, buildSingaporeMarketAccess } from '@/lib/market-access/providers/singapore-parser';
import { unconfiguredSourceForCountry } from '@/lib/market-access/unconfigured-sources';

const RELEASE = 'current-as-at-21-September-2026';
const AT = new Date('2026-09-21T00:00:00.000Z');

type AuthorityRow = readonly [string, string, string, string, string, string, string];
const authorityRows: readonly AuthorityRow[] = [
  ['1', '1006.30.90', 'Other semi-milled or wholly milled rice', 'KGM', '', '', ''],
  ['2', '2203.00.11', 'Stout and porter', 'LAL', '$16.00 per litre of alcohol', 'FREE', '$60.00 per litre of alcohol'],
  ['3', '2401.10.10', 'Tobacco, not stemmed or stripped', 'KGM', '', '', '$535.00 per kgm'],
  ['4', '8703.23.99', 'Other motor cars', 'U', '', '', '20%'],
  ['5', '2710.12.11', 'Unleaded motor spirit, RON 97 and above', 'DAL', '', '', '$7.90 per dal'],
] as const;

function orderHtml(rows: readonly AuthorityRow[] = authorityRows) {
  return `<html><body><h1>Customs (Duties) Order</h1><p>Current version as at 21 September 2026</p><h2>FIRST SCHEDULE</h2>
  <table><tr><th>Item</th><th>H.S. Code</th><th>Description</th><th>Unit of Quantity</th><th>Customs Duty — Full</th><th>Customs Duty — Preferential</th><th>Excise Duty</th></tr>
  ${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</table></body></html>`;
}

const pages: Record<string, string> = {
  [SINGAPORE_ORDER_URL]: orderHtml(),
  [SINGAPORE_S49_URL]: '<html>No. S 49/2026. Customs (Duties) (Amendment) Order 2026. Comes into operation on 1 February 2026.</html>',
  [SINGAPORE_S67_URL]: '<html>No. S 67/2026. Customs (Duties) (Amendment No. 2) Order 2026. Comes into operation on 12 February 2026. Replace $446.00 per kgm with $535.00 per kgm.</html>',
  [SINGAPORE_TERMS_URL]: '<html>Use/reproduce Singapore legislation in an electronic material or platform with permission. Automated extraction only from 3 a.m. to 7 a.m. Singapore Time.</html>',
  [SINGAPORE_CLASSIFICATION_URL]: '<html>Singapore extends HS codes to 8-digit codes under the AHTN and STCCED.</html>',
  [SINGAPORE_DUTIABLE_GOODS_URL]: '<html>Dutiable categories: intoxicating liquor; tobacco products; motor vehicles; petroleum products and biodiesel blends. Other goods are non-dutiable.</html>',
};

/** SSO's real First Schedule (saved 11 Nov 2026): anchored at Sc1, nested tables, Heading/Subheading, Full/Pref. */
type RealRow = readonly [string, string, string, string, string, string, string];
const realRows: readonly RealRow[] = [
  ['', '0910.30.00', '- Turmeric (curcuma)', 'KGM', '', '', ''],
  ['10.06', '1006.30', '- Semi-milled or wholly milled rice:', '', '', '', ''],
  ['', '1006.30.50', '- - Basmati rice', 'TNE', '', '', ''],
  ['', '2203.00.11', '- - Of an alcoholic strength by volume not exceeding 5.8% vol.', 'LTR', '$16.00 per litre of alcohol', 'Free', '$60.00 per litre of alcohol'],
  ['', '2402.20.10', '- - Beedies', 'KGM', '', '', '$454.00 per kgm'],
  ['', '2402.20.90', '- - Other', 'KGM', '', '', '58.9 cents for every gram or part thereof of each stick of cigarette'],
  ['', '8703.21.11', '- - - - Go-karts', 'NMB', '', '', ''],
  ['', '2106.90.99', '- - - Other', 'KGM', '', '', '20 cents per kgm'],
];
function realLayoutHtml(rows: readonly RealRow[] = realRows, scheduleNote = '<div class="amendNote">[S 67/2026 wef 12/02/2026]</div>') {
  const cell = (value: string, colspan = 1) => `<td colspan="${colspan}"><div class="fs">${value.replace(/ /g, '&nbsp;')}</div></td>`;
  return `<html><body><div class="prov1"><table width="100%"><tr><td class="prov1Txt">Customs (Duties) Order. Current version as at 11 Nov 2026.
  <strong>4.</strong> Where a preferential rate of duty is specified in column (6) of the First Schedule <table><tr><td>(i)</td><td>India;</td></tr></table></td></tr></table></div>
  <div class="schedule"><table width="100%"><tbody><tr><td class="sHdr" id="Sc1-">FIRST SCHEDULE</td></tr></tbody></table>${scheduleNote}
  <div class="table-responsive"><table width="100%"><tbody><tr><td class="tbl" id="Sc1-ta-oc1-"><div><table class="t table"><thead>
  <tr><th>Heading</th><th>Subheading</th><th colspan="2">Description</th><th>Unit of Quantity</th><th colspan="2">Customs Duty</th><th>Excise Duty</th><th>&nbsp;</th></tr>
  <tr><th>&nbsp;</th><th>&nbsp;</th><th colspan="2">&nbsp;</th><th>&nbsp;</th><th>Full</th><th>Pref</th><th>&nbsp;</th><th>&nbsp;</th></tr></thead><tbody>
  <tr><td></td><td></td><td colspan="2">Chapter 9 <table><tr><td>Note.</td><td>A note with its own table.</td></tr></table></td><td></td><td></td><td></td><td></td></tr>
  ${rows.map(([heading, code, description, unit, full, pref, excise]) => `<tr>${cell(heading)}${cell(code)}${cell(description, 2)}${cell(unit)}${cell(full)}${cell(pref)}${cell(excise)}</tr>`).join('\n  ')}
  </tbody></table></div></td></tr></tbody></table></div></div></body></html>`;
}

async function fixtureBundle() {
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const body = pages[url];
    return body ? new Response(body, { status: 200, headers: { 'content-type': 'text/html' } }) : new Response('missing', { status: 404 });
  });
  const bytes = await acquireSingaporeAuthorityBundle({ release_identifier: RELEASE, now: new Date('2026-09-20T19:30:00.000Z'), fetch_impl: fetchImpl as typeof fetch, qualification_minimum_rows: 5 });
  return { bytes, fetchImpl };
}

describe('Singapore SSO acquisition contract', () => {
  test('permits only 03:00–07:00 Singapore Time and returns the next lawful schedule time', () => {
    expect(assertSingaporeSsoAcquisitionWindow(new Date('2026-09-20T19:00:00.000Z')).singapore_hour).toBe(3);
    expect(assertSingaporeSsoAcquisitionWindow(new Date('2026-09-20T22:59:59.000Z')).singapore_hour).toBe(6);
    expect(() => assertSingaporeSsoAcquisitionWindow(new Date('2026-09-20T23:00:00.000Z'))).toThrow(SingaporeAcquisitionWindowError);
    try { assertSingaporeSsoAcquisitionWindow(new Date('2026-09-21T07:00:00.000Z')); } catch (error) {
      expect(error).toMatchObject({ code: 'outside_sso_automation_window', retry_at: new Date('2026-09-21T19:00:00.000Z') });
    }
  });

  test('refuses before network IO outside the window and acquires a bounded official bundle inside it', async () => {
    const fetchImpl = vi.fn();
    await expect(acquireSingaporeAuthorityBundle({ release_identifier: RELEASE, now: new Date('2026-09-21T07:00:00.000Z'), fetch_impl: fetchImpl as typeof fetch })).rejects.toThrow(/03:00 to 07:00/);
    expect(fetchImpl).not.toHaveBeenCalled();
    const fixture = await fixtureBundle();
    expect(fixture.fetchImpl).toHaveBeenCalledTimes(6);
    const bundle = await readSingaporeAuthorityBundle({ bytes: fixture.bytes, release_identifier: RELEASE, minimum_rows: 5 });
    expect(bundle.lines).toHaveLength(5);
    expect(bundle.consolidated_effective_version).toBe('2026-02-12T17:00:00+08:00');
    expect(bundle.amendments.map((item) => item.instrument)).toEqual(['S 49/2026', 'S 67/2026']);
    expect(bundle.attribution).toMatch(/permission of the Attorney-General/);
  });

  test('normalization and replay are deterministic and artifact checksums are retained', async () => {
    const one = await fixtureBundle(); const two = await fixtureBundle();
    expect(one.bytes.equals(two.bytes)).toBe(true);
    const first = await readSingaporeAuthorityBundle({ bytes: one.bytes, release_identifier: RELEASE, minimum_rows: 5 });
    const second = await readSingaporeAuthorityBundle({ bytes: one.bytes, release_identifier: RELEASE, minimum_rows: 5 });
    expect(second.canonical_tariff_checksum).toBe(first.canonical_tariff_checksum);
    expect([...second.lines.values()]).toEqual([...first.lines.values()]);
    expect(first.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true);
  });
});

describe('Singapore First Schedule semantics', () => {
  test('supports the legislated ad-valorem, specific, max and compound forms without AVE invention', () => {
    expect(parseSingaporeDutyCell('20%', 'U', 'excise')).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 20 });
    expect(parseSingaporeDutyCell('$535.00 per kgm', 'KGM', 'excise')).toMatchObject({ kind: 'specific', specific_amount: 535, specific_currency: 'SGD', specific_unit: 'kgm' });
    expect(parseSingaporeDutyCell('20% or $5.00 per kg, whichever is higher', 'KGM', 'full_customs')).toMatchObject({ kind: 'mixed', ad_valorem_rate_percent: 20, specific_amount: 5 });
    expect(parseSingaporeDutyCell('10% plus $2.00 per kg', 'KGM', 'full_customs')).toMatchObject({ kind: 'compound', ad_valorem_rate_percent: 10, specific_amount: 2 });
  });

  test('blank is absence, while joint statutory and category evidence can produce legal non-dutiable zero', () => {
    const blank = parseSingaporeDutyCell('', 'KGM', 'full_customs');
    expect(blank).toMatchObject({ kind: 'none', ad_valorem_rate_percent: null });
    const zero = aggregateSingaporeImportDuty(blank, parseSingaporeDutyCell('', 'KGM', 'excise'), true);
    expect(zero).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0, expression: 'NON-DUTIABLE' });
    // A blank line inside a dutiable category is never zero: it stays on the schedule, not proven
    // non-dutiable, so its duty is unknown and the rest of the release is still read (E-067).
    const tobacco = parseSingaporeScheduleHtml(orderHtml([['1', '2401.10.10', 'Tobacco', 'KGM', '', '', '']]), { minimum_rows: 1 }).get('24011010')!;
    expect(tobacco).toMatchObject({ non_dutiable: false });
    expect(aggregateSingaporeImportDuty(tobacco.full_customs_duty, tobacco.excise_duty, tobacco.non_dutiable)).toMatchObject({ kind: 'unparsed' });
  });

  test('reads SSO’s real layout: Heading and Subheading columns, Full and Pref, nested tables, cents (E-067)', () => {
    const lines = parseSingaporeScheduleHtml(realLayoutHtml(), { minimum_rows: 6 });
    expect([...lines.keys()]).toEqual(['09103000', '10063050', '22030011', '24022010', '24022090', '87032111', '21069099']);
    expect(lines.get('10063050')).toMatchObject({ description: '- - Basmati rice', unit: 'TNE', non_dutiable: true });
    expect(lines.get('22030011')).toMatchObject({
      full_customs_duty: { kind: 'specific', specific_amount: 16, specific_unit: 'litre of alcohol' },
      preferential_customs_duty: { kind: 'ad_valorem', ad_valorem_rate_percent: 0 }, excise_duty: { kind: 'specific', specific_amount: 60 },
    });
    expect(lines.get('24022010')!.excise_duty).toMatchObject({ kind: 'specific', specific_amount: 454, specific_unit: 'kgm' });
    // Cigarettes' excise is per stick and gram: kept unparsed on its line, never a release failure.
    expect(lines.get('24022090')!.excise_duty).toMatchObject({ kind: 'unparsed', expression: '58.9 cents for every gram or part thereof of each stick of cigarette' });
    // Go-karts: blank inside the motor-car heading, so unknown rather than zero.
    expect(lines.get('87032111')).toMatchObject({ non_dutiable: false, excise_duty: { kind: 'none' } });
    // "20 cents per kgm" is a specific duty in Singapore dollars.
    expect(lines.get('21069099')!.excise_duty).toMatchObject({ kind: 'specific', specific_amount: 0.2, specific_currency: 'SGD', specific_unit: 'kgm' });
    // A customs duty the parser cannot read still stops the release.
    expect(() => parseSingaporeScheduleHtml(realLayoutHtml([['', '2203.00.19', '- - Other', 'LTR', 'about $16', 'Free', '']]), { minimum_rows: 1 })).toThrow(/unparsed customs duty/);
    // A schedule amended after the reviewed S 67/2026 is not read under that version.
    expect(() => parseSingaporeScheduleHtml(realLayoutHtml([], '<div class="amendNote">[S 120/2027 wef 01/03/2027]</div>'), { minimum_rows: 1 })).toThrow(/newer than the reviewed S 67\/2026/);
  });

  test('a copy saved in a browser builds the same bundle without the automated window (D-029, E-067)', async () => {
    const saved = Object.fromEntries(SINGAPORE_SAVED_PAGES.map(({ file, url }) => [file, Buffer.from(pages[url]!)]));
    // 14:00 Singapore Time, outside the 03:00–07:00 window that binds scripts only.
    const bytes = await buildSingaporeSavedCopyBundle({ release_identifier: 'sso-saved-2026-11-11', saved_at: new Date('2026-11-11T06:00:00.000Z'), pages: saved, qualification_minimum_rows: 5 });
    const bundle = await readSingaporeAuthorityBundle({ bytes, release_identifier: 'sso-saved-2026-11-11', minimum_rows: 5 });
    expect(bundle).toMatchObject({ acquisition_route: 'saved_copy', consolidated_as_at: '21 September 2026' });
    expect(bundle.lines.size).toBe(5);
    expect(bundle.files.find((file) => file.name === 'customs-duties-order-current.html')).toMatchObject({ url: SINGAPORE_ORDER_URL });
    // The nightly acquisition records its own route.
    expect((await readSingaporeAuthorityBundle({ bytes: (await fixtureBundle()).bytes, release_identifier: RELEASE, minimum_rows: 5 })).acquisition_route).toBe('sso_automation_window');
    const { 'terms-of-use.html': _terms, ...missing } = saved;
    await expect(buildSingaporeSavedCopyBundle({ release_identifier: 'sso-saved-2026-11-11', saved_at: new Date(), pages: missing, qualification_minimum_rows: 5 })).rejects.toThrow(/missing or empty: terms-of-use.html/);
  });

  test('layout/source failure fails closed instead of treating missing extraction as zero', () => {
    expect(() => parseSingaporeScheduleHtml('<html>Customs (Duties) Order FIRST SCHEDULE</html>', { minimum_rows: 1 })).toThrow(/headings changed or are missing/);
    expect(() => parseSingaporeScheduleHtml(orderHtml([]), { minimum_rows: 1 })).toThrow(/found 0 tariff lines/);
  });

  test('preserves customs and excise components, aggregates only under the Order, and gates India preference on origin proof', async () => {
    const { bytes } = await fixtureBundle();
    const bundle = await readSingaporeAuthorityBundle({ bytes, release_identifier: RELEASE, minimum_rows: 5 });
    const common = { bundle, release_id: 'sg-release', release_reference_date: AT, retrieved_at: AT, at: AT };
    const ordinary = buildSingaporeMarketAccess({ ...common, hs6: '100630', origin_country: 'IN' });
    expect(ordinary.general_duty).toMatchObject({ expression: 'NON-DUTIABLE', ad_valorem_rate_percent: 0 });
    const liquor = buildSingaporeMarketAccess({ ...common, hs6: '220300', origin_country: 'IN' });
    expect(liquor.general_duty).toMatchObject({ kind: 'specific', specific_amount: 76, specific_currency: 'SGD', specific_unit: 'litre of alcohol' });
    expect(liquor.lines.filter((line) => line.conditions.component === 'CUSTOMS_DUTY')).toHaveLength(1);
    expect(liquor.lines.filter((line) => line.conditions.component === 'EXCISE_DUTY')).toHaveLength(1);
    expect(liquor.lines.find((line) => line.conditions.component === 'PREFERENTIAL_CUSTOMS_DUTY')?.duty).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0 });
    expect(liquor.lines.find((line) => line.conditions.component === 'EXCISE_DUTY')?.duty).toMatchObject({ kind: 'specific', specific_amount: 60 });
    expect(liquor.india_preference).toMatchObject({ applicability: 'potentially_applicable_requires_origin_proof' });
    expect(liquor.india_preference.duty).toMatchObject({ kind: 'specific', specific_amount: 60 });
    expect(liquor.raw_evidence).toMatchObject({ tariff_treatment_complete: true, regulatory_coverage_complete: false, india_ceca: { preference_exists: true, qualification_not_established_by_origin_country: true } });
    expect(liquor.regulatory_coverage_complete).toBe(false);
  });

  test('covers authoritative tobacco, vehicle and petroleum archetypes with their native units', async () => {
    const { bytes } = await fixtureBundle();
    const bundle = await readSingaporeAuthorityBundle({ bytes, release_identifier: RELEASE, minimum_rows: 5 });
    const common = { bundle, release_id: 'sg-release', release_reference_date: AT, retrieved_at: AT, at: AT, origin_country: 'IN' };
    expect(buildSingaporeMarketAccess({ ...common, hs6: '240110' }).general_duty).toMatchObject({ kind: 'specific', specific_amount: 535, specific_unit: 'kgm' });
    expect(buildSingaporeMarketAccess({ ...common, hs6: '870323' }).general_duty).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 20 });
    expect(buildSingaporeMarketAccess({ ...common, hs6: '271012' }).general_duty).toMatchObject({ kind: 'specific', specific_amount: 7.9, specific_unit: 'dal' });
  });
});

describe('Singapore qualification boundary', () => {
  test('D-029: routed as a retained release saved in the SSO window; a run reads only a qualified, activated copy', () => {
    // The adapter reads the active release and nothing else: before the nightly refresh has saved
    // and qualified one, the acquisition records `no_release` (tests/demand-discovery-v5-tariff-step).
    expect(DESTINATION_ADAPTERS.SG).toMatchObject({ provider_key: 'sg_sso_customs_duties_order', retrieval: 'retained_release' });
    expect(unconfiguredSourceForCountry('SG')).toBeNull();
  });
});
