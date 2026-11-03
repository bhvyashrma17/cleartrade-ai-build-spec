import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import JSZip from 'jszip';
import { readTaricBundle, effectiveAt, taricDate, taricText } from '@/lib/market-access/taric/bundle';
import {
  buildTaricIngest, determineTaricIndiaPreference, normalizeTaricDuty, resolveTaric, taricAncestors,
} from '@/lib/market-access/taric/parser';
import { isEuTaricDestination } from '@/lib/market-access/taric/service';

/**
 * EU TARIC parser tests.
 *
 * The real September 2026 extraction is 27 MB and lives outside the repo, so the semantic tests
 * below run against a hand-built miniature bundle that reproduces the exact shapes verified in
 * the real files (see docs/18-taric-bundle-schema-map.md) — including the two that break naive
 * implementations: measures recorded on ANCESTOR goods codes, and a country that is a group
 * member yet explicitly excluded from one of that group's measures.
 *
 * When the real archive is present the last block additionally asserts against it.
 */

const REAL_BUNDLE = '/Users/bhavya-mac/Downloads/Archive.zip';
const AT = new Date('2026-09-01T00:00:00Z');

const SHEETS: Record<string, string[][]> = {
  'Nomenclature EN.xlsx': [
    ['Goods code', 'Start date', 'End date', 'Language', 'Hier. Pos.', 'Indent', 'Description', 'Descr. start date'],
    ['1006300000 80', '01-01-1972', '', 'EN', '6', '- ', 'Semi-milled or wholly milled rice', '01-01-1972'],
    ['1006302700 80', '01-01-1989', '', 'EN', '8', '- - - - - ', 'Of a length/width ratio >= 3', '01-01-1989'],
    ['1006302712 10', '01-01-2017', '', 'EN', '10', '- - - - - - ', 'In immediate packings not exceeding 5|kg', '01-01-2017'],
    ['1006302712 20', '01-01-2017', '', 'EN', '10', '- - - - - - - ', 'Aromatic rice', '01-01-2017'],
    ['1006302712 80', '01-01-2017', '', 'EN', '10', '- - - - - - - - ', 'Basmati rice', '01-01-2017'],
    ['1006302714 80', '01-01-2017', '', 'EN', '10', '- - - - - - - - ', 'Other', '01-01-2017'],
    // Ends before the clock: must never become a candidate.
    ['1006302799 80', '01-01-1990', '31-12-2020', 'EN', '10', '- - - - - - - - ', 'Withdrawn line', '01-01-1990'],
  ],
  'Declarable codes.xlsx': [
    ['Goods code', 'Start date', 'Decl. start date', 'IS_LEAF', 'End date'],
    ['1006300000 80', '01-01-1972', '01-01-1972', '0', ''],
    ['1006302700 80', '01-01-1989', '01-01-1989', '0', ''],
    ['1006302712 10', '01-01-2017', '01-01-2017', '0', ''],
    ['1006302712 20', '01-01-2017', '01-01-2017', '0', ''],
    ['1006302712 80', '01-01-2017', '01-01-2017', '1', ''],
    ['1006302714 80', '01-01-2017', '01-01-2017', '1', ''],
    ['1006302799 80', '01-01-1990', '01-01-1990', '1', '31-12-2020'],
  ],
  'Duties Import 01-99.xlsx': [
    ['Goods code', 'Add code', 'Order No.', 'Start date', 'End date', 'RED_IND', 'Origin', 'Measure type', 'Legal base', 'Duty', 'Origin code', 'Meas. type code'],
    // Third-country duty on the HS6 PARENT — reaches Basmati only through the cascade.
    ['1006300000', '', '', '06-03-2010', '', '', 'ERGA OMNES', 'Third country duty', 'Regulation 0192/10', '175.000 EUR TNE ', '1011', '103'],
    // India-specific conditional quota.
    ['1006300000', '', '094117', '01-01-2020', '', '', 'India', 'Non preferential tariff quota', 'Regulation 0761/20', '0.000 % ', 'IN', '122'],
    // A group quota India is a member of but is EXCLUDED from.
    ['1006300000', '', '094119', '01-01-2020', '', '', 'All third countries', 'Non preferential tariff quota', 'Regulation 0761/20', '0.000 % ', '1008', '122'],
    // Not yet in force: the extraction legitimately contains the future.
    ['1006300000', '', '', '01-01-2099', '', '', 'ERGA OMNES', 'Third country duty', 'Regulation 9999/99', '1.000 EUR TNE ', '1011', '103'],
    // Expired.
    ['1006300000', '', '', '01-01-2010', '31-12-2015', '', 'ERGA OMNES', 'Additional duties', 'Regulation 0001/10', '99.000 % ', '1011', '695'],
    // An import control for India, with conditions.
    ['1006000000', '', '', '01-01-2019', '', '', 'India', 'Import control', 'Regulation 1793/19', 'Cond:  B cert: C-678 (29):', 'IN', '731'],
    // A preference for someone else entirely — must never reach India.
    ['1006000000', '', '', '01-01-2020', '', '', 'Canada', 'Tariff preference', 'Decision 0001/20', '0.000 % ', 'CA', '142'],
  ],
  'Geographical areas composition.xlsx': [
    ['Country group', 'Start date', 'Language', 'Abbrev.', 'Country group descr.', 'Member country', 'Abbrev.', 'Description', 'Mbship start date', 'Mbship end date', 'End date'],
    ['1008', '01-01-2005', 'EN', 'ALL3', 'All third countries', 'IN', 'IN', 'India', '01-01-2005', '', ''],
    ['1011', '01-01-2005', 'EN', 'ERGA', 'ERGA OMNES', 'IN', 'IN', 'India', '01-01-2005', '', ''],
    // A membership that has ended: must not confer applicability.
    ['2020', '01-01-2005', 'EN', 'GSP', 'GSP', 'IN', 'IN', 'India', '01-01-2005', '31-12-2023', ''],
    ['1008', '01-01-2005', 'EN', 'ALL3', 'All third countries', 'CA', 'CA', 'Canada', '01-01-2005', '', ''],
  ],
  'Measure exclusions.xlsx': [
    ['Goods code', 'Add code', 'Order No.', 'Start date', 'End date', 'Origin', 'Measure type', 'Excluded country code', 'Origin code', 'Meas. type code', 'Excluded country'],
    // NOTE the swapped labels: position 7 is the NAME, position 10 is the ISO code.
    ['1006300000', '', '094119', '01-01-2020', '', 'All third countries', 'Non preferential tariff quota', 'India', '1008', '122', 'IN'],
  ],
  'Measure conditions.xlsx': [
    ['Goods code', 'Add code', 'Order No.', 'Start date', 'End date', 'Origin code', 'Meas. type code', 'Meas. cond', 'Sequence', 'Certificate', 'Cond. amount', 'Mon. unit', 'Meas. unit', 'Meas. unit qual', 'Meas. action'],
    ['1006300000', '', '094117', '01-01-2020', '', 'IN', '122', 'C', '1', 'L001', '', '', '', '', '27'],
  ],
  'Measure footnotes.xlsx': [
    ['Goods code', 'Add code', 'Order No.', 'Origin code', 'Start date', 'End date', 'Meas. type code', 'Origin', 'Measure type', 'Footnote'],
    ['1006300000', '', '', '1011', '06-03-2010', '', '103', 'ERGA OMNES', 'Third country duty', 'CD808'],
  ],
  'Footnotes descriptions.xlsx': [['Footnote code', 'Language', 'Description', 'Start date', 'Descr. start date', 'End date']],
  'Legal basis.xlsx': [
    ['Legal base', 'Off. Journal', 'Page', 'Publ. date'],
    ['Regulation 0192/10', 'L 65', '1', '06-03-2010'],
  ],
};

/** Build a real xlsx (SpreadsheetML with a shared-string table), so the reader is genuinely exercised. */
async function xlsx(rows: string[][]): Promise<Buffer> {
  const strings: string[] = [];
  const idx = (v: string) => { const i = strings.indexOf(v); return i >= 0 ? i : strings.push(v) - 1; };
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = rows.map((row, r) => {
    const cells = row.map((value, c) => {
      const ref = `${String.fromCharCode(65 + c)}${r + 1}`;
      // A blank cell is written self-closing, exactly as Excel does — this is what shifted columns
      // in the first implementation.
      return value === '' ? `<c r="${ref}"/>` : `<c r="${ref}" t="s"><v>${idx(value)}</v></c>`;
    }).join('');
    return `<row r="${r + 1}">${cells}</row>`;
  }).join('');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('xl/sharedStrings.xml', `<?xml version="1.0"?><sst>${strings.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`);
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0"?><worksheet><sheetData>${body}</sheetData></worksheet>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function miniBundle(overrides: Record<string, string[][]> = {}, omit: string[] = []): Promise<Buffer> {
  const zip = new JSZip();
  const sheets = { ...SHEETS, ...overrides };
  for (const [name, rows] of Object.entries(sheets)) {
    if (omit.includes(name)) continue;
    zip.file(name, await xlsx(rows));
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('bundle reading and validation', () => {
  test('date and text helpers follow the Commission’s conventions', () => {
    expect(taricDate('01-09-2026')?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(taricDate('')).toBeNull();
    expect(taricDate('2026-09-01')).toBeNull();
    // `|` is an unbreakable space and appears throughout the rice descriptions.
    expect(taricText('In immediate packings not exceeding 5|kg')).toBe('In immediate packings not exceeding 5 kg');
    expect(taricText('a!1!b')).toBe('a b');
  });

  test('a validity window is closed before it opens and after it ends', () => {
    expect(effectiveAt('01-01-2020', '', AT)).toBe(true);
    // The extraction contains data applicable AFTER the reference day; it must not be published.
    expect(effectiveAt('01-01-2099', '', AT)).toBe(false);
    expect(effectiveAt('01-01-2010', '31-12-2015', AT)).toBe(false);
  });

  test('a valid bundle yields per-file checksums and a bundle checksum', async () => {
    const bundle = await readTaricBundle(await miniBundle());
    expect(bundle.bundle_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(bundle.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true);
    expect(bundle.files.filter((f) => f.required).length).toBeGreaterThanOrEqual(9);
  });

  test('a missing required table is refused rather than partly parsed', async () => {
    await expect(readTaricBundle(await miniBundle({}, ['Duties Import 01-99.xlsx'])))
      .rejects.toMatchObject({ code: 'missing_required_file' });
  });

  test('a non-TARIC file, a corrupt archive and a traversal path are all refused', async () => {
    const zip = new JSZip();
    zip.file('Nomenclature EN.xlsx', await xlsx(SHEETS['Nomenclature EN.xlsx']!));
    zip.file('../../etc/passwd', 'root:x:0:0');
    await expect(readTaricBundle(await zip.generateAsync({ type: 'nodebuffer' })))
      .rejects.toMatchObject({ code: 'unexpected_file' });
    await expect(readTaricBundle(Buffer.from('not a zip at all')))
      .rejects.toMatchObject({ code: 'corrupt_archive' });
  });

  test('a changed column order fails loudly instead of parsing the wrong column as a duty', async () => {
    const swapped = SHEETS['Duties Import 01-99.xlsx']!.map((r) => [...r]);
    [swapped[0]![9], swapped[0]![10]] = [swapped[0]![10]!, swapped[0]![9]!];
    await expect(readTaricBundle(await miniBundle({ 'Duties Import 01-99.xlsx': swapped })))
      .rejects.toMatchObject({ code: 'unexpected_schema' });
  });

  test('macOS resource forks are ignored rather than rejected', async () => {
    const zip = await JSZip.loadAsync(await miniBundle());
    zip.file('__MACOSX/._Nomenclature EN.xlsx', 'junk');
    const bundle = await readTaricBundle(await zip.generateAsync({ type: 'nodebuffer' }));
    expect(bundle.files.some((f) => f.name.startsWith('._'))).toBe(false);
  });
});

describe('duty semantics', () => {
  test('a TARIC unit code is renamed, never converted', () => {
    // A decitonne IS 100 kg by definition; the amount is untouched.
    expect(normalizeTaricDuty('175.000 EUR TNE')).toBe('175.000 EUR / 1 tonne');
    expect(normalizeTaricDuty('45.000 EUR DTN')).toBe('45.000 EUR / 100 kg');
    // Everything ambiguous passes through for the shared parser to classify or preserve verbatim.
    expect(normalizeTaricDuty('12.000 % ')).toBe('12.000 %');
    expect(normalizeTaricDuty('5.000 % + 30.000 EUR DTN')).toBe('5.000 % + 30.000 EUR DTN');
    expect(normalizeTaricDuty('NIHIL')).toBe('NIHIL');
    expect(normalizeTaricDuty('3.000 EUR')).toBe('3.000 EUR');
    // A qualifier-suffixed form is not guessed at.
    expect(normalizeTaricDuty('233.000 EUR TNE I')).toBe('233.000 EUR TNE I');
  });

  test('a specific duty never becomes a percentage', async () => {
    const bundle = await readTaricBundle(await miniBundle());
    const resolution = resolveTaric(bundle, { hs6: '100630', at: AT, origin_country: 'IN' });
    const basmati = resolution.candidates.find((c) => c.national_tariff_code === '1006302712')!;
    expect(basmati.general_duty.kind).toBe('specific');
    expect(basmati.general_duty.ad_valorem_rate_percent).toBeNull();
    expect(basmati.general_duty.specific_amount).toBe(175);
    expect(basmati.general_duty.specific_currency).toBe('EUR');
    expect(basmati.general_duty.specific_unit).toBe('tonne');
  });
});

describe('measure resolution', () => {
  test('the cascade finds measures recorded on ancestor goods codes', () => {
    expect(taricAncestors('1006302712')).toEqual(
      expect.arrayContaining(['1006302712', '1006302700', '1006300000', '1006000000', '1000000000']),
    );
  });

  test('declarability comes from IS_LEAF, not from the suffix', async () => {
    const bundle = await readTaricBundle(await miniBundle());
    const resolution = resolveTaric(bundle, { hs6: '100630', at: AT, origin_country: 'IN' });
    const codes = resolution.candidates.map((c) => c.national_tariff_code).sort();
    // 1006300000 and 1006302700 carry suffix 80 but IS_LEAF=0, so they are headings, not goods.
    expect(codes).toEqual(['1006302712', '1006302714']);
    // The withdrawn line ended in 2020 and must not appear.
    expect(codes).not.toContain('1006302799');
  });

  test('ancestry is built from the intermediary suffix rows the refinement engine needs', async () => {
    const bundle = await readTaricBundle(await miniBundle());
    const resolution = resolveTaric(bundle, { hs6: '100630', at: AT, origin_country: 'IN' });
    const basmati = resolution.candidates.find((c) => c.national_tariff_code === '1006302712')!;
    expect(basmati.description).toBe('Basmati rice');
    expect(basmati.description_path).toEqual([
      'Semi-milled or wholly milled rice',
      'Of a length/width ratio >= 3',
      'In immediate packings not exceeding 5 kg',
      'Aromatic rice',
    ]);
  });

  test('future and expired measures are excluded from the applicable set', async () => {
    const bundle = await readTaricBundle(await miniBundle());
    const resolution = resolveTaric(bundle, { hs6: '100630', at: AT, origin_country: 'IN' });
    const expressions = resolution.measures.map((m) => m.duty_expression);
    expect(expressions.some((e) => e.includes('175.000'))).toBe(true);
    // The 2099 duty and the 2015-expired additional duty must both be absent.
    expect(expressions.some((e) => e.includes('1.000 EUR'))).toBe(false);
    expect(expressions.some((e) => e.includes('99.000'))).toBe(false);
  });

  test('group membership does not survive an explicit exclusion', async () => {
    const bundle = await readTaricBundle(await miniBundle());
    const resolution = resolveTaric(bundle, { hs6: '100630', at: AT, origin_country: 'IN' });
    const quotas = resolution.measures.filter((m) => m.is_quota).map((m) => m.quota_order_number);
    // India is a member of group 1008 but is excluded from 094119 specifically.
    expect(quotas).toContain('094117');
    expect(quotas).not.toContain('094119');
    expect(resolution.excluded_from.some((k) => k.includes('094119'))).toBe(true);
  });

  test('an ended group membership confers nothing', async () => {
    const bundle = await readTaricBundle(await miniBundle());
    const resolution = resolveTaric(bundle, { hs6: '100630', at: AT, origin_country: 'IN' });
    // India's membership of 2020 ended in 2023.
    expect(resolution.india_groups).not.toContain('2020');
    expect(resolution.india_groups).toEqual(expect.arrayContaining(['1008', '1011']));
  });

  test('another country’s preference never reaches India', async () => {
    const bundle = await readTaricBundle(await miniBundle());
    const resolution = resolveTaric(bundle, { hs6: '100630', at: AT, origin_country: 'IN' });
    expect(resolution.measures.some((m) => m.origin_code === 'CA')).toBe(false);
    // And it does reach Canada, so the filter is selective rather than simply empty.
    const canada = resolveTaric(bundle, { hs6: '100630', at: AT, origin_country: 'CA' });
    expect(canada.measures.some((m) => m.origin_code === 'CA' && m.measure_type_code === '142')).toBe(true);
  });
});

describe('India preference is never inferred', () => {
  test('a conditional quota is a volume entitlement, not a 0% tariff', async () => {
    const bundle = await readTaricBundle(await miniBundle());
    const resolution = resolveTaric(bundle, { hs6: '100630', at: AT, origin_country: 'IN' });
    const preference = determineTaricIndiaPreference(resolution, 'IN');
    expect(preference.applicability).toBe('potentially_applicable_requires_origin_proof');
    // No rate is published: a 0% quota must never become the applied rate.
    expect(preference.duty).toBeNull();
    expect(preference.basis).toMatch(/volume entitlement, not an unconditional applied rate/);
    expect(preference.basis).toMatch(/094117/);
  });

  test('a published preference still requires origin proof', async () => {
    const bundle = await readTaricBundle(await miniBundle());
    // Canada has a type-142 preference in the fixture.
    const resolution = resolveTaric(bundle, { hs6: '100630', at: AT, origin_country: 'CA' });
    const preference = determineTaricIndiaPreference(resolution, 'CA');
    expect(preference.applicability).toBe('potentially_applicable_requires_origin_proof');
    expect(preference.basis).toMatch(/rules-of-origin/i);
  });
});

describe('ingest shape and destination scoping', () => {
  test('EU destinations share the tariff authority but keep their own country scope', async () => {
    const bundle = await readTaricBundle(await miniBundle());
    const resolution = resolveTaric(bundle, { hs6: '100630', at: AT, origin_country: 'IN' });
    const build = (dest: string) => buildTaricIngest({
      bundle, resolution, destination_country: dest, release_label: 'TARIC 2026-09',
      release_reference_date: AT, retrieved_at: AT, origin_country: 'IN',
    });
    for (const dest of ['DE', 'FR', 'NL']) {
      const ingest = build(dest);
      expect(ingest.jurisdiction).toBe('EU');
      expect(ingest.country_code).toBe(dest);
      expect(ingest.national_code_system).toBe('EU_TARIC');
      expect(ingest.provider).toBe('eu_taric');
      expect(ingest.source_dataset_version).toBe('TARIC 2026-09');
      // TARIC is not a complete national regulatory corpus, so absence is never "no requirements".
      expect(ingest.regulatory_coverage_complete).toBe(false);
    }
    // The three destinations agree on the schedule, which is the point of a customs union.
    expect(build('DE').general_duty?.expression).toBe(build('FR').general_duty?.expression);
  });

  test('EU members and the two proved associated customs territories are TARIC destinations', () => {
    for (const inside of ['DE', 'FR', 'NL', 'IT', 'ES', 'PL']) expect(isEuTaricDestination(inside)).toBe(true);
    for (const associated of ['AX', 'MC']) expect(isEuTaricDestination(associated)).toBe(true);
    for (const outside of ['GB', 'US', 'CH', 'NO', 'SA', 'IN', 'TR']) expect(isEuTaricDestination(outside)).toBe(false);
  });

  test('the raw release identity travels with the evidence', async () => {
    const bundle = await readTaricBundle(await miniBundle());
    const resolution = resolveTaric(bundle, { hs6: '100630', at: AT, origin_country: 'IN' });
    const ingest = buildTaricIngest({
      bundle, resolution, destination_country: 'DE', release_label: 'TARIC 2026-09',
      release_reference_date: AT, retrieved_at: AT, origin_country: 'IN',
    });
    const raw = ingest.raw_evidence as Record<string, unknown>;
    expect(raw.bundle_sha256).toBe(bundle.bundle_sha256);
    expect(raw.parser_version).toBe('taric-parser-v1');
    expect(ingest.source_reference).toContain(bundle.bundle_sha256);
  });
});

// The real extraction is not in the repo; when it is present locally, assert against it.
describe.runIf(existsSync(REAL_BUNDLE))('against the real September 2026 extraction', () => {
  test('HS6 100630 yields the official 108 declarable candidates and the real India picture', async () => {
    const bundle = await readTaricBundle(readFileSync(REAL_BUNDLE));
    const resolution = resolveTaric(bundle, { hs6: '100630', at: AT, origin_country: 'IN' });
    expect(resolution.candidates).toHaveLength(108);
    const basmati = resolution.candidates.find((c) => c.national_tariff_code === '1006302712')!;
    expect(basmati.description).toBe('Basmati rice');
    expect(basmati.description_path).toContain('Aromatic rice');
    expect(basmati.general_duty.specific_amount).toBe(175);
    expect(basmati.general_duty.specific_unit).toBe('tonne');
    // India is excluded from quota 094119 on group 1008 in the real data.
    expect(resolution.measures.map((m) => m.quota_order_number)).not.toContain('094119');
    expect(resolution.measures.map((m) => m.quota_order_number)).toContain('094117');
    expect(determineTaricIndiaPreference(resolution, 'IN').applicability).toBe('potentially_applicable_requires_origin_proof');
  }, 120_000);
});
