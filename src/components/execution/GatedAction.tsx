/**
 * AGT-06-AC01 rendering contract: "Prerequisite blocked → disable downstream action WITH
 * REASON AND LINK."
 *
 * This is a server component on purpose. It takes the verdict computed by
 * `isActionAllowed()` on the server and either renders its children (the live control) or
 * renders a disabled control plus the gate's reasons and deep links. It has no state, no
 * effect and no access to the rules — so a blocked action cannot be "re-enabled" by
 * client-side code, because the client was never given anything to re-evaluate.
 *
 * A bare `disabled` button would satisfy the letter of "disable downstream action" and
 * fail the spirit: the agent would be stuck with no idea why or where to go. The reason
 * and link are the point.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ExecutionGate } from '@/lib/execution-plan';

export function GatedAction({
  verdict,
  children,
  label,
}: {
  verdict: { allowed: true } | { allowed: false; gate: ExecutionGate };
  children: ReactNode;
  /** What the blocked control would have said, so the disabled state still reads sensibly. */
  label: string;
}) {
  if (verdict.allowed) return <>{children}</>;

  const { gate } = verdict;
  return (
    <div className="max-w-md">
      <button
        type="button"
        disabled
        aria-disabled="true"
        className="focus-visible-ring inline-flex min-h-8 cursor-not-allowed items-center justify-center rounded border border-[var(--color-border-strong)] bg-surface-muted px-3 text-xs font-semibold text-[var(--color-text-secondary)] opacity-70"
      >
        {label}
      </button>
      <div className="mt-1.5 rounded-md border border-[color-mix(in_srgb,var(--color-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_6%,transparent)] p-2 text-xs">
        <p className="font-medium text-primary">
          Blocked by “{gate.label}”
          {gate.state === 'waiting' ? ' — not this step’s turn yet.' : ':'}
        </p>
        {gate.blockers.length > 0 ? (
          <ul className="mt-1 space-y-1 text-[var(--color-text-secondary)]">
            {gate.blockers.map((b, i) => (
              <li key={i}>
                {b.reason}{' '}
                {b.deep_link ? (
                  <Link href={b.deep_link} className="font-semibold text-primary underline underline-offset-2">
                    Go there
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-[var(--color-text-secondary)]">{gate.detail}</p>
        )}
      </div>
    </div>
  );
}
