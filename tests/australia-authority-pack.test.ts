import JSZip from 'jszip';
import { describe, expect, test, vi } from 'vitest';
import { acquireAustraliaAuthorityBundle } from '@/lib/market-access/providers/australia-acquisition';
import { readAustraliaAuthorityBundle } from '@/lib/market-access/providers/australia-bundle';
import { buildAustraliaMarketAccess, readAustraliaRateCell } from '@/lib/market-access/providers/australia-parser';
import { runTechnicalQualification } from '@/lib/market-access/vendor-qualification';
import { unconfiguredSourceForCountry } from '@/lib/market-access/unconfigured-sources';

const AT = new Date('2026-09-02T00:00:00.000Z');

/** Reproduces the real ABF Schedule 3 chapter table shape observed on abf.gov.au. */
function chapterPage(rows: Array<{ ref: string; stat: string; unit: string; goods: string; rate: string }>): string {
  const header = '<tr><th>Reference<br/>Number</th><th>Statistical<br/>Code</th><th>Unit</th><th>Goods</th><th>Rate#</th><th>Tariff concession orders</th></tr>';
  const body = rows.map((r) => `<tr><td>&#8203;${r.ref}</td><td>${r.stat}</td><td>${r.unit}</td><td>${r.goods}</td><td>${r.rate}</td><td>View TCOs</td></tr>`).join('');
  return `<html><body><table>${header}${body}</table></body></html>`;
}

/** Schedule 10A: the note plus the exception table. */
function schedule10a(exceptions: Array<{ item: string; heading: string; rate: string }>): string {
  const rows = exceptions.map((e) => `<tr><td>${e.item}</td><td>${e.heading}</td><td>${e.rate}</td></tr>`).join('');
  return `<html><body><p>Schedule 10A Indian originating goods (Sections 15 and 16 of the Customs Tariff Act 1995)</p>
<p>Note: Except for the subheadings outlined in the table below, all rates are Free.</p>
<table><tr><th>Item</th><th>Heading or subheading in Schedule 3</th><th># Rate</th></tr>${rows}</table></body></html>`;
}

async function bundleFor(
  rows: Parameters<typeof chapterPage>[0],
  exceptions: Parameters<typeof schedule10a>[0] = [],
  chapter = '61',
) {
  const zip = new JSZip();
  const fo = { date: new Date('1980-01-01T00:00:00.000Z'), createFolders: false } as const;
  zip.file('schedule-3-chapter.html', Buffer.from(chapterPage(rows), 'utf8'), fo);
  zip.file('schedule-10a-india.html', Buffer.from(schedule10a(exceptions), 'utf8'), fo);
  zip.file('acquisition.json', Buffer.from('{}', 'utf8'), fo);
  const bytes = Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  return readAustraliaAuthorityBundle({
    bytes, release_identifier: '2026-09', chapter,
    chapter_url: 'https://www.abf.gov.au/chapter', schedule_10a_url: 'https://www.abf.gov.au/10a',
  });
}

async function ingest(
  rows: Parameters<typeof chapterPage>[0],
  hs6: string,
  exceptions: Parameters<typeof schedule10a>[0] = [],
  chapter = hs6.slice(0, 2),
) {
  const bundle = await bundleFor(rows, exceptions, chapter);
  return buildAustraliaMarketAccess({
    bundle, release_id: 'release-au-1', release_reference_date: new Date('2026-07-01'),
    retrieved_at: AT, hs6, at: AT, origin_country: 'IN',
  });
}

describe('ABF acquisition and retained bundle reader', () => {
  test('accepts only official abf.gov.au sources and round-trips both retained documents', async () => {
    const zip = new JSZip();
    zip.file('x', 'y');
    const page = Buffer.from(chapterPage([{ ref: '6101.20.00', stat: '02', unit: 'No', goods: '- Of cotton', rate: '5%' }]), 'utf8');
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array(page), { status: 200 }));
    const bytes = await acquireAustraliaAuthorityBundle({
      release_identifier: '2026-09', chapter: '61',
      chapter_url: 'https://www.abf.gov.au/importing-exporting-and-manufacturing/tariff-classification/current-tariff/schedule-3/section-xi/chapter-61',
      schedule_10a_url: 'https://www.abf.gov.au/importing-exporting-and-manufacturing/tariff-classification/current-tariff/schedule-10a',
    }, { fetch_impl: fetchImpl });
    expect(bytes.length).toBeGreaterThan(0);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // chapter + Schedule 10A, both retained

    await expect(acquireAustraliaAuthorityBundle({
      release_identifier: 'x', chapter: '61',
      chapter_url: 'https://example.com/chapter', schedule_10a_url: 'https://www.abf.gov.au/10a',
    })).rejects.toThrow(/only accepts HTTPS sources/);
  });

  test('refuses a changed Schedule 3 column order rather than reading the wrong field as the rate', async () => {
    const zip = new JSZip();
    const fo = { date: new Date('1980-01-01T00:00:00.000Z'), createFolders: false } as const;
    const scrambled = '<html><body><table><tr><th>Reference Number</th><th>Goods</th><th>Unit</th><th>Statistical Code</th><th>Rate#</th></tr>'
      + '<tr><td>6101.20.00</td><td>- Of cotton</td><td>No</td><td>02</td><td>5%</td></tr></table></body></html>';
    zip.file('schedule-3-chapter.html', Buffer.from(scrambled, 'utf8'), fo);
    zip.file('schedule-10a-india.html', Buffer.from(schedule10a([]), 'utf8'), fo);
    zip.file('acquisition.json', Buffer.from('{}', 'utf8'), fo);
    const bytes = Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
    await expect(readAustraliaAuthorityBundle({
      bytes, release_identifier: 'x', chapter: '61',
      chapter_url: 'https://www.abf.gov.au/c', schedule_10a_url: 'https://www.abf.gov.au/s',
    })).rejects.toThrow(/column order changed/);
  });

  test('refuses a Schedule 10A missing its default-treatment note, because absence would otherwise be read as duty-free', async () => {
    const zip = new JSZip();
    const fo = { date: new Date('1980-01-01T00:00:00.000Z'), createFolders: false } as const;
    zip.file('schedule-3-chapter.html', Buffer.from(chapterPage([{ ref: '6101.20.00', stat: '02', unit: 'No', goods: 'x', rate: '5%' }]), 'utf8'), fo);
    zip.file('schedule-10a-india.html', Buffer.from('<html><body><table><tr><td>1</td><td>2203.00.63</td><td>$10.57/L</td></tr></table></body></html>', 'utf8'), fo);
    zip.file('acquisition.json', Buffer.from('{}', 'utf8'), fo);
    const bytes = Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
    await expect(readAustraliaAuthorityBundle({
      bytes, release_identifier: 'x', chapter: '22',
      chapter_url: 'https://www.abf.gov.au/c', schedule_10a_url: 'https://www.abf.gov.au/s',
    })).rejects.toThrow(/default India ECTA treatment is unproven/);
  });
});

describe('ABF Rate# cells are composites, not single rates', () => {
  test('a compound rate keeps BOTH components and never collapses to one scalar', () => {
    const reading = readAustraliaRateCell('5%, and $110.15/L of alcohol NZ/PG/FI/DC/LDC/SG: $110.15/L of alcohol', AT);
    expect(reading.general).toMatchObject({
      kind: 'compound', ad_valorem_rate_percent: 5, specific_amount: 110.15, specific_currency: 'AUD',
    });
    expect(reading.general.specific_unit).toBe('L of alcohol');
    // The other country's scheme rate is captured separately and is never Australia's general rate.
    expect(reading.scheme_rates['NZ/PG/FI/DC/LDC/SG']).toContain('110.15');
  });

  test('a legislated phased rate applies the step in force, not the base rate and not a future step', () => {
    const cell = '5%From 1 July 2018:3.75%From 1 July 2019:Free';
    // As of 2026 both steps have commenced, so the line is Free — reporting 5% would be wrong.
    const now = readAustraliaRateCell(cell, AT);
    expect(now.general).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0 });
    expect(now.phases).toHaveLength(2);
    expect(now.general.note).toMatch(/phased rate/i);

    // Before any step commenced, the base rate stands and the future steps are retained, not applied.
    const early = readAustraliaRateCell(cell, new Date('2017-01-01T00:00:00Z'));
    expect(early.general.ad_valorem_rate_percent).toBe(5);
    // Midway: the 2018 step applies, the 2019 step does not.
    const mid = readAustraliaRateCell(cell, new Date('2018-09-01T00:00:00Z'));
    expect(mid.general.ad_valorem_rate_percent).toBe(3.75);
  });

  test('other countries\' scheme rates are separated out and never become the general duty', () => {
    const reading = readAustraliaRateCell('5% DCS:4% DCT:5%', AT);
    expect(reading.general).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 5 });
    expect(Object.keys(reading.scheme_rates).sort()).toEqual(['DCS', 'DCT']);
    // India is deliberately absent from Schedule 3's scheme codes; ECTA lives in Schedule 10A.
    expect(reading.scheme_rates.IN).toBeUndefined();
  });

  test('a specific duty carrying a threshold formula keeps the condition verbatim rather than flattening it', () => {
    const reading = readAustraliaRateCell('$10.57/L of alcohol, calculated on that alcohol content by which the percentage by volume of alcohol of the goods exceeds 1.15', AT);
    expect(reading.general).toMatchObject({ kind: 'specific', specific_amount: 10.57, specific_currency: 'AUD' });
    expect(reading.general.note).toMatch(/threshold\/formula/);
    expect(reading.general.expression).toContain('exceeds 1.15');
  });

  test('"Free" is an observed zero, distinct from an unpublished rate', () => {
    expect(readAustraliaRateCell('Free', AT).general).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0 });
    expect(readAustraliaRateCell('', AT).general.kind).toBe('none');
  });
});

describe('Australia–India ECTA is exception-list semantics', () => {
  test('a subheading absent from Schedule 10A is duty-free on the schedule\'s own stated note, still requiring origin proof', async () => {
    const result = await ingest(
      [{ ref: '6101.20.00', stat: '02', unit: 'No', goods: '- Of cotton', rate: '5%' }],
      '610120',
      [{ item: '1', heading: '2203.00.63', rate: '$10.57/L of alcohol' }],
    );
    expect(result.resolution.resolution).toBe('exact');
    expect(result.general_duty).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 5 });
    // Free under ECTA, but never "confirmed": originating status is a shipment fact.
    expect(result.india_preference.applicability).toBe('potentially_applicable_requires_origin_proof');
    expect(result.india_preference.duty).toMatchObject({ ad_valorem_rate_percent: 0 });
    expect(result.india_preference.duty?.note).toMatch(/Except for the subheadings/);
  });

  test('a listed exception carries its real rate, not the default Free', async () => {
    const result = await ingest(
      [{ ref: '2203.00.63', stat: '11', unit: 'L', goods: 'Beer', rate: '$10.57/L of alcohol' }],
      '220300',
      [{ item: '1', heading: '2203.00.63', rate: '$5.23/L of alcohol' }],
      '22',
    );
    expect(result.india_preference.duty).toMatchObject({ kind: 'specific', specific_amount: 5.23 });
    expect(result.india_preference.duty?.note).toMatch(/Schedule 10A exception item 1/);
  });

  test('the ECTA measure is always its own line, never folded into the general duty', async () => {
    const result = await ingest([{ ref: '6101.20.00', stat: '02', unit: 'No', goods: '- Of cotton', rate: '5%' }], '610120');
    const general = result.lines.filter((l) => l.measure_kind === 'third_country_duty');
    const preference = result.lines.filter((l) => l.measure_kind === 'tariff_preference' && l.applies_to_origin_country === 'IN');
    expect(general).toHaveLength(1);
    expect(preference).toHaveLength(1);
    expect(general[0]!.duty.ad_valorem_rate_percent).toBe(5);
    expect(preference[0]!.duty.ad_valorem_rate_percent).toBe(0);
    expect(preference[0]!.conditions).toMatchObject({ requires_indian_originating_goods: true });
    expect(runTechnicalQualification(result, 'au-610120').passed).toBe(true);
  });

  test('non-equivalent national children force refinement instead of an arbitrary pick', async () => {
    const result = await ingest([
      { ref: '2203.00.63', stat: '11', unit: 'L', goods: 'Beer, not exceeding 3%', rate: '$10.57/L of alcohol' },
      { ref: '2203.00.66', stat: '14', unit: 'L', goods: 'Beer, exceeding 3.5%', rate: '$65.03/L of alcohol' },
    ], '220300', [], '22');
    expect(result.resolution.resolution).toBe('classification_refinement_required');
    expect(result.general_duty).toBeNull();
    expect(result.india_preference.applicability).toBe('unknown');
  });

  test('covers non-food, non-kg archetypes without assuming ad valorem or a single unit', async () => {
    const result = await ingest([{ ref: '8544.49.00', stat: '61', unit: 'kg', goods: 'Other electric conductors', rate: 'Free' }], '854449', [], '85');
    expect(result.resolution.resolved_line).not.toBeNull();
    expect(result.general_duty).toMatchObject({ ad_valorem_rate_percent: 0 });
    expect(result.national_code_system).toBe('AU_TARIFF_ITEM');
  });
});

describe('The Philippines remains stopped at its source boundary', () => {
  test('the Philippines stops on interface, explicitly NOT on a rights conclusion', () => {
    const source = unconfiguredSourceForCountry('PH');
    expect(source).not.toBeNull();
    expect(source!.reason).toBe('no_documented_machine_interface');
    // The distinction matters: a permissive-looking footer is not a dataset grant, and the real
    // blocker is that consuming the Finder's private endpoint would be reverse-engineering it.
    expect(source!.determination).toMatch(/site-wide boilerplate/);
    expect(source!.determination).toMatch(/private browser API/);
  });
});
