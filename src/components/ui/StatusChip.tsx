/**
 * StatusChip — docs/03 §3, docs/00 §2 semantic mapping.
 *
 * Every status in this product is a label + icon pair; color is decoration on top of
 * that, never the signal itself (docs/00 §3 "never rely on icons alone", docs/10 §4
 * "status is not conveyed by color alone"). `tone` picks the color from the design
 * tokens in globals.css — this file never introduces a hex value of its own.
 *
 * Props line up with `StatusDescriptor` in src/types/index.ts so a server-computed
 * status object can be spread straight in: `<StatusChip {...doc.approvalStatus} />`.
 */

import clsx from 'clsx';
import type { StatusDescriptor, StatusIconName, StatusTone } from '@/types';

/**
 * Tone styling.
 *
 * Two bugs were found here by measuring the rendered chip rather than reading the code:
 *
 *   1. **The tint never rendered.** `bg-action/10` and `border-action/25` silently
 *      produced `rgba(0,0,0,0)` and a default grey border. Tailwind cannot apply an
 *      opacity modifier to a colour defined as a bare `var(--x)` (it has no channels to
 *      re-compose), so every chip in the app was transparent with a grey outline — not
 *      the tinted pill docs/00 specifies. Fixed with explicit `color-mix()` in an
 *      arbitrary value, which works on a `var()` colour and needs no token changes.
 *
 *   2. **The label failed contrast.** Because the tint was absent, semantic text sat on
 *      plain white: amber 2.15:1 and red 3.76:1, both below AA's 4.5:1. Even over the
 *      intended 10% tint they would still fail. The label is now navy on every tone —
 *      the hue is carried by the tint, the border and the icon, which is exactly the
 *      docs/03 §2 / docs/10 §4 rule that colour is never the only status cue. Adds no
 *      colour outside the docs/00 §2 palette.
 */
const TONE_CLASSES: Record<StatusTone, string> = {
  // Normal / On time / Done / Approved / Cleared (docs/00 §2)
  positive:
    'bg-[color-mix(in_srgb,var(--color-action)_12%,transparent)] text-primary border-[color-mix(in_srgb,var(--color-action)_35%,transparent)]',
  // Informational / AI-generated / Processing
  info: 'bg-[color-mix(in_srgb,var(--color-info)_12%,transparent)] text-primary border-[color-mix(in_srgb,var(--color-info)_35%,transparent)]',
  // Watch / Due soon / Waiting / Partial
  warning:
    'bg-[color-mix(in_srgb,var(--color-warning)_12%,transparent)] text-primary border-[color-mix(in_srgb,var(--color-warning)_35%,transparent)]',
  // At risk / Blocked / Overdue / Rejected / Escalated
  critical:
    'bg-[color-mix(in_srgb,var(--color-critical)_12%,transparent)] text-primary border-[color-mix(in_srgb,var(--color-critical)_35%,transparent)]',
  // Neutral / Not started / Not applicable — "Navy at reduced emphasis"
  neutral:
    'bg-[color-mix(in_srgb,var(--color-primary)_6%,transparent)] text-[var(--color-text-secondary)] border-[color-mix(in_srgb,var(--color-primary)_15%,transparent)]',
};

/**
 * The icon carries the semantic hue — it is the colour cue that pairs with the label —
 * but at the AA-safe blend, not the raw palette value.
 *
 * A third bug, found by measuring icons rather than text: an icon is a *graphical
 * object* under WCAG 2.1 SC 1.4.11 and needs 3:1 against its backdrop, and the backdrop
 * here is the chip's own 12% tint of the same hue. Painting the raw hue on a tint of
 * itself is close to the worst case — the tint pulls the background toward the
 * foreground. Measured on the composited tints: teal 2.08:1, cyan 1.92:1, amber 1.96:1,
 * all failing (red passed at 3.23:1, but is moved too so the tones stay consistent).
 *
 * The `--color-*-text` tokens already exist for the labels and clear 3:1 on every tint
 * with margin (4.73-7.08:1), so this needs no new colour outside the docs/00 §2 palette.
 * Text contrast was already handled separately — the label is navy; this is only about
 * the icon glyph.
 */
const ICON_TONE_CLASSES: Record<StatusTone, string> = {
  positive: 'text-[var(--color-action-text)]',
  info: 'text-[var(--color-info-text)]',
  warning: 'text-[var(--color-warning-text)]',
  critical: 'text-[var(--color-critical-text)]',
  neutral: 'text-[var(--color-text-secondary)]',
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
        'inline-flex items-center rounded-full border font-medium leading-none',
        size === 'sm' ? 'gap-1 px-2 py-1 text-xs' : 'gap-1.5 px-2.5 py-1.5 text-sm',
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
