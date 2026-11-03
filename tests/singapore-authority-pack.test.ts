import { describe, expect, test, vi } from 'vitest';
import { DESTINATION_ADAPTERS } from '@/lib/job-handlers/market-access';
import {
  acquireSingaporeAuthorityBundle, assertSingaporeSsoAcquisitionWindow, SingaporeAcquisitionWindowError,
  SINGAPORE_CLASSIFICATION_URL, SINGAPORE_DUTIABLE_GOODS_URL, SINGAPORE_ORDER_URL, SINGAPORE_S49_URL, SINGAPORE_S67_URL, SINGAPORE_TERMS_URL,
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
    expect(() => parseSingaporeScheduleHtml(orderHtml([['1', '2401.10.10', 'Tobacco', 'KGM', '', '', '']]), { minimum_rows: 1 })).toThrow(/all duty cells are blank/);
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
