import clsx from 'clsx';
import type { InputHTMLAttributes } from 'react';

/**
 * Form field. Label in the tracked `eyebrow` treatment, field one step lighter than the
 * panel it sits in so it reads as somewhere you can type, accent focus ring, and an error
 * below the field carrying an icon — so a failed field is never signalled by colour alone.
 */

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  label?: string;
  /** Shown under the field when there is no error. */
  hint?: string;
}

export function Input({ className, error, id, label, hint, ...props }: InputProps) {
  const describedBy = id ? (error ? `${id}-error` : hint ? `${id}-hint` : undefined) : undefined;

  return (
    <label className="block">
      {label ? <span className="eyebrow mb-2 block">{label}</span> : null}
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={clsx(
          'block min-h-control w-full rounded-md border bg-surface-2 px-3 text-sm text-bone',
          'transition-colors duration-fast placeholder:text-muted',
          error
            ? 'border-[color-mix(in_srgb,var(--crit)_55%,transparent)]'
            : 'border-line-strong hover:border-faint focus:border-accent',
          className,
        )}
        {...props}
      />
      {error ? (
        <p id={id ? `${id}-error` : undefined} className="mt-2 flex items-start gap-1.5 text-xs text-[var(--crit)]">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden="true" className="mt-0.5 shrink-0">
            <circle cx="8" cy="8" r="6.25" />
            <path d="M8 4.75v3.75" />
            <circle cx="8" cy="11.4" r="0.1" fill="currentColor" stroke="none" />
          </svg>
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={id ? `${id}-hint` : undefined} className="mt-2 text-xs text-muted">{hint}</p>
      ) : null}
    </label>
  );
}
