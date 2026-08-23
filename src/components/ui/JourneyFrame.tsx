import clsx from 'clsx';
import { APERTURE, FRAME_SEGMENTS, MARK_VIEWBOX, NOTCHES } from '@/components/brand/BrandMark';

/**
 * The signature device — a deal's progress closes the mark.
 *
 * The logo is a square frame around a bracket. A deal is a sequence that closes. So the
 * frame's eight segments fill clockwise as stages complete, and a finished deal has drawn
 * the logo exactly. The bracket at the centre is always present — it is the record being
 * framed; the frame is how far along it is.
 *
 * This is the one place the accent appears at size, which is what makes it read as the
 * brand rather than as decoration: done segments are bone (or ink), the segment in flight
 * is accent, and future segments sit at low opacity.
 *
 * It passes the only test a structural device has to pass — it encodes something true. It
 * is the completion state, not an ornament.
 *
 * Progress maps onto eight segments for any stage count, so a 7-stage rail, an 8-state
 * lifecycle and a bare percentage all render on identical geometry. The glyph means the
 * same thing in a deal table, an agent queue, and the deal header.
 */

export interface JourneyFrameProps {
  /** Stages completed. Clamped into range. */
  value: number;
  /** Total stages. */
  total: number;
  size?: number;
  /** Screen-reader label. Defaults to "n of m stages complete". */
  label?: string;
  className?: string;
}

export function JourneyFrame({ value, total, size = 24, label, className }: JourneyFrameProps) {
  const safeTotal = Math.max(1, total);
  const clamped = Math.min(Math.max(value, 0), safeTotal);

  // Round, not floor: at 1 of 7 the frame must show a segment, and at 7 of 7 it must show
  // all eight or the "a finished deal draws the logo" promise breaks.
  const filled = Math.round((clamped / safeTotal) * FRAME_SEGMENTS.length);
  const complete = clamped >= safeTotal;
  const activeIndex = complete || filled === 0 ? -1 : filled - 1;

  return (
    <svg
      width={size}
      height={size}
      viewBox={MARK_VIEWBOX}
      fill="currentColor"
      role="img"
      aria-label={label ?? `${clamped} of ${safeTotal} stages complete`}
      focusable="false"
      className={clsx('shrink-0', className)}
    >
      {FRAME_SEGMENTS.map((r, index) => (
        <rect
          key={`f${index}`}
          {...r}
          className={index === activeIndex ? 'fill-accent' : undefined}
          opacity={index === activeIndex ? 1 : index < filled ? 1 : 0.18}
        />
      ))}
      {NOTCHES.map((r, index) => (
        <rect key={`n${index}`} {...r} opacity={complete ? 1 : 0.18} />
      ))}
      {APERTURE.map((r, index) => (
        <rect key={`a${index}`} {...r} opacity={0.55} />
      ))}
    </svg>
  );
}
