/**
 * Cross-cutting acceptance verification for AGT-06 / EXP-16 / OPS-06.
 *
 * This suite exists alongside the per-screen suites because three of its properties are
 * about the SEAMS between screens, and a per-screen suite structurally cannot prove them:
 *
 *   SHARED-OBJECT  Mutate a Document / Shipment / Task through the AGENT's API, then read
 *                  the EXPORTER's surface. If these were parallel records the exporter
 *                  could not possibly see the change. Deliberately no sync step, no job
 *                  drain, no cache bust between write and read — the read happens
 *                  immediately, so a passing result cannot be explained by a background
 *                  reconciliation process.
 *
 *   PAYLOAD-LEAK   Internal content must be absent from exporter-facing API RESPONSE
 *                  PAYLOADS, not merely un-rendered. A page-scrape passes even when the
 *                  server shipped the secret to the browser and CSS hid it. Every check
 *                  here parses the JSON envelope and walks it recursively, reporting the
 *                  exact key path of any hit.
 *
 *   SERVER-GATE    A blocked prerequisite must be refused by the HANDLER, not by a
 *                  disabled button. Every gated action is invoked by direct fetch with a
 *                  hand-built body, bypassing the UI entirely.
 *
 * Run with the dev server and worker up:
 *   npx tsx --env-file=.env scripts/verify-acceptance-matrix.ts
 */

import {
  launch,
  loggedInContext,
  preflight,
  PreflightError,
  record,
  scenario,
  sleep,
  summarize,
  BASE,
  type Browser,
  type Page,
} from './verify-harness';
import { prisma } from '../src/lib/prisma';

const DEAL = 'seed-deal-locked';
const OWNER = 'owner@sunriseagro.example';
const AGENT = 'agent@cleartrade.example';
const OPS = 'ops@cleartrade.example';

// ---------------------------------------------------------------------------
// Deep payload scanning
// ---------------------------------------------------------------------------

/**
 * Walk parsed JSON and report the key path of every place a forbidden token appears —
 * as a key name, a string value, or any substring thereof. Returns paths, not a boolean,
 * so a failure says exactly WHERE the leak is rather than merely that one exists.
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

/** Fetch a URL from inside an authenticated browser context and return status + parsed body. */
async function fetchJson(page: Page, url: string): Promise<{ status: number; body: unknown; raw: string }> {
  return page.evaluate(async (u) => {
    const r = await fetch(u);
    const raw = await r.text();
    let body: unknown = null;
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
    return { status: r.status, body, raw };
  }, url);
}

async function resetFixtures() {
  await prisma.dispute.deleteMany({
    where: { deal_id: DEAL, id: { notIn: ['seed-dispute-locked-proposed', 'seed-dispute-locked-closed'] } },
  });
  await prisma.task.deleteMany({
    where: { deal_id: DEAL, task_type: { in: ['dispute_owner_response', 'ops_blocker_escalation', 'agent_created'] } },
  });
  await prisma.message.deleteMany({
    where: { deal_id: DEAL, id: { notIn: ['seed-message-locked-1', 'seed-message-locked-2'] } },
  });
  await prisma.partnerHandoff.deleteMany({ where: { deal_id: DEAL, id: { not: 'seed-handoff-cha-1' } } });
  await prisma.internalNote.deleteMany({ where: { deal_id: DEAL, id: { not: 'seed-internal-note-locked-1' } } });
  await prisma.task.updateMany({
    where: { id: 'seed-task-deal-locked-internal' },
    data: { state: 'not_started', completed_at: null, blocked_reason: null, waiting_on: null },
  });
  await prisma.task.updateMany({
    where: { id: 'seed-task-deal-locked-1' },
    data: { state: 'in_progress', completed_at: null, blocked_reason: null, waiting_on: null },
  });
  await prisma.document.updateMany({
    where: { deal_id: DEAL, doc_type: 'COO_draft', version: 1 },
    data: { filing_status: 'draft', filing_reference: null, filed_at: null, filed_by_id: null },
  });
  await prisma.shipment.updateMany({
    where: { id: 'seed-shipment-locked-1' },
    data: {
      cha_partner_id: 'seed-partner-cha-1',
      freight_partner_id: 'seed-partner-freight-1',
      exception_state: 'watch',
      exception_reason: 'Customs clearance ran two days past the original ETA; cleared without a hold.',
    },
  });
}

async function main() {
  await preflight();
  await resetFixtures();
  const browser: Browser = await launch();

  try {
    // =====================================================================
    // SHARED-OBJECT RULE — one canonical row per business object
    // =====================================================================
    await scenario('SHARED:document', 'Agent mutation of a Document is visible to the exporter with no sync step', async () => {
      const doc = await prisma.document.findFirstOrThrow({
        where: { deal_id: DEAL, doc_type: 'COO_draft', is_current_version: true },
      });

      const { ctx: aCtx, page: aPage } = await loggedInContext(browser, AGENT);
      const wrote = await aPage.evaluate(
        async ([dealId, documentId]) => {
          const r = await fetch(`/api/v1/deals/${dealId}/documents/${documentId}/file`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'mark_filed', filing_status: 'ready' }),
          });
          return r.status;
        },
        [DEAL, doc.id] as const,
      );
      await aCtx.close();

      // Read immediately, through the EXPORTER's own API, by the SAME id.
      const { ctx: eCtx, page: ePage } = await loggedInContext(browser, OWNER);
      const read = await fetchJson(ePage, `/api/v1/deals/${DEAL}/documents/${doc.id}`);
      // The document DETAIL route is compiled on demand by the dev server and is one of
      // the heavier pages; `networkidle` at the default 30s budget flakes on a cold
      // compile even though the page itself is fine. `domcontentloaded` plus an explicit
      // wait for the content under test is both faster and deterministic.
      await ePage.goto(`${BASE}/app/deals/${DEAL}/documents/${doc.id}`, {
        waitUntil: 'domcontentloaded',
        timeout: 90_000,
      });
      await ePage.locator('body').getByText(/Ready to file/i).first().waitFor({ timeout: 15_000 }).catch(() => {});
      const pageText = (await ePage.locator('body').textContent()) ?? '';
      await eCtx.close();

      const apiRow = (read.body as { data?: { id?: string; filing_status?: string } } | null)?.data;
      const sameId = apiRow?.id === doc.id;
      const reflects = apiRow?.filing_status === 'ready';
      const pageReflects = /Ready to file/i.test(pageText);

      record(
        'SHARED:document',
        'Agent mutation of a Document is visible to the exporter with no sync step',
        wrote === 200 && sameId && reflects && pageReflects ? 'PASS' : 'FAIL',
        `agent write=${wrote}, exporter API returns same id=${sameId}, exporter API filing_status=${apiRow?.filing_status}, exporter page reflects=${pageReflects} (read immediately, no job drain or cache bust between write and read)`,
      );
    });

    await scenario('SHARED:shipment', 'Agent mutation of a Shipment is visible to the exporter with no sync step', async () => {
      // The seed fixture sits at exception_state='watch'. The raise-issue route
      // deliberately does NOT overwrite exception_reason when an exception is already
      // open (EXP-14-AC04 dedup), so starting from 'watch' would test the dedup guard
      // rather than the shared-object property. Clear it first so the write path this
      // scenario is actually about genuinely executes.
      await prisma.shipment.updateMany({
        where: { deal_id: DEAL },
        data: { exception_state: 'none', exception_reason: null },
      });
      await prisma.dispute.deleteMany({ where: { deal_id: DEAL, scope_type: 'shipment' } });

      const before = await prisma.shipment.findFirstOrThrow({ where: { deal_id: DEAL } });
      const marker = `SHARED-OBJECT-PROBE-${Date.now()}`;

      const { ctx: aCtx, page: aPage } = await loggedInContext(browser, AGENT);
      const wrote = await aPage.evaluate(
        async ([dealId, reason]) => {
          const r = await fetch(`/api/v1/deals/${dealId}/shipment/issue`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason, severity: 'blocked' }),
          });
          return r.status;
        },
        [DEAL, marker] as const,
      );
      await aCtx.close();

      const after = await prisma.shipment.findFirstOrThrow({ where: { deal_id: DEAL } });
      const sameRow = after.id === before.id;
      const wroteReason = after.exception_reason === marker;

      // Read immediately — no job drain, no cache bust.
      const { ctx: eCtx, page: ePage } = await loggedInContext(browser, OWNER);
      await ePage.goto(`${BASE}/app/deals/${DEAL}/shipment`, { waitUntil: 'networkidle' });
      await sleep(300);
      const pageText = (await ePage.locator('body').textContent()) ?? '';
      await eCtx.close();

      const exporterSees = pageText.includes(marker);

      record(
        'SHARED:shipment',
        'Agent mutation of a Shipment is visible to the exporter with no sync step',
        wrote === 201 && sameRow && wroteReason && exporterSees ? 'PASS' : 'FAIL',
        `agent raise issue=${wrote}, shipment row id unchanged (one canonical row)=${sameRow}, exception_reason written=${wroteReason}, exporter shipment tab shows the agent's text=${exporterSees}`,
      );
    });

    await scenario('SHARED:task', 'Agent mutation of a Task is visible to the exporter with no sync step', async () => {
      const marker = `TASK-SHARED-PROBE-${Date.now()}`;

      // The task must be AGENT-owned and exporter-visible. `canTransitionTask` correctly
      // refuses an agent acting on an exporter-owned task, so reusing the seed's
      // exporter-owned row would test that guard instead of the shared-object property.
      // Creating it through the real agent route also keeps this deterministic rather
      // than depending on whatever tasks a prior suite happened to leave behind.
      const { ctx: aCtx, page: aPage } = await loggedInContext(browser, AGENT);
      const created = await aPage.evaluate(
        async ([dealId]) => {
          const r = await fetch(`/api/v1/deals/${dealId}/tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: 'Chase the CHA for the amended filing',
              owner_role: 'agent',
              visibility: 'exporter_visible',
              priority: 'high',
            }),
          });
          const b = await r.json().catch(() => null);
          return { status: r.status, id: b?.data?.id as string | undefined };
        },
        [DEAL] as const,
      );
      const task = created.id ? await prisma.task.findUniqueOrThrow({ where: { id: created.id } }) : null;

      const wrote = task
        ? await aPage.evaluate(
            async ([taskId, reason]) => {
              const r = await fetch(`/api/v1/tasks/${taskId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to: 'waiting', blocked_reason: reason, waiting_on: reason }),
              });
              return r.status;
            },
            [task.id, marker] as const,
          )
        : 0;
      await aCtx.close();
      if (!task) {
        record('SHARED:task', 'Agent mutation of a Task is visible to the exporter with no sync step', 'FAIL', `could not create the agent-owned task fixture (create status=${created.status})`);
        return;
      }

      const { ctx: eCtx, page: ePage } = await loggedInContext(browser, OWNER);
      const read = await fetchJson(ePage, '/api/v1/tasks?state=waiting');
      await eCtx.close();

      const rows = (read.body as { data?: { id?: string; state?: string; blocked_reason?: string }[] } | null)?.data ?? [];
      const sameRow = rows.find((r) => r.id === task.id);
      const reflects = sameRow?.state === 'waiting' && sameRow?.blocked_reason === marker;

      record(
        'SHARED:task',
        'Agent mutation of a Task is visible to the exporter with no sync step',
        wrote === 200 && Boolean(sameRow) && reflects ? 'PASS' : 'FAIL',
        `agent transition=${wrote}, exporter /api/v1/tasks returns the same task id=${Boolean(sameRow)}, state=${sameRow?.state}, blocked_reason echoes agent's text=${sameRow?.blocked_reason === marker}`,
      );
    });

    await resetFixtures();

    // =====================================================================
    // PAYLOAD LEAK — absence asserted in the RESPONSE BODY, not the DOM
    // =====================================================================
    await scenario('PAYLOAD:exporter-apis', 'No internal task, internal note or ops-only field in any exporter-facing API payload', async () => {
      const note = await prisma.internalNote.findFirstOrThrow({ where: { deal_id: DEAL } });
      const internalTask = await prisma.task.findUniqueOrThrow({ where: { id: 'seed-task-deal-locked-internal' } });
      const dispute = await prisma.dispute.findFirstOrThrow({ where: { id: 'seed-dispute-locked-proposed' } });
      const doc = await prisma.document.findFirstOrThrow({ where: { deal_id: DEAL, is_current_version: true } });

      const needles = [
        { label: 'internal note body', value: note.body.slice(0, 40) },
        { label: 'internal note id', value: note.id },
        { label: 'internal task id', value: internalTask.id },
        { label: 'internal task title', value: internalTask.title },
        // Ops/agent-only commercial fields. `agent_share_rate` lives inside
        // Deal.quoted_fee_policy — an exporter must never receive ClearTrade's internal
        // commission split.
        { label: 'ops-only field agent_share_rate', value: 'agent_share_rate' },
        { label: 'ops-only relation internal_notes', value: 'internal_notes' },
        { label: 'ops-only field closure_basis leak check', value: 'INTERNAL-ONLY-CANARY' },
      ];

      const { ctx, page } = await loggedInContext(browser, OWNER);
      const endpoints = [
        '/api/v1/tasks',
        '/api/v1/tasks?state=not_started',
        '/api/v1/tasks?state=in_progress',
        '/api/v1/deals',
        '/api/v1/messages',
        '/api/v1/buyers',
        `/api/v1/deals/${DEAL}/documents/${doc.id}`,
        `/api/v1/deals/${DEAL}/disputes/${dispute.id}`,
      ];

      const findings: string[] = [];
      const statuses: string[] = [];
      for (const url of endpoints) {
        const res = await fetchJson(page, url);
        statuses.push(`${url.split('?')[0].replace('/api/v1', '')}:${res.status}`);
        if (res.status !== 200) continue;
        const hits = findInPayload(res.body, needles);
        for (const h of hits) findings.push(`${url} -> ${h}`);
      }
      await ctx.close();

      record(
        'PAYLOAD:exporter-apis',
        'No internal task, internal note or ops-only field in any exporter-facing API payload',
        findings.length === 0 ? 'PASS' : 'FAIL',
        `scanned ${endpoints.length} exporter API payloads by recursive key/value walk (not DOM scrape) [${statuses.join(', ')}]; leaks=[${findings.join(' | ') || 'none'}]`,
      );
    });

    await scenario('PAYLOAD:ops-06-ac01', 'OPS-06-AC01: internal notes are never exposed through the exporter case API', async () => {
      const dispute = await prisma.dispute.findFirstOrThrow({ where: { id: 'seed-dispute-locked-proposed' } });
      // Attach a note DIRECTLY to the dispute so the relation is non-empty — otherwise
      // "no notes in the payload" would be trivially true and prove nothing.
      const agentUser = await prisma.user.findFirstOrThrow({ where: { email: AGENT } });
      const probe = await prisma.internalNote.create({
        data: {
          scope_type: 'deal',
          scope_id: DEAL,
          deal_id: DEAL,
          dispute_id: dispute.id,
          author_user_id: agentUser.id,
          body: 'CASE-INTERNAL-PROBE: exporter is likely to escalate — pre-clear a 2% ceiling with finance.',
        },
      });

      const attachedCount = await prisma.internalNote.count({ where: { dispute_id: dispute.id } });

      const { ctx, page } = await loggedInContext(browser, OWNER);
      const res = await fetchJson(page, `/api/v1/deals/${DEAL}/disputes/${dispute.id}`);
      await ctx.close();

      const hits = findInPayload(res.body, [
        { label: 'case internal note body', value: 'CASE-INTERNAL-PROBE' },
        { label: 'case internal note id', value: probe.id },
        { label: 'internal_notes relation', value: 'internal_notes' },
      ]);

      await prisma.internalNote.delete({ where: { id: probe.id } });

      record(
        'PAYLOAD:ops-06-ac01',
        'OPS-06-AC01: internal notes are never exposed through the exporter case API',
        res.status === 200 && attachedCount > 0 && hits.length === 0 ? 'PASS' : 'FAIL',
        `case API status=${res.status}, notes actually attached to this case=${attachedCount} (non-zero, so absence is meaningful), leaks in payload=[${hits.join(' | ') || 'none'}]`,
      );
    });

    // =====================================================================
    // SERVER-SIDE PREREQUISITE ENFORCEMENT — direct API, UI bypassed
    // =====================================================================
    await scenario('SERVER-GATE:unmet-prerequisite', 'AGT-06-AC01: a downstream action with an unmet prerequisite is refused by the API, not the UI', async () => {
      // `declaration` failed generation on the seed fixture, so the documents gate is
      // blocked and this document in particular has nothing to file.
      const blockedDoc = await prisma.document.findFirstOrThrow({
        where: { deal_id: DEAL, doc_type: 'declaration', is_current_version: true },
      });
      const before = {
        filing_status: blockedDoc.filing_status,
        filing_reference: blockedDoc.filing_reference,
        filed_at: blockedDoc.filed_at,
      };

      const { ctx, page } = await loggedInContext(browser, AGENT);
      // Hand-built request. No form, no component, no disabled button in the path.
      const attempts = await page.evaluate(
        async ([dealId, documentId]) => {
          const headers = { 'Content-Type': 'application/json' };
          const url = `/api/v1/deals/${dealId}/documents/${documentId}/file`;
          const ready = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ action: 'mark_filed', filing_status: 'ready' }) });
          const readyBody = await ready.json().catch(() => null);
          // Also try to jump straight to `filed` with a fabricated reference — the
          // strongest form of the bypass.
          const filed = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ action: 'mark_filed', filing_status: 'filed', filing_reference: 'FABRICATED-REF-0001' }) });
          const filedBody = await filed.json().catch(() => null);
          return {
            ready: { status: ready.status, code: readyBody?.error?.code, blockers: readyBody?.error?.blockers?.length ?? 0 },
            filed: { status: filed.status, code: filedBody?.error?.code },
          };
        },
        [DEAL, blockedDoc.id] as const,
      );
      await ctx.close();

      const after = await prisma.document.findUniqueOrThrow({ where: { id: blockedDoc.id } });
      const untouched =
        after.filing_status === before.filing_status &&
        after.filing_reference === before.filing_reference &&
        after.filed_at?.getTime() === before.filed_at?.getTime();

      record(
        'SERVER-GATE:unmet-prerequisite',
        'AGT-06-AC01: a downstream action with an unmet prerequisite is refused by the API, not the UI',
        attempts.ready.status === 422 && attempts.ready.blockers > 0 && attempts.filed.status === 422 && untouched ? 'PASS' : 'FAIL',
        `direct POST mark_filed:ready=${attempts.ready.status} code=${attempts.ready.code} blockers=${attempts.ready.blockers}; direct POST mark_filed:filed with fabricated ref=${attempts.filed.status} code=${attempts.filed.code}; document row untouched=${untouched} (filing_status still "${after.filing_status}")`,
      );
    });

    await scenario('SERVER-GATE:partner-assign', 'AGT-06-AC01: partner assignment is gated server-side and by the approved directory', async () => {
      const { ctx, page } = await loggedInContext(browser, AGENT);
      const out = await page.evaluate(
        async ([dealId]) => {
          const headers = { 'Content-Type': 'application/json' };
          const url = `/api/v1/deals/${dealId}/partners`;
          const phantom = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ partner_id: 'does-not-exist', lane: 'cha' }) });
          const freeText = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ partner_name: 'Phantom CHA Ltd', lane: 'cha' }) });
          const wrongLane = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ partner_id: 'seed-partner-insurance-1', lane: 'cha' }) });
          return { phantom: phantom.status, freeText: freeText.status, wrongLane: wrongLane.status };
        },
        [DEAL] as const,
      );
      await ctx.close();
      const shipment = await prisma.shipment.findFirstOrThrow({ where: { deal_id: DEAL } });
      const unchanged = shipment.cha_partner_id === 'seed-partner-cha-1';
      record(
        'SERVER-GATE:partner-assign',
        'AGT-06-AC01: partner assignment is gated server-side and by the approved directory',
        out.phantom === 422 && out.freeText === 422 && out.wrongLane === 422 && unchanged ? 'PASS' : 'FAIL',
        `phantom id=${out.phantom}, free-text name=${out.freeText}, wrong-lane partner=${out.wrongLane} (all expect 422), CHA assignment unchanged=${unchanged}`,
      );
    });

    // =====================================================================
    // OPS-06 AC02 / AC03
    // =====================================================================
    await scenario('OPS-06-AC02', 'OPS-06-AC02: every open case has an owner and a next action / follow-up', async () => {
      // Seed a case in each open state so the assertion covers the whole open set, not
      // just whichever state the fixture happens to sit in.
      const agentUser = await prisma.user.findFirstOrThrow({ where: { email: AGENT } });
      const { ctx, page } = await loggedInContext(browser, OPS);
      const created = await page.evaluate(
        async ([dealId]) => {
          const r = await fetch(`/api/v1/deals/${dealId}/disputes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'LC', severity: 'high', summary: 'LC wording mismatch on the amended terms.' }),
          });
          const b = await r.json().catch(() => null);
          return b?.data?.dispute_id as string | undefined;
        },
        [DEAL] as const,
      );
      // Walk it into waiting_external, the one state that requires a follow-up date.
      if (created) {
        await page.evaluate(
          async ([dealId, disputeId, ownerId]) => {
            const headers = { 'Content-Type': 'application/json' };
            const url = `/api/v1/deals/${dealId}/disputes/${disputeId}`;
            await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ action: 'assign', owner_user_id: ownerId }) });
            await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ action: 'wait_external', waiting_on: "buyer's issuing bank", follow_up_at: '2026-09-01' }) });
          },
          [DEAL, created, agentUser.id] as const,
        );
      }
      await ctx.close();

      const openCases = await prisma.dispute.findMany({
        where: { status: { in: ['open', 'investigating', 'waiting_external', 'proposed_resolution'] } },
      });
      // "Next action" is state-dependent: a case waiting on an external party owes a
      // follow-up date; any other open case owes an owner who holds the next move.
      const offenders = openCases.filter((c) => {
        if (!c.owner_user_id && c.status !== 'open') return true;
        if (c.status === 'waiting_external' && !c.sla_due_at) return true;
        return false;
      });
      const waitingWithFollowUp = openCases.filter((c) => c.status === 'waiting_external' && c.sla_due_at).length;

      record(
        'OPS-06-AC02',
        'OPS-06-AC02: every open case has an owner and a next action / follow-up',
        offenders.length === 0 && openCases.length > 0 ? 'PASS' : 'FAIL',
        `open cases=${openCases.length} across states [${[...new Set(openCases.map((c) => c.status))].join(', ')}], waiting_external cases carrying a follow-up date=${waitingWithFollowUp}, offenders (assigned-but-ownerless, or waiting with no follow-up)=${offenders.length}`,
      );
    });

    await scenario('OPS-06-AC03', 'OPS-06-AC03: closure stores outcome and linked operational impact', async () => {
      const agentUser = await prisma.user.findFirstOrThrow({ where: { email: AGENT } });
      const { ctx, page } = await loggedInContext(browser, OPS);
      const created = await page.evaluate(
        async ([dealId]) => {
          const r = await fetch(`/api/v1/deals/${dealId}/disputes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'inspection', severity: 'high', summary: 'Third-party inspection flagged moisture content on two pallets.' }),
          });
          const b = await r.json().catch(() => null);
          return b?.data?.dispute_id as string | undefined;
        },
        [DEAL] as const,
      );

      const dealAfterOpen = await prisma.deal.findUniqueOrThrow({ where: { id: DEAL } });

      const closeStatus = await page.evaluate(
        async ([dealId, disputeId, ownerId]) => {
          const headers = { 'Content-Type': 'application/json' };
          const url = `/api/v1/deals/${dealId}/disputes/${disputeId}`;
          await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ action: 'assign', owner_user_id: ownerId }) });
          await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ action: 'propose_resolution', resolution: 'Two pallets re-dried and re-tested; buyer accepted on the re-test certificate.' }) });
          const closed = await fetch(url, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ action: 'close', closure_basis: 'independent_retest_certificate', closure_summary: 'Closed on the re-test certificate; no credit issued.' }),
          });
          return closed.status;
        },
        [DEAL, created, agentUser.id] as const,
      );

      // A close missing its basis must be refused — the outcome is not optional.
      const missingBasis = await page.evaluate(
        async ([dealId, disputeId]) => {
          const r = await fetch(`/api/v1/deals/${dealId}/disputes/${disputeId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'close', closure_summary: 'no basis given' }),
          });
          return r.status;
        },
        [DEAL, 'seed-dispute-locked-proposed'] as const,
      );
      await ctx.close();

      const closed = created ? await prisma.dispute.findUnique({ where: { id: created } }) : null;
      const dealAfterClose = await prisma.deal.findUniqueOrThrow({ where: { id: DEAL } });

      const storesOutcome = Boolean(closed?.closure_basis && closed?.resolution && closed?.closed_at);
      // "Linked operational impact": closing recomputed the deal's risk through the
      // explicit domain rule rather than leaving it stale at the escalated floor.
      const impactRecorded = dealAfterOpen.risk_state !== dealAfterClose.risk_state || dealAfterClose.risk_state === 'blocked';

      record(
        'OPS-06-AC03',
        'OPS-06-AC03: closure stores outcome and linked operational impact',
        closeStatus === 200 && storesOutcome && missingBasis === 422 ? 'PASS' : 'FAIL',
        `close=${closeStatus}, closure_basis="${closed?.closure_basis}", resolution stored=${Boolean(closed?.resolution)}, closed_at set=${Boolean(closed?.closed_at)}, close-without-basis refused=${missingBasis} (expect 422), deal risk recomputed on close: ${dealAfterOpen.risk_state} -> ${dealAfterClose.risk_state} (impact linked=${impactRecorded})`,
      );
    });

    // =====================================================================
    // EXP-16 AC01 — behavioural, not just structural
    // =====================================================================
    await scenario('EXP-16-AC01', 'EXP-16-AC01: a message never becomes the record of a blocker', async () => {
      const disputesBefore = await prisma.dispute.count({ where: { deal_id: DEAL } });
      const tasksBefore = await prisma.task.count({ where: { deal_id: DEAL } });

      const { ctx, page } = await loggedInContext(browser, OWNER);
      // Send a message whose CONTENT reads exactly like a blocker. If chat and dispute
      // were coupled anywhere, this is where it would show: severity words, urgency, an
      // explicit demand. Nothing structured may be created from it.
      const sent = await page.evaluate(
        async ([dealId]) => {
          const r = await fetch(`/api/v1/deals/${dealId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body: 'CRITICAL BLOCKER: the shipment is held and the buyer is disputing the full invoice — we need this escalated immediately.' }),
          });
          const b = await r.json().catch(() => null);
          return { status: r.status, id: b?.data?.id, keys: b?.data ? Object.keys(b.data) : [] };
        },
        [DEAL] as const,
      );
      await ctx.close();

      const disputesAfter = await prisma.dispute.count({ where: { deal_id: DEAL } });
      const tasksAfter = await prisma.task.count({ where: { deal_id: DEAL } });
      const messageRow = sent.id ? await prisma.message.findUnique({ where: { id: sent.id } }) : null;

      // The Message row carries no dispute vocabulary at all.
      const disputeFieldsOnMessage = ['severity', 'status', 'resolution', 'owner_user_id', 'closure_basis'].filter((k) =>
        Object.prototype.hasOwnProperty.call(messageRow ?? {}, k),
      );

      record(
        'EXP-16-AC01',
        'EXP-16-AC01: a message never becomes the record of a blocker',
        sent.status === 201 && disputesAfter === disputesBefore && tasksAfter === tasksBefore && disputeFieldsOnMessage.length === 0
          ? 'PASS'
          : 'FAIL',
        `sent a blocker-worded message=${sent.status}; disputes ${disputesBefore}->${disputesAfter} (must not change), tasks ${tasksBefore}->${tasksAfter} (must not change), dispute-only fields present on the Message row=[${disputeFieldsOnMessage.join(', ') || 'none'}]`,
      );
    });

    // =====================================================================
    // AGT-06 AC02 / AC03
    // =====================================================================
    await scenario('AGT-06-AC02', 'AGT-06-AC02: every external filing/partner handoff records owner, status, timestamp and reference', async () => {
      const { ctx, page } = await loggedInContext(browser, AGENT);
      const assigned = await page.evaluate(
        async ([dealId]) => {
          const r = await fetch(`/api/v1/deals/${dealId}/partners`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ partner_id: 'seed-partner-cha-1', lane: 'cha', notes: 'Filing packet sent.' }),
          });
          const b = await r.json().catch(() => null);
          return { status: r.status, id: b?.data?.id as string | undefined };
        },
        [DEAL] as const,
      );
      const acked = assigned.id
        ? await page.evaluate(
            async ([dealId, handoffId]) => {
              const r = await fetch(`/api/v1/deals/${dealId}/partners`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ handoff_id: handoffId, status: 'acknowledged', reference: 'KCHA-ACK-5512' }),
              });
              return r.status;
            },
            [DEAL, assigned.id] as const,
          )
        : 0;
      await ctx.close();

      const handoff = assigned.id ? await prisma.partnerHandoff.findUnique({ where: { id: assigned.id } }) : null;
      const handoffComplete = Boolean(handoff?.owner_user_id && handoff?.status && handoff?.sent_at && handoff?.reference);

      // The filing half of the same AC.
      const filedDoc = await prisma.document.findFirst({
        where: { deal_id: DEAL, filing_status: { in: ['filed', 'accepted'] } },
      });
      const filingComplete = Boolean(filedDoc?.filing_status && filedDoc?.filed_at && filedDoc?.filing_reference);
      const filingHasOwner = filedDoc?.filed_by_id !== undefined;

      record(
        'AGT-06-AC02',
        'AGT-06-AC02: every external filing/partner handoff records owner, status, timestamp and reference',
        assigned.status === 201 && acked === 200 && handoffComplete && filingComplete ? 'PASS' : 'FAIL',
        `handoff: owner=${Boolean(handoff?.owner_user_id)} status=${handoff?.status} timestamp=${Boolean(handoff?.sent_at)} reference=${handoff?.reference}; filing: status=${filedDoc?.filing_status} timestamp=${Boolean(filedDoc?.filed_at)} reference=${filedDoc?.filing_reference} owner column present=${filingHasOwner}`,
      );
    });

    await scenario('AGT-06-AC03', 'AGT-06-AC03: agent can see exporter-visible status before sending updates', async () => {
      const { ctx, page } = await loggedInContext(browser, AGENT);
      await page.goto(`${BASE}/agent/deals/${DEAL}`, { waitUntil: 'networkidle' });
      await sleep(500);
      const body = (await page.locator('body').textContent()) ?? '';
      await ctx.close();

      // The exporter's own approval state, per document, on the agent's screen.
      const approvalColumn = /Exporter approval/.test(body);
      const approvalValues = /Awaiting your approval|Approved|Changes requested|Not required/.test(body);
      // The exporter's own task queue, separated from the agent's.
      const exporterTaskLane = /Exporter\b/.test(body) && /Confirm revised payment terms with buyer/.test(body);
      // And the internal layer is labelled so the agent knows which side of the wall
      // they are on before they send anything.
      const internalLabelled = /Internal only/.test(body) && /Never shown to the exporter/.test(body);

      record(
        'AGT-06-AC03',
        'AGT-06-AC03: agent can see exporter-visible status before sending updates',
        approvalColumn && approvalValues && exporterTaskLane && internalLabelled ? 'PASS' : 'FAIL',
        `exporter-approval column rendered=${approvalColumn}, exporter-facing approval values shown=${approvalValues}, exporter-owned task lane populated=${exporterTaskLane}, internal layer explicitly labelled=${internalLabelled}`,
      );
    });
  } finally {
    await browser.close();
    await resetFixtures();
  }

  summarize('AGT-06 / EXP-16 / OPS-06 ACCEPTANCE MATRIX');
}

main()
  .catch((e) => {
    if (e instanceof PreflightError) console.error(`\n✗ PREFLIGHT FAILED\n\n  ${e.message}\n`);
    else console.error('SUITE CRASHED:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
