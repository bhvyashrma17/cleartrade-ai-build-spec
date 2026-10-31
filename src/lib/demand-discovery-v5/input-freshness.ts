/**
 * Data freshness for every input Demand Discovery v5 reads (docs/36 §7a; stage 1 plan, item 4).
 *
 * Each input has a rule for when its current release stops being current: a yearly publication, a
 * maximum age, the end of the period a release covers, or a policy review date. `assessInputFreshness`
 * (pure) turns the stored state into one row per input: fresh, due soon, overdue, missing, automatic or
 * static. The ops Demand Discovery page shows the rows, the Control Tower counts the overdue and missing
 * ones, and the worker logs them once a day.
 *
 * Nothing here imports or changes data. Refreshing is an operator import today (each row says how);
 * whether keyless sources (the World Bank, Comtrade's reporting list) should be imported by the worker
 * by itself is an open owner decision (ledger E-035).
 */
import { AuthorityReleaseStatus, TradeDatasetReleaseStatus } from '@prisma/client';
import { getConfig } from '@/lib/config';
import { appEnvironment } from '@/lib/evidence-environment';
import { prisma } from '@/lib/prisma';
import { CAPITALS_SUPPLEMENT_KEY } from '@/lib/reference-datasets/capitals-supplement';
import { CURRENCY_PEGS_KEY } from '@/lib/reference-datasets/currency-pegs';
import { ECGC_COUNTRY_RISK_KEY, GEO_CEPII_KEY } from '@/lib/reference-datasets/registry';
import { SANCTIONS_PROGRAMMES_KEY } from '@/lib/reference-datasets/sanctions-programmes';
import { BACI_PROVIDER } from '@/lib/trade-datasets/baci';
import type { DemandDiscoveryV5Policy } from './policy';

export type FreshnessStatus = 'fresh' | 'due_soon' | 'overdue' | 'missing' | 'automatic' | 'static';
export type FreshnessGroup = 'trade_data' | 'reference' | 'tariff' | 'rule' | 'live';

/** A row turns `due_soon` this many days before it is due. */
export const DUE_SOON_DAYS = 14;
const DAY_MS = 86_400_000;

export interface InputFreshnessRow {
  key: string;
  group: FreshnessGroup;
  label: string;
  /** The release in use: its version, the date it is as of, and when it was retrieved. */
  current: { version: string; dated: string | null; retrieved_at: string | null } | null;
  /** From when the release in use is out of date; null when nothing makes it go out of date. */
  due_at: string | null;
  status: FreshnessStatus;
  /** The rule, in words, with its basis. */
  rule: string;
  /** How the input is refreshed. */
  refresh: string;
}

export interface FreshnessState {
  baci: { hs_revision: string; dataset_version: string; last_year: number; retrieved_at: Date }[];
  /** Active reference releases by dataset key. */
  reference: ReadonlyMap<string, { version: string; retrieved_at: Date }>;
  /** Active tariff releases (`AuthorityRelease`). */
  tariffs: { source_family: string; authority: string; label: string; release_identifier: string; reference_date: Date; retrieved_at: Date }[];
  rule_rates: DemandDiscoveryV5Policy['rule_rates'];
  latest_usd_observation: Date | null;
  singapore_refresh_enabled: boolean;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const REFERENCE_IMPORT = 'Download it and import it with scripts/import-reference-dataset.ts (operator machine, docs/36 §10).';
/** E-040: the keyless inputs import themselves once a staff account is set to import as. */
const AUTO_IMPORT = `The worker imports it daily when due, as the account in reference_auto_import_actor_email (E-040); without one: ${REFERENCE_IMPORT.charAt(0).toLowerCase()}${REFERENCE_IMPORT.slice(1)}`;

interface ReferenceRule {
  key: string;
  label: string;
  /** Days a release stays current after it was retrieved; null for an input that does not go out of date. */
  max_age_days: number | null;
  basis: string;
  refresh: string;
}

function referenceRules(latestBaciYear: number | null): ReferenceRule[] {
  const wdi = (key: string, label: string): ReferenceRule => ({
    key, label, max_age_days: 365, refresh: `World Bank API (keyless). ${AUTO_IMPORT}`,
    basis: 'The World Bank revises its indicators through the year: re-read yearly. Values more than 10 years old are already not used (D-021).',
  });
  return [
    wdi('wdi:LP.LPI.OVRL.XQ', 'World Bank logistics index'),
    wdi('wdi:IS.SHP.GCNW.XQ', 'UNCTAD shipping connectivity (World Bank)'),
    wdi('wdi:TM.TAX.TCOM.SM.AR.ZS', 'World Bank tariff average, primary products'),
    wdi('wdi:TM.TAX.MANF.SM.AR.ZS', 'World Bank tariff average, manufactured products'),
    ...(latestBaciYear == null ? [] : [latestBaciYear, latestBaciYear + 1].map((year): ReferenceRule => ({
      key: `comtrade:availability:${year}`, label: `Comtrade reporting list ${year}`, max_age_days: 30, refresh: `Comtrade getDa (keyless). ${AUTO_IMPORT}`,
      basis: "Markets keep reporting recent years to Comtrade, and the list decides which markets are labelled as estimated from partners' figures: re-read monthly.",
    }))),
    { key: 'india:trade-agreements', label: "India's trade agreements", max_age_days: 182, refresh: 'Check the Department of Commerce list, update data/reference/india-trade-agreements-*.json, then import it.', basis: 'Agreements change rarely; the curated list is re-checked twice a year.' },
    { key: ECGC_COUNTRY_RISK_KEY, label: 'ECGC country risk list (short term)', max_age_days: 182, refresh: "Convert ECGC's current list as before (pdftotext -layout, E-018) and import it.", basis: 'ECGC revises its country classification from time to time: re-checked twice a year.' },
    { key: GEO_CEPII_KEY, label: 'CEPII GeoDist capitals', max_age_days: null, refresh: 'Nothing to refresh.', basis: 'Capital coordinates do not change.' },
    { key: CAPITALS_SUPPLEMENT_KEY, label: 'Capitals GeoDist lacks (curated)', max_age_days: null, refresh: 'Nothing to refresh.', basis: 'Capital coordinates do not change.' },
    { key: SANCTIONS_PROGRAMMES_KEY, label: 'Sanctions programmes (curated)', max_age_days: 31, refresh: 'Re-check the UN, US and EU programmes and import a new edition of curated:sanctions-programmes.', basis: 'Sanctions programmes change often (R-21): re-checked monthly.' },
    { key: CURRENCY_PEGS_KEY, label: 'Currency pegs (curated)', max_age_days: 365, refresh: 'Re-check each peg at its central bank and import a new edition of curated:currency-pegs.', basis: 'Pegs change rarely: re-checked yearly.' },
  ];
}

/** How long an active tariff release stays current, by source family. Families not listed get the default. */
type TariffRule =
  | { kind: 'max_age_days'; days: number; basis: string; refresh: string }
  | { kind: 'year_end'; basis: string; refresh: string }
  | { kind: 'until_30_june'; basis: string; refresh: string }
  | { kind: 'nightly'; basis: string; refresh: string };

const TARIFF_RULES: Record<string, TariffRule> = {
  EU_TARIC: { kind: 'max_age_days', days: 45, basis: 'TARIC is published monthly: 45 days allows one missed edition plus two weeks.', refresh: "Import the month's TARIC release (an EU Login holder downloads it)." },
  BR_CAMEX_TARIFF: { kind: 'max_age_days', days: 45, basis: 'The CAMEX workbook changes most months (R-29).', refresh: "Import the month's CAMEX workbook: scripts/import-retained-authority-release.ts --family=BR." },
  CN_CUSTOMS_TARIFF: { kind: 'year_end', basis: "China's schedule is set for a calendar year; the release states nothing after 31 December (R-29).", refresh: "Import the new year's schedule: scripts/import-retained-authority-release.ts --family=CN." },
  EAC_CET: { kind: 'until_30_june', basis: 'The EAC release states nothing after 30 June; the July Gazette must be read first (docs/37 §4a).', refresh: "Read the July EAC Gazette and import a new release: scripts/import-retained-authority-release.ts --family=EAC." },
  SG_SSO_CUSTOMS_DUTIES: { kind: 'nightly', basis: 'Saved in the nightly Singapore Statutes Online window while the refresh is on (D-029); a copy older than 7 days means the refresh is failing.', refresh: 'market_access.authority_refresh (worker, 03:00–07:00 SGT).' },
};
const DEFAULT_TARIFF_RULE: TariffRule = {
  kind: 'max_age_days', days: 365,
  basis: 'No publishing rhythm is recorded for this source: re-checked yearly, like the source directory (docs/37).',
  refresh: 'Re-check the official source and import a newer release if it changed.',
};

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------

const iso = (value: Date | null) => (value ? value.toISOString() : null);
const addDays = (value: Date, days: number) => new Date(value.getTime() + days * DAY_MS);

function statusFor(dueAt: Date, now: Date): FreshnessStatus {
  if (now.getTime() >= dueAt.getTime()) return 'overdue';
  return dueAt.getTime() - now.getTime() <= DUE_SOON_DAYS * DAY_MS ? 'due_soon' : 'fresh';
}

/**
 * BACI: CEPII publishes early each year with data to two years earlier. From 1 January the new
 * release is due (the gate starts failing runs on the old one) and from 1 March it is overdue.
 */
function baciRow(state: FreshnessState, now: Date): InputFreshnessRow {
  const base = {
    key: 'cepii_baci', group: 'trade_data' as const, label: 'CEPII BACI trade flows (HS17 and HS22)',
    rule: 'CEPII publishes BACI once a year, early in the year, with data to two years earlier (the 2026 release ends in 2024). From 1 March a release without that year is overdue; the gate fails a run whose newest base year is more than two years old (docs/34).',
    refresh: 'Download both revisions on the operator machine and import them with scripts/import-trade-dataset-release.ts (R-17: the agent workspace cannot reach CEPII).',
  };
  if (!state.baci.length) return { ...base, current: null, due_at: null, status: 'missing' };
  const newest = [...state.baci].sort((a, b) => b.last_year - a.last_year || b.dataset_version.localeCompare(a.dataset_version))[0];
  const year = now.getUTCFullYear();
  const current = newest.last_year >= year - 2;
  const dueAt = new Date(Date.UTC(current ? year + 1 : year, 2, 1));
  return {
    ...base,
    current: { version: state.baci.map((release) => `${release.hs_revision} ${release.dataset_version} (to ${release.last_year})`).sort().join(', '), dated: `${newest.last_year}-12-31T00:00:00.000Z`, retrieved_at: iso(newest.retrieved_at) },
    due_at: dueAt.toISOString(),
    status: current ? statusFor(dueAt, now) : now.getTime() >= dueAt.getTime() ? 'overdue' : 'due_soon',
  };
}

function tariffDueAt(rule: TariffRule, release: FreshnessState['tariffs'][number]): Date {
  switch (rule.kind) {
    case 'max_age_days':
      return addDays(release.reference_date, rule.days);
    case 'year_end':
      return new Date(Date.UTC(release.reference_date.getUTCFullYear() + 1, 0, 1));
    case 'until_30_june': {
      const year = release.reference_date.getUTCFullYear() + (release.reference_date.getUTCMonth() >= 6 ? 1 : 0);
      return new Date(Date.UTC(year, 6, 1));
    }
    case 'nightly':
      return addDays(release.retrieved_at, 7);
  }
}

/** One row per input, in a stable order: trade data, reference data, tariffs, rules, live inputs. */
export function assessInputFreshness(state: FreshnessState, now: Date): InputFreshnessRow[] {
  const rows: InputFreshnessRow[] = [baciRow(state, now)];
  const latestYear = state.baci.length ? Math.max(...state.baci.map((release) => release.last_year)) : null;

  for (const rule of referenceRules(latestYear)) {
    const release = state.reference.get(rule.key) ?? null;
    const current = release ? { version: release.version, dated: null, retrieved_at: iso(release.retrieved_at) } : null;
    const base = { key: rule.key, group: 'reference' as const, label: rule.label, rule: rule.basis, refresh: rule.refresh, current };
    if (!release) rows.push({ ...base, due_at: null, status: 'missing' });
    else if (rule.max_age_days == null) rows.push({ ...base, due_at: null, status: 'static' });
    else {
      const dueAt = addDays(release.retrieved_at, rule.max_age_days);
      rows.push({ ...base, due_at: dueAt.toISOString(), status: statusFor(dueAt, now) });
    }
  }

  const tariffs = [...state.tariffs].sort((a, b) => a.source_family.localeCompare(b.source_family) || a.authority.localeCompare(b.authority));
  for (const release of tariffs) {
    const own = TARIFF_RULES[release.source_family] ?? DEFAULT_TARIFF_RULE;
    // Singapore's nightly rule holds only while its refresh is on; otherwise the release ages like any other.
    const rule = own.kind === 'nightly' && !state.singapore_refresh_enabled ? DEFAULT_TARIFF_RULE : own;
    const dueAt = tariffDueAt(rule, release);
    const status = statusFor(dueAt, now);
    rows.push({
      key: `tariff:${release.source_family}:${release.authority}`, group: 'tariff', label: release.label,
      current: { version: release.release_identifier, dated: iso(release.reference_date), retrieved_at: iso(release.retrieved_at) },
      due_at: dueAt.toISOString(), status: rule.kind === 'nightly' && status !== 'overdue' ? 'automatic' : status, rule: rule.basis, refresh: rule.refresh,
    });
  }

  for (const [market, rule] of Object.entries(state.rule_rates).sort(([a], [b]) => a.localeCompare(b))) {
    const dueAt = new Date(`${rule.review_by}T00:00:00.000Z`);
    rows.push({
      key: `rule:${market}`, group: 'rule', label: `${market}: ${rule.rule}`,
      current: { version: `checked ${rule.checked_on}`, dated: `${rule.checked_on}T00:00:00.000Z`, retrieved_at: null },
      due_at: dueAt.toISOString(), status: statusFor(dueAt, now),
      rule: 'A published duty rule stops applying after its review date until it is checked again; the duty then falls back to the estimate (R-22).',
      refresh: 'Check the rule against its source, then set a new review date in a new v5 policy version.',
    });
  }

  rows.push({
    key: 'ecb_fx', group: 'live', label: 'ECB exchange rates',
    current: state.latest_usd_observation ? { version: 'EUR/USD', dated: iso(state.latest_usd_observation), retrieved_at: null } : null,
    due_at: null, status: 'automatic',
    rule: 'Read by each run for the days it needs, when missing (fx.ts); a failed read makes the run partial with a note.',
    refresh: 'Automatic.',
  });
  return rows;
}

/** Inputs that need someone: overdue, or missing although runs read them. */
export const needsAttention = (row: InputFreshnessRow) => row.status === 'overdue' || row.status === 'missing';

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/** Reads the stored state. Internal: callers check the principal (the ops page) or are the worker. */
export async function loadInputFreshness(now = new Date()): Promise<InputFreshnessRow[]> {
  const environment = appEnvironment();
  const [config, refresh, baci, reference, tariffs, usd] = await Promise.all([
    getConfig('demand_discovery.v5'),
    getConfig('market_access.authority_refresh'),
    prisma.tradeDatasetRelease.findMany({
      where: { provider: BACI_PROVIDER, environment, status: TradeDatasetReleaseStatus.ready },
      orderBy: [{ last_year: 'desc' }, { dataset_version: 'desc' }],
      select: { hs_revision: true, dataset_version: true, last_year: true, retrieved_at: true },
    }),
    prisma.referenceDatasetRelease.findMany({ where: { environment, status: 'active' }, select: { dataset_key: true, version: true, retrieved_at: true } }),
    prisma.authorityRelease.findMany({
      where: { status: AuthorityReleaseStatus.active },
      select: { source_family: true, authority: true, label: true, release_identifier: true, reference_date: true, retrieved_at: true },
    }),
    prisma.authoritativeFxObservation.findFirst({ where: { environment, base_currency: 'EUR', quote_currency: 'USD' }, orderBy: { observation_date: 'desc' }, select: { observation_date: true } }),
  ]);
  // Ordered newest first, so the first release of each revision is the one runs choose from.
  const newestPerRevision = baci.filter((release, index) => baci.findIndex((other) => other.hs_revision === release.hs_revision) === index);
  return assessInputFreshness({
    baci: newestPerRevision,
    reference: new Map(reference.map((release) => [release.dataset_key, { version: release.version, retrieved_at: release.retrieved_at }])),
    tariffs,
    rule_rates: config.policy.rule_rates,
    latest_usd_observation: usd?.observation_date ?? null,
    singapore_refresh_enabled: refresh.singapore.enabled,
  }, now);
}
