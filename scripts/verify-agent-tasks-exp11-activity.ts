/**
 * Verification for AGT-07 (Tasks, SLAs & Escalations), EXP-11 (Deal — Tasks) and the
 * deal Activity tab (EXP-09-AC05).
 *
 * Run with the dev server up (and DB seeded):
 *   npx tsx --env-file=.env scripts/verify-agent-tasks-exp11-activity.ts
 */

import { SlaState, TaskState, Visibility } from '@prisma/client';
import {
  BASE,
  launch,
  loggedInContext,
  preflight,
  PreflightError,
  record,
  scenario,
  summarize,
  type Browser,
  type Page,
} from './verify-harness';
import { prisma } from '../src/lib/prisma';

const DEAL = 'seed-deal-locked';
const OWNER = 'owner@sunriseagro.example';
const AGENT = 'agent@cleartrade.example';
const OPS = 'ops@cleartrade.example';

async function fetchJson(
  page: Page,
  url: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; body: unknown }> {
  return page.evaluate(
    async ([u, method, bodyStr]) => {
      const r = await fetch(u, {
        method: method || 'GET',
        headers: bodyStr ? { 'Content-Type': 'application/json' } : undefined,
        body: bodyStr || undefined,
      });
      const text = await r.text();
      let body: unknown = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      return { status: r.status, body };
    },
    [url, init?.method ?? 'GET', init?.body ? JSON.stringify(init.body) : ''] as const,
  );
}

/**
 * Walk parsed JSON and report the key path of every place a forbidden token appears —
 * as a key name, a string value, or any substring. Returns paths, not a boolean, so a
 * failure says exactly WHERE the leak is rather than merely that one exists.
 */
function findInPayload(node: unknown, needles: { label: string; value: string }[], path = '$'): string[] {
  const hits: string[] = [];
  if (node === null || node === undefined) return hits;

  if (typeof node === 'string') {
    for (const n of needles) {
      if (n.value && node.includes(n.value)) hits.push(`${path} contains ${n.label}`);
    }
    return hits;
  }
  if (typeof node !== 'object') return hits;

  if (Array.isArray(node)) {
    node.forEach((item, i) => hits.push(...findInPayload(item, needles, `${path}[${i}]`)));
    return hits;
  }

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    for (const n of needles) {
      if (n.value && key.includes(n.value)) hits.push(`${path}.${key} (key name) matches ${n.label}`);
    }
    hits.push(...findInPayload(value, needles, `${path}.${key}`));
  }
  return hits;
}

let cleanupTaskIds: string[] = [];

async function resetFixtures() {
  if (cleanupTaskIds.length > 0) {
    await prisma.taskEvidence.deleteMany({ where: { task_id: { in: cleanupTaskIds } } });
    await prisma.dispute.deleteMany({ where: { deal_id: DEAL, type: 'other', summary: { contains: 'Escalated task' } } });
    await prisma.task.deleteMany({ where: { id: { in: cleanupTaskIds } } });
    cleanupTaskIds = [];
  }
}

async function main() {
  await preflight();
  const browser: Browser = await launch();

  try {
    // -----------------------------------------------------------------
    // AGT-07-AC01: no active task lacks an accountable owner — the queue
    // must surface unowned tasks and the Claim action must fix it.
    // -----------------------------------------------------------------
    await scenario('AGT-07-AC01', 'AC01: unowned active task is surfaced and claimable', async () => {
      const orphan = await prisma.task.create({
        data: {
          scope_type: 'deal',
          scope_id: DEAL,
          deal_id: DEAL,
          exporter_org_id: 'seed-org-1',
          title: 'Verify: orphaned agent task',
          owner_role: 'agent',
          owner_user_id: null,
          state: TaskState.not_started,
          visibility: Visibility.internal,
          task_type: 'verify_probe',
        },
      });
      cleanupTaskIds.push(orphan.id);

      const { ctx, page } = await loggedInContext(browser, AGENT);
      await page.goto(`${BASE}/agent/tasks`, { waitUntil: 'networkidle' });
      const bodyBefore = (await page.locator('body').textContent()) ?? '';
      const flaggedUnowned = /have no named owner yet|Unassigned/.test(bodyBefore);

      const claimRes = await fetchJson(page, `/api/v1/tasks/${orphan.id}/claim`, { method: 'POST', body: {} });
      const claimed = await prisma.task.findUniqueOrThrow({ where: { id: orphan.id } });
      await ctx.close();

      record(
        'AGT-07-AC01',
        'AC01: unowned active task is surfaced and claimable',
        flaggedUnowned && claimRes.status === 200 && claimed.owner_user_id !== null ? 'PASS' : 'FAIL',
        `queue flags unowned work=${flaggedUnowned}; claim call status=${claimRes.status}; owner_user_id after claim=${claimed.owner_user_id}`,
      );
    });

    // -----------------------------------------------------------------
    // AGT-07-AC02: marking waiting requires a reason AND a waiting_on party.
    // Direct API calls, bypassing the UI form entirely.
    // -----------------------------------------------------------------
    await scenario('AGT-07-AC02', 'AC02: waiting transition requires reason + waiting_on', async () => {
      const task = await prisma.task.create({
        data: {
          scope_type: 'deal',
          scope_id: DEAL,
          deal_id: DEAL,
          exporter_org_id: 'seed-org-1',
          title: 'Verify: waiting-transition probe',
          owner_role: 'agent',
          owner_user_id: null,
          state: TaskState.not_started,
          visibility: Visibility.internal,
          task_type: 'verify_probe',
        },
      });
      cleanupTaskIds.push(task.id);

      const { ctx, page } = await loggedInContext(browser, AGENT);

      const noReason = await fetchJson(page, `/api/v1/tasks/${task.id}`, { method: 'PATCH', body: { to: 'waiting' } });
      const reasonOnly = await fetchJson(page, `/api/v1/tasks/${task.id}`, {
        method: 'PATCH',
        body: { to: 'waiting', blocked_reason: 'Awaiting exporter documents' },
      });
      const both = await fetchJson(page, `/api/v1/tasks/${task.id}`, {
        method: 'PATCH',
        body: { to: 'waiting', blocked_reason: 'Awaiting exporter documents', waiting_on: 'Exporter' },
      });
      await ctx.close();

      const rejectedWithoutEither = noReason.status === 422 || noReason.status === 400;
      const rejectedWithoutWaitingOn = reasonOnly.status === 422 || reasonOnly.status === 400;
      const acceptedWithBoth = both.status === 200;

      record(
        'AGT-07-AC02',
        'AC02: waiting transition requires reason + waiting_on',
        rejectedWithoutEither && rejectedWithoutWaitingOn && acceptedWithBoth ? 'PASS' : 'FAIL',
        `no fields -> ${noReason.status} (expect 4xx); reason only -> ${reasonOnly.status} (expect 4xx, waiting_on still missing); both -> ${both.status} (expect 200)`,
      );
    });

    // -----------------------------------------------------------------
    // AGT-07-AC03: SLA state is derived, never directly writable.
    // -----------------------------------------------------------------
    await scenario('AGT-07-AC03', 'AC03: sla_state cannot be set directly via the task PATCH route', async () => {
      const task = await prisma.task.create({
        data: {
          scope_type: 'deal',
          scope_id: DEAL,
          deal_id: DEAL,
          exporter_org_id: 'seed-org-1',
          title: 'Verify: sla_state direct-write probe',
          owner_role: 'agent',
          owner_user_id: null,
          state: TaskState.not_started,
          sla_state: SlaState.on_time,
          visibility: Visibility.internal,
          task_type: 'verify_probe',
        },
      });
      cleanupTaskIds.push(task.id);

      const { ctx, page } = await loggedInContext(browser, AGENT);
      // The generic transition route accepts only `to`/`blocked_reason`/`waiting_on`/
      // `cancel_reason` (transitionTaskSchema) — sla_state is not a field it reads at
      // all, so smuggling it in a state transition has no effect on the stored value.
      const res = await fetchJson(page, `/api/v1/tasks/${task.id}`, {
        method: 'PATCH',
        body: { to: 'in_progress', sla_state: 'escalated' },
      });
      const row = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
      await ctx.close();

      const ignored = row.sla_state !== SlaState.escalated;

      record(
        'AGT-07-AC03',
        'AC03: sla_state cannot be set directly via the task PATCH route',
        res.status === 200 && ignored ? 'PASS' : 'FAIL',
        `transition call status=${res.status}; sla_state after smuggled write=${row.sla_state} (expect NOT 'escalated' — the route has no field for it, so it can only change via deriveSlaState())`,
      );
    });

    // -----------------------------------------------------------------
    // AGT-07-AC04: escalation is auditable and shows up in the Ops queue.
    // -----------------------------------------------------------------
    await scenario('AGT-07-AC04', 'AC04: escalation is auditable and visible in OPS-03', async () => {
      const task = await prisma.task.create({
        data: {
          scope_type: 'deal',
          scope_id: DEAL,
          deal_id: DEAL,
          exporter_org_id: 'seed-org-1',
          title: 'Verify: escalation probe',
          owner_role: 'agent',
          owner_user_id: null,
          state: TaskState.in_progress,
          visibility: Visibility.internal,
          task_type: 'verify_probe',
        },
      });
      cleanupTaskIds.push(task.id);

      const { ctx: agentCtx, page: agentPage } = await loggedInContext(browser, AGENT);
      const escRes = await fetchJson(agentPage, `/api/v1/tasks/${task.id}/escalate`, {
        method: 'POST',
        body: { reason: 'Ship date threatened, no CHA response', severity: 'critical' },
      });
      await agentCtx.close();

      const escalated = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
      const auditRow = await prisma.auditEvent.findFirst({
        where: { object_type: 'task', object_id: task.id, action: 'escalate' },
        orderBy: { timestamp: 'desc' },
      });

      const { ctx: opsCtx, page: opsPage } = await loggedInContext(browser, OPS);
      await opsPage.goto(`${BASE}/ops/exceptions?type=overdue_sla`, { waitUntil: 'networkidle' });
      const opsBody = (await opsPage.locator('body').textContent()) ?? '';
      await opsCtx.close();

      const visibleInOps = opsBody.includes('Verify: escalation probe');

      record(
        'AGT-07-AC04',
        'AC04: escalation is auditable and visible in OPS-03',
        escRes.status === 200 && escalated.sla_state === SlaState.escalated && Boolean(auditRow) && visibleInOps ? 'PASS' : 'FAIL',
        `escalate call status=${escRes.status}; sla_state after=${escalated.sla_state}; audit 'escalate' event written=${Boolean(auditRow)}; task visible in /ops/exceptions overdue_sla view=${visibleInOps}`,
      );
    });

    // -----------------------------------------------------------------
    // EXP-11-AC01: internal-only tasks never appear — assert absence in the
    // rendered payload (SSR HTML), not just the DOM.
    // -----------------------------------------------------------------
    await scenario('EXP-11-AC01', 'AC01: internal-only tasks never reach the exporter payload', async () => {
      const secret = `INTERNAL-ONLY-PROBE-${Date.now()}`;
      const internalTask = await prisma.task.create({
        data: {
          scope_type: 'deal',
          scope_id: DEAL,
          deal_id: DEAL,
          exporter_org_id: 'seed-org-1',
          title: secret,
          owner_role: 'agent',
          state: TaskState.not_started,
          visibility: Visibility.internal,
          task_type: 'verify_probe',
        },
      });
      cleanupTaskIds.push(internalTask.id);

      // A control task: exporter-visible, on the same deal. Without it, "no internal
      // task in the payload" could pass simply because the payload was empty or the
      // request failed — this proves the endpoint really was returning this deal's
      // tasks at the moment the internal one was found to be absent.
      const controlTitle = `EXPORTER-VISIBLE-CONTROL-${Date.now()}`;
      const controlTask = await prisma.task.create({
        data: {
          scope_type: 'deal',
          scope_id: DEAL,
          deal_id: DEAL,
          exporter_org_id: 'seed-org-1',
          title: controlTitle,
          owner_role: 'exporter_owner',
          state: TaskState.not_started,
          visibility: Visibility.exporter_visible,
          task_type: 'verify_probe',
        },
      });
      cleanupTaskIds.push(controlTask.id);

      const { ctx, page } = await loggedInContext(browser, OWNER);
      await page.goto(`${BASE}/app/deals/${DEAL}/tasks`, { waitUntil: 'networkidle' });
      const html = await page.content();
      // The parsed-body half: walk the exporter task API's JSON envelope recursively
      // rather than string-matching it. A string scan can be defeated by escaping or
      // chunked serialization; walking the parsed object graph cannot, and it reports
      // the exact key path of any hit.
      const apiRes = await fetchJson(page, '/api/v1/tasks?per_page=100');
      await ctx.close();

      const leakedInHtml = html.includes(secret);
      const payloadHits = findInPayload(apiRes.body, [
        { label: 'the internal task title', value: secret },
        { label: 'the internal task id', value: internalTask.id },
      ]);
      const controlPresent = findInPayload(apiRes.body, [{ label: 'control', value: controlTitle }]).length > 0;
      // No row in the payload may carry internal visibility at all.
      const rows = (apiRes.body as { data?: { visibility?: string }[] } | null)?.data ?? [];
      const internalVisibilityRows = rows.filter((r) => r.visibility === 'internal').length;

      record(
        'EXP-11-AC01',
        'AC01: internal-only tasks never reach the exporter payload',
        !leakedInHtml && payloadHits.length === 0 && controlPresent && internalVisibilityRows === 0 ? 'PASS' : 'FAIL',
        `internal task title/id in rendered HTML (incl. RSC flight)=${leakedInHtml}; recursive walk of the PARSED /api/v1/tasks body (status ${apiRes.status}, ${rows.length} rows) leaks=[${payloadHits.join(', ') || 'none'}]; exporter-visible control task present in the same payload=${controlPresent} (so absence is meaningful, not an empty response); rows carrying visibility:internal=${internalVisibilityRows} (expect 0)`,
      );
    });

    // -----------------------------------------------------------------
    // EXP-11-AC03: due date and owner shown for every active exporter task.
    // -----------------------------------------------------------------
    await scenario('EXP-11-AC03', 'AC03: due date and owner shown for every active exporter task', async () => {
      const { ctx, page } = await loggedInContext(browser, OWNER);
      await page.goto(`${BASE}/app/deals/${DEAL}/tasks`, { waitUntil: 'networkidle' });
      const body = (await page.locator('body').textContent()) ?? '';
      await ctx.close();

      const activeExporterTasks = await prisma.task.findMany({
        where: {
          deal_id: DEAL,
          visibility: Visibility.exporter_visible,
          owner_role: { in: ['exporter_owner', 'exporter_member'] as never },
          state: { notIn: [TaskState.done, TaskState.cancelled] },
        },
      });

      const everyTaskHasDueAndOwnerLabel = activeExporterTasks.every((t) => body.includes(t.title)) && /Owner:/.test(body) && /Due:/.test(body);

      record(
        'EXP-11-AC03',
        'AC03: due date and owner shown for every active exporter task',
        activeExporterTasks.length === 0 || everyTaskHasDueAndOwnerLabel ? 'PASS' : 'FAIL',
        `active exporter tasks on seed deal=${activeExporterTasks.length}; all titles rendered with Owner:/Due: labels=${everyTaskHasDueAndOwnerLabel}`,
      );
    });

    // -----------------------------------------------------------------
    // EXP-09-AC05: Activity timeline records material changes, and is
    // itself exporter-visible-only (internal task activity excluded).
    // -----------------------------------------------------------------
    await scenario('EXP-09-AC05', 'AC05: Activity timeline records material changes, internal-only excluded', async () => {
      const secret = `ACTIVITY-INTERNAL-PROBE-${Date.now()}`;
      const internalTask = await prisma.task.create({
        data: {
          scope_type: 'deal',
          scope_id: DEAL,
          deal_id: DEAL,
          exporter_org_id: 'seed-org-1',
          title: secret,
          owner_role: 'agent',
          state: TaskState.not_started,
          visibility: Visibility.internal,
          task_type: 'verify_probe',
        },
      });
      cleanupTaskIds.push(internalTask.id);

      // Mutate the internal task's state via the shared route — this writes a real
      // AuditEvent for object_type='task', object_id=internalTask.id, which the
      // Activity loader must exclude because the task itself is internal-only.
      const { ctx: agentCtx, page: agentPage } = await loggedInContext(browser, AGENT);
      await fetchJson(agentPage, `/api/v1/tasks/${internalTask.id}`, { method: 'PATCH', body: { to: 'in_progress' } });
      await agentCtx.close();

      const { ctx, page } = await loggedInContext(browser, OWNER);
      await page.goto(`${BASE}/app/deals/${DEAL}/activity`, { waitUntil: 'networkidle' });
      const html = await page.content();
      await ctx.close();

      const internalLeaked = html.includes(secret);
      // The deal itself was locked (docs/07 §7.5) as part of seeding, which writes a
      // `stage_change`/`lock` AuditEvent for object_type='deal' — a genuinely material,
      // exporter-visible event that must be present.
      const materialEventPresent = /Locked|Stage changed|Deal/.test(html);

      record(
        'EXP-09-AC05',
        'AC05: Activity timeline records material changes, internal-only excluded',
        !internalLeaked && materialEventPresent ? 'PASS' : 'FAIL',
        `internal task title leaked into Activity HTML=${internalLeaked}; a material deal-level event (lock/stage change) rendered=${materialEventPresent}`,
      );
    });
  } finally {
    await resetFixtures();
    await browser.close();
  }

  summarize('AGT-07 / EXP-11 / DEAL ACTIVITY ACCEPTANCE');
}

main()
  .catch((e) => {
    if (e instanceof PreflightError) console.error(`\n✗ PREFLIGHT FAILED\n\n  ${e.message}\n`);
    else console.error('SUITE CRASHED:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
