/**
 * MetricCard — docs/03 §3: "Label, value, comparison/secondary text; skeleton while
 * loading." Used in the dashboard metric row (docs/00 §4).
 */

import clsx from 'clsx';
import type { StatusTone } from '@/types';
import { Skeleton } from './Skeleton';

/**
 * Comparison text uses the AA-safe `*-text` tokens, not the raw palette values: the raw
 * hues measure 2.15-3.76:1 as small text on white and fail WCAG AA. The tokens keep each
 * hue recognisable while clearing 4.5:1 (see globals.css).
 */
const COMPARISON_TONE_CLASSES: Record<StatusTone, string> = {
  positive: 'text-[var(--color-action-text)]',
  info: 'text-[var(--color-info-text)]',
  warning: 'text-[var(--color-warning-text)]',
  critical: 'text-[var(--color-critical-text)]',
  neutral: 'text-[var(--color-text-secondary)]',
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
    <div
      className={clsx(
        'rounded-lg border border-[var(--color-border)] bg-surface p-4 shadow-card',
        className,
      )}
    >
      <div className="text-sm text-[var(--color-text-secondary)]">{label}</div>
      {loading ? (
        <div className="mt-2">
          <Skeleton height="1.75rem" width="60%" />
        </div>
      ) : (
        <div className="mt-1 text-2xl font-semibold text-primary">{value}</div>
      )}
      {(secondaryText || comparison) && !loading ? (
        <div className="mt-1 flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
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
