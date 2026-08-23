import clsx from 'clsx';
import { BrandMark } from './BrandMark';

/**
 * The lockup: mark + wordmark.
 *
 * The wordmark is set in the display serif — the same face as every page masthead — which
 * is the point. Before this, the top-left of every screen in the product was the string
 * "ClearTrade AI" in bold interface sans: the strongest brand asset in the product,
 * rendered as a UI label. The "AI" rides behind it as a tracked slate label rather than
 * matching the wordmark, so the name reads as ClearTrade and the qualifier stays a
 * qualifier.
 */

export function Wordmark({
  size = 'md',
  tone = 'ink',
  showMark = true,
  className,
}: {
  size?: 'sm' | 'md' | 'lg';
  /** `bone` on ink chrome, `ink` on paper. */
  tone?: 'ink' | 'bone';
  showMark?: boolean;
  className?: string;
}) {
  const markSize = size === 'lg' ? 34 : size === 'md' ? 24 : 20;
  const wordSize = size === 'lg' ? 'text-[1.75rem]' : size === 'md' ? 'text-[1.25rem]' : 'text-[1.0625rem]';

  return (
    <span className={clsx('inline-flex items-center', size === 'lg' ? 'gap-3' : 'gap-2.5', className)}>
      {showMark ? (
        <BrandMark size={markSize} className={tone === 'bone' ? 'text-bone' : 'text-ink-900'} />
      ) : null}
      <span className="inline-flex items-baseline gap-1.5">
        <span
          className={clsx(
            'masthead leading-none',
            wordSize,
            tone === 'bone' ? 'text-bone' : 'text-ink-900',
          )}
        >
          ClearTrade
        </span>
        <span
          className={clsx(
            'text-label leading-none',
            tone === 'bone' ? 'text-slate' : 'text-ink-300',
          )}
        >
          AI
        </span>
      </span>
    </span>
  );
}
