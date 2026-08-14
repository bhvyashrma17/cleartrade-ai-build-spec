/**
 * Verification for AGT-08 (Agent Performance & Payout) and the OPS-05 payout section.
 *
 * Run with the dev server up (and DB seeded):
 *   npx tsx --env-file=.env scripts/verify-agent-payout.ts
 */

import { PayoutState } from '@prisma/client';
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

const AGENT = 'agent@cleartrade.example';
const OPS = 'ops@cleartrade.example';
const OPS_FINANCE = 'finance@cleartrade.example';
const SEED_PAYOUT_DEAL = 'seed-deal-locked';
const SEED_AGENT_ID = 'seed-user-agent';

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

let cleanupAdjustmentIds: string[] = [];

async function resetFixtures() {
  if (cleanupAdjustmentIds.length) {
    await prisma.payoutAdjustment.deleteMany({ where: { id: { in: cleanupAdjustmentIds } } });
    cleanupAdjustmentIds = [];
  }
  // Restore the seeded payout to its fixture state — other suites and the contrast
  // sweep read this row.
  await prisma.payout.updateMany({
    where: { deal_id: SEED_PAYOUT_DEAL, agent_user_id: SEED_AGENT_ID },
    data: { state: PayoutState.paid, dispute_id: null },
  });
}

async function main() {
  await preflight();
  const browser: Browser = await launch();

  try {
    // -----------------------------------------------------------------
    // AGT-08-AC01: the agent cannot edit the payout calculation. Direct API
    // calls against every write route, bypassing the UI entirely.
    // -----------------------------------------------------------------
    await scenario('AGT-08-AC01', 'AC01: agent cannot edit the payout calculation', async () => {
      const payout = await prisma.payout.findFirstOrThrow({
        where: { deal_id: SEED_PAYOUT_DEAL, agent_user_id: SEED_AGENT_ID },
      });
      const before = { amount: payout.amount.toString(), state: payout.state };

      const { ctx, page } = await loggedInContext(browser, AGENT);
      // Every finance-side write, attempted as the agent who OWNS this payout.
      const approve = await fetchJson(page, `/api/v1/payouts/${payout.id}`, { method: 'PATCH', body: { to: 'approved' } });
      const markPaid = await fetchJson(page, `/api/v1/payouts/${payout.id}`, {
        method: 'PATCH',
        body: { to: 'paid', payment_reference: 'AGENT-SELF-PAY' },
      });
      const adjust = await fetchJson(page, `/api/v1/payouts/${payout.id}/adjustments`, {
        method: 'POST',
        body: { amount: 100000, reason: 'Agent trying to pay themselves more.', confirm: true },
      });
      const recompute = await fetchJson(page, '/api/v1/payouts/recompute', { method: 'POST', body: {} });
      await ctx.close();

      const after = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
      const adjustments = await prisma.payoutAdjustment.count({ where: { payout_id: payout.id } });

      const allRefused = [approve.status, markPaid.status, adjust.status, recompute.status].every((s) => s === 403);
      const unchanged = after.amount.toString() === before.amount && after.state === before.state;

      record(
        'AGT-08-AC01',
        'AC01: agent cannot edit the payout calculation',
        allRefused && unchanged && adjustments === 1 ? 'PASS' : 'FAIL',
        `as the OWNING agent: approve=${approve.status}, mark-paid=${markPaid.status}, adjust=${adjust.status}, recompute=${recompute.status} (all expect 403); amount unchanged=${unchanged} (${before.amount} -> ${after.amount}); adjustment rows still ${adjustments} (expect 1, the seeded one)`,
      );
    });

    // -----------------------------------------------------------------
    // AGT-08-AC02: payout is based on an IMMUTABLE deal-level fee/share
    // snapshot — a new FeePolicy version must not move an existing payout.
    // -----------------------------------------------------------------
    await scenario('AGT-08-AC02', 'AC02: payout uses an immutable fee/share snapshot', async () => {
      const before = await prisma.payout.findFirstOrThrow({
        where: { deal_id: SEED_PAYOUT_DEAL, agent_user_id: SEED_AGENT_ID },
      });
      const activePolicy = await prisma.feePolicy.findFirstOrThrow({ where: { is_active: true }, orderBy: { version: 'desc' } });

      // Publish a new fee policy that DOUBLES the agent share. If any read path
      // recalculated instead of reading the snapshot, the payout would move.
      const { ctx: adminCtx, page: adminPage } = await loggedInContext(browser, 'admin@cleartrade.example');
      const newPolicy = await fetchJson(adminPage, '/api/v1/fee-policy', {
        method: 'POST',
        body: {
          commitment_fee_amount: Number(activePolicy.commitment_fee_amount),
          commitment_fee_currency: activePolicy.commitment_fee_currency,
          success_fee_rate: Number(activePolicy.success_fee_rate) * 2,
          small_shipment_threshold_amount: Number(activePolicy.small_shipment_threshold_amount),
          small_shipment_threshold_currency: activePolicy.small_shipment_threshold_currency,
          small_shipment_rate: Number(activePolicy.small_shipment_rate),
          small_shipment_flat_amount: Number(activePolicy.small_shipment_flat_amount),
          agent_share_rate: Math.min(1, Number(activePolicy.agent_share_rate) * 2),
          minimum_shipment_amount: Number(activePolicy.minimum_shipment_amount),
          minimum_shipment_currency: activePolicy.minimum_shipment_currency,
        },
      });
      await adminCtx.close();

      // Force a recompute — the code path most likely to overwrite, if it ever did.
      const { ctx: finCtx, page: finPage } = await loggedInContext(browser, OPS_FINANCE);
      const recompute = await fetchJson(finPage, '/api/v1/payouts/recompute', { method: 'POST', body: {} });
      // And re-read the agent's own page, which renders from stored columns.
      await finCtx.close();

      const { ctx: agentCtx, page: agentPage } = await loggedInContext(browser, AGENT);
      await agentPage.goto(`${BASE}/agent/performance`, { waitUntil: 'networkidle' });
      const pageText = await agentPage.locator('body').innerText();
      await agentCtx.close();

      const after = await prisma.payout.findUniqueOrThrow({ where: { id: before.id } });

      // Clean up: restore the original active policy and delete the probe version.
      const probe = await prisma.feePolicy.findFirstOrThrow({ where: { is_active: true }, orderBy: { version: 'desc' } });
      await prisma.feePolicy.update({ where: { id: activePolicy.id }, data: { is_active: true } });
      if (probe.id !== activePolicy.id) await prisma.feePolicy.delete({ where: { id: probe.id } });

      const amountFrozen = after.amount.toString() === before.amount.toString();
      const rateFrozen = after.agent_share_rate === before.agent_share_rate;
      const versionFrozen = after.fee_policy_version === before.fee_policy_version;
      const pageShowsOriginal = pageText.includes('USD 420');

      record(
        'AGT-08-AC02',
        'AC02: payout uses an immutable fee/share snapshot',
        newPolicy.status === 201 && recompute.status === 200 && amountFrozen && rateFrozen && versionFrozen && pageShowsOriginal
          ? 'PASS'
          : 'FAIL',
        `published a fee policy with DOUBLE the success fee and agent share (${newPolicy.status}), then forced a recompute (${recompute.status}); payout amount ${before.amount} -> ${after.amount} (frozen=${amountFrozen}); agent_share_rate ${before.agent_share_rate} -> ${after.agent_share_rate} (frozen=${rateFrozen}); fee_policy_version ${before.fee_policy_version} -> ${after.fee_policy_version} (frozen=${versionFrozen}); agent page still renders the original amount=${pageShowsOriginal}`,
      );
    });

    // -----------------------------------------------------------------
    // AGT-08-AC03: every metric declares its window and denominator.
    // Asserted against the computed data, not by eyeballing the page.
    // -----------------------------------------------------------------
    await scenario('AGT-08-AC03', 'AC03: every metric declares time window and denominator', async () => {
      const { computeAgentMetrics } = await import('../src/lib/agent-metrics');
      const metrics = await computeAgentMetrics(SEED_AGENT_ID);
      const all = [...metrics.performance, ...metrics.quality];

      const missingWindow = all.filter((m) => !m.window || m.window.trim().length === 0);
      // A rate (value ends in %) MUST name its denominator; a raw count may not have one.
      const ratesMissingDenominator = all.filter((m) => m.value.includes('%') && !m.denominator);

      const { ctx, page } = await loggedInContext(browser, AGENT);
      await page.goto(`${BASE}/agent/performance`, { waitUntil: 'networkidle' });
      const text = await page.locator('body').innerText();
      await ctx.close();

      // Every metric's window and denominator must actually reach the screen.
      const renderedForAll = all.every(
        (m) => text.includes(m.label) && text.includes(m.window) && (m.denominator ? text.includes(m.denominator) : true),
      );
      // "No single composite score" — asserted against the METRIC SET, not the page
      // copy. A whole-body regex is wrong here: the page legitimately contains the
      // phrase "there is no single overall score" as a disclaimer, and a naive text
      // match flags that denial as if it were the thing being denied. What actually
      // matters is that no metric IS a composite, and that the returned shape has no
      // aggregate field for one to hide in.
      const compositeLabels = all.filter((m) => /overall|composite|rating|total score|index/i.test(m.label));
      const metricsShape = Object.keys(metrics);
      const noAggregateField = !metricsShape.some((k) => /score|rating|rank/i.test(k));
      const noCompositeScore = compositeLabels.length === 0 && noAggregateField;

      record(
        'AGT-08-AC03',
        'AC03: every metric declares time window and denominator',
        all.length === 10 && missingWindow.length === 0 && ratesMissingDenominator.length === 0 && renderedForAll && noCompositeScore
          ? 'PASS'
          : 'FAIL',
        `${all.length} metrics computed (9-metric Blueprint catalog + dispute split); missing a window=${missingWindow.length}; rates missing a denominator=${ratesMissingDenominator.length}; every label+window+denominator actually rendered=${renderedForAll}; no composite metric in the set (${compositeLabels.length} composite-sounding labels) and no aggregate score field on the returned shape [${metricsShape.join(', ')}]=${noCompositeScore}`,
      );
    });

    // -----------------------------------------------------------------
    // OPS-05-AC03: adjustments are additive, never destructive rewrites.
    // -----------------------------------------------------------------
    await scenario('OPS-05-AC03', 'AC03: payout adjustments are additive, never destructive', async () => {
      const payout = await prisma.payout.findFirstOrThrow({
        where: { deal_id: SEED_PAYOUT_DEAL, agent_user_id: SEED_AGENT_ID },
        include: { adjustments: true },
      });
      const originalAmount = payout.amount.toString();
      const adjustmentsBefore = payout.adjustments.length;

      const { ctx, page } = await loggedInContext(browser, OPS_FINANCE);
      const res = await fetchJson(page, `/api/v1/payouts/${payout.id}/adjustments`, {
        method: 'POST',
        body: { amount: -15, reason: 'Verification probe: further clawback.', confirm: true },
      });
      await ctx.close();

      const adjustmentId = (res.body as { data?: { adjustment: { id: string } } } | null)?.data?.adjustment.id;
      if (adjustmentId) cleanupAdjustmentIds.push(adjustmentId);

      const after = await prisma.payout.findUniqueOrThrow({
        where: { id: payout.id },
        include: { adjustments: { orderBy: { created_at: 'asc' } } },
      });

      const baseUntouched = after.amount.toString() === originalAmount;
      const appended = after.adjustments.length === adjustmentsBefore + 1;
      const originalAdjustmentSurvives = after.adjustments.some((a) => a.reason.includes('Partial clawback'));
      const netCorrect = Math.abs(
        Number(after.amount) + after.adjustments.reduce((s, a) => s + Number(a.amount), 0) - (420 - 21 - 15),
      ) < 0.01;

      record(
        'OPS-05-AC03',
        'AC03: payout adjustments are additive, never destructive',
        res.status === 201 && baseUntouched && appended && originalAdjustmentSurvives && netCorrect ? 'PASS' : 'FAIL',
        `adjustment call=${res.status}; Payout.amount still the ORIGINAL quote ${originalAmount} after adjusting=${baseUntouched}; adjustment rows ${adjustmentsBefore} -> ${after.adjustments.length} (appended=${appended}); the pre-existing adjustment still present=${originalAdjustmentSurvives}; net = base + sum(adjustments) = 384 as expected=${netCorrect}`,
      );
    });

    // -----------------------------------------------------------------
    // OPS-05: approve/mark-paid are finance-role only — an ops_supervisor
    // (who runs every other Ops screen) must be refused.
    // -----------------------------------------------------------------
    await scenario('OPS-05-ROLE', 'Approve / mark-paid are finance-role only', async () => {
      const payout = await prisma.payout.findFirstOrThrow({
        where: { deal_id: SEED_PAYOUT_DEAL, agent_user_id: SEED_AGENT_ID },
      });

      const { ctx: opsCtx, page: opsPage } = await loggedInContext(browser, OPS);
      const supervisorApprove = await fetchJson(opsPage, `/api/v1/payouts/${payout.id}`, { method: 'PATCH', body: { to: 'approved' } });
      const supervisorAdjust = await fetchJson(opsPage, `/api/v1/payouts/${payout.id}/adjustments`, {
        method: 'POST',
        body: { amount: -5, reason: 'Supervisor should not be able to do this.', confirm: true },
      });
      await opsPage.goto(`${BASE}/ops/finance`, { waitUntil: 'networkidle' });
      const supervisorSeesFinancePage = !/Agent payout/.test(await opsPage.locator('body').innerText());
      await opsCtx.close();

      record(
        'OPS-05-ROLE',
        'Approve / mark-paid are finance-role only',
        supervisorApprove.status === 403 && supervisorAdjust.status === 403 && supervisorSeesFinancePage ? 'PASS' : 'FAIL',
        `ops_supervisor approve=${supervisorApprove.status} (expect 403); ops_supervisor adjust=${supervisorAdjust.status} (expect 403); /ops/finance denied to supervisor (payout table not rendered)=${supervisorSeesFinancePage}`,
      );
    });

    // -----------------------------------------------------------------
    // Eligibility is derived from the CONFIGURED policy, not hardcoded —
    // flipping the config flips the outcome for the same domain facts.
    // -----------------------------------------------------------------
    await scenario('PAYOUT-ELIGIBILITY', 'Eligibility derives from configurable policy, not a hardcoded rule', async () => {
      const { deriveEligibility } = await import('../src/lib/state-machines/payout');
      const facts = {
        payment_realized: false,
        payment_received_not_realized: true,
        deal_stage: 'deal_locked',
        open_dispute_count: 0,
      };

      const strict = deriveEligibility(facts, {
        require_payment_realized: true,
        require_deal_closed_won: false,
        require_no_open_dispute: true,
        approval_target_days: 14,
      });
      const relaxed = deriveEligibility(facts, {
        require_payment_realized: false,
        require_deal_closed_won: false,
        require_no_open_dispute: true,
        approval_target_days: 14,
      });

      // The stored policy is readable through the OPS-07 config registry, i.e. an admin
      // can actually change this without a deploy.
      const { ctx, page } = await loggedInContext(browser, 'admin@cleartrade.example');
      await page.goto(`${BASE}/ops/audit`, { waitUntil: 'networkidle' });
      const configText = await page.locator('body').innerText();
      await ctx.close();
      const exposedInRegistry = configText.includes('payout.eligibility');

      const explainsDependency = Boolean(strict.reason && strict.reason.includes('realiz'));

      record(
        'PAYOUT-ELIGIBILITY',
        'Eligibility derives from configurable policy, not a hardcoded rule',
        !strict.eligible && relaxed.eligible && explainsDependency && exposedInRegistry ? 'PASS' : 'FAIL',
        `SAME facts (payment received but not realized), two policies: strict -> eligible=${strict.eligible} reason="${strict.reason}"; relaxed (require_payment_realized:false) -> eligible=${relaxed.eligible}; the unmet dependency is explained in plain language=${explainsDependency}; key is tunable in the OPS-07 config registry=${exposedInRegistry}`,
      );
    });
  } finally {
    await resetFixtures();
    await browser.close();
  }

  summarize('AGT-08 / OPS-05 PAYOUT ACCEPTANCE');
}

main()
  .catch((e) => {
    if (e instanceof PreflightError) console.error(`\n✗ PREFLIGHT FAILED\n\n  ${e.message}\n`);
    else console.error('SUITE CRASHED:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
