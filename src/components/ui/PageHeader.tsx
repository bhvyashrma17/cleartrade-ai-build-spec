import clsx from 'clsx';

/**
 * docs/27-ui-redesign.md §7.1 — the audit found agent/ops rendering an eyebrow + h1,
 * exporter deal tabs starting at h2, and auth pages differing again. One `PageHeader`:
 * eyebrow, title, one-line description, optional trailing actions.
 *
 * `eyebrow` and `title` take `ReactNode`, not just `string` — several call sites carry a
 * breadcrumb-style eyebrow (a `Link` plus a trailing " · X") or a title with an inline
 * version badge, and forcing those through a plain-string prop would mean not migrating
 * them at all.
 */

export interface PageHeaderProps {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Cross-axis alignment of the actions row against the title block. Default 'start'. */
  actionsAlign?: 'start' | 'end';
  className?: string;
}

export function PageHeader({ eyebrow, title, description, actions, actionsAlign = 'start', className }: PageHeaderProps) {
  return (
    <header className={className}>
      <div className={clsx(actions && ['flex flex-wrap justify-between gap-3', actionsAlign === 'end' ? 'items-end' : 'items-start'])}>
        <div>
          {eyebrow ? <p className="text-sm font-normal text-primary">{eyebrow}</p> : null}
          <h1 className="font-serif text-title-page text-primary">{title}</h1>
          {description ? <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{description}</p> : null}
        </div>
        {actions}
      </div>
    </header>
  );
}
