import clsx from 'clsx';

/**
 * docs/27-ui-redesign.md §7.1 — the audit found two parallel empty-state treatments.
 * They turned out to be two genuinely different shapes, not just a missing/present
 * border on the same one, so `bordered` switches the whole recipe rather than adding
 * a border on top of the other layout:
 *
 *   - `bordered={false}` (default) — centered title + description, for "no results"
 *     surfaces (the shape `DataTable`'s own internal empty block already used).
 *   - `bordered={true}` — left-aligned, dashed panel, for a single-sentence "nothing in
 *     this queue" notice inside an already-visible section (the `EmptyQueue` helper
 *     that 5 Ops pages each hand-rolled identically).
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
      <div className={clsx('rounded border border-dashed border-[var(--color-border)] bg-surface-muted px-4 py-6 text-sm text-[var(--color-text-secondary)]', className)}>
        <p>{title}</p>
        {description ? <p className="mt-1">{description}</p> : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    );
  }

  return (
    <div className={clsx('flex flex-col items-center gap-1 text-center', className)}>
      <p className="text-sm font-normal text-primary">{title}</p>
      {description ? <p className="text-sm text-[var(--color-text-secondary)]">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
