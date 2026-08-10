/**
 * EXP-17 Notifications & Account.
 *
 * AC03 "Org member role is enforced server-side" is enforced by `canManageTeam()` in
 * the invitation/member routes, not by this page hiding the invite form for a member —
 * hiding it is a courtesy; a member POSTing `/api/v1/invitations` directly still gets a
 * 403 from `canManageTeam()`. This page's `isOwner` prop just avoids showing a control
 * that would fail server-side anyway.
 */

import { OrgTier } from '@prisma/client';
import { getPrincipal } from '@/lib/auth';
import { UpgradeNotice } from '@/components/ui';
import { NotificationsList } from '@/components/notifications/NotificationsList';
import { OrgProfileForm } from '@/components/notifications/OrgProfileForm';
import { PreferencesPanel } from '@/components/notifications/PreferencesPanel';
import { TeamPanel } from '@/components/notifications/TeamPanel';
import { prisma } from '@/lib/prisma';

const IEC_LABEL: Record<string, string> = {
  unknown: 'Not recorded',
  not_started: 'Not started',
  pending: 'Pending verification',
  verified: 'Verified',
};

export default async function NotificationsPage() {
  const principal = await getPrincipal();
  const tier = principal?.tier ?? OrgTier.guest;

  if (!principal || tier === OrgTier.guest) {
    return (
      <div className="mx-auto max-w-3xl p-4 md:p-6">
        <UpgradeNotice
          title="Notifications & account settings need a free account"
          requiredTier="free"
          description="Create a free account to receive notifications, manage your organization profile, and invite your team."
        />
      </div>
    );
  }

  const orgId = principal.exporter_org_id as string;
  const [org, members, invitations] = await Promise.all([
    prisma.exporterOrg.findUniqueOrThrow({
      where: { id: orgId },
      select: { display_name: true, legal_name: true, gstin: true, iec: true, state: true, city: true },
    }),
    prisma.user.findMany({
      where: { exporter_org_id: orgId, is_active: true },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { role: 'asc' },
    }),
    prisma.invitation.findMany({
      where: { exporter_org_id: orgId, status: 'pending' },
      select: { id: true, email: true, role: true, status: true, expires_at: true },
      orderBy: { created_at: 'desc' },
    }),
  ]);

  const isOwner = principal.role === 'exporter_owner';

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold text-primary">Notifications & Account</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Your alerts, notification preferences, organization profile and team.
        </p>
      </header>

      <NotificationsList />

      <PreferencesPanel />

      <OrgProfileForm
        canEdit
        initial={{
          legal_name: org.legal_name,
          display_name: org.display_name,
          gstin: org.gstin,
          iec_label: IEC_LABEL[org.iec] ?? org.iec,
          state: org.state,
          city: org.city,
        }}
      />

      <TeamPanel
        isOwner={isOwner}
        members={members.map((m) => ({ ...m, is_active: true }))}
        invitations={invitations.map((i) => ({ ...i, expires_at: i.expires_at.toISOString() }))}
      />
    </div>
  );
}
