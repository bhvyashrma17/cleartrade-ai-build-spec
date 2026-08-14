/**
 * OPS-04 CHA, Compliance & Document Oversight (docs/06).
 *
 * Reuses the SAME canonical `Document`/`PartnerHandoff`/`Partner`/`Shipment` rows and
 * the SAME mutation routes AGT-06's agent execution workspace already uses
 * (`.../documents/:id/file`, `.../deals/:dealId/partners`) — this screen is a
 * different projection of the same objects, never a parallel Ops-only copy
 * (AGENTS.md "the one rule that matters most").
 */

import Link from 'next/link';
import { UserRole } from '@prisma/client';
import { AccessDenied } from '@/components/access-denied';
import { docChip, FILING_STATUS_DISPLAY, GENERATION_STATUS_DISPLAY, APPROVAL_STATUS_DISPLAY } from '@/components/documents/statusDisplay';
import { AssignPartnerForm } from '@/components/execution/AssignPartnerForm';
import { OverrideRequirementForm } from '@/components/ops/OverrideRequirementForm';
import { RecordFilingForm } from '@/components/ops/RecordFilingForm';
import { StatusChip } from '@/components/ui';
import { requirePortalAccess } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

function fmt(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(d);
}

const HANDOFF_STATUS_DISPLAY: Record<string, { label: string; tone: 'positive' | 'info' | 'warning' | 'critical' | 'neutral' }> = {
  pending: { label: 'Pending', tone: 'neutral' },
  sent: { label: 'Sent', tone: 'info' },
  acknowledged: { label: 'Acknowledged', tone: 'positive' },
  completed: { label: 'Completed', tone: 'positive' },
  rejected: { label: 'Rejected', tone: 'critical' },
};

export default async function OpsExecutionPage() {
  const principal = await requirePortalAccess('/ops');
  if (!([UserRole.ops_supervisor, UserRole.admin] as readonly UserRole[]).includes(principal.role)) {
    return <AccessDenied message="CHA and compliance oversight is available to Ops supervisors and administrators." />;
  }

  const [readyToFile, rejectedOrMissing, shipments, recentHandoffs, partners, handoffCounts] = await Promise.all([
    prisma.document.findMany({
      where: { filing_status: 'ready', is_current_version: true },
      include: { deal: { include: { exporter_org: { select: { display_name: true } }, buyer: { select: { display_name: true } } } } },
      orderBy: { updated_at: 'asc' },
      take: 50,
    }),
    prisma.document.findMany({
      where: {
        is_current_version: true,
        OR: [{ filing_status: 'rejected' }, { generation_status: 'failed' }, { approval_status: 'rejected' }],
      },
      include: { deal: { include: { exporter_org: { select: { display_name: true } }, buyer: { select: { display_name: true } } } } },
      orderBy: { updated_at: 'asc' },
      take: 50,
    }),
    prisma.shipment.findMany({
      where: { status: { notIn: ['delivered', 'exception'] } },
      include: {
        deal: { include: { exporter_org: { select: { display_name: true } }, buyer: { select: { display_name: true } } } },
        cha_partner: { select: { display_name: true } },
        freight_partner: { select: { display_name: true } },
      },
      orderBy: { updated_at: 'desc' },
      take: 30,
    }),
    prisma.partnerHandoff.findMany({
      include: { partner: { select: { display_name: true, type: true } }, deal: { include: { exporter_org: { select: { display_name: true } } } } },
      orderBy: { sent_at: 'desc' },
      take: 30,
    }),
    prisma.partner.findMany({ orderBy: [{ partner_status: 'asc' }, { display_name: 'asc' }] }),
    prisma.partnerHandoff.groupBy({ by: ['partner_id', 'status'], _count: true }),
  ]);

  const directoryPartners = partners
    .filter((p) => p.partner_status === 'active')
    .map((p) => ({ id: p.id, type: p.type, display_name: p.display_name, country_code: p.country_code }));

  const countsByPartner = new Map<string, Record<string, number>>();
  for (const row of handoffCounts) {
    const existing = countsByPartner.get(row.partner_id) ?? {};
    existing[row.status] = row._count;
    countsByPartner.set(row.partner_id, existing);
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <header className="mb-2">
        <p className="text-sm font-medium text-primary">Operations</p>
        <h1 className="text-2xl font-semibold text-primary">CHA, compliance &amp; document oversight</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          ClearTrade coordinates filing with CHAs — it does not file directly with ICEGATE.
        </p>
      </header>

      {/* Ready-to-file queue */}
      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Ready to file ({readyToFile.length})</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Documents cleared and waiting on CHA/external action.</p>
        {readyToFile.length === 0 ? (
          <p className="mt-4 rounded border border-dashed border-[var(--color-border)] bg-surface-muted px-4 py-6 text-sm text-[var(--color-text-secondary)]">Nothing waiting to file.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {readyToFile.map((d) => (
              <li key={d.id} className="rounded-md border border-[var(--color-border)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-primary">
                    {d.doc_type} · {d.deal?.exporter_org.display_name} · {d.deal?.buyer.display_name}
                  </span>
                  {/* "Avoid green unless all prerequisites are satisfied" — ready-to-file is
                      informational (info tone), not a completion state (positive tone). */}
                  <StatusChip {...docChip(FILING_STATUS_DISPLAY, d.filing_status)} size="sm" />
                </div>
                <div className="mt-2">
                  {d.deal ? <RecordFilingForm dealId={d.deal.id} documentId={d.id} allowedTargets={['filed']} /> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Rejected/missing queue */}
      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Rejected / missing ({rejectedOrMissing.length})</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Document and compliance blockers — reason and owner.</p>
        {rejectedOrMissing.length === 0 ? (
          <p className="mt-4 rounded border border-dashed border-[var(--color-border)] bg-surface-muted px-4 py-6 text-sm text-[var(--color-text-secondary)]">No rejected or failed documents.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {rejectedOrMissing.map((d) => (
              <li key={d.id} className="rounded-md border border-[color-mix(in_srgb,var(--color-critical)_25%,transparent)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-primary">
                    {d.doc_type} v{d.version} · {d.deal?.exporter_org.display_name} · {d.deal?.buyer.display_name}
                  </span>
                  <div className="flex gap-1.5">
                    <StatusChip {...docChip(GENERATION_STATUS_DISPLAY, d.generation_status)} size="sm" />
                    <StatusChip {...docChip(APPROVAL_STATUS_DISPLAY, d.approval_status)} size="sm" />
                    <StatusChip {...docChip(FILING_STATUS_DISPLAY, d.filing_status)} size="sm" />
                  </div>
                </div>
                <p className="mt-1 text-sm text-[var(--color-critical-text)]">
                  {d.rejection_reason ?? d.generation_error ?? d.changes_requested_reason ?? 'Blocked'}
                </p>
                {/* AC02: prior attempt history is never erased — every version is its own
                    row (is_current_version), and every status change is a separate
                    AuditEvent (see /ops/audit), not an overwrite of the last one. */}
                <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                  Current version {d.version}{d.version > 1 ? ` — ${d.version - 1} prior attempt(s) preserved` : ''}. Full history in the audit log.
                </p>
                {d.deal ? (
                  <div className="mt-2 flex flex-wrap gap-3">
                    <RecordFilingForm dealId={d.deal.id} documentId={d.id} allowedTargets={['ready']} />
                    <OverrideRequirementForm dealId={d.deal.id} documentId={d.id} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* CHA / freight assignments */}
      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">CHA / freight assignments</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Partner, deal/shipment, SLA and reference status — assigned from the approved directory only.</p>
        {shipments.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--color-text-secondary)]">No active shipments.</p>
        ) : (
          <ul className="mt-4 space-y-4">
            {shipments.map((s) => (
              <li key={s.id} className="rounded-md border border-[var(--color-border)] p-3">
                <p className="text-sm font-medium text-primary">
                  {s.deal.exporter_org.display_name} · {s.deal.buyer.display_name}{' '}
                  <Link href={`/agent/deals/${s.deal.id}`} className="focus-visible-ring text-xs font-normal text-[var(--color-text-secondary)] underline underline-offset-2">
                    open deal
                  </Link>
                </p>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-text-secondary)]">
                  <span>CHA: {s.cha_partner?.display_name ?? <span className="text-[var(--color-critical-text)]">Unassigned</span>}</span>
                  <span>Freight: {s.freight_partner?.display_name ?? <span className="text-[var(--color-critical-text)]">Unassigned</span>}</span>
                </div>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <AssignPartnerForm dealId={s.deal.id} lane="cha" partners={directoryPartners} currentPartnerName={s.cha_partner?.display_name ?? null} />
                  <AssignPartnerForm dealId={s.deal.id} lane="freight" partners={directoryPartners} currentPartnerName={s.freight_partner?.display_name ?? null} />
                </div>
              </li>
            ))}
          </ul>
        )}

        <h3 className="mt-5 text-sm font-semibold text-primary">Recent handoffs</h3>
        {recentHandoffs.length === 0 ? (
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">No handoffs recorded yet.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs uppercase text-[var(--color-text-muted)]">
                <tr><th className="pb-2">Partner</th><th className="pb-2">Exporter</th><th className="pb-2">Status</th><th className="pb-2">Reference</th><th className="pb-2">Sent</th></tr>
              </thead>
              <tbody>
                {recentHandoffs.map((h) => {
                  const chip = HANDOFF_STATUS_DISPLAY[h.status] ?? HANDOFF_STATUS_DISPLAY.pending;
                  return (
                    <tr key={h.id} className="border-t border-[var(--color-border)]">
                      <td className="py-2">{h.partner.display_name} <span className="text-xs text-[var(--color-text-secondary)]">({h.lane})</span></td>
                      <td className="py-2 text-[var(--color-text-secondary)]">{h.deal.exporter_org.display_name}</td>
                      <td className="py-2"><StatusChip label={chip.label} tone={chip.tone} icon={chip.tone === 'critical' ? 'alert' : chip.tone === 'positive' ? 'check' : 'dot'} size="sm" /></td>
                      <td className="py-2 text-[var(--color-text-secondary)]">{h.reference ?? '—'}</td>
                      <td className="py-2 text-[var(--color-text-secondary)]">{fmt(h.sent_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Partner performance — counts only, no invented composite score. */}
      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Partner performance</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Handoff counts by outcome — no composite score.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase text-[var(--color-text-muted)]">
              <tr><th className="pb-2">Partner</th><th className="pb-2">Status</th><th className="pb-2">Sent</th><th className="pb-2">Acknowledged</th><th className="pb-2">Completed</th><th className="pb-2">Rejected</th></tr>
            </thead>
            <tbody>
              {partners.map((p) => {
                const counts = countsByPartner.get(p.id) ?? {};
                return (
                  <tr key={p.id} className="border-t border-[var(--color-border)]">
                    <td className="py-2 text-primary">{p.display_name} <span className="text-xs text-[var(--color-text-secondary)]">({p.type})</span></td>
                    <td className="py-2">
                      <StatusChip
                        label={p.partner_status}
                        tone={p.partner_status === 'active' ? 'positive' : p.partner_status === 'suspended' ? 'warning' : 'neutral'}
                        icon={p.partner_status === 'active' ? 'check' : 'block'}
                        size="sm"
                      />
                    </td>
                    <td className="py-2 text-[var(--color-text-secondary)]">{counts.sent ?? 0}</td>
                    <td className="py-2 text-[var(--color-text-secondary)]">{counts.acknowledged ?? 0}</td>
                    <td className="py-2 text-[var(--color-text-secondary)]">{counts.completed ?? 0}</td>
                    <td className="py-2 text-[var(--color-text-secondary)]">{counts.rejected ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
          Manage the partner directory (onboarding, status changes) in{' '}
          <Link href="/ops/audit#partners" className="focus-visible-ring font-medium underline underline-offset-2">Audit &amp; Config</Link>.
        </p>
      </section>
    </div>
  );
}
