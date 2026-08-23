import clsx from 'clsx';
import { BrandMark } from '@/components/brand/BrandMark';

/**
 * The one empty state. Two genuinely different shapes, not one shape with an optional
 * border, so `bordered` switches the whole recipe:
 *
 *   - default — centred, with the mark held at low contrast above the line. An empty
 *     surface is the one moment with room for the brand, and otherwise the most
 *     characterless screen any product has.
 *   - `bordered` — left-aligned, one line, for "nothing in this queue" inside a section
 *     that already has its own heading, where a centred mark would be shouting.
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
      <div className={clsx('rounded-lg border border-dashed border-line-strong bg-surface px-4 py-5 text-sm text-slate', className)}>
        <p className="font-medium text-bone">{title}</p>
        {description ? <p className="mt-1 text-muted">{description}</p> : null}
        {action ? <div className="mt-3">{action}</div> : null}
      </div>
    );
  }

  return (
    <div className={clsx('flex flex-col items-center px-4 py-12 text-center', className)}>
      <BrandMark size={30} className="text-muted opacity-60" />
      <p className="mt-5 text-subtitle text-bone">{title}</p>
      {description ? <p className="mt-2 max-w-sm text-sm text-muted text-pretty">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
