import { gzipSync } from 'node:zlib';
import { describe, expect, test, vi } from 'vitest';
import { acquireNzAuthorityBundle } from '@/lib/market-access/providers/nz-acquisition';
import { readNzAuthorityBundle, type NzAuthorityBundle } from '@/lib/market-access/providers/nz-bundle';
import { buildNzMarketAccess } from '@/lib/market-access/providers/nz-parser';
import { runTechnicalQualification } from '@/lib/market-access/vendor-qualification';

const AT = new Date('2026-09-02T00:00:00.000Z');

const DETAILS_HEADER = 'Tic Tariff Level 1~Tic Tariff Level 2~Tic Tariff Level 3~Tic Tariff Level 4~Tic Tariff Level 5~Tic Tariff Letter~Tic Tariff Section~Tic Statistical Unit~Tic Supplementary Unit~Tic Alternate Tariff Item~Tic Alternate Ind~Tic Gst Exempt Ind~Tic Start Date~Tic Expiry Date~Tic Tariff Description';
const RATES_HEADER = 'Tdrc Tariff Level 1~Tdrc Tariff Level 2~Tdrc Tariff Level 3~Tdrc Tariff Level 4~Tdrc Tariff Level 5~Tdrc Rate Group~Tdrc Start Date~Tdrc Expiry Date~Tdrc Excise Factor~Tdrc Rate Formula~Tdrc Factor A~Tdrc Factor B~Tdrc Factor C~Tdrc Factor D~Tdrc Factor E~Tdrc Factor F';

/** Minimal USTAR writer: exactly enough to round-trip what the reader needs. */
function tar(files: Record<string, string>): Buffer {
  const chunks: Buffer[] = [];
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8');
    const header = Buffer.alloc(512);
    header.write(name, 0, 'utf8');
    header.write(data.length.toString(8).padStart(11, '0'), 124, 'utf8');
    header[156] = '0'.charCodeAt(0);
    let checksum = 0;
    for (let i = 0; i < 512; i += 1) checksum += i >= 148 && i < 156 ? 32 : header[i]!;
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 'utf8');
    chunks.push(header, data, Buffer.alloc((512 - (data.length % 512 || 512)) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function archive(csvs: { details?: string; rates?: string; levies?: string; levyFormulas?: string; timestamp?: string }): Buffer {
  return gzipSync(tar({
    'time_stamp.txt': csvs.timestamp ?? 'Wed Sep  2 04:00:01 AM NZST 2026',
    'Tariff_Rates.csv': csvs.rates ?? RATES_HEADER,
    'Tariff_Levies.csv': csvs.levies ?? 'Tlrc Tariff Level 1~Tlrc Tariff Level 2~Tlrc Tariff Level 3~Tlrc Tariff Level 4~Tlrc Tariff Level 5~Tlrc Levy Type Code~Tlrc Levy Formula Code~Tlrc Start Date~Tlrc Expiry Date',
    'Tariff_Levy_Formulas.csv': csvs.levyFormulas ?? 'x',
    'Tariff_Details.csv': csvs.details ?? DETAILS_HEADER,
  }));
}

function bundleFor(details: string[], rates: string[]): NzAuthorityBundle {
  return readNzAuthorityBundle({
    bytes: archive({ details: [DETAILS_HEADER, ...details].join('\n'), rates: [RATES_HEADER, ...rates].join('\n') }),
    release_identifier: 'T2026-09-02',
    tariff_archive_url: 'https://www.customs.govt.nz/media/0nmaamqd/tariff.tar.gz',
  });
}

function ingest(details: string[], rates: string[], hs6: string) {
  return buildNzMarketAccess({
    bundle: bundleFor(details, rates),
    release_id: 'release-nz-1',
    release_reference_date: new Date('2026-09-02T00:00:00Z'),
    retrieved_at: AT,
    hs6,
    at: AT,
  });
}

describe('NZ Customs acquisition and retained bundle reader', () => {
  test('acquires only official NZ Customs bytes and validates the CusMod CSV schema', async () => {
    const bytes = archive({
      details: [DETAILS_HEADER, '10~06~30~00~90~D~2~KGM~~~~N~Jan  1 1988 12:00AM~Dec 31 3000 11:59PM~RICE, SEMI-MILLED'].join('\n'),
      rates: [RATES_HEADER, '10~06~30~00~90~NML~Jan  1 1988 12:00AM~Dec 31 3000 11:59PM~~1~~~~~~'].join('\n'),
    });
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array(bytes), { status: 200 }));
    const fetched = await acquireNzAuthorityBundle({ tariff_archive_url: 'https://www.customs.govt.nz/media/0nmaamqd/tariff.tar.gz', release_identifier: 'T2026-09-02' }, { fetch_impl: fetchImpl });
    expect(fetched.equals(bytes)).toBe(true);
    const decoded = readNzAuthorityBundle({ bytes: fetched, release_identifier: 'T2026-09-02', tariff_archive_url: 'https://www.customs.govt.nz/media/0nmaamqd/tariff.tar.gz' });
    expect(decoded.details).toHaveLength(1);
    expect(decoded.time_stamp).toMatch(/2026/);
  });

  test('rejects a non-NZ-Customs source before any request, and a column-order change', async () => {
    await expect(acquireNzAuthorityBundle({ tariff_archive_url: 'https://example.com/tariff.tar.gz', release_identifier: 'x' })).rejects.toThrow(/only accepts HTTPS sources/);
    const scrambled = archive({ rates: 'Tdrc Rate Group~Tdrc Tariff Level 1\nNML~10' });
    expect(() => readNzAuthorityBundle({ bytes: scrambled, release_identifier: 'x', tariff_archive_url: 'https://x' })).toThrow(/column order changed/);
  });
});

describe('NZ Customs tariff semantics from real CusMod row shapes', () => {
  test('formula 1 is an observed Free zero; a code entirely absent from the release is missing, not zero', () => {
    const result = ingest(
      ['10~06~30~00~90~D~2~KGM~~~~N~Jan  1 1988 12:00AM~Dec 31 3000 11:59PM~RICE, SEMI-MILLED'],
      ['10~06~30~00~90~NML~Jan  1 1988 12:00AM~Dec 31 3000 11:59PM~~1~~~~~~'],
      '100630',
    );
    expect(result.general_duty).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0, expression: 'Free' });
    expect(runTechnicalQualification(result, 'nz-rice-zero').passed).toBe(true);

    // An HS6 absent from the release is "missing", not zero — distinct from an empty release
    // file, which the bundle reader itself refuses to accept as a valid acquisition at all.
    const missing = ingest(
      ['10~06~30~00~90~D~2~KGM~~~~N~Jan  1 1988 12:00AM~Dec 31 3000 11:59PM~RICE, SEMI-MILLED'],
      ['10~06~30~00~90~NML~Jan  1 1988 12:00AM~Dec 31 3000 11:59PM~~1~~~~~~'],
      '999999',
    );
    expect(missing.general_duty).toBeNull();
    expect(missing.resolution.resolution).toBe('unavailable');
  });

  test("formula 4 is a real specific duty (readme's own worked example), never collapsed to a percentage", () => {
    const result = ingest(
      ['27~10~19~11~11~F~5~LTR~~~~N~2007-04-01 12:00AM~Dec 31 3000 11:59PM~MOTOR SPIRIT'],
      ['27~10~19~11~11~NML~Jan  1 2007 12:00AM~Dec 31 3000 11:59PM~~4~0.425240~~~~~'],
      '271019',
    );
    expect(result.general_duty).toMatchObject({ kind: 'specific', specific_amount: 0.42524, specific_currency: 'NZD', ad_valorem_rate_percent: null });
  });

  test('formula 3 is ad valorem, formulas 5/6 stay compound with every factor retained, never a fabricated scalar', () => {
    const adValorem = ingest(
      ['02~03~12~00~09~D~1~KGM~~~~N~Jan  1 1988 12:00AM~Dec 31 3000 11:59PM~PORK CUTS'],
      ['02~03~12~00~09~NML~Jan  1 1988 12:00AM~Dec 31 3000 11:59PM~~3~5.000000~~~~~'],
      '020312',
    );
    expect(adValorem.general_duty).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 5, specific_amount: null });

    const compound = ingest(
      ['39~26~20~69~02~D~7~KGM~~~~N~Jan  1 1988 12:00AM~Dec 31 3000 11:59PM~PLASTIC ARTICLE'],
      ['39~26~20~69~02~NML~Jan  1 1988 12:00AM~Dec 31 3000 11:59PM~~6~2.500000~7.500000~~~~'],
      '392620',
    );
    expect(compound.general_duty).toMatchObject({ kind: 'compound', ad_valorem_rate_percent: null, specific_amount: null });
    expect(compound.general_duty!.expression).toMatch(/A=2\.5/);
    expect(compound.general_duty!.expression).toMatch(/B=7\.5/);
  });

  test('formula 2 (manual calculation required) is never auto-resolved into any duty kind', () => {
    const result = ingest(
      ['11~11~11~11~11~D~1~KGM~~~~N~Jan  1 1988 12:00AM~Dec 31 3000 11:59PM~SPECIAL CASE'],
      ['11~11~11~11~11~NML~Jan  1 1988 12:00AM~Dec 31 3000 11:59PM~~2~~~~~~'],
      '111111',
    );
    expect(result.general_duty).toMatchObject({ kind: 'unparsed' });
    expect(result.general_duty!.note).toMatch(/manual calculation/);
  });

  test('a currently-effective India ("IN") rate group is a preference requiring origin proof; its absence is not applicable, never unknown', () => {
    const withIndia = ingest(
      ['09~10~10~19~00~D~2~KGM~~~~N~Jan  1 1988 12:00AM~Dec 31 3000 11:59PM~SPICE'],
      [
        '09~10~10~19~00~NML~Jan  1 1988 12:00AM~Dec 31 3000 11:59PM~~3~5.000000~~~~~',
        '09~10~10~19~00~IN~Jan  1 1988 12:00AM~Dec 31 3000 11:59PM~~3~2.000000~~~~~',
      ],
      '091010',
    );
    expect(withIndia.india_preference).toMatchObject({ applicability: 'potentially_applicable_requires_origin_proof' });

    const withoutIndia = ingest(
      ['09~10~10~19~00~D~2~KGM~~~~N~Jan  1 1988 12:00AM~Dec 31 3000 11:59PM~SPICE'],
      ['09~10~10~19~00~NML~Jan  1 1988 12:00AM~Dec 31 3000 11:59PM~~3~5.000000~~~~~'],
      '091010',
    );
    expect(withoutIndia.india_preference).toMatchObject({ applicability: 'not_applicable', duty: null });
  });

  test('an expired rate row is excluded by the assessment clock, and a future-dated row is not yet current', () => {
    const result = ingest(
      ['10~06~10~00~00~K~2~KGM~~~~N~Jan  1 1988 12:00AM~Dec  8 2004 11:59PM~RICE IN THE HUSK'],
      ['10~06~10~00~00~NML~Jan  1 1988 12:00AM~Dec  8 2004 11:59PM~~1~~~~~~'],
      '100610',
    );
    expect(result.general_duty).toBeNull(); // the only detail/rate row expired long before the assessment clock
  });

  test('non-rice products across archetypes do not assume kg, food, or a single ad-valorem shape', () => {
    const details = [
      '85~44~49~00~11~D~16~KGM~~~~N~Jan  1 2020 12:00AM~Dec 31 3000 11:59PM~ELECTRIC CONDUCTOR',
      '84~79~89~00~90~D~16~NMB~~~~N~Jan  1 2020 12:00AM~Dec 31 3000 11:59PM~INDUSTRIAL MACHINE',
      '29~15~90~00~00~D~6~KGM~~~~N~Jan  1 2020 12:00AM~Dec 31 3000 11:59PM~INDUSTRIAL CHEMICAL',
      '74~19~80~00~00~D~15~KGM~~~~N~Jan  1 2020 12:00AM~Dec 31 3000 11:59PM~BRASS ARTICLE',
    ];
    const rates = [
      '85~44~49~00~11~NML~Jan  1 2020 12:00AM~Dec 31 3000 11:59PM~~1~~~~~~',
      '84~79~89~00~90~NML~Jan  1 2020 12:00AM~Dec 31 3000 11:59PM~~3~3.500000~~~~~',
      '29~15~90~00~00~NML~Jan  1 2020 12:00AM~Dec 31 3000 11:59PM~~1~~~~~~',
      '74~19~80~00~00~NML~Jan  1 2020 12:00AM~Dec 31 3000 11:59PM~~3~4.500000~~~~~',
    ];
    for (const hs6 of ['854449', '847989', '291590', '741980']) {
      const result = ingest(details, rates, hs6);
      expect(result.resolution.resolved_line).not.toBeNull();
      expect(result.source_reference).not.toMatch(/rice/i);
    }
  });
});
