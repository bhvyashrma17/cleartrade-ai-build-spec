/**
 * Free vs Premium, feature by feature.
 *
 * Every row's checkmark is computed by `availabilityFor()`, which calls the same
 * `minTierFor()` the API calls on every request — see the header of
 * `src/lib/billing/plans.ts` for why the pricing table is wired to the permission matrix
 * instead of being written out by hand.
 *
 * Three states, not two. A capability a free member cannot USE but can SEE as a sample is
 * neither a tick nor a cross, and rendering it as a cross would undersell the free tier
 * while rendering it as a tick would oversell it. `preview` is its own mark with its own
 * legend, which is the honest answer and also the one that sells the upgrade.
 */

import clsx from 'clsx';
import { COMPARISON, availabilityFor, type FeatureAvailability } from '@/lib/billing/plans';

const MARK: Record<FeatureAvailability, { label: string; className: string }> = {
  included: { label: 'Included', className: 'text-[var(--ok)]' },
  preview: { label: 'Sample only', className: 'text-accent' },
    // `--muted`, not `--faint`: globals.css documents --faint as "NEVER text — 2.4:1",
  // and axe flagged this as a serious contrast violation on both phone and desktop.
  locked: { label: 'Not included', className: 'text-muted' },
};

function Mark({ availability }: { availability: FeatureAvailability }) {
  const { label, className } = MARK[availability];
  return (
    <span className={clsx('inline-flex items-center justify-center gap-1.5', className)}>
      {availability === 'included' ? (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 8.5 6.5 12 13 4" />
        </svg>
      ) : availability === 'preview' ? (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <circle cx="8" cy="8" r="6.25" />
          <path d="M8 5.5v5" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" />
        </svg>
      )}
      {/* The icon is never the only cue — docs/10 §4. Visible on wide screens, and always
          available to a screen reader. */}
      <span className="sr-only sm:not-sr-only sm:text-xs sm:font-medium">{label}</span>
    </span>
  );
}

export function ComparisonTable() {
  return (
    <>
      {/* PHONE: one card per feature.
          The table below needs 544px to keep three columns legible, which no phone
          has — it was the single worst mobile defect in the product, because a
          scroller that wide also expands the layout viewport and pushed the fixed
          top bar's controls off-screen (see the `:has(> table)` rule in globals.css,
          which now contains that damage everywhere else it occurs). Even with that
          fixed, side-scrolling a comparison to find out what you get is the wrong
          interaction for the page that asks someone to pay: the two answers belong
          side by side within one thumb's view, which is what this layout gives. */}
      <ul className="space-y-3 md:hidden">
        {COMPARISON.map((feature) => {
          const free = availabilityFor(feature, 'free');
          const premium = availabilityFor(feature, 'premium_monthly');
          return (
            <li key={feature.capability} className="rounded-lg border border-line bg-surface p-4">
              <p className="text-sm font-medium text-bone">{feature.label}</p>
              <p className="mt-1 text-sm text-muted text-pretty">{feature.detail}</p>
              <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted">Free</dt>
                  <dd className="mt-1 flex justify-start"><Mark availability={free} /></dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-accent">Premium</dt>
                  <dd className="mt-1 flex justify-start"><Mark availability={premium} /></dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>

      <Legend className="md:hidden" />

    <div className="hidden overflow-x-auto md:block">
      <table className="w-full min-w-[34rem] border-collapse text-left">
        <caption className="sr-only">
          Feature comparison between the Free and Premium plans
        </caption>
        <thead>
          <tr className="border-b border-line-strong">
            <th scope="col" className="py-3 pr-4 text-xs font-medium uppercase tracking-wide text-muted">
              Feature
            </th>
            <th scope="col" className="w-32 px-3 py-3 text-center text-xs font-medium uppercase tracking-wide text-muted">
              Free
            </th>
            <th scope="col" className="w-32 px-3 py-3 text-center text-xs font-medium uppercase tracking-wide text-accent">
              Premium
            </th>
          </tr>
        </thead>
        <tbody>
          {COMPARISON.map((feature) => {
            const free = availabilityFor(feature, 'free');
            const premium = availabilityFor(feature, 'premium_monthly');
            return (
              <tr key={feature.capability} className="border-b border-line align-top">
                <th scope="row" className="py-4 pr-4 font-normal">
                  <span className="block text-sm font-medium text-bone">{feature.label}</span>
                  <span className="mt-1 block max-w-md text-sm text-muted text-pretty">
                    {feature.detail}
                  </span>
                </th>
                <td className="px-3 py-4 text-center">
                  <Mark availability={free} />
                </td>
                <td className="px-3 py-4 text-center">
                  <Mark availability={premium} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <Legend />
    </div>
    </>
  );
}

/** Shared by both layouts so the three marks are explained in exactly one place. */
function Legend({ className }: { className?: string }) {
  return (
    <dl className={clsx('mt-6 flex flex-wrap gap-x-8 gap-y-2 text-xs text-muted', className)}>
      <div className="flex items-center gap-2">
        <dt className="text-[var(--ok)]">Included</dt>
        <dd>runs on your own product and your own data.</dd>
      </div>
      <div className="flex items-center gap-2">
        <dt className="text-accent">Sample only</dt>
        <dd>a labelled demo of the real thing, built from illustrative figures.</dd>
      </div>
      <div className="flex items-center gap-2">
        <dt className="text-muted">Not included</dt>
        <dd>needs Premium.</dd>
      </div>
    </dl>
  );
}
