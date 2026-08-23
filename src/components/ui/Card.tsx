import clsx from 'clsx';
import { Inset, type InsetSize } from './Inset';

/**
 * The one card.
 *
 * Flat by default. White on cool paper already reads as raised by value alone, so a
 * shadow adds nothing but noise — and `shadow-card` sat on 182 elements here, which is
 * precisely why nothing in the product appeared to float. Elevation is now reserved for
 * things that are genuinely above the page: `elevated` for hover and sticky surfaces,
 * `shadow-overlay` for drawers and dialogs.
 *
 * `tone` covers the three grounds a panel can sit on. `ink` exists because the brand's
 * chrome is dark, and a dark panel on a light page is the strongest emphasis the system
 * has — worth having, worth rationing.
 */

export type CardTone = 'default' | 'sunk' | 'ink';

const TONE_CLASS: Record<CardTone, string> = {
  default: 'border-line bg-card text-ink-900',
  sunk: 'border-line bg-paper-sunk text-ink-900',
  ink: 'border-ink-900 bg-ink-900 text-bone on-ink',
};

export interface CardProps extends React.HTMLAttributes<HTMLElement> {
  elevated?: boolean;
  inset?: InsetSize;
  tone?: CardTone;
  as?: 'div' | 'section' | 'article' | 'aside' | 'header';
}

export function Card({
  elevated = false,
  inset = 'lg',
  tone = 'default',
  as: Tag = 'div',
  className,
  children,
  ...props
}: CardProps) {
  const Component = Tag as 'div';
  return (
    <Component
      className={clsx(
        'rounded-lg border',
        TONE_CLASS[tone],
        elevated && 'shadow-raised',
        className,
      )}
      {...props}
    >
      <Inset size={inset}>{children}</Inset>
    </Component>
  );
}
