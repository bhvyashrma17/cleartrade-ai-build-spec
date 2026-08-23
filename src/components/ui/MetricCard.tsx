import clsx from 'clsx';
import type { StatusTone } from '@/types';
import { Skeleton } from './Skeleton';

/**
 * A single number, given the room to be the content.
 *
 * In this product the figure IS the content — open value, deals at risk, days overdue —
 * so it is set at the `figure` size in tabular numerals rather than at the 24px that made
 * every dashboard here read as a row of identical grey boxes. The label above it is small
 * and tracked, so the eye lands on the number first and reads what it is second.
 */

const COMPARISON_TONE_CLASSES: Record<StatusTone, string> = {
  positive: 'text-[var(--ok)]',
  info: 'text-[var(--info)]',
  warning: 'text-[var(--warn)]',
  critical: 'text-[var(--crit)]',
  neutral: 'text-muted',
};

export interface MetricCardComparison {
  label: string;
  tone?: StatusTone;
}

export interface MetricCardProps {
  label: string;
  value: string | number;
  /** Extra context under the value — e.g. "vs. 12 last month". */
  secondaryText?: string;
  comparison?: MetricCardComparison;
  loading?: boolean;
  className?: string;
}

export function MetricCard({
  label,
  value,
  secondaryText,
  comparison,
  loading = false,
  className,
}: MetricCardProps) {
  return (
    <div className={clsx('rounded-lg border border-line bg-surface p-inset-md', className)}>
      <div className="eyebrow">{label}</div>
      {loading ? (
        <div className="mt-3">
          <Skeleton height="2.25rem" width="60%" />
        </div>
      ) : (
        <div className="figure mt-2 text-bone" data-tabular>
          {value}
        </div>
      )}
      {(secondaryText || comparison) && !loading ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-muted">
          {comparison ? (
            <span className={clsx('font-medium', COMPARISON_TONE_CLASSES[comparison.tone ?? 'neutral'])}>
              {comparison.label}
            </span>
          ) : null}
          {secondaryText ? <span>{secondaryText}</span> : null}
        </div>
      ) : null}
      {loading && (secondaryText || comparison) ? (
        <div className="mt-2">
          <Skeleton height="0.75rem" width="40%" />
        </div>
      ) : null}
    </div>
  );
}
