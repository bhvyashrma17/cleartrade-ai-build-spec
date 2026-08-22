/**
 * NextActionCard — docs/03 §3: "Action title, owner, due date, urgency, deep-link CTA,
 * optional blocker." This is the card behind the "who owns the next action?" pattern
 * that runs through the whole product (docs/00 §8 principle 6).
 *
 * `blocker` takes the same `Blocker` shape the API returns on PREREQUISITES_NOT_MET
 * (docs/09 §2) so a server blocker can be rendered here without reshaping it.
 */

import clsx from 'clsx';
import { format, isValid } from 'date-fns';
import Link from 'next/link';
import type { Blocker, StatusDescriptor } from '@/types';
import { Skeleton } from './Skeleton';
import { StatusChip } from './StatusChip';

function formatDueDate(dueAt?: Date | string | null): string | null {
  if (!dueAt) return null;
  const date = typeof dueAt === 'string' ? new Date(dueAt) : dueAt;
  return isValid(date) ? format(date, 'dd MMM yyyy') : null;
}

export interface NextActionCardProps {
  title: string;
  owner?: string | null;
  dueAt?: Date | string | null;
  /** SLA/priority urgency, rendered as a StatusChip — never color alone (docs/00 §2). */
  urgency: StatusDescriptor;
  /** What is stopping this action, if anything, with its own deep link to resolve it. */
  blocker?: Blocker | null;
  /** Deep-link CTA target (docs/03 §1: every object page supports deep linking). */
  href: string;
  ctaLabel?: string;
  loading?: boolean;
  className?: string;
}

export function NextActionCard({
  title,
  owner,
  dueAt,
  urgency,
  blocker,
  href,
  ctaLabel = 'View',
  loading = false,
  className,
}: NextActionCardProps) {
  if (loading) {
    return (
      <div className={clsx('rounded-lg border border-[var(--color-border)] bg-surface p-4 shadow-card', className)}>
        <Skeleton height="1rem" width="70%" />
        <div className="mt-3">
          <Skeleton height="0.8rem" width="45%" />
        </div>
      </div>
    );
  }

  const dueLabel = formatDueDate(dueAt);

  return (
    <div
      className={clsx(
        'rounded-lg border bg-surface p-4 shadow-card',
        blocker ? 'border-[color-mix(in_srgb,var(--color-critical)_30%,transparent)]' : 'border-[var(--color-border)]',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-primary">{title}</p>
        <StatusChip {...urgency} size="sm" />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-secondary)]">
        {owner ? <span>Owner: {owner}</span> : <span>Unassigned</span>}
        <span>{dueLabel ? `Due ${dueLabel}` : 'No due date'}</span>
      </div>

      {blocker ? (
        <div className="mt-3 rounded-md border border-[color-mix(in_srgb,var(--color-critical)_25%,transparent)] bg-[color-mix(in_srgb,var(--color-critical)_5%,transparent)] p-2.5 text-xs text-critical">
          <p>{blocker.reason}</p>
          {blocker.deep_link ? (
            <Link href={blocker.deep_link} className="mt-1 inline-block font-normal underline underline-offset-2">
              Resolve this first
            </Link>
          ) : null}
        </div>
      ) : null}

      {/* One primary action per card (docs/00 §6). */}
      <Link
        href={href}
        className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary underline underline-offset-2"
      >
        {ctaLabel}
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M6 3.5 11 8l-5 4.5" />
        </svg>
      </Link>
    </div>
  );
}
