/**
 * AGT-06 Deal Execution Workspace.
 *
 * The agent's execution surface over the SAME canonical records the exporter portal
 * renders — Document, Task, Shipment, ShipmentMilestone, Payment, InsuranceCase, Dispute.
 * `loadExecutionView()` is the single loader; see its header for why there is no
 * agent-side copy of any of them.
 *
 * AC01 — every mutating control on this page is wrapped in `<GatedAction>` and passed a
 * verdict from `isActionAllowed()`, computed on the server from the server-built
 * checklist. The client is handed a boolean-plus-reason, never the rules.
 *
 * AC03 — "agent can see exporter-visible status before sending updates": every document
 * row shows its exporter-facing approval status, the task board has a dedicated
 * exporter-owned column, and the internal layer is visually separated and labelled so an
 * agent always knows which side of the wall they are looking at.
 */

import Link from 'next/link';
import { AssignPartnerForm } from '@/components/execution/AssignPartnerForm';
import { EscalateBlockerButton } from '@/components/execution/EscalateBlockerButton';
import { FileDocumentForm } from '@/components/execution/FileDocumentForm';
import { GatedAction } from '@/components/execution/GatedAction';
import { HandoffStatusForm } from '@/components/execution/HandoffStatusForm';
import { InternalNoteForm } from '@/components/execution/InternalNoteForm';
import { TaskActions } from '@/components/execution/TaskActions';
import { GenerateButton } from '@/components/documents/GenerateButton';
import {
  APPROVAL_STATUS_DISPLAY,
  docChip,
  FILING_STATUS_DISPLAY,
  GENERATION_STATUS_DISPLAY,
} from '@/components/documents/statusDisplay';
import { PAYMENT_STATUS_DISPLAY, paymentChip } from '@/components/payment/statusDisplay';
import { SHIPMENT_STATUS_DISPLAY, shipmentChip } from '@/components/shipment/statusDisplay';
import { StatusChip } from '@/components/ui';
import { isActionAllowed, type ExecutionGate } from '@/lib/execution-plan';
import { loadExecutionView, type SharedTask } from '@/lib/execution-view';
import { prisma } from '@/lib/prisma';
import { DEAL_STAGE_LABELS } from '@/lib/state-machines/deal';
import type { StatusDescriptor } from '@/types';
import { loadAgentDeal } from './loadAgentDeal';

const GATE_STATE_DISPLAY: Record<string, StatusDescriptor> = {
  done: { label: 'Done', tone: 'positive', icon: 'check' },
  ready: { label: 'Ready', tone: 'info', icon: 'clock' },
  blocked: { label: 'Blocked', tone: 'critical', icon: 'alert' },
  waiting: { label: 'Waiting', tone: 'neutral', icon: 'pause' },
};

const RISK_DISPLAY: Record<string, StatusDescriptor> = {
  normal: { label: 'Normal', tone: 'positive', icon: 'check' },
  watch: { label: 'Watch', tone: 'warning', icon: 'alert' },
  at_risk: { label: 'At risk', tone: 'critical', icon: 'alert' },
  blocked: { label: 'Blocked', tone: 'critical', icon: 'block' },
};

const SLA_DISPLAY: Record<string, StatusDescriptor> = {
  on_time: { label: 'On time', tone: 'positive', icon: 'check' },
  due_soon: { label: 'Due soon', tone: 'warning', icon: 'clock' },
  overdue: { label: 'Overdue', tone: 'critical', icon: 'alert' },
  escalated: { label: 'Escalated', tone: 'critical', icon: 'alert' },
};

const HANDOFF_DISPLAY: Record<string, StatusDescriptor> = {
  pending: { label: 'Pending', tone: 'neutral', icon: 'dot' },
  sent: { label: 'Sent', tone: 'info', icon: 'clock' },
  acknowledged: { label: 'Acknowledged', tone: 'info', icon: 'check' },
  completed: { label: 'Completed', tone: 'positive', icon: 'check' },
  rejected: { label: 'Declined', tone: 'critical', icon: 'x' },
};

const chip = (map: Record<string, StatusDescriptor>, v: string): StatusDescriptor =>
  map[v] ?? { label: v.replace(/_/g, ' '), tone: 'neutral', icon: 'dot' };

function fmt(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

function money(amount: unknown, currency: string | null) {
  if (amount === null || amount === undefined) return '—';
  return `${currency ?? ''} ${Number(amount).toLocaleString('en-IN')}`.trim();
}

function TaskColumn({ title, tasks, emptyNote }: { title: string; tasks: SharedTask[]; emptyNote: string }) {
  return (
    <div className="rounded-md border border-[var(--color-border)] p-3">
      <h3 className="text-sm font-semibold text-primary">
        {title} <span className="font-normal text-[var(--color-text-secondary)]">({tasks.length})</span>
      </h3>
      {tasks.length === 0 ? (
        <p className="mt-2 text-xs text-[var(--color-text-secondary)]">{emptyNote}</p>
      ) : (
        <ul className="mt-2 space-y-3">
          {tasks.map((t) => (
            <li key={t.id} className="border-t border-[var(--color-border)] pt-2 first:border-0 first:pt-0">
              <p className="text-sm font-medium text-primary">{t.title}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <StatusChip label={t.state.replace(/_/g, ' ')} tone="neutral" icon="dot" size="sm" />
                <StatusChip {...chip(SLA_DISPLAY, t.sla_state)} size="sm" />
                {t.due_at ? <span className="text-xs text-[var(--color-text-secondary)]">Due {fmt(t.due_at)}</span> : null}
              </div>
              {t.owner_name ? <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Owner: {t.owner_name}</p> : null}
              {t.blocked_reason ? (
                <p className="mt-1 text-xs text-[var(--color-warning-text)]">Waiting on: {t.blocked_reason}</p>
              ) : null}
              <div className="mt-1.5">
                <TaskActions taskId={t.id} state={t.state} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default async function AgentDealExecutionPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const { principal, deal } = await loadAgentDeal(dealId);
  const view = await loadExecutionView(principal, deal);

  // PartnerHandoff is loaded here rather than in the shared view because it is an
  // execution-lane record with no exporter-facing surface yet.
  const handoffs = await prisma.partnerHandoff.findMany({
    where: { deal_id: dealId },
    orderBy: { sent_at: 'desc' },
    include: { partner: { select: { display_name: true, type: true } }, owner: { select: { name: true } } },
  });

  const verdict = (a: Parameters<typeof isActionAllowed>[1]) => isActionAllowed(view.checklist, a);
  const liveGate: ExecutionGate | undefined = view.checklist.find((g) => g.state === 'blocked' || g.state === 'ready');

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6">
      {/* --- Execution header (persistent) --- */}
      <header className="mb-6">
        <p className="text-sm font-medium text-primary">
          <Link href="/agent" className="underline underline-offset-2">
            Agent workspace
          </Link>{' '}
          · Execution
        </p>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-primary">{deal.buyer.display_name}</h1>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              {deal.exporter_org.display_name} · {deal.product?.name ?? 'No product'} · {deal.buyer.country_code}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip label={DEAL_STAGE_LABELS[deal.stage]} tone="info" icon="dot" size="sm" />
            <StatusChip {...chip(RISK_DISPLAY, deal.risk_state)} size="sm" />
            <span className="text-sm font-medium text-primary">{money(deal.value_amount, deal.value_currency)}</span>
            <Link href={`/agent/deals/${dealId}/commercial`} className="text-sm font-medium text-primary underline underline-offset-2">
              Commercial
            </Link>
            <Link href={`/agent/deals/${dealId}/document-data`} className="text-sm font-medium text-primary underline underline-offset-2">
              Document data
            </Link>
            <Link href={`/agent/deals/${dealId}/documents`} className="text-sm font-medium text-primary underline underline-offset-2">
              Documents
            </Link>
          </div>
        </div>
        {deal.risk_reason ? (
          <div role="alert" className="mt-3 rounded-md border border-[color-mix(in_srgb,var(--color-critical)_25%,transparent)] bg-[color-mix(in_srgb,var(--color-critical)_5%,transparent)] p-3">
            <p className="text-sm font-medium text-primary">{deal.risk_reason}</p>
          </div>
        ) : null}
      </header>

      <div className="grid gap-6 xl:grid-cols-3">
        {/* --- Dependency checklist (server-driven prerequisites) --- */}
        <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card xl:col-span-1">
          <h2 className="text-lg font-semibold text-primary">Dependency checklist</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Prerequisites are evaluated on the server. Downstream actions stay disabled until their gate clears.
          </p>
          <ol className="mt-4 space-y-3">
            {view.checklist.map((gate) => (
              <li key={gate.id} className="border-t border-[var(--color-border)] pt-3 first:border-0 first:pt-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-primary">{gate.label}</span>
                  <StatusChip {...chip(GATE_STATE_DISPLAY, gate.state)} size="sm" />
                </div>
                <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{gate.detail}</p>
                {gate.blockers.length > 0 ? (
                  <ul className="mt-1.5 space-y-1 text-xs text-[var(--color-critical-text)]">
                    {gate.blockers.map((b, i) => (
                      <li key={i}>
                        {b.reason}{' '}
                        {b.deep_link ? (
                          <Link href={b.deep_link} className="font-semibold underline underline-offset-2">
                            Go there
                          </Link>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {gate.state === 'blocked' ? (
                  <div className="mt-2">
                    <EscalateBlockerButton dealId={dealId} gate={gate.id} gateLabel={gate.label} />
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
          {liveGate ? (
            <p className="mt-4 rounded-md bg-surface-muted p-2 text-xs text-[var(--color-text-secondary)]">
              Current step: <span className="font-medium text-primary">{liveGate.label}</span>
            </p>
          ) : null}
        </section>

        <div className="space-y-6 xl:col-span-2">
          {/* --- Documents (canonical Document rows) --- */}
          <section id="documents" className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
            <h2 className="text-lg font-semibold text-primary">Documents</h2>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              The same document records the exporter sees. Approval is theirs — you prepare and file.
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="text-xs uppercase text-[var(--color-text-muted)]">
                  <tr>
                    <th className="pb-2">Document</th>
                    <th className="pb-2">Generation</th>
                    <th className="pb-2">Exporter approval</th>
                    <th className="pb-2">Filing</th>
                    <th className="pb-2">Controls</th>
                  </tr>
                </thead>
                <tbody>
                  {view.documents.map((doc) => (
                    <tr key={doc.id} className="border-t border-[var(--color-border)] align-top">
                      <td className="py-3">
                        <span className="font-medium text-primary">{doc.doc_type.replace(/_/g, ' ')}</span>
                        <span className="ml-1 text-xs text-[var(--color-text-secondary)]">v{doc.version}</span>
                      </td>
                      <td className="py-3">
                        <StatusChip {...docChip(GENERATION_STATUS_DISPLAY, doc.generation_status)} size="sm" />
                      </td>
                      {/* AC03: the exporter-facing status, read-only for the agent. */}
                      <td className="py-3">
                        <StatusChip {...docChip(APPROVAL_STATUS_DISPLAY, doc.approval_status)} size="sm" />
                      </td>
                      <td className="py-3">
                        <StatusChip {...docChip(FILING_STATUS_DISPLAY, doc.filing_status)} size="sm" />
                        {doc.filing_reference ? (
                          <p className="mt-1 select-all font-mono text-xs text-[var(--color-text-secondary)]">{doc.filing_reference}</p>
                        ) : null}
                        {doc.filed_at ? (
                          <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                            Filed {fmt(doc.filed_at)}
                            {doc.filed_by?.name ? ` by ${doc.filed_by.name}` : ''}
                          </p>
                        ) : null}
                      </td>
                      <td className="py-3 space-y-2">
                        {doc.generation_status !== 'generated' || doc.approval_status === 'rejected' ? (
                          <GatedAction verdict={verdict('document.generate')} label={doc.generation_status === 'failed' ? 'Retry' : 'Generate'}>
                            <GenerateButton dealId={dealId} documentId={doc.id} label={doc.generation_status === 'failed' ? 'Retry' : 'Generate'} compact />
                          </GatedAction>
                        ) : null}
                        {/* Filing controls only appear once the document actually exists.
                            The CHA gate is deal-wide and cannot express "this particular
                            document hasn't generated"; the route enforces the same rule. */}
                        {doc.generation_status === 'generated' &&
                        (doc.filing_status !== 'not_applicable' || doc.doc_type === 'shipping_bill_draft') ? (
                          <GatedAction verdict={verdict('document.file')} label="File with customs">
                            <FileDocumentForm
                              dealId={dealId}
                              documentId={doc.id}
                              filingStatus={doc.filing_status}
                              filingReference={doc.filing_reference}
                            />
                          </GatedAction>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* --- CHA / freight --- */}
          <section id="cha" className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
            <h2 className="text-lg font-semibold text-primary">CHA &amp; freight</h2>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              Partners come from the approved directory. Every handoff records who sent it, when, and the reference back.
            </p>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-xs uppercase text-[var(--color-text-muted)]">CHA partner</p>
                <p className="mt-0.5 text-sm text-primary">{view.shipment?.cha_partner?.display_name ?? 'Not assigned'}</p>
                <div className="mt-2">
                  <GatedAction verdict={verdict('partner.assign')} label="Assign CHA">
                    <AssignPartnerForm
                      dealId={dealId}
                      lane="cha"
                      partners={view.partners}
                      currentPartnerName={view.shipment?.cha_partner?.display_name ?? null}
                    />
                  </GatedAction>
                </div>
              </div>
              <div>
                <p className="text-xs uppercase text-[var(--color-text-muted)]">Freight partner</p>
                <p className="mt-0.5 text-sm text-primary">{view.shipment?.freight_partner?.display_name ?? 'Not assigned'}</p>
                <div className="mt-2">
                  <GatedAction verdict={verdict('partner.assign')} label="Assign freight">
                    <AssignPartnerForm
                      dealId={dealId}
                      lane="freight"
                      partners={view.partners}
                      currentPartnerName={view.shipment?.freight_partner?.display_name ?? null}
                    />
                  </GatedAction>
                </div>
              </div>
            </div>

            <h3 className="mt-5 text-sm font-semibold text-primary">Handoff log</h3>
            {handoffs.length === 0 ? (
              <p className="mt-1 text-xs text-[var(--color-text-secondary)]">No handoffs recorded yet.</p>
            ) : (
              <ul className="mt-2 space-y-3">
                {handoffs.map((h) => (
                  <li key={h.id} className="rounded-md border border-[var(--color-border)] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium text-primary">
                        {h.partner.display_name} <span className="font-normal text-[var(--color-text-secondary)]">· {h.lane}</span>
                      </span>
                      <StatusChip {...chip(HANDOFF_DISPLAY, h.status)} size="sm" />
                    </div>
                    {/* AC02: owner, status, timestamp, reference — all four, on the record. */}
                    <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                      Owner: {h.owner.name} · Sent {fmt(h.sent_at)}
                      {h.acknowledged_at ? ` · Acknowledged ${fmt(h.acknowledged_at)}` : ''}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                      Reference: {h.reference ? <span className="select-all font-mono text-primary">{h.reference}</span> : 'not yet issued'}
                    </p>
                    {h.notes ? <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{h.notes}</p> : null}
                    <HandoffStatusForm dealId={dealId} handoffId={h.id} status={h.status} reference={h.reference} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* --- Task board --- */}
          <section id="tasks" className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
            <h2 className="text-lg font-semibold text-primary">Task board</h2>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              Grouped by who owns the work. Internal tasks are separated below and never reach the exporter.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <TaskColumn title="Yours (agent)" tasks={view.tasks.agent} emptyNote="Nothing assigned to you." />
              <TaskColumn title="Exporter" tasks={view.tasks.exporter} emptyNote="Nothing waiting on the exporter." />
              <TaskColumn title="Ops" tasks={view.tasks.ops} emptyNote="No Ops tasks." />
            </div>
          </section>

          {/* --- Shipment & payment summary --- */}
          <section id="shipment" className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-primary">Shipment</h2>
              {view.shipment ? <StatusChip {...shipmentChip(SHIPMENT_STATUS_DISPLAY, view.shipment.status)} size="sm" /> : null}
            </div>
            {view.shipment ? (
              <>
                <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                  {view.shipment.mode ?? 'Mode not set'} · Booking {view.shipment.booking_ref ?? '—'} · SB{' '}
                  {view.shipment.shipping_bill_no ?? '—'}
                </p>
                {view.shipment.exception_state !== 'none' ? (
                  <p className="mt-2 rounded-md border border-[color-mix(in_srgb,var(--color-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_6%,transparent)] p-2 text-xs text-primary">
                    {view.shipment.exception_reason}
                  </p>
                ) : null}
                <ul className="mt-3 space-y-1.5">
                  {view.shipment.milestones.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="min-w-[9rem] font-medium text-primary">{m.label}</span>
                      <StatusChip label={m.state.replace(/_/g, ' ')} tone={m.state === 'complete' ? 'positive' : 'neutral'} icon={m.state === 'complete' ? 'check' : 'dot'} size="sm" />
                      <span className="text-xs text-[var(--color-text-secondary)]">
                        ETA {fmt(m.eta_at)} · Actual {fmt(m.actual_at)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3">
                  <Link href={`/app/deals/${dealId}/shipment`} className="text-sm font-medium text-primary underline underline-offset-2">
                    Open the exporter’s shipment view
                  </Link>
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">No shipment record yet.</p>
            )}
          </section>

          <section id="payment" className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
            <h2 className="text-lg font-semibold text-primary">Payment</h2>
            {view.payments.length === 0 ? (
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">No payment milestones yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {view.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="min-w-[9rem] font-medium text-primary">{p.label ?? `Milestone ${p.sequence}`}</span>
                    <span className="text-[var(--color-text-secondary)]">{money(p.amount, p.currency)}</span>
                    <StatusChip {...paymentChip(PAYMENT_STATUS_DISPLAY, p.status)} size="sm" />
                    <span className="text-xs text-[var(--color-text-secondary)]">BRC: {p.brc_status.replace(/_/g, ' ')}</span>
                  </li>
                ))}
              </ul>
            )}
            {view.insuranceCase ? (
              <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
                Insurance: {view.insuranceCase.status.replace(/_/g, ' ')}
              </p>
            ) : null}
            <p className="mt-3">
              <Link href={`/app/deals/${dealId}/payment`} className="text-sm font-medium text-primary underline underline-offset-2">
                Open the exporter’s payment view
              </Link>
            </p>
          </section>

          {/* --- Internal layer. Structurally separate: InternalNote is its own table,
                 and internal tasks were split by visibility before any grouping. --- */}
          <section className="rounded-lg border-2 border-dashed border-[var(--color-border-strong)] bg-surface-muted p-5">
            <h2 className="text-lg font-semibold text-primary">Internal only</h2>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              Never shown to the exporter. Notes live in a separate table from exporter messages.
            </p>

            {view.disputes.length > 0 ? (
              <div className="mt-4">
                <h3 className="text-sm font-semibold text-primary">Open cases</h3>
                <ul className="mt-1.5 space-y-1.5">
                  {view.disputes.map((d) => (
                    <li key={d.id} className="text-sm text-primary">
                      <span className="font-medium">{d.type}</span> · {d.summary}{' '}
                      <span className="text-xs text-[var(--color-text-secondary)]">({d.status.replace(/_/g, ' ')})</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-4">
              <h3 className="text-sm font-semibold text-primary">Internal tasks ({view.internal.tasks.length})</h3>
              {view.internal.tasks.length === 0 ? (
                <p className="mt-1 text-xs text-[var(--color-text-secondary)]">None.</p>
              ) : (
                <ul className="mt-1.5 space-y-2">
                  {view.internal.tasks.map((t) => (
                    <li key={t.id}>
                      <p className="text-sm font-medium text-primary">{t.title}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <StatusChip label="Internal" tone="neutral" icon="block" size="sm" />
                        <StatusChip label={t.state.replace(/_/g, ' ')} tone="neutral" icon="dot" size="sm" />
                      </div>
                      <div className="mt-1.5">
                        <TaskActions taskId={t.id} state={t.state} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-4">
              <h3 className="text-sm font-semibold text-primary">Internal notes ({view.internal.notes.length})</h3>
              {view.internal.notes.length > 0 ? (
                <ul className="mt-1.5 space-y-2">
                  {view.internal.notes.map((n) => (
                    <li key={n.id} className="rounded-md border border-[var(--color-border)] bg-surface p-2">
                      <p className="text-sm text-primary">{n.body}</p>
                      <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                        {n.author_name} · {fmt(n.created_at)}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-3">
                <InternalNoteForm dealId={dealId} />
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
