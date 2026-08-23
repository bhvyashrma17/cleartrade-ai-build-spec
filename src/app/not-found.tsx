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
import { BrandMark } from '@/components/brand/BrandMark';
import { buttonClass } from '@/components/ui/Button';
import { getPrincipal, homeRouteForRole } from '@/lib/auth';

export default async function NotFound() {
  const principal = await getPrincipal();
  const safeHref = principal ? homeRouteForRole(principal.role) : '/login';

  return (
    <main className="flex min-h-screen items-center justify-center bg-ground p-6">
      <section className="w-full max-w-md rounded-xl border border-line bg-surface p-8 text-center">
        <BrandMark size={30} className="mx-auto text-muted" />
        <h1 className="display mt-5 text-title-page text-bone">Not found</h1>
        <p className="mt-2 text-sm text-slate">
          This page is not available. It may have moved, or the link may be out of date.
        </p>
        <Link
          href={safeHref}
          className={buttonClass('primary', 'md', 'mt-6')}
        >
          {principal ? 'Back to your workspace' : 'Go to sign in'}
        </Link>
      </section>
    </main>
  );
}
