/**
 * StatusChip — the product's one status treatment.
 *
 * Every status is a label + icon pair; colour is a third cue layered on top, never the
 * signal itself. That rule is why the chip survives greyscale printing, colour-blind
 * viewers and a bad monitor, and it is required by docs/03 §2 and docs/10 §4.
 *
 * Three defects were fixed here by measuring the rendered chip rather than reading the
 * code, and the shape of each is worth keeping in view:
 *
 *   1. **The tint never rendered.** `bg-action/10` produced `rgba(0,0,0,0)`. Tailwind
 *      cannot apply an opacity modifier to a colour defined as a bare `var(--x)` — it has
 *      no channels to re-compose — so every chip in the app was transparent with a grey
 *      outline. Tints now come from the pre-mixed `--*-tint` tokens.
 *
 *   2. **The label failed contrast.** With the tint absent, semantic text sat on plain
 *      white at 2.15:1 (amber) and 3.76:1 (red). The interim fix set every label to navy,
 *      which cleared AA but flattened all five tones into one. Now that the tints render,
 *      each label uses its own AA-safe `--*-text` value: 6.6:1 (ok), 6.9:1 (info),
 *      5.9:1 (warn), 7.2:1 (crit) measured against their own tints.
 *
 *   3. **`positive` was violet.** The tone read `--color-action`, which was repointed
 *      from teal to seal violet during the palette move — so "Approved", "Cleared" and
 *      "On time" rendered in the brand accent while nothing in the product was green.
 *      Status hues are now their own tokens and can never be re-pointed by an accent
 *      change again.
 *
 * The chip is square-cornered, not a pill. The mark has hard corners; a stamp is a
 * rectangle. It is a small thing that does a lot of work to stop the product looking like
 * every other dashboard.
 *
 * Props line up with `StatusDescriptor` in src/types/index.ts so a server-computed status
 * object can be spread straight in: `<StatusChip {...doc.approvalStatus} />`.
 */

import clsx from 'clsx';
import type { StatusDescriptor, StatusIconName, StatusTone } from '@/types';

/** Ground + label. The border is the fill at 30%, which reads as an edge without
 *  becoming a second colour. */
const TONE_CLASSES: Record<StatusTone, string> = {
  // Normal / On time / Done / Approved / Cleared
  positive:
    'bg-[var(--ok-tint)] text-[var(--ok-text)] border-[color-mix(in_srgb,var(--ok-fill)_30%,transparent)]',
  // Informational / AI-generated / Processing
  info: 'bg-[var(--info-tint)] text-[var(--info-text)] border-[color-mix(in_srgb,var(--info-fill)_30%,transparent)]',
  // Watch / Due soon / Waiting / Partial
  warning:
    'bg-[var(--warn-tint)] text-[var(--warn-text)] border-[color-mix(in_srgb,var(--warn-fill)_30%,transparent)]',
  // At risk / Blocked / Overdue / Rejected / Escalated
  critical:
    'bg-[var(--crit-tint)] text-[var(--crit-text)] border-[color-mix(in_srgb,var(--crit-fill)_30%,transparent)]',
  // Neutral / Not started / Not applicable
  neutral: 'bg-paper-sunk text-ink-500 border-line-strong',
};

/**
 * The icon carries the saturated hue — it is a graphical object under WCAG 2.1 SC 1.4.11
 * and needs 3:1 against its own backdrop, which here is a 9% tint of the same colour.
 * Measured on the composited tints: 4.5:1 (ok), 4.9:1 (info), 3.6:1 (warn), 5.5:1 (crit).
 */
const ICON_TONE_CLASSES: Record<StatusTone, string> = {
  positive: 'text-[var(--ok-fill)]',
  info: 'text-[var(--info-fill)]',
  warning: 'text-[var(--warn-fill)]',
  critical: 'text-[var(--crit-fill)]',
  neutral: 'text-ink-300',
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
        'inline-flex items-center rounded-sm border font-semibold leading-none',
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
