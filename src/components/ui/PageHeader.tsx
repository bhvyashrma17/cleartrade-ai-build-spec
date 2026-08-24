import clsx from 'clsx';

/**
 * The page display.
 *
 * The Didone appears exactly once per page — here — and nowhere else. That restraint is
 * the entire reason it reads as a display rather than as a theme; a serif sprinkled
 * through cards and chips is a font choice, a serif that owns the top of every page is an
 * identity, and it is the same face as the wordmark so the two are one voice.
 *
 * One component because the product had three conventions: agent/ops rendered an eyebrow
 * + `h1`, exporter deal tabs started at `h2`, and the auth pages differed again. `eyebrow`
 * and `title` take `ReactNode` rather than `string` — several call sites carry a
 * breadcrumb eyebrow or a title with an inline badge, and a plain-string prop would have
 * meant not migrating them.
 */

export interface PageHeaderProps {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Rendered under the description — a status row, a journey frame, a metadata line. */
  meta?: React.ReactNode;
  actionsAlign?: 'start' | 'end';
  className?: string;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
  actionsAlign = 'end',
  className,
}: PageHeaderProps) {
  // `pt-10 pb-6` plus a 40px Didone title spent over half of a 667px phone screen
  // before any content appeared. The type size steps down through `--text-title-page`
  // in globals.css; this is the matching padding step. Desktop keeps both, unchanged,
  // from `md` up.
  return (
    <header className={clsx('pb-4 pt-6 md:pb-6 md:pt-10', className)}>
      <div
        className={clsx(
          actions && ['flex flex-wrap justify-between gap-4', actionsAlign === 'end' ? 'items-end' : 'items-start'],
        )}
      >
        <div className="min-w-0">
          {eyebrow ? <div className="eyebrow mb-3">{eyebrow}</div> : null}
          <h1 className="display text-title-page text-bone text-balance">{title}</h1>
          {description ? (
            <p className="mt-2 max-w-2xl text-sm text-muted text-pretty md:mt-3">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {meta ? <div className="mt-4 md:mt-6">{meta}</div> : null}
    </header>
  );
}
