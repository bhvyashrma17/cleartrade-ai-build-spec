import clsx from 'clsx';
import type { ButtonHTMLAttributes } from 'react';

/**
 * The one button.
 *
 * **Primary is ink, not the accent.** That is the rule the rest of the colour system
 * hangs off: if buttons were seal, colour in this product would mean "clickable" in one
 * place and "at risk" in another, and a violet CTA would compete with every warning on
 * the screen. Ink primary keeps colour meaningful everywhere else.
 *
 * It is also the fix for a live defect. `primary` was `bg-action text-primary`, and once
 * `--color-action` was repointed from teal to seal violet, every primary button in the
 * product rendered near-black text on dark violet — around 1.6:1, illegible. The landing
 * page CTA, the upgrade buttons and the bug-report submit were all in that state.
 *
 * `buttonClass()` is exported because roughly a third of the product's "buttons" are
 * `<Link>`s. Without it those call sites re-derive the recipe by hand, which is exactly
 * how the product ended up with two button implementations to begin with.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'inverse';
export type ButtonSize = 'md' | 'sm';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    'bg-ink-900 text-bone border border-ink-900 hover:bg-ink-700 hover:border-ink-700 active:bg-ink-900',
  secondary:
    'bg-card text-ink-900 border border-line-strong hover:bg-paper hover:border-ink-300',
  ghost:
    'bg-transparent text-ink-500 border border-transparent hover:bg-paper-sunk hover:text-ink-900',
  // Never a solid red fill: a destructive action should read as serious, not as an
  // emergency, and a solid #C0271D button next to a red error chip is two different
  // meanings in one colour.
  danger:
    'bg-[var(--crit-tint)] text-[var(--crit-text)] border border-[color-mix(in_srgb,var(--crit-fill)_45%,transparent)] hover:bg-[color-mix(in_srgb,var(--crit-fill)_15%,var(--card))]',
  // For ink chrome — the top bar and dark panels.
  inverse:
    'bg-bone text-ink-900 border border-bone hover:bg-white',
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  md: 'min-h-control px-4 text-sm',
  sm: 'min-h-8 px-3 text-xs',
};

export function buttonClass(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className?: string,
) {
  return clsx(
    'focus-visible-ring inline-flex items-center justify-center gap-2 rounded-lg font-semibold',
    'transition-colors duration-fast ease-out',
    // A disabled control gets its own flat treatment rather than 50% opacity on the
    // variant's fill: a half-transparent ink button renders as a solid mid-grey slab with
    // washed-out text, which reads as an enabled button someone got the colour wrong on.
    'disabled:border-line disabled:bg-paper-sunk disabled:text-ink-300 disabled:cursor-not-allowed',
    'aria-disabled:border-line aria-disabled:bg-paper-sunk aria-disabled:text-ink-300 aria-disabled:cursor-not-allowed',
    VARIANT_CLASS[variant],
    SIZE_CLASS[size],
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({
  className,
  variant = 'primary',
  size = 'md',
  type = 'button',
  ...props
}: ButtonProps) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}
