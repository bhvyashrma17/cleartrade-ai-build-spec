import { getNumericCodes } from 'i18n-iso-countries';
import { describe, expect, test } from 'vitest';
import { CONFIG_DEFAULTS, type CountryScreeningPolicy } from '../src/lib/config';
import { toIso2, WORLD_PARTNER } from '../src/lib/comtrade/areas';
import { comtradeReporterRegistry } from '../src/lib/comtrade/reporter-registry';
import { buildCountryScreeningUniverse, COUNTRY_SCREENING_UNIVERSE_VERSION } from '../src/lib/country-screening/universe';
import { buildCountryScreeningPlan, selectScreeningPeriod } from '../src/lib/country-screening/planner';
import { COUNTRY_SCREENING_ALGORITHM_VERSION, rankScreeningCandidates, screeningScore, shortlistSize } from '../src/lib/country-screening/ranking';

const POLICY = CONFIG_DEFAULTS['country_screening.policy'];
const universeInput = (overrides: Partial<Parameters<typeof buildCountryScreeningUniverse>[0]> = {}) => ({
  universe_version: POLICY.universe_version,
  reporter_identity_strategy: POLICY.reporter_identity_strategy,
  reporter_registry_version: POLICY.reporter_registry_version,
  excluded_iso2_codes: POLICY.excluded_iso2_codes,
  exclude_origin_country: POLICY.exclude_origin_country,
  origin_country_iso2: POLICY.origin_country_iso2,
  ...overrides,
});

describe('Country Screening Universe is derived, not curated', () => {
  test('is deterministic across builds, in content and in order', () => {
    const first = buildCountryScreeningUniverse(universeInput()), second = buildCountryScreeningUniverse(universeInput());
    expect(second.checksum).toBe(first.checksum);
    expect(second.entries).toEqual(first.entries);
    expect(first.entries.map(entry => Number(entry.reporter_code))).toEqual([...first.entries.map(entry => Number(entry.reporter_code))].sort((a, b) => a - b));
    expect(first.version).toBe(COUNTRY_SCREENING_UNIVERSE_VERSION);
  });

  test('spans the world rather than a shortlist of favourites', () => {
    const universe = buildCountryScreeningUniverse(universeInput());
    // Every ISO country/area minus the configured exclusions; nothing else is removed.
    expect(universe.size).toBe(Object.keys(getNumericCodes()).length - universe.exclusions.length);
    expect(universe.size).toBeGreaterThan(200);
    expect(universe.size).toBe(218);
  });

  test('is a set of screening markets, not a claim about sovereignty', () => {
    const universe = buildCountryScreeningUniverse(universeInput());
    // Separately reporting customs/economic territories are real export destinations and stay in.
    const byIso2 = new Map(universe.entries.map(entry => [entry.iso2, entry]));
    expect(byIso2.get('HK')).toMatchObject({ reporter_code: '344' });
    expect(byIso2.get('MO')).toBeDefined();
    // A market with no provider reporter is excluded EXPLICITLY, never left to look like a
    // market with no demand. Taiwan reports inside the "Other Asia, nes" aggregate; Puerto Rico
    // and Guam are inside USA 842; Liechtenstein is inside Switzerland 757.
    const reasons = new Map(universe.exclusions.map(row => [row.iso2, row.reason]));
    for (const iso2 of ['TW', 'PR', 'GU', 'LI', 'MC', 'RE', 'AX']) expect(reasons.get(iso2), iso2).toBe('no_provider_reporter_identity');
    expect(universe.exclusions.filter(row => row.reason === 'no_provider_reporter_identity')).toHaveLength(23);
  });

  test('accounts for every live reporter the universe did not claim', () => {
    const universe = buildCountryScreeningUniverse(universeInput());
    // 219 live reporters, minus India as the origin country, is the whole universe.
    expect(comtradeReporterRegistry().reporters).toHaveLength(universe.size + universe.unmatched_reporters.length);
    expect(universe.unmatched_reporters).toEqual([{ reporter_code: '699', iso2: 'IN', reason: 'excluded_by_policy' }]);
  });

  test('excludes World, aggregates, invalid identities and the origin country', () => {
    const universe = buildCountryScreeningUniverse(universeInput());
    const reporters = new Set(universe.entries.map(entry => entry.reporter_code));
    // World and every regional/economic/miscellaneous partner aggregate: excluded by
    // construction, because they have no ISO country identity to be derived from.
    expect(reporters.has(WORLD_PARTNER)).toBe(false);
    for (const aggregate of ['0', '1', '2', '9', '19', '142', '150', '899', '97']) expect(reporters.has(aggregate)).toBe(false);
    expect(universe.entries.every(entry => toIso2(entry.reporter_code) === entry.iso2)).toBe(true);
    // Explicit, reasoned exclusions only.
    const byIso2 = new Map(universe.exclusions.map(row => [row.iso2, row.reason]));
    expect(byIso2.get('AQ')).toBe('no_resident_population');
    expect(byIso2.get('XK')).toBe('not_un_m49_identity');
    expect(byIso2.get('IN')).toBe('origin_country');
    expect(reporters.has('699')).toBe(false);
    // No aggregate reporter can leak in through the provider reference either.
    for (const aggregate of ['97', '490', '975']) expect(reporters.has(aggregate), aggregate).toBe(false);
  });

  test('takes reporter identity from the provider reference, not from the alias map', () => {
    const byIso2 = new Map(buildCountryScreeningUniverse(universeInput()).entries.map(entry => [entry.iso2, entry]));
    expect(byIso2.get('DE')).toMatchObject({ reporter_code: '276', iso_numeric: '276', iso3: 'DEU', country_name: 'Germany' });
    expect(byIso2.get('AE')).toMatchObject({ reporter_code: '784', iso_numeric: '784', iso3: 'ARE' });
    // The USA reports under Comtrade's own area code, not ISO 840 — the identity the live
    // staging reconciliation actually succeeded with. ISO 840 stays visible as an alias.
    expect(byIso2.get('US')).toMatchObject({ reporter_code: '842', iso_numeric: '840', reporter_note: 'USA, Puerto Rico and US Virgin Islands' });
    expect(byIso2.get('US')!.provider_area_aliases).toEqual(expect.arrayContaining(['840', '841']));
    // Italy is 380. Inverting the repository alias map produced 381, which is not a reporter.
    expect(byIso2.get('IT')).toMatchObject({ reporter_code: '380', iso_numeric: '380' });
    expect(byIso2.get('IT')!.provider_area_aliases).toContain('381');
    expect(byIso2.get('FR')).toMatchObject({ reporter_code: '251', iso_numeric: '250' });
    for (const iso2 of ['CN', 'JP', 'GB', 'BR', 'ZA', 'SG', 'VN', 'MX', 'NG', 'KE']) expect(byIso2.get(iso2), iso2).toBeDefined();
  });

  test('never emits one country twice, whichever area code it reports under', () => {
    const universe = buildCountryScreeningUniverse(universeInput());
    expect(new Set(universe.entries.map(entry => entry.iso2)).size).toBe(universe.size);
    expect(new Set(universe.entries.map(entry => entry.reporter_code)).size).toBe(universe.size);
    // ISO 840/842 and 250/251 are the same country under two provider identities.
    expect(universe.entries.filter(entry => entry.iso2 === 'US')).toHaveLength(1);
    expect(universe.entries.filter(entry => entry.iso2 === 'FR')).toHaveLength(1);
  });

  test('origin exclusion, universe version and registry version are explicit inputs', () => {
    const withOrigin = buildCountryScreeningUniverse(universeInput({ exclude_origin_country: false }));
    expect(withOrigin.entries.some(entry => entry.reporter_code === '699')).toBe(true);
    expect(withOrigin.checksum).not.toBe(buildCountryScreeningUniverse(universeInput()).checksum);
    expect(() => buildCountryScreeningUniverse(universeInput({ universe_version: 'country-screening-universe-v9' }))).toThrow(/Unsupported country screening universe version/);
    expect(() => buildCountryScreeningUniverse(universeInput({ reporter_identity_strategy: 'made_up_v9' as 'comtrade_reporter_reference_v1' }))).toThrow(/Unsupported reporter identity strategy/);
    // A registry the policy did not pin cannot be silently substituted.
    expect(() => buildCountryScreeningUniverse(universeInput({ reporter_registry_version: 'comtrade-reporter-registry-v9' }))).toThrow(/expects reporter registry/);
  });

  test('a reporter identity change moves the universe checksum', () => {
    const registry = comtradeReporterRegistry();
    const moved = { ...registry, checksum: `${registry.checksum}-moved`, reporters: registry.reporters.map(row => row.iso2 === 'IT' ? { ...row, reporter_code: '381' } : row) };
    const before = buildCountryScreeningUniverse(universeInput());
    const after = buildCountryScreeningUniverse(universeInput({ registry: moved }));
    expect(after.checksum).not.toBe(before.checksum);
    expect(after.entries.find(entry => entry.iso2 === 'IT')).toMatchObject({ reporter_code: '381' });
  });
});

describe('screening rank is a market-size signal, ranked deterministically', () => {
  const candidate = (reporter_code: string, import_value: number) => ({ reporter_code, import_value });

  test('is monotone in import value and bounded by the policy band', () => {
    expect(screeningScore(POLICY.demand_signal.floor_usd, POLICY)).toBe(0);
    expect(screeningScore(POLICY.demand_signal.ceiling_usd, POLICY)).toBe(100);
    expect(screeningScore(1, POLICY)).toBe(0);
    expect(screeningScore(1e15, POLICY)).toBe(100);
    expect(screeningScore(1_000_000, POLICY)).toBeGreaterThan(screeningScore(100_001, POLICY));
    expect(screeningScore(1e9, POLICY)).toBeLessThan(screeningScore(1e10, POLICY));
  });

  test('ranks the same way regardless of input order', () => {
    const rows = [candidate('842', 5e9), candidate('276', 9e9), candidate('392', 1e8), candidate('784', 4e6)];
    const forward = rankScreeningCandidates(rows, POLICY).map(row => row.reporter_code);
    const reversed = rankScreeningCandidates([...rows].reverse(), POLICY).map(row => row.reporter_code);
    expect(forward).toEqual(['276', '842', '392', '784']);
    expect(reversed).toEqual(forward);
    expect(rankScreeningCandidates(rows, POLICY).map(row => row.screening_rank)).toEqual([1, 2, 3, 4]);
  });

  test('breaks exact ties on the reporter code, never on arrival order', () => {
    const tied = [candidate('842', 2_500_000), candidate('276', 2_500_000), candidate('4', 2_500_000)];
    for (const permutation of [tied, [...tied].reverse(), [tied[1], tied[2], tied[0]]]) {
      expect(rankScreeningCandidates(permutation, POLICY).map(row => row.reporter_code)).toEqual(['4', '276', '842']);
    }
  });

  test('refuses a duplicate candidate and an unrecognised formula identity', () => {
    expect(() => rankScreeningCandidates([candidate('276', 1e6), candidate('276', 2e6)], POLICY)).toThrow(/Duplicate screening candidate/);
    expect(() => rankScreeningCandidates([candidate('276', 1e6)], { ...POLICY, screening_algorithm_version: 'country-screening-rank-v9' })).toThrow(/Unsupported screening algorithm version/);
    expect(() => rankScreeningCandidates([candidate('276', 1e6)], { ...POLICY, tie_breaker: 'alphabetical' as CountryScreeningPolicy['tie_breaker'] })).toThrow(/Unsupported screening tie breaker/);
    expect(POLICY.screening_algorithm_version).toBe(COUNTRY_SCREENING_ALGORITHM_VERSION);
  });

  test('shortlists the policy target, or fewer when fewer markets qualify', () => {
    expect(shortlistSize(200, POLICY)).toBe(20);
    expect(shortlistSize(20, POLICY)).toBe(20);
    expect(shortlistSize(7, POLICY)).toBe(7);
    expect(shortlistSize(0, POLICY)).toBe(0);
    expect(shortlistSize(200, { ...POLICY, shortlist_target_size: 30, max_shortlist_size: 30 })).toBe(30);
    expect(() => shortlistSize(5, { ...POLICY, shortlist_target_size: 0 })).toThrow(/positive integer/);
    // A target above the configured hard maximum is a misconfiguration, not something to
    // silently clamp: a screen that would spend more deep quota than Ops allowed fails closed.
    expect(() => shortlistSize(200, { ...POLICY, shortlist_target_size: 35, max_shortlist_size: 30 })).toThrow(/no smaller than the target/);
  });
});

describe('the screening plan is frozen, cheap and Phase 1G ready', () => {
  const planInput = (overrides: Partial<Parameters<typeof buildCountryScreeningPlan>[0]> = {}) => ({
    product_classification_id: 'classification-1', hs_code: '090111', hs_revision: 'HS2022',
    as_of_date: new Date('2026-08-26T00:00:00Z'), source_mode: 'authenticated' as const,
    policy: POLICY, policy_config_version: 1, ...overrides,
  });

  test('plans exactly one World import request per country and nothing deeper', () => {
    const plan = buildCountryScreeningPlan(planInput());
    expect(plan.items).toHaveLength(plan.universe.size);
    expect(plan.items.every(item => item.partner_code === WORLD_PARTNER)).toBe(true);
    expect(new Set(plan.items.map(item => item.period))).toEqual(new Set([plan.screening_period]));
    expect(plan.items.every(item => item.estimated_call_cost === 1)).toBe(true);
    expect(new Set(plan.items.map(item => item.item_key)).size).toBe(plan.items.length);
  });

  test('follows the same annual release rule as the deep evidence policy', () => {
    expect(selectScreeningPeriod(new Date('2026-08-26T00:00:00Z'), POLICY)).toBe(2025);
    expect(selectScreeningPeriod(new Date('2026-07-31T00:00:00Z'), POLICY)).toBe(2024);
    expect(buildCountryScreeningPlan(planInput()).screening_period).toBe(2025);
  });

  test('changes identity when the policy, period or universe changes', () => {
    const base = buildCountryScreeningPlan(planInput());
    expect(buildCountryScreeningPlan(planInput()).run_key).toBe(base.run_key);
    expect(buildCountryScreeningPlan(planInput({ policy_config_version: 2 })).run_key).not.toBe(base.run_key);
    expect(buildCountryScreeningPlan(planInput({ as_of_date: new Date('2025-08-26T00:00:00Z') })).run_key).not.toBe(base.run_key);
    expect(buildCountryScreeningPlan(planInput({ policy: { ...POLICY, shortlist_target_size: 25 } })).run_key).not.toBe(base.run_key);
  });

  test('refuses preview evidence, an unconfirmed HS identity and a Phase 1G fallback', () => {
    expect(() => buildCountryScreeningPlan(planInput({ source_mode: 'preview' }))).toThrow(/Preview evidence is not valid/);
    expect(() => buildCountryScreeningPlan(planInput({ hs_code: '0901' }))).toThrow(/validated HS6/);
    expect(() => buildCountryScreeningPlan(planInput({ hs_revision: 'unknown' }))).toThrow(/explicit HS revision/);
    // Phase 1G owns per-country period fallback. Phase 1F fails closed rather than guessing.
    expect(() => buildCountryScreeningPlan(planInput({ policy: { ...POLICY, period_fallback_lookback_years: 3 } }))).toThrow(/not implemented in country-screening-policy-v1/);
    expect(() => buildCountryScreeningPlan(planInput({ policy: { ...POLICY, required_normalization_version: 'comtrade-normalization-v1' } }))).toThrow(/comtrade-normalization-v2/);
    expect(() => buildCountryScreeningPlan(planInput({ policy: { ...POLICY, required_parser_version: 'comtrade-parser-v1' } }))).toThrow(/current Comtrade parser version/);
    expect(() => buildCountryScreeningPlan(planInput({ policy: { ...POLICY, require_complete_evidence: false } }))).toThrow(/requires complete provider evidence/);
    expect(() => buildCountryScreeningPlan(planInput({ policy: { ...POLICY, max_countries_per_run: 10 } }))).toThrow(/exceeds the configured maximum/);
  });
});
