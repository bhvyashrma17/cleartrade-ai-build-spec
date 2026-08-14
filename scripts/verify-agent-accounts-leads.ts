/**
 * Verification for AGT-02 (Exporter 360) and AGT-04 (Lead / Buyer Workspace).
 *
 * Run with the dev server up (and DB seeded):
 *   npx tsx --env-file=.env scripts/verify-agent-accounts-leads.ts
 */

import { BuyerLeadStage, UserRole, Visibility } from '@prisma/client';
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

const EXPORTER_ORG_ID = 'seed-org-1';
const OWNER = 'owner@sunriseagro.example';
const AGENT = 'agent@cleartrade.example';
const UNASSIGNED_AGENT_EMAIL = 'probe-unassigned-agent@cleartrade.example';

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

let cleanupUserIds: string[] = [];
let cleanupLeadIds: string[] = [];
let cleanupMessageIds: string[] = [];
let cleanupNoteIds: string[] = [];

async function resetFixtures() {
  if (cleanupMessageIds.length) await prisma.message.deleteMany({ where: { id: { in: cleanupMessageIds } } });
  if (cleanupNoteIds.length) await prisma.internalNote.deleteMany({ where: { id: { in: cleanupNoteIds } } });
  if (cleanupLeadIds.length) {
    await prisma.outreachActivity.deleteMany({ where: { buyer_lead_id: { in: cleanupLeadIds } } });
    await prisma.internalNote.deleteMany({ where: { buyer_lead_id: { in: cleanupLeadIds } } });
    await prisma.deal.deleteMany({ where: { buyer_lead_id: { in: cleanupLeadIds } } });
    await prisma.buyerLead.deleteMany({ where: { id: { in: cleanupLeadIds } } });
  }
  if (cleanupUserIds.length) await prisma.user.deleteMany({ where: { id: { in: cleanupUserIds } } });
  cleanupMessageIds = [];
  cleanupNoteIds = [];
  cleanupLeadIds = [];
  cleanupUserIds = [];
}

async function main() {
  await preflight();
  const browser: Browser = await launch();

  try {
    // -----------------------------------------------------------------
    // AGT-02-AC01: an agent unassigned to this exporter gets 404, not 403,
    // via a direct API call — never a page render.
    // -----------------------------------------------------------------
    await scenario('AGT-02-AC01', 'AC01: unassigned agent cannot reach an exporter by URL manipulation', async () => {
      const unassignedAgent = await prisma.user.create({
        data: {
          email: UNASSIGNED_AGENT_EMAIL,
          name: 'Probe Unassigned Agent',
          password_hash: (await prisma.user.findFirstOrThrow({ where: { email: AGENT } })).password_hash,
          role: UserRole.agent,
        },
      });
      cleanupUserIds.push(unassignedAgent.id);

      const { ctx, page } = await loggedInContext(browser, UNASSIGNED_AGENT_EMAIL);
      const res = await fetchJson(page, `/api/v1/exporters/${EXPORTER_ORG_ID}`);
      await ctx.close();

      record(
        'AGT-02-AC01',
        'AC01: unassigned agent cannot reach an exporter by URL manipulation',
        res.status === 404 ? 'PASS' : 'FAIL',
        `GET /api/v1/exporters/${EXPORTER_ORG_ID} as an unassigned agent -> ${res.status} (expect 404, never 403 — a 403 would confirm the org exists)`,
      );
    });

    // -----------------------------------------------------------------
    // AGT-02-AC02: exporter-visible and internal note composition modes are
    // structurally distinct — different tables, different endpoints, and an
    // internal note never reaches the exporter-facing Message payload.
    // -----------------------------------------------------------------
    await scenario('AGT-02-AC02', 'AC02: exporter-visible message vs internal note are structurally unmistakable', async () => {
      const secretNote = `INTERNAL-NOTE-PROBE-${Date.now()}`;
      const secretMessage = `EXPORTER-MESSAGE-PROBE-${Date.now()}`;

      const { ctx: agentCtx, page: agentPage } = await loggedInContext(browser, AGENT);
      const noteRes = await fetchJson(agentPage, `/api/v1/exporters/${EXPORTER_ORG_ID}/internal-notes`, {
        method: 'POST',
        body: { body: secretNote },
      });
      const msgRes = await fetchJson(agentPage, `/api/v1/exporters/${EXPORTER_ORG_ID}/messages`, {
        method: 'POST',
        body: { body: secretMessage },
      });
      const pageHtml = await (async () => {
        await agentPage.goto(`${BASE}/agent/exporters/${EXPORTER_ORG_ID}`, { waitUntil: 'networkidle' });
        return agentPage.content();
      })();
      await agentCtx.close();

      const noteId = (noteRes.body as { data?: { id: string } } | null)?.data?.id;
      const msgId = (msgRes.body as { data?: { id: string } } | null)?.data?.id;
      if (noteId) cleanupNoteIds.push(noteId);
      if (msgId) cleanupMessageIds.push(msgId);

      const wroteToInternalNoteTable = noteId ? Boolean(await prisma.internalNote.findUnique({ where: { id: noteId } })) : false;
      const wroteToMessageTable = msgId ? Boolean(await prisma.message.findUnique({ where: { id: msgId } })) : false;

      // The two composers must carry unmistakable, opposite-meaning labels.
      const internalLabelPresent = /never shown to the exporter/i.test(pageHtml);
      const exporterLabelPresent = /the exporter will see this/i.test(pageHtml);

      // The exporter-facing cross-deal message index must show the exporter-visible
      // message and must NEVER show the internal note's body.
      const { ctx: ownerCtx, page: ownerPage } = await loggedInContext(browser, OWNER);
      const exporterMessages = await fetchJson(ownerPage, '/api/v1/messages?per_page=50');
      await ownerCtx.close();
      const exporterRaw = JSON.stringify(exporterMessages.body);
      const exporterSeesMessage = exporterRaw.includes(secretMessage);
      const exporterLeaksNote = exporterRaw.includes(secretNote);

      const pass =
        noteRes.status === 201 &&
        msgRes.status === 201 &&
        wroteToInternalNoteTable &&
        wroteToMessageTable &&
        internalLabelPresent &&
        exporterLabelPresent &&
        exporterSeesMessage &&
        !exporterLeaksNote;

      record(
        'AGT-02-AC02',
        'AC02: exporter-visible message vs internal note are structurally unmistakable',
        pass ? 'PASS' : 'FAIL',
        `note->InternalNote table=${wroteToInternalNoteTable}, message->Message table=${wroteToMessageTable}, "never shown to the exporter" label rendered=${internalLabelPresent}, "the exporter will see this" label rendered=${exporterLabelPresent}, exporter's own /api/v1/messages sees the message=${exporterSeesMessage}, and never the internal note=${!exporterLeaksNote}`,
      );
    });

    // -----------------------------------------------------------------
    // AGT-02-AC03: the account page renders the SAME canonical Message row
    // the exporter's own portal reads — not a summarized or agent-local copy.
    // -----------------------------------------------------------------
    await scenario('AGT-02-AC03', 'AC03: account summary reflects shared canonical objects, not agent-local copies', async () => {
      const secret = `SHARED-OBJECT-PROBE-${Date.now()}`;
      const { ctx: agentCtx, page: agentPage } = await loggedInContext(browser, AGENT);
      const msgRes = await fetchJson(agentPage, `/api/v1/exporters/${EXPORTER_ORG_ID}/messages`, {
        method: 'POST',
        body: { body: secret },
      });
      await agentCtx.close();
      const msgId = (msgRes.body as { data?: { id: string } } | null)?.data?.id;
      if (msgId) cleanupMessageIds.push(msgId);

      // Read it back through the EXPORTER's own portal — same row, by id, no sync step.
      const { ctx: ownerCtx, page: ownerPage } = await loggedInContext(browser, OWNER);
      const exporterMessages = await fetchJson(ownerPage, '/api/v1/messages?per_page=50');
      await ownerCtx.close();
      const rows = (exporterMessages.body as { data?: { id: string; body: string }[] } | null)?.data ?? [];
      const sameRow = rows.find((r) => r.id === msgId);

      record(
        'AGT-02-AC03',
        'AC03: account summary reflects shared canonical objects, not agent-local copies',
        msgRes.status === 201 && Boolean(sameRow) && sameRow?.body === secret ? 'PASS' : 'FAIL',
        `message created via agent account route (id=${msgId}) is readable by id through the exporter's own /api/v1/messages, same body, no sync/copy step=${Boolean(sameRow) && sameRow?.body === secret}`,
      );
    });

    // -----------------------------------------------------------------
    // AGT-04-AC01: source evidence and verification status must render
    // BEFORE the contact list itself.
    // -----------------------------------------------------------------
    await scenario('AGT-04-AC01', 'AC01: source/evidence visible before the agent relies on buyer contact data', async () => {
      const product = await prisma.product.findFirstOrThrow({ where: { exporter_org_id: EXPORTER_ORG_ID } });
      // Other suites (verify-journey's J7) dynamically create a real lead for this
      // same (org, product, buyer) — clear it first rather than assume a pristine DB
      // (AGENTS.md: shared mutable seeded state). It is not a fixed seed fixture (only
      // buyer-1's lead is), so recreating it here is safe and J7 recreates its own on
      // its next run regardless.
      await prisma.buyerLead.deleteMany({ where: { exporter_org_id: EXPORTER_ORG_ID, product_id: product.id, buyer_id: 'seed-buyer-3' } });
      const lead = await prisma.buyerLead.create({
        data: {
          exporter_org_id: EXPORTER_ORG_ID,
          product_id: product.id,
          buyer_id: 'seed-buyer-3',
          stage: BuyerLeadStage.new,
        },
      });
      cleanupLeadIds.push(lead.id);

      const { ctx, page } = await loggedInContext(browser, AGENT);
      await page.goto(`${BASE}/agent/leads/${lead.id}`, { waitUntil: 'networkidle' });
      const text = await page.locator('body').innerText();
      await ctx.close();

      const evidenceIdx = text.indexOf('Source evidence');
      const contactsIdx = text.indexOf('Contacts');
      const evidenceContentPresent = text.includes('UAE customs import filings');
      const contactPresent = text.includes('Fatima Al Nuaimi');
      const orderCorrect = evidenceIdx !== -1 && contactsIdx !== -1 && evidenceIdx < contactsIdx;

      record(
        'AGT-04-AC01',
        'AC01: source/evidence visible before the agent relies on buyer contact data',
        orderCorrect && evidenceContentPresent && contactPresent ? 'PASS' : 'FAIL',
        `"Source evidence" section index=${evidenceIdx}, "Contacts" section index=${contactsIdx} (evidence must come first), evidence content rendered=${evidenceContentPresent}, contact rendered=${contactPresent}`,
      );
    });

    // -----------------------------------------------------------------
    // AGT-04-AC03: lead-to-deal conversion retains lead history and relation.
    // -----------------------------------------------------------------
    await scenario('AGT-04-AC03', 'AC03: lead-to-deal conversion retains lead history and relation', async () => {
      // A different product from AC01's fixture above — both scenarios use buyer-3,
      // and AC01's lead is still alive (cleanup happens once, at the very end), so
      // reusing its product would collide on the (org, product, buyer) unique key.
      const products = await prisma.product.findMany({ where: { exporter_org_id: EXPORTER_ORG_ID }, orderBy: { created_at: 'asc' } });
      const product = products[1] ?? products[0];
      await prisma.buyerLead.deleteMany({ where: { exporter_org_id: EXPORTER_ORG_ID, product_id: product.id, buyer_id: 'seed-buyer-3' } });
      const lead = await prisma.buyerLead.create({
        data: {
          exporter_org_id: EXPORTER_ORG_ID,
          product_id: product.id,
          buyer_id: 'seed-buyer-3',
          stage: BuyerLeadStage.negotiation,
          assigned_agent_id: (await prisma.user.findFirstOrThrow({ where: { email: AGENT } })).id,
        },
      });
      cleanupLeadIds.push(lead.id);
      const priorActivity = await prisma.outreachActivity.create({
        data: {
          buyer_lead_id: lead.id,
          actor_user_id: lead.assigned_agent_id!,
          type: 'call',
          visibility: Visibility.internal,
          summary: 'Pre-conversion call — must survive conversion.',
        },
      });

      const { ctx, page } = await loggedInContext(browser, AGENT);
      const res = await fetchJson(page, `/api/v1/leads/${lead.id}/convert`, {
        method: 'POST',
        body: { quantity: 1000, unit: 'kg', unit_price_amount: 3.5, unit_price_currency: 'USD', incoterm: 'FOB' },
      });
      await ctx.close();

      const body = res.body as { data?: { deal: { id: string }; lead: { id: string; stage: string; deal_id: string } } } | null;
      const dealId = body?.data?.deal.id;

      const reloadedLead = await prisma.buyerLead.findUniqueOrThrow({ where: { id: lead.id } });
      const reloadedDeal = dealId ? await prisma.deal.findUnique({ where: { id: dealId } }) : null;
      const activityStillLinked = await prisma.outreachActivity.findUnique({ where: { id: priorActivity.id } });

      const pass =
        res.status === 201 &&
        reloadedLead.id === lead.id && // same row, not a new lead
        reloadedLead.stage === BuyerLeadStage.converted &&
        reloadedLead.deal_id === dealId &&
        reloadedDeal?.buyer_lead_id === lead.id &&
        activityStillLinked?.buyer_lead_id === lead.id;

      record(
        'AGT-04-AC03',
        'AC03: lead-to-deal conversion retains lead history and relation',
        pass ? 'PASS' : 'FAIL',
        `convert status=${res.status}; lead id unchanged=${reloadedLead.id === lead.id}; lead.stage=${reloadedLead.stage} (expect converted); lead.deal_id=${reloadedLead.deal_id}; deal.buyer_lead_id=${reloadedDeal?.buyer_lead_id} (expect ${lead.id}); pre-conversion outreach activity still linked to the same lead=${activityStillLinked?.buyer_lead_id === lead.id}`,
      );
    });
  } finally {
    await resetFixtures();
    await browser.close();
  }

  summarize('AGT-02 / AGT-04 ACCEPTANCE');
}

main()
  .catch((e) => {
    if (e instanceof PreflightError) console.error(`\n✗ PREFLIGHT FAILED\n\n  ${e.message}\n`);
    else console.error('SUITE CRASHED:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
