import clsx from 'clsx';
import { BrandMark } from './BrandMark';

/**
 * The lockup: mark + wordmark, optionally + tagline.
 *
 * The wordmark is set in the display Didone rather than traced from the logo's outlines,
 * so it stays selectable text, scales with the viewer's font settings, and matches every
 * page display — the name and the page titles are deliberately one voice.
 *
 * The tagline is the brand's own line and is the best sentence anyone has written for this
 * product. It appears on signed-out surfaces where there is room for it, never in app
 * chrome.
 */

const SIZES = {
  sm: { mark: 20, word: 'text-[1.0625rem]', gap: 'gap-2' },
  md: { mark: 26, word: 'text-[1.375rem]', gap: 'gap-2.5' },
  lg: { mark: 40, word: 'text-[2.125rem]', gap: 'gap-3.5' },
} as const;

export function Wordmark({
  size = 'md',
  showMark = true,
  tagline = false,
  className,
}: {
  size?: keyof typeof SIZES;
  showMark?: boolean;
  tagline?: boolean;
  className?: string;
}) {
  const s = SIZES[size];

  return (
    <span className={clsx('inline-flex items-center', s.gap, className)}>
      {showMark ? <BrandMark size={s.mark} /> : null}
      <span className="inline-flex flex-col">
        <span className={clsx('display leading-none tracking-[-0.01em]', s.word)}>ClearTrade</span>
        {tagline ? (
          <span className="mt-1.5 text-label text-muted">Structured exports. Zero chaos.</span>
        ) : null}
      </span>
    </span>
  );
}
