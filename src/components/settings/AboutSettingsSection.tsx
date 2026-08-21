import Link from 'next/link';

export function AboutSettingsSection({ reportBugHref }: { reportBugHref: string }) {
  return (
    <section id="about" className="scroll-mt-20 rounded-lg border border-[var(--color-border)] bg-surface p-2 shadow-card">
      <h2 className="px-4 pb-2 pt-3 text-lg font-semibold text-primary">About</h2>
      <Link href={reportBugHref} className="focus-visible-ring flex min-h-16 items-center justify-between gap-4 rounded px-4 py-3 hover:bg-surface-muted">
        <span><span className="block font-medium text-primary">Report a bug</span><span className="mt-0.5 block text-sm text-[var(--color-text-secondary)]">Tell us what went wrong.</span></span>
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="m6 3.5 4.5 4.5L6 12.5" /></svg>
      </Link>
    </section>
  );
}
