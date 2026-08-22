import Link from 'next/link';

/**
 * The honest state for a workspace tab route that exists (so deep links resolve) but
 * has no content behind it yet. AGENTS.md: don't hide an unbuilt surface behind a fake
 * nav item, and don't stub it with content that looks real — say plainly what's missing.
 */
export function NotBuiltYet({ tabLabel, backHref }: { tabLabel: string; backHref: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--color-border-strong)] bg-surface p-8 text-center">
      <p className="text-sm font-normal text-primary">{tabLabel} isn&apos;t built yet.</p>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
        This tab has a real route so a deep link never 404s, but there is no {tabLabel.toLowerCase()} content
        behind it yet.
      </p>
      <Link href={backHref} className="mt-3 inline-block text-sm font-medium text-primary underline underline-offset-2">
        Back to Overview
      </Link>
    </div>
  );
}
