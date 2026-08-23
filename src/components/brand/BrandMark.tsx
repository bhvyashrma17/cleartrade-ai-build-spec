import clsx from 'clsx';

/**
 * The ClearTrade mark.
 *
 * A square registration frame — four corner brackets and four cardinal ticks — enclosing
 * an open "C". It reads as a customs stamp, a die, a seal: an instrument of record, not a
 * tech logo. The frame's geometry is shared with `JourneyFrame`, where the same eight
 * strokes close one at a time as a deal progresses, so a completed deal literally draws
 * the logo.
 *
 * Drawn in `currentColor` and never given a colour of its own, so one component serves
 * bone-on-ink chrome, ink-on-paper page furniture, and inherited-colour inline use.
 */

/** The eight strokes of the frame, clockwise from the top-left corner. Shared with
 *  JourneyFrame — change the geometry in one place or the two marks drift apart. */
export const FRAME_STROKES = [
  'M3 11V3h8',        // corner, top-left
  'M14.2 3h3.6',      // tick, top
  'M21 3h8v8',        // corner, top-right
  'M29 14.2v3.6',     // tick, right
  'M29 21v8h-8',      // corner, bottom-right
  'M17.8 29h-3.6',    // tick, bottom
  'M11 29H3v-8',      // corner, bottom-left
  'M3 17.8v-3.6',     // tick, left
] as const;

/** The nested open "C". Radius 7 about the centre, open to the right through 90°. */
export const APERTURE = 'M20.95 11.05A7 7 0 1 0 20.95 20.95';

export function BrandMark({
  size = 24,
  className,
  title,
}: {
  size?: number;
  className?: string;
  /** Give the mark an accessible name only where it stands alone. Beside a visible
   *  wordmark it is decorative, and a second announcement is noise for a screen reader. */
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="square"
      strokeLinejoin="miter"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      className={clsx('shrink-0', className)}
    >
      {title ? <title>{title}</title> : null}
      <path d={FRAME_STROKES.join(' ')} />
      <path d={APERTURE} strokeWidth={2.7} strokeLinecap="round" />
    </svg>
  );
}
