import clsx from 'clsx';
import type { InputHTMLAttributes } from 'react';

/**
 * Form field — label in the `label` token, 15px input text, seal focus ring, error below
 * the field with an icon so the failure is never carried by colour alone.
 *
 * The input text previously inherited `text-sm` at 14px while the surrounding body was
 * also 14px, so a filled field was typographically indistinguishable from the paragraph
 * next to it. Fields now sit a step above the label that names them.
 */

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  label?: string;
  /** Sub-label shown under the field when there is no error. */
  hint?: string;
}

export function Input({ className, error, id, label, hint, ...props }: InputProps) {
  const describedBy = id ? (error ? `${id}-error` : hint ? `${id}-hint` : undefined) : undefined;

  return (
    <label className="block">
      {label ? <span className="eyebrow mb-1.5 block text-ink-500">{label}</span> : null}
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={clsx(
          'block w-full rounded-sm border bg-card px-3 text-sm text-ink-900',
          'min-h-control placeholder:text-ink-300',
          'transition-colors duration-fast',
          error
            ? 'border-[var(--crit-fill)]'
            : 'border-line-strong hover:border-ink-300 focus:border-seal-600',
          className,
        )}
        {...props}
      />
      {error ? (
        <p
          id={id ? `${id}-error` : undefined}
          className="mt-1.5 flex items-start gap-1.5 text-xs text-[var(--crit-text)]"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            aria-hidden="true"
            className="mt-0.5 shrink-0"
          >
            <circle cx="8" cy="8" r="6.25" />
            <path d="M8 4.75v3.75" />
            <circle cx="8" cy="11.4" r="0.1" fill="currentColor" stroke="none" />
          </svg>
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={id ? `${id}-hint` : undefined} className="mt-1.5 text-xs text-ink-300">
          {hint}
        </p>
      ) : null}
    </label>
  );
}
