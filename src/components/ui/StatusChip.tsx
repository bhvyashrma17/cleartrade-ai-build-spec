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

const TONE_CLASSES: Record<StatusTone, string> = {
  // Normal / On time / Done / Approved / Cleared (docs/00 §2)
  positive: 'bg-action/10 text-action border-action/25',
  // Informational / AI-generated / Processing
  info: 'bg-info/10 text-info border-info/25',
  // Watch / Due soon / Waiting / Partial
  warning: 'bg-warning/10 text-warning border-warning/25',
  // At risk / Blocked / Overdue / Rejected / Escalated
  critical: 'bg-critical/10 text-critical border-critical/25',
  // Neutral / Not started / Not applicable — "Navy at reduced emphasis"
  neutral: 'bg-primary/5 text-[var(--color-text-secondary)] border-primary/10',
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
      <StatusIcon name={icon} size={size === 'sm' ? 12 : 14} />
      <span>{label}</span>
      {detail ? <span className="sr-only"> — {detail}</span> : null}
    </span>
  );
}
