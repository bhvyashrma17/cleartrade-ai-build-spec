/**
 * EXP-07 Buyer Detail.
 *
 * Same anonymous-visitor contract as Market Detail (`getPrincipal()`, not a throwing
 * guard) — a guest can view a buyer's global facts, with contacts withheld, without
 * ever registering (docs/04's own instruction: "Guest tier sees the page with contacts
 * withheld, per the existing tier projection" — reusing `tierMeets('buyer_contact.view')`
 * exactly the way `/api/v1/buyers` decides it for the list).
 *
 * Buyer has no `exporter_org_id` — it is a global entity — so there is no tenant scope
 * to fail on for the buyer read itself; `notFound()` only fires for a genuinely missing
 * id. The RELATIONSHIP data (leads, shortlists) IS tenant-scoped, queried separately.
 *
 * AC01 (global facts vs exporter-specific state visually distinct) and AC03 (risk/
 * verification never behind an optional tab) are both structural here: there are no
 * tabs on this page at all, and Risk renders as its own always-visible section in the
 * normal page flow, not inside anything collapsible.
 */

import { notFound } from 'next/navigation';
import { OrgTier } from '@prisma/client';
import { RelationshipActions } from '@/components/buyer-detail/RelationshipActions';
import { buyerChip, LEAD_STAGE_DISPLAY, VERIFICATION_DISPLAY } from '@/components/buyer-detail/statusDisplay';
import { StatusChip, UpgradeNotice } from '@/components/ui';
import { getPrincipal } from '@/lib/auth';
import { tierMeets } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { allowedEvidenceOrigins,isRealWorkflowEnvironment,nonRealEvidenceOrigins,unsafeEvidenceOrigins } from '@/lib/evidence-environment';

function fmt(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(d);
}

const RISK_SEVERITY_TONE: Record<string, 'warning' | 'critical'> = { low: 'warning', medium: 'warning', high: 'critical', critical: 'critical' };

export default async function BuyerDetailPage({ params }: { params: Promise<{ buyerId: string }> }) {
  const { buyerId } = await params;
  const principal = await getPrincipal();
  const tier = principal?.tier ?? OrgTier.guest;
  const canSeeContacts = tierMeets(tier, 'buyer_contact.view');

  const buyer = await prisma.buyer.findFirst({
    where: { id: buyerId,...(isRealWorkflowEnvironment()?{fit_assessments:{some:{score:{not:null},evidence_origins:{hasSome:allowedEvidenceOrigins()},NOT:{evidence_origins:{hasSome:nonRealEvidenceOrigins()}}}}}:{}) },
    include: {
      source_evidence: { orderBy: { observed_at: 'desc' }, take: 10 },
      import_records:{select:{evidence_origin:true}},
      ...(canSeeContacts ? { contacts: { orderBy: { verification_status: 'desc' } } } : {}),
    },
  });
  if (!buyer) notFound();

  const orgId = principal?.exporter_org_id && tier !== OrgTier.guest ? principal.exporter_org_id : null;

  const [products, leads, shortlists] = await Promise.all([
    orgId ? prisma.product.findMany({ where: { exporter_org_id: orgId,...(isRealWorkflowEnvironment()?{evidence_origin:{in:allowedEvidenceOrigins()}}:{}) }, select: { id: true, name: true }, orderBy: { name: 'asc' } }) : Promise.resolve([]),
    orgId
      ? prisma.buyerLead.findMany({
          where: { exporter_org_id: orgId, buyer_id: buyerId },
          include: { product: { select: { name: true } }, assigned_agent: { select: { name: true } } },
          orderBy: { updated_at: 'desc' },
        })
      : Promise.resolve([]),
    orgId ? prisma.buyerShortlist.findMany({ where: { exporter_org_id: orgId, buyer_id: buyerId } }) : Promise.resolve([]),
  ]);

  const riskFlags = (buyer.risk_flags ?? []) as { code: string; severity: string; summary: string }[];
  const activitySummary = buyer.import_activity_summary as Record<string, unknown> | null;
  const verificationChip = buyerChip(VERIFICATION_DISPLAY, buyer.verification_status);
  const unsafeOrigins=unsafeEvidenceOrigins([...new Set(buyer.import_records.map(row=>row.evidence_origin))]);

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      {/* Global buyer facts — never mixed with exporter-specific state below. */}
      {!isRealWorkflowEnvironment()&&unsafeOrigins.length?<p className="rounded border border-warning bg-[color-mix(in_srgb,var(--color-warning)_10%,transparent)] px-3 py-2 text-sm font-medium text-primary">Test evidence · Non-real evidence: {unsafeOrigins.join(', ')}</p>:null}
      <header className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-primary">{buyer.display_name}</h1>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{buyer.legal_name}</p>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              {buyer.country_code} · <span className="capitalize">{buyer.buyer_type.replace(/_/g, ' ')}</span>
              {buyer.website ? (
                <>
                  {' · '}
                  <a href={buyer.website} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                    {buyer.website}
                  </a>
                </>
              ) : null}
            </p>
          </div>
          <StatusChip {...verificationChip} />
        </div>
        {buyer.verification_status !== 'verified' ? (
          <p className="mt-3 rounded-md border border-[color-mix(in_srgb,var(--color-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_6%,transparent)] p-2.5 text-sm text-primary">
            This buyer is not fully verified. We recommend agent verification before outreach.
          </p>
        ) : null}
      </header>

      {/* AC03: risk is its own always-visible section — never inside a tab, never
          collapsed by default. */}
      <section className="rounded-lg border border-[color-mix(in_srgb,var(--color-critical)_20%,transparent)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Risk</h2>
        {riskFlags.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">No risk flags on record.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {riskFlags.map((f, i) => (
              <li key={i}>
                <StatusChip
                  label={`${f.severity} risk`}
                  tone={RISK_SEVERITY_TONE[f.severity] ?? 'warning'}
                  icon="alert"
                  detail={f.summary}
                  size="sm"
                />
                <p className="mt-1 text-sm text-primary">{f.summary}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Fit</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Algorithmic relevance based on buyer activity and market context.</p>
        {activitySummary ? (
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {Object.entries(activitySummary).map(([key, value]) => (
              <div key={key}>
                <dt className="text-xs uppercase text-[var(--color-text-muted)]">{key.replace(/_/g, ' ')}</dt>
                <dd className="mt-0.5 text-primary">{String(value)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">No activity summary on record for this buyer.</p>
        )}
        {leads.some((l) => l.fit_score !== null) ? (
          <p className="mt-3 text-sm text-primary">
            Fit score for your product: <span className="font-semibold">{leads.find((l) => l.fit_score !== null)?.fit_score}</span>
            <span className="ml-1 text-xs text-[var(--color-text-secondary)]">(algorithmic, scored at lead creation)</span>
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Evidence</h2>
        {buyer.source_evidence.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">No sourced evidence on record.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {buyer.source_evidence.map((e) => (
              <li key={e.id} className="border-t border-[var(--color-border)] pt-2 first:border-0 first:pt-0">
                <p className="text-sm text-primary">
                  <span className="font-medium capitalize">{e.source_type.replace(/_/g, ' ')}</span>
                  {e.source_ref ? <span className="text-[var(--color-text-secondary)]"> · {e.source_ref}</span> : null}
                </p>
                {e.summary ? <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">{e.summary}</p> : null}
                <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">Observed {fmt(e.observed_at)}</p>
              </li>
            ))}
          </ul>
        )}

        <h3 className="mt-4 text-sm font-semibold text-primary">Contacts</h3>
        {!canSeeContacts ? (
          <div className="mt-2">
            <UpgradeNotice
              title="Verified contacts need a free account"
              requiredTier="free"
              description="Create a free account to see named contacts and their verification status for this buyer."
            />
          </div>
        ) : 'contacts' in buyer && buyer.contacts.length > 0 ? (
          <ul className="mt-2 space-y-2">
            {buyer.contacts.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--color-border)] p-2.5">
                <div>
                  <p className="text-sm font-medium text-primary">{c.name}</p>
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    {c.role_title ?? 'No title'} {c.email ? `· ${c.email}` : ''}
                  </p>
                  {c.provenance ? <p className="text-xs text-[var(--color-text-secondary)]">Source: {c.provenance}</p> : null}
                </div>
                <StatusChip {...buyerChip(VERIFICATION_DISPLAY, c.verification_status)} size="sm" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">No contacts listed for this buyer.</p>
        )}
      </section>

      {/* Exporter-specific pipeline state — visually separate section, own heading,
          never merged into the global facts above (AC01). */}
      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Your relationship with this buyer</h2>

        {leads.length === 0 && shortlists.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Not shortlisted. No lead yet.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {leads.map((l) => (
              <div key={l.id} className="rounded-md border border-[var(--color-border)] p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip {...buyerChip(LEAD_STAGE_DISPLAY, l.stage)} size="sm" />
                  <span className="text-sm text-primary">{l.product.name}</span>
                </div>
                <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                  Agent: {l.assigned_agent?.name ?? 'Unassigned'}
                  {l.next_action ? ` · Next: ${l.next_action}` : ''}
                </p>
                {l.deal_id ? (
                  <p className="mt-1 text-xs text-primary">Converted to a deal.</p>
                ) : null}
              </div>
            ))}
            {shortlists.length > 0 && leads.length === 0 ? (
              <p className="text-sm text-[var(--color-text-secondary)]">Shortlisted, no lead created yet.</p>
            ) : null}
          </div>
        )}

        <div className="mt-4">
          {tier === OrgTier.guest ? (
            <UpgradeNotice variant="inline" title="Saving a lead needs a free account" requiredTier="free" />
          ) : (
            <RelationshipActions buyerId={buyer.id} products={products} isShortlisted={shortlists.length > 0} />
          )}
        </div>
      </section>
    </div>
  );
}
