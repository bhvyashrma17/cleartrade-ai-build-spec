import type { UserRole } from '@prisma/client';

export type ProfilePortal = 'exporter' | 'agent' | 'ops';

export const PROFILE_ROLE_LABELS: Record<UserRole, string> = {
  exporter_owner: 'Exporter Owner',
  exporter_member: 'Exporter Member',
  agent: 'ClearTrade Agent',
  ops_supervisor: 'Operations Supervisor',
  ops_finance: 'Operations Finance',
  admin: 'Administrator',
};

export function profileMenuDestinations(portal: ProfilePortal, role: UserRole) {
  const workspace = portal === 'exporter' ? '/app/overview' : portal === 'agent' ? '/agent' : '/ops';
  const personalSettings = portal === 'exporter' ? '/app/settings' : portal === 'agent' ? '/agent/settings' : '/ops/account';
  return {
    workspace,
    personalSettings,
    adminSettings: portal === 'ops' && role === 'admin' ? '/ops/settings' : null,
  };
}
