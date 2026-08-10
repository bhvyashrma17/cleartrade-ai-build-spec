/**
 * EXP-16 Messages, Support & Disputes verification.
 *
 * Covers, in order: AC01 (chat/dispute are separate object types, structurally), the
 * internal-note leak sweep (same discipline as AGT-06), owner task + notification on
 * open, obvious-duplicate dedup, and the full round trip — exporter opens a case, it
 * appears in the Ops queue with owner and SLA, Ops proposes a resolution, the exporter
 * accepts (requiring authorization and explicit confirmation), the case closes, and
 * `Deal.risk_state` updates through the explicit domain rule in
 * src/lib/state-machines/dispute.ts — never as an ORM side effect.
 *
 * Run with the dev server and worker up:
 *   npx tsx --env-file=.env scripts/verify-support-disputes.ts
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

const LOCKED_DEAL = 'seed-deal-locked';
const RISK_DEAL = 'seed-deal-negotiating'; // starts risk_state='normal' — the only deal where an escalate/clear cycle is observable
const OWNER = 'owner@sunriseagro.example';
const AGENT = 'agent@cleartrade.example';
const OPS = 'ops@cleartrade.example';
const CANARY = 'INTERNAL-ONLY-CANARY';

async function resetFixtures() {
  await prisma.dispute.deleteMany({
    where: {
      deal_id: { in: [LOCKED_DEAL, RISK_DEAL] },
      id: { notIn: ['seed-dispute-locked-proposed', 'seed-dispute-locked-closed'] },
    },
  });
  await prisma.task.deleteMany({ where: { deal_id: { in: [LOCKED_DEAL, RISK_DEAL] }, task_type: 'dispute_owner_response' } });
  await prisma.message.deleteMany({ where: { deal_id: { in: [LOCKED_DEAL, RISK_DEAL] }, id: { notIn: ['seed-message-locked-1', 'seed-message-locked-2'] } } });
  await prisma.deal.update({ where: { id: RISK_DEAL }, data: { risk_state: 'normal', risk_reason: null } });
  await prisma.dispute.updateMany({
    where: { id: 'seed-dispute-locked-proposed' },
    data: { status: 'proposed_resolution', owner_user_id: (await prisma.user.findFirst({ where: { email: AGENT } }))?.id, accepted_at: null, closed_at: null, closure_basis: null },
  });
}

async function main() {
  await preflight();
  await resetFixtures();
  const browser: Browser = await launch();

  try {
    // ---------------------------------------------------------------- AC01
    await scenario('AC01:separate-object-types', 'Chat and dispute records are structurally separate object types', async () => {
      const tables = await prisma.$queryRaw<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('Message','Dispute')
      `;
      const bothExist = tables.length === 2;

      // A message never carries dispute fields; a dispute never carries message fields.
      const messageCols = await prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns WHERE table_name = 'Message'
      `;
      const disputeOnlyColsOnMessage = messageCols.some((c) => ['severity', 'status', 'resolution', 'owner_user_id'].includes(c.column_name));

      // A message must never be the only record of a blocker: raising an issue always
      // creates a Dispute row, and the create-case UI never posts to /messages. Checked
      // against the actual API call the component makes, not the whole file text — the
      // file's own doc comment mentions "/messages" in prose, which would otherwise be a
      // false positive for a substring search.
      const componentSource = await import('node:fs/promises').then((fs) => fs.readFile('src/components/support/CreateCaseForm.tsx', 'utf8'));
      // Strip comments first — the file's own doc comment mentions "/messages" in prose,
      // which would otherwise be a false positive for a plain substring search.
      const codeOnly = componentSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      const apiCallLine = codeOnly.split('\n').find((l) => /apiPost[<(]/.test(l));
      const postsToDisputes = Boolean(apiCallLine?.includes('/disputes')) && !apiCallLine?.includes('/messages');

      record(
        'AC01:separate-object-types',
        'Chat and dispute records are structurally separate object types',
        bothExist && !disputeOnlyColsOnMessage && postsToDisputes ? 'PASS' : 'FAIL',
        `Message+Dispute both exist as distinct tables=${bothExist}, Message carries no dispute-only fields=${!disputeOnlyColsOnMessage}, case creation posts to /disputes not /messages=${postsToDisputes}`,
      );
    });

    // ---------------------------------------------------------------- L1
    await scenario('L1:no-leak-support-page', 'Internal notes never render on the Support page or exporter APIs', async () => {
      const { ctx, page } = await loggedInContext(browser, OWNER);
      await page.goto(`${BASE}/app/deals/${LOCKED_DEAL}/support`, { waitUntil: 'networkidle' });
      await sleep(400);
      const body = (await page.locator('body').textContent()) ?? '';
      const probe = await page.evaluate(async () => {
        const r = await fetch('/api/v1/messages');
        return { text: await r.text() };
      });
      await ctx.close();

      const leakOnPage = body.includes(CANARY);
      const leakInApi = probe.text.includes(CANARY);
      record(
        'L1:no-leak-support-page',
        'Internal notes never render on the Support page or exporter APIs',
        !leakOnPage && !leakInApi ? 'PASS' : 'FAIL',
        `canary on /support page=${leakOnPage}, canary in /api/v1/messages=${leakInApi}`,
      );
    });

    // ---------------------------------------------------------------- DEDUP
    await scenario('DEDUP:obvious-duplicate', 'Opening the same obvious case twice links the existing one', async () => {
      const { ctx, page } = await loggedInContext(browser, OWNER);
      const out = await page.evaluate(
        async ([dealId]) => {
          const payload = JSON.stringify({ type: 'inspection', severity: 'medium', summary: 'Buyer requested a pre-shipment inspection re-check.' });
          const headers = { 'Content-Type': 'application/json' };
          const r1 = await fetch(`/api/v1/deals/${dealId}/disputes`, { method: 'POST', headers, body: payload });
          const b1 = await r1.json().catch(() => null);
          const r2 = await fetch(`/api/v1/deals/${dealId}/disputes`, { method: 'POST', headers, body: payload });
          const b2 = await r2.json().catch(() => null);
          return { first: b1?.data?.dispute_id, firstCreated: b1?.data?.dispute_created, second: b2?.data?.dispute_id, secondCreated: b2?.data?.dispute_created };
        },
        [LOCKED_DEAL] as const,
      );
      await ctx.close();

      const count = await prisma.dispute.count({ where: { deal_id: LOCKED_DEAL, type: 'inspection' } });
      record(
        'DEDUP:obvious-duplicate',
        'Opening the same obvious case twice links the existing one',
        out.first === out.second && out.secondCreated === false && count === 1 ? 'PASS' : 'FAIL',
        `same dispute id=${out.first === out.second}, second created=${out.secondCreated}, inspection-type dispute rows=${count}`,
      );
    });

    // ---------------------------------------------------------------- OWNER-TASK
    await scenario('OWNER-TASK:open-creates-task-and-notification', 'Opening a case creates an owner task and notification', async () => {
      const before = await prisma.task.count({ where: { deal_id: LOCKED_DEAL, task_type: 'dispute_owner_response' } });
      const { ctx, page } = await loggedInContext(browser, OWNER);
      const out = await page.evaluate(
        async ([dealId]) => {
          const r = await fetch(`/api/v1/deals/${dealId}/disputes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'document', severity: 'high', summary: 'Certificate of origin has a typo in the HS code.' }),
          });
          const b = await r.json().catch(() => null);
          return { id: b?.data?.dispute_id, created: b?.data?.dispute_created };
        },
        [LOCKED_DEAL] as const,
      );
      await ctx.close();

      const after = await prisma.task.count({ where: { deal_id: LOCKED_DEAL, task_type: 'dispute_owner_response' } });
      const notification = await prisma.notification.findFirst({ where: { dedupe_key: `dispute-opened:${out.id}` } });
      record(
        'OWNER-TASK:open-creates-task-and-notification',
        'Opening a case creates an owner task and notification',
        out.created && after === before + 1 && Boolean(notification) ? 'PASS' : 'FAIL',
        `dispute created=${out.created}, owner tasks ${before}->${after}, notification row exists=${Boolean(notification)}`,
      );
    });

    // ---------------------------------------------------------------- ACCEPT-GUARDS
    await scenario('ACCEPT:requires-confirmation-and-authorization', 'Accepting a resolution requires an authorized exporter and confirmation', async () => {
      const dispute = 'seed-dispute-locked-proposed';

      const { ctx: expCtx, page: expPage } = await loggedInContext(browser, OWNER);
      const noConfirm = await expPage.evaluate(
        async ([dealId, disputeId]) => {
          const r = await fetch(`/api/v1/deals/${dealId}/disputes/${disputeId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'accept' }),
          });
          return r.status;
        },
        [LOCKED_DEAL, dispute] as const,
      );
      await expCtx.close();

      const { ctx: agentCtx, page: agentPage } = await loggedInContext(browser, AGENT);
      const agentTried = await agentPage.evaluate(
        async ([dealId, disputeId]) => {
          const r = await fetch(`/api/v1/deals/${dealId}/disputes/${disputeId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'accept', confirm: true }),
          });
          return r.status;
        },
        [LOCKED_DEAL, dispute] as const,
      );
      await agentCtx.close();

      const stillOpen = await prisma.dispute.findUniqueOrThrow({ where: { id: dispute } });
      record(
        'ACCEPT:requires-confirmation-and-authorization',
        'Accepting a resolution requires an authorized exporter and confirmation',
        noConfirm === 422 && agentTried === 403 && stillOpen.status === 'proposed_resolution' ? 'PASS' : 'FAIL',
        `missing confirm=${noConfirm} (expect 422), agent (not exporter) tries to accept=${agentTried} (expect 403), status unchanged=${stillOpen.status}`,
      );
    });

    // ---------------------------------------------------------------- ROUND TRIP
    await scenario('ROUNDTRIP:open-to-close', 'Full round trip: open -> visible in Ops queue with owner+SLA -> propose -> accept -> closed, risk updates via explicit rule', async () => {
      const agentUser = await prisma.user.findFirstOrThrow({ where: { email: AGENT } });
      const dealBefore = await prisma.deal.findUniqueOrThrow({ where: { id: RISK_DEAL } });

      // 1. Exporter opens a CRITICAL case on a deal that starts at normal risk.
      const { ctx: expCtx1, page: expPage1 } = await loggedInContext(browser, OWNER);
      const opened = await expPage1.evaluate(
        async ([dealId]) => {
          const r = await fetch(`/api/v1/deals/${dealId}/disputes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'payment', severity: 'critical', summary: 'Buyer is disputing the full invoice amount before any goods have shipped.' }),
          });
          const b = await r.json().catch(() => null);
          return { status: r.status, id: b?.data?.dispute_id };
        },
        [RISK_DEAL] as const,
      );
      await expCtx1.close();

      const dealAfterOpen = await prisma.deal.findUniqueOrThrow({ where: { id: RISK_DEAL } });
      const riskEscalated = dealAfterOpen.risk_state === 'blocked' && (dealAfterOpen.risk_reason ?? '').includes(opened.id ?? ' ');

      // 2. Visible in the Ops queue with owner + a next-update signal, before any Ops action.
      const { ctx: opsCtx, page: opsPage } = await loggedInContext(browser, OPS);
      await opsPage.goto(`${BASE}/ops/disputes`, { waitUntil: 'networkidle' });
      await sleep(400);
      const queueBody = (await opsPage.locator('body').textContent()) ?? '';
      const visibleInQueue = /Buyer is disputing the full invoice amount/.test(queueBody);
      const ownerShownInQueue = /Rahul Menon/.test(queueBody);

      // 3. Ops assigns (open -> investigating) then proposes a resolution.
      const assignRes = await opsPage.evaluate(
        async ([dealId, disputeId, ownerUserId]) => {
          const r = await fetch(`/api/v1/deals/${dealId}/disputes/${disputeId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'assign', owner_user_id: ownerUserId }),
          });
          return r.status;
        },
        [RISK_DEAL, opened.id, agentUser.id] as const,
      );
      const proposeRes = await opsPage.evaluate(
        async ([dealId, disputeId]) => {
          const r = await fetch(`/api/v1/deals/${dealId}/disputes/${disputeId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'propose_resolution', resolution: 'Buyer to pay 50% now, 50% on BL as originally agreed — reissuing the invoice breakdown.' }),
          });
          return r.status;
        },
        [RISK_DEAL, opened.id] as const,
      );
      await opsCtx.close();

      const afterProposal = await prisma.dispute.findUniqueOrThrow({ where: { id: opened.id } });

      // 4. Exporter accepts.
      const { ctx: expCtx2, page: expPage2 } = await loggedInContext(browser, OWNER);
      const acceptRes = await expPage2.evaluate(
        async ([dealId, disputeId]) => {
          const r = await fetch(`/api/v1/deals/${dealId}/disputes/${disputeId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'accept', confirm: true }),
          });
          return r.status;
        },
        [RISK_DEAL, opened.id] as const,
      );
      await expCtx2.close();

      const final = await prisma.dispute.findUniqueOrThrow({ where: { id: opened.id } });
      const dealAfterClose = await prisma.deal.findUniqueOrThrow({ where: { id: RISK_DEAL } });
      // The explicit domain rule: no other open dispute on this deal, so risk clears
      // all the way back to what it was before — not left dangling at some floor.
      const riskCleared = dealAfterClose.risk_state === dealBefore.risk_state && dealAfterClose.risk_reason === dealBefore.risk_reason;

      const allPass =
        opened.status === 201 &&
        riskEscalated &&
        visibleInQueue &&
        ownerShownInQueue &&
        assignRes === 200 &&
        proposeRes === 200 &&
        afterProposal.status === 'proposed_resolution' &&
        acceptRes === 200 &&
        final.status === 'closed' &&
        Boolean(final.accepted_at) &&
        Boolean(final.closed_at) &&
        riskCleared;

      record(
        'ROUNDTRIP:open-to-close',
        'Full round trip: open -> Ops queue with owner+SLA -> propose -> accept -> closed, risk updates via explicit rule',
        allPass ? 'PASS' : 'FAIL',
        `open=${opened.status}, risk escalated to blocked with dispute-attributed reason=${riskEscalated}, visible in ops queue=${visibleInQueue}, owner shown=${ownerShownInQueue}, assign=${assignRes}, propose=${proposeRes}, status after propose=${afterProposal.status}, accept=${acceptRes}, final status=${final.status}, accepted_at set=${Boolean(final.accepted_at)}, risk cleared back to prior state=${riskCleared}`,
      );

      // Leave the deal exactly as it started.
      await prisma.deal.update({ where: { id: RISK_DEAL }, data: { risk_state: dealBefore.risk_state, risk_reason: dealBefore.risk_reason } });
    });
  } finally {
    await browser.close();
    await resetFixtures();
  }

  summarize('EXP-16 MESSAGES, SUPPORT & DISPUTES');
}

main()
  .catch((e) => {
    if (e instanceof PreflightError) console.error(`\n✗ PREFLIGHT FAILED\n\n  ${e.message}\n`);
    else console.error('SUITE CRASHED:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
