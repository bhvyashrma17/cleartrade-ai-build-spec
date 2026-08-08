import { OrgTier } from '@prisma/client';
import { redirect } from 'next/navigation';
import { LoginForm } from './LoginForm';
import { getPrincipal, homeRouteForRole } from '@/lib/auth';

export default async function LoginPage() {
  const principal = await getPrincipal();
  // A guest session is not an account — redirecting it away would make this page
  // unreachable for a guest who wants to sign into a real one. homeRouteForRole() is
  // role-based only and doesn't know about tier, so it must not be called for a guest.
  if (principal && principal.tier !== OrgTier.guest) redirect(homeRouteForRole(principal.role));

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-muted px-4 py-10">
      <section className="w-full max-w-md rounded-lg bg-surface p-6 shadow-card sm:p-8">
        <p className="text-sm font-semibold text-primary">ClearTrade AI</p>
        <h1 className="mt-2 text-2xl font-bold text-primary">Sign in to your workspace</h1>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Use the email address and password issued for your ClearTrade account.</p>
        <div className="mt-7"><LoginForm /></div>
      </section>
    </main>
  );
}
