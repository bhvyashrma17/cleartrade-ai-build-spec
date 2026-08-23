/**
 * Root route. `/` · public.
 *
 * Login is no longer mandatory to use the product (docs/14) — Demand Discovery and Buyer
 * Discovery are open to anonymous visitors — so this route must not force everyone
 * through /login the way it did when every request was authenticated.
 *
 * Three outcomes, and only two of them redirect:
 *   - a real (non-guest) account -> their role's home route
 *   - a guest session (they already searched at least once) -> straight into discovery,
 *     since that is the one thing they came here to do
 *   - no session at all -> the landing page below, rendered in place. **Not** a redirect
 *     to /login, and this must never mint a guest row itself — a guest is only ever
 *     created by an actual search (POST /api/v1/discovery-runs), not by viewing a page.
 */

import Link from 'next/link';
import { OrgTier } from '@prisma/client';
import { redirect } from 'next/navigation';
import { Wordmark } from '@/components/brand/Wordmark';
import { JourneyFrame } from '@/components/ui/JourneyFrame';
import { buttonClass } from '@/components/ui/Button';
import { getPrincipal, homeRouteForRole } from '@/lib/auth';

export default async function HomePage() {
  const principal = await getPrincipal();

  if (principal) {
    redirect(principal.tier === OrgTier.guest ? '/app/markets' : homeRouteForRole(principal.role));
  }

  return <LandingPage />;
}

/**
 * The eight stages of a ClearTrade deal — the same eight the `JourneyFrame` device draws.
 * Shown here as the product's actual shape rather than as a feature list, because the
 * thing being sold is that someone else works the stages you have not reached yet.
 */
const STAGES = [
  'Readiness',
  'Market',
  'Buyers',
  'Deal',
  'Documents',
  'Customs',
  'Shipment',
  'Payment',
] as const;

/** How far the illustrated deal has closed. Mid-flight on purpose: a full frame would
 *  say "done", an empty one would say "nothing happens here". */
const ILLUSTRATED_PROGRESS = 5;

function LandingPage() {
  return (
    <div className="min-h-screen bg-paper">
      <header className="on-ink bg-ink-900">
        <div className="mx-auto flex h-topbar max-w-6xl items-center justify-between px-4 sm:px-8">
          <Wordmark tone="bone" />
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="focus-visible-ring rounded-sm px-3 py-1.5 text-sm font-medium text-slate transition-colors duration-fast hover:bg-[color-mix(in_srgb,var(--bone)_10%,transparent)] hover:text-bone"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* The hero is left-aligned and asymmetric. A centred column under a serif
            headline is the house style of every generated landing page on the web; the
            asymmetry, the docket panel and the mark are what make this one ours. */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-8 sm:py-24">
          <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_26rem] lg:gap-16">
            <div className="animate-fade-rise">
              <p className="eyebrow">Export operating system · India</p>
              {/* The tagline on the mark itself, which was already the best line anyone
                  had written for this product and appeared nowhere in it. */}
              <h1 className="masthead mt-4 text-[2.5rem] leading-[1.05] text-ink-900 sm:text-display text-balance">
                Structured exports.
                <br />
                Zero chaos.
              </h1>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-ink-500 text-pretty">
                Find your markets and buyers free. When you&rsquo;re ready to ship, a ClearTrade
                agent handles the paperwork, customs, freight and payment with you.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                {/* One primary CTA (docs/00 §6): everything else here is secondary to it. */}
                <Link href="/app/markets" className={buttonClass('primary', 'md', 'min-h-11 px-5')}>
                  Find your export markets
                </Link>
                <span className="text-xs text-ink-300">Free · no account needed</span>
              </div>

              <p className="mt-6 text-sm text-ink-500">
                Already have an account?{' '}
                <Link
                  href="/login"
                  className="focus-visible-ring font-medium text-ink-900 underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-ink-900"
                >
                  Sign in
                </Link>{' '}
                <span aria-hidden="true" className="text-ink-300">·</span>{' '}
                <Link
                  href="/register"
                  className="focus-visible-ring font-medium text-ink-900 underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-ink-900"
                >
                  Create a free account
                </Link>
              </p>
            </div>

            {/* The docket. Dark chrome, bone text, and the frame device carrying the one
                idea the product is built on: a deal is eight stages, and the frame closes
                as they complete. */}
            <aside className="on-ink rounded-xl border border-ink-900 bg-ink-900 p-6 text-bone shadow-overlay sm:p-8">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="eyebrow text-slate">A ClearTrade deal</p>
                  <p className="masthead mt-1.5 text-[1.375rem] leading-tight text-bone">
                    {ILLUSTRATED_PROGRESS} of {STAGES.length} stages closed
                  </p>
                </div>
                <JourneyFrame
                  value={ILLUSTRATED_PROGRESS}
                  total={STAGES.length}
                  size={52}
                  tone="inverse"
                  label={`${ILLUSTRATED_PROGRESS} of ${STAGES.length} stages complete`}
                />
              </div>

              <ol className="mt-6 grid grid-cols-2 gap-x-6 gap-y-2.5">
                {STAGES.map((stage, index) => {
                  const done = index < ILLUSTRATED_PROGRESS;
                  return (
                    <li key={stage} className="flex items-center gap-2.5 text-sm">
                      <span
                        aria-hidden="true"
                        className={
                          done
                            ? 'size-1.5 shrink-0 bg-bone'
                            : 'size-1.5 shrink-0 border border-[color-mix(in_srgb,var(--bone)_35%,transparent)]'
                        }
                      />
                      <span className={done ? 'text-bone' : 'text-slate'}>{stage}</span>
                    </li>
                  );
                })}
              </ol>

              <p className="mt-6 border-t border-[color-mix(in_srgb,var(--bone)_15%,transparent)] pt-4 text-xs leading-relaxed text-slate">
                Your agent works the open stages. You approve the decisions that are yours
                to make — price, terms, and who you ship to.
              </p>
            </aside>
          </div>
        </section>

        {/* Honest about the tier boundary — say what's free and what isn't, not just
            what's free. */}
        <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-8">
          <h2 className="eyebrow">What you get, and when you pay</h2>
          <div className="mt-6 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
            <TierCard
              name="Try it free"
              price="No account"
              description="Search markets and buyers with no sign-up. A couple of searches, on us — enough to see if there's real demand for what you make."
            />
            <TierCard
              name="Free account"
              price="₹0"
              description="Save your searches, see buyer contact details, and build a list of leads you own."
            />
            <TierCard
              name="Paid plan"
              price="One-time commitment fee"
              description="A ClearTrade agent works your deals: negotiation, documents, shipping coordination and payment tracking, start to finish."
              accent
            />
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-paper-sunk">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 sm:px-8">
          <Wordmark size="sm" />
          <p className="text-xs text-ink-300">Structured exports. Zero chaos.</p>
        </div>
      </footer>
    </div>
  );
}

function TierCard({
  name,
  price,
  description,
  accent,
}: {
  name: string;
  price: string;
  description: string;
  accent?: boolean;
}) {
  return (
    <div className="relative bg-card p-6">
      {/* The registration tick, marking the one tier that is the actual product. Colour
          is doing one job on this page and this is it. */}
      {accent ? <span aria-hidden="true" className="absolute left-6 top-0 h-[2px] w-6 bg-seal-600" /> : null}
      <h3 className="text-subtitle text-ink-900">{name}</h3>
      <p className="eyebrow mt-1">{price}</p>
      <p className="mt-3 text-sm text-ink-500 text-pretty">{description}</p>
    </div>
  );
}
