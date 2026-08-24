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
  locked: { label: 'Not included', className: 'text-faint' },
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
    <div className="overflow-x-auto">
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

      <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-2 text-xs text-muted">
        <div className="flex items-center gap-2">
          <dt className="text-[var(--ok)]">Included</dt>
          <dd>runs on your own product and your own data.</dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="text-accent">Sample only</dt>
          <dd>a labelled demo of the real thing, built from illustrative figures.</dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="text-faint">Not included</dt>
          <dd>needs Premium.</dd>
        </div>
      </dl>
    </div>
  );
}
