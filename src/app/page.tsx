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
import { getPrincipal, homeRouteForRole } from '@/lib/auth';

export default async function HomePage() {
  const principal = await getPrincipal();

  if (principal) {
    redirect(principal.tier === OrgTier.guest ? '/app/markets' : homeRouteForRole(principal.role));
  }

  return <LandingPage />;
}

/**
 * There is no spec for this screen — docs/12's 32-screen registry has no public
 * homepage, since the product was designed assuming every visitor already had an
 * account. Visual decisions follow docs/00 (tokens, one primary CTA per section, plain
 * language before technical terms); the content itself is scoped to exactly what the
 * brief asked for and no more.
 */
function LandingPage() {
  return (
    <div className="min-h-screen bg-surface-muted">
      <header className="flex items-center justify-between bg-primary px-4 py-4 text-white sm:px-8">
        <span className="text-base font-bold tracking-tight">ClearTrade AI</span>
        <Link
          href="/login"
          className="focus-visible-ring rounded px-3 py-1.5 text-sm font-medium hover:bg-white/10"
        >
          Sign in
        </Link>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-8 sm:py-24">
        <h1 className="font-serif text-title-page text-primary sm:text-display">
          Find buyers for what you export — before you sign up for anything
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base text-[var(--color-text-secondary)]">
          ClearTrade helps Indian manufacturers find export markets and buyers, then pairs
          you with a human agent to handle the deal, paperwork, shipping and payment.
        </p>

        {/* One primary CTA (docs/00 §6): everything else on this page is secondary to it. */}
        <div className="mt-8">
          <Link
            href="/app/markets"
            className="focus-visible-ring inline-flex min-h-11 items-center justify-center rounded bg-action px-6 text-sm font-semibold text-primary transition duration-fast hover:brightness-95"
          >
            Find your export markets — free, no account needed
          </Link>
        </div>
        <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
          Already have an account?{' '}
          <Link href="/login" className="font-semibold text-primary underline underline-offset-2">
            Sign in
          </Link>{' '}
          ·{' '}
          <Link href="/register" className="font-semibold text-primary underline underline-offset-2">
            Create a free account
          </Link>
        </p>

        {/* Honest about the tier boundary — say what's free and what isn't, not just what's free. */}
        <div className="mt-16 grid gap-4 text-left sm:grid-cols-3">
          <TierCard
            name="Try it free"
            description="Search markets and buyers with no account. A couple of searches, on us — enough to see if there's real demand for what you make."
          />
          <TierCard
            name="Free account"
            description="Save your searches, see buyer contact details, and build a list of leads you own."
          />
          <TierCard
            name="Paid plan"
            description="A ClearTrade agent works your deals: negotiation, documents, shipping coordination and payment tracking, start to finish."
            accent
          />
        </div>
      </main>
    </div>
  );
}

function TierCard({ name, description, accent }: { name: string; description: string; accent?: boolean }) {
  return (
    <div
      className={`rounded-lg border p-4 shadow-card ${
        accent ? 'border-[var(--color-action)]/40 bg-surface' : 'border-[var(--color-border)] bg-surface'
      }`}
    >
      <h2 className="text-sm font-semibold text-primary">{name}</h2>
      <p className="mt-1.5 text-sm text-[var(--color-text-secondary)]">{description}</p>
    </div>
  );
}
