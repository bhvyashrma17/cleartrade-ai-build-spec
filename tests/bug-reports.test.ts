import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { OrgTier, UserRole } from '@prisma/client';
import { describe, expect, test } from 'vitest';
import { createBugReport } from '../src/lib/bug-reports';
import { prisma } from '../src/lib/prisma';
import type { Principal } from '../src/types';

const principal = (id: string, email: string, role: UserRole, orgId: string | null): Principal => ({ id, email, name: 'Reporter', role, exporter_org_id: orgId, tier: OrgTier.paid });

describe('authenticated bug reports', () => {
  test.each([
    [UserRole.exporter_owner, true], [UserRole.agent, false], [UserRole.ops_supervisor, false], [UserRole.admin, false],
  ] as const)('%s can submit without an exporter-org assumption', async (role, exporter) => {
    const suffix = randomUUID();
    const org = exporter ? await prisma.exporterOrg.create({ data: { display_name: `Bug Org ${suffix}`, tier: OrgTier.paid } }) : null;
    const user = await prisma.user.create({ data: { email: `bug-${role}-${suffix}@test.local`, name: 'Reporter', role, exporter_org_id: org?.id } });
    const correlationId = randomUUID();
    const report = await createBugReport(principal(user.id, user.email, role, org?.id ?? null), {
      subject: 'Settings menu issue', what_happened: 'The menu did not open after clicking.', expected: 'The menu should open.', page_url: 'https://cleartrade.test/app/settings',
    }, correlationId);
    const stored = await prisma.bugReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(stored).toMatchObject({ reporter_user_id: user.id, reporter_role: role, correlation_id: correlationId });
  });

  test('client input cannot spoof identity or attach auth secrets', async () => {
    const suffix = randomUUID();
    const user = await prisma.user.create({ data: { email: `safe-bug-${suffix}@test.local`, name: 'Safe', role: UserRole.agent } });
    const input = { subject: 'A valid subject', what_happened: 'Something unexpected happened here.', expected: 'A stable page', page_url: '' };
    const report = await createBugReport(principal(user.id, user.email, user.role, null), input, randomUUID());
    const serialized = JSON.stringify(await prisma.bugReport.findUniqueOrThrow({ where: { id: report.id } }));
    expect(serialized).not.toMatch(/password|cookie|session.?token|oauth|refresh.?token|client.?secret/i);
    expect(createBugReport).toHaveLength(3);
  });

  test('About is a whole-row link, hides unavailable legal rows, and shared portal routes exist', async () => {
    const [about, settings, form, api, appRoute, agentRoute, opsRoute] = await Promise.all([
      readFile(path.resolve('src/components/settings/AboutSettingsSection.tsx'), 'utf8'),
      readFile(path.resolve('src/app/app/settings/page.tsx'), 'utf8'),
      readFile(path.resolve('src/components/settings/BugReportForm.tsx'), 'utf8'),
      readFile(path.resolve('src/app/api/v1/bug-reports/route.ts'), 'utf8'),
      readFile(path.resolve('src/app/app/support/report-bug/page.tsx'), 'utf8'),
      readFile(path.resolve('src/app/agent/support/report-bug/page.tsx'), 'utf8'),
      readFile(path.resolve('src/app/ops/support/report-bug/page.tsx'), 'utf8'),
    ]);
    expect(about).toContain('<Link href={reportBugHref}');
    expect(about).toContain('focus-visible-ring');
    expect(`${about}${settings}`).not.toContain('Not available yet');
    expect(about).not.toMatch(/Privacy policy|Terms of service|Coming soon|Unavailable|Disabled/);
    expect(form).toContain("apiPost('/api/v1/bug-reports'");
    expect(form).toContain('Thanks — your report has been received.');
    expect(api).toContain('requirePrincipal()');
    expect(`${appRoute}${agentRoute}${opsRoute}`).toContain('BugReportPage as default');
  });

  test('no unapproved public legal routes were fabricated and admin settings remains separate', async () => {
    await expect(readFile(path.resolve('src/app/privacy/page.tsx'), 'utf8')).rejects.toThrow();
    await expect(readFile(path.resolve('src/app/terms/page.tsx'), 'utf8')).rejects.toThrow();
    const menu = await readFile(path.resolve('src/components/shell/profile-menu.ts'), 'utf8');
    expect(menu).toContain("adminSettings: portal === 'ops' && role === 'admin' ? '/ops/settings' : null");
  });
});
