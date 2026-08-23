import clsx from 'clsx';
import type { StatusTone } from '@/types';
import { Skeleton } from './Skeleton';

/**
 * A single number, given room to be the content.
 *
 * The card previously set its caption at 12px and its value at 24px, both `font-medium` —
 * a two-step difference in a product where 89% of all type was already one of two sizes.
 * The value now carries real weight against a tracked label, and is set in tabular
 * figures so a row of metric cards aligns digit-for-digit instead of shimmering as the
 * numbers change.
 */

/** Comparison text uses the AA-safe `*-text` tokens — the raw hues measure 2.15-3.76:1
 *  as small text on white and fail WCAG AA. */
const COMPARISON_TONE_CLASSES: Record<StatusTone, string> = {
  positive: 'text-[var(--ok-text)]',
  info: 'text-[var(--info-text)]',
  warning: 'text-[var(--warn-text)]',
  critical: 'text-[var(--crit-text)]',
  neutral: 'text-ink-300',
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
    <div className={clsx('rounded-lg border border-line bg-card p-inset-md', className)}>
      <div className="eyebrow">{label}</div>
      {loading ? (
        <div className="mt-2">
          <Skeleton height="1.75rem" width="60%" />
        </div>
      ) : (
        <div className="mt-1.5 text-2xl font-semibold text-ink-900" data-tabular>
          {value}
        </div>
      )}
      {(secondaryText || comparison) && !loading ? (
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-300">
          {comparison ? (
            <span className={clsx('font-semibold', COMPARISON_TONE_CLASSES[comparison.tone ?? 'neutral'])}>
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
