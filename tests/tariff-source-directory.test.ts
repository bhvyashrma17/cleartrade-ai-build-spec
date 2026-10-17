import { describe, expect, test } from 'vitest';
import { CONFIG_DEFAULTS } from '@/lib/config';
import { comtradeReporterRegistry } from '@/lib/comtrade/reporter-registry';
import { buildCountryScreeningUniverse } from '@/lib/country-screening/universe';
import { DEMAND_DISCOVERY_V5_DEFAULT_POLICY as POLICY } from '@/lib/demand-discovery-v5/policy';
import { DESTINATION_ADAPTERS } from '@/lib/job-handlers/market-access';
import {
  CUSTOMS_UNION_TARIFFS, TARIFF_SOURCE_DIRECTORY, customsUnionFor, manualTariffCheckFor, officialTariffSourceFor,
} from '@/lib/market-access/tariff-source-directory';
import { unconfiguredSourceForCountry } from '@/lib/market-access/unconfigured-sources';

/** D-024: every market Demand Discovery screens has a known place its official tariff comes from. */
function screeningUniverse(): string[] {
  const policy = CONFIG_DEFAULTS['country_screening.policy'];
  return buildCountryScreeningUniverse({
    universe_version: policy.universe_version, reporter_identity_strategy: policy.reporter_identity_strategy,
    reporter_registry_version: policy.reporter_registry_version, excluded_iso2_codes: policy.excluded_iso2_codes,
    exclude_origin_country: policy.exclude_origin_country, origin_country_iso2: policy.origin_country_iso2,
    registry: comtradeReporterRegistry(),
  }).entries.map((entry) => entry.iso2);
}

describe('tariff source directory', () => {
  test('every screened market resolves to a connected adapter, a researched determination or a directory entry', () => {
    const universe = screeningUniverse();
    expect(universe).toHaveLength(218);
    const kinds = new Map<string, number>();
    const missing: string[] = [];
    for (const code of universe) {
      const source = officialTariffSourceFor(code);
      kinds.set(source.kind, (kinds.get(source.kind) ?? 0) + 1);
      if (source.kind === 'none') missing.push(code);
    }
    expect(missing).toEqual([]);
    expect(Object.fromEntries(kinds)).toEqual({ connected: 56, documented: 62, directory: 100 });
  });

  test('a directory entry never shadows a connected adapter or a researched determination, except Andorra outside its customs union', () => {
    for (const code of Object.keys(TARIFF_SOURCE_DIRECTORY)) {
      expect(unconfiguredSourceForCountry(code), code).toBeNull();
      if (code !== 'AD') expect(DESTINATION_ADAPTERS[code], code).toBeUndefined();
    }
  });

  test('a source is an https address, or none with the form saying so', () => {
    for (const entry of Object.values(TARIFF_SOURCE_DIRECTORY)) {
      expect(entry.source_url === null, entry.country_code).toBe(entry.form === 'not_found');
      if (entry.source_url) expect(entry.source_url, entry.country_code).toMatch(/^https:\/\//);
      expect(entry.authority.length, entry.country_code).toBeGreaterThan(3);
      expect(entry.note.length, entry.country_code).toBeGreaterThan(10);
    }
    for (const union of Object.values(CUSTOMS_UNION_TARIFFS)) if (union.source_url) expect(union.source_url).toMatch(/^https:\/\//);
  });

  test("every market v5 scores by rule has the rule's own source here or a researched determination", () => {
    for (const [market, rule] of Object.entries(POLICY.rule_rates)) {
      const source = officialTariffSourceFor(market);
      if (source.kind === 'directory') {
        expect(source.form, market).toBe('rule');
        expect(source.source_url, market).toBe(rule.source_url);
      } else {
        expect(source.kind, market).toBe('documented');
      }
    }
  });

  test('customs unions: the UEMOA edition is part of ECOWAS, and a member resolves to its narrowest union', () => {
    const ecowas = CUSTOMS_UNION_TARIFFS.ECOWAS!.members;
    expect(CUSTOMS_UNION_TARIFFS.UEMOA!.members.every((code) => ecowas.includes(code))).toBe(true);
    expect(customsUnionFor('SN')?.key).toBe('UEMOA');
    expect(customsUnionFor('NG')?.key).toBe('ECOWAS');
    expect(customsUnionFor('KZ')?.key).toBe('EAEU');
    expect(customsUnionFor('IN')).toBeNull();
  });

  test('where an agent checks a duty by hand: nowhere for a connected market, the source otherwise', () => {
    expect(manualTariffCheckFor('DE')).toBeNull();
    expect(manualTariffCheckFor('KE')).toMatchObject({ authority: expect.stringContaining('Kenya Revenue Authority'), source_url: expect.stringMatching(/^https:\/\//) });
    expect(manualTariffCheckFor('MM')).toMatchObject({ source_url: expect.stringContaining('mopf.gov.mm') });
    // Andorra: the EU tariff covers brassware (chapter 74), not rice (chapter 10).
    expect(manualTariffCheckFor('AD', '741810')).toBeNull();
    expect(manualTariffCheckFor('AD', '100630')).toMatchObject({ authority: expect.stringContaining('Andorra') });
  });
});
