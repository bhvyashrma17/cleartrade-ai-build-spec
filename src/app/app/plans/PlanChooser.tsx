'use client';

/**
 * The two price cards and the billing-period switch.
 *
 * The Upgrade button does not "go to Razorpay" as a static link — it cannot. A hosted
 * checkout URL is minted per subscription, so the button POSTs, receives the URL, and then
 * navigates. That ordering matters for a reason worth stating: the URL is bound to a
 * `Subscription` row that already exists on our side, so the webhook that eventually
 * confirms payment always has a row to attach to. A pre-baked link would produce payments
 * with nothing to apply them to.
 *
 * `window.location.assign` rather than the Next router: Razorpay's page is a different
 * origin, and a client-side navigation attempt would be swallowed.
 */

import { useState } from 'react';
import clsx from 'clsx';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

type PlanCode = 'premium_monthly' | 'premium_annual';

export interface PlanPriceView {
  amount: string;
  currency: string;
  /** Pre-formatted server-side so the server and client never disagree on a rendered price. */
  display: string;
  /** Monthly equivalent, for the annual card's "works out at" line. */
  perMonthDisplay: string;
}

export interface PlanChooserProps {
  monthly: PlanPriceView;
  annual: PlanPriceView;
  annualSavingPercent: number | null;
  /** False when the gateway is unconfigured — the button says so instead of failing on click. */
  paymentsAvailable: boolean;
  /** True once the tenant already holds paid access; the cards render as current state. */
  alreadyMember: boolean;
  freeFeatureCount: number;
  premiumFeatureCount: number;
}

export function PlanChooser({
  monthly,
  annual,
  annualSavingPercent,
  paymentsAvailable,
  alreadyMember,
  freeFeatureCount,
  premiumFeatureCount,
}: PlanChooserProps) {
  const [period, setPeriod] = useState<PlanCode>('premium_annual');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const price = period === 'premium_annual' ? annual : monthly;

  async function upgrade() {
    setBusy(true);
    setError(null);
    try {
      const result = await apiPost<{ data: { redirect_url: string } }>(
        '/api/v1/billing/subscription',
        { plan_code: period },
      );
      // Leaving the app entirely — `busy` is deliberately never reset, so the button stays
      // disabled through the redirect rather than flashing back to "Upgrade" mid-navigation.
      window.location.assign(result.data.redirect_url);
    } catch (e) {
      setError(
        e instanceof ApiClientError
          ? e.message
          : 'Could not start the membership. Please try again.',
      );
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-6 flex justify-center">
        <div
          role="radiogroup"
          aria-label="Billing period"
          className="inline-flex rounded-md border border-line-strong bg-surface-2 p-1"
        >
          {(
            [
              ['premium_monthly', 'Monthly'],
              ['premium_annual', 'Yearly'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={period === value}
              onClick={() => setPeriod(value)}
              className={clsx(
                'focus-visible-ring min-h-8 rounded px-4 text-sm font-medium transition-colors duration-fast',
                period === value ? 'bg-bone text-ground' : 'text-muted hover:text-bone',
              )}
            >
              {label}
              {value === 'premium_annual' && annualSavingPercent ? (
                <span className={clsx('ml-2 text-xs', period === value ? 'text-ground' : 'text-accent')}>
                  save {annualSavingPercent}%
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* --- Free --- */}
        <section className="rounded-lg border border-line bg-surface p-6">
          <p className="eyebrow mb-3">Free</p>
          <p className="text-figure text-bone">₹0</p>
          <p className="mt-1 text-sm text-muted">Free forever. No card needed.</p>
          <p className="mt-5 border-t border-line pt-5 text-sm text-slate">
            {freeFeatureCount} of {premiumFeatureCount} features included. Everything else is a
            labelled sample so you can see what it does before you pay for it.
          </p>
          <p
            className="mt-5 flex min-h-control items-center justify-center rounded-md border border-line bg-surface-2 text-sm font-medium text-muted"
            aria-live="off"
          >
            {alreadyMember ? 'Previous plan' : 'Your current plan'}
          </p>
        </section>

        {/* --- Premium. The one accent-marked panel on this page. --- */}
        <section className="relative rounded-lg border border-accent bg-surface-2 p-6">
          <span aria-hidden="true" className="absolute -top-px left-6 h-px w-10 bg-accent" />
          <p className="eyebrow mb-3 text-accent">Premium</p>
          <p className="text-figure text-bone">{price.display}</p>
          <p className="mt-1 text-sm text-muted">
            {period === 'premium_annual'
              ? `Billed once a year — works out at ${annual.perMonthDisplay} a month.`
              : 'Billed every month. Cancel any time.'}
          </p>
          <p className="mt-5 border-t border-line-strong pt-5 text-sm text-slate">
            All {premiumFeatureCount} features on your own product and your own data, plus a
            dedicated ClearTrade agent working your deals.
          </p>

          {error ? (
            <p role="alert" className="mt-4 text-sm text-[var(--crit)]">
              {error}
            </p>
          ) : null}

          {alreadyMember ? (
            <p className="mt-5 flex min-h-control items-center justify-center rounded-md border border-line-strong bg-surface-3 text-sm font-medium text-bone">
              Your current plan
            </p>
          ) : (
            <>
              <Button
                variant="accent"
                onClick={upgrade}
                disabled={busy || !paymentsAvailable}
                className="mt-5 w-full"
              >
                {busy ? 'Opening secure checkout…' : 'Upgrade to Premium'}
              </Button>
              <p className="mt-3 text-center text-xs text-faint">
                {paymentsAvailable
                  ? 'You will be taken to Razorpay to pay. Your access unlocks automatically once the payment clears.'
                  : 'Card payments are not switched on in this environment yet.'}
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
