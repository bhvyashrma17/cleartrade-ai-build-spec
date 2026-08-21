import { OrgTier } from '@prisma/client';
import { AccessDenied } from '@/components/access-denied';
import { AppShell } from '@/components/shell/AppShell';
import { getPrincipal } from '@/lib/auth';
import { isExporter } from '@/lib/permissions';

/**
 * Exporter portal shell.
 *
 * **This layout no longer requires a session.** Demand Discovery and Buyer Discovery are
 * open to anonymous visitors (docs/14), and a visitor has not been minted as a guest
 * until their first search — so a portal-wide `requirePortalAccess('/app')` here would
 * redirect them to /login before they could ever run one.
 *
 * The consequence, stated plainly because it is a real shift: **the portal boundary is
 * no longer the authorization boundary for /app.** Every page under /app must enforce
 * its own requirement, and every mutation route must call `assertCan()` for the
 * capability + tier it needs. What this layout still enforces is the ROLE boundary —
 * an agent or ops user has no business rendering the exporter shell.
 *
 * Anonymous visitors render at guest tier, so the nav shows only the two surfaces that
 * actually work for them.
 */
export default async function ExporterLayout({ children }: { children: React.ReactNode }) {
  const principal = await getPrincipal();

  // A signed-in non-exporter is a role error, not an anonymous visitor.
  if (principal && !isExporter(principal)) {
    return <AccessDenied message="This area is not available for your role." />;
  }

  return (
    <AppShell
      portal="exporter"
      userName={principal?.name ?? null}
      userEmail={principal?.email ?? null}
      tier={principal?.tier ?? OrgTier.guest}
      role={principal?.role ?? 'exporter_owner'}
    >
      {children}
    </AppShell>
  );
}
