/**
 * The plan catalogue — what `/app/plans` sells, and the ONE place its feature comparison
 * is written down.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: every row of the pricing table names a
 * `Capability`, and its "which plan gets this" column is computed by asking
 * `minTierFor()` — the same function `assertCan()` calls on every request. A marketing
 * table maintained as free text is a table that drifts: someone moves a capability to
 * `paid` in `CAPABILITY_MIN_TIER` and the pricing page keeps promising it on Free, which
 * is a refund request at best and a false-advertising claim at worst. Here that is not
 * possible — the checkmark IS the permission check.
 *
 * `tests/plans.test.ts` additionally asserts that every capability named here exists and
 * that no `paid`-gated capability is advertised as free, so the coupling cannot be
 * quietly severed by editing this file alone.
 *
 * PRICE IS NOT HERE. Amounts live in `ConfigSetting` (`billing.plans`, seeded from
 * `DEFAULT_PLAN_PRICING`) and are read through `getConfig()` like every other commercial
 * value in this codebase — money must never be a literal in application code (docs/01 §2).
 */

import { OrgTier, SubscriptionPlanCode } from '@prisma/client';
import { minTierFor, type Capability } from '@/lib/permissions';

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

/** What the user is choosing between on `/app/plans`. */
export type PlanId = 'free' | SubscriptionPlanCode;

export const PREMIUM_PLAN_CODES = [
  SubscriptionPlanCode.premium_monthly,
  SubscriptionPlanCode.premium_annual,
] as const;

export function isPremiumPlanCode(value: string): value is SubscriptionPlanCode {
  return (PREMIUM_PLAN_CODES as readonly string[]).includes(value);
}

export interface PlanBillingPeriod {
  /** Months per charge. Drives the "per month" figure shown beside an annual price. */
  interval_months: number;
  label: string;
}

export const PLAN_PERIOD: Record<SubscriptionPlanCode, PlanBillingPeriod> = {
  [SubscriptionPlanCode.premium_monthly]: { interval_months: 1, label: 'billed monthly' },
  [SubscriptionPlanCode.premium_annual]: { interval_months: 12, label: 'billed once a year' },
};

/**
 * The tier a plan grants. Both premium plans grant the same access — annual is a payment
 * cadence, not a bigger product. Stated explicitly so nobody later "adds a feature to
 * annual" without noticing that would need a new tier, not a new price.
 */
export const PLAN_TIER: Record<PlanId, OrgTier> = {
  free: OrgTier.free,
  [SubscriptionPlanCode.premium_monthly]: OrgTier.paid,
  [SubscriptionPlanCode.premium_annual]: OrgTier.paid,
};

// ---------------------------------------------------------------------------
// The comparison table
// ---------------------------------------------------------------------------

/**
 * How a plan delivers a capability.
 *
 *  - `included`  the real thing, on the tenant's own data
 *  - `preview`   a labelled, fixture-backed SAMPLE (`EvidenceOrigin.preview`). Costs no
 *                provider credits and touches no warehouse row — see
 *                `src/lib/billing/preview.ts`. This is what "a demo, not a trial" means.
 *  - `locked`    withheld, rendered as an `UpgradeNotice` with the reason
 */
export type FeatureAvailability = 'included' | 'preview' | 'locked';

export interface ComparisonFeature {
  /** The capability this row is really about — the coupling to the permission matrix. */
  capability: Capability;
  label: string;
  /** Plain language, exporter's terms. docs/10 §5: label first, jargon in helper text. */
  detail: string;
  /**
   * Set only where a locked capability has a genuine sample to show. Absent means the
   * free plan gets a locked state and nothing else — the honest default.
   */
  free_preview?: true;
}

/**
 * The features worth comparing, in the order they appear on the page.
 *
 * Not every capability is listed — `fee_policy.edit` is an Ops capability no exporter can
 * ever buy, and listing it would advertise something no plan sells. The guard test checks
 * that everything listed here is real and correctly attributed, not that everything real
 * is listed.
 */
export const COMPARISON: readonly ComparisonFeature[] = [
  {
    capability: 'market_estimate.run',
    label: 'Market estimate',
    detail: 'What buyers in each country actually imported, and the unit-price band they paid. Past customs data, not a forecast.',
  },
  {
    capability: 'readiness.run',
    label: 'Export readiness assessment',
    detail: 'Your score, what is blocking you, and the tasks that clear it.',
  },
  {
    capability: 'buyer_discovery.run',
    label: 'Buyer search',
    detail: 'Search verified overseas buyers and see how well each fits your product.',
  },
  {
    capability: 'buyer_contact.view',
    label: 'Buyer contact details',
    detail: 'Names, roles, emails and phone numbers for the buyers you shortlist.',
  },
  {
    capability: 'buyer_lead.create',
    label: 'Your own lead pipeline',
    detail: 'Shortlist buyers and track them yourself. On Free these stay unassigned — no agent capacity is used.',
  },
  {
    capability: 'demand_discovery.run',
    label: 'Ranked Demand Discovery',
    detail: 'Every market scored and ranked for YOUR product, with the reasoning behind each rank.',
    free_preview: true,
  },
  {
    capability: 'market_assessment.save',
    label: 'Save and select markets',
    detail: 'Keep a ranked run, compare it against later ones, and commit to a target market.',
  },
  {
    capability: 'agent.assign',
    label: 'A dedicated ClearTrade agent',
    detail: 'A real person who runs outreach, negotiates terms and chases the deal for you.',
    free_preview: true,
  },
  {
    capability: 'deal.view',
    label: 'Deals workspace',
    detail: 'Every live deal, its stage, and what is blocking it.',
  },
  {
    capability: 'document.generate',
    label: 'Export document engine',
    detail: 'Invoices, packing lists and certificates generated from one set of deal facts, so they cannot disagree with each other.',
    free_preview: true,
  },
  {
    capability: 'document.download',
    label: 'Download filed documents',
    detail: 'Approved PDFs and DOCX files, ready to file.',
  },
  {
    capability: 'shipment.update',
    label: 'Shipment tracking',
    detail: 'Milestones, exceptions and evidence across every active shipment.',
  },
  {
    capability: 'dispute.open',
    label: 'Dispute support',
    detail: 'Raise a dispute and have Ops work it with the buyer.',
  },
  {
    capability: 'task.view',
    label: 'Cross-deal task queue',
    detail: 'One list of everything waiting on you, with owner and due time.',
  },
];

/**
 * How a plan delivers one comparison row.
 *
 * The `included` branch is `minTierFor()`, not a hardcoded list — change the permission
 * matrix and this answer changes with it, which is the whole point of the module.
 */
export function availabilityFor(feature: ComparisonFeature, plan: PlanId): FeatureAvailability {
  const granted = PLAN_TIER[plan];
  const required = minTierFor(feature.capability);
  if (TIER_RANK[granted] >= TIER_RANK[required]) return 'included';
  return feature.free_preview ? 'preview' : 'locked';
}

/** Local copy of the tier ordering. `permissions.ts` keeps its own private to that module. */
const TIER_RANK: Record<OrgTier, number> = {
  [OrgTier.guest]: 0,
  [OrgTier.free]: 1,
  [OrgTier.paid]: 2,
};

export function tierRank(tier: OrgTier): number {
  return TIER_RANK[tier];
}

// ---------------------------------------------------------------------------
// Pricing defaults (seed values only — runtime reads ConfigSetting)
// ---------------------------------------------------------------------------

export interface PlanPrice {
  /** Decimal string. Never a float — money is never a float in this codebase. */
  amount: string;
  currency: string;
}

export interface PlanPricing {
  [SubscriptionPlanCode.premium_monthly]: PlanPrice;
  [SubscriptionPlanCode.premium_annual]: PlanPrice;
}

/**
 * Seed values for `ConfigSetting['billing.plans']`, and the fallback a freshly cloned dev
 * environment boots on. These are the "current/default assumption" column of docs/01 §2 —
 * NOT a runtime source of truth. Ops repoints them through the config registry.
 */
export const DEFAULT_PLAN_PRICING: PlanPricing = {
  [SubscriptionPlanCode.premium_monthly]: { amount: '2999.0000', currency: 'INR' },
  [SubscriptionPlanCode.premium_annual]: { amount: '29990.0000', currency: 'INR' },
};

/** Whole-rupee monthly equivalent of an annual price, for the "₹X/mo billed yearly" line. */
export function monthlyEquivalent(price: PlanPrice, plan: SubscriptionPlanCode): string {
  const months = PLAN_PERIOD[plan].interval_months;
  const perMonth = Number(price.amount) / months;
  return perMonth.toFixed(2);
}

/** Percentage saved by paying annually, rounded down. Returns null if annual is not cheaper. */
export function annualSavingPercent(pricing: PlanPricing): number | null {
  const monthly = Number(pricing[SubscriptionPlanCode.premium_monthly].amount);
  const annual = Number(pricing[SubscriptionPlanCode.premium_annual].amount);
  if (!(monthly > 0) || !(annual > 0)) return null;
  const fullPrice = monthly * 12;
  if (annual >= fullPrice) return null;
  return Math.floor(((fullPrice - annual) / fullPrice) * 100);
}
