import clsx from 'clsx';

/**
 * A section header, carrying the supporting brand motif.
 *
 * The mark's registration ticks become the divider: a hairline rule with a short heavy
 * tick at the left edge. It appears on section headers and nowhere else — the moment a
 * motif is everywhere it stops being a motif and becomes wallpaper.
 *
 * The rule sits *above* the heading rather than under it, so a page of sections reads as
 * a stack of registered plates rather than a list of underlined titles.
 */

export interface SectionHeadingProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Small tracked label above the title. */
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
  /** Seal-toned tick, for the one section on a page that deserves the accent. */
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
    <div
      className={clsx('tick-rule pt-3', className)}
      data-tone={accent ? 'seal' : undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {eyebrow ? <p className="eyebrow mb-1">{eyebrow}</p> : null}
          <Tag className={Tag === 'h2' ? 'text-title-section text-ink-900' : 'text-subtitle text-ink-900'}>
            {title}
          </Tag>
          {description ? (
            <p className="mt-1 max-w-2xl text-sm text-ink-500 text-pretty">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
