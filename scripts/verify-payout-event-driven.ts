/**
 * Verification: payout eligibility recomputes off the EVENT, not off a manual button.
 *
 * Per the AGENTS.md rule this session added ("seeded fixtures hand-place END states, so
 * the transitions into them go unexercised"): this builds its own deal and payment from
 * scratch, drives the payment to `realized` through the REAL PATCH route, and never
 * calls `POST /api/v1/payouts/recompute` — the payout must flip to `eligible` because
 * `triggerPayoutRecompute()` enqueued a `payout_recompute` job and the worker ran it.
 *
 * Requires the dev server AND the worker running:
 *   npm run dev        (separate shell)
 *   npm run worker      (separate shell)
 *   npx tsx --env-file=.env scripts/verify-payout-event-driven.ts
 */

import { DealStage, JobStatus, JobType, PayoutState } from '@prisma/client';
import {
  launch,
  loggedInContext,
  preflight,
  PreflightError,
  record,
  scenario,
  sleep,
  summarize,
  type Browser,
  type Page,
} from './verify-harness';
import { prisma } from '../src/lib/prisma';

const AGENT = 'agent@cleartrade.example';
const OPS = 'ops@cleartrade.example';
const ORG = 'seed-org-1';
const AGENT_ID = 'seed-user-agent';
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

/** Poll a condition rather than sleep a fixed guess — this is waiting on a real async worker. */
async function pollUntil<T>(fn: () => Promise<T>, ok: (v: T) => boolean, timeoutMs: number, intervalMs = 300): Promise<T> {
  const start = Date.now();
  let last: T;
  do {
    last = await fn();
    if (ok(last)) return last;
    await sleep(intervalMs);
  } while (Date.now() - start < timeoutMs);
  return last;
}

const dealIds: string[] = [];

async function cleanup() {
  for (const dealId of dealIds) {
    await prisma.jobAttempt.deleteMany({ where: { job: { target_type: 'deal', target_id: dealId } } });
    await prisma.job.deleteMany({ where: { target_type: 'deal', target_id: dealId } });
    await prisma.payoutAdjustment.deleteMany({ where: { payout: { deal_id: dealId } } });
    await prisma.payout.deleteMany({ where: { deal_id: dealId } });
    await prisma.auditEvent.deleteMany({ where: { object_id: dealId } });
    await prisma.dispute.deleteMany({ where: { deal_id: dealId } });
    await prisma.payment.deleteMany({ where: { deal_id: dealId } });
    await prisma.deal.deleteMany({ where: { id: dealId } });
  }
}

async function main() {
  await preflight();
  const browser: Browser = await launch();

  try {
    const { ctx: agentCtx, page: agentPage } = await loggedInContext(browser, AGENT);
    const { ctx: opsCtx, page: opsPage } = await loggedInContext(browser, OPS);

    // -----------------------------------------------------------------
    // Scenario 1: create a deal, realize its payment through the real route,
    // and confirm the payout flips to eligible with no manual intervention.
    // -----------------------------------------------------------------
    await scenario(
      'PAYOUT-EVENT-1',
      'Payment realization → payout auto-flips to eligible via the job queue, no manual recompute',
      async () => {
        const deal = await prisma.deal.create({
          data: {
            exporter_org_id: ORG,
            buyer_id: BUYER,
            stage: DealStage.deal_locked,
            owner_agent_id: AGENT_ID,
            value_amount: 10000,
            value_currency: 'USD',
            total_amount: 10000,
            total_currency: 'USD',
            locked_at: new Date(),
          },
        });
        dealIds.push(deal.id);

        const payment = await prisma.payment.create({
          data: { deal_id: deal.id, amount: 10000, currency: 'USD', status: 'due', label: 'Full payment', sequence: 1 },
        });

        // Hop 1: due -> received. Real API call — this is the event under test.
        const toReceived = await fetchJson(agentPage, `/api/v1/deals/${deal.id}/payment/${payment.id}`, {
          method: 'PATCH',
          body: { action: 'update_status', to: 'received', source: 'bank_partner', amount_received: 10000 },
        });

        // Immediately after the route responds — before any polling wait — a
        // `payout_recompute` Job row for this deal must already exist. That is the
        // structural proof the recompute happened on the QUEUE, not inline in the
        // request: the route enqueued a row and returned, it did not compute the
        // payout itself.
        const jobRightAfterResponse = await prisma.job.findFirst({
          where: { type: JobType.payout_recompute, target_type: 'deal', target_id: deal.id },
          orderBy: { created_at: 'desc' },
        });

        // Hop 2: received -> realized. This is the fact that actually satisfies the
        // default policy (`require_payment_realized: true`).
        const toRealized = await fetchJson(agentPage, `/api/v1/deals/${deal.id}/payment/${payment.id}`, {
          method: 'PATCH',
          body: { action: 'update_status', to: 'realized', source: 'bank_partner' },
        });

        // No call to /api/v1/payouts/recompute anywhere in this scenario. Poll the
        // DATABASE ROW directly for the worker to finish the job it was enqueued.
        const payout = await pollUntil(
          () => prisma.payout.findFirst({ where: { deal_id: deal.id, agent_user_id: AGENT_ID } }),
          (p) => p?.state === PayoutState.eligible,
          15_000,
        );

        const completedJob = await prisma.job.findFirst({
          where: { type: JobType.payout_recompute, target_type: 'deal', target_id: deal.id, status: JobStatus.completed },
          orderBy: { created_at: 'desc' },
        });
        const resultPayload = completedJob?.result as { became_eligible?: boolean; state?: string } | null;

        const pass =
          toReceived.status === 200 &&
          toRealized.status === 200 &&
          Boolean(jobRightAfterResponse) &&
          payout?.state === PayoutState.eligible &&
          Number(payout?.basis_amount) === 10000 &&
          Boolean(completedJob) &&
          resultPayload?.became_eligible === true;

        record(
          'PAYOUT-EVENT-1',
          'Payment realization → payout auto-flips to eligible via the job queue, no manual recompute',
          pass ? 'PASS' : 'FAIL',
          `mark received=${toReceived.status}; a payout_recompute Job row existed immediately after that response (proves the route enqueued, not computed inline)=${Boolean(jobRightAfterResponse)}; mark realized=${toRealized.status}; polled Payout.state (no manual recompute call made)=${payout?.state}; basis_amount=${payout?.basis_amount}; a completed job recorded became_eligible=${resultPayload?.became_eligible}`,
        );
      },
    );

    // -----------------------------------------------------------------
    // Scenario 2: an open dispute blocks eligibility even once the payment
    // realizes; closing it is what lets the SAME payment flip to eligible —
    // proving the dispute open/close wiring, not just the payment wiring.
    // -----------------------------------------------------------------
    await scenario(
      'PAYOUT-EVENT-2',
      'Open dispute blocks eligibility despite realized payment; closing it (not the payment event) flips it',
      async () => {
        const deal = await prisma.deal.create({
          data: {
            exporter_org_id: ORG,
            buyer_id: 'seed-buyer-1',
            stage: DealStage.deal_locked,
            owner_agent_id: AGENT_ID,
            value_amount: 5000,
            value_currency: 'USD',
            total_amount: 5000,
            total_currency: 'USD',
            locked_at: new Date(),
          },
        });
        dealIds.push(deal.id);

        const payment = await prisma.payment.create({
          data: { deal_id: deal.id, amount: 5000, currency: 'USD', status: 'due', label: 'Full payment', sequence: 1 },
        });

        // Open the dispute BEFORE the payment realizes, so the recompute that runs at
        // realization time sees it and stays blocked.
        const opened = await fetchJson(agentPage, `/api/v1/deals/${deal.id}/disputes`, {
          method: 'POST',
          body: { type: 'payment', severity: 'medium', summary: 'Verify probe: buyer disputes final tranche.', payment_id: payment.id },
        });
        const disputeId = (opened.body as { data?: { dispute_id: string } } | null)?.data?.dispute_id;

        await fetchJson(agentPage, `/api/v1/deals/${deal.id}/payment/${payment.id}`, {
          method: 'PATCH',
          body: { action: 'update_status', to: 'received', source: 'bank_partner', amount_received: 5000 },
        });
        await fetchJson(agentPage, `/api/v1/deals/${deal.id}/payment/${payment.id}`, {
          method: 'PATCH',
          body: { action: 'update_status', to: 'realized', source: 'bank_partner' },
        });

        // Give the (correctly blocked) recompute a moment to run, then confirm it
        // really did run and really did stay not_eligible — not just "hasn't run yet".
        await sleep(2000);
        const blockedPayout = await prisma.payout.findFirst({ where: { deal_id: deal.id, agent_user_id: AGENT_ID } });
        const staysBlockedWithReason = blockedPayout?.state === PayoutState.not_eligible && Boolean(blockedPayout?.ineligible_reason?.match(/dispute/i));

        // Close the case: assign -> propose_resolution -> close, as Ops.
        await fetchJson(opsPage, `/api/v1/deals/${deal.id}/disputes/${disputeId}`, {
          method: 'PATCH',
          body: { action: 'assign', owner_user_id: 'seed-user-ops' },
        });
        await fetchJson(opsPage, `/api/v1/deals/${deal.id}/disputes/${disputeId}`, {
          method: 'PATCH',
          body: { action: 'propose_resolution', resolution: 'Verify probe: charge confirmed correct, no adjustment.' },
        });
        const closed = await fetchJson(opsPage, `/api/v1/deals/${deal.id}/disputes/${disputeId}`, {
          method: 'PATCH',
          body: { action: 'close', closure_basis: 'verify_probe', closure_summary: 'Verify probe: resolved, no adjustment needed.' },
        });

        // The CLOSE action is what should trigger the flip now — the payment event
        // already fired earlier and found the deal still blocked.
        const payout = await pollUntil(
          () => prisma.payout.findFirst({ where: { deal_id: deal.id, agent_user_id: AGENT_ID } }),
          (p) => p?.state === PayoutState.eligible,
          15_000,
        );

        const pass = opened.status === 201 && closed.status === 200 && staysBlockedWithReason && payout?.state === PayoutState.eligible;

        record(
          'PAYOUT-EVENT-2',
          'Open dispute blocks eligibility despite realized payment; closing it (not the payment event) flips it',
          pass ? 'PASS' : 'FAIL',
          `dispute opened=${opened.status}; after payment realized WHILE dispute still open: payout stayed not_eligible with a dispute-related reason=${staysBlockedWithReason} (reason: "${blockedPayout?.ineligible_reason}"); dispute closed=${closed.status}; payout state after the CLOSE event (not a manual recompute)=${payout?.state}`,
        );
      },
    );

    await agentCtx.close();
    await opsCtx.close();
  } finally {
    await cleanup();
    await browser.close();
  }

  summarize('PAYOUT EVENT-DRIVEN RECOMPUTE');
}

main()
  .catch((e) => {
    if (e instanceof PreflightError) console.error(`\n✗ PREFLIGHT FAILED\n\n  ${e.message}\n`);
    else console.error('SUITE CRASHED:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
