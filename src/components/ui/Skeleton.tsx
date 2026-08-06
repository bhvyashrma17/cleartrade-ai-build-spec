/**
 * Skeleton — docs/03 §3: "mirror the final layout; avoid generic full-page spinners
 * for page-level loads." Every loading state in this product renders the shape of the
 * content that's coming, not a spinner.
 */

import clsx from 'clsx';

export interface SkeletonProps {
  variant?: 'text' | 'circle' | 'rect';
  width?: string | number;
  height?: string | number;
  /** Stacked lines for a text block; the last line is shorter, like real copy. */
  lines?: number;
  className?: string;
}

export function Skeleton({ variant = 'text', width, height, lines = 1, className }: SkeletonProps) {
  const style = {
    width: width ?? (variant === 'circle' ? height : undefined),
    height: height ?? (variant === 'text' ? '0.9em' : undefined),
  };

  if (variant === 'text' && lines > 1) {
    return (
      <span className={clsx('inline-flex flex-col gap-2', className)} aria-hidden="true">
        {Array.from({ length: lines }).map((_, i) => (
          <span
            key={i}
            className="animate-pulse rounded-sm bg-primary/10"
            style={{ height: style.height, width: i === lines - 1 ? '60%' : '100%' }}
          />
        ))}
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={clsx(
        'inline-block animate-pulse bg-primary/10',
        variant === 'circle' ? 'rounded-full' : 'rounded-sm',
        className,
      )}
      style={style}
    />
  );
}
