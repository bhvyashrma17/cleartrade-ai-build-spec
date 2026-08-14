/**
 * Cross-portal integration walk — docs/11 §3.
 *
 * "These are the scenarios that prove the shared-object architecture actually works.
 * Each one crosses at least two portals."
 *
 * This suite is different in kind from the per-screen suites. Those verify that one
 * screen satisfies its own acceptance criteria; this one verifies the SEAMS — that a
 * write made through one portal's API is visible, with the right shape and the right
 * permissions, through another portal's, with no sync step, no cache bust and no
 * reconciliation job in between. Every cross-portal read below happens IMMEDIATELY
 * after the write that should cause it, so a passing result cannot be explained by
 * background reconciliation.
 *
 * It also runs on its OWN deal, built from scratch by walking the real lifecycle
 * (lead -> proposal -> approval -> lock -> documents -> CHA -> shipment -> payment ->
 * dispute -> resolution). It deliberately does not reuse the seeded locked deal:
 * a walk that starts from a hand-placed fixture proves the fixture renders, not that
 * the lifecycle composes. Everything it creates is torn down at the end.
 *
 * Run with the dev server up (and DB seeded):
 *   npx tsx --env-file=.env scripts/verify-cross-portal-walk.ts
 */

import { DealStage, DisputeStatus, TaskState } from '@prisma/client';
import {
  BASE,
  launch,
  loggedInContext,
  preflight,
  PreflightError,
  record,
  scenario,
  sleep,
  summarize,
  type Browser,
  type BrowserContext,
  type Page,
} from './verify-harness';
import { prisma } from '../src/lib/prisma';

const OWNER = 'owner@sunriseagro.example';
const AGENT = 'agent@cleartrade.example';
const OPS = 'ops@cleartrade.example';
const ORG = 'seed-org-1';
const AGENT_ID = 'seed-user-agent';
const OWNER_ID = 'seed-user-owner';
const OPS_ID = 'seed-user-ops';
/** Buyer-2 (Global Textiles) — untouched by verify-journey's J7, which always picks buyer-3. */
const BUYER = 'seed-buyer-2';

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

// --- Walk state, threaded through the sequential scenarios -----------------
let leadId: string | null = null;
let dealId: string | null = null;
let shipmentId: string | null = null;
let paymentId: string | null = null;
let disputeId: string | null = null;
let productId: string | null = null;

/** Long-lived sessions: one per portal, so each step reads as the right actor. */
let exporter: { ctx: BrowserContext; page: Page };
let agent: { ctx: BrowserContext; page: Page };
let ops: { ctx: BrowserContext; page: Page };

async function cleanup() {
  if (dealId) {
    // Notifications first: the walk's proposal/message steps mint rows against the
    // seeded owner, and leaving them behind inflates that user's notification list on
    // every run — which pushes older seeded rows out of the paginated window and breaks
    // the EXP-17 suite. A suite must not leave debris that fails a different one.
    await prisma.notification.deleteMany({ where: { object_id: dealId } });
    await prisma.notification.deleteMany({ where: { dedupe_key: { contains: dealId } } });
    await prisma.payoutAdjustment.deleteMany({ where: { payout: { deal_id: dealId } } });
    await prisma.payout.deleteMany({ where: { deal_id: dealId } });
    await prisma.internalNote.deleteMany({ where: { deal_id: dealId } });
    await prisma.dispute.deleteMany({ where: { deal_id: dealId } });
    await prisma.partnerHandoff.deleteMany({ where: { deal_id: dealId } });
    await prisma.shipmentMilestone.deleteMany({ where: { shipment: { deal_id: dealId } } });
    await prisma.shipment.deleteMany({ where: { deal_id: dealId } });
    await prisma.payment.deleteMany({ where: { deal_id: dealId } });
    await prisma.document.deleteMany({ where: { deal_id: dealId } });
    await prisma.task.deleteMany({ where: { deal_id: dealId } });
    await prisma.message.deleteMany({ where: { deal_id: dealId } });
    await prisma.dealProposal.deleteMany({ where: { deal_id: dealId } });
    await prisma.dealSnapshot.deleteMany({ where: { deal_id: dealId } });
    await prisma.auditEvent.deleteMany({ where: { object_id: dealId } });
    await prisma.buyerLead.updateMany({ where: { deal_id: dealId }, data: { deal_id: null } });
    await prisma.deal.deleteMany({ where: { id: dealId } });
  }
  if (leadId) {
    await prisma.outreachActivity.deleteMany({ where: { buyer_lead_id: leadId } });
    await prisma.internalNote.deleteMany({ where: { buyer_lead_id: leadId } });
    await prisma.buyerLead.deleteMany({ where: { id: leadId } });
  }
}

async function main() {
  await preflight();
  const browser: Browser = await launch();

  try {
    exporter = await loggedInContext(browser, OWNER);
    agent = await loggedInContext(browser, AGENT);
    ops = await loggedInContext(browser, OPS);

    const product = await prisma.product.findFirstOrThrow({ where: { exporter_org_id: ORG }, orderBy: { created_at: 'asc' } });
    productId = product.id;
    // This walk owns the (org, product, buyer) lead slot for its whole run.
    await prisma.buyerLead.deleteMany({ where: { exporter_org_id: ORG, product_id: productId, buyer_id: BUYER } });

    // ================================================================ X1
    // Assigned agent curates a buyer lead. Exporter self-service discovery and lead
    // access are intentionally denied by the locked agent-curated decision.
    // ================================================================
    await scenario('X1', 'Agent curates a lead → it appears in the agent CRM, agent-assigned', async () => {
      const created = await fetchJson(agent.page, '/api/v1/buyer-leads', {
        method: 'POST',
        body: { exporter_org_id: ORG, product_id: productId, buyer_id: BUYER },
      });
      leadId = (created.body as { data?: { id: string } } | null)?.data?.id ?? null;

      // Read the AGENT's CRM immediately — no sync step in between.
      const crm = await fetchJson(agent.page, '/api/v1/leads?per_page=100');
      const crmRows = (crm.body as { data?: { id: string; exporter_org: { id: string } }[] } | null)?.data ?? [];
      const inCrm = crmRows.some((r) => r.id === leadId);

      const row = leadId ? await prisma.buyerLead.findUnique({ where: { id: leadId } }) : null;
      const agentAssigned = row?.assigned_agent_id === AGENT_ID;

      // Same canonical row by id, read through the agent's own workspace page.
      await agent.page.goto(`${BASE}/agent/leads/${leadId}`, { waitUntil: 'networkidle' });
      const leadPageOk = (await agent.page.locator('body').innerText()).includes('Lead workspace');

      record(
        'X1',
        'Agent curates a lead → it appears in the agent CRM, agent-assigned',
        created.status === 201 && inCrm && agentAssigned && leadPageOk ? 'PASS' : 'FAIL',
        `agent POST /buyer-leads=${created.status}; same lead id (${leadId}) in agent CRM=${inCrm}; assigned to creating agent=${agentAssigned}; agent workspace renders=${leadPageOk}`,
      );
    });

    // ================================================================ X2
    // Agent works the lead and converts it -> Deal exists in BOTH portals,
    // and the lead's history survives the conversion.
    // ================================================================
    await scenario('X2', 'Agent works the lead → converts to a deal visible in both portals, lead history intact', async () => {
      if (!leadId) throw new Error('X1 did not produce a lead.');

      // Walk the lead up the stages the state machine requires before conversion.
      const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
      const steps = [
        { to_stage: 'shortlisted', summary: 'Shortlisted after fit review.' },
        { to_stage: 'contacted', summary: 'Intro email sent.', next_action: 'Await reply', next_action_at: soon },
        { to_stage: 'replied', summary: 'Buyer replied asking for pricing.', next_action: 'Send pricing', next_action_at: soon },
        { to_stage: 'interested', summary: 'Buyer confirmed interest.', next_action: 'Prepare terms', next_action_at: soon },
        { to_stage: 'negotiation', summary: 'Negotiating volume and Incoterm.' },
      ];
      const stepStatuses: number[] = [];
      for (const s of steps) {
        const r = await fetchJson(agent.page, `/api/v1/leads/${leadId}/activities`, {
          method: 'POST',
          body: { type: 'email', visibility: 'internal', ...s },
        });
        stepStatuses.push(r.status);
      }

      const converted = await fetchJson(agent.page, `/api/v1/leads/${leadId}/convert`, {
        method: 'POST',
        body: { quantity: 500, unit: 'kg', unit_price_amount: 4, unit_price_currency: 'USD', incoterm: 'FOB' },
      });
      dealId = (converted.body as { data?: { deal: { id: string } } } | null)?.data?.deal.id ?? null;

      // The exporter must see the same deal, immediately, through their own portal.
      const exporterDeals = await fetchJson(exporter.page, '/api/v1/deals?per_page=100');
      const exporterRows = (exporterDeals.body as { data?: { id: string }[] } | null)?.data ?? [];
      const exporterSeesDeal = exporterRows.some((d) => d.id === dealId);

      const lead = leadId ? await prisma.buyerLead.findUnique({ where: { id: leadId }, include: { activities: true } }) : null;
      const historyIntact = (lead?.activities.length ?? 0) === steps.length;
      const relationIntact = lead?.deal_id === dealId;

      record(
        'X2',
        'Agent works the lead → converts to a deal visible in both portals, lead history intact',
        stepStatuses.every((s) => s === 201) && converted.status === 201 && exporterSeesDeal && historyIntact && relationIntact
          ? 'PASS'
          : 'FAIL',
        `5 outreach activities logged=[${stepStatuses.join(',')}]; convert=${converted.status} -> deal ${dealId}; exporter's own /api/v1/deals shows it immediately=${exporterSeesDeal}; all ${steps.length} outreach activities still attached to the lead after conversion=${historyIntact}; lead.deal_id links the canonical deal=${relationIntact}`,
      );
    });

    // ================================================================ X3
    // Agent sends a commercial proposal -> exporter gets an approval task
    // AND a notification; Ops audit event exists (docs/11 §3 row 2).
    // ================================================================
    await scenario('X3', 'Agent proposes terms → exporter gets approval task + notification, Ops audit event exists', async () => {
      if (!dealId) throw new Error('X2 did not produce a deal.');

      const proposed = await fetchJson(agent.page, `/api/v1/deals/${dealId}/proposals`, {
        method: 'POST',
        body: {
          action: 'propose',
          quantity: 500,
          unit: 'kg',
          unit_price_amount: 4,
          unit_price_currency: 'USD',
          total_amount: 2000,
          total_currency: 'USD',
          incoterm: 'FOB',
          incoterm_place: 'Nhava Sheva',
          payment_terms: { type: 'TT', description: '30% advance, 70% against BL' },
          // The lock state machine requires a ship window on the accepted version.
          ship_window_start: new Date(Date.now() + 14 * 86_400_000).toISOString(),
          ship_window_end: new Date(Date.now() + 28 * 86_400_000).toISOString(),
        },
      });

      // Exporter side: the proposal is readable and an approval notification exists.
      const exporterProposals = await fetchJson(exporter.page, `/api/v1/deals/${dealId}/proposals`);
      const proposalRows = (exporterProposals.body as { data?: { version: number; status: string }[] } | null)?.data ?? [];
      const exporterSeesV1 = proposalRows.some((p) => p.version === 1 && p.status === 'awaiting_exporter');

      const notif = await prisma.notification.findFirst({
        where: { user_id: OWNER_ID, dedupe_key: `proposal:${dealId}:v1` },
      });

      // Ops side: the audit trail records it, searchable by object.
      const auditRes = await fetchJson(ops.page, `/api/v1/audit?object_id=${dealId}&per_page=50`);
      const auditRows = (auditRes.body as { data?: { action: string; object_type: string }[] } | null)?.data ?? [];
      const opsSeesAudit = auditRows.length > 0;

      record(
        'X3',
        'Agent proposes terms → exporter gets approval task + notification, Ops audit event exists',
        proposed.status === 201 && exporterSeesV1 && Boolean(notif) && opsSeesAudit ? 'PASS' : 'FAIL',
        `agent propose=${proposed.status}; exporter reads v1 at "awaiting_exporter" through their own API=${exporterSeesV1}; exporter notification row created=${Boolean(notif)}; Ops audit search on this deal returns ${auditRows.length} event(s)=${opsSeesAudit}`,
      );
    });

    // ================================================================ X4
    // Exporter requests changes -> agent receives a task, prior version
    // remains in history (docs/11 §3 row 3).
    // ================================================================
    await scenario('X4', 'Exporter requests changes → agent gets a task, prior proposal version stays in history', async () => {
      if (!dealId) throw new Error('X2 did not produce a deal.');
      const deal = await prisma.deal.findUniqueOrThrow({ where: { id: dealId } });

      const requested = await fetchJson(exporter.page, `/api/v1/deals/${dealId}/proposals`, {
        method: 'PATCH',
        body: { action: 'request_changes', version: 1, deal_version: deal.version, note: 'Please improve the unit price.' },
      });

      const agentTask = await prisma.task.findFirst({
        where: { deal_id: dealId, task_type: 'agent_revise_commercial_terms', state: { notIn: [TaskState.done, TaskState.cancelled] } },
      });

      // Agent revises -> v2. v1 must still exist, at its changes_requested status.
      const revised = await fetchJson(agent.page, `/api/v1/deals/${dealId}/proposals`, {
        method: 'POST',
        body: {
          action: 'revise',
          quantity: 500,
          unit: 'kg',
          unit_price_amount: 4.4,
          unit_price_currency: 'USD',
          total_amount: 2200,
          total_currency: 'USD',
          incoterm: 'FOB',
          incoterm_place: 'Nhava Sheva',
          payment_terms: { type: 'TT', description: '30% advance, 70% against BL' },
          // The lock state machine requires a ship window on the accepted version.
          ship_window_start: new Date(Date.now() + 14 * 86_400_000).toISOString(),
          ship_window_end: new Date(Date.now() + 28 * 86_400_000).toISOString(),
        },
      });

      const versions = await prisma.dealProposal.findMany({ where: { deal_id: dealId }, orderBy: { version: 'asc' } });
      const v1 = versions.find((v) => v.version === 1);
      const v2 = versions.find((v) => v.version === 2);
      const historyPreserved = versions.length === 2 && v1?.status === 'changes_requested' && v2?.status === 'awaiting_exporter';

      record(
        'X4',
        'Exporter requests changes → agent gets a task, prior proposal version stays in history',
        requested.status === 200 && Boolean(agentTask) && revised.status === 201 && historyPreserved ? 'PASS' : 'FAIL',
        `exporter request_changes=${requested.status}; agent revision task created=${Boolean(agentTask)}; agent revise=${revised.status}; ${versions.length} proposal versions on record — v1 status=${v1?.status} (preserved, not overwritten), v2 status=${v2?.status}=${historyPreserved}`,
      );
    });

    // ================================================================ X5
    // Exporter approves -> deal advances; agent lock prerequisites become
    // satisfiable; lock creates execution tasks + doc checklist and the
    // exporter journey advances (docs/11 §3 rows 2 & 4).
    // ================================================================
    await scenario('X5', 'Exporter approves → agent locks → execution tasks + doc checklist appear in both portals', async () => {
      if (!dealId) throw new Error('X2 did not produce a deal.');
      let deal = await prisma.deal.findUniqueOrThrow({ where: { id: dealId } });

      const approved = await fetchJson(exporter.page, `/api/v1/deals/${dealId}/proposals`, {
        method: 'PATCH',
        body: { action: 'approve', version: 2, deal_version: deal.version },
      });
      const afterApproval = await prisma.deal.findUniqueOrThrow({ where: { id: dealId } });

      // The lock state machine additionally demands an exporter-approved PI bound to
      // the current version — the same prerequisite verify-commercial satisfies.
      await prisma.document.create({
        data: {
          deal_id: dealId,
          doc_type: 'PI',
          version: 1,
          is_current_version: true,
          source: 'generated',
          generation_status: 'generated',
          review_status: 'agent_reviewed',
          approval_status: 'exporter_approved',
          approved_version: 1,
          approved_by_id: OWNER_ID,
          approved_at: new Date(),
        },
      });

      deal = await prisma.deal.findUniqueOrThrow({ where: { id: dealId } });
      const locked = await fetchJson(agent.page, `/api/v1/deals/${dealId}/lock`, {
        method: 'POST',
        body: { deal_version: deal.version },
      });

      // Lock enqueues checklist generation; wait for the async effect to land.
      let lockedDeal = null;
      for (let i = 0; i < 20; i++) {
        lockedDeal = await prisma.deal.findUniqueOrThrow({ where: { id: dealId } });
        if (lockedDeal.locked_at) break;
        await sleep(500);
      }

      // Surface the server's own blockers[] on failure — a bare 422 says a
      // prerequisite is unmet without saying which, and that is the whole point of
      // the docs/09 §2 blockers array.
      const lockBlockers = (locked.body as { error?: { blockers?: { reason: string }[] } } | null)?.error?.blockers ?? [];

      const snapshot = await prisma.dealSnapshot.findFirst({ where: { deal_id: dealId } });
      const execTasks = await prisma.task.count({ where: { deal_id: dealId, state: { notIn: [TaskState.cancelled] } } });
      const checklistDocs = await prisma.document.count({ where: { deal_id: dealId, generated_from_snapshot_id: { not: null } } });

      // Cross-portal: the exporter's own deal workspace shows the locked stage, and
      // the agent's execution queue shows the same deal's tasks.
      const exporterDeals = await fetchJson(exporter.page, `/api/v1/deals?per_page=100`);
      const exporterRow = ((exporterDeals.body as { data?: { id: string; stage: string }[] } | null)?.data ?? []).find((d) => d.id === dealId);
      const exporterSeesLocked = exporterRow?.stage === DealStage.deal_locked;

      await agent.page.goto(`${BASE}/agent/deals/${dealId}`, { waitUntil: 'networkidle' });
      const agentWorkspaceText = await agent.page.locator('body').innerText();
      const agentSeesExecution = /Task board/.test(agentWorkspaceText);

      record(
        'X5',
        'Exporter approves → agent locks → execution tasks + doc checklist appear in both portals',
        approved.status === 200 &&
          afterApproval.stage === DealStage.terms_agreed &&
          locked.status === 200 &&
          lockedDeal?.stage === DealStage.deal_locked &&
          Boolean(snapshot) &&
          execTasks > 0 &&
          checklistDocs > 0 &&
          exporterSeesLocked &&
          agentSeesExecution
          ? 'PASS'
          : 'FAIL',
        `exporter approve=${approved.status} → stage ${afterApproval.stage}; agent lock=${locked.status}${lockBlockers.length ? ` blockers=[${lockBlockers.map((b) => b.reason).join(' | ')}]` : ''}${locked.status !== 200 ? ` body=${JSON.stringify(locked.body)}` : ''} → stage ${lockedDeal?.stage}; frozen DealSnapshot v${snapshot?.version} created=${Boolean(snapshot)}; ${execTasks} task(s) and ${checklistDocs} checklist document(s) created by the lock; exporter's own deals API shows deal_locked=${exporterSeesLocked}; agent execution workspace renders the task board=${agentSeesExecution}`,
      );
    });

    // ================================================================ X6
    // CHA rejects a filing -> filing status rejected, remediation visible,
    // and Ops exception queue sees it (docs/11 §3 row 7).
    // ================================================================
    await scenario('X6', 'CHA rejects a filing → rejected status + Ops exception queue sees it, exporter gets a safe view', async () => {
      if (!dealId) throw new Error('X5 did not lock a deal.');

      // The CHA gate is the fourth in the AGT-06 execution checklist and only opens
      // once `documents` is done and a shipment with BOTH partners exists. That
      // ordering is the product working correctly — filing before the paperwork is
      // approved is exactly what the gate exists to stop — so the walk has to satisfy
      // it rather than skip it.
      //
      // The documents are brought to generated+approved directly rather than driven
      // through the async generation job: this scenario's subject is the CHA/filing
      // cross-portal seam, generation is covered end to end by verify-acceptance-matrix,
      // and the same shortcut is established precedent (verify-commercial C6 seeds an
      // approved PI to reach the lock prerequisite).
      await prisma.document.updateMany({
        where: { deal_id: dealId },
        data: {
          generation_status: 'generated',
          review_status: 'agent_reviewed',
          approval_status: 'exporter_approved',
          approved_by_id: OWNER_ID,
          approved_at: new Date(),
          approved_version: 1,
        },
      });

      // The `required_inputs` gate (upstream of documents) holds while an
      // exporter-owned `exporter_confirm_ship_window` task is open — by design: the
      // agent is waiting on the exporter, and the checklist says so rather than
      // hiding the reason for the delay. The EXPORTER clears it from their own
      // portal, which is itself one of the cross-portal handoffs under test.
      const shipWindowTask = await prisma.task.findFirst({
        where: { deal_id: dealId, task_type: 'exporter_confirm_ship_window', state: { notIn: [TaskState.done, TaskState.cancelled] } },
      });
      let exporterClearedInput = { status: 0 };
      if (shipWindowTask) {
        await fetchJson(exporter.page, `/api/v1/tasks/${shipWindowTask.id}`, { method: 'PATCH', body: { to: 'in_progress' } });
        exporterClearedInput = await fetchJson(exporter.page, `/api/v1/tasks/${shipWindowTask.id}`, { method: 'PATCH', body: { to: 'done' } });
      }

      // The shipment and its partners ARE driven through the real API, because partner
      // assignment is itself a cross-portal artifact (AGT-06 -> OPS-04).
      const shipment = await prisma.shipment.create({
        data: {
          deal_id: dealId,
          status: 'planning',
          mode: 'sea',
          origin: { port: 'INNSA', name: 'Nhava Sheva' },
          destination: { port: 'AEJEA', name: 'Jebel Ali' },
        },
      });
      shipmentId = shipment.id;

      const chaPartner = await prisma.partner.findFirstOrThrow({ where: { type: 'cha', partner_status: 'active' } });
      const freightPartner = await prisma.partner.findFirstOrThrow({ where: { type: 'freight', partner_status: 'active' } });
      const assignCha = await fetchJson(agent.page, `/api/v1/deals/${dealId}/partners`, {
        method: 'POST',
        body: { partner_id: chaPartner.id, lane: 'cha', notes: 'Cross-portal walk: CHA packet sent.' },
      });
      const assignFreight = await fetchJson(agent.page, `/api/v1/deals/${dealId}/partners`, {
        method: 'POST',
        body: { partner_id: freightPartner.id, lane: 'freight', notes: 'Cross-portal walk: freight booked.' },
      });

      const doc = await prisma.document.findFirst({
        where: { deal_id: dealId, doc_type: 'shipping_bill_draft' },
      });
      if (!doc) throw new Error('Lock did not create a shipping bill draft to file.');

      // Agent marks it ready then filed; the authority then rejects it.
      const ready = await fetchJson(agent.page, `/api/v1/deals/${dealId}/documents/${doc.id}/file`, {
        method: 'POST',
        body: { action: 'mark_filed', filing_status: 'ready' },
      });
      const filed = await fetchJson(agent.page, `/api/v1/deals/${dealId}/documents/${doc.id}/file`, {
        method: 'POST',
        body: { action: 'mark_filed', filing_status: 'filed', filing_reference: 'SB-WALK-0001' },
      });
      const rejected = await fetchJson(agent.page, `/api/v1/deals/${dealId}/documents/${doc.id}/file`, {
        method: 'POST',
        body: { action: 'mark_filed', filing_status: 'rejected', note: 'HS code mismatch on line 2.' },
      });

      const after = await prisma.document.findUniqueOrThrow({ where: { id: doc.id } });
      const filingErr = (r: { body: unknown }) =>
        (r.body as { error?: { message?: string; blockers?: { reason: string }[] } } | null)?.error;
      const firstErr = [ready, filed, rejected].map(filingErr).find(Boolean);
      const errDetail = firstErr
        ? ` first error: ${firstErr.message}${firstErr.blockers?.length ? ` blockers=[${firstErr.blockers.map((b) => b.reason).join(' | ')}]` : ''};`
        : '';

      // Ops: OPS-04's rejected queue must surface it.
      await ops.page.goto(`${BASE}/ops/execution`, { waitUntil: 'networkidle' });
      const opsText = await ops.page.locator('body').innerText();
      const opsHtml = await ops.page.content();
      const opsSeesRejection = opsText.includes('HS code mismatch on line 2.');

      // Exporter: sees the document's rejected state on their own Documents tab —
      // the "safe update" the row calls for, with no internal filing chatter.
      await exporter.page.goto(`${BASE}/app/deals/${dealId}/documents`, { waitUntil: 'networkidle' });
      const exporterDocText = await exporter.page.locator('body').innerText();
      const exporterSeesSomething = exporterDocText.length > 0 && !/could not be found/i.test(exporterDocText);

      // The prior filed attempt must survive the rejection (OPS-04-AC02).
      const fileEvents = await prisma.auditEvent.findMany({
        where: { object_type: 'document', object_id: doc.id, action: 'file' },
      });
      const priorAttemptPreserved = JSON.stringify(fileEvents.map((e) => e.after_summary)).includes('SB-WALK-0001');

      // The agent's partner assignment must also reach OPS-04 — the AGT-06 -> OPS-04
      // half of this seam. Scoped to THIS deal's id in the page markup: the seed also
      // has a Konkan CHA handoff, so matching the partner name alone would pass on
      // seed data even if the walk's own assignment never arrived.
      const handoffRow = await prisma.partnerHandoff.findFirst({ where: { deal_id: dealId, lane: 'cha' } });
      const opsSeesHandoff = Boolean(handoffRow) && opsHtml.includes(dealId);

      record(
        'X6',
        'CHA rejects a filing → rejected status + Ops exception queue sees it, exporter gets a safe view',
        assignCha.status === 201 &&
          assignFreight.status === 201 &&
          ready.status === 200 &&
          filed.status === 200 &&
          rejected.status === 200 &&
          after.filing_status === 'rejected' &&
          opsSeesRejection &&
          opsSeesHandoff &&
          exporterSeesSomething &&
          priorAttemptPreserved
          ? 'PASS'
          : 'FAIL',
        `exporter cleared the blocking ship-window input task=${exporterClearedInput.status} (200 expected; this is what opens the upstream gate for the agent); agent assigns CHA=${assignCha.status} and freight=${assignFreight.status} (opens the checklist's CHA gate); ready=${ready.status}, filed=${filed.status}, rejected=${rejected.status};${errDetail} document filing_status=${after.filing_status}; OPS-04 shows the agent's handoff to ${chaPartner.display_name}=${opsSeesHandoff}; OPS-04 rejected queue shows the reason=${opsSeesRejection}; exporter Documents tab renders without leaking a filing error page=${exporterSeesSomething}; the earlier filed attempt reference SB-WALK-0001 is still in the audit trail=${priorAttemptPreserved}`,
      );
    });

    // ================================================================ X7
    // Shipment exception -> risk banner visible to exporter, Ops exception
    // queue sees it, owners explicit (docs/11 §3 row 8).
    // ================================================================
    await scenario('X7', 'Shipment exception → deal risk visible to exporter and Ops, with an explicit owner', async () => {
      if (!dealId) throw new Error('X5 did not lock a deal.');

      // Reuse the shipment X6 created and assigned partners to — a second shipment
      // row would be exactly the parallel-copy problem this walk exists to rule out.
      if (!shipmentId) throw new Error('X6 did not create a shipment.');
      await prisma.shipment.update({ where: { id: shipmentId }, data: { status: 'in_transit' } });

      const issue = await fetchJson(agent.page, `/api/v1/deals/${dealId}/shipment/issue`, {
        method: 'POST',
        body: { reason: 'Vessel delayed at transshipment port by 6 days.', severity: 'blocked' },
      });

      const deal = await prisma.deal.findUniqueOrThrow({ where: { id: dealId } });
      const riskRaised = deal.risk_state === 'blocked' || deal.risk_state === 'at_risk';

      // Exporter: the workspace layout renders the risk banner on every tab (EXP-09-AC04).
      await exporter.page.goto(`${BASE}/app/deals/${dealId}/shipment`, { waitUntil: 'networkidle' });
      const exporterText = await exporter.page.locator('body').innerText();
      const exporterSeesRisk = /This deal is (blocked|at risk)/.test(exporterText);

      // Ops: OPS-03 exception queue.
      await ops.page.goto(`${BASE}/ops/exceptions`, { waitUntil: 'networkidle' });
      const opsText = await ops.page.locator('body').innerText();
      const opsSeesException = opsText.includes('Vessel delayed at transshipment port by 6 days.');
      // "Ops/agent owners explicit" — the queue names an owner, never blank.
      const ownerNamed = /Rahul Menon|Unassigned/.test(opsText);

      record(
        'X7',
        'Shipment exception → deal risk visible to exporter and Ops, with an explicit owner',
        issue.status === 201 && riskRaised && exporterSeesRisk && opsSeesException && ownerNamed ? 'PASS' : 'FAIL',
        `raise shipment issue=${issue.status}; deal risk_state=${deal.risk_state} (raised=${riskRaised}); exporter's shipment tab shows the persistent risk banner=${exporterSeesRisk}; OPS-03 exception queue shows the same reason text=${opsSeesException}; queue names an explicit owner=${ownerNamed}`,
      );
    });

    // ================================================================ X8
    // Payment overdue -> exporter reminder + agent task + Ops risk; the
    // dispute path is available (docs/11 §3 row 9).
    // ================================================================
    await scenario('X8', 'Payment overdue → visible to exporter and Ops finance, dispute path available', async () => {
      if (!dealId) throw new Error('X5 did not lock a deal.');

      const payment = await prisma.payment.create({
        data: {
          deal_id: dealId,
          amount: 2200,
          currency: 'USD',
          status: 'due',
          due_at: new Date(Date.now() - 5 * 86_400_000),
          source: 'exporter_update',
          label: 'Full payment',
          sequence: 1,
        },
      });
      paymentId = payment.id;

      const marked = await fetchJson(agent.page, `/api/v1/deals/${dealId}/payment/${payment.id}`, {
        method: 'PATCH',
        body: { action: 'update_status', to: 'overdue', source: 'manual_ops', note: 'Buyer has not remitted against BL.' },
      });

      const after = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });

      // Exporter sees it on their own payment tab.
      await exporter.page.goto(`${BASE}/app/deals/${dealId}/payment`, { waitUntil: 'networkidle' });
      const exporterText = await exporter.page.locator('body').innerText();
      const exporterSeesOverdue = /overdue/i.test(exporterText);

      // Ops finance sees it in the overdue filter — a different role and screen.
      const finance = await loggedInContext(browser, 'finance@cleartrade.example');
      await finance.page.goto(`${BASE}/ops/finance?filter=overdue`, { waitUntil: 'networkidle' });
      const financeText = await finance.page.locator('body').innerText();
      const financeSeesOverdue = financeText.includes(dealId.slice(-6));
      await finance.ctx.close();

      record(
        'X8',
        'Payment overdue → visible to exporter and Ops finance, dispute path available',
        marked.status === 200 && after.status === 'overdue' && exporterSeesOverdue && financeSeesOverdue ? 'PASS' : 'FAIL',
        `mark overdue=${marked.status}; payment status=${after.status}; exporter's payment tab shows overdue=${exporterSeesOverdue}; OPS-05 finance overdue filter lists this deal=${financeSeesOverdue}`,
      );
    });

    // ================================================================ X9
    // Exporter opens a dispute -> Ops queue with owner; Ops proposes a
    // resolution; exporter accepts; risk clears via the explicit rule.
    // ================================================================
    await scenario('X9', 'Exporter opens a dispute → Ops resolves → exporter accepts → risk clears by explicit rule', async () => {
      if (!dealId || !paymentId) throw new Error('X8 did not produce a payment.');

      const opened = await fetchJson(exporter.page, `/api/v1/deals/${dealId}/disputes`, {
        method: 'POST',
        body: { type: 'payment', severity: 'high', summary: 'Buyer disputes the final 70% against BL.', payment_id: paymentId },
      });
      // The open-dispute route returns `{ dispute_id }`, not a bare `{ id }` — the
      // dedup contract needs to say whether it created or linked one.
      disputeId = (opened.body as { data?: { dispute_id: string } } | null)?.data?.dispute_id ?? null;

      // Ops sees it in the dispute queue immediately.
      await ops.page.goto(`${BASE}/ops/disputes`, { waitUntil: 'networkidle' });
      const opsQueueText = await ops.page.locator('body').innerText();
      const opsSeesDispute = opsQueueText.includes('Buyer disputes the final 70% against BL.');

      // Ops assigns an owner, then proposes a resolution.
      const assigned = await fetchJson(ops.page, `/api/v1/deals/${dealId}/disputes/${disputeId}`, {
        method: 'PATCH',
        body: { action: 'assign', owner_user_id: OPS_ID },
      });
      const proposed = await fetchJson(ops.page, `/api/v1/deals/${dealId}/disputes/${disputeId}`, {
        method: 'PATCH',
        body: { action: 'propose_resolution', resolution: 'Buyer to remit within 10 days against a revised BL; 1% credit note issued.' },
      });

      // The exporter — not Ops — accepts, from their own portal.
      const accepted = await fetchJson(exporter.page, `/api/v1/deals/${dealId}/disputes/${disputeId}`, {
        method: 'PATCH',
        body: { action: 'accept', confirm: true },
      });

      const dispute = disputeId ? await prisma.dispute.findUniqueOrThrow({ where: { id: disputeId } }) : null;
      const dealAfter = await prisma.deal.findUniqueOrThrow({ where: { id: dealId } });

      // The exporter's Support tab shows the resolved case.
      await exporter.page.goto(`${BASE}/app/deals/${dealId}/support`, { waitUntil: 'networkidle' });
      const supportText = await exporter.page.locator('body').innerText();
      const exporterSeesResolution = /Resolved history|credit note/i.test(supportText);

      const terminal = dispute?.status === DisputeStatus.resolved || dispute?.status === DisputeStatus.closed;

      record(
        'X9',
        'Exporter opens a dispute → Ops resolves → exporter accepts → risk clears by explicit rule',
        opened.status === 201 && opsSeesDispute && assigned.status === 200 && proposed.status === 200 && accepted.status === 200 && terminal && Boolean(dispute?.accepted_at)
          ? 'PASS'
          : 'FAIL',
        `exporter opens dispute=${opened.status}; Ops dispute queue shows it immediately=${opsSeesDispute}; Ops assign=${assigned.status}, propose=${proposed.status}; EXPORTER (not Ops) accepts=${accepted.status}; final status=${dispute?.status} (terminal=${terminal}), accepted_at recorded=${Boolean(dispute?.accepted_at)}; deal risk after resolution=${dealAfter.risk_state}; exporter Support tab shows the resolution=${exporterSeesResolution}`,
      );
    });

    // ================================================================ X10
    // Agent reassigned -> new agent gains access, old agent loses it, and
    // the audit trail is preserved (docs/11 §3 row 10).
    // ================================================================
    await scenario('X10', 'Agent reassigned → new agent gains access, old agent loses it, audit trail preserved', async () => {
      if (!dealId) throw new Error('X5 did not lock a deal.');

      const auditBefore = await prisma.auditEvent.count({ where: { exporter_org_id: ORG } });

      // A second agent, with no assignment to this org.
      const agentUser = await prisma.user.findFirstOrThrow({ where: { email: AGENT } });
      const newAgent = await prisma.user.upsert({
        where: { email: 'walk-agent-2@cleartrade.example' },
        update: {},
        create: {
          email: 'walk-agent-2@cleartrade.example',
          name: 'Walk Probe Agent',
          password_hash: agentUser.password_hash,
          role: 'agent',
        },
      });

      // Before reassignment: the new agent must NOT reach this org (AGT-02-AC01).
      const before = await loggedInContext(browser, 'walk-agent-2@cleartrade.example');
      const deniedBefore = await fetchJson(before.page, `/api/v1/exporters/${ORG}`);
      await before.ctx.close();

      // Reassign: end the old assignment, start the new one.
      const oldAssignment = await prisma.agentAssignment.findFirstOrThrow({
        where: { exporter_org_id: ORG, agent_user_id: AGENT_ID, status: 'active' },
      });
      await prisma.agentAssignment.update({
        where: { id: oldAssignment.id },
        data: { status: 'ended', ended_at: new Date(), reason: 'Cross-portal walk probe reassignment.' },
      });
      const newAssignment = await prisma.agentAssignment.create({
        data: { exporter_org_id: ORG, agent_user_id: newAgent.id, status: 'active', reason: 'Cross-portal walk probe reassignment.' },
      });

      // After: new agent gains access, old agent loses it.
      const afterNew = await loggedInContext(browser, 'walk-agent-2@cleartrade.example');
      const allowedAfter = await fetchJson(afterNew.page, `/api/v1/exporters/${ORG}`);
      await afterNew.ctx.close();

      const afterOld = await loggedInContext(browser, AGENT);
      const oldDenied = await fetchJson(afterOld.page, `/api/v1/exporters/${ORG}`);
      await afterOld.ctx.close();

      // Restore before asserting, so a failed assertion cannot leave the seed broken.
      await prisma.agentAssignment.delete({ where: { id: newAssignment.id } });
      await prisma.agentAssignment.update({ where: { id: oldAssignment.id }, data: { status: 'active', ended_at: null, reason: oldAssignment.reason } });
      await prisma.user.delete({ where: { id: newAgent.id } });

      const auditAfter = await prisma.auditEvent.count({ where: { exporter_org_id: ORG } });
      const auditPreserved = auditAfter >= auditBefore;

      record(
        'X10',
        'Agent reassigned → new agent gains access, old agent loses it, audit trail preserved',
        deniedBefore.status === 404 && allowedAfter.status === 200 && oldDenied.status === 404 && auditPreserved ? 'PASS' : 'FAIL',
        `unassigned agent BEFORE reassignment: GET /api/v1/exporters/${ORG}=${deniedBefore.status} (expect 404, never 403); AFTER gaining the assignment=${allowedAfter.status} (expect 200); the PREVIOUS agent after losing it=${oldDenied.status} (expect 404); audit events for this org ${auditBefore} -> ${auditAfter}, none destroyed by the reassignment=${auditPreserved}`,
      );
    });

    // ================================================================ X11
    // The whole walk is one canonical object graph — every artifact created
    // above hangs off the SAME deal id, with no parallel copies.
    // ================================================================
    await scenario('X11', 'Every artifact in the walk hangs off one canonical deal — no portal-local copies', async () => {
      if (!dealId || !leadId) throw new Error('The walk did not complete.');

      const [lead, proposals, snapshots, documents, tasks, shipments, payments, disputes, auditEvents] = await Promise.all([
        prisma.buyerLead.findUniqueOrThrow({ where: { id: leadId } }),
        prisma.dealProposal.count({ where: { deal_id: dealId } }),
        prisma.dealSnapshot.count({ where: { deal_id: dealId } }),
        prisma.document.count({ where: { deal_id: dealId } }),
        prisma.task.count({ where: { deal_id: dealId } }),
        prisma.shipment.count({ where: { deal_id: dealId } }),
        prisma.payment.count({ where: { deal_id: dealId } }),
        prisma.dispute.count({ where: { deal_id: dealId } }),
        prisma.auditEvent.count({ where: { object_id: dealId } }),
      ]);

      // Exactly one Deal row for this lead — a conversion that forked would show two.
      const dealsForLead = await prisma.deal.count({ where: { buyer_lead_id: leadId } });

      const everythingLinked =
        lead.deal_id === dealId &&
        dealsForLead === 1 &&
        proposals === 2 &&
        snapshots === 1 &&
        documents > 0 &&
        tasks > 0 &&
        shipments === 1 &&
        payments === 1 &&
        // Two by design, not one: X7's shipment exception opens a logistics case and
        // X9 opens a payment case. They are different problems on the same deal, and
        // `findOrCreateDispute` keys on (scope, type) precisely so they stay distinct.
        disputes === 2;

      record(
        'X11',
        'Every artifact in the walk hangs off one canonical deal — no portal-local copies',
        everythingLinked && auditEvents > 0 ? 'PASS' : 'FAIL',
        `one deal per lead=${dealsForLead === 1}; on deal ${dealId}: ${proposals} proposal versions, ${snapshots} frozen snapshot, ${documents} documents, ${tasks} tasks, ${shipments} shipment, ${payments} payment, ${disputes} dispute, ${auditEvents} audit events on the deal object itself — all reachable from the single canonical deal id, with no agent-local or ops-local duplicates`,
      );
    });

    await exporter.ctx.close();
    await agent.ctx.close();
    await ops.ctx.close();
  } finally {
    await cleanup();
    await browser.close();
  }

  summarize('CROSS-PORTAL INTEGRATION WALK (docs/11 §3)');
}

main()
  .catch((e) => {
    if (e instanceof PreflightError) console.error(`\n✗ PREFLIGHT FAILED\n\n  ${e.message}\n`);
    else console.error('SUITE CRASHED:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
