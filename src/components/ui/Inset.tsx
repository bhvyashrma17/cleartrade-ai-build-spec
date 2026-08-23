import clsx from 'clsx';

/**
 * Padding, off the one spacing scale.
 *
 * The audit found 38 distinct padding values in the product. The fix for that is not
 * discipline, it is removing the opportunity — so these three sizes resolve to CSS
 * variables the shell re-points per density, which means a card is comfortable in the
 * exporter portal and compact in Ops without a single call site knowing about it.
 */

export type InsetSize = 'sm' | 'md' | 'lg';

const SIZE_CLASS: Record<InsetSize, string> = {
  sm: 'p-inset-sm',
  md: 'p-inset-md',
  lg: 'p-inset-lg',
};

export interface InsetProps extends React.HTMLAttributes<HTMLElement> {
  size?: InsetSize;
  as?: 'div' | 'section';
}

export function Inset({ size = 'md', as: Tag = 'div', className, ...props }: InsetProps) {
  const Component = Tag as 'div';
  return <Component className={clsx(SIZE_CLASS[size], className)} {...props} />;
}
