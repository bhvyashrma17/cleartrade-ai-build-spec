import clsx from 'clsx';

/**
 * docs/27-ui-redesign.md §5.1 — padding, off the six-step scale, replacing per-element
 * `p-*`. Not migrated everywhere yet; this establishes the primitive and the pattern
 * for the components that adopt it now.
 */

export type InsetSize = 'sm' | 'md' | 'lg';

const SIZE_CLASS: Record<InsetSize, string> = {
  sm: 'p-3',  // 12px — compact density
  md: 'p-4',  // 16px
  lg: 'p-6',  // 24px — comfortable density
};

export interface InsetProps extends React.HTMLAttributes<HTMLElement> {
  size?: InsetSize;
  as?: 'div' | 'section';
}

export function Inset({ size = 'md', as: Tag = 'div', className, ...props }: InsetProps) {
  const Component = Tag as 'div';
  return <Component className={clsx(SIZE_CLASS[size], className)} {...props} />;
}
