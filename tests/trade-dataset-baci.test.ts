import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  assertBaciDataHeader, classifyBaciMember, countBaciProducts, formatBaciDataLine, parseBaciCountries, parseBaciDataLine, readBaciCountryFile, splitCsvLine,
} from '../src/lib/trade-datasets/baci';

describe('BACI member names', () => {
  test('recognises data, country and product files, with the revision and version they declare', () => {
    expect(classifyBaciMember('BACI_HS17_Y2024_V202601.csv')).toEqual({ kind: 'data', name: 'BACI_HS17_Y2024_V202601.csv', hs_revision: 'HS17', year: 2024, version: 'V202601' });
    expect(classifyBaciMember('BACI_HS17_V202601/country_codes_V202601.csv')).toMatchObject({ kind: 'countries', version: 'V202601' });
    expect(classifyBaciMember('product_codes_HS22_V202601.csv')).toMatchObject({ kind: 'products', hs_revision: 'HS22' });
    expect(classifyBaciMember('Readme.txt')).toEqual({ kind: 'other', name: 'Readme.txt' });
    expect(classifyBaciMember('BACI_HS99_Y2024_V202601.csv').kind).toBe('other');
  });
});

describe('BACI data rows', () => {
  test('parses a row, keeps the product code as text and treats NA or empty quantity as unreported', () => {
    expect(parseBaciDataLine('2024,699,842,100630,1234.567,890.12', 'ctx', 2024)).toEqual({ year: 2024, exporter: '699', importer: '842', product: '100630', value_kusd: 1234.567, quantity_t: 890.12 });
    expect(parseBaciDataLine('2024,4,8,010121,0.5,NA', 'ctx', 2024)).toMatchObject({ exporter: '4', importer: '8', product: '010121', quantity_t: null });
    expect(parseBaciDataLine('2024,4,8,010121,0.5,', 'ctx', 2024).quantity_t).toBeNull();
    expect(parseBaciDataLine('2024,4,8,010121,1.2e-05,3E2', 'ctx', 2024)).toMatchObject({ value_kusd: 0.000012, quantity_t: 300 });
  });

  test('fails closed on anything outside the documented layout', () => {
    expect(() => parseBaciDataLine('2023,699,842,100630,1,1', 'ctx', 2024)).toThrow(/does not match the file's 2024/);
    expect(() => parseBaciDataLine('2024,699,842,10063,1,1', 'ctx', 2024)).toThrow(/six-digit/);
    expect(() => parseBaciDataLine('2024,699,842,100630,0,1', 'ctx', 2024)).toThrow(/strictly positive/);
    expect(() => parseBaciDataLine('2024,699,842,100630,1,-1', 'ctx', 2024)).toThrow(/negative/);
    expect(() => parseBaciDataLine('2024,699,842,100630,1', 'ctx', 2024)).toThrow(/6 fields/);
    expect(() => parseBaciDataLine('2024,699,699,100630,1,1', 'ctx', 2024)).toThrow(/both 699/);
    expect(() => parseBaciDataLine('2024,IND,842,100630,1,1', 'ctx', 2024)).toThrow(/numeric codes/);
    expect(() => parseBaciDataLine('2024,699,842,100630,1.2.3,1', 'ctx', 2024)).toThrow(/not a number/);
  });

  test('the header must be exactly t,i,j,k,v,q', () => {
    expect(() => assertBaciDataHeader('t,i,j,k,v,q', 'm')).not.toThrow();
    expect(() => assertBaciDataHeader('﻿"t","i","j","k","v","q"', 'm')).not.toThrow();
    expect(() => assertBaciDataHeader('t,i,j,k,q,v', 'm')).toThrow(/not the documented/);
  });

  test('a formatted row parses back to the same flow, keeping the raw value text', () => {
    const flow = parseBaciDataLine('2024,036,842,100630,1234.5670,NA', 'ctx', 2024);
    const text = formatBaciDataLine(flow, '1234.5670', 'NA');
    expect(text).toBe('2024,36,842,100630,1234.5670,');
    expect(parseBaciDataLine(text, 'ctx', 2024)).toEqual(flow);
  });

  test('quoted CSV fields with commas and doubled quotes split correctly', () => {
    expect(splitCsvLine('410,"Korea, Rep.","KR"')).toEqual(['410', 'Korea, Rep.', 'KR']);
    expect(splitCsvLine('1,"say ""hi""",x')).toEqual(['1', 'say "hi"', 'x']);
    expect(() => splitCsvLine('1,"open')).toThrow(/Unbalanced/);
  });
});

describe('BACI reference files', () => {
  test('reads both documented country layouts and maps invalid ISO cells to null', () => {
    const current = parseBaciCountries('country_code,country_name,country_iso2,country_iso3\n699,India,IN,IND\n490,"Other Asia, nes",N/A,S19\n842,USA,US,USA\n', 'countries');
    expect(current).toEqual([
      { provider_code: '699', name: 'India', iso2: 'IN', iso3: 'IND' },
      { provider_code: '490', name: 'Other Asia, nes', iso2: null, iso3: null },
      { provider_code: '842', name: 'USA', iso2: 'US', iso3: 'USA' },
    ]);
    const older = parseBaciCountries('country_code,country_name_abbreviation,country_name_full,iso_2digit_alpha,iso_3digit_alpha\n4,Afghanistan,Afghanistan,AF,AFG\n', 'countries');
    expect(older).toEqual([{ provider_code: '4', name: 'Afghanistan', iso2: 'AF', iso3: 'AFG' }]);
  });

  test("takes an empty alpha-2 from the file's own alpha-3 and reports it, and refuses contradicting ISO cells", () => {
    const file = readBaciCountryFile('country_code,country_name,country_iso2,country_iso3\n516,Namibia,,NAM\n490,"Other Asia, nes",,S19\n530,Netherlands Antilles (...2010),AN,ANT\n', 'countries');
    expect(file.countries).toEqual([
      { provider_code: '516', name: 'Namibia', iso2: 'NA', iso3: 'NAM' },
      { provider_code: '490', name: 'Other Asia, nes', iso2: null, iso3: null },
      { provider_code: '530', name: 'Netherlands Antilles (...2010)', iso2: 'AN', iso3: 'ANT' },
    ]);
    expect(file.iso2_from_iso3).toEqual([{ provider_code: '516', iso2_cell: '', iso3: 'NAM', iso2: 'NA' }]);
    expect(() => parseBaciCountries('country_code,country_name,country_iso2,country_iso3\n4,Afghanistan,AL,AFG\n', 'countries')).toThrow(/alpha-2 AL but alpha-3 AFG, which ISO pairs with AF/);
  });

  test('the real V202601 country file: Namibia has its ISO identity; only the three non-ISO codes lack one', () => {
    // Extracted from BACI_HS17_V202601.zip (sha256 16aaa22d…) on the owner's machine, 13 Oct 2026;
    // CEPII, Etalab Open Licence 2.0.
    const file = readBaciCountryFile(readFileSync(resolve('tests/fixtures/cepii-baci/country_codes_V202601.csv'), 'utf8'), 'country_codes_V202601.csv');
    expect(file.countries).toHaveLength(238);
    expect(file.iso2_from_iso3).toEqual([{ provider_code: '516', iso2_cell: '', iso3: 'NAM', iso2: 'NA' }]);
    expect(file.countries.filter((country) => !country.iso2).map((country) => country.provider_code)).toEqual(['490', '697', '711']);
    const byCode = new Map(file.countries.map((country) => [country.provider_code, country]));
    expect(byCode.get('699')).toMatchObject({ iso2: 'IN', iso3: 'IND' });
    expect(byCode.get('516')).toMatchObject({ name: 'Namibia', iso2: 'NA' });
    expect(byCode.get('490')).toMatchObject({ iso2: null });
  });

  test('refuses an unknown country layout and duplicate codes', () => {
    expect(() => parseBaciCountries('code,name\n1,x\n', 'countries')).toThrow(/not a documented BACI country layout/);
    expect(() => parseBaciCountries('country_code,country_name,country_iso2,country_iso3\n4,A,AF,AFG\n004,B,AF,AFG\n', 'countries')).toThrow(/duplicate country code 4/);
  });

  test('counts products after checking every code is six digits', () => {
    expect(countBaciProducts('code,description\n010121,"Horses, pure-bred"\n100630,Rice\n', 'products')).toBe(2);
    expect(() => countBaciProducts('code,description\n10121,Horses\n', 'products')).toThrow(/six digits/);
  });
});
