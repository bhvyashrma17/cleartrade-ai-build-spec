import JSZip from 'jszip';
import { describe, expect, test } from 'vitest';
import { cleanAddressLine, fileManifest, normalizeImporterName, parseHmrcImporterFile, periodLabel, townFrom } from '../src/lib/buyer-discovery/importer-lists';
import { postcodeArea, UK_POSTCODE_AREA_REGION, ukRegionFor } from '../src/lib/buyer-discovery/uk-regions';
import { hmrcLine } from './helpers/hmrc-lines';

/**
 * The HMRC importer-details reader (D-033, docs/38 §2) against rows in the published layout: period,
 * line number, name, five address lines, postcode, then up to 50 codes, tab-separated, no header.
 */

describe('HMRC importer details', () => {
  test('merges continuation lines, cleans addresses, finds towns and regions, keeps chapter-only codes', async () => {
    const text = [
      hmrcLine('202608', 1, 'CHRISTOPHER FARR HANDMADE RUGS', ['"""THE STUDIO"""', '12 HIGH STREET', 'SHOREDITCH', 'LONDON', ''], 'E1 6HF', ['57011010', '57011090', '57031000', '94036090']),
      hmrcLine('202608', 1, 'JOHN LEWIS PLC', ["'171 VICTORIA STREET'", '', '', 'LONDON', ''], 'SW1V 2QQ', Array.from({ length: 50 }, (_, i) => String(84000000 + i))),
      hmrcLine('202608', 2, 'JOHN LEWIS PLC', ["'171 VICTORIA STREET'", '', '', 'LONDON', ''], 'SW1V 2QQ', ['57011090', '57019090']),
      hmrcLine('202608', 1, 'GEOFABRICS LTD', ['- SKELTON GRANGE ROAD', 'STOURTON', 'LEEDS', 'WEST YORKSHIRE', ''], 'LS10 1RZ', ['55034000']),
      hmrcLine('202608', 1, 'MESSRS T & J LEIGH', ['GHYLL VIEW FARM', 'GILL LANE', 'LONGTON', 'NR PRESTON', 'LANCS'], 'PR4 4ST', ['57']),
      '',
    ].join('\r\n');
    const parsed = await parseHmrcImporterFile({ name: 'importers2608.txt', bytes: Buffer.from(text, 'latin1') });
    expect(parsed.period).toBe('2026-08');
    expect(parsed.validation).toMatchObject({ lines: 5, skipped_lines: 0, importers: 4, importers_with_only_chapter_codes: 1, without_region: 0 });
    const farr = parsed.entries.find((entry) => entry.name.startsWith('CHRISTOPHER'))!;
    expect(farr).toMatchObject({ address_lines: ['THE STUDIO', '12 HIGH STREET', 'SHOREDITCH', 'LONDON'], town: 'LONDON', postcode: 'E1 6HF', region_code: 'TLI', region_name: 'London', hs6_codes: ['570110', '570310', '940360'] });
    const lewis = parsed.entries.find((entry) => entry.name === 'JOHN LEWIS PLC')!;
    expect(lewis.hs_codes).toHaveLength(52);
    expect(lewis.hs6_codes).toContain('570110');
    expect(lewis.entity_key).toBe('JOHN LEWIS|SW1V2QQ');
    expect(parsed.entries.find((entry) => entry.name === 'GEOFABRICS LTD')).toMatchObject({ town: 'LEEDS', region_name: 'Yorkshire and The Humber', address_lines: ['SKELTON GRANGE ROAD', 'STOURTON', 'LEEDS', 'WEST YORKSHIRE'] });
    expect(parsed.entries.find((entry) => entry.name.startsWith('MESSRS'))).toMatchObject({ town: 'PRESTON', hs_codes: ['57'], hs6_codes: [] });
  });

  test('reads the text file inside HMRC ZIP and refuses a file mixing periods', async () => {
    const zip = new JSZip();
    zip.file('importers2608.txt', hmrcLine('202608', 1, 'ACME RUGS LIMITED', ['1 MILL LANE', 'BRADFORD'], 'BD1 1AA', ['57011090']));
    const bytes = Buffer.from(await zip.generateAsync({ type: 'uint8array' }));
    const parsed = await parseHmrcImporterFile({ name: 'importers2608.zip', bytes });
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]).toMatchObject({ name: 'ACME RUGS LIMITED', town: 'BRADFORD', region_code: 'TLE' });
    const mixed = [hmrcLine('202607', 1, 'A LTD', [], 'M1 1AA', ['57011090']), hmrcLine('202608', 1, 'B LTD', [], 'M1 1AA', ['57011090'])].join('\n');
    await expect(parseHmrcImporterFile({ name: 'mixed.txt', bytes: Buffer.from(mixed) })).rejects.toThrow(/expected one period/);
  });

  test('address and name helpers', () => {
    expect(cleanAddressLine('"""GHYLL VIEW FARM"""')).toBe('GHYLL VIEW FARM');
    expect(cleanAddressLine(". 2ND FLOOR, THE OLD COURTHO,")).toBe('2ND FLOOR, THE OLD COURTHO');
    expect(townFrom(['UNIT 4', 'LEEDS', 'WEST YORKSHIRE'])).toBe('LEEDS');
    expect(townFrom([])).toBeNull();
    expect(normalizeImporterName('Armadillo & Co UK Ltd')).toBe('ARMADILLO AND UK');
    expect(periodLabel('2026-08')).toBe('Aug 2026');
    expect(periodLabel('2023')).toBe('2023');
  });

  test('a file set has one identity whatever order its files come in', () => {
    const a = { name: 'a.xlsx', bytes: Buffer.from('a') };
    const b = { name: 'b.xlsx', bytes: Buffer.from('b') };
    expect(fileManifest([a, b]).sha256).toBe(fileManifest([b, a]).sha256);
    expect(fileManifest([a, b]).bytes).toBe(2);
    expect(fileManifest([a]).sha256).not.toBe(fileManifest([b]).sha256);
  });
});

describe('UK regions by postcode area', () => {
  test('every area maps once and the common ones land where expected', () => {
    expect(Object.keys(UK_POSTCODE_AREA_REGION)).toHaveLength(124);
    expect(postcodeArea('sw1v 2qq')).toBe('SW');
    expect(postcodeArea('M1 1AE')).toBe('M');
    expect(postcodeArea('BFPO 57')).toBeNull();
    expect(ukRegionFor('G2 1DY')).toEqual({ code: 'TLM', name: 'Scotland' });
    expect(ukRegionFor('BT1 5GS')).toEqual({ code: 'TLN', name: 'Northern Ireland' });
    expect(ukRegionFor('JE2 3QA')).toEqual({ code: 'CD', name: 'Channel Islands and Isle of Man' });
    expect(ukRegionFor('')).toBeNull();
  });
});
