import type { InputHTMLAttributes } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  label?: string;
}

export function Input({ className = '', error, id, label, ...props }: InputProps) {
  return (
    <label className={label ? 'block text-sm font-medium text-primary' : undefined}>
      {label ? <span className="mb-1 block">{label}</span> : null}
      <input
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={error && id ? `${id}-error` : undefined}
        className={`focus-visible-ring block w-full rounded border bg-surface px-3 py-2 text-sm text-primary shadow-sm placeholder:text-[var(--color-text-muted)] ${error ? 'border-critical' : 'border-[var(--color-border-strong)]'} ${className}`}
        {...props}
      />
      {error ? <p id={id ? `${id}-error` : undefined} className="mt-1 text-sm text-critical">{error}</p> : null}
    </label>
  );
}
