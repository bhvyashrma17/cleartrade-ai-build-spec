/**
 * AGT-06 Deal Execution Workspace verification.
 *
 * Two properties here are asserted STRUCTURALLY rather than by reading the code, because
 * the brief calls them out as the sharpest risks:
 *
 *   A1/A2  Shared objects. The agent workspace must render the SAME canonical rows the
 *          exporter portal renders — not a parallel table, not a copy. Proven by mutating
 *          a record through ONE portal's API and asserting the OTHER portal's rendered
 *          page changes, and by asserting there is no agent-prefixed table in the schema
 *          at all.
 *   L1-L3  Internal leak. A canary string lives in an InternalNote and an internal Task.
 *          Every exporter-facing surface and API response is swept for it.
 *
 * Run with the dev server and worker up:
 *   npx tsx --env-file=.env scripts/verify-agent-execution.ts
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
} from './verify-harness';
import { prisma } from '../src/lib/prisma';

const DEAL = 'seed-deal-locked';
const AGENT = 'agent@cleartrade.example';
const OWNER = 'owner@sunriseagro.example';
const CANARY = 'INTERNAL-ONLY-CANARY';

/**
 * Restore everything a run of this suite mutates. Called before AND after, so a crashed
 * previous run cannot poison this one and this one cannot poison the next suite.
 */
async function resetFixtures() {
  await prisma.dispute.deleteMany({ where: { deal_id: DEAL, scope_type: 'deal' } });
  await prisma.task.deleteMany({ where: { deal_id: DEAL, task_type: { in: ['ops_blocker_escalation', 'agent_created'] } } });
  await prisma.partnerHandoff.deleteMany({ where: { deal_id: DEAL, id: { not: 'seed-handoff-cha-1' } } });
  await prisma.internalNote.deleteMany({ where: { deal_id: DEAL, id: { not: 'seed-internal-note-locked-1' } } });
  await prisma.partnerHandoff.updateMany({
    where: { id: 'seed-handoff-cha-1' },
    data: { status: 'acknowledged', reference: 'KCHA-JOB-77120' },
  });
  await prisma.task.updateMany({
    where: { id: 'seed-task-deal-locked-internal' },
    data: { state: 'not_started', completed_at: null, blocked_reason: null },
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
    data: { cha_partner_id: 'seed-partner-cha-1', freight_partner_id: 'seed-partner-freight-1' },
  });
}

async function main() {
  await preflight();
  await resetFixtures();
  const browser: Browser = await launch();

  try {
    // ---------------------------------------------------------------- A0
    await scenario('A0:renders', 'Execution workspace renders every required zone', async () => {
      const { ctx, page } = await loggedInContext(browser, AGENT);
      const resp = await page.goto(`${BASE}/agent/deals/${DEAL}`, { waitUntil: 'networkidle' });
      await sleep(500);
      const body = (await page.locator('body').textContent()) ?? '';
      await ctx.close();

      const zones = {
        header: /Gulf Foods General Trading/.test(body) && /Sunrise Agro Exports/.test(body) && /USD 42,000/.test(body),
        risk: /Buyer requested a change to payment terms/.test(body),
        checklist: /Dependency checklist/.test(body) && /Terms locked/.test(body) && /CHA & filing/.test(body) && /Customs/.test(body),
        taskBoard: /Task board/.test(body) && /Yours \(agent\)/.test(body) && /Exporter/.test(body) && /Ops/.test(body),
        documents: /Documents/.test(body) && /Exporter approval/.test(body),
        cha: /CHA & freight/.test(body) && /Handoff log/.test(body),
        shipmentPayment: /Shipment/.test(body) && /Payment/.test(body) && /BRC/.test(body),
      };
      const missing = Object.entries(zones).filter(([, ok]) => !ok).map(([k]) => k);
      record(
        'A0:renders',
        'Execution workspace renders every required zone',
        resp?.status() === 200 && missing.length === 0 ? 'PASS' : 'FAIL',
        `http=${resp?.status()}, missing zones=[${missing.join(', ') || 'none'}]`,
      );
    });

    // ---------------------------------------------------------------- A1
    await scenario('A1:no-parallel-tables', 'No agent-side parallel tables exist in the schema', async () => {
      // Ask the DATABASE, not the source. A duplicated agent-side table would show up
      // here even if it were created by a migration nobody reviewed.
      const tables = await prisma.$queryRaw<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      `;
      const names = tables.map((t) => t.table_name);

      // The canonical shared business objects. The rule under test is that each is a
      // SINGLE table with no portal-qualified twin.
      const canonical = ['Document', 'Task', 'Shipment', 'ShipmentMilestone', 'Payment', 'Deal', 'Dispute'];
      const dupes = canonical.filter((c) => names.filter((n) => n.toLowerCase() === c.toLowerCase()).length !== 1);

      // A parallel table would be one of these names qualified by a portal or a copy
      // marker. Matching on a bare `Agent` prefix was too broad: `AgentAssignment` is a
      // legitimate domain record (which agent is assigned to which exporter org) with no
      // exporter-side counterpart to duplicate, so it is not what this rule is about.
      const QUALIFIERS = ['agent', 'ops', 'exporter', 'portal', 'copy', 'mirror', 'view', 'cache'];
      const twins = names.filter((n) => {
        const lower = n.toLowerCase();
        return canonical.some((c) => {
          const base = c.toLowerCase();
          if (lower === base) return false;
          if (!lower.includes(base)) return false;
          const rest = lower.split(base).join('');
          return QUALIFIERS.some((q) => rest.includes(q));
        });
      });

      record(
        'A1:no-parallel-tables',
        'No agent-side parallel tables exist in the schema',
        twins.length === 0 && dupes.length === 0 ? 'PASS' : 'FAIL',
        `tables=${names.length}, portal-qualified twins of a shared object=[${twins.join(', ') || 'none'}], canonical models not exactly-once=[${dupes.join(', ') || 'none'}]`,
      );
    });

    // ---------------------------------------------------------------- A2
    await scenario('A2:same-record', 'Agent and exporter portals render the SAME row, by id', async () => {
      // Mutate through the AGENT's API, then read the EXPORTER's page. If they were
      // separate records the exporter's screen could not possibly change.
      const doc = await prisma.document.findFirstOrThrow({
        where: { deal_id: DEAL, doc_type: 'COO_draft', is_current_version: true },
      });

      const { ctx: agentCtx, page: agentPage } = await loggedInContext(browser, AGENT);
      const filed = await agentPage.evaluate(
        async ([dealId, documentId]) => {
          const res = await fetch(`/api/v1/deals/${dealId}/documents/${documentId}/file`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'mark_filed', filing_status: 'ready' }),
          });
          return { status: res.status };
        },
        [DEAL, doc.id] as const,
      );
      await agentCtx.close();

      const row = await prisma.document.findUniqueOrThrow({ where: { id: doc.id } });

      // Same id, read by the exporter's own document detail page.
      const { ctx: expCtx, page: expPage } = await loggedInContext(browser, OWNER);
      await expPage.goto(`${BASE}/app/deals/${DEAL}/documents/${doc.id}`, { waitUntil: 'networkidle' });
      await sleep(400);
      const expBody = (await expPage.locator('body').textContent()) ?? '';
      await expCtx.close();

      const exporterSeesChange = /Ready to file/i.test(expBody);
      record(
        'A2:same-record',
        'Agent and exporter portals render the SAME row, by id',
        filed.status === 200 && row.filing_status === 'ready' && exporterSeesChange ? 'PASS' : 'FAIL',
        `agent file call=${filed.status}, DB filing_status=${row.filing_status}, exporter page (same doc id) reflects it=${exporterSeesChange}`,
      );
    });

    // ---------------------------------------------------------------- AC01
    await scenario('AC01:server-gated', 'Blocked prerequisites disable downstream actions, with reason and link', async () => {
      const { ctx, page } = await loggedInContext(browser, AGENT);
      await page.goto(`${BASE}/agent/deals/${DEAL}`, { waitUntil: 'networkidle' });
      await sleep(500);
      const body = (await page.locator('body').textContent()) ?? '';

      // The documents gate is blocked on the seeded fixture (failed + rejected docs).
      const gateBlocked = /Documents[\s\S]{0,40}Blocked/.test(body.replace(/\s+/g, ' '));
      const reasonShown = /failed to generate and needs a retry/.test(body);
      const linkShown = (await page.locator('a:has-text("Go there")').count()) > 0;
      const disabledControls = await page.locator('button[disabled][aria-disabled="true"]').count();
      await ctx.close();

      record(
        'AC01:server-gated',
        'Blocked prerequisites disable downstream actions, with reason and link',
        gateBlocked && reasonShown && linkShown && disabledControls > 0 ? 'PASS' : 'FAIL',
        `documents gate blocked=${gateBlocked}, reason text=${reasonShown}, deep links rendered=${linkShown}, disabled gated controls=${disabledControls}`,
      );
    });

    // ---------------------------------------------------------------- AC01b
    await scenario('AC01b:server-enforced', 'A blocked action is refused server-side, not just hidden', async () => {
      // Filing a document that failed to generate. The UI never offers this; a
      // hand-crafted request must still be refused with blockers[].
      const failedDoc = await prisma.document.findFirstOrThrow({
        where: { deal_id: DEAL, doc_type: 'declaration', is_current_version: true },
      });
      const before = failedDoc.filing_status;

      const { ctx, page } = await loggedInContext(browser, AGENT);
      const res = await page.evaluate(
        async ([dealId, documentId]) => {
          const r = await fetch(`/api/v1/deals/${dealId}/documents/${documentId}/file`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'mark_filed', filing_status: 'ready' }),
          });
          const b = await r.json().catch(() => null);
          return { status: r.status, code: b?.error?.code, blockers: b?.error?.blockers?.length ?? 0 };
        },
        [DEAL, failedDoc.id] as const,
      );
      await ctx.close();

      const after = await prisma.document.findUniqueOrThrow({ where: { id: failedDoc.id } });
      record(
        'AC01b:server-enforced',
        'A blocked action is refused server-side, not just hidden',
        res.status === 422 && res.blockers > 0 && after.filing_status === before ? 'PASS' : 'FAIL',
        `status=${res.status} (expect 422), code=${res.code}, blockers=${res.blockers}, filing_status unchanged=${after.filing_status === before}`,
      );
    });

    // ---------------------------------------------------------------- AC02
    await scenario('AC02:handoff-provenance', 'Every filing/partner handoff records owner, status, timestamp and reference', async () => {
      const { ctx, page } = await loggedInContext(browser, AGENT);
      // Assign a partner through the real route, then check all four facts landed.
      const assigned = await page.evaluate(
        async ([dealId]) => {
          const r = await fetch(`/api/v1/deals/${dealId}/partners`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ partner_id: 'seed-partner-freight-1', lane: 'freight', notes: 'Booking packet sent.' }),
          });
          const b = await r.json().catch(() => null);
          return { status: r.status, id: b?.data?.id };
        },
        [DEAL] as const,
      );

      // Record the reference the partner quoted back.
      const acked = await page.evaluate(
        async ([dealId, handoffId]) => {
          const r = await fetch(`/api/v1/deals/${dealId}/partners`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ handoff_id: handoffId, status: 'acknowledged', reference: 'SAGAR-BK-9931' }),
          });
          return { status: r.status };
        },
        [DEAL, assigned.id] as const,
      );

      await page.goto(`${BASE}/agent/deals/${DEAL}`, { waitUntil: 'networkidle' });
      await sleep(400);
      const body = (await page.locator('body').textContent()) ?? '';
      await ctx.close();

      const row = assigned.id ? await prisma.partnerHandoff.findUnique({ where: { id: assigned.id } }) : null;
      const hasAllFour = Boolean(row?.owner_user_id && row?.status && row?.sent_at && row?.reference);
      // And a document filing carries the same four.
      const filedDoc = await prisma.document.findFirst({
        where: { deal_id: DEAL, filing_status: { in: ['filed', 'accepted'] } },
      });
      const filingHasAllFour = Boolean(filedDoc?.filed_at && filedDoc?.filing_reference && filedDoc?.filing_status);
      const renderedOnPage = /SAGAR-BK-9931/.test(body) && /Owner: Rahul Menon/.test(body);

      record(
        'AC02:handoff-provenance',
        'Every filing/partner handoff records owner, status, timestamp and reference',
        assigned.status === 201 && acked.status === 200 && hasAllFour && filingHasAllFour && renderedOnPage ? 'PASS' : 'FAIL',
        `assign=${assigned.status}, ack=${acked.status}, handoff has owner+status+timestamp+reference=${hasAllFour}, filed doc has status+timestamp+reference=${filingHasAllFour}, rendered on page=${renderedOnPage}`,
      );
    });

    // ---------------------------------------------------------------- AC02b
    await scenario('AC02b:no-phantom-partner', 'Partner assignment refuses anything outside the approved directory', async () => {
      const { ctx, page } = await loggedInContext(browser, AGENT);
      const results = await page.evaluate(
        // NOTE: no named helper closures inside page.evaluate — the tsx/esbuild transform
        // injects a `__name` call that does not exist in the browser context and throws.
        async ([dealId]) => {
          const url = `/api/v1/deals/${dealId}/partners`;
          const headers = { 'Content-Type': 'application/json' };
          // 1. An invented id.
          const phantom = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ partner_id: 'totally-made-up-partner', lane: 'cha' }) });
          // 2. A free-text name instead of an id — the schema has no such field.
          const freeText = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ partner_name: 'Bob’s Discount Customs', lane: 'cha' }) });
          // 3. A real partner of the WRONG type for the lane.
          const wrongType = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ partner_id: 'seed-partner-insurance-1', lane: 'cha' }) });
          return { phantom: phantom.status, freeText: freeText.status, wrongType: wrongType.status };
        },
        [DEAL] as const,
      );
      await ctx.close();

      const shipment = await prisma.shipment.findFirstOrThrow({ where: { deal_id: DEAL } });
      const chaUnchanged = shipment.cha_partner_id === 'seed-partner-cha-1';
      record(
        'AC02b:no-phantom-partner',
        'Partner assignment refuses anything outside the approved directory',
        results.phantom === 422 && results.freeText === 422 && results.wrongType === 422 && chaUnchanged ? 'PASS' : 'FAIL',
        `invented id=${results.phantom}, free-text name=${results.freeText}, wrong-type partner=${results.wrongType} (all expect 422), CHA unchanged=${chaUnchanged}`,
      );
    });

    // ---------------------------------------------------------------- AC03
    await scenario('AC03:exporter-status-visible', 'Agent sees exporter-visible status before sending updates', async () => {
      const { ctx, page } = await loggedInContext(browser, AGENT);
      await page.goto(`${BASE}/agent/deals/${DEAL}`, { waitUntil: 'networkidle' });
      await sleep(400);
      const body = (await page.locator('body').textContent()) ?? '';
      await ctx.close();

      // The exporter-facing approval column, and the exporter's own task queue.
      const approvalColumn = /Exporter approval/.test(body);
      const exporterStatuses = /Awaiting your approval|Approved|Changes requested/.test(body);
      const exporterTaskColumn = /Confirm revised payment terms with buyer/.test(body);
      record(
        'AC03:exporter-status-visible',
        'Agent sees exporter-visible status before sending updates',
        approvalColumn && exporterStatuses && exporterTaskColumn ? 'PASS' : 'FAIL',
        `exporter approval column=${approvalColumn}, exporter-facing statuses rendered=${exporterStatuses}, exporter-owned task visible=${exporterTaskColumn}`,
      );
    });

    // ---------------------------------------------------------------- ESC
    await scenario('ESC:dedup', 'Escalating twice links the open Ops case instead of duplicating', async () => {
      const { ctx, page } = await loggedInContext(browser, AGENT);
      const out = await page.evaluate(
        async ([dealId]) => {
          const payload = JSON.stringify({ reason: 'CHA has not confirmed the amended SB.', gate: 'documents', severity: 'high' });
          const r1 = await fetch(`/api/v1/deals/${dealId}/escalate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload });
          const b1 = await r1.json().catch(() => null);
          const r2 = await fetch(`/api/v1/deals/${dealId}/escalate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload });
          const b2 = await r2.json().catch(() => null);
          return {
            first: b1?.data?.dispute_id,
            firstCreated: b1?.data?.dispute_created,
            second: b2?.data?.dispute_id,
            secondCreated: b2?.data?.dispute_created,
            link: b2?.data?.case_link,
          };
        },
        [DEAL] as const,
      );
      await ctx.close();

      const disputes = await prisma.dispute.count({ where: { deal_id: DEAL, scope_type: 'deal' } });
      const opsTasks = await prisma.task.count({ where: { deal_id: DEAL, task_type: 'ops_blocker_escalation' } });
      record(
        'ESC:dedup',
        'Escalating twice links the open Ops case instead of duplicating',
        out.first === out.second && out.secondCreated === false && disputes === 1 && opsTasks === 1 ? 'PASS' : 'FAIL',
        `same case id=${out.first === out.second}, second created=${out.secondCreated}, deal-scoped disputes=${disputes}, ops tasks=${opsTasks}, case link=${out.link}`,
      );
    });

    // ---------------------------------------------------------------- L1
    await scenario('L1:no-leak-pages', 'Internal notes/tasks never render on any exporter-facing page', async () => {
      const internalTask = await prisma.task.findUniqueOrThrow({ where: { id: 'seed-task-deal-locked-internal' } });
      const { ctx, page } = await loggedInContext(browser, OWNER);
      const surfaces = [
        '/app/overview',
        '/app/tasks',
        '/app/deals',
        `/app/deals/${DEAL}`,
        `/app/deals/${DEAL}/tasks`,
        `/app/deals/${DEAL}/documents`,
        `/app/deals/${DEAL}/shipment`,
        `/app/deals/${DEAL}/payment`,
        `/app/deals/${DEAL}/activity`,
        `/app/deals/${DEAL}/support`,
        '/app/messages',
      ];
      const leaks: string[] = [];
      for (const path of surfaces) {
        await page.goto(BASE + path, { waitUntil: 'networkidle' });
        await sleep(250);
        const body = (await page.locator('body').textContent()) ?? '';
        if (body.includes(CANARY)) leaks.push(`${path}:note`);
        if (body.includes(internalTask.title)) leaks.push(`${path}:internal-task`);
      }
      await ctx.close();
      record(
        'L1:no-leak-pages',
        'Internal notes/tasks never render on any exporter-facing page',
        leaks.length === 0 ? 'PASS' : 'FAIL',
        `swept ${surfaces.length} exporter surfaces for the canary note and the internal task title; leaks=[${leaks.join(', ') || 'none'}]`,
      );
    });

    // ---------------------------------------------------------------- L2
    await scenario('L2:no-leak-api', 'Internal content never appears in an exporter-facing API response', async () => {
      const internalTask = await prisma.task.findUniqueOrThrow({ where: { id: 'seed-task-deal-locked-internal' } });
      const { ctx, page } = await loggedInContext(browser, OWNER);
      const probe = await page.evaluate(
        async ([dealId, canary, internalTitle, internalTaskId]) => {
          const endpoints = [
            '/api/v1/tasks',
            '/api/v1/tasks?state=not_started',
            '/api/v1/deals',
            '/api/v1/messages',
            `/api/v1/messages?deal_id=${dealId}`,
          ];
          const found: string[] = [];
          for (const url of endpoints) {
            const r = await fetch(url);
            const text = await r.text();
            if (text.includes(canary)) found.push(`${url}:canary`);
            if (text.includes(internalTitle)) found.push(`${url}:internal-task`);
            if (text.includes(internalTaskId)) found.push(`${url}:internal-task-id`);
          }
          // And the exporter must not be able to ACT on an internal task either.
          const act = await fetch(`/api/v1/tasks/${internalTaskId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: 'done' }),
          });
          return { found, actStatus: act.status };
        },
        [DEAL, CANARY, internalTask.title, internalTask.id] as const,
      );
      await ctx.close();

      const stillNotDone = await prisma.task.findUniqueOrThrow({ where: { id: internalTask.id } });
      record(
        'L2:no-leak-api',
        'Internal content never appears in an exporter-facing API response',
        probe.found.length === 0 && probe.actStatus === 404 && stillNotDone.state === 'not_started' ? 'PASS' : 'FAIL',
        `leaks=[${probe.found.join(', ') || 'none'}], exporter PATCH of internal task=${probe.actStatus} (expect 404), task state unchanged=${stillNotDone.state}`,
      );
    });

    // ---------------------------------------------------------------- L3
    await scenario('L3:structural-separation', 'Internal notes are a separate table, and exporters cannot write them', async () => {
      // Structural: InternalNote and Message are distinct tables, so the messages
      // endpoint physically cannot return a note.
      const tables = await prisma.$queryRaw<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('InternalNote','Message')
      `;
      const bothExist = tables.length === 2;
      const noteCount = await prisma.internalNote.count({ where: { deal_id: DEAL } });

      const { ctx, page } = await loggedInContext(browser, OWNER);
      const write = await page.evaluate(
        async ([dealId]) => {
          const r = await fetch(`/api/v1/deals/${dealId}/internal-notes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body: 'exporter should not be able to write this' }),
          });
          return { status: r.status };
        },
        [DEAL] as const,
      );
      await ctx.close();
      const noteCountAfter = await prisma.internalNote.count({ where: { deal_id: DEAL } });

      record(
        'L3:structural-separation',
        'Internal notes are a separate table, and exporters cannot write them',
        bothExist && write.status === 403 && noteCount === noteCountAfter ? 'PASS' : 'FAIL',
        `InternalNote+Message both exist as distinct tables=${bothExist}, exporter POST=${write.status} (expect 403), note count ${noteCount}->${noteCountAfter}`,
      );
    });

    // ---------------------------------------------------------------- V1
    await scenario('V1:explicit-visibility', 'Task creation requires explicit visibility — no permissive default', async () => {
      const { ctx, page } = await loggedInContext(browser, AGENT);
      const out = await page.evaluate(
        async ([dealId]) => {
          const url = `/api/v1/deals/${dealId}/tasks`;
          const headers = { 'Content-Type': 'application/json' };
          // Omitting visibility must be refused, not silently defaulted to visible.
          const omitted = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ title: 'No visibility given', owner_role: 'agent' }) });
          const internalRes = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ title: 'Internal by request', owner_role: 'agent', visibility: 'internal' }) });
          const internalBody = await internalRes.json().catch(() => null);
          return { omitted: omitted.status, internal: internalRes.status, internalVisibility: internalBody?.data?.visibility };
        },
        [DEAL] as const,
      );
      await ctx.close();
      record(
        'V1:explicit-visibility',
        'Task creation requires explicit visibility — no permissive default',
        out.omitted === 422 && out.internal === 201 && out.internalVisibility === 'internal' ? 'PASS' : 'FAIL',
        `omitted visibility=${out.omitted} (expect 422), explicit internal=${out.internal} with visibility=${out.internalVisibility}`,
      );
    });

    // ---------------------------------------------------------------- P1
    await scenario('P1:exporter-denied', 'Exporters cannot reach agent-only execution routes', async () => {
      const { ctx, page } = await loggedInContext(browser, OWNER);
      const out = await page.evaluate(
        async ([dealId]) => {
          const headers = { 'Content-Type': 'application/json' };
          const partners = await fetch(`/api/v1/deals/${dealId}/partners`, { method: 'POST', headers, body: JSON.stringify({ partner_id: 'seed-partner-cha-1', lane: 'cha' }) });
          const escalate = await fetch(`/api/v1/deals/${dealId}/escalate`, { method: 'POST', headers, body: JSON.stringify({ reason: 'x', gate: 'documents' }) });
          const tasks = await fetch(`/api/v1/deals/${dealId}/tasks`, { method: 'POST', headers, body: JSON.stringify({ title: 'x', owner_role: 'agent', visibility: 'internal' }) });
          return { partners: partners.status, escalate: escalate.status, tasks: tasks.status };
        },
        [DEAL] as const,
      );
      // And the agent workspace PAGE itself must not render for an exporter.
      const resp = await page.goto(`${BASE}/agent/deals/${DEAL}`, { waitUntil: 'domcontentloaded' });
      const body = (await page.locator('body').textContent()) ?? '';
      await ctx.close();
      const pageDenied = /Access denied/i.test(body) && !body.includes(CANARY);

      record(
        'P1:exporter-denied',
        'Exporters cannot reach agent-only execution routes',
        out.partners === 403 && out.escalate === 403 && out.tasks === 403 && pageDenied ? 'PASS' : 'FAIL',
        `partners=${out.partners}, escalate=${out.escalate}, tasks=${out.tasks} (all expect 403), agent page denied for exporter=${pageDenied} (http=${resp?.status()})`,
      );
    });

    // ---------------------------------------------------------------- N1
    await scenario('N1:risk-panel-link', 'Agent risk panel links to the execution workspace', async () => {
      const { ctx, page } = await loggedInContext(browser, AGENT);
      await page.goto(`${BASE}/agent`, { waitUntil: 'networkidle' });
      await sleep(400);
      const hrefs = await page.locator('a[href^="/agent/deals/"]').evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
      await ctx.close();
      const pointsAtExecution = hrefs.some((h) => /^\/agent\/deals\/[^/]+$/.test(h));
      const stillPointsAtCommercial = hrefs.some((h) => h.endsWith('/commercial'));
      record(
        'N1:risk-panel-link',
        'Agent risk panel links to the execution workspace',
        pointsAtExecution && !stillPointsAtCommercial ? 'PASS' : 'FAIL',
        `hrefs=[${hrefs.join(', ') || 'none'}], links to execution workspace=${pointsAtExecution}, still routed to /commercial=${stillPointsAtCommercial}`,
      );
    });
  } finally {
    await browser.close();
    await resetFixtures();
  }

  summarize('AGT-06 AGENT EXECUTION WORKSPACE');
}

main()
  .catch((e) => {
    if (e instanceof PreflightError) console.error(`\n✗ PREFLIGHT FAILED\n\n  ${e.message}\n`);
    else console.error('SUITE CRASHED:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
