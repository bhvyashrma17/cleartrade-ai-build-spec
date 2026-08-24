/**
 * The upgrade prompt on the exporter's home screen.
 *
 * The topbar button is always reachable but is deliberately small and unexplained — it is
 * chrome. This is the one place that says what upgrading actually GETS you, and it sits on
 * the surface a free member lands on after every login.
 *
 * Rendered only for `free`. It is not shown to guests (whose next step is registering, not
 * paying) and obviously not to members. Because it is a persistent banner rather than a
 * response to an action the user just took, it stays a single quiet row with a real
 * sentence in it — not a full-bleed marketing panel that a returning user has to scroll
 * past every day to reach their actual work.
 *
 * Prices are read by the caller from `billing.plans` and passed in. There is no literal
 * amount in this file; a second place naming a price is a second place to forget to change
 * it.
 */

import Link from 'next/link';
import { buttonClass } from '@/components/ui/Button';

export function UpgradeBanner({ priceDisplay }: { priceDisplay: string }) {
  return (
    <section
      aria-labelledby="upgrade-banner-title"
      className="mt-6 rounded-lg border border-line-strong bg-surface-2 p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h2 id="upgrade-banner-title" className="text-subtitle text-bone">
            You&rsquo;re on the Free plan
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted text-pretty">
            Premium ranks every market for your own product, unlocks buyer contacts and the
            document engine, and puts a ClearTrade agent on your deals. From{' '}
            <span className="font-medium text-bone">{priceDisplay}</span>.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <Link href="/app/plans" className={buttonClass('primary', 'md')}>
            Upgrade to Premium
          </Link>
          <Link
            href="/app/plans"
            className="focus-visible-ring rounded text-sm text-muted underline underline-offset-4 hover:text-bone"
          >
            Compare plans
          </Link>
        </div>
      </div>
    </section>
  );
}
