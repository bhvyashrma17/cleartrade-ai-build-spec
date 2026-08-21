import { redirect } from 'next/navigation';
import { AccessDenied } from '@/components/access-denied';
import { AppShell } from '@/components/shell/AppShell';
import { requirePortalAccess } from '@/lib/auth';
import { ApiError } from '@/lib/errors';

export default async function OpsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let principal;
  try {
    principal = await requirePortalAccess('/ops');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login');
    if (error instanceof ApiError) return <AccessDenied message={error.message} />;
    throw error;
  }
  return <AppShell portal="ops" userName={principal.name} userEmail={principal.email} tier={principal.tier} role={principal.role}>{children}</AppShell>;
}
