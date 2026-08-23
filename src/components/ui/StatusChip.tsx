/**
 * StatusChip — the product's one status treatment.
 *
 * Every status is a label + icon pair; colour is a third cue on top, never the signal
 * itself. That is what keeps the chip readable in greyscale, for a colour-blind reader,
 * and on a bad monitor — and it is required by docs/03 §2 and docs/10 §4.
 *
 * Three defects were fixed here by measuring the rendered chip rather than reading the
 * code, and each is a category worth recognising again:
 *
 *   1. **The tint never rendered.** `bg-action/10` produced `rgba(0,0,0,0)`. Tailwind
 *      cannot apply an opacity modifier to a colour defined as a bare `var(--x)` — it has
 *      no channels to re-compose — so every chip in the app was transparent with a grey
 *      outline. Tints come from pre-mixed `--*-tint` tokens now.
 *
 *   2. **The label failed contrast.** With the tint absent, semantic text sat on plain
 *      white at 2.15:1 (amber) and 3.76:1 (red).
 *
 *   3. **`positive` was violet**, because the tone read the accent token and the accent
 *      had been re-pointed. Status hues are their own tokens now and cannot be moved by
 *      an accent change again.
 *
 * The chip is square-cornered. The mark has no curves in it; a pill is the one shape in
 * this system that belongs to somebody else's product.
 *
 * Props line up with `StatusDescriptor` in src/types/index.ts so a server-computed status
 * can be spread straight in: `<StatusChip {...doc.approvalStatus} />`.
 */

import clsx from 'clsx';
import type { StatusDescriptor, StatusIconName, StatusTone } from '@/types';

/** Ground + label. Border is the hue at 28%, which reads as an edge without becoming a
 *  second colour. Each label clears AA on its own tint. */
const TONE_CLASSES: Record<StatusTone, string> = {
  positive: 'bg-[var(--ok-tint)] text-[var(--ok)] border-[color-mix(in_srgb,var(--ok)_28%,transparent)]',
  info: 'bg-[var(--info-tint)] text-[var(--info)] border-[color-mix(in_srgb,var(--info)_28%,transparent)]',
  warning: 'bg-[var(--warn-tint)] text-[var(--warn)] border-[color-mix(in_srgb,var(--warn)_28%,transparent)]',
  critical: 'bg-[var(--crit-tint)] text-[var(--crit)] border-[color-mix(in_srgb,var(--crit)_28%,transparent)]',
  neutral: 'bg-surface-2 text-slate border-line-strong',
};

/** The icon carries the hue at full strength. It is a graphical object under WCAG 2.1
 *  SC 1.4.11 and needs 3:1 against its own backdrop — which here is a 14% tint of itself,
 *  close to the worst case, so it is measured rather than assumed. */
const ICON_TONE_CLASSES: Record<StatusTone, string> = {
  positive: 'text-[var(--ok)]',
  info: 'text-[var(--info)]',
  warning: 'text-[var(--warn)]',
  critical: 'text-[var(--crit)]',
  neutral: 'text-muted',
};

const ICON_PATHS: Record<StatusIconName, React.ReactNode> = {
  check: <path d="M3 8.5 6.5 12 13 4" />,
  clock: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 4.75V8l2.5 1.5" />
    </>
  ),
  alert: (
    <>
      <path d="M8 2.5 14.5 13.5H1.5Z" />
      <path d="M8 6.5v3" />
      <circle cx="8" cy="11.5" r="0.1" fill="currentColor" stroke="none" />
    </>
  ),
  block: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M3.8 3.8 12.2 12.2" />
    </>
  ),
  spark: <path d="M8 2v3M8 11v3M2 8h3M11 8h3M4.3 4.3l2 2M9.7 9.7l2 2M4.3 11.7l2-2M9.7 6.3l2-2" />,
  dot: <circle cx="8" cy="8" r="3" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <path d="M5.5 4v8" />
      <path d="M10.5 4v8" />
    </>
  ),
  x: <path d="M4 4l8 8M12 4l-8 8" />,
};

function StatusIcon({ name, size }: { name: StatusIconName; size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

export interface StatusChipProps extends StatusDescriptor {
  size?: 'sm' | 'md';
  className?: string;
}

export function StatusChip({ label, tone, icon, detail, size = 'md', className }: StatusChipProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-sm border font-medium leading-none',
        size === 'sm' ? 'gap-1 px-1.5 py-1 text-xs' : 'gap-1.5 px-2 py-1.5 text-xs',
        TONE_CLASSES[tone],
        className,
      )}
      title={detail}
    >
      <span className={ICON_TONE_CLASSES[tone]}>
        <StatusIcon name={icon} size={size === 'sm' ? 12 : 14} />
      </span>
      <span>{label}</span>
      {detail ? <span className="sr-only"> — {detail}</span> : null}
    </span>
  );
}
