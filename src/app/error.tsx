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
    <main className="flex min-h-screen items-center justify-center bg-surface-muted p-6">
      <section className="w-full max-w-lg rounded-lg bg-surface p-8 text-center shadow-card">
        <h1 className="font-serif text-title-page text-primary">Something went wrong</h1>
        <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
          We could not complete that request. Please try again. If this continues, share the
          reference ID below with ClearTrade support.
        </p>
        {error.digest ? (
          <p className="mt-3 text-xs text-[var(--color-text-muted)]">Reference ID: {error.digest}</p>
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
