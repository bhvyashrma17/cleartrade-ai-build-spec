/**
 * docs/03 §7 404 state: "Not found or unavailable; provide a safe return path."
 *
 * Next.js renders this for any URL that matches no route, and it's also the target
 * of a page-level `notFound()` call (from 'next/navigation' — distinct from the
 * ApiError-based `notFound()` in src/lib/errors.ts, which builds the JSON envelope
 * for /api/v1 route handlers instead). No object details are ever available here to
 * leak, by construction.
 */

import Link from 'next/link';
import { getPrincipal, homeRouteForRole } from '@/lib/auth';

export default async function NotFound() {
  const principal = await getPrincipal();
  const safeHref = principal ? homeRouteForRole(principal.role) : '/login';

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-muted p-6">
      <section className="w-full max-w-md rounded-lg bg-surface p-8 text-center shadow-card">
        <h1 className="text-xl font-semibold text-primary">Not found</h1>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          This page is not available. It may have moved, or the link may be out of date.
        </p>
        <Link
          href={safeHref}
          className="mt-6 inline-flex min-h-10 items-center justify-center rounded bg-action px-4 text-sm font-semibold text-primary transition duration-fast hover:brightness-95"
        >
          {principal ? 'Back to your workspace' : 'Go to sign in'}
        </Link>
      </section>
    </main>
  );
}
