import clsx from 'clsx';
import { Inset, type InsetSize } from './Inset';

/**
 * The one panel.
 *
 * On a dark ground, elevation is *light*: a raised surface is lighter than the one under
 * it, not shadowed. So there is no `shadow` here at all — `tone` moves the panel up and
 * down the ground stack instead, and shadows are reserved for true overlays (menus,
 * dialogs) that have to detach from the page entirely.
 *
 * `ticked` adds the mark's corner registration ticks. One panel per screen — the one that
 * is the point of the screen. Any more and the motif stops meaning anything.
 */

export type CardTone = 'default' | 'raised' | 'bare';

const TONE_CLASS: Record<CardTone, string> = {
  default: 'border border-line bg-surface',
  raised: 'border border-line-strong bg-surface-2',
  // No fill: for a panel that is only a grouping, divided from its neighbours by a rule.
  bare: 'border border-line bg-transparent',
};

export interface CardProps extends React.HTMLAttributes<HTMLElement> {
  /** @deprecated Elevation on dark is tone, not shadow. Maps to `tone="raised"`. */
  elevated?: boolean;
  inset?: InsetSize;
  tone?: CardTone;
  ticked?: boolean;
  as?: 'div' | 'section' | 'article' | 'aside' | 'header';
}

export function Card({
  elevated = false,
  inset = 'lg',
  tone,
  ticked = false,
  as: Tag = 'div',
  className,
  children,
  ...props
}: CardProps) {
  const Component = Tag as 'div';
  const resolved: CardTone = tone ?? (elevated ? 'raised' : 'default');
  return (
    <Component
      className={clsx('rounded-lg', TONE_CLASS[resolved], ticked && 'ticked', className)}
      {...props}
    >
      <Inset size={inset}>{children}</Inset>
    </Component>
  );
}
