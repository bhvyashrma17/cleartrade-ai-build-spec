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
    <section className="rounded-xl border border-line bg-card p-6 sm:p-8">
      <h1 className="masthead text-title-page text-ink-900">Create your free account</h1>
      <p className="mt-2 text-sm text-ink-500">
        Save your searches, see buyer contacts, and track leads.
      </p>

      {isGuestUpgrade && runCount > 0 ? (
        <p className="mt-4 rounded-sm border border-[color-mix(in_srgb,var(--info-fill)_25%,transparent)] bg-[var(--info-tint)] px-3 py-2 text-sm text-[var(--info-text)]">
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
  );
}
