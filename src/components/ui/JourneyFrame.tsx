import clsx from 'clsx';
import { APERTURE, FRAME_STROKES } from '@/components/brand/BrandMark';

/**
 * The signature device — the deal's progress closes the mark.
 *
 * The logo is a square frame that closes. The product's core object, a deal, is a
 * sequence that progresses toward completion. So the eight strokes of the frame fill
 * clockwise from the top-left as the deal advances, and a deal that completes has drawn
 * the logo exactly.
 *
 * This is the one place seal appears at any size, which is what makes it read as the
 * brand rather than as decoration: complete strokes are ink, the stroke in progress is
 * seal, future strokes are `--line-strong`. The aperture in the centre stays grey until
 * the frame closes, then goes ink with it.
 *
 * It encodes something true — it is the completion state, not an ornament — which is the
 * whole test for whether a structural device earns its place.
 *
 * Progress maps onto eight strokes for any stage count: a 7-stage rail, an 8-state
 * lifecycle and a percentage all render on the same geometry, so the glyph means the
 * same thing in a deal table, an agent queue and the deal header.
 */

export interface JourneyFrameProps {
  /** Stages completed. Clamped into range. */
  value: number;
  /** Total stages. */
  total: number;
  size?: number;
  /** Screen-reader label. Defaults to "n of m stages complete". */
  label?: string;
  /** `inverse` for ink panels and the top bar, where ink-on-ink would vanish. */
  tone?: 'default' | 'inverse';
  className?: string;
}

const TONE = {
  default: { done: 'stroke-ink-900', future: 'stroke-line-strong', active: 'stroke-seal-600' },
  inverse: { done: 'stroke-bone', future: 'stroke-[color-mix(in_srgb,var(--bone)_25%,transparent)]', active: 'stroke-seal-500' },
} as const;

export function JourneyFrame({ value, total, size = 20, label, tone = 'default', className }: JourneyFrameProps) {
  const palette = TONE[tone];
  const safeTotal = Math.max(1, total);
  const clamped = Math.min(Math.max(value, 0), safeTotal);
  const fraction = clamped / safeTotal;

  // Round, not floor: at 1 of 7 the frame should show a stroke, and at 7 of 7 it must
  // show all eight or the "complete deal draws the logo" promise breaks.
  const filled = Math.round(fraction * FRAME_STROKES.length);
  const complete = clamped >= safeTotal;
  // The stroke currently being worked, drawn in seal — but only while there is one.
  const activeIndex = complete || filled === 0 ? -1 : filled - 1;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      strokeWidth={2.4}
      strokeLinecap="square"
      role="img"
      aria-label={label ?? `${clamped} of ${safeTotal} stages complete`}
      focusable="false"
      className={clsx('shrink-0', className)}
    >
      {FRAME_STROKES.map((d, index) => (
        <path
          key={d}
          d={d}
          className={
            index === activeIndex ? palette.active : index < filled ? palette.done : palette.future
          }
        />
      ))}
      <path
        d={APERTURE}
        strokeWidth={2.7}
        strokeLinecap="round"
        className={complete ? palette.done : palette.future}
      />
    </svg>
  );
}
