import JSZip from 'jszip';
import { describe, expect, test, vi } from 'vitest';
import { acquireNorwayAuthorityBundle } from '@/lib/market-access/providers/norway-acquisition';
import { readNorwayAuthorityBundle } from '@/lib/market-access/providers/norway-bundle';
import { buildNorwayMarketAccess, parseNorwayDuty } from '@/lib/market-access/providers/norway-parser';
import { runTechnicalQualification } from '@/lib/market-access/vendor-qualification';
import { unconfiguredSourceForCountry } from '@/lib/market-access/unconfigured-sources';

const AT = new Date('2026-09-03T00:00:00.000Z');

interface RateSpec { group: string; value: string; unit: string; from?: string; to?: string }

/** Builds a bundle in the exact shape data.toll.no publishes. */
async function bundleFor(commodities: Array<{ code: string; unit?: string; rates: RateSpec[] }>, groups?: Array<Record<string, string>>) {
  const zip = new JSZip();
  const fo = { date: new Date('1980-01-01T00:00:00.000Z'), createFolders: false } as const;
  zip.file('tollavgiftssats.json', JSON.stringify({
    versjon: '1.2',
    varer: commodities.map((c) => ({
      id: c.code, enhet: c.unit ?? 'Kg', enhetBeskrivelse: 'Per kilo.', annenEnhet: null, annenEnhetBeskrivelse: null,
      avtalesatser: Object.entries(c.rates.reduce<Record<string, RateSpec[]>>((acc, r) => {
        (acc[r.group] ||= []).push(r); return acc;
      }, {})).map(([group, rates]) => ({
        landgruppe: group,
        sats: rates.map((r) => ({
          satsVerdi: r.value, satsEnhet: r.unit,
          satsEnhetBeskrivelse: r.unit === 'P' ? 'Prosent av verdien' : r.unit === 'K' ? 'Per kg' : null,
          fomdato: r.from ?? '2020-01-01', tomdato: r.to ?? '',
        })),
      })),
    })),
  }), fo);
  zip.file('varenummer.json', JSON.stringify({
    versjon: '1', varenummer: commodities.map((c) => ({ id: c.code, enhet: 'KG', enhetBeskrivelse: 'Kilogram', fomdato: '2000-01-01', tomdato: '' })),
  }), fo);
  zip.file('landgruppe.json', JSON.stringify({
    versjon: '1',
    landgrupper: groups ?? [
      { landgruppekode: 'TALL', landgruppenavn: 'Toll fra alle land', preferansekode: 'N', fomdato: '1990-01-01', tomdato: '' },
      { landgruppekode: 'TIN', landgruppenavn: 'Toll fra India', preferansekode: 'P', fomdato: '2025-10-01', tomdato: '' },
      { landgruppekode: 'TGS3', landgruppenavn: 'Ordinær GSP India (landbruksvarer)', preferansekode: 'G', fomdato: '1990-01-01', tomdato: '' },
    ],
  }), fo);
  zip.file('ratetradeagreements.json', JSON.stringify({ version: '1', commodities: [] }), fo);
  zip.file('acquisition.json', Buffer.from('{}'), fo);
  const bytes = Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  return readNorwayAuthorityBundle({ bytes, release_identifier: '2026-09-03' });
}

async function ingest(commodities: Parameters<typeof bundleFor>[0], hs6: string, at: Date = AT) {
  const bundle = await bundleFor(commodities);
  return buildNorwayMarketAccess({
    bundle, release_id: 'release-no-1', release_reference_date: AT, retrieved_at: AT, hs6, at, origin_country: 'IN',
  });
}

describe('Tolletaten acquisition and retained bundle reader', () => {
  test('accepts only official data.toll.no sources and retains all four datasets together', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ versjon: '1', varer: [] }), { status: 200 }));
    const bytes = await acquireNorwayAuthorityBundle({
      release_identifier: '2026-09-03',
      rates_url: 'https://data.toll.no/a/tollavgiftssats.json',
      goods_url: 'https://data.toll.no/b/varenummer.json',
      country_groups_url: 'https://data.toll.no/c/landgruppe.json',
      trade_agreements_url: 'https://data.toll.no/d/ratetradeagreements.json',
    }, { fetch_impl: fetchImpl });
    expect(bytes.length).toBeGreaterThan(0);
    // All four, because a rate is only interpretable against the group table of the same vintage.
    expect(fetchImpl).toHaveBeenCalledTimes(4);

    await expect(acquireNorwayAuthorityBundle({
      release_identifier: 'x', rates_url: 'https://example.com/rates.json',
      goods_url: 'https://data.toll.no/b.json', country_groups_url: 'https://data.toll.no/c.json',
      trade_agreements_url: 'https://data.toll.no/d.json',
    })).rejects.toThrow(/only accepts HTTPS sources/);
  });

  test('refuses a payload that is not the documented Tolletaten structure rather than parsing nothing', async () => {
    const zip = new JSZip();
    const fo = { date: new Date('1980-01-01T00:00:00.000Z'), createFolders: false } as const;
    // Valid JSON, but the documented "varer" array is absent.
    zip.file('tollavgiftssats.json', JSON.stringify({ versjon: '1', items: [] }), fo);
    zip.file('varenummer.json', JSON.stringify({ varenummer: [] }), fo);
    zip.file('landgruppe.json', JSON.stringify({ landgrupper: [] }), fo);
    zip.file('ratetradeagreements.json', JSON.stringify({ commodities: [] }), fo);
    zip.file('acquisition.json', Buffer.from('{}'), fo);
    const bytes = Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
    await expect(readNorwayAuthorityBundle({ bytes, release_identifier: 'x' })).rejects.toThrow(/documented "varer" array/);
  });
});

describe('Norwegian duty semantics', () => {
  test('the Norwegian decimal comma is parsed, not truncated', () => {
    const duty = parseNorwayDuty({ value: '10,70', unit: 'P', unit_description: 'Prosent av verdien', valid_from: '2004-01-01', valid_to: '' });
    expect(duty).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 10.7 });
    // Reading "10,70" with parseFloat would yield 10, understating the duty.
    expect(duty.ad_valorem_rate_percent).not.toBe(10);
  });

  test('per-kg, per-litre and per-piece rates stay specific and keep their unit', () => {
    expect(parseNorwayDuty({ value: '12,50', unit: 'K', unit_description: 'Per kg', valid_from: '2020-01-01', valid_to: '' }))
      .toMatchObject({ kind: 'specific', specific_amount: 12.5, specific_currency: 'NOK', specific_unit: 'kg' });
    expect(parseNorwayDuty({ value: '3,00', unit: 'L', unit_description: null, valid_from: '2020-01-01', valid_to: '' }))
      .toMatchObject({ kind: 'specific', specific_unit: 'litre' });
    expect(parseNorwayDuty({ value: '5,00', unit: 'S', unit_description: null, valid_from: '2020-01-01', valid_to: '' }))
      .toMatchObject({ kind: 'specific', specific_unit: 'piece' });
  });

  test('a published zero is an observed duty-free rate, not a missing one', () => {
    const duty = parseNorwayDuty({ value: '0,00', unit: 'K', unit_description: 'Per kg', valid_from: '2020-01-01', valid_to: '' });
    expect(duty.kind).toBe('specific');
    expect(duty.specific_amount).toBe(0);
    expect(duty.specific_unit).toBe('kg');
  });

  test('the 999999 placeholder is never reported as a payable duty', () => {
    // Observed 10 times in 291,033 real rate rows. Reporting it would claim a 999,999.99% tariff.
    const duty = parseNorwayDuty({ value: '999999,99', unit: ' ', unit_description: null, valid_from: '1996-01-01', valid_to: '' });
    expect(duty.kind).toBe('unparsed');
    expect(duty.ad_valorem_rate_percent).toBeNull();
    expect(duty.specific_amount).toBeNull();
    expect(duty.expression).toContain('999999,99');
    expect(duty.note).toMatch(/placeholder/);
  });

  test('an unrecognised rate unit is retained verbatim rather than assumed ad valorem', () => {
    const duty = parseNorwayDuty({ value: '4,00', unit: 'Z', unit_description: null, valid_from: '2020-01-01', valid_to: '' });
    expect(duty.kind).toBe('unparsed');
    expect(duty.note).toMatch(/not one of the documented/);
  });
});

describe('Norwegian India preference (EFTA–India TEPA and GSP)', () => {
  test('an India group rate is its own line and only ever requires origin proof', async () => {
    const result = await ingest([{
      code: '61091000',
      rates: [
        { group: 'TALL', value: '10,70', unit: 'P', from: '2004-01-01' },
        { group: 'TIN', value: '0,00', unit: 'K', from: '2025-10-01' },
      ],
    }], '610910');
    expect(result.resolution.resolution).toBe('exact');
    expect(result.general_duty).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 10.7 });
    expect(result.india_preference.applicability).toBe('potentially_applicable_requires_origin_proof');
    expect(result.india_preference.geographic_area_id).toBe('TIN');

    const preference = result.lines.filter((l) => l.measure_kind === 'tariff_preference');
    expect(preference).toHaveLength(1);
    expect(preference[0]!.applies_to_origin_country).toBe('IN');
    expect(preference[0]!.conditions).toMatchObject({ requires_origin_proof: true, country_group: 'TIN' });
    // The general duty is never replaced by the preferential one.
    expect(result.lines.find((l) => l.measure_kind === 'third_country_duty')!.duty.ad_valorem_rate_percent).toBe(10.7);
  });

  test('a TEPA rate that has not commenced yet is not applied', async () => {
    // TIN entered into force 2025-10-01; assessed before that date it must not be used.
    const result = await ingest([{
      code: '61091000',
      rates: [
        { group: 'TALL', value: '10,70', unit: 'P', from: '2004-01-01' },
        { group: 'TIN', value: '0,00', unit: 'K', from: '2025-10-01' },
      ],
    }], '610910', new Date('2025-01-01T00:00:00.000Z'));
    expect(result.india_preference.applicability).toBe('not_applicable');
    expect(result.lines.filter((l) => l.measure_kind === 'tariff_preference')).toHaveLength(0);
  });

  test('no India group at all is recorded as observed absence, never as unknown', async () => {
    const result = await ingest([{ code: '29151100', rates: [{ group: 'TALL', value: '0,00', unit: 'K' }] }], '291511');
    expect(result.india_preference.applicability).toBe('not_applicable');
    expect(result.india_preference.basis).toMatch(/observed evidence rather than missing data/);
  });

  test('GSP India is used when the TEPA group is absent, and identified as its own programme', async () => {
    const result = await ingest([{
      code: '07019000',
      rates: [
        { group: 'TALL', value: '2,17', unit: 'K' },
        { group: 'TGS3', value: '0,00', unit: 'K' },
      ],
    }], '070190');
    expect(result.india_preference.geographic_area_id).toBe('TGS3');
    expect(result.india_preference.applicability).toBe('potentially_applicable_requires_origin_proof');
  });
});

describe('Norwegian national line resolution', () => {
  test('non-equivalent commodity numbers force refinement rather than an arbitrary pick', async () => {
    const result = await ingest([
      { code: '10063020', rates: [{ group: 'TALL', value: '1,74', unit: 'K' }] },
      { code: '10063080', rates: [{ group: 'TALL', value: '0,00', unit: 'K' }] },
    ], '100630');
    expect(result.resolution.resolution).toBe('classification_refinement_required');
    expect(result.general_duty).toBeNull();
    expect(result.india_preference.applicability).toBe('unknown');
  });

  test('equivalent children resolve without refinement and qualify', async () => {
    const result = await ingest([
      { code: '85444911', rates: [{ group: 'TALL', value: '0,00', unit: 'K' }] },
      { code: '85444918', rates: [{ group: 'TALL', value: '0,00', unit: 'K' }] },
    ], '854449');
    expect(result.resolution.resolution).toBe('all_children_equivalent');
    expect(result.general_duty).toMatchObject({ kind: 'specific', specific_amount: 0 });
    expect(result.national_code_system).toBe('NO_VARENUMMER');
    expect(runTechnicalQualification(result, 'no-854449').passed).toBe(true);
  });

  test('an expired rate is not served as current', async () => {
    const result = await ingest([{
      code: '61091000',
      rates: [{ group: 'TALL', value: '14,00', unit: 'P', from: '2000-01-01', to: '2010-12-31' }],
    }], '610910');
    expect(result.general_duty?.kind).toBe('none');
    expect(result.general_duty?.note).toMatch(/no general \(TALL\) rate in force/);
  });

  test('tariff coverage never implies regulatory completeness', async () => {
    const result = await ingest([{ code: '61091000', rates: [{ group: 'TALL', value: '10,70', unit: 'P' }] }], '610910');
    expect(result.regulatory_coverage_complete).toBe(false);
    expect(result.requirements).toHaveLength(0);
  });
});

describe('Wave 2 candidates stopped with precise, distinct reasons', () => {
  test('Switzerland records the now-cleared official-text right but remains blocked on a complete Tares distribution', () => {
    const source = unconfiguredSourceForCountry('CH');
    expect(source?.reason).toBe('source_insufficient');
    expect(source!.determination).toMatch(/Copyright Act article 5/i);
    expect(source!.determination).toMatch(/complete bulk Tares contract/i);
  });

  test('Singapore stops because the portal licence does not attach to the tariff dataset', () => {
    const source = unconfiguredSourceForCountry('SG');
    expect(source?.reason).toBe('no_documented_machine_interface');
    expect(source!.determination).toMatch(/cannot be transferred onto a dataset that is not published under it/);
  });

  test('Thailand records an access refusal, and explicitly claims nothing about its rights', () => {
    const source = unconfiguredSourceForCountry('TH');
    expect(source?.reason).toBe('no_documented_machine_interface');
    expect(source!.determination).toMatch(/403/);
    expect(source!.determination).toMatch(/unresearched rather than refused/);
  });
});
