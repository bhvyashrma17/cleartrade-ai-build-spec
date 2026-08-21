/**
 * Registration. `/register` · open to everyone.
 *
 * When a guest reaches this page their existing tenant is upgraded in place by
 * POST /api/v1/register — same org id, same user id — so the searches they have already
 * run survive and become saved history. The page tells them that explicitly, because
 * "will I lose what I just did?" is the live question at this exact moment.
 */

import { OrgTier } from '@prisma/client';
import { redirect } from 'next/navigation';
import { getPrincipal, homeRouteForRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { normalizeCallbackUrl } from '@/lib/social-auth';
import { RegisterForm } from './RegisterForm';

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const principal = await getPrincipal();
  const { callbackUrl } = await searchParams;
  // Same guard `/login` uses: a crafted callbackUrl is attacker-supplied input, so it is only
  // ever honoured after passing through the same origin/path allowlist, never used raw.
  const safeCallbackUrl = callbackUrl ? normalizeCallbackUrl(callbackUrl) : null;

  // Already a real account — nothing to register.
  if (principal && principal.tier !== OrgTier.guest) {
    redirect(homeRouteForRole(principal.role));
  }

  const isGuestUpgrade = principal?.tier === OrgTier.guest;

  const [runCount, lastAdHoc] = isGuestUpgrade
    ? await Promise.all([
        prisma.discoveryRun.count({ where: { exporter_org_id: principal!.exporter_org_id! } }),
        prisma.discoveryRun.findFirst({
          where: { exporter_org_id: principal!.exporter_org_id!, product_id: null },
          orderBy: { created_at: 'desc' },
          select: { input_snapshot: true },
        }),
      ])
    : [0, null];

  const snapshot = lastAdHoc?.input_snapshot as { description?: string | null } | null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-muted px-4 py-10">
      <section className="w-full max-w-md rounded-lg bg-surface p-6 shadow-card sm:p-8">
        <p className="text-sm font-semibold text-primary">ClearTrade AI</p>
        <h1 className="mt-2 text-2xl font-bold text-primary">Create your free account</h1>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          Save your searches, see buyer contacts, and track leads.
        </p>

        {isGuestUpgrade && runCount > 0 ? (
          <p className="mt-4 rounded border border-[var(--color-info)]/30 bg-[var(--color-info)]/5 px-3 py-2 text-sm text-primary">
            Your {runCount} search{runCount === 1 ? '' : 'es'} from this session will be kept and
            become your saved history.
          </p>
        ) : null}

        <div className="mt-6">
          <RegisterForm
            adHocProductLabel={isGuestUpgrade ? (snapshot?.description ?? null) : null}
            callbackUrl={safeCallbackUrl}
          />
        </div>
      </section>
    </main>
  );
}
