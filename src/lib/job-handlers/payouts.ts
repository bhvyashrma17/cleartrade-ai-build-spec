/**
 * `payout_recompute` job — off-queue eligibility recomputation (AGT-08 / OPS-05).
 *
 * The handler is a thin wrapper around `recomputePayoutForDeal()`; all the actual logic
 * (which facts matter, the freeze-once guarantee) lives there and is unchanged by
 * running it here instead of inline. What the job buys is that the transaction which
 * changed an eligibility fact — a payment realizing, a dispute closing — commits and
 * returns immediately, and the (potentially slower: fee-policy lookup, dispute count,
 * payment aggregation) recompute happens after, on the worker, with its own retry.
 *
 * `actor: null` is deliberate: this run was not requested by a signed-in principal, and
 * `writeAuditEvent` already renders a null actor correctly (role: null, "ClearTrade" in
 * the UI) — the same convention `runReadinessAssessment` uses for its own system writes.
 */

import type { JobContext, JobOutcome } from '@/lib/jobs';
import { recomputePayoutForDeal } from '@/lib/payouts';

export async function runPayoutRecompute(ctx: JobContext): Promise<JobOutcome> {
  const dealId = ctx.target_id;
  if (!dealId) throw new Error('payout_recompute job has no target deal.');

  const result = await recomputePayoutForDeal(dealId, null, ctx.correlation_id);
  await ctx.reportProgress(100);

  return {
    status: 'completed',
    result: {
      deal_id: dealId,
      payout_id: result.payout_id,
      state: result.state,
      became_eligible: result.became_eligible,
      reason: result.reason,
    },
  };
}
