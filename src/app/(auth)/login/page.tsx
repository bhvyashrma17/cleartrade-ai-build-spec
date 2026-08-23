import { OrgTier } from '@prisma/client';
import { redirect } from 'next/navigation';
import { LoginForm } from './LoginForm';
import { getPrincipal, homeRouteForRole } from '@/lib/auth';
import { loginErrorMessage, normalizeCallbackUrl, socialProviderStates } from '@/lib/social-auth';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string; provider?: string }>;
}) {
  const principal = await getPrincipal();
  const params = await searchParams;
  // A guest session is not an account — redirecting it away would make this page
  // unreachable for a guest who wants to sign into a real one. homeRouteForRole() is
  // role-based only and doesn't know about tier, so it must not be called for a guest.
  if (principal && principal.tier !== OrgTier.guest) redirect(homeRouteForRole(principal.role));
  const callbackUrl = normalizeCallbackUrl(params.callbackUrl);
  const oauthErrorMessage = loginErrorMessage(params.error, params.provider);

  return (
    <section className="rounded-xl border border-line-strong bg-surface p-6 sm:p-8">
      <h1 className="display text-title-page text-bone">Sign in to your workspace</h1>
      <p className="mt-3 text-sm text-muted">Use Google, Apple, or your ClearTrade email and password.</p>
      <div className="mt-7">
        <LoginForm
          callbackUrl={callbackUrl}
          oauthErrorMessage={oauthErrorMessage}
          socialProviders={socialProviderStates()}
        />
      </div>
    </section>
  );
}
