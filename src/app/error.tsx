'use client';

/**
 * Shared app-level error boundary — the 5xx / "something unexpected happened" bucket
 * of docs/03 §7.
 *
 * This is deliberately NOT where 403/404/409/429 get classified. React strips a
 * thrown error down to `{ digest }` only (not even `message` survives — verified
 * against a production build) once it crosses the Server Component -> Client
 * boundary into a file like this one. `error.code` / `error.status` from
 * src/lib/errors.ts's `ApiError` are therefore always `undefined` here in
 * production, so branching on them would silently never fire and this boundary
 * would lie about handling states it structurally cannot see.
 *
 * Each of those states instead gets handled at the point where the real error
 * object is still intact, server-side, before that boundary is crossed:
 *   - 401/403 — caught in each portal layout (src/app/app|agent|ops/layout.tsx),
 *     which redirects to /login or renders `AccessDenied` with the real message.
 *   - 404 — src/app/not-found.tsx (Next's dedicated mechanism, not a thrown Error).
 *   - 409/429 — currently only ever produced by /api/v1/* route handlers, consumed
 *     by client components via src/lib/api-client.ts, which already catch
 *     `ApiClientError` inline (see BuyersExplorer.tsx / OutreachPipeline.tsx) — that
 *     catch also never crosses the RSC boundary, so it keeps the real `.code`.
 *
 * What lands here is the genuine 5xx case: an unexpected crash. `digest` is the
 * "correlation/reference ID" docs/03 §7 asks for for that state.
 */

import { useEffect } from 'react';
import { BrandMark } from '@/components/brand/BrandMark';
import { Button } from '@/components/ui';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper p-6">
      <section className="w-full max-w-lg rounded-xl border border-line bg-card p-8 text-center">
        <BrandMark size={30} className="mx-auto text-ink-300" />
        <h1 className="masthead mt-5 text-title-page text-ink-900">Something went wrong</h1>
        <p className="mt-3 text-sm text-ink-500">
          We could not complete that request. Please try again. If this continues, share the
          reference ID below with ClearTrade support.
        </p>
        {/* The reference ID is an instrument of record — the number a person reads down
            the phone to support — so it is set in the `record` face like every other
            reference in the product, not in body sans where digits blur together. */}
        {error.digest ? (
          <p className="mt-4 text-xs text-ink-300">
            Reference ID <span className="record ml-1 text-ink-900">{error.digest}</span>
          </p>
        ) : null}
        <div className="mt-6 flex justify-center gap-3">
          <Button onClick={reset}>Try again</Button>
          <Button variant="secondary" onClick={() => window.location.assign('/')}>
            Go home
          </Button>
        </div>
      </section>
    </main>
  );
}
