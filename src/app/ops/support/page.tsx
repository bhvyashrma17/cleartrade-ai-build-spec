/**
 * Bug reports sent from the in-app forms (`/app`, `/agent` and `/ops` → Report a bug), newest first.
 * Before this page, reports were stored and nobody saw them (R-40). Admins and ops supervisors are
 * also notified of each new report in the app (`createBugReport`).
 */

import { UserRole } from '@prisma/client';
import { AccessDenied } from '@/components/access-denied';
import { EmptyState, PageHeader } from '@/components/ui';
import { requirePortalAccess } from '@/lib/auth';
import { listBugReports } from '@/lib/bug-reports';

const fmt = (d: Date) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(d);

export default async function OpsSupportPage() {
  const principal = await requirePortalAccess('/ops');
  if (!([UserRole.ops_supervisor, UserRole.ops_finance, UserRole.admin] as readonly UserRole[]).includes(principal.role)) {
    return <AccessDenied message="Bug reports are available to Ops and administrators." />;
  }
  const reports = await listBugReports(100);

  return (
    <div className="space-y-4 py-4 md:py-6">
      <PageHeader
        eyebrow="Operations"
        title="Bug reports"
        description="Sent from the Report a bug forms, newest first. Reply from hello@cleartrade.in within one working day (docs/40 §3.10)."
      />
      {reports.length === 0 ? (
        <EmptyState title="No bug reports yet" description="Reports sent from the app appear here, and admins and ops supervisors are notified of each one." />
      ) : (
        <ul className="space-y-3">
          {reports.map((report) => (
            <li key={report.id} className="rounded-lg border border-[var(--color-border)] bg-surface p-4 shadow-card">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-base font-semibold">{report.subject}</h2>
                <span className="text-xs text-muted">{fmt(report.created_at)}</span>
              </div>
              <p className="mt-1 text-xs text-muted">
                {report.reporter.name || report.reporter.email} · {report.reporter.email} · {report.reporter_role.replace(/_/g, ' ')} · {report.app_environment}
              </p>
              <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium text-muted">What happened</dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words">{report.what_happened}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted">Expected</dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words">{report.expected}</dd>
                </div>
              </dl>
              <p className="mt-3 break-all text-xs text-muted">
                {report.page_url ? <>Page: {report.page_url} · </> : null}Reference: {report.correlation_id}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
