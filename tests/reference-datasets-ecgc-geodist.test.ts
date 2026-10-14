import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EvidenceOrigin, OrgTier, ReferenceDatasetReleaseStatus, UserRole } from '@prisma/client';
import { comtradeReporterRegistry } from '../src/lib/comtrade/reporter-registry';
import { CONFIG_DEFAULTS } from '../src/lib/config';
import { buildCountryScreeningUniverse } from '../src/lib/country-screening/universe';
import { coordinateInputs, ecgcInputs } from '../src/lib/demand-discovery-v5/reference-inputs';
import { prisma } from '../src/lib/prisma';
import { ecgcRatingRowSchema, parseEcgcCountryRiskText } from '../src/lib/reference-datasets/ecgc';
import { parseGeoCepiiCsv, type CapitalRow } from '../src/lib/reference-datasets/geodist';
import { manifestEntryFor, readReferenceManifest, verifyReferenceFiles } from '../src/lib/reference-datasets/manifest';
import { ECGC_COUNTRY_RISK_KEY, GEO_CEPII_KEY, referenceDatasetDefinition } from '../src/lib/reference-datasets/registry';
import { activeReferenceRows, importReferenceDataset } from '../src/lib/reference-datasets/service';
import type { Principal } from '../src/types';

/**
 * ECGC's short-term country risk list and CEPII's GeoDist capitals: the parsers on synthetic text
 * in the publishers' layouts (edge cases), then on the real files checked into data/reference/.
 */

// --- ECGC: a two-page list in the circular's layout, as `pdftotext -layout` writes it ---------
const ecgcPage = (page: number, of: number, body: string, date = 'July 01, 2026') => [
  '                                              देश जोखिम वर्गीकरण',
  '                                               ECGC Limited',
  '',
  '                          01 जुलाई 2026 से प्रभावी देश जोखिम वर्गीकरण सूची',
  `                Country Risk Classification List with effect from ${date}`,
  '',
  '                                          (अल्पावधि / Short-Term)',
  '',
  body,
  '',
  `                                                                                     Page ${page} of ${of}`,
].join('\n');
const OPEN = [
  '                                         Countries in Open Cover',
  '        Note: The country mentioned in the bracket represents the parent country',
  'Sr.                                                                                       ST',
  '                                             Country Name',
  'No.                                                                                      Rating',
  ' 1    अल्बानिया        / Albania                                                          A2',
  '2     अमेरिकी समोआ (सं.रा.अ.)               / American Samoa (USA)                          A1',
  '      बोनेयर, सेंट यूस्टेशियस और सबा (नीदरलैंड) / Bonaire, St. Eustatius and',
  '3                                                                                         A1',
  '      Saba (Netherlands)',
  '4     कैनरी द्वीप (स्पेन)         / Canary Islands (Spain)                             A2',
  '5     चैनल द्वीप (यूके) / Channel Isles (UK)                                             A1',
  '6     स्पेन    / Spain                                                                    A2',
].join('\n');
const RESTRICTED = [
  "  Countries in 'Restricted Cover - Group I' for which revolving limits are approved normally",
  '                                             valid for a year',
  ' Sr. No.                                    Country Name                           ST Rating',
  '    1        अर्जेंटीना     / Argentina                                                  C1',
  '',
  "Countries in 'Restricted Cover – Group II' where Specific Approval will be given on a case-to-",
  ' Sl. No.                                    Country Name                                          ST Rating',
  '    1         ईरान        / Iran*                                                                     C2',
  '* USD-denominated exports to Iran or the transactions involving persons, entity of USA or transactions routed',
  'through USA Financial Systems will not be covered.',
  '',
  '                                  Off-Cover Countries',
  'Sl. No.                         Country Name                             ST Rating',
  '       1 पाकिस्तान / Pakistan                                                  C2',
  '',
  'ST cover stands withdrawn effective from 12.05.2025',
  '                           Country Classification Legend',
  '                           A1                         Insignificant',
  '                           D                      Very High Risk',
].join('\n');
const ecgcText = (open = OPEN, restricted = RESTRICTED) => Buffer.from(`${ecgcPage(1, 2, open)}\n\f${ecgcPage(2, 2, restricted)}\n`);

describe('ECGC short-term list parser', () => {
  test('reads every table, wrapped names, footnotes and table notes, and maps names to ISO', () => {
    const parsed = parseEcgcCountryRiskText(ecgcText());
    expect(parsed).toMatchObject({ effective_from: '2026-07-01', pages: 2, published_rows: 9, sections: { open: 6, restricted_group_i: 1, restricted_group_ii: 1, off_cover: 1 } });
    expect(parsed.rows.map((row) => [row.iso2, row.grade, row.cover, row.serial])).toEqual([
      ['AL', 'A2', 'open', 1], ['AR', 'C1', 'restricted_group_i', 1], ['AS', 'A1', 'open', 2], ['BQ', 'A1', 'open', 3], ['ES', 'A2', 'open', 6],
      ['GG', 'A1', 'open', 5], ['IR', 'C2', 'restricted_group_ii', 1], ['JE', 'A1', 'open', 5], ['PK', 'C2', 'off_cover', 1],
    ]);
    const by = new Map(parsed.rows.map((row) => [row.iso2, row]));
    expect(by.get('BQ')!.published_name).toBe('Bonaire, St. Eustatius and Saba (Netherlands)');
    expect(by.get('IR')).toMatchObject({ published_name: 'Iran*', note: expect.stringMatching(/^USD-denominated exports to Iran .* will not be covered\.$/) });
    expect(by.get('PK')!.note).toBe('ST cover stands withdrawn effective from 12.05.2025');
    expect(by.get('ES')!.note).toBeNull();
    expect(parsed.excluded).toEqual([{ published_name: 'Canary Islands (Spain)', reason: expect.stringMatching(/Spain \(ES\) has its own row/) }]);
    expect(parsed.several).toEqual([{ published_name: 'Channel Isles (UK)', iso2: ['GG', 'JE'] }]);
    expect(parsed.rows.every((row) => ecgcRatingRowSchema.safeParse(row).success)).toBe(true);
  });

  test('fails closed on an incomplete or inconsistent text', () => {
    const swap = (from: string, to: string, part: 'open' | 'restricted' = 'open') => ecgcText(part === 'open' ? OPEN.replace(from, to) : OPEN, part === 'restricted' ? RESTRICTED.replace(from, to) : RESTRICTED);
    expect(() => parseEcgcCountryRiskText(Buffer.from(ecgcPage(1, 2, OPEN)))).toThrow(/page footers .* incomplete/);
    expect(() => parseEcgcCountryRiskText(Buffer.from(`${ecgcPage(1, 2, OPEN)}\n${ecgcPage(2, 2, RESTRICTED, 'January 01, 2026')}`))).toThrow(/disagree on the effective date/);
    expect(() => parseEcgcCountryRiskText(swap('6     स्पेन', '7     स्पेन'))).toThrow(/"open" table skips or repeats a serial: expected 6, found 7/);
    expect(() => parseEcgcCountryRiskText(swap('/ Spain                                                                    A2', '/ Spain                                                                    A3'))).toThrow(/looks like a table row but was not read/);
    expect(() => parseEcgcCountryRiskText(swap('/ Spain', '/ Atlantis'))).toThrow(/No ISO 3166-1 identity for "Atlantis" \(open 6\)/);
    expect(() => parseEcgcCountryRiskText(swap('/ Albania', '/ Spain'))).toThrow(/both map to ES/);
    expect(() => parseEcgcCountryRiskText(swap('* USD-denominated', 'USD-denominated', 'restricted'))).toThrow(/carry "\*" but the list has no footnote/);
    expect(() => parseEcgcCountryRiskText(swap('      बोनेयर, सेंट यूस्टेशियस और सबा (नीदरलैंड) / Bonaire, St. Eustatius and\n', ''))).toThrow(/serial 3 has a grade but no name/);
    expect(() => parseEcgcCountryRiskText(Buffer.from('ECGC Limited\nPage 1 of 1\n'))).toThrow(/not the ECGC short-term list/);
  });
});

// --- GeoDist: the real header, a few rows in the table's shape --------------------------------
const GEO_HEADER = 'iso2,iso3,cnum,country,pays,area,dis_int,landlocked,continent,city_en,city_fr,lat,lon,cap,maincity,citynum,langoff_1,langoff_2,langoff_3,lang20_1,lang20_2,lang20_3,lang20_4,lang9_1,lang9_2,lang9_3,lang9_4,colonizer1,colonizer2,colonizer3,colonizer4,short_colonizer1,short_colonizer2,short_colonizer3';
const geoRow = (iso2: string, iso3: string, cnum: number, country: string, city: string, lat: number, lon: number, cap: number) => `${iso2},${iso3},${cnum},${country},${country},100,1.0,0.0,Asia,${city},${city},${lat},${lon},${cap},1,25.0${','.repeat(18)}`;
const GEO_ROWS = [
  geoRow('AD', 'AND', 20, 'Andorra', 'Andorra la Vella', 42.5, 1.5, 1),
  geoRow('NA', 'NAM', 516, 'Namibia', 'Windhoek', -22.566668, 17.1, 1),
  geoRow('TW', 'TWN', 490, 'Taiwan', 'Taipei', 25.083334, 121.53333, 1),
  geoRow('US', 'USA', 842, 'United States of America', 'New York', 40.75, -74, 0),
  geoRow('US', 'USA', 842, 'United States of America', '"Washington, DC"', 38.867, -77, 1),
  geoRow('ZR', 'ZAR', 180, 'Congo (Democratic Republic of the)', 'Kinshasa', -4.3, 15.3, 1),
];
const geoCsv = (rows = GEO_ROWS) => Buffer.from(`${GEO_HEADER}\n${rows.join('\n')}\n`);

describe('CEPII GeoDist parser', () => {
  test('keeps one capital per country, reads "NA" as Namibia and maps withdrawn codes to the successor with the same capital', () => {
    const parsed = parseGeoCepiiCsv(geoCsv());
    expect(parsed.rows.map((row) => [row.iso2, row.city, row.lat, row.lon])).toEqual([
      ['AD', 'Andorra la Vella', 42.5, 1.5], ['CD', 'Kinshasa', -4.3, 15.3], ['NA', 'Windhoek', -22.566668, 17.1], ['TW', 'Taipei', 25.083334, 121.53333], ['US', 'Washington, DC', 38.867, -77],
    ]);
    expect(parsed.rows.find((row) => row.iso2 === 'CD')).toMatchObject({ published_iso2: 'ZR', published_iso3: 'ZAR', cnum: '180' });
    expect(parsed.successors).toEqual([{ published_iso2: 'ZR', iso2: 'CD', city: 'Kinshasa', transition: expect.stringMatching(/^ZRCD/) }]);
    expect(parsed.rows_read).toBe(6);
  });

  test('refuses a withdrawn code without a successor, a successor with another capital, two or no capitals and contradicting codes', () => {
    expect(() => parseGeoCepiiCsv(geoCsv([...GEO_ROWS, geoRow('SU', 'SUN', 810, 'USSR', 'Moscow', 55.75, 37.6, 1)]))).toThrow(/SU is not a current ISO 3166-1 code and has no successor/);
    expect(() => parseGeoCepiiCsv(geoCsv([geoRow('ZR', 'ZAR', 180, 'Zaire', 'Lubumbashi', -11.66, 27.48, 1)]))).toThrow(/successor mapping does not hold/);
    expect(() => parseGeoCepiiCsv(geoCsv([...GEO_ROWS, geoRow('AD', 'AND', 20, 'Andorra', 'Encamp', 42.53, 1.58, 1)]))).toThrow(/AND has a second capital row/);
    expect(() => parseGeoCepiiCsv(geoCsv([...GEO_ROWS, geoRow('FR', 'FRA', 251, 'France', 'Lyon', 45.76, 4.84, 0)]))).toThrow(/No capital row for FRA/);
    expect(() => parseGeoCepiiCsv(geoCsv([geoRow('FR', 'DEU', 276, 'France', 'Paris', 48.87, 2.33, 1)]))).toThrow(/FR and alpha-3 DEU name different countries/);
    expect(() => parseGeoCepiiCsv(Buffer.from('iso2,iso3,country\nAD,AND,Andorra\n'))).toThrow(/lacks cnum, city_en, lat, lon, cap/);
  });
});

describe('ECGC ratings and coordinates in the engine', () => {
  const capital = (iso2: string, cnum: string, city: string, lat: number, lon: number): CapitalRow => ({ iso2, published_iso2: iso2, published_iso3: 'XXX', cnum, country: iso2, city, lat, lon });

  test('places BACI 490 at Taipei only when GeoDist numbers Taiwan 490 too; other provider codes stay off the map', () => {
    const placed = coordinateInputs({ capitals: [capital('TW', '490', 'Taipei', 25.08, 121.53), capital('IN', '699', 'New Delhi', 28.62, 77.22)], provider_codes_without_iso: ['697', '490', '711'] });
    expect(placed.map.get('cepii_baci:490')).toEqual({ lat: 25.08, lon: 121.53 });
    expect(placed.map.get('IN')).toEqual({ lat: 28.62, lon: 77.22 });
    expect(placed.provider_links).toEqual([{ identity: 'cepii_baci:490', iso2: 'TW', city: 'Taipei' }]);
    expect(placed.unplaced_provider_codes).toEqual(['697', '711']);
    const disagreeing = coordinateInputs({ capitals: [capital('TW', '158', 'Taipei', 25.08, 121.53)], provider_codes_without_iso: ['490'] });
    expect(disagreeing.map.has('cepii_baci:490')).toBe(false);
    expect(disagreeing.unplaced_provider_codes).toEqual(['490']);
  });

  test('ECGC rows become grade and cover by ISO code', () => {
    const rows = parseEcgcCountryRiskText(ecgcText()).rows;
    expect(ecgcInputs(rows).get('PK')).toEqual({ grade: 'C2', cover: 'off_cover' });
    expect(ecgcInputs(rows).get('AR')).toEqual({ grade: 'C1', cover: 'restricted_group_i' });
  });
});

// --- the real files -----------------------------------------------------------------------------
const real = (file: string) => readFileSync(resolve('data/reference', file));
const universeMarkets = () => {
  const screening = CONFIG_DEFAULTS['country_screening.policy'];
  return buildCountryScreeningUniverse({
    universe_version: screening.universe_version, reporter_identity_strategy: screening.reporter_identity_strategy, reporter_registry_version: screening.reporter_registry_version,
    excluded_iso2_codes: screening.excluded_iso2_codes, exclude_origin_country: screening.exclude_origin_country, origin_country_iso2: screening.origin_country_iso2, registry: comtradeReporterRegistry(),
  }).entries.map((entry) => entry.iso2);
};

describe('the reference files checked into data/reference', () => {
  test('every file the manifest lists is present, unchanged, parses, and states its original exactly when it is derived', () => {
    const manifest = readReferenceManifest();
    expect(verifyReferenceFiles(manifest)).toEqual([]);
    for (const entry of manifest.files) {
      const definition = referenceDatasetDefinition(entry.dataset_key);
      expect(entry.derived_from !== null, entry.file).toBe(definition.source_form === 'derived_from_publisher_file');
      expect(definition.parse(real(entry.file)).rows.length, entry.file).toBeGreaterThan(0);
    }
  });

  test('the ECGC list of 1 July 2026: 239 published rows, 239 ISO rows, and every one of the 218 markets rated except Saint Barthélemy', () => {
    const parsed = parseEcgcCountryRiskText(real('ecgc-country-risk-st-2026-07-01.txt'));
    expect(parsed).toMatchObject({ effective_from: '2026-07-01', pages: 12, published_rows: 239, sections: { open: 185, restricted_group_i: 29, restricted_group_ii: 24, off_cover: 1 } });
    expect(parsed.rows.map((row) => row.iso2).join(' ')).toBe(
      'AD AE AF AG AI AL AM AO AR AS AT AU AW AZ BA BB BD BE BF BG BH BI BJ BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HM HN HR HT HU ID IE IL IN IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW',
    );
    const by = new Map(parsed.rows.map((row) => [row.iso2, row]));
    expect(by.get('US')).toMatchObject({ grade: 'A1', cover: 'open', published_name: 'United States of America' });
    expect(by.get('NA')).toMatchObject({ grade: 'B1', cover: 'open' });
    expect(by.get('RU')).toMatchObject({ grade: 'B2', cover: 'restricted_group_i' });
    expect(by.get('IR')).toMatchObject({ grade: 'C2', cover: 'restricted_group_ii', note: expect.stringMatching(/USD-denominated exports to Iran/) });
    expect(by.get('PK')).toMatchObject({ grade: 'C2', cover: 'off_cover', note: 'ST cover stands withdrawn effective from 12.05.2025' });
    expect(by.get('HK')!.published_name).toBe('Hong Kong (Sp. Ad. Region of China)');
    expect(by.get('TK')!.published_name).toBe('Tokealu (New Zealand)');
    expect(parsed.excluded.map((item) => item.published_name)).toEqual(['Canary Islands (Spain)']);
    expect(universeMarkets().filter((market) => !by.has(market))).toEqual(['BL']);
  });

  test('GeoDist: 225 capitals, four withdrawn codes mapped by their capital, and six of the 218 markets without coordinates', () => {
    const parsed = parseGeoCepiiCsv(real('geo_cepii.csv'));
    expect(parsed.rows).toHaveLength(225);
    expect(parsed.rows_read).toBe(238);
    expect(parsed.successors.map((item) => `${item.published_iso2}>${item.iso2}:${item.city}`)).toEqual(['ZR>CD:Kinshasa', 'AN>CW:Willemstad', 'YU>RS:Belgrade', 'TP>TL:Dili']);
    const by = new Map(parsed.rows.map((row) => [row.iso2, row]));
    expect(by.get('TW')).toMatchObject({ cnum: '490', city: 'Taipei' });
    expect(by.get('IN')).toMatchObject({ cnum: '699', city: 'New Delhi' });
    expect(by.get('US')!.city).toBe('Washington, DC');
    expect(by.get('ZA')!.city).toBe('Pretoria');
    expect(by.get('NA')!.city).toBe('Windhoek');
    expect(universeMarkets().filter((market) => !by.has(market)).sort()).toEqual(['BL', 'BQ', 'ME', 'SS', 'SX', 'VA']);
  });
});

describe('importing derived reference files', () => {
  let actor: Principal;
  beforeAll(async () => {
    const id = `refderived-${randomUUID()}`;
    await prisma.user.create({ data: { id, email: `${id}@test.local`, name: 'Reference Operator', role: UserRole.admin } });
    actor = { id, email: `${id}@test.local`, name: 'Reference Operator', role: UserRole.admin, exporter_org_id: null, tier: OrgTier.paid };
  });
  afterAll(async () => {
    await prisma.referenceDatasetRelease.updateMany({ where: { imported_by_id: actor.id, status: ReferenceDatasetReleaseStatus.active }, data: { status: ReferenceDatasetReleaseStatus.superseded, superseded_at: new Date() } });
    await prisma.$disconnect();
  });

  test('a derived file needs its original; the original is stored with the release and must not change on a repeat', async () => {
    const file = real('ecgc-country-risk-st-2026-07-01.txt');
    const entry = manifestEntryFor(readReferenceManifest(), file)!;
    expect(entry.dataset_key).toBe(ECGC_COUNTRY_RISK_KEY);
    // A suffix the parser ignores makes these bytes this suite's own in the shared schema, where
    // another suite may already have imported, and superseded, the file itself.
    const bytes = Buffer.concat([file, Buffer.from(`\nsuite ${randomUUID()}\n`)]);
    const args = { actor, dataset_key: ECGC_COUNTRY_RISK_KEY, bytes, source_url: entry.derived_from!.url, retrieved_at: new Date('2026-10-13T00:00:00Z'), correlation_id: randomUUID(), evidence_origin: EvidenceOrigin.fixture };
    await expect(importReferenceDataset(args)).rejects.toThrow(/state that original file/);
    await expect(importReferenceDataset({ ...args, derived_from: { ...entry.derived_from!, sha256: 'not-a-hash' } })).rejects.toThrow(/state that original file/);

    const first = await importReferenceDataset({ ...args, derived_from: entry.derived_from });
    expect(first).toMatchObject({ change: 'NEW', row_count: 239, version: 'ECGC short-term list w.e.f. 2026-07-01' });
    const release = await prisma.referenceDatasetRelease.findUniqueOrThrow({ where: { id: first.release_id } });
    expect(release.validation).toMatchObject({ source_form: 'derived_from_publisher_file', derived_from: { sha256: '7635fdc64bc07c1127c89c57d8d8b5e0505a9efa8d16d2096cb25ffc1439ac62' }, effective_from: '2026-07-01', iso_rows: 239 });
    expect(await importReferenceDataset({ ...args, derived_from: entry.derived_from })).toMatchObject({ change: 'UNCHANGED', release_id: first.release_id });
    await expect(importReferenceDataset({ ...args, derived_from: { ...entry.derived_from!, sha256: 'f'.repeat(64) } })).rejects.toThrow(/cannot come from two different originals/);

    const active = await activeReferenceRows(ECGC_COUNTRY_RISK_KEY, ecgcRatingRowSchema);
    expect(active?.rows.find((row) => row.iso2 === 'PK')).toMatchObject({ cover: 'off_cover' });
  });

  test('a publisher file or curated list refuses a derived-from source', async () => {
    const geo = real('geo_cepii.csv');
    const entry = manifestEntryFor(readReferenceManifest(), geo)!;
    expect(entry.dataset_key).toBe(GEO_CEPII_KEY);
    await expect(importReferenceDataset({
      actor, dataset_key: 'india:trade-agreements', bytes: real('india-trade-agreements-v1.json'), source_url: 'https://github.com/bhvyashrma17/cleartrade-ai-build-spec',
      retrieved_at: new Date('2026-10-13T00:00:00Z'), correlation_id: randomUUID(), evidence_origin: EvidenceOrigin.fixture, derived_from: entry.derived_from,
    })).rejects.toThrow(/curated file; it has no derived-from source/);
  });
});
