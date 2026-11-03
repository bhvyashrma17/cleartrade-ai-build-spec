/**
 * D-029 — Singapore's tariff, saved nightly so a run at any hour can read it.
 *
 * Singapore Statutes Online allows automated extraction only from 03:00 to 07:00 Singapore Time
 * (its Terms of Use), so a run cannot fetch the tariff when it needs it. Instead the worker, once per
 * Singapore day and inside that window, acquires the current consolidated First Schedule
 * (`singapore-acquisition.ts`), reads it with the strict bundle reader (`singapore-bundle.ts`) and
 * compares its canonical tariff with the copy already saved:
 *
 *  - **the same tariff** — nothing is imported; the check is recorded;
 *  - **no copy yet** — it is imported and, once it passes qualification, becomes the release runs
 *    read (`activate_first_release`);
 *  - **a changed tariff** — it is imported and, by default, held for review: a saved release records
 *    the amendment chain reviewed in code (to S 67/2026), which a changed tariff means is no longer
 *    the whole story. `activate_changed_tariff` makes it active instead.
 *
 * Qualification is the strict reader (layout, at least 8,000 lines, deterministic replay, retained
 * terms and amendment provenance) plus checks a real Singapore schedule always passes: rice is not
 * dutiable, liquor, tobacco, motor cars and petrol are, almost every line is duty-free, and the line
 * count is within 10% of the release in use.
 *
 * Each attempt is one audit event on `authority_refresh` / `SG_SSO_CUSTOMS_DUTIES`, carrying the
 * Singapore day and the refresh clock's own time. The events are also the schedule: a Singapore day
 * with a recorded result is done, and failed attempts are capped and spaced
 * (`max_attempts_per_window`, `minutes_between_attempts`). An attempt starts no later than 06:00
 * Singapore Time, so its six requests finish well inside the window.
 */
import { AuditSource, AuthorityReleaseStatus, OrgTier, type AuthorityRelease, type Prisma } from '@prisma/client';
import { writeAuditEvent } from '@/lib/audit';
import { getConfig, type AuthorityRefreshConfig } from '@/lib/config';
import { activateAuthorityRelease, AUTHORITY_RELEASE_IMPORT_PRINCIPALS, loadAuthorityReleaseArtifact } from '@/lib/market-access/authority-releases';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';
import { acquireSingaporeAuthorityBundle, SINGAPORE_ORDER_URL, singaporeSsoAcquisitionWindow } from './singapore-acquisition';
import { readSingaporeAuthorityBundle, readSingaporeAuthorityRelease, type SingaporeTariffLine } from './singapore-bundle';
import { activeSingaporeRelease, importSingaporeRelease, SINGAPORE_RELEASE_SOURCE } from './singapore-service';

export const SINGAPORE_REFRESH_VERSION = 'sg-sso-nightly-refresh-v1' as const;
export const SINGAPORE_REFRESH_AUDIT = { object_type: 'authority_refresh', object_id: SINGAPORE_RELEASE_SOURCE.source_family, action: 'authority_refresh_attempt' } as const;
/** An attempt may start from 03:00 until 06:00 Singapore Time; the last hour of the window is margin. */
const LAST_START_HOUR_SGT = 6;
const HOUR_MS = 3_600_000;

export type SingaporeRefreshSettings = AuthorityRefreshConfig['singapore'];
/** `activated`: a release became the one runs read — newly saved, or saved earlier and held. */
export type SingaporeRefreshOutcome = 'unchanged' | 'activated' | 'held' | 'failed';
export type SingaporeRefreshSkip = 'disabled' | 'outside_window' | 'done_today' | 'attempts_exhausted' | 'waiting_between_attempts';

export type SingaporeRefreshDecision =
  | { due: true; sgt_day: string; attempt_no: number }
  | { due: false; reason: SingaporeRefreshSkip; sgt_day: string; next_at: Date | null };

export interface SingaporeQualificationCheck { key: string; passed: boolean; detail: string }
export interface SingaporeTariffDiff {
  compared_to_release_id: string;
  added: number;
  removed: number;
  changed: number;
  /** Up to 20 differing lines, so a reviewer sees what moved without opening the bundle. */
  sample: { code: string; before: string | null; after: string | null }[];
}

export type SingaporeRefreshResult =
  | { status: 'not_due'; reason: SingaporeRefreshSkip; sgt_day: string; next_at: Date | null }
  | {
    status: SingaporeRefreshOutcome;
    sgt_day: string;
    attempt_no: number;
    reason: string | null;
    release_id: string | null;
    activated: boolean;
    consolidated_as_at: string | null;
    canonical_tariff_checksum: string | null;
    tariff_line_count: number | null;
  };

/** The Singapore calendar day of `now`, its hour, and when that day's window opened. */
export function singaporeRefreshClock(now: Date) {
  const window = singaporeSsoAcquisitionWindow(now);
  const sg = new Date(window.singapore_clock_epoch);
  const opened = new Date(Date.UTC(sg.getUTCFullYear(), sg.getUTCMonth(), sg.getUTCDate(), 3) - 8 * HOUR_MS);
  return { sgt_day: sg.toISOString().slice(0, 10), singapore_hour: window.singapore_hour, window_opened_at: opened, next_window_at: now < opened ? opened : new Date(opened.getTime() + 24 * HOUR_MS) };
}

/**
 * Whether an attempt should start now, from tonight's earlier attempts. `operator` is a person
 * running it on purpose (`scripts/authority-refresh.ts --run-now`): it ignores the switch, the cap
 * and the spacing, but never the window, which is the authority's condition, not ours.
 */
export function singaporeRefreshDecision(args: {
  now: Date;
  settings: SingaporeRefreshSettings;
  attempts: readonly { at: Date; outcome: SingaporeRefreshOutcome; sgt_day: string | null }[];
  operator?: boolean;
}): SingaporeRefreshDecision {
  const clock = singaporeRefreshClock(args.now);
  const skip = (reason: SingaporeRefreshSkip, next_at: Date | null): SingaporeRefreshDecision => ({ due: false, reason, sgt_day: clock.sgt_day, next_at });
  if (!args.operator && !args.settings.enabled) return skip('disabled', null);
  if (clock.singapore_hour < 3 || clock.singapore_hour >= LAST_START_HOUR_SGT) return skip('outside_window', clock.next_window_at);
  const tonight = args.attempts.filter((attempt) => attempt.sgt_day === clock.sgt_day);
  if (args.operator) return { due: true, sgt_day: clock.sgt_day, attempt_no: tonight.length + 1 };
  if (tonight.some((attempt) => attempt.outcome !== 'failed')) return skip('done_today', clock.next_window_at);
  if (tonight.length >= args.settings.max_attempts_per_window) return skip('attempts_exhausted', clock.next_window_at);
  const last = tonight.reduce<Date | null>((latest, attempt) => (!latest || attempt.at > latest ? attempt.at : latest), null);
  const spacingMs = args.settings.minutes_between_attempts * 60_000;
  if (last && args.now.getTime() - last.getTime() < spacingMs) return skip('waiting_between_attempts', new Date(last.getTime() + spacingMs));
  return { due: true, sgt_day: clock.sgt_day, attempt_no: tonight.length + 1 };
}

const startsWith = (lines: ReadonlyMap<string, SingaporeTariffLine>, prefix: string) => [...lines.values()].filter((line) => line.code.startsWith(prefix));

/**
 * Checks a real Singapore First Schedule always passes. They test shape, not amounts, so a budget
 * that changes a rate does not fail them; a page that parsed into the wrong columns does.
 */
export function qualifySingaporeTariff(lines: ReadonlyMap<string, SingaporeTariffLine>, previous: { tariff_line_count: number } | null): { passed: boolean; checks: SingaporeQualificationCheck[] } {
  const checks: SingaporeQualificationCheck[] = [];
  const total = lines.size;
  const nonDutiable = [...lines.values()].filter((line) => line.non_dutiable).length;
  const share = total ? nonDutiable / total : 0;
  checks.push({ key: 'mostly_duty_free', passed: share >= 0.9, detail: `${nonDutiable} of ${total} lines (${(share * 100).toFixed(1)}%) are not dutiable; at least 90% expected.` });
  const rice = startsWith(lines, '1006');
  checks.push({ key: 'rice_not_dutiable', passed: rice.length > 0 && rice.every((line) => line.non_dutiable), detail: `${rice.length} rice lines (1006), ${rice.filter((line) => !line.non_dutiable).length} dutiable; none expected.` });
  for (const [key, prefix, label] of [['liquor_dutiable', '2203', 'beer and stout (2203)'], ['tobacco_dutiable', '24', 'tobacco (24)'], ['motor_cars_dutiable', '8703', 'motor cars (8703)'], ['petrol_dutiable', '2710', 'petroleum oils (2710)']] as const) {
    const found = startsWith(lines, prefix);
    const dutiable = found.filter((line) => !line.non_dutiable).length;
    checks.push({ key, passed: dutiable > 0, detail: `${found.length} ${label} lines, ${dutiable} dutiable; at least one expected.` });
  }
  if (previous && previous.tariff_line_count > 0) {
    const drift = Math.abs(total - previous.tariff_line_count) / previous.tariff_line_count;
    checks.push({ key: 'line_count_steady', passed: drift <= 0.1, detail: `${total} lines against ${previous.tariff_line_count} in the release in use (${(drift * 100).toFixed(1)}% apart; at most 10%).` });
  }
  return { passed: checks.every((check) => check.passed), checks };
}

const lineText = (line: SingaporeTariffLine) => line.non_dutiable
  ? 'not dutiable'
  : [`customs ${line.full_customs_duty.expression || '—'}`, `preferential ${line.preferential_customs_duty.expression || '—'}`, `excise ${line.excise_duty.expression || '—'}`].join('; ');

export function singaporeTariffDiff(releaseId: string, before: ReadonlyMap<string, SingaporeTariffLine>, after: ReadonlyMap<string, SingaporeTariffLine>): SingaporeTariffDiff {
  const identity = (line: SingaporeTariffLine) => JSON.stringify([line.description, line.unit, lineText(line)]);
  const codes = [...new Set([...before.keys(), ...after.keys()])].sort();
  const diff: SingaporeTariffDiff = { compared_to_release_id: releaseId, added: 0, removed: 0, changed: 0, sample: [] };
  for (const code of codes) {
    const was = before.get(code), now = after.get(code);
    if (was && now && identity(was) === identity(now)) continue;
    if (!was) diff.added += 1; else if (!now) diff.removed += 1; else diff.changed += 1;
    if (diff.sample.length < 20) diff.sample.push({ code, before: was ? lineText(was) : null, after: now ? lineText(now) : null });
  }
  return diff;
}

const canonicalOf = (release: Pick<AuthorityRelease, 'validation'> | null) => {
  const value = (release?.validation ?? null) as { canonical_tariff_checksum?: unknown } | null;
  return typeof value?.canonical_tariff_checksum === 'string' ? value.canonical_tariff_checksum : null;
};
const lineCountOf = (release: Pick<AuthorityRelease, 'validation'> | null) => {
  const value = (release?.validation ?? null) as { tariff_line_count?: unknown } | null;
  return typeof value?.tariff_line_count === 'number' ? value.tariff_line_count : null;
};
const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim().slice(0, 500) || 'Failed without a message.';

/** The account saved releases are imported as: active, and allowed to import authority releases. */
async function refreshActor(email: string | null): Promise<Principal | null> {
  if (!email) return null;
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || !user.is_active || !AUTHORITY_RELEASE_IMPORT_PRINCIPALS.includes(user.role)) return null;
  return { id: user.id, email: user.email, name: user.name ?? '', role: user.role, exporter_org_id: user.exporter_org_id, tier: OrgTier.paid };
}

/** The most recent attempts, newest first (at most three a night, so 30 covers ten nights). */
export async function singaporeRefreshAttempts(take = 30) {
  const rows = await prisma.auditEvent.findMany({
    where: { object_type: SINGAPORE_REFRESH_AUDIT.object_type, object_id: SINGAPORE_REFRESH_AUDIT.object_id, action: SINGAPORE_REFRESH_AUDIT.action },
    orderBy: { timestamp: 'desc' },
    take,
    select: { timestamp: true, after_summary: true },
  });
  return rows.map((row) => {
    const summary = (row.after_summary ?? {}) as { outcome?: SingaporeRefreshOutcome; reason?: string | null; release_id?: string | null; activated?: boolean; sgt_day?: string; attempted_at?: string };
    const at = summary.attempted_at ? new Date(summary.attempted_at) : row.timestamp;
    return { at: Number.isNaN(at.getTime()) ? row.timestamp : at, outcome: summary.outcome ?? 'failed', reason: summary.reason ?? null, release_id: summary.release_id ?? null, activated: summary.activated === true, sgt_day: summary.sgt_day ?? null };
  });
}

/**
 * One refresh attempt, when one is due (or when an operator asks). Never throws for a source,
 * reader, qualification or import failure: each is recorded as a failed attempt and returned.
 */
export async function refreshSingaporeTariff(args: {
  settings: SingaporeRefreshSettings;
  now?: Date;
  fetch_impl?: typeof fetch;
  correlation_id: string;
  operator?: boolean;
}): Promise<SingaporeRefreshResult> {
  const now = args.now ?? new Date();
  const decision = singaporeRefreshDecision({ now, settings: args.settings, attempts: await singaporeRefreshAttempts(), operator: args.operator });
  if (!decision.due) return { status: 'not_due', reason: decision.reason, sgt_day: decision.sgt_day, next_at: decision.next_at };

  const releaseIdentifier = `sso-window-${decision.sgt_day}`;
  const base = { sgt_day: decision.sgt_day, attempt_no: decision.attempt_no, consolidated_as_at: null as string | null, canonical_tariff_checksum: null as string | null, tariff_line_count: null as number | null };
  const actor = await refreshActor(args.settings.actor_email);
  const record = async (result: Extract<SingaporeRefreshResult, { status: SingaporeRefreshOutcome }>, detail: Record<string, unknown> = {}) => {
    await writeAuditEvent({
      actor,
      action: SINGAPORE_REFRESH_AUDIT.action,
      object_type: SINGAPORE_REFRESH_AUDIT.object_type,
      object_id: SINGAPORE_REFRESH_AUDIT.object_id,
      exporter_org_id: null,
      after_summary: { refresh_version: SINGAPORE_REFRESH_VERSION, outcome: result.status, ...result, attempted_at: now.toISOString(), operator: args.operator === true, release_identifier: releaseIdentifier, ...detail } as Prisma.InputJsonValue,
      correlation_id: args.correlation_id,
      source: AuditSource.job,
    });
    return result;
  };
  const failed = (reason: string, detail: Record<string, unknown> = {}) => record({ status: 'failed', ...base, reason, release_id: null, activated: false }, detail);

  if (!actor) return failed(`No active ops supervisor or admin account ${args.settings.actor_email ? `matches ${args.settings.actor_email}` : 'is configured (actor_email)'}; saved releases need one to be imported as.`);

  let bytes: Buffer;
  try { bytes = await acquireSingaporeAuthorityBundle({ release_identifier: releaseIdentifier, now, fetch_impl: args.fetch_impl }); }
  catch (error) { return failed(`Acquisition: ${message(error)}`); }
  let bundle: Awaited<ReturnType<typeof readSingaporeAuthorityBundle>>;
  try { bundle = await readSingaporeAuthorityBundle({ bytes, release_identifier: releaseIdentifier }); }
  catch (error) { return failed(`Reading the acquired schedule: ${message(error)}`); }
  base.consolidated_as_at = bundle.consolidated_as_at; base.canonical_tariff_checksum = bundle.canonical_tariff_checksum; base.tariff_line_count = bundle.lines.size;

  const [active, latest] = await Promise.all([
    activeSingaporeRelease(),
    prisma.authorityRelease.findFirst({
      where: { source_family: SINGAPORE_RELEASE_SOURCE.source_family, authority: SINGAPORE_RELEASE_SOURCE.authority, status: { not: AuthorityReleaseStatus.rejected } },
      orderBy: { imported_at: 'desc' },
    }),
  ]);
  const held = latest && latest.status === AuthorityReleaseStatus.imported ? latest : null;
  const allowed = active ? args.settings.activate_changed_tariff : args.settings.activate_first_release;
  const qualification = qualifySingaporeTariff(bundle.lines, active ? { tariff_line_count: lineCountOf(active) ?? 0 } : null);
  const sameAsActive = canonicalOf(active) === bundle.canonical_tariff_checksum;
  if (sameAsActive || canonicalOf(latest) === bundle.canonical_tariff_checksum) {
    const same = sameAsActive ? active! : latest!;
    // A release held earlier becomes active on a later night once its switch is on and it qualifies.
    if (same.id === held?.id && allowed && qualification.passed) {
      try { await activateAuthorityRelease({ actor, release_id: same.id, correlation_id: args.correlation_id }); }
      catch (error) { return failed(`Activating the held release: ${message(error)}`, { qualification }); }
      return record({ status: 'activated', ...base, reason: 'The release held for review is now the one runs read.', release_id: same.id, activated: true }, { first_release: !active, previous_active_release_id: active?.id ?? null, qualification });
    }
    const failing = qualification.checks.filter((check) => !check.passed).map((check) => check.key);
    const reason = same.id === held?.id
      ? `The published tariff matches the release held for review${allowed && failing.length ? `, which does not pass qualification (${failing.join(', ')})` : ''}.`
      : sameAsActive && held ? `The published tariff is the release in use again; the change held for review (${held.release_identifier}) is no longer published.` : null;
    return record({ status: 'unchanged', ...base, reason, release_id: same.id, activated: same.status === AuthorityReleaseStatus.active });
  }

  let diff: SingaporeTariffDiff | null = null;
  let diffError: string | null = null;
  if (active) {
    try {
      const loaded = await loadAuthorityReleaseArtifact(active.id);
      const previous = await readSingaporeAuthorityRelease({ bytes: loaded.bytes, release_identifier: active.release_identifier, reader_version: active.reader_version });
      diff = singaporeTariffDiff(active.id, previous.lines, bundle.lines);
    } catch (error) { diffError = message(error); }
  }
  const activate = qualification.passed && allowed;
  const heldReason = !qualification.passed
    ? `Held: qualification failed (${qualification.checks.filter((check) => !check.passed).map((check) => `${check.key}: ${check.detail}`).join(' ')})`
    : !allowed
      ? active
        ? `Held for review: Singapore's published tariff changed${diff ? ` (${diff.changed} lines changed, ${diff.added} added, ${diff.removed} removed)` : ''}; the release in use stays active until an operator activates this one.`
        : 'Held: activate_first_release is off.'
      : null;
  try {
    const imported = await importSingaporeRelease({
      actor, bytes, release_identifier: releaseIdentifier, reference_date: new Date(`${decision.sgt_day}T00:00:00.000Z`),
      source_url: SINGAPORE_ORDER_URL, activate, correlation_id: args.correlation_id, retrieved_at: now,
    });
    return record(
      { status: activate ? 'activated' : 'held', ...base, reason: heldReason, release_id: imported.release.id, activated: imported.release.status === AuthorityReleaseStatus.active },
      { first_release: !active, previous_active_release_id: active?.id ?? null, qualification, diff, diff_error: diffError },
    );
  } catch (error) {
    return failed(`Import: ${message(error)}`, { qualification, diff, diff_error: diffError });
  }
}

/**
 * The worker's nightly sweep. Outside the window it reads nothing at all; inside it, it reads the
 * switch and tonight's attempts, and refreshes when one is due.
 */
export async function runDueAuthorityRefreshes(args: { correlation_id: string; now?: Date; fetch_impl?: typeof fetch }) {
  const now = args.now ?? new Date();
  const clock = singaporeRefreshClock(now);
  if (clock.singapore_hour < 3 || clock.singapore_hour >= LAST_START_HOUR_SGT) {
    return { singapore: { status: 'not_due', reason: 'outside_window', sgt_day: clock.sgt_day, next_at: clock.next_window_at } as SingaporeRefreshResult };
  }
  const config = await getConfig('market_access.authority_refresh');
  return { singapore: await refreshSingaporeTariff({ settings: config.singapore, now, fetch_impl: args.fetch_impl, correlation_id: args.correlation_id }) };
}

/** What operations sees: the switch, the release runs read, one held for review, and recent attempts. */
export async function singaporeRefreshStatus(now = new Date()) {
  const [config, active, latest, attempts] = await Promise.all([
    getConfig('market_access.authority_refresh'),
    activeSingaporeRelease(),
    prisma.authorityRelease.findFirst({
      where: { source_family: SINGAPORE_RELEASE_SOURCE.source_family, authority: SINGAPORE_RELEASE_SOURCE.authority, status: { not: AuthorityReleaseStatus.rejected } },
      orderBy: { imported_at: 'desc' },
    }),
    singaporeRefreshAttempts(5),
  ]);
  const view = (release: AuthorityRelease | null) => release ? {
    id: release.id, release_identifier: release.release_identifier, status: release.status, retrieved_at: release.retrieved_at, activated_at: release.activated_at,
    consolidated_as_at: ((release.validation ?? {}) as { consolidated_as_at?: string }).consolidated_as_at ?? null, tariff_line_count: lineCountOf(release),
  } : null;
  return {
    enabled: config.singapore.enabled,
    activate_changed_tariff: config.singapore.activate_changed_tariff,
    active: view(active),
    held: latest && latest.status === AuthorityReleaseStatus.imported && latest.id !== active?.id ? view(latest) : null,
    attempts,
    next_window_at: singaporeRefreshClock(now).next_window_at,
  };
}
