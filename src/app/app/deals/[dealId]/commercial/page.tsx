/**
 * EXP-10 Deal — Commercial Terms & Negotiation (exporter side).
 *
 * The exporter reviews the current proposal, sees exactly which terms changed against
 * the previous version, and approves or requests revisions. Approval is version-specific
 * (AC01) and only an exporter-authorized user can do it (AC03) — both enforced server
 * side in /api/v1/deals/:dealId/proposals, not by hiding this panel.
 */

import { StatusChip } from '@/components/ui';
import { ProposalDiff } from '@/components/commercial/ProposalDiff';
import { PROPOSAL_STATUS_DISPLAY, ProposalHistory } from '@/components/commercial/ProposalHistory';
import { COMMERCIAL_APPROVAL_POLICY } from '@/lib/commercial';
import { loadCommercialView } from '@/lib/commercial-view';
import { canApproveCommercialTerms } from '@/lib/permissions';
import { loadDealForWorkspace } from '../loadDeal';
import { ApprovalPanel } from './ApprovalPanel';

export default async function DealCommercialPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const { deal, principal } = await loadDealForWorkspace(dealId);
  if (!deal) return null;

  const view = await loadCommercialView(deal.id);
  const mayApprove = await canApproveCommercialTerms(principal, deal, COMMERCIAL_APPROVAL_POLICY);

  const current = view.awaiting ?? view.approved ?? view.latest;
  // The exporter never sees an agent's unsent draft — a draft is the agent's working
  // copy, not an offer. Showing it would imply terms they were never actually offered.
  const currentIsVisibleToExporter = current !== null && current.status !== 'draft';
  const previousVersion = current && current.version > 1 ? current.version - 1 : null;

  return (
    <div className="space-y-6">
      {!currentIsVisibleToExporter ? (
        <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
          <h2 className="text-lg font-semibold text-primary">No terms to review yet</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Your agent hasn&apos;t sent commercial terms for this deal yet. When they do, you&apos;ll get a task
            and can approve or request changes here.
          </p>
        </section>
      ) : (
        <>
          <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-primary">Current proposal</h2>
                <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                  Version {current.version}
                  {current.proposedBy ? ` · prepared by ${current.proposedBy}` : ''}
                </p>
              </div>
              <StatusChip {...(PROPOSAL_STATUS_DISPLAY[current.status] ?? PROPOSAL_STATUS_DISPLAY.draft)} />
            </div>

            {current.agentNote ? (
              <div className="mt-4 rounded-md border border-[var(--color-border)] bg-surface-muted p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
                  Note from your agent
                </p>
                <p className="mt-1 text-sm text-primary">{current.agentNote}</p>
              </div>
            ) : null}

            {current.changesRequestedNote ? (
              <div className="mt-4 rounded-md border border-[color-mix(in_srgb,var(--color-info)_25%,transparent)] bg-[color-mix(in_srgb,var(--color-info)_6%,transparent)] p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
                  Changes you requested
                </p>
                <p className="mt-1 text-sm text-primary">{current.changesRequestedNote}</p>
              </div>
            ) : null}

            <div className="mt-5">
              <ProposalDiff diff={view.diff} currentVersion={current.version} previousVersion={previousVersion} />
            </div>
          </section>

          {view.isLocked ? (
            <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
              <h2 className="text-lg font-semibold text-primary">These terms are locked</h2>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                The deal snapshot is frozen and every document generates from it. Changing a locked term
                needs an amendment, which your agent raises and you approve — the original version stays on
                record either way.
              </p>
            </section>
          ) : view.awaiting && mayApprove ? (
            <ApprovalPanel dealId={deal.id} proposalVersion={view.awaiting.version} dealVersion={view.dealVersion} />
          ) : view.awaiting && !mayApprove ? (
            <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
              <h2 className="text-lg font-semibold text-primary">Waiting on an authorized approver</h2>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                Version {view.awaiting.version} is ready for approval, but your account isn&apos;t authorized to
                approve commercial terms. The account owner needs to approve it.
              </p>
            </section>
          ) : view.approved ? (
            <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
              <h2 className="text-lg font-semibold text-primary">Terms accepted</h2>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                You accepted version {view.approved.version}
                {view.approved.approvedAt
                  ? ` on ${new Date(view.approved.approvedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`
                  : ''}
                . Your agent will prepare the documents and lock the deal.
              </p>
            </section>
          ) : null}
        </>
      )}

      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Version history</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Every version is kept. A revision never edits a version you already acted on.
        </p>
        <div className="mt-4">
          <ProposalHistory history={view.history.filter((h) => h.status !== 'draft')} />
        </div>
      </section>
    </div>
  );
}
