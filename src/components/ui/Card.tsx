import clsx from 'clsx';
import { Inset, type InsetSize } from './Inset';

/**
 * docs/27-ui-redesign.md §7.1 — the audit found two parallel card treatments (with and
 * without `shadow-card`). One `Card`, flat by default; pass `elevated` to opt into the
 * shadow where a call site's existing design already used one, so migrating a call site
 * to this component doesn't silently change its rendered appearance.
 */

export interface CardProps extends React.HTMLAttributes<HTMLElement> {
  elevated?: boolean;
  inset?: InsetSize;
  as?: 'div' | 'section' | 'article' | 'aside' | 'header';
}

export function Card({ elevated = false, inset = 'lg', as: Tag = 'div', className, children, ...props }: CardProps) {
  const Component = Tag as 'div';
  return (
    <Component
      className={clsx(
        'rounded-lg border border-[var(--color-border)] bg-surface',
        elevated && 'shadow-card',
        className,
      )}
      {...props}
    >
      <Inset size={inset}>{children}</Inset>
    </Component>
  );
}
