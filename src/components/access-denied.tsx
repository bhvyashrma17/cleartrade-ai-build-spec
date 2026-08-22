/**
 * docs/03 §7 403 state: "Human-readable no-access page; do not leak object
 * existence/details." Rendered directly by each portal layout when the portal guard
 * (`requirePortalAccess()`) throws FORBIDDEN — not by src/app/error.tsx.
 *
 * Why not the generic error boundary: Next.js strips a thrown error down to
 * `{ digest }` only (even `message` is gone) once it crosses the Server->Client
 * boundary into error.tsx, in production. Catching FORBIDDEN here, before that
 * boundary, is the only place the real ApiError — and its safe, pre-written message —
 * is still available to render.
 */

export function AccessDenied({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-muted p-6">
      <section className="w-full max-w-md rounded-lg bg-surface p-8 text-center shadow-card">
        <h1 className="font-serif text-title-page text-primary">Access denied</h1>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{message}</p>
      </section>
    </main>
  );
}
