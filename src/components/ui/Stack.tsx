import clsx from 'clsx';

/**
 * Vertical rhythm, off the one spacing scale — the replacement for `mt-1` on every
 * sibling, which the audit counted 367 times. Density-aware like `Inset`.
 */

export type StackGap = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const GAP_CLASS: Record<StackGap, string> = {
  xs: 'gap-stack-xs',
  sm: 'gap-stack-sm',
  md: 'gap-stack-md',
  lg: 'gap-stack-lg',
  xl: 'gap-stack-xl',
};

export interface StackProps extends React.HTMLAttributes<HTMLElement> {
  gap?: StackGap;
  as?: 'div' | 'section' | 'ul' | 'ol';
}

export function Stack({ gap = 'md', as: Tag = 'div', className, ...props }: StackProps) {
  const Component = Tag as 'div';
  return <Component className={clsx('flex flex-col', GAP_CLASS[gap], className)} {...props} />;
}
