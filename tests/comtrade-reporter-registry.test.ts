import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { getNumericCodes } from 'i18n-iso-countries';
import { describe, expect, test } from 'vitest';
import { COMTRADE_LEGACY_AREA_TO_ISO2, toIso2 } from '../src/lib/comtrade/areas';
import { COMTRADE_REPORTER_REFERENCE_SOURCE, COMTRADE_REPORTER_REGISTRY_VERSION, comtradeReporterRegistry, reporterAliasesForIso2, reporterForIso2 } from '../src/lib/comtrade/reporter-registry';

const SNAPSHOT = 'src/lib/comtrade/reference/comtrade-reporters.json';

describe('the checked-in reporter reference is provable provider metadata', () => {
  test('matches the checksum recorded when it was captured', async () => {
    const bytes = await readFile(SNAPSHOT);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(COMTRADE_REPORTER_REFERENCE_SOURCE.response_checksum);
    expect(COMTRADE_REPORTER_REFERENCE_SOURCE.url).toBe('https://comtradeapi.un.org/files/v1/app/reference/Reporters.json');
    // Reference metadata only. This file carries no trade observation and cost no quota.
    expect(COMTRADE_REPORTER_REFERENCE_SOURCE.consumes_trade_data_quota).toBe(false);
    expect(JSON.parse(bytes.toString('utf8')).results.length).toBe(comtradeReporterRegistry().source.row_count);
  });

  test('is derived deterministically and identifies itself', () => {
    const first = comtradeReporterRegistry(), second = comtradeReporterRegistry();
    expect(second.checksum).toBe(first.checksum);
    expect(second.reporters).toEqual(first.reporters);
    expect(first.version).toBe(COMTRADE_REPORTER_REGISTRY_VERSION);
    expect(first.reporters.map(row => Number(row.reporter_code))).toEqual([...first.reporters.map(row => Number(row.reporter_code))].sort((a, b) => a - b));
  });
});

describe('provider reporter identity is not the ISO numeric, and not the alias map', () => {
  test('resolves the five countries whose reporter code diverges from M49', () => {
    // Verified against the provider's own reference, not inferred from any repository map.
    expect(reporterForIso2('FR')).toMatchObject({ reporter_code: '251', iso3: 'FRA', reporter_note: 'France, Monaco' });
    expect(reporterForIso2('NO')).toMatchObject({ reporter_code: '579', reporter_note: 'Norway, Svalbard and Jan Mayen' });
    expect(reporterForIso2('CH')).toMatchObject({ reporter_code: '757', reporter_note: 'Switzerland, Liechtenstein' });
    expect(reporterForIso2('US')).toMatchObject({ reporter_code: '842', iso3: 'USA', reporter_note: 'USA, Puerto Rico and US Virgin Islands' });
    expect(reporterForIso2('IN')).toMatchObject({ reporter_code: '699' });
  });

  test('reports Italy as 380 — the alias map’s 381 is not a reporter at all', () => {
    // This is the defect the registry exists to remove. Inverting COMTRADE_LEGACY_AREA_TO_ISO2
    // produced 381, which UN Comtrade lists in neither its reporter nor its partner reference,
    // so Italy would have screened as `unavailable` with no error raised anywhere.
    expect(reporterForIso2('IT')).toMatchObject({ reporter_code: '380', iso3: 'ITA' });
    expect(COMTRADE_LEGACY_AREA_TO_ISO2['381']).toBe('IT');
    expect(comtradeReporterRegistry().reporters.some(row => row.reporter_code === '381')).toBe(false);
    expect(comtradeReporterRegistry().anomalies).toContainEqual(expect.objectContaining({ reporter_code: '381', reason: 'compatibility_alias_not_in_provider_reference' }));
    // The alias must keep working for PARSING area codes already sitting in stored evidence.
    expect(toIso2('381')).toBe('IT');
    expect(reporterAliasesForIso2('IT')).toContain('381');
  });

  test('agrees with the ISO numeric everywhere else', () => {
    const diverging = comtradeReporterRegistry().reporters.filter(row => {
      const isoNumeric = Object.entries(getNumericCodes()).find(([, iso2]) => iso2 === row.iso2)?.[0];
      return isoNumeric != null && Number(isoNumeric) !== Number(row.reporter_code);
    });
    expect(diverging.map(row => `${row.iso2}:${row.reporter_code}`).sort()).toEqual(['CH:757', 'FR:251', 'IN:699', 'NO:579', 'US:842']);
  });
});

describe('the registry classifies every non-canonical row instead of dropping it', () => {
  test('keeps aggregates out of the canonical set and records them as aggregates', () => {
    const registry = comtradeReporterRegistry();
    const aggregates = registry.aliases.filter(row => row.reason === 'aggregate_group');
    expect(aggregates.map(row => row.reporter_code).sort((a, b) => Number(a) - Number(b))).toEqual(['97', '490', '975']);
    // "Other Asia, nes" and the EU are aggregates, never screening markets.
    for (const code of ['97', '490', '975']) expect(registry.reporters.some(row => row.reporter_code === code)).toBe(false);
  });

  test('keeps obsolete historical reporters out of the canonical set', () => {
    const registry = comtradeReporterRegistry();
    const expired = registry.aliases.filter(row => row.reason === 'expired_reporter');
    expect(expired.length).toBeGreaterThan(25);
    expect(expired.every(row => row.expired_on != null)).toBe(true);
    // India's pre-1975 identity is an alias; the live identity is 699.
    expect(expired.map(row => row.reporter_code)).toEqual(expect.arrayContaining(['356', '810', '890', '841', '850']));
    expect(registry.reporters.some(row => row.reporter_code === '356')).toBe(false);
    expect(reporterAliasesForIso2('IN')).toContain('356');
  });

  test('holds exactly one live reporter per country and none that fail ISO round-trip', () => {
    const registry = comtradeReporterRegistry();
    expect(new Set(registry.reporters.map(row => row.iso2)).size).toBe(registry.reporters.length);
    expect(new Set(registry.reporters.map(row => row.reporter_code)).size).toBe(registry.reporters.length);
    // Every reporter must map back to its own country through the same helper the deep Country
    // Truth job validates candidates with, or the deep pipeline would reject its own evidence.
    for (const row of registry.reporters) expect(toIso2(row.reporter_code), row.iso2).toBe(row.iso2);
    expect(registry.anomalies.some(row => row.reason === 'duplicate_iso_country_identity')).toBe(false);
    expect(registry.anomalies.some(row => row.reason === 'iso_mapping_conflict')).toBe(false);
  });

  test('covers the world without becoming a curated favourites list', () => {
    const registry = comtradeReporterRegistry();
    expect(registry.reporters.length).toBe(219);
    for (const iso2 of ['DE', 'US', 'AE', 'CN', 'JP', 'GB', 'FR', 'IT', 'BR', 'ZA', 'SG', 'HK', 'VN', 'MX', 'NG', 'KE']) expect(reporterForIso2(iso2), iso2).not.toBeNull();
    // Separately reporting territories belong in the set; unrepresented ones are simply absent.
    expect(reporterForIso2('HK')).toMatchObject({ reporter_code: '344' });
    expect(reporterForIso2('TW')).toBeNull();
    expect(reporterForIso2('PR')).toBeNull();
  });
});

describe('the registry agrees with the reporter identities already in production use', () => {
  test('the Agent pilot selector maps Germany, UAE and the USA to registry reporters', async () => {
    const { mapCountryTruthCandidates } = await import('../src/lib/country-truth-discovery-request');
    // The pilot alias table predates the registry and is hardcoded for the Agent UI. It is not
    // changed here, but it must never disagree with the provider reference — a disagreement
    // would send screening and deep acquisition to two different reporters for one country.
    for (const candidate of mapCountryTruthCandidates(['Germany', 'UAE', 'USA'])) {
      expect(reporterForIso2(candidate.country_code), candidate.country_code).toMatchObject({ reporter_code: candidate.reporter_code });
    }
  });

  test('India, the origin reporter constant, is the registry live India identity', async () => {
    const { INDIA_REPORTER } = await import('../src/lib/comtrade/areas');
    expect(reporterForIso2('IN')).toMatchObject({ reporter_code: INDIA_REPORTER });
  });
});
