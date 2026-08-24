import clsx from 'clsx';
import type { ButtonHTMLAttributes } from 'react';

/**
 * The one button.
 *
 * On a dark ground the highest-contrast thing available is *light*, so primary inverts:
 * bone fill, ground text. It reads as the brightest object on the screen without needing
 * a colour, which is what keeps the accent free to mean one thing (see `accent`, reserved
 * for a single hero CTA per surface) and keeps colour meaningful for status everywhere
 * else.
 *
 * `buttonClass()` is exported because roughly a third of this product's "buttons" are
 * `<Link>`s. Without it those call sites re-derive the recipe by hand, which is how the
 * codebase ended up with two button implementations in the first place.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
export type ButtonSize = 'md' | 'sm';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'border border-bone bg-bone text-ground hover:bg-white hover:border-white',
  secondary: 'border border-line-strong bg-surface-2 text-bone hover:bg-surface-3 hover:border-faint',
  ghost: 'border border-transparent bg-transparent text-muted hover:bg-surface-2 hover:text-bone',
  // Never a solid red fill: a destructive action should read as serious, not as an
  // emergency, and a filled red button beside a red status chip is one colour saying two
  // different things.
  danger:
    'border border-[color-mix(in_srgb,var(--crit)_40%,transparent)] bg-[var(--crit-tint)] text-[var(--crit)] hover:bg-[color-mix(in_srgb,var(--crit)_22%,var(--surface))]',
  accent: 'border border-accent bg-accent text-ground hover:bg-accent-dim hover:border-accent-dim',
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  md: 'min-h-control px-4 text-sm',
  // `sm` is a DENSITY choice, not a touch choice. On a pointer it can be 32px; under a
  // thumb it cannot, and `min-h-8` is a literal so the mobile `--control-h` override in
  // globals.css never reached it. 44px below `md`, unchanged from `md` up.
  sm: 'min-h-11 px-3 text-xs md:min-h-8',
};

export function buttonClass(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className?: string,
) {
  return clsx(
    'focus-visible-ring inline-flex items-center justify-center gap-2 rounded-md font-medium',
    'transition-colors duration-fast ease-out',
    // A disabled control gets its own flat treatment rather than reduced opacity on the
    // variant fill: a half-transparent bone button renders as a solid grey slab with
    // washed text, which reads as an enabled button someone got the colour wrong on.
    'disabled:border-line disabled:bg-surface-2 disabled:text-muted disabled:cursor-not-allowed',
    'aria-disabled:border-line aria-disabled:bg-surface-2 aria-disabled:text-muted aria-disabled:cursor-not-allowed',
    VARIANT_CLASS[variant],
    SIZE_CLASS[size],
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ className, variant = 'primary', size = 'md', type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}
