/**
 * `/app/plans` — the membership page: what each plan costs, what each plan gets, and the
 * button that starts a Premium membership.
 *
 * This is now the single upgrade destination in the exporter portal. `UpgradeNotice`'s
 * `requiredTier="paid"` CTA, the Settings "Upgrade" button and `/app/more` all point here,
 * and `/app/billing` redirects here — there is exactly one page that answers "what am I
 * being asked to buy", because two pages answering it is how they end up disagreeing about
 * the price.
 *
 * The commitment fee (docs/01 §2) has not been removed and is not hidden: a tenant that
 * owes or has paid it sees it in its own card below. Both grants are resolved into one
 * tier by `resolveTier()`, and the page renders whichever the tenant actually holds.
 *
 * PRICES ARE READ, NEVER WRITTEN HERE. `getConfig('billing.plans')` is the source; a
 * literal rupee figure in this file would be a second price that disagrees with the one
 * the checkout route charges.
 */

import { OrgTier } from '@prisma/client';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getPrincipal } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { PageHeader, SectionHeading, StatusChip } from '@/components/ui';
import { buttonClass } from '@/components/ui/Button';
import {
  COMPARISON,
  PLAN_PERIOD,
  annualSavingPercent,
  availabilityFor,
  monthlyEquivalent,
} from '@/lib/billing/plans';
import { isRazorpayConfigured } from '@/lib/billing/razorpay';
import { entitlesToPaid, governingSubscription } from '@/lib/billing/subscription-service';
import { ComparisonTable } from './ComparisonTable';
import { MembershipCard, type MembershipView } from './MembershipCard';
import { PlanChooser } from './PlanChooser';

/** Membership state is per-tenant and changes on a webhook — never served from cache. */
export const dynamic = 'force-dynamic';

const PLAN_LABEL = {
  premium_monthly: 'Premium · Monthly',
  premium_annual: 'Premium · Yearly',
} as const;

function money(amount: string, currency: string): string {
  // `Intl` handles the Indian digit grouping (₹29,990) that a manual formatter gets wrong.
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: Number(amount) % 1 === 0 ? 0 : 2,
  }).format(Number(amount));
}

function date(value: Date | null): string | null {
  return value
    ? value.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
}

export default async function PlansPage() {
  // `getPrincipal()`, NOT `requireExporterPrincipal()`.
  //
  // The guards in auth.ts THROW an ApiError rather than redirecting, which in a server
  // component surfaces as a 500 — so `requireExporterPrincipal()` here turned every
  // anonymous visit to the pricing page into an error page. That is the worst possible
  // route to 500 on: it is the one URL that gets shared, linked and clicked by people who
  // are not signed in yet, and `/app/billing` redirects here too.
  //
  // The exporter layout deliberately does not require a session (docs/14 — Markets and
  // Buyers are open to visitors), so every page under /app owns its own requirement. This
  // page's requirement is "a registered tenant", and the two ways of failing it have
  // different answers: no session at all means sign in, a guest session means register.
  const principal = await getPrincipal();
  if (!principal?.exporter_org_id) redirect('/login?callbackUrl=/app/plans');

  const org = await prisma.exporterOrg.findUniqueOrThrow({
    where: { id: principal.exporter_org_id },
    select: {
      tier: true,
      paid_until: true,
      commitment_fee_status: true,
      commitment_fee_amount: true,
      commitment_fee_currency: true,
      commitment_fee_paid_at: true,
    },
  });

  // A guest reaching this page has no account to attach a membership to. Registration is
  // the actual next step, so send them there rather than showing a checkout that would
  // reject them — `membership.manage` is `free`-floored for exactly this reason.
  if (org.tier === OrgTier.guest) redirect('/register?next=/app/plans');

  const [pricing, subscription] = await Promise.all([
    getConfig('billing.plans'),
    governingSubscription(principal.exporter_org_id),
  ]);

  const monthlyPrice = pricing.premium_monthly;
  const annualPrice = pricing.premium_annual;

  const hasLiveMembership =
    subscription !== null &&
    entitlesToPaid({ status: subscription.status, paid_until: subscription.current_period_end });
  const isPaid = org.tier === OrgTier.paid;

  const membership: MembershipView | null = subscription
    ? {
        planLabel: PLAN_LABEL[subscription.plan_code],
        status: subscription.status,
        priceDisplay: `${money(subscription.amount.toString(), subscription.currency)} · ${PLAN_PERIOD[subscription.plan_code].label}`,
        renewsOn: date(subscription.current_period_end),
        accessUntil: date(subscription.current_period_end),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        cancellable: hasLiveMembership,
      }
    : null;

  const freeFeatureCount = COMPARISON.filter((f) => availabilityFor(f, 'free') === 'included').length;

  return (
    <div className="mx-auto max-w-4xl pb-16">
      <PageHeader
        eyebrow="Plans"
        title={isPaid ? 'Your membership' : 'Upgrade to Premium'}
        description={
          isPaid
            ? 'What you are on, what it costs, and when it renews.'
            : 'Free gets you the market estimate, your readiness score and your own buyer pipeline. Premium runs the full engine on your product — ranked markets, buyer contacts, documents, and a ClearTrade agent who works your deals.'
        }
        meta={
          isPaid ? (
            <StatusChip
              label={org.paid_until ? `Premium until ${date(org.paid_until)}` : 'Premium'}
              tone="positive"
              icon="check"
            />
          ) : null
        }
      />

      {membership ? (
        <div className="mb-10">
          <SectionHeading title="Current membership" className="mb-4" />
          <MembershipCard membership={membership} />
        </div>
      ) : null}

      {/* Price cards are hidden once a live membership exists — the card above already
          answers "what am I on"; a second Upgrade button there would only mislead. */}
      {hasLiveMembership ? null : (
        <div className="mb-12">
          <PlanChooser
            monthly={{
              amount: monthlyPrice.amount,
              currency: monthlyPrice.currency,
              display: `${money(monthlyPrice.amount, monthlyPrice.currency)}/mo`,
              perMonthDisplay: money(monthlyPrice.amount, monthlyPrice.currency),
            }}
            annual={{
              amount: annualPrice.amount,
              currency: annualPrice.currency,
              display: `${money(annualPrice.amount, annualPrice.currency)}/yr`,
              perMonthDisplay: money(
                monthlyEquivalent(annualPrice, 'premium_annual'),
                annualPrice.currency,
              ),
            }}
            annualSavingPercent={annualSavingPercent(pricing)}
            paymentsAvailable={isRazorpayConfigured()}
            alreadyMember={isPaid}
            freeFeatureCount={freeFeatureCount}
            premiumFeatureCount={COMPARISON.length}
          />
        </div>
      )}

      <div className="mb-12">
        <SectionHeading
          title="What is in each plan"
          description="Every row below is checked against the same permission the API enforces on each request — this table cannot promise something the product would refuse."
          className="mb-6"
        />
        <ComparisonTable />
      </div>

      {/* The one-time commitment fee, shown only where it is a real fact for this tenant.
          Rendering it for everyone would present two prices for the same thing. */}
      {org.commitment_fee_status === 'due' ? (
        <div className="mb-12">
          <SectionHeading title="Commitment fee" className="mb-4" />
          <section className="rounded-lg border border-line bg-surface p-6">
            <StatusChip label="Commitment fee due" tone="warning" icon="alert" />
            <p className="mt-3 text-subtitle text-bone">
              {org.commitment_fee_amount
                ? money(org.commitment_fee_amount.toString(), org.commitment_fee_currency ?? 'INR')
                : '—'}
            </p>
            <p className="mt-2 max-w-xl text-sm text-muted">
              A one-time fee from an earlier plan, recorded against your account. It is not
              charged again and it is separate from the membership above. Contact support to
              settle or waive it.
            </p>
            <Link href="/app/support/report-bug" className={buttonClass('secondary', 'sm', 'mt-4')}>
              Contact support
            </Link>
          </section>
        </div>
      ) : org.commitment_fee_status === 'paid' || org.commitment_fee_status === 'waived' ? (
        <div className="mb-12">
          <SectionHeading title="Commitment fee" className="mb-4" />
          <section className="rounded-lg border border-line bg-surface p-6">
            <StatusChip
              label={org.commitment_fee_status === 'waived' ? 'Commitment fee waived' : 'Commitment fee paid'}
              tone="positive"
              icon="check"
            />
            <p className="mt-3 max-w-xl text-sm text-muted">
              {org.commitment_fee_paid_at
                ? `Recorded on ${date(org.commitment_fee_paid_at)}. `
                : ''}
              This grants Premium access permanently and does not expire — you do not need a
              membership on top of it.
            </p>
          </section>
        </div>
      ) : null}

      <div>
        <SectionHeading title="Questions" className="mb-4" />
        <dl className="space-y-5">
          {[
            {
              q: 'What exactly does a Free account get?',
              a: `${freeFeatureCount} of the ${COMPARISON.length} features above, on your own data — the market estimate, your readiness assessment and score, buyer search with contact details, and your own lead pipeline. The Premium-only features are shown to you as clearly labelled samples so you can judge them before paying.`,
            },
            {
              q: 'Is the sample built from my data?',
              a: 'No. Samples use illustrative figures for a generic product and are labelled as such on every screen. Nothing in a sample is a fact about your product, your buyers or any real company — and running one costs you nothing.',
            },
            {
              q: 'How is the payment taken?',
              a: 'Through Razorpay. You are taken to their secure page to authorize the mandate; ClearTrade never sees or stores your card details. Access unlocks automatically once the payment clears.',
            },
            {
              q: 'What happens if I cancel?',
              a: 'Billing stops and you keep full Premium access until the end of the period you have already paid for. Nothing is deleted when it ends — your saved runs, leads and documents stay in your account, and Premium features go back to being samples.',
            },
            {
              q: 'What if a renewal payment fails?',
              a: 'Your access is not cut off straight away. Razorpay retries, and we hold your access to the date you were paid through plus a short grace period, so a card that expires over a weekend does not lock you out.',
            },
          ].map((item) => (
            <div key={item.q} className="border-t border-line pt-5">
              <dt className="text-sm font-medium text-bone">{item.q}</dt>
              <dd className="mt-1.5 max-w-2xl text-sm text-muted text-pretty">{item.a}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
