import clsx from 'clsx';

/**
 * The page masthead.
 *
 * The display serif appears exactly once per page — here — and nowhere else. That
 * restraint is the whole reason it reads as a masthead rather than as a theme; a serif
 * sprinkled through cards and chips is just a font choice, a serif that owns the top of
 * every page is an identity.
 *
 * One component because the product had three page-header conventions: agent/ops rendered
 * an eyebrow + `h1`, exporter deal tabs started at `h2`, and the auth pages differed
 * again. `eyebrow` and `title` take `ReactNode` rather than `string` — several call sites
 * carry a breadcrumb-style eyebrow (a `Link` plus a trailing " · X") or a title with an
 * inline version badge, and a plain-string prop would have meant not migrating them.
 */

export interface PageHeaderProps {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Rendered under the description — a status row, journey frame, or metadata line. */
  meta?: React.ReactNode;
  /** Cross-axis alignment of the actions row against the title block. Default 'start'. */
  actionsAlign?: 'start' | 'end';
  className?: string;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
  actionsAlign = 'start',
  className,
}: PageHeaderProps) {
  return (
    <header className={className}>
      <div
        className={clsx(
          actions && [
            'flex flex-wrap justify-between gap-4',
            actionsAlign === 'end' ? 'items-end' : 'items-start',
          ],
        )}
      >
        <div className="min-w-0">
          {eyebrow ? <div className="eyebrow mb-2">{eyebrow}</div> : null}
          <h1 className="masthead text-title-page text-ink-900 text-balance">{title}</h1>
          {description ? (
            <p className="mt-2 max-w-2xl text-sm text-ink-500 text-pretty">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {meta ? <div className="mt-4">{meta}</div> : null}
    </header>
  );
}
