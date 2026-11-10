import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AuthorityReleaseChange, AuthorityReleaseStatus, UserRole, type Prisma } from '@prisma/client';
import { describe, expect, test } from 'vitest';
import { assessInputFreshness, loadInputFreshness, needsAttention, type FreshnessState, type InputFreshnessRow } from '@/lib/demand-discovery-v5/input-freshness';
import { DEMAND_DISCOVERY_V5_DEFAULT_POLICY } from '@/lib/demand-discovery-v5/policy';
import { prisma } from '../src/lib/prisma';

/**
 * docs/36 §7a: when each input Demand Discovery v5 reads stops being current. The rules are pure, so
 * every case runs at a fixed date.
 */
const at = (value: string) => new Date(`${value}T00:00:00.000Z`);
const REFERENCE_KEYS = [
  'wdi:LP.LPI.OVRL.XQ', 'wdi:IS.SHP.GCNW.XQ', 'wdi:TM.TAX.TCOM.SM.AR.ZS', 'wdi:TM.TAX.MANF.SM.AR.ZS', 'comtrade:availability:2024', 'comtrade:availability:2025',
  'india:trade-agreements', 'ecgc:country-risk:short-term', 'cepii:geo_cepii', 'curated:capitals-supplement', 'curated:sanctions-programmes', 'curated:currency-pegs',
];

function state(overrides: Partial<FreshnessState> = {}): FreshnessState {
  return {
    baci: [{ hs_revision: 'HS17', dataset_version: 'V202601', last_year: 2024, retrieved_at: at('2026-10-13') }, { hs_revision: 'HS22', dataset_version: 'V202601', last_year: 2024, retrieved_at: at('2026-10-13') }],
    reference: new Map(REFERENCE_KEYS.map((key) => [key, { version: `${key}-v1`, retrieved_at: at('2026-10-13') }])),
    tariffs: [],
    rule_rates: {},
    latest_usd_observation: at('2026-10-29'),
    singapore_refresh_enabled: false,
    ...overrides,
  };
}
const row = (rows: InputFreshnessRow[], key: string) => rows.find((item) => item.key === key)!;

describe('input freshness rules', () => {
  test('BACI: due from 1 January once the year after its data is two years old, overdue from 1 March', () => {
    expect(row(assessInputFreshness(state(), at('2026-10-30')), 'cepii_baci')).toMatchObject({
      status: 'fresh', due_at: '2027-03-01T00:00:00.000Z', current: { version: 'HS17 V202601 (to 2024), HS22 V202601 (to 2024)' },
    });
    // From New Year the 2027 release (data to 2025) is expected; the gate fails runs on 2024 data from now.
    expect(row(assessInputFreshness(state(), at('2027-01-15')), 'cepii_baci')).toMatchObject({ status: 'due_soon', due_at: '2027-03-01T00:00:00.000Z' });
    expect(row(assessInputFreshness(state(), at('2027-03-02')), 'cepii_baci')).toMatchObject({ status: 'overdue' });
    const imported = state({ baci: [{ hs_revision: 'HS22', dataset_version: 'V202701', last_year: 2025, retrieved_at: at('2027-02-10') }] });
    expect(row(assessInputFreshness(imported, at('2027-03-02')), 'cepii_baci')).toMatchObject({ status: 'fresh', due_at: '2028-03-01T00:00:00.000Z' });
    expect(row(assessInputFreshness(state({ baci: [] }), at('2026-10-30')), 'cepii_baci')).toMatchObject({ status: 'missing', current: null });
  });

  test('reference data ages from the day it was read; static inputs never go out of date; absent ones are missing', () => {
    const rows = assessInputFreshness(state(), at('2026-10-30'));
    // Comtrade's reporting lists follow the BACI release: its last year and the year after.
    expect(rows.filter((item) => item.group === 'reference').map((item) => item.key)).toEqual(REFERENCE_KEYS);
    expect(row(rows, 'wdi:LP.LPI.OVRL.XQ')).toMatchObject({ status: 'fresh', due_at: '2027-10-13T00:00:00.000Z' });
    // Comtrade's reporting lists are re-read monthly: read 13 Oct, due 12 Nov, so due soon on 30 Oct.
    expect(row(rows, 'comtrade:availability:2024')).toMatchObject({ status: 'due_soon', due_at: '2026-11-12T00:00:00.000Z' });
    expect(row(rows, 'cepii:geo_cepii')).toMatchObject({ status: 'static', due_at: null });
    // Sanctions programmes are re-checked monthly (R-21): read 13 Oct, due 13 Nov, so due soon on 30 Oct.
    expect(row(rows, 'curated:sanctions-programmes')).toMatchObject({ status: 'due_soon', due_at: '2026-11-13T00:00:00.000Z' });
    const without = state({ reference: new Map([...state().reference].filter(([key]) => key !== 'ecgc:country-risk:short-term')) });
    expect(row(assessInputFreshness(without, at('2026-10-30')), 'ecgc:country-risk:short-term')).toMatchObject({ status: 'missing', current: null });
    expect(row(assessInputFreshness(state(), at('2027-10-14')), 'wdi:LP.LPI.OVRL.XQ').status).toBe('overdue');
  });

  test('tariff releases: monthly sources, calendar-year schedules, the EAC year to 30 June, and Singapore’s nightly copy', () => {
    const release = (source_family: string, reference: string, retrieved = reference) => ({ source_family, authority: `${source_family} authority`, label: `${source_family} release`, release_identifier: `${source_family}-1`, reference_date: at(reference), retrieved_at: at(retrieved) });
    const tariffs = [
      release('EU_TARIC', '2026-09-01'), release('CN_CUSTOMS_TARIFF', '2026-01-01'), release('EAC_CET', '2026-07-01'), release('BT_DRC_PDF', '2026-03-01'),
      release('SG_SSO_CUSTOMS_DUTIES', '2026-10-01', '2026-10-28'),
    ];
    const rows = assessInputFreshness(state({ tariffs, singapore_refresh_enabled: true }), at('2026-10-30'));
    expect(row(rows, 'tariff:EU_TARIC:EU_TARIC authority')).toMatchObject({ status: 'overdue', due_at: '2026-10-16T00:00:00.000Z' });
    expect(row(rows, 'tariff:CN_CUSTOMS_TARIFF:CN_CUSTOMS_TARIFF authority')).toMatchObject({ status: 'fresh', due_at: '2027-01-01T00:00:00.000Z' });
    expect(row(rows, 'tariff:EAC_CET:EAC_CET authority')).toMatchObject({ status: 'fresh', due_at: '2027-07-01T00:00:00.000Z' });
    // No rhythm recorded for this source: re-checked yearly.
    expect(row(rows, 'tariff:BT_DRC_PDF:BT_DRC_PDF authority')).toMatchObject({ status: 'fresh', due_at: '2027-03-01T00:00:00.000Z', rule: expect.stringMatching(/re-checked yearly/) });
    expect(row(rows, 'tariff:SG_SSO_CUSTOMS_DUTIES:SG_SSO_CUSTOMS_DUTIES authority')).toMatchObject({ status: 'automatic', due_at: '2026-11-04T00:00:00.000Z' });
    // A nightly copy older than a week means the refresh is failing.
    expect(row(assessInputFreshness(state({ tariffs, singapore_refresh_enabled: true }), at('2026-11-05')), 'tariff:SG_SSO_CUSTOMS_DUTIES:SG_SSO_CUSTOMS_DUTIES authority').status).toBe('overdue');
    // With the refresh off, Singapore's copy ages like any other release.
    expect(row(assessInputFreshness(state({ tariffs }), at('2026-11-05')), 'tariff:SG_SSO_CUSTOMS_DUTIES:SG_SSO_CUSTOMS_DUTIES authority')).toMatchObject({ status: 'fresh', due_at: '2027-10-01T00:00:00.000Z' });
    expect(row(assessInputFreshness(state({ tariffs }), at('2026-12-20')), 'tariff:CN_CUSTOMS_TARIFF:CN_CUSTOMS_TARIFF authority').status).toBe('due_soon');
    const eac = assessInputFreshness(state({ tariffs: [release('EAC_CET', '2026-06-30')] }), at('2026-06-30'));
    expect(row(eac, 'tariff:EAC_CET:EAC_CET authority')).toMatchObject({ status: 'due_soon', due_at: '2026-07-01T00:00:00.000Z' });
  });

  test('a release that states its own last day is due the day after it, not on the calendar guess', () => {
    // Production, 10 Nov 2026: both showed as overdue on the ops page the day they were checked.
    const stated = (source_family: string, reference: string, valid_until: string) => ({
      source_family, authority: `${source_family} authority`, label: `${source_family} release`, release_identifier: `${source_family}-1`,
      reference_date: at(reference), retrieved_at: at('2026-10-19'), valid_until: at(valid_until),
    });
    const tariffs = [
      // China's 2026 schedule, published 31 Dec 2025, in force 1 Jan – 31 Dec 2026.
      stated('CN_CUSTOMS_TARIFF', '2025-12-31', '2026-12-31'),
      // The EAC's notice of 30 Jun 2026 for the year 1 Jul 2026 – 30 Jun 2027.
      stated('EAC_CET', '2026-06-30', '2027-06-30'),
      // A monthly source whose release says it ends sooner than its age allows: the earlier date wins.
      stated('EU_TARIC', '2026-11-01', '2026-11-20'),
    ];
    const rows = assessInputFreshness(state({ tariffs }), at('2026-11-10'));
    expect(row(rows, 'tariff:CN_CUSTOMS_TARIFF:CN_CUSTOMS_TARIFF authority')).toMatchObject({ status: 'fresh', due_at: '2027-01-01T00:00:00.000Z' });
    expect(row(rows, 'tariff:EAC_CET:EAC_CET authority')).toMatchObject({ status: 'fresh', due_at: '2027-07-01T00:00:00.000Z' });
    expect(row(rows, 'tariff:EU_TARIC:EU_TARIC authority')).toMatchObject({ status: 'due_soon', due_at: '2026-11-21T00:00:00.000Z' });
    // Without a stated end, the calendar rule stands (and still reads the publication date).
    const unstated = tariffs.map(({ valid_until: _ignored, ...release }) => release);
    expect(row(assessInputFreshness(state({ tariffs: unstated }), at('2026-11-10')), 'tariff:CN_CUSTOMS_TARIFF:CN_CUSTOMS_TARIFF authority')).toMatchObject({ status: 'overdue', due_at: '2026-01-01T00:00:00.000Z' });
    expect(row(assessInputFreshness(state({ tariffs }), at('2027-01-01')), 'tariff:CN_CUSTOMS_TARIFF:CN_CUSTOMS_TARIFF authority').status).toBe('overdue');
  });

  test('a published duty rule is due at its review date (R-22)', () => {
    const rule_rates = {
      XA: { duty_percent: 0, except_hs: [], rule: 'Free port', basis: 'Fixture', source_url: 'https://example.test/xa', checked_on: '2026-01-10', review_by: '2026-11-05' },
      XB: { duty_percent: 5, except_hs: [], rule: 'One rate', basis: 'Fixture', source_url: 'https://example.test/xb', checked_on: '2025-10-01', review_by: '2026-10-01' },
    };
    const rows = assessInputFreshness(state({ rule_rates }), at('2026-10-30'));
    expect(row(rows, 'rule:XA')).toMatchObject({ status: 'due_soon', due_at: '2026-11-05T00:00:00.000Z', label: 'XA: Free port', current: { version: 'checked 2026-01-10' } });
    expect(row(rows, 'rule:XB')).toMatchObject({ status: 'overdue' });
    // The policy in force carries real rules, each with a review date.
    const real = assessInputFreshness(state({ rule_rates: DEMAND_DISCOVERY_V5_DEFAULT_POLICY.rule_rates }), at('2026-10-30')).filter((item) => item.group === 'rule');
    expect(real.length).toBe(Object.keys(DEMAND_DISCOVERY_V5_DEFAULT_POLICY.rule_rates).length);
    expect(real.every((item) => item.due_at != null)).toBe(true);
  });

  test('only overdue and missing inputs need attention; exchange rates are automatic', () => {
    const rows = assessInputFreshness(state({ baci: [] }), at('2026-10-30'));
    expect(rows[0].key).toBe('cepii_baci');
    expect(row(rows, 'ecb_fx')).toMatchObject({ status: 'automatic', current: { version: 'EUR/USD', dated: '2026-10-29T00:00:00.000Z' } });
    // Without BACI there is no last year, so no Comtrade reporting list to check either.
    expect(rows.some((item) => item.key.startsWith('comtrade:availability:'))).toBe(false);
    expect(rows.filter(needsAttention).map((item) => [item.key, item.status])).toEqual([['cepii_baci', 'missing']]);
    expect(rows.every((item) => item.rule.length > 10 && item.refresh.length > 5)).toBe(true);
  });
});

describe('where freshness shows', () => {
  test('the loader reads the stored state without failing, one row per input', async () => {
    const rows = await loadInputFreshness(at('2026-10-30'));
    expect(rows[0].key).toBe('cepii_baci');
    expect(rows.map((item) => item.key)).toEqual(expect.arrayContaining(['wdi:LP.LPI.OVRL.XQ', 'india:trade-agreements', 'curated:sanctions-programmes', 'ecb_fx']));
    expect(new Set(rows.map((item) => item.key)).size).toBe(rows.length);
  });

  test('the loader reads the last day a stored release states', async () => {
    const marker = randomUUID();
    const admin = await prisma.user.create({ data: { email: `freshness-${marker}@example.test`, name: 'Freshness importer', role: UserRole.admin } });
    const release = (authority: string, validation: Prisma.InputJsonObject) => prisma.authorityRelease.create({ data: {
      label: `China customs tariff ${marker}`, source_family: 'CN_CUSTOMS_TARIFF', authority, destination_scope: ['CN'],
      source_url: 'https://example.test/cn', release_identifier: `cn-tariff-2026-${marker}`, reference_date: at('2025-12-31'),
      source_distribution: 'test retained authority release', retrieved_at: at('2026-10-19'), source_format: 'zip',
      checksum: `${authority}${marker}`.replace(/[^a-f0-9]/g, '').padEnd(64, 'b').slice(0, 64), size_bytes: 10, artifact_object_key: `test/${authority}/${marker}`,
      file_manifest: [], reader_version: 'reader-v1', parser_version: 'parser-v1', validation, change_classification: AuthorityReleaseChange.NEW_RELEASE,
      change_basis: { fixture: true }, imported_by_id: admin.id, status: AuthorityReleaseStatus.active, activated_at: at('2026-10-19'),
    } });
    await release(`stated ${marker}`, { effective_from: '2026-01-01', valid_until: '2026-12-31' });
    await release(`unstated ${marker}`, { fixture: true });
    const rows = await loadInputFreshness(at('2026-11-10'));
    expect(row(rows, `tariff:CN_CUSTOMS_TARIFF:stated ${marker}`)).toMatchObject({ status: 'fresh', due_at: '2027-01-01T00:00:00.000Z' });
    expect(row(rows, `tariff:CN_CUSTOMS_TARIFF:unstated ${marker}`)).toMatchObject({ status: 'overdue', due_at: '2026-01-01T00:00:00.000Z' });
  });

  test('the Control Tower counts inputs that need attention and links to the table; the worker logs them daily', () => {
    expect(readFileSync('src/app/ops/page.tsx', 'utf8')).toContain("['Stale data inputs', freshness.filter(needsAttention).length, '/ops/discovery#data-freshness']");
    const worker = readFileSync('scripts/worker.ts', 'utf8');
    expect(worker).toContain('await sweepInputFreshness();');
    expect(worker).toContain("log('warn', 'input_freshness'");
  });
});
