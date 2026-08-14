/**
 * Payout computation — the one place a commission figure is ever produced.
 *
 * AGT-08-AC02 / OPS-05-AC02 in one sentence: **the snapshot is written once, at the
 * moment of eligibility, and every read afterwards returns stored columns.** Nothing in
 * this module recalculates a stored payout, and no caller is offered a function that
 * would let them.
 *
 * `recomputePayoutForDeal()` is idempotent and safe to call repeatedly (a cron, a
 * payment webhook, an Ops button): it will create a `not_eligible` row, flip it to
 * `eligible` and freeze the money columns the first time the policy is satisfied, and
 * then leave the frozen columns strictly alone forever after — including if the fee
 * policy changes, the deal value is amended, or it is called a thousand more times.
 */

import { DealStage, JobType, PayoutState, Prisma, PrismaClient } from '@prisma/client';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { calculateSuccessFee, getConfig, getFeePolicy } from '@/lib/config';
import { OPEN_DISPUTE_STATUSES } from '@/lib/disputes';
import { ApiError } from '@/lib/errors';
import { enqueueJob } from '@/lib/jobs';
import { deriveEligibility, type EligibilityFacts } from '@/lib/state-machines/payout';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';

type Db = PrismaClient | Prisma.TransactionClient;

/** States past which an agent has actually earned something worth tracking. */
const PAYOUT_TRACKED_STAGES: DealStage[] = [
  DealStage.deal_locked,
  DealStage.executing,
  DealStage.shipped,
  DealStage.closed_won,
];

export interface RecomputeResult {
  payout_id: string | null;
  state: PayoutState;
  created: boolean;
  /** True only on the transition that froze the snapshot. */
  became_eligible: boolean;
  reason: string | null;
}

/**
 * Bring the payout record for one deal in line with current domain facts.
 *
 * Returns `{ payout_id: null }` for a deal that has no agent or has not reached a
 * tracked stage — deliberately NOT an error, because "no payout applies here" is the
 * normal answer for most deals and callers should not have to pre-filter.
 */
export async function recomputePayoutForDeal(
  dealId: string,
  actor: Principal | null,
  correlationId: string,
  db: Db = prisma,
): Promise<RecomputeResult> {
  const deal = await db.deal.findUnique({
    where: { id: dealId },
    select: {
      id: true,
      stage: true,
      owner_agent_id: true,
      exporter_org_id: true,
      value_amount: true,
      value_currency: true,
      total_amount: true,
      total_currency: true,
      payments: { select: { status: true, amount: true, amount_received: true, currency: true } },
      disputes: { select: { status: true } },
    },
  });

  if (!deal || !deal.owner_agent_id || !PAYOUT_TRACKED_STAGES.includes(deal.stage)) {
    return { payout_id: null, state: PayoutState.not_eligible, created: false, became_eligible: false, reason: null };
  }

  const facts: EligibilityFacts = {
    payment_realized: deal.payments.some((p) => p.status === 'realized'),
    payment_received_not_realized: deal.payments.some((p) => p.status === 'received' || p.status === 'partially_received'),
    deal_stage: deal.stage,
    open_dispute_count: deal.disputes.filter((d) => (OPEN_DISPUTE_STATUSES as string[]).includes(d.status)).length,
  };

  const policy = await getConfig('payout.eligibility');
  const outcome = deriveEligibility(facts, policy);

  const existing = await db.payout.findFirst({
    where: { deal_id: dealId, agent_user_id: deal.owner_agent_id },
  });

  // ---- Already snapshotted: never touch the money columns again. ---------
  if (existing && existing.state !== PayoutState.not_eligible) {
    return {
      payout_id: existing.id,
      state: existing.state,
      created: false,
      became_eligible: false,
      reason: existing.ineligible_reason,
    };
  }

  // ---- Still not eligible: keep (or create) a row that explains why. -----
  if (!outcome.eligible) {
    if (existing) {
      const updated = await db.payout.update({
        where: { id: existing.id },
        data: { ineligible_reason: outcome.reason },
      });
      return { payout_id: updated.id, state: updated.state, created: false, became_eligible: false, reason: outcome.reason };
    }
    // A placeholder row needs money columns, and there is no honest snapshot to take
    // yet. Zeroes here are not a computed figure — `state: not_eligible` is what the UI
    // renders, and it never shows an amount for a row in this state.
    const created = await db.payout.create({
      data: {
        deal_id: dealId,
        agent_user_id: deal.owner_agent_id,
        state: PayoutState.not_eligible,
        basis_amount: 0,
        basis_currency: deal.value_currency ?? 'INR',
        fee_amount: 0,
        fee_currency: deal.value_currency ?? 'INR',
        agent_share_rate: '0',
        amount: 0,
        currency: deal.value_currency ?? 'INR',
        fee_policy_version: 0,
        calculation_snapshot: { status: 'not_computed', reason: outcome.reason },
        ineligible_reason: outcome.reason,
      },
    });
    return { payout_id: created.id, state: created.state, created: true, became_eligible: false, reason: outcome.reason };
  }

  // ---- Eligible for the first time: freeze the snapshot. -----------------
  const basisAmount = deal.total_amount ?? deal.value_amount;
  const basisCurrency = deal.total_currency ?? deal.value_currency;
  if (basisAmount === null || basisCurrency === null) {
    const reason = 'Deal has no recorded value, so the commission basis cannot be computed.';
    if (existing) {
      await db.payout.update({ where: { id: existing.id }, data: { ineligible_reason: reason } });
      return { payout_id: existing.id, state: existing.state, created: false, became_eligible: false, reason };
    }
    return { payout_id: null, state: PayoutState.not_eligible, created: false, became_eligible: false, reason };
  }

  const feePolicy = await getFeePolicy();
  const fee = await calculateSuccessFee({ amount: basisAmount.toString(), currency: basisCurrency });
  const agentShareRate = feePolicy.agent_share_rate;
  const agentAmount = (Number(fee.result.amount) * Number(agentShareRate)).toFixed(2);
  const now = new Date();

  const snapshot = {
    computed_at: now.toISOString(),
    basis: fee.basis,
    fee_rule: fee.rule,
    fee_rate: fee.rate ?? null,
    fee_result: fee.result,
    agent_share_rate: agentShareRate,
    agent_amount: { amount: agentAmount, currency: fee.result.currency },
    fee_policy_version: fee.policy_version,
    eligibility_rule: outcome.rule,
    eligibility_policy: policy,
  };

  const data = {
    state: PayoutState.eligible,
    basis_amount: basisAmount,
    basis_currency: basisCurrency,
    fee_amount: fee.result.amount,
    fee_currency: fee.result.currency,
    fee_rule: fee.rule,
    agent_share_rate: agentShareRate,
    amount: agentAmount,
    currency: fee.result.currency,
    fee_policy_version: fee.policy_version,
    // `Money` and `PayoutEligibilityPolicy` are plain interfaces without index
    // signatures, so they are not structurally assignable to Prisma's InputJsonValue
    // even though they serialize cleanly. The double assertion is the narrow, standard
    // escape for that mismatch — not a suppression of a real type error.
    calculation_snapshot: snapshot as unknown as Prisma.InputJsonValue,
    ineligible_reason: null,
    eligibility_rule: outcome.rule,
    eligible_at: now,
  };

  const row = existing
    ? await db.payout.update({ where: { id: existing.id }, data })
    : await db.payout.create({ data: { deal_id: dealId, agent_user_id: deal.owner_agent_id, ...data } });

  await writeAuditEvent({
    db,
    actor,
    action: AUDIT_ACTIONS.state_change,
    object_type: 'payout',
    object_id: row.id,
    exporter_org_id: deal.exporter_org_id,
    before_summary: { state: existing?.state ?? null },
    after_summary: {
      state: PayoutState.eligible,
      amount: agentAmount,
      currency: fee.result.currency,
      fee_policy_version: fee.policy_version,
      eligibility_rule: outcome.rule,
    },
    correlation_id: correlationId,
  });

  return { payout_id: row.id, state: row.state, created: !existing, became_eligible: true, reason: null };
}

/**
 * Net payable = frozen snapshot amount + the signed sum of its adjustments
 * (OPS-05-AC03). Computed on read from immutable parts; never written back over
 * `Payout.amount`, which must keep saying what was originally quoted.
 */
export function netPayable(
  payout: { amount: Prisma.Decimal | number | string; currency: string },
  adjustments: { amount: Prisma.Decimal | number | string }[],
): { amount: string; currency: string } {
  const base = Number(payout.amount);
  const delta = adjustments.reduce((sum, a) => sum + Number(a.amount), 0);
  return { amount: (base + delta).toFixed(2), currency: payout.currency };
}

// ---------------------------------------------------------------------------
// Event-driven trigger
// ---------------------------------------------------------------------------

/**
 * Enqueue a `payout_recompute` job for one deal — the event-driven half of AGT-08 /
 * OPS-05. Called from the route handlers for the events that actually change
 * eligibility: a payment status write (realization), and a dispute opening or closing
 * (`require_no_open_dispute`).
 *
 * Always call this AFTER the triggering `$transaction` has committed, never from inside
 * it — `enqueueJob` is its own insert with its own commit, and the whole point is that a
 * slow recompute must never hold the triggering write's transaction open. Every existing
 * call site of `enqueueJob` in this codebase already follows that rule; this is not a
 * new convention.
 *
 * `dedupe_key: payout_recompute:<dealId>` means a burst of events on the same deal (a
 * payment updated twice, a dispute opened and closed in quick succession) collapses to
 * one in-flight job rather than piling up — and that job reads live facts when the
 * worker claims it, not a stale payload, so collapsing bursts loses no information: the
 * dedupe key does not need to change to fully cover "another edge came in" case work.
 * `JOB_ALREADY_RUNNING` is caught and swallowed here for exactly that reason: it means
 * a recompute for this deal is already queued, which is the outcome this call wanted.
 *
 * Deliberately silent on any OTHER failure too (logged, not thrown): the route that
 * changed a payment or dispute has already committed its own write successfully, and a
 * queueing hiccup on the follow-up recompute must not turn that into a 500 for the
 * caller. The manual `POST /api/v1/payouts/recompute` route (admin/finance-triggered)
 * stays as the fallback for exactly this case.
 */
export async function triggerPayoutRecompute(dealId: string, correlationId: string): Promise<void> {
  try {
    const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { exporter_org_id: true } });
    if (!deal) return;
    await enqueueJob({
      type: JobType.payout_recompute,
      payload: { deal_id: dealId },
      exporter_org_id: deal.exporter_org_id,
      target_type: 'deal',
      target_id: dealId,
      dedupe_key: `payout_recompute:${dealId}`,
      correlation_id: correlationId,
    });
  } catch (error) {
    if (error instanceof ApiError && error.code === 'JOB_ALREADY_RUNNING') return;
    console.error(`[payout] could not enqueue recompute for deal ${dealId}:`, error);
  }
}
