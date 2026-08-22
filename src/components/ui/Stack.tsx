import clsx from 'clsx';

/**
 * docs/27-ui-redesign.md §5.1 — vertical rhythm, off the six-step scale, replacing
 * sibling `mt-*` on every child. Not migrated everywhere yet (367 sites); this
 * establishes the primitive and the pattern for the components that adopt it now.
 */

export type StackGap = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const GAP_CLASS: Record<StackGap, string> = {
  xs: 'space-y-1', // 4px
  sm: 'space-y-3', // 12px
  md: 'space-y-4', // 16px
  lg: 'space-y-6', // 24px
  xl: 'space-y-8', // 32px
};

export interface StackProps extends React.HTMLAttributes<HTMLElement> {
  gap?: StackGap;
  as?: 'div' | 'section' | 'ul' | 'ol';
}

export function Stack({ gap = 'md', as: Tag = 'div', className, ...props }: StackProps) {
  const Component = Tag as 'div';
  return <Component className={clsx(GAP_CLASS[gap], className)} {...props} />;
}
