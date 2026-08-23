import clsx from 'clsx';

/**
 * The ClearTrade mark — geometry taken verbatim from `brand-logo.svg`.
 *
 * A solid square frame, notched at all four cardinal points, enclosing a nested square
 * bracket that opens to the right. Every stroke is a rectangle: there is not one curve in
 * the mark, which is the whole character of it — this is a drawing instrument, a register,
 * a frame around a record. The product's layout borrows the same idea (§ docs/ui-design).
 *
 * Do not redraw this by eye. An earlier pass invented a round-cornered "C" from a written
 * description of the logo and it was wrong in the way that matters: the real mark is
 * orthogonal, and the roundness read as a generic app icon.
 *
 * Everything is `currentColor`, so one component serves bone-on-ink chrome, ink-on-paper
 * print, and inherited-colour inline use.
 */

/** Outer frame, as 8 fillable segments running clockwise from the top-left. Split at each
 *  cardinal notch so `JourneyFrame` can close them one at a time. */
export const FRAME_SEGMENTS = [
  { x: 0, y: 0, width: 47.71, height: 9 },           // top, left half
  { x: 47.71, y: 0, width: 47.71, height: 9 },      // top, right half
  { x: 86.42, y: 0, width: 9, height: 47.55 },      // right, top half
  { x: 86.42, y: 47.55, width: 9, height: 47.54 },  // right, bottom half
  { x: 47.71, y: 86.09, width: 47.71, height: 9 },  // bottom, right half
  { x: 0, y: 86.09, width: 47.71, height: 9 },      // bottom, left half
  { x: 0, y: 47.55, width: 9, height: 47.54 },      // left, bottom half
  { x: 0, y: 0, width: 9, height: 47.55 },          // left, top half
] as const;

/** The cardinal notches that break the frame. Three, not four: the right edge has
 *  none, because that is where the bracket opens. */
export const NOTCHES = [
  { x: 9, y: 45.2625, width: 13.287, height: 4.56741 },        // left
  { x: 45.4261, y: 9, width: 4.56741, height: 13.287 },        // top
  { x: 45.4261, y: 72.8053, width: 4.56741, height: 13.287 },  // bottom
] as const;

/** The nested bracket — the "C". Open to the right between y 37.7 and y 57.6. */
export const APERTURE = [
  { x: 22.287, y: 21.5745, width: 47.1193, height: 4.2856 },   // top arm
  { x: 22.287, y: 68.5197, width: 47.1193, height: 4.2856 },   // bottom arm
  { x: 22.287, y: 25.8601, width: 3.59573, height: 42.5824 },  // spine
  { x: 69.4063, y: 21.5745, width: 3.59573, height: 16.1257 }, // top return
  { x: 69.4063, y: 57.5917, width: 3.59573, height: 15.2136 }, // bottom return
] as const;

export const MARK_VIEWBOX = '0 0 95.42 95.09';

export function BrandMark({
  size = 24,
  className,
  title,
}: {
  size?: number;
  className?: string;
  /** Name it only where it stands alone. Beside a visible wordmark it is decorative, and
   *  a second announcement is noise for a screen reader. */
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={MARK_VIEWBOX}
      fill="currentColor"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      className={clsx('shrink-0', className)}
    >
      {title ? <title>{title}</title> : null}
      {FRAME_SEGMENTS.map((r, i) => (
        <rect key={`f${i}`} {...r} />
      ))}
      {NOTCHES.map((r, i) => (
        <rect key={`n${i}`} {...r} />
      ))}
      {APERTURE.map((r, i) => (
        <rect key={`a${i}`} {...r} />
      ))}
    </svg>
  );
}
