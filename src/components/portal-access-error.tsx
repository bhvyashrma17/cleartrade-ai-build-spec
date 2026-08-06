/**
 * docs/03 §7 403 state: "Human-readable no-access page; do not leak object
 * existence/details." Shared by both portal pages in this slice so a FORBIDDEN thrown
 * from a server-side guard renders in place instead of Next.js's generic 500 page.
 */

export function PortalAccessError({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-md p-10 text-center">
      <h1 className="text-xl font-semibold text-primary">Access denied</h1>
      <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{message}</p>
    </div>
  );
}
