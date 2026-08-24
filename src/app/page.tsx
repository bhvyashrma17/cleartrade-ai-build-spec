/**
 * Root route. `/` · public.
 *
 * Login is not mandatory to use the product (docs/14) — Demand Discovery and Buyer
 * Discovery are open to anonymous visitors — so this route must not force everyone
 * through /login the way it did when every request was authenticated.
 *
 * Three outcomes, and only two of them redirect:
 *   - a real (non-guest) account -> their role's home route
 *   - a guest session (they already searched at least once) -> straight into discovery
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
 * Shown as the product's actual shape rather than as a feature list, because what is being
 * sold is that somebody else works the stages you have not reached yet.
 */
const STAGES = ['Readiness', 'Market', 'Buyers', 'Deal', 'Documents', 'Customs', 'Shipment', 'Payment'] as const;

/** How far the illustrated deal has closed. Mid-flight on purpose: a closed frame would
 *  say "done", an empty one would say "nothing happens here". */
const PROGRESS = 5;

function LandingPage() {
  return (
    <div className="min-h-screen bg-ground">
      <header className="sticky top-0 z-30 border-b border-line bg-[color-mix(in_srgb,var(--ground)_82%,transparent)] backdrop-blur-xl">
        <div className="mx-auto flex h-topbar max-w-shell items-center justify-between px-5 sm:px-8">
          <Wordmark size="sm" />
          <div className="flex items-center gap-2">
            <Link href="/login" className={buttonClass('ghost', 'sm')}>Sign in</Link>
            <Link href="/app/markets" className={buttonClass('primary', 'sm')}>Find your markets</Link>
          </div>
        </div>
      </header>

      <main>
        {/* --- Hero.
            Asymmetric and left-aligned. A centred column under a centred headline is the
            single most common shape on the web and reads as a template; the weight sits
            left, the working artefact sits right, and the mark bleeds off the edge behind
            both at low contrast so the brand is present without being a sticker. --- */}
        <section className="relative overflow-hidden">
          <div className="mx-auto grid max-w-shell gap-14 px-5 py-20 sm:px-8 lg:grid-cols-[minmax(0,1fr)_25rem] lg:items-center lg:gap-20 lg:py-28">
            <div className="animate-fade-rise relative">
              <p className="eyebrow">Export operating system · India</p>
              {/* The brand's own tagline, which was already the best line written for this
                  product and appeared nowhere in it. The second half goes italic — the
                  Didone has a genuinely beautiful italic and it earns the contrast. */}
              <h1 className="display mt-6 text-[3rem] leading-[0.98] text-bone sm:text-display">
                Structured exports.
                <br />
                <em className="not-italic text-muted">Zero</em>{' '}
                <em className="italic text-accent">chaos.</em>
              </h1>
              <p className="mt-8 max-w-lg text-base leading-relaxed text-slate text-pretty">
                Find your markets and buyers free. When you&rsquo;re ready to ship, a ClearTrade
                agent handles the paperwork, customs, freight and payment with you.
              </p>

              <div className="mt-10 flex flex-wrap items-center gap-4">
                {/* One primary CTA (docs/00 §6): everything else here is secondary to it. */}
                <Link href="/app/markets" className={buttonClass('primary', 'md', 'h-11 min-h-11 px-6 text-sm shadow-accent')}>
                  Find your export markets
                </Link>
                <span className="text-xs text-muted">Free · no account needed</span>
              </div>

              <p className="mt-8 text-sm text-muted">
                Already have an account?{' '}
                <Link href="/login" className="focus-visible-ring text-bone underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-accent">
                  Sign in
                </Link>
              </p>
            </div>

            {/* --- The ticket.
                A real artefact rather than an illustration: the deal as this product
                actually models it, with the reference numbers in the record face. The
                corner ticks are the mark's, and this is the one panel on the page that
                gets them. --- */}
            <aside className="ticked animate-fade-rise rounded-lg border border-line-strong bg-surface p-6 sm:p-7">
              <div className="flex items-start justify-between gap-4 border-b border-line pb-5">
                <div>
                  <p className="eyebrow">Example deal · In flight</p>
                  <p className="record mt-2 text-[13px] text-slate">CT-2026-0417</p>
                </div>
                <JourneyFrame value={PROGRESS} total={STAGES.length} size={44} className="text-bone" />
              </div>

              <dl className="mt-5 space-y-3 text-sm">
                <Row label="Buyer" value="Gulf Foods General Trading" />
                <Row label="Route" value="INNSA → AEJEA" mono />
                <Row label="Value" value="USD 42,000" mono />
                <Row label="Incoterm" value="FOB" mono />
              </dl>

              <ol className="mt-6 grid grid-cols-2 gap-x-5 gap-y-2.5 border-t border-line pt-5">
                {STAGES.map((stage, index) => {
                  const done = index < PROGRESS;
                  const current = index === PROGRESS;
                  return (
                    <li key={stage} className="flex items-center gap-2.5 text-xs">
                      <span
                        aria-hidden="true"
                        className={
                          done
                            ? 'size-1.5 shrink-0 bg-bone'
                            : current
                              ? 'size-1.5 shrink-0 bg-accent'
                              : 'size-1.5 shrink-0 border border-line-strong'
                        }
                      />
                      <span className={done ? 'text-slate' : current ? 'text-bone' : 'text-muted'}>{stage}</span>
                    </li>
                  );
                })}
              </ol>

              <p className="mt-6 border-t border-line pt-4 text-xs leading-relaxed text-muted">
                Your agent works the open stages. You approve what is yours to decide —
                price, terms, and who you ship to.
              </p>
            </aside>
          </div>
        </section>

        {/* --- Tiers. Honest about the boundary: what is free, and what is not. --- */}
        <section className="mx-auto max-w-shell px-5 pb-28 sm:px-8">
          <h2 className="eyebrow border-t border-line pt-5">What you get, and when you pay</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <Tier name="Try it free" price="No account" description="Search markets and buyers with no sign-up. A couple of searches, on us — enough to see if there's real demand for what you make." />
            <Tier name="Free account" price="₹0" description="Save your searches, see buyer contact details, and build a list of leads you own." />
            <Tier name="Paid plan" price="One-time commitment fee" description="A ClearTrade agent works your deals: negotiation, documents, shipping coordination and payment tracking, start to finish." accent />
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-shell flex-wrap items-center justify-between gap-6 px-5 py-10 sm:px-8">
          <Wordmark size="sm" tagline />
          <p className="text-xs text-muted">© {new Date().getFullYear()} ClearTrade</p>
        </div>
      </footer>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-xs text-muted">{label}</dt>
      <dd className={mono ? 'record text-right text-bone' : 'text-right text-sm text-bone'}>{value}</dd>
    </div>
  );
}

function Tier({ name, price, description, accent }: { name: string; price: string; description: string; accent?: boolean }) {
  return (
    <div
      className={
        accent
          ? 'relative rounded-lg border border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-accent-tint p-6'
          : 'relative rounded-lg border border-line bg-surface p-6'
      }
    >
      <h3 className="text-subtitle text-bone">{name}</h3>
      <p className={accent ? 'eyebrow mt-1.5 text-accent' : 'eyebrow mt-1.5'}>{price}</p>
      <p className="mt-4 text-sm text-slate text-pretty">{description}</p>
    </div>
  );
}
