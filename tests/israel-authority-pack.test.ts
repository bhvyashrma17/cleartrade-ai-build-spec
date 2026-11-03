import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { OrgTier, UserRole } from '@prisma/client';
import { describe, expect, test, vi } from 'vitest';
import { acquireIsraelAuthorityBundle, ISRAEL_RESOURCES } from '@/lib/market-access/providers/israel-acquisition';
import { ISRAEL_REQUIREMENT_FIELDS, ISRAEL_TARIFF_FIELDS, readIsraelAuthorityBundle } from '@/lib/market-access/providers/israel-bundle';
import { buildIsraelMarketAccess, parseIsraelDuty } from '@/lib/market-access/providers/israel-parser';
import { fetchIsraelMarketAccess, importIsraelRelease, reparseIsraelAuthorityRelease } from '@/lib/market-access/providers/israel-service';
import { getDocumentStorage } from '@/lib/document-storage';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';

const AT = new Date('2026-09-08T00:00:00.000Z');

const record = <T extends readonly string[]>(fields: T, values: Partial<Record<T[number], unknown>>) =>
  Object.fromEntries(fields.map((field) => [field, values[field as T[number]] ?? '']));

const tariffRows = [
  record(ISRAEL_TARIFF_FIELDS, {
    _id: 1, CustomsBookTypeID: 1, CustomsItemFullClassification: '0901110000/6',
    GoodsDescription: '-- Not decaffeinated', FullGoodsDescription: 'Coffee, not roasted, not decaffeinated',
    MeasurementUnitID: 6, MeasurementUnitDescription: 'Kilogram', CustomsTariff: 'Tax Free',
    PurchaseTaxTariff: 'Tax Free', CustomsItemCategoryID: '1',
  }),
  record(ISRAEL_TARIFF_FIELDS, {
    _id: 2, CustomsBookTypeID: 1, CustomsItemFullClassification: '0806101000/8',
    GoodsDescription: 'Released in April and May', FullGoodsDescription: 'Fresh grapes, released in April and May',
    MeasurementUnitDescription: 'Kilogram', CustomsTariff: '1.68 ₪ per Kilogram but no more than 174.50%',
    CustomsTariffEndDate: '2026-12-31', CustomsItemCategoryID: '1',
  }),
  record(ISRAEL_TARIFF_FIELDS, {
    _id: 3, CustomsBookTypeID: 1, CustomsItemFullClassification: '0806109000/0',
    GoodsDescription: 'Others', FullGoodsDescription: 'Other fresh grapes', MeasurementUnitDescription: 'Kilogram',
    CustomsTariff: '0.95 ₪ per Kilogram but no more than 174.50%', CustomsTariffEndDate: '2026-12-31',
    CustomsItemCategoryID: '1',
  }),
  record(ISRAEL_TARIFF_FIELDS, {
    _id: 4, CustomsBookTypeID: 1, CustomsItemFullClassification: '2204100000/5',
    GoodsDescription: 'Sparkling wine', FullGoodsDescription: 'Sparkling wine', MeasurementUnitDescription: 'Litre',
    CustomsTariff: '12% but no less than 3.75 ₪ per Litre', PurchaseTaxTariff: '20%', CustomsItemCategoryID: '3',
  }),
  record(ISRAEL_TARIFF_FIELDS, {
    _id: 5, CustomsBookTypeID: 1, CustomsItemFullClassification: '6109100000/1',
    GoodsDescription: 'Cotton T-shirts', FullGoodsDescription: 'Cotton T-shirts', CustomsTariff: '',
    PurchaseTaxTariff: 'Tax Free', CustomsItemCategoryID: '1',
  }),
];

const freeRequirement = record(ISRAEL_REQUIREMENT_FIELDS, {
  _id: 1, RegularityRequirementID: 3962, CustomsItemFullClassification: '0901110000/6',
  FullGoodsDescription: 'Coffee', CustomsBookTypeID: 1, CustomsBookType: 'יבוא',
  EndDate: '2069-12-31', RegularityPublication: 'צו יבוא חופשי', RegularitySource: 'תוספת 2',
  RegularityRequirement_Authority: 'משרד הבריאות', ConfirmationTypeID: 101,
  ConfirmationType: 'אישור יבוא', UpdateDate: '2026-08-25 02:03:10.000',
});

function datastore(fields: readonly string[], records: Array<Record<string, unknown>>) {
  return { success: true, result: { total: records.length, fields: fields.map((id) => ({ id, type: 'text' })), records } };
}

function packages() {
  const resource = (id: string, name: string) => ({
    id, name, format: 'CSV', url: `https://e.data.gov.il/resource/${id}/download/${id}.csv`,
    last_modified: '2026-09-08T02:03:44.996290', size: 123,
  });
  return {
    tariff: { success: true, result: { license_id: 'other-open', license_title: 'Other (Open)', metadata_modified: '2026-09-08T02:04:06Z', resources: [resource(ISRAEL_RESOURCES.tariff, 'Israel Customs Tariff and Purchase Tax')] } },
    requirements: { success: true, result: { license_id: 'other-open', license_title: 'Other (Open)', metadata_modified: '2026-09-01T02:04:06Z', resources: [resource(ISRAEL_RESOURCES.free_import, 'Free Import Order'), resource(ISRAEL_RESOURCES.additional_orders, 'Additional orders')] } },
  };
}

function authorityFetch() {
  const pkg = packages();
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    let body: unknown;
    if (url.includes('package_show?id=customsbook')) body = pkg.tariff;
    else if (url.includes('package_show?id=regularityrequirement')) body = pkg.requirements;
    else if (url.includes(ISRAEL_RESOURCES.tariff)) body = datastore(ISRAEL_TARIFF_FIELDS, tariffRows);
    else if (url.includes(ISRAEL_RESOURCES.free_import)) body = datastore(ISRAEL_REQUIREMENT_FIELDS, [freeRequirement]);
    else if (url.includes(ISRAEL_RESOURCES.additional_orders)) body = datastore([...ISRAEL_REQUIREMENT_FIELDS, 'IsPersonalImportIncluded'], [{ ...freeRequirement, _id: 2, RegularityRequirementID: 7001, IsPersonalImportIncluded: 'False' }]);
    else return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
}

async function fixtureBytes() {
  return acquireIsraelAuthorityBundle({ release_identifier: '2026-09-08' }, { fetch_impl: authorityFetch() });
}

describe('Israel data.gov.il acquisition and retained bundle', () => {
  test('acquires only the registered CKAN resources, is byte-stable, and validates all schemas', async () => {
    const fetchImpl = authorityFetch();
    const bytes = await acquireIsraelAuthorityBundle({ release_identifier: '2026-09-08' }, { fetch_impl: fetchImpl });
    const repeated = await acquireIsraelAuthorityBundle({ release_identifier: '2026-09-08' }, { fetch_impl: fetchImpl });
    expect(repeated.equals(bytes)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(10);
    const bundle = await readIsraelAuthorityBundle(bytes);
    expect(bundle.tariff_rows).toHaveLength(5);
    expect(bundle.requirement_rows).toHaveLength(2);
    expect(bundle.files.map((file) => file.role)).toEqual([
      'official_customs_tariff_and_purchase_tax',
      'official_free_import_order_requirements',
      'official_additional_import_orders',
      'acquisition_manifest',
    ]);
    expect(Object.values(bundle.resources).every((resource) => resource.license_id === 'other-open')).toBe(true);
  });

  test('refuses a partial CKAN page and a licence change', async () => {
    const partial = authorityFetch();
    partial.mockImplementationOnce(async () => new Response(JSON.stringify({ ...packages().tariff, result: { ...packages().tariff.result, license_id: 'closed' } })));
    await expect(acquireIsraelAuthorityBundle({ release_identifier: 'x' }, { fetch_impl: partial, attempts: 1 })).rejects.toThrow(/expected other-open licence/);

    const bytes = await fixtureBytes();
    const zip = await JSZip.loadAsync(bytes);
    const tariff = JSON.parse(await zip.file('customs-tariff.json')!.async('text'));
    tariff.result.total += 1;
    zip.file('customs-tariff.json', JSON.stringify(tariff));
    const altered = await zip.generateAsync({ type: 'nodebuffer' });
    await expect(readIsraelAuthorityBundle(altered)).rejects.toThrow(/did not retain all rows/);
  });
});

describe('Israel customs and purchase-tax semantics', () => {
  test('normalizes legal zero, specific, mixed and compound forms without an AVE', () => {
    expect(parseIsraelDuty('Tax Free')).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0 });
    expect(parseIsraelDuty('8.70 ₪ per Kilogram')).toMatchObject({ kind: 'specific', specific_amount: 8.7, specific_currency: 'ILS', specific_unit: 'Kilogram', specific_unit_quantity: 1, ad_valorem_rate_percent: null });
    expect(parseIsraelDuty('12% but no less than 3.75 ₪ per Litre')).toMatchObject({ kind: 'mixed', specific_amount: 3.75, specific_currency: 'ILS', specific_unit: 'Litre', ad_valorem_rate_percent: null });
    expect(parseIsraelDuty('1.20% + 0.48 ₪ per Kilogram but no less than 0.58 ₪ per Kilogram')).toMatchObject({ kind: 'compound', specific_amount: 0.48, ad_valorem_rate_percent: null });
    expect(parseIsraelDuty('')).toMatchObject({ kind: 'none', ad_valorem_rate_percent: null });
  });

  test('keeps purchase tax separate, retains requirements and effective ends, and never infers India preference', async () => {
    const bundle = await readIsraelAuthorityBundle(await fixtureBytes());
    const coffee = buildIsraelMarketAccess({ bundle, release_id: 'il-release-1', release_reference_date: AT, retrieved_at: AT, hs6: '090111', at: AT });
    expect(coffee.resolution.resolution).toBe('exact');
    expect(coffee.general_duty).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0 });
    expect(coffee.lines.filter((line) => line.measure_kind === 'third_country_duty')).toHaveLength(1);
    expect(coffee.lines.filter((line) => line.measure_kind === 'other')).toHaveLength(1);
    expect(coffee.lines.find((line) => line.measure_kind === 'other')!.conditions).toMatchObject({ tax_type: 'purchase_tax', separate_from_customs_duty: true });
    expect(coffee.requirements).toHaveLength(2);
    expect(coffee.requirements[0]!.effective_to).toEqual(new Date('2069-12-31T00:00:00.000Z'));
    expect(coffee.india_preference.applicability).toBe('unknown');
    expect(coffee.national_code_system).toBe('IL_CUSTOMS_BOOK');
    expect(coffee.source_release_id).toBe('il-release-1');
  });

  test('different national children and conditional controls force classification refinement', async () => {
    const bundle = await readIsraelAuthorityBundle(await fixtureBytes());
    const grapes = buildIsraelMarketAccess({ bundle, release_id: 'il-release-1', release_reference_date: AT, retrieved_at: AT, hs6: '080610', at: AT });
    expect(grapes.resolution.resolution).toBe('classification_refinement_required');
    expect(grapes.general_duty).toBeNull();
    expect(grapes.resolution.candidates.map((line) => line.national_tariff_code)).toEqual(['0806101000/8', '0806109000/0']);
    const wine = buildIsraelMarketAccess({ bundle, release_id: 'il-release-1', release_reference_date: AT, retrieved_at: AT, hs6: '220410', at: AT });
    expect(wine.resolution.candidates[0]!.control_codes).toContain('CONDITIONAL_CATEGORY:3');
    expect(wine.lines[0]!.effective_from).toEqual(AT);
  });

  test('a missing customs tariff remains missing even when purchase tax says Tax Free', async () => {
    const bundle = await readIsraelAuthorityBundle(await fixtureBytes());
    const result = buildIsraelMarketAccess({ bundle, release_id: 'il-release-1', release_reference_date: AT, retrieved_at: AT, hs6: '610910', at: AT });
    expect(result.resolution.resolution).toBe('exact');
    expect(result.general_duty).toBeNull();
    expect(result.lines.find((line) => line.measure_kind === 'third_country_duty')!.duty.kind).toBe('none');
    expect(result.lines.find((line) => line.measure_kind === 'other')!.duty.ad_valorem_rate_percent).toBe(0);
  });
});

describe('Israel AuthorityRelease service and idempotent reparse', () => {
  test('imports, fetches and reparses retained bytes idempotently with provenance', async () => {
    const user = await prisma.user.create({ data: { email: `israel-pack-${Date.now()}@cleartrade.test`, name: 'Israel Pack Test', role: UserRole.admin } });
    const actor: Principal = { id: user.id, email: user.email, name: user.name, role: user.role, exporter_org_id: null, tier: OrgTier.paid };
    const bytes = await fixtureBytes();
    const args = { actor, bytes, release_identifier: '2026-09-08', reference_date: AT, source_url: 'https://data.gov.il/datasets/taxes-authority/customsbook', activate: true, correlation_id: `il-import-${Date.now()}`, retrieved_at: AT };
    const first = await importIsraelRelease(args);
    const repeated = await importIsraelRelease({ ...args, correlation_id: `${args.correlation_id}-repeat` });
    expect(first.created).toBe(true);
    expect(repeated.created).toBe(false);
    expect(repeated.release.id).toBe(first.release.id);
    const fetched = await fetchIsraelMarketAccess('090111', { release_id: first.release.id, now: AT });
    expect(fetched.source_release_id).toBe(first.release.id);
    expect(fetched.source_reference).toContain(first.release.checksum);
    const parserVersion = 'il-customs-book-parser-v1-reparse-test';
    const snap1 = await reparseIsraelAuthorityRelease({ actor, release_id: first.release.id, hs6: '090111', parser_version: parserVersion, now: AT, correlation_id: `il-reparse-${Date.now()}` });
    const snap2 = await reparseIsraelAuthorityRelease({ actor, release_id: first.release.id, hs6: '090111', parser_version: parserVersion, now: AT, correlation_id: `il-reparse-repeat-${Date.now()}` });
    expect(snap2.id).toBe(snap1.id);
    expect(snap1.authority_release_id).toBe(first.release.id);
    await getDocumentStorage().delete(first.release.artifact_object_key);
  });
});

test.runIf(Boolean(process.env.CLEARTRADE_ISRAEL_RELEASE))('real source canary: parses current official DataStore bundle', async () => {
  const bundle = await readIsraelAuthorityBundle(readFileSync(process.env.CLEARTRADE_ISRAEL_RELEASE!));
  expect(bundle.tariff_rows.length).toBeGreaterThan(13_000);
  expect(bundle.requirement_rows.length).toBeGreaterThan(32_000);
  expect(bundle.tariff_rows.some((row) => row.CustomsItemFullClassification === '0901110000/6' && row.CustomsTariff === 'Tax Free')).toBe(true);
});
