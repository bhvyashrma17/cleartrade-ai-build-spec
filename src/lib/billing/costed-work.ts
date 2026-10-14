/**
 * Which background work spends real money, and who is allowed to cause it.
 *
 * THE PROBLEM THIS SOLVES. Tier is checked at the route, once, per capability
 * (`assertCan`). That is correct and it is where authorization belongs — but it is a
 * per-route promise, and provider spend is a per-JOB consequence. The two drift: a new
 * route that enqueues `demand_discovery` without an `assertCan` is a plausible mistake
 * that no existing test catches, and its cost lands on the Anthropic and Comtrade bills
 * rather than on a 402. Deny-by-default in `CAPABILITY_MIN_TIER` protects capabilities
 * that exist; it cannot protect a capability nobody remembered to check.
 *
 * So the tier gate is asserted a SECOND time, at the last shared choke point before money
 * is committed — `enqueueJob`. Defence in depth, in the same spirit as the guest IP quota
 * sitting in front of a capability check that was already going to pass.
 *
 * WHAT COUNTS AS COSTED. Only work whose execution causes an outbound call to a metered
 * third party, or consumes a rate-limited credential we pay for. Not "work that is slow",
 * and not "work that is premium". Readiness is paid-tier-adjacent but runs a pure
 * function over an answer snapshot — it costs a CPU cycle and belongs nowhere near this
 * list. Over-listing here would turn a cost control into a second, shadow permission
 * matrix that disagrees with the real one.
 *
 * SCHEDULED WORK IS EXEMPT. `comtrade_ingest`, `sanctions_ingest` and the rest are
 * platform-wide jobs with no tenant behind them at all; they are enqueued by cron with a
 * null `exporter_org_id` and are budgeted separately. A null tenant is therefore allowed
 * through — it is not a user causing spend, and there is no tier to check.
 */

import { JobType, OrgTier } from '@prisma/client';

/**
 * Tenant-triggered jobs that spend metered provider budget when they run.
 *
 * - `demand_discovery` — reads the Comtrade-backed warehouse and, with
 *   `RATIONALE_WRITER=claude`, sends one LLM request per ranked market.
 * - `country_screening` — Stage A global screening; one authenticated Comtrade request per
 *   market that is not already covered by reusable evidence.
 * - `buyer_discovery` / `buyer_intelligence` — buyer enrichment and fit scoring against
 *   external sources.
 * - `document_generation` — the render pipeline, including malware scanning and object
 *   storage writes per artifact.
 * - `report_export` — bulk render and storage.
 * - `demand_discovery_v5` — batched Comtrade calls for the newest year and any market-level
 *   fallback (docs/36 §3.3), against the shared free-key quota.
 */
export const COSTED_JOB_TYPES: readonly JobType[] = [
  JobType.demand_discovery,
  JobType.demand_discovery_v5,
  JobType.country_truth_discovery,
  JobType.country_screening,
  JobType.buyer_discovery,
  JobType.buyer_intelligence,
  JobType.document_generation,
  JobType.report_export,
];

export function isCostedJobType(type: JobType): boolean {
  return COSTED_JOB_TYPES.includes(type);
}

/**
 * The minimum tier that may cause costed work on its own behalf.
 *
 * `paid` — a guest or free tenant gets the fixture-backed sample instead
 * (`src/lib/billing/preview.ts`), which is the whole point: the demo shows what the
 * pipeline produces without ever starting it.
 */
export const MIN_TIER_FOR_COSTED_WORK: OrgTier = OrgTier.paid;

const TIER_RANK: Record<OrgTier, number> = {
  [OrgTier.guest]: 0,
  [OrgTier.free]: 1,
  [OrgTier.paid]: 2,
};

export function tierMayCauseCostedWork(tier: OrgTier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[MIN_TIER_FOR_COSTED_WORK];
}
