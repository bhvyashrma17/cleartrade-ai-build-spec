/**
 * AGT-04 Lead / Buyer Workspace (docs/05).
 *
 * AC01: buyer intelligence (verification status, source evidence, contact provenance)
 * renders ABOVE the contact list itself, in reading order — an agent scrolling this
 * page sees evidence before they ever reach a phone number or email to act on.
 *
 * AC02: outreach activities (exporter-visible or internal, the agent's own choice per
 * entry) and internal notes (always internal, a different table) are two visually
 * distinct feeds in the timeline, never merged into one list.
 *
 * AC03: converting creates a real `Deal` linked back via `buyer_lead_id`/`deal_id` in
 * the same transaction (`/api/v1/leads/:id/convert`) — the lead row and its full
 * activity/note history are untouched, just no longer the "active" record for this
 * relationship. This page keeps rendering that history after conversion rather than
 * hiding it, which is the actual proof the relation and history survived.
 */

import Link from 'next/link';
import { InternalNoteForm } from '@/components/agent/InternalNoteForm';
import { ConvertLeadForm } from '@/components/agent/ConvertLeadForm';
import { DisqualifyLeadForm } from '@/components/agent/DisqualifyLeadForm';
import { LogOutreachForm } from '@/components/agent/LogOutreachForm';
import { VerifyContactForm } from '@/components/agent/VerifyContactForm';
import { StatusChip } from '@/components/ui';
import { requirePrincipal } from '@/lib/auth';
import { loadLeadScoped } from '@/lib/agent-leads';
import { permits } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { LEAD_STAGE_LABELS } from '@/lib/state-machines/buyer-lead';

function fmt(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(d);
}

const VERIFICATION_DISPLAY: Record<string, { label: string; tone: 'positive' | 'warning' | 'neutral'; icon: 'check' | 'clock' | 'dot' }> = {
  verified: { label: 'Verified', tone: 'positive', icon: 'check' },
  partially_verified: { label: 'Partially verified', tone: 'warning', icon: 'clock' },
  unverified: { label: 'Unverified', tone: 'neutral', icon: 'dot' },
};

const STAGE_TONE: Record<string, 'positive' | 'info' | 'warning' | 'critical' | 'neutral'> = {
  new: 'neutral',
  shortlisted: 'neutral',
  contacted: 'info',
  replied: 'info',
  interested: 'positive',
  negotiation: 'warning',
  disqualified: 'critical',
  converted: 'positive',
};

export default async function LeadWorkspacePage({ params }: { params: Promise<{ buyerLeadId: string }> }) {
  const { buyerLeadId } = await params;
  const principal = await requirePrincipal();
  const lead = await loadLeadScoped(principal, buyerLeadId);
  const canSeeInternal = permits(principal, 'internal_note.view');

  const [full, contacts, sourceEvidence, activities, internalNotes] = await Promise.all([
    prisma.buyerLead.findUniqueOrThrow({
      where: { id: lead.id },
      include: {
        buyer: true,
        product: { include: { certifications: true } },
        exporter_org: { select: { id: true, display_name: true, readiness_status: true } },
        assigned_agent: { select: { id: true, name: true } },
        deal: { select: { id: true, stage: true } },
      },
    }),
    prisma.buyerContact.findMany({ where: { buyer_id: lead.buyer_id }, orderBy: { verification_status: 'desc' } }),
    prisma.buyerSourceEvidence.findMany({ where: { buyer_id: lead.buyer_id }, orderBy: { observed_at: 'desc' }, take: 10 }),
    prisma.outreachActivity.findMany({ where: { buyer_lead_id: lead.id }, include: { actor: { select: { name: true } } }, orderBy: { occurred_at: 'desc' } }),
    canSeeInternal
      ? prisma.internalNote.findMany({ where: { scope_type: 'buyer_lead', scope_id: lead.id }, include: { author: { select: { name: true } } }, orderBy: { created_at: 'desc' } })
      : Promise.resolve([]),
  ]);

  const riskFlags = (full.buyer.risk_flags ?? []) as { code: string; severity: string; summary: string }[];
  const verificationChip = VERIFICATION_DISPLAY[full.buyer.verification_status] ?? VERIFICATION_DISPLAY.unverified;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      {/* Lead header — persistent identity for the workspace. */}
      <header className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-primary">Lead workspace</p>
            <h1 className="text-2xl font-semibold text-primary">{full.buyer.display_name}</h1>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              <Link href={`/agent/exporters/${full.exporter_org.id}`} className="focus-visible-ring underline underline-offset-2">
                {full.exporter_org.display_name}
              </Link>
              {' · '}{full.product.name}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <StatusChip label={LEAD_STAGE_LABELS[full.stage]} tone={STAGE_TONE[full.stage]} icon={full.stage === 'disqualified' ? 'x' : full.stage === 'converted' ? 'check' : 'dot'} />
            {riskFlags.length > 0 ? <StatusChip label="Risk flagged" tone="critical" icon="alert" size="sm" detail={riskFlags.map((f) => f.summary).join(' ')} /> : null}
          </div>
        </div>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Owner: {full.assigned_agent?.name ?? 'Unassigned'}</p>
        {full.deal ? (
          <p className="mt-2 text-sm text-primary">
            Converted —{' '}
            <Link href={`/agent/deals/${full.deal.id}`} className="focus-visible-ring font-medium underline underline-offset-2">
              open the deal ({full.deal.stage.replace(/_/g, ' ')})
            </Link>
          </p>
        ) : null}
      </header>

      {/* Buyer intelligence — evidence and verification come BEFORE contacts (AC01). */}
      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-primary">Buyer intelligence</h2>
          <StatusChip {...verificationChip} />
        </div>
        {full.buyer.import_activity_summary ? (
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {Object.entries(full.buyer.import_activity_summary as Record<string, unknown>).map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs uppercase text-[var(--color-text-muted)]">{k.replace(/_/g, ' ')}</dt>
                <dd className="mt-0.5 text-primary">{String(v)}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        <h3 className="mt-4 text-sm font-semibold text-primary">Source evidence</h3>
        {sourceEvidence.length === 0 ? (
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">No sourced evidence on record.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {sourceEvidence.map((e) => (
              <li key={e.id} className="text-sm">
                <span className="font-medium text-primary">{e.source_type}</span>
                {e.source_ref ? <span className="text-[var(--color-text-secondary)]"> · {e.source_ref}</span> : null}
                {e.summary ? <p className="text-xs text-[var(--color-text-secondary)]">{e.summary}</p> : null}
                <span className="text-xs text-[var(--color-text-muted)]"> · observed {fmt(e.observed_at)}</span>
              </li>
            ))}
          </ul>
        )}

        <h3 className="mt-4 text-sm font-semibold text-primary">Contacts</h3>
        {contacts.length === 0 ? (
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">No contacts on record.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {contacts.map((c) => {
              const chip = VERIFICATION_DISPLAY[c.verification_status] ?? VERIFICATION_DISPLAY.unverified;
              return (
                <li key={c.id} className="rounded-md border border-[var(--color-border)] p-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-primary">{c.name}{c.role_title ? ` · ${c.role_title}` : ''}</span>
                    <StatusChip {...chip} size="sm" />
                  </div>
                  <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{c.email ?? '—'} {c.phone ? `· ${c.phone}` : ''}</p>
                  {/* AC01: provenance visible, right beside the data it justifies relying on. */}
                  <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                    Provenance: {c.provenance ?? 'Not recorded'} {c.verified_at ? `· verified ${fmt(c.verified_at)}` : ''}
                  </p>
                  <div className="mt-1.5">
                    <VerifyContactForm contactId={c.id} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Exporter offer — read from Product/Readiness, never re-entered here. */}
      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Exporter offer</h2>
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div><dt className="text-xs uppercase text-[var(--color-text-muted)]">Capacity</dt><dd className="text-primary">{full.product.capacity_value ? `${full.product.capacity_value} ${full.product.capacity_unit ?? ''}` : '—'}</dd></div>
          <div><dt className="text-xs uppercase text-[var(--color-text-muted)]">MOQ</dt><dd className="text-primary">{full.product.moq_value ? `${full.product.moq_value} ${full.product.moq_unit ?? ''}` : '—'}</dd></div>
          <div><dt className="text-xs uppercase text-[var(--color-text-muted)]">Target price</dt><dd className="text-primary">{full.product.price_target_amount ? `${full.product.price_target_currency ?? ''} ${full.product.price_target_amount}` : '—'}</dd></div>
          <div><dt className="text-xs uppercase text-[var(--color-text-muted)]">Packaging</dt><dd className="text-primary">{full.product.packaging ?? '—'}</dd></div>
          <div><dt className="text-xs uppercase text-[var(--color-text-muted)]">Exporter readiness</dt><dd className="text-primary">{full.exporter_org.readiness_status.replace(/_/g, ' ')}</dd></div>
        </dl>
        {full.product.certifications.length > 0 ? (
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
            Certifications: {full.product.certifications.map((c) => `${c.name} (${c.status.replace(/_/g, ' ')})`).join(', ')}
          </p>
        ) : null}
        {full.fit_score !== null ? (
          <p className="mt-2 text-sm text-primary">Fit score: <span className="font-semibold">{full.fit_score}</span> <span className="text-xs text-[var(--color-text-secondary)]">(scored at lead creation)</span></p>
        ) : null}
      </section>

      {/* Next action */}
      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Next action</h2>
        {full.next_action ? (
          <p className="mt-1 text-sm text-primary">
            {full.next_action} — <span className="text-[var(--color-text-secondary)]">owner {full.assigned_agent?.name ?? 'Unassigned'}, due {fmt(full.next_action_at)}</span>
          </p>
        ) : (
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">No next action set — log an activity below to set one.</p>
        )}
      </section>

      {/* Conversion panel — only once negotiation is reached; disqualify is always available. */}
      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Conversion</h2>
        {full.stage === 'negotiation' ? (
          <div className="mt-2">
            <ConvertLeadForm buyerLeadId={full.id} />
          </div>
        ) : full.stage === 'converted' ? (
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Already converted — see the deal link in the header.</p>
        ) : full.stage === 'disqualified' ? (
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">This lead is disqualified.</p>
        ) : (
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Conversion opens once the lead reaches &quot;In negotiation&quot;.</p>
        )}
        {full.stage !== 'converted' && full.stage !== 'disqualified' ? (
          <div className="mt-3">
            <DisqualifyLeadForm buyerLeadId={full.id} />
          </div>
        ) : null}
      </section>

      {/* Timeline — outreach activities and internal notes are two distinct feeds (AC02). */}
      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Timeline</h2>
        <div className="mt-3">
          <LogOutreachForm buyerLeadId={full.id} currentStage={full.stage} />
        </div>

        <h3 className="mt-4 text-sm font-semibold text-primary">Outreach activities ({activities.length})</h3>
        {activities.length === 0 ? (
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">No activity logged yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {activities.map((a) => (
              <li key={a.id} className="rounded-md border border-[var(--color-border)] p-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusChip label={a.type} tone="info" icon="dot" size="sm" />
                  {a.visibility === 'exporter_visible' ? (
                    <StatusChip label="Exporter-visible" tone="positive" icon="check" size="sm" />
                  ) : (
                    <StatusChip label="Internal" tone="neutral" icon="block" size="sm" />
                  )}
                </div>
                <p className="mt-1 text-sm text-primary">{a.summary}</p>
                <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{a.actor.name} · {fmt(a.occurred_at)}</p>
              </li>
            ))}
          </ul>
        )}

        {canSeeInternal ? (
          <div className="mt-4 rounded-md border-2 border-dashed border-[var(--color-border-strong)] bg-surface-muted p-3">
            <h3 className="text-sm font-semibold text-primary">Internal notes ({internalNotes.length}) — never shown to the exporter</h3>
            {internalNotes.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {internalNotes.map((n) => (
                  <li key={n.id} className="rounded-md border border-[var(--color-border)] bg-surface p-2">
                    <p className="text-sm text-primary">{n.body}</p>
                    <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{n.author.name} · {fmt(n.created_at)}</p>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-3">
              <InternalNoteForm endpoint={`/api/v1/leads/${full.id}/internal-notes`} />
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
