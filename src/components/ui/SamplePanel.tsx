/**
 * The standard frame around a fixture-backed DEMO of a paid feature.
 *
 * `UpgradeNotice` says what is withheld. This says what it looks like — and the difference
 * matters commercially: a free member who has only ever seen a padlock is deciding whether
 * to buy something they have never seen work.
 *
 * WHAT MAKES IT HONEST, and why each of these is not optional:
 *
 *   - The banner is INSIDE the panel, above the content, and cannot be scrolled past to
 *     reach the data. A disclaimer under the fold is a disclaimer that did not happen.
 *   - The label is stated in words ("Sample"), not carried by a colour or a border style.
 *     Someone reading this in greyscale, or with a screen reader, gets the same warning
 *     (docs/10 §4).
 *   - `aria-describedby` binds the banner to the region, so the sample framing is
 *     announced when focus enters — not left as a visual-only cue.
 *   - The locked remainder is rendered as a COUNT of real withheld rows, never as blurred
 *     fake ones. Blurred placeholder rows imply data exists behind the blur in a shape we
 *     are not actually promising.
 *
 * Every sample rendered through this component comes from `src/lib/billing/preview.ts`,
 * which has no access to Prisma or any provider client — so nothing on screen here can
 * have cost a credit to produce.
 */

import Link from 'next/link';
import clsx from 'clsx';
import { buttonClass } from './Button';

export interface SamplePanelProps {
  /** What this is a sample OF, in the user's terms. */
  title: string;
  /** The disclaimer. Callers pass `SAMPLE_DISCLAIMER`; it is required, not defaulted, so
   *  a caller cannot omit the framing by forgetting a prop. */
  disclaimer: string;
  /** The illustrative product the sample is computed for — stated so it reads as not-yours. */
  subject?: string;
  children: React.ReactNode;
  /** "and 38 more markets" — the honest size of what Premium returns. */
  lockedSummary?: string;
  /** Overrides the default upgrade CTA copy. */
  cta?: string;
  className?: string;
}

export function SamplePanel({
  title,
  disclaimer,
  subject,
  children,
  lockedSummary,
  cta = 'Upgrade to run this on your product',
  className,
}: SamplePanelProps) {
  // Derived from the title rather than `useId()`, which is a hook and would force every
  // sample surface to become a client component for the sake of one attribute. Titles are
  // distinct per page, which is all this needs to be.
  const bannerId = `sample-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

  return (
    <section
      aria-describedby={bannerId}
      className={clsx(
        // Dashed edge echoes the locked-state treatment `UpgradeNotice` already uses, so
        // "this is not your live data" is consistent across every withheld surface.
        'rounded-lg border border-dashed border-line-strong bg-surface',
        className,
      )}
    >
      <div
        id={bannerId}
        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-t-lg border-b border-dashed border-line-strong bg-surface-2 px-5 py-3"
      >
        <span className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-accent">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <circle cx="8" cy="8" r="6.25" />
            <path d="M8 5.5v5" strokeLinecap="round" />
          </svg>
          Sample
        </span>
        <p className="min-w-0 flex-1 text-xs text-muted">{disclaimer}</p>
      </div>

      <div className="p-5">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-subtitle text-bone">{title}</h3>
          {subject ? <p className="text-xs text-faint">Example product: {subject}</p> : null}
        </div>

        {children}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          {lockedSummary ? (
            <p className="inline-flex items-center gap-2 text-sm text-muted">
              <LockIcon />
              {lockedSummary}
            </p>
          ) : (
            <span />
          )}
          <Link href="/app/plans" className={buttonClass('accent', 'sm')}>
            {cta}
          </Link>
        </div>
      </div>
    </section>
  );
}

/** Label always accompanies this icon — never the only cue (docs/10 §4). */
function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" className="shrink-0">
      <rect x="3" y="7" width="10" height="6.5" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}
