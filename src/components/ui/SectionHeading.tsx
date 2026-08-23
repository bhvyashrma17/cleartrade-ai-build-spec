import clsx from 'clsx';

/**
 * A section header.
 *
 * A hairline above the title rather than under it, so a page of sections reads as a stack
 * of registered plates rather than a list of underlined headings. `accent` marks the one
 * section on a page that is the point of the page.
 */

export interface SectionHeadingProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
  accent?: boolean;
  as?: 'h2' | 'h3';
  className?: string;
}

export function SectionHeading({
  title,
  description,
  eyebrow,
  actions,
  accent = false,
  as: Tag = 'h2',
  className,
}: SectionHeadingProps) {
  return (
    <div className={clsx('relative border-t border-line pt-4', className)}>
      <span
        aria-hidden="true"
        className={clsx('absolute -top-px left-0 h-px w-10', accent ? 'bg-accent' : 'bg-line-strong')}
      />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {eyebrow ? <p className="eyebrow mb-1.5">{eyebrow}</p> : null}
          <Tag className={Tag === 'h2' ? 'text-title-section text-bone' : 'text-subtitle text-bone'}>{title}</Tag>
          {description ? <p className="mt-1.5 max-w-2xl text-sm text-muted text-pretty">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
