import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { AuthorityReleaseStatus, UserRole } from '@prisma/client';
import { authorityRefreshConfigProblems, CONFIG_DEFAULTS } from '@/lib/config';
import { DESTINATION_ADAPTERS } from '@/lib/job-handlers/market-access';
import {
  SINGAPORE_CLASSIFICATION_URL, SINGAPORE_DUTIABLE_GOODS_URL, SINGAPORE_ORDER_URL, SINGAPORE_S49_URL, SINGAPORE_S67_URL, SINGAPORE_TERMS_URL,
} from '@/lib/market-access/providers/singapore-acquisition';
import { parseSingaporeScheduleHtml } from '@/lib/market-access/providers/singapore-bundle';
import {
  qualifySingaporeTariff, refreshSingaporeTariff, runDueAuthorityRefreshes, singaporeRefreshDecision, singaporeRefreshStatus, type SingaporeRefreshSettings,
} from '@/lib/market-access/providers/singapore-refresh';
import { fetchSingaporeMarketAccess, SINGAPORE_RELEASE_SOURCE } from '@/lib/market-access/providers/singapore-service';
import { prisma } from '@/lib/prisma';

/**
 * D-029: Singapore's tariff is saved by the worker inside SSO's 03:00–07:00 Singapore Time window, so
 * runs at any hour read the saved copy. SSO is replaced by an in-process double serving a First
 * Schedule of realistic size (the reader requires at least 8,000 lines); everything after the fetch
 * — reader, qualification, import, activation, audit — is the real code against the test database.
 */
const MARKER = `sg-refresh-${randomUUID()}`;
type Row = readonly [string, string, string, string, string, string];
const ARCHETYPES: readonly Row[] = [
  ['1006.30.90', 'Other semi-milled or wholly milled rice', 'KGM', '', '', ''],
  ['2203.00.11', 'Stout and porter', 'LAL', '$16.00 per litre of alcohol', 'FREE', '$60.00 per litre of alcohol'],
  ['2401.10.10', 'Tobacco, not stemmed or stripped', 'KGM', '', '', '$535.00 per kgm'],
  ['8703.23.99', 'Other motor cars', 'U', '', '', '20%'],
  ['2710.12.11', 'Unleaded motor spirit, RON 97 and above', 'DAL', '', '', '$7.90 per dal'],
];
/** 8,200 duty-free lines in chapters 40–41, outside every Singapore dutiable category. */
const FILLER: readonly Row[] = Array.from({ length: 8_200 }, (_, index) => [`${4000 + Math.floor(index / 50)}.${String(index % 50).padStart(2, '0')}.10`, `Synthetic duty-free line ${index}`, 'KGM', '', '', ''] as const);

function orderHtml(rows: readonly Row[]) {
  return `<html><body><h1>Customs (Duties) Order</h1><p>Current version as at 21 September 2026</p><h2>FIRST SCHEDULE</h2>
  <table><tr><th>Item</th><th>H.S. Code</th><th>Description</th><th>Unit of Quantity</th><th>Customs Duty — Full</th><th>Customs Duty — Preferential</th><th>Excise Duty</th></tr>
  ${rows.map((row, index) => `<tr><td>${index + 1}</td>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</table></body></html>`;
}
const SUPPORTING: Record<string, string> = {
  [SINGAPORE_S49_URL]: '<html>No. S 49/2026. Customs (Duties) (Amendment) Order 2026. Comes into operation on 1 February 2026.</html>',
  [SINGAPORE_S67_URL]: '<html>No. S 67/2026. Customs (Duties) (Amendment No. 2) Order 2026. Comes into operation on 12 February 2026. Replace $446.00 per kgm with $535.00 per kgm.</html>',
  [SINGAPORE_TERMS_URL]: '<html>Use/reproduce Singapore legislation in an electronic material or platform with permission. Automated extraction only from 3 a.m. to 7 a.m. Singapore Time.</html>',
  [SINGAPORE_CLASSIFICATION_URL]: '<html>Singapore extends HS codes to 8-digit codes under the AHTN and STCCED.</html>',
  [SINGAPORE_DUTIABLE_GOODS_URL]: '<html>Dutiable categories: intoxicating liquor; tobacco products; motor vehicles; petroleum products and biodiesel blends. Other goods are non-dutiable.</html>',
};

/** SSO as a double: the schedule given, or an HTTP status for the order page. */
function sso(schedule: readonly Row[] | number) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url === SINGAPORE_ORDER_URL) return typeof schedule === 'number' ? new Response('unavailable', { status: schedule }) : new Response(orderHtml(schedule), { status: 200, headers: { 'content-type': 'text/html' } });
    const body = SUPPORTING[url];
    return body ? new Response(body, { status: 200, headers: { 'content-type': 'text/html' } }) : new Response('missing', { status: 404 });
  });
}
const BASE = [...ARCHETYPES, ...FILLER];
const RAISED_TOBACCO = BASE.map((row) => (row[0] === '2401.10.10' ? [row[0], row[1], row[2], '', '', '$600.00 per kgm'] as const : row));

/** 03:30 Singapore Time on the given Singapore day (19:30 UTC the day before). */
const nightOf = (sgtDay: string, minutes = 0) => new Date(new Date(`${sgtDay}T03:30:00+08:00`).getTime() + minutes * 60_000);
const releaseScope = { source_family: SINGAPORE_RELEASE_SOURCE.source_family, authority: SINGAPORE_RELEASE_SOURCE.authority };
let settings: SingaporeRefreshSettings;

/** Releases from other files or earlier runs must not be this file's baseline, nor this file's theirs. */
const setAside = () => prisma.authorityRelease.updateMany({ where: { ...releaseScope, status: { not: AuthorityReleaseStatus.rejected } }, data: { status: AuthorityReleaseStatus.rejected } });

beforeAll(async () => {
  await setAside();
  const ops = await prisma.user.create({ data: { email: `${MARKER}-ops@test.local`, name: 'Atlas ops', role: UserRole.ops_supervisor } });
  settings = { ...CONFIG_DEFAULTS['market_access.authority_refresh'].singapore, enabled: true, actor_email: ops.email };
});
afterAll(async () => {
  await setAside();
  await prisma.$disconnect();
});

describe('when a Singapore refresh starts', () => {
  const on: SingaporeRefreshSettings = { ...CONFIG_DEFAULTS['market_access.authority_refresh'].singapore, enabled: true, actor_email: 'ops@example.com' };
  const at = (iso: string) => new Date(iso);
  test('only between 03:00 and 06:00 Singapore Time, keeping the window’s last hour as margin', () => {
    expect(singaporeRefreshDecision({ now: at('2031-03-10T18:59:00Z'), settings: on, attempts: [] })).toMatchObject({ due: false, reason: 'outside_window', sgt_day: '2031-03-11', next_at: at('2031-03-10T19:00:00Z') });
    expect(singaporeRefreshDecision({ now: at('2031-03-10T19:00:00Z'), settings: on, attempts: [] })).toEqual({ due: true, sgt_day: '2031-03-11', attempt_no: 1 });
    expect(singaporeRefreshDecision({ now: at('2031-03-10T21:59:00Z'), settings: on, attempts: [] })).toMatchObject({ due: true });
    expect(singaporeRefreshDecision({ now: at('2031-03-10T22:00:00Z'), settings: on, attempts: [] })).toMatchObject({ due: false, reason: 'outside_window', next_at: at('2031-03-11T19:00:00Z') });
    expect(singaporeRefreshDecision({ now: at('2031-03-10T19:30:00Z'), settings: { ...on, enabled: false }, attempts: [] })).toMatchObject({ due: false, reason: 'disabled' });
  });

  test('once a night: a recorded result ends it, failures are capped and spaced, and an operator only cannot leave the window', () => {
    const now = at('2031-03-10T20:30:00Z');
    const tonight = (minutesAgo: number, outcome: 'failed' | 'unchanged') => ({ at: new Date(now.getTime() - minutesAgo * 60_000), outcome, sgt_day: '2031-03-11' });
    expect(singaporeRefreshDecision({ now, settings: on, attempts: [tonight(60, 'unchanged')] })).toMatchObject({ due: false, reason: 'done_today' });
    expect(singaporeRefreshDecision({ now, settings: on, attempts: [tonight(10, 'failed')] })).toMatchObject({ due: false, reason: 'waiting_between_attempts', next_at: at('2031-03-10T20:50:00Z') });
    expect(singaporeRefreshDecision({ now, settings: on, attempts: [tonight(31, 'failed')] })).toEqual({ due: true, sgt_day: '2031-03-11', attempt_no: 2 });
    expect(singaporeRefreshDecision({ now, settings: on, attempts: [tonight(90, 'failed'), tonight(60, 'failed'), tonight(31, 'failed')] })).toMatchObject({ due: false, reason: 'attempts_exhausted' });
    // Last night's attempts do not count tonight.
    expect(singaporeRefreshDecision({ now, settings: on, attempts: [{ ...tonight(60, 'unchanged'), sgt_day: '2031-03-10' }] })).toMatchObject({ due: true, attempt_no: 1 });
    expect(singaporeRefreshDecision({ now, settings: { ...on, enabled: false }, attempts: [tonight(5, 'unchanged')], operator: true })).toEqual({ due: true, sgt_day: '2031-03-11', attempt_no: 2 });
    expect(singaporeRefreshDecision({ now: at('2031-03-11T03:00:00Z'), settings: on, attempts: [], operator: true })).toMatchObject({ due: false, reason: 'outside_window' });
  });

  test('the switch is shape-checked before it is written', () => {
    expect(authorityRefreshConfigProblems(CONFIG_DEFAULTS['market_access.authority_refresh'])).toEqual([]);
    expect(authorityRefreshConfigProblems({ singapore: { enabled: true, actor_email: null } })).toEqual(['singapore.actor_email is required when the refresh is enabled.']);
    expect(authorityRefreshConfigProblems({ singapore: { enabled: 'yes', max_attempts_per_window: 0, minutes_between_attempts: 5, actor_email: 'not-an-email' } })).toEqual([
      'singapore.enabled must be true or false.', 'singapore.actor_email must be an email address or null.',
      'singapore.max_attempts_per_window must be a whole number from 1 to 6.', 'singapore.minutes_between_attempts must be a whole number from 10 to 120.',
    ]);
  });
});

describe('qualification of an acquired schedule', () => {
  test('passes a schedule shaped like Singapore’s and names each check that fails', () => {
    const lines = parseSingaporeScheduleHtml(orderHtml(BASE));
    expect(qualifySingaporeTariff(lines, { tariff_line_count: lines.size })).toMatchObject({ passed: true });
    expect(qualifySingaporeTariff(lines, null).checks.map((check) => check.key)).toEqual(['mostly_duty_free', 'rice_not_dutiable', 'liquor_dutiable', 'tobacco_dutiable', 'motor_cars_dutiable', 'petrol_dutiable']);
    const dutiableRice = parseSingaporeScheduleHtml(orderHtml(BASE.map((row) => (row[0] === '1006.30.90' ? [row[0], row[1], row[2], '5%', '', ''] as const : row))));
    const noCars = parseSingaporeScheduleHtml(orderHtml(BASE.filter((row) => row[0] !== '8703.23.99')));
    expect(qualifySingaporeTariff(dutiableRice, null).checks.filter((check) => !check.passed).map((check) => check.key)).toEqual(['rice_not_dutiable']);
    expect(qualifySingaporeTariff(noCars, null).checks.filter((check) => !check.passed).map((check) => check.key)).toEqual(['motor_cars_dutiable']);
    expect(qualifySingaporeTariff(lines, { tariff_line_count: 10_940 }).checks.find((check) => check.key === 'line_count_steady')).toMatchObject({ passed: false, detail: expect.stringContaining('(25.0% apart; at most 10%)') });
  });
});

describe('the nightly Singapore refresh (D-029)', () => {
  test('saves the first qualified copy and makes it the release runs read; the same night is not fetched twice', async () => {
    // Outside the window nothing is read or fetched, whatever the switch says.
    const idle = sso(BASE);
    expect(await runDueAuthorityRefreshes({ correlation_id: MARKER, now: new Date('2031-03-11T12:00:00Z'), fetch_impl: idle as typeof fetch })).toMatchObject({ singapore: { status: 'not_due', reason: 'outside_window' } });
    // Without an account to import as, the attempt is recorded as failed before any request.
    expect(await refreshSingaporeTariff({ settings: { ...settings, actor_email: `${MARKER}-nobody@test.local` }, now: nightOf('2031-03-11'), fetch_impl: idle as typeof fetch, correlation_id: MARKER }))
      .toMatchObject({ status: 'failed', attempt_no: 1, reason: expect.stringContaining('No active ops supervisor or admin account') });
    expect(idle).not.toHaveBeenCalled();

    const fetchImpl = sso(BASE);
    const first = await refreshSingaporeTariff({ settings, now: nightOf('2031-03-12'), fetch_impl: fetchImpl as typeof fetch, correlation_id: MARKER });
    expect(first).toMatchObject({ status: 'activated', activated: true, reason: null, sgt_day: '2031-03-12', consolidated_as_at: '21 September 2026', tariff_line_count: 8_205 });
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    const release = await prisma.authorityRelease.findUniqueOrThrow({ where: { id: first.status === 'not_due' ? '' : first.release_id! } });
    expect(release).toMatchObject({ status: AuthorityReleaseStatus.active, release_identifier: 'sso-window-2031-03-12', retrieved_at: nightOf('2031-03-12') });

    // Runs now read Singapore at any hour, through the connected adapter.
    expect(DESTINATION_ADAPTERS.SG).toMatchObject({ provider_key: 'sg_sso_customs_duties_order', retrieval: 'retained_release' });
    const rice = await DESTINATION_ADAPTERS.SG!.fetch({ hs6: '100630', destination_country: 'SG', origin_country: 'IN', now: new Date('2031-03-12T14:00:00Z') });
    expect(rice).toMatchObject({ country_code: 'SG', source_release_id: release.id, general_duty: { expression: 'NON-DUTIABLE', ad_valorem_rate_percent: 0 } });
    expect((await fetchSingaporeMarketAccess('240110', { origin_country: 'IN' })).general_duty).toMatchObject({ kind: 'specific', specific_amount: 535 });

    const again = sso(BASE);
    expect(await refreshSingaporeTariff({ settings, now: nightOf('2031-03-12', 40), fetch_impl: again as typeof fetch, correlation_id: MARKER })).toMatchObject({ status: 'not_due', reason: 'done_today' });
    expect(again).not.toHaveBeenCalled();
  });

  test('an unchanged tariff imports nothing; a changed one is saved and held, then activated once its switch is on', async () => {
    const before = await prisma.authorityRelease.count({ where: { ...releaseScope, status: { not: AuthorityReleaseStatus.rejected } } });
    const unchanged = await refreshSingaporeTariff({ settings, now: nightOf('2031-03-13'), fetch_impl: sso(BASE) as typeof fetch, correlation_id: MARKER });
    expect(unchanged).toMatchObject({ status: 'unchanged', activated: true, reason: null });
    expect(await prisma.authorityRelease.count({ where: { ...releaseScope, status: { not: AuthorityReleaseStatus.rejected } } })).toBe(before);
    const inUse = unchanged.status === 'not_due' ? null : unchanged.release_id;

    const changed = await refreshSingaporeTariff({ settings, now: nightOf('2031-03-14'), fetch_impl: sso(RAISED_TOBACCO) as typeof fetch, correlation_id: MARKER });
    expect(changed).toMatchObject({ status: 'held', activated: false, reason: expect.stringContaining('(1 lines changed, 0 added, 0 removed)') });
    const heldId = changed.status === 'not_due' ? '' : changed.release_id!;
    expect((await prisma.authorityRelease.findUniqueOrThrow({ where: { id: heldId } })).status).toBe(AuthorityReleaseStatus.imported);
    expect((await fetchSingaporeMarketAccess('240110', { origin_country: 'IN' })).source_release_id).toBe(inUse);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { object_type: 'authority_refresh', object_id: 'SG_SSO_CUSTOMS_DUTIES', correlation_id: MARKER }, orderBy: { timestamp: 'desc' } });
    expect(audit.after_summary).toMatchObject({ outcome: 'held', diff: { changed: 1, sample: [{ code: '24011010', before: expect.stringContaining('$535.00 per kgm'), after: expect.stringContaining('$600.00 per kgm') }] }, qualification: { passed: true } });
    expect(await singaporeRefreshStatus()).toMatchObject({ enabled: false, active: { id: inUse }, held: { id: heldId, release_identifier: 'sso-window-2031-03-14' }, attempts: [{ outcome: 'held' }, { outcome: 'unchanged' }, expect.anything(), expect.anything()] });

    // The same change the next night is not saved again.
    expect(await refreshSingaporeTariff({ settings, now: nightOf('2031-03-15'), fetch_impl: sso(RAISED_TOBACCO) as typeof fetch, correlation_id: MARKER }))
      .toMatchObject({ status: 'unchanged', release_id: heldId, activated: false, reason: 'The published tariff matches the release held for review.' });
    // Once changed tariffs may activate, the held release becomes the one runs read.
    expect(await refreshSingaporeTariff({ settings: { ...settings, activate_changed_tariff: true }, now: nightOf('2031-03-16'), fetch_impl: sso(RAISED_TOBACCO) as typeof fetch, correlation_id: MARKER }))
      .toMatchObject({ status: 'activated', release_id: heldId, activated: true });
    expect((await fetchSingaporeMarketAccess('240110', { origin_country: 'IN' })).general_duty).toMatchObject({ specific_amount: 600 });
    expect((await prisma.authorityRelease.findUniqueOrThrow({ where: { id: inUse! } })).status).toBe(AuthorityReleaseStatus.superseded);
  });

  test('a failed fetch keeps the release in use, and is retried at most three times a night, 30 minutes apart', async () => {
    const down = sso(503);
    const tries = [0, 10, 31, 62, 93].map((minutes) => nightOf('2031-03-17', minutes));
    const results = [];
    for (const now of tries) results.push(await refreshSingaporeTariff({ settings, now, fetch_impl: down as typeof fetch, correlation_id: MARKER }));
    expect(results.map((result) => (result.status === 'not_due' ? result.reason : result.status))).toEqual(['failed', 'waiting_between_attempts', 'failed', 'failed', 'attempts_exhausted']);
    expect(results[0]).toMatchObject({ reason: expect.stringMatching(/^Acquisition: Singapore authority acquisition failed .* retryable HTTP 503/) });
    expect((await fetchSingaporeMarketAccess('240110', { origin_country: 'IN' })).general_duty).toMatchObject({ specific_amount: 600 });
    // The next night starts afresh.
    expect(await refreshSingaporeTariff({ settings, now: nightOf('2031-03-18'), fetch_impl: sso(RAISED_TOBACCO) as typeof fetch, correlation_id: MARKER })).toMatchObject({ status: 'unchanged', attempt_no: 1 });
  });
});
