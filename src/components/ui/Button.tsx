import type { ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: 'bg-action text-primary hover:brightness-95',
  secondary: 'border border-[var(--color-border-strong)] bg-surface text-primary hover:bg-surface-muted',
  ghost: 'text-white hover:bg-white/10',
};

export function Button({ className = '', variant = 'primary', type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={`focus-visible-ring inline-flex min-h-10 items-center justify-center rounded px-4 text-sm font-semibold transition duration-fast disabled:cursor-not-allowed disabled:opacity-60 ${variantClass[variant]} ${className}`}
      {...props}
    />
  );
}
