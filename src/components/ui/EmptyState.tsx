import clsx from 'clsx';
import { BrandMark } from '@/components/brand/BrandMark';

/**
 * The one empty state.
 *
 * Two genuinely different shapes, not one shape with an optional border, so `bordered`
 * switches the whole recipe:
 *
 *   - default — centred, with the mark at low contrast above the title. For a surface
 *     that is empty as a whole ("no results", "nothing here yet"). The mark earns its
 *     place here: an empty page is the one moment with room for the brand, and it is
 *     otherwise the most characterless screen in any product.
 *   - `bordered` — left-aligned, dashed, one line. For "nothing in this queue" inside a
 *     section that already has its own heading, where a centred mark would be shouting.
 */

export interface EmptyStateProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  bordered?: boolean;
  className?: string;
}

export function EmptyState({ title, description, action, bordered = false, className }: EmptyStateProps) {
  if (bordered) {
    return (
      <div
        className={clsx(
          'rounded-lg border border-dashed border-line-strong bg-paper-sunk px-4 py-5 text-sm text-ink-500',
          className,
        )}
      >
        <p className="font-medium text-ink-900">{title}</p>
        {description ? <p className="mt-1">{description}</p> : null}
        {action ? <div className="mt-3">{action}</div> : null}
      </div>
    );
  }

  return (
    <div className={clsx('flex flex-col items-center px-4 py-10 text-center', className)}>
      <BrandMark size={28} className="text-ink-300" />
      <p className="mt-4 text-subtitle text-ink-900">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-sm text-sm text-ink-500 text-pretty">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
