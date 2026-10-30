/**
 * AGT-02 Exporter 360 — the agent's home base for one assigned exporter (docs/05).
 *
 * AC01: access is enforced once, in `loadExporterAccountScoped()`, shared with the
 * `GET /api/v1/exporters/:id` route — an out-of-tenant id 404s here exactly the way it
 * 404s there, because both call the same function rather than reimplementing the check.
 *
 * AC03: every section below is a direct read of the canonical model the exporter/ops
 * portals also read — `Product`, `Task`, `Deal`, `BuyerLead`, `Dispute`,
 * `AgentAssignment`, `AuditEvent` — never a summarized or agent-local copy. The one
 * derived value on the page (`health`) is computed from `Deal.risk_state` at render
 * time, not stored anywhere, so it can never drift from what the deal workspace shows.
 */

import Link from 'next/link';
import { TaskState, UserRole, Visibility } from '@prisma/client';
import { CreateTaskForm } from '@/components/agent/CreateTaskForm';
import { InternalNoteForm } from '@/components/agent/InternalNoteForm';
import { MessageForm } from '@/components/agent/MessageForm';
import { ProductQuickEditForm } from '@/components/agent/ProductQuickEditForm';
import {ProductClassificationForm} from '@/components/agent/ProductClassificationForm';
import { Card, MetricCard, PageHeader, StatusChip } from '@/components/ui';
import { BuyerDiscoveryControl } from '@/components/agent/BuyerDiscoveryControl';
import { FindBuyersForm, type FindBuyersMarket } from '@/components/agent/FindBuyersForm';
import { activeImporterLists } from '@/lib/buyer-discovery/importer-list-service';
import { IMPORTER_LIST_SOURCES } from '@/lib/buyer-discovery/importer-lists';
import { CountryTruthWork } from '@/components/agent/CountryTruthWork';
import { buyerControlRows } from '@/lib/buyer-control';
import { activeOnly as activeOnlyCandidates } from '@/lib/demand-control';
import { requirePrincipal } from '@/lib/auth';
import { loadExporterAccountScoped } from '@/lib/agent-accounts';
import { permits } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { LEAD_STAGE_LABELS } from '@/lib/state-machines/buyer-lead';
import { DEAL_STAGE_LABELS } from '@/lib/state-machines/deal';

function fmt(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(d);
}

const JOURNEY_LABELS: Record<string, string> = {
  onboarding: 'Onboarding',
  ready: 'Ready',
  market_selected: 'Market selected',
  buyer_engaged: 'Buyer engaged',
  deal_locked: 'Deal locked',
  docs_cleared: 'Docs cleared',
  shipped: 'Shipped',
  payment_realized: 'Payment realized',
};

const OWNER_LANE_LABELS: Record<string, string> = {
  agent: 'Agent',
  exporter_owner: 'Exporter',
  exporter_member: 'Exporter',
  ops_supervisor: 'Ops',
};

export default async function ExporterAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ exporterOrgId: string }>;
  searchParams: Promise<{ tab?: string; view?: string }>;
}) {
  const { exporterOrgId } = await params;
  const { tab, view } = await searchParams;
  const activeTab = tab === 'demand' ? 'demand' : tab === 'buyers' ? 'buyers' : 'overview';
  const showAll = view === 'all';
  const principal = await requirePrincipal();
  const { org } = await loadExporterAccountScoped(principal, exporterOrgId);
  const canSeeInternal = permits(principal, 'internal_note.view');

  const [
    deals,
    leadStageCounts,
    highPriorityLeads,
    tasks,
    disputes,
    shipments,
    latestDiscoveryRun,
    savedMarkets,
    assignments,
    auditEvents,
    internalNotes,
    lastMessage,
  ] = await Promise.all([
    prisma.deal.findMany({
      where: { exporter_org_id: org.id },
      include: { buyer: { select: { display_name: true } }, product: { select: { name: true } } },
      orderBy: { updated_at: 'desc' },
    }),
    prisma.buyerLead.groupBy({ by: ['stage'], where: { exporter_org_id: org.id }, _count: true }),
    prisma.buyerLead.findMany({
      where: { exporter_org_id: org.id, interest_level: 'high', stage: { notIn: ['converted', 'disqualified'] } },
      include: { buyer: { select: { display_name: true } }, product: { select: { name: true } } },
      orderBy: { updated_at: 'desc' },
      take: 5,
    }),
    prisma.task.findMany({
      where: { exporter_org_id: org.id, state: { notIn: [TaskState.done, TaskState.cancelled] } },
      include: { owner: { select: { name: true } }, deal: { select: { id: true } } },
      orderBy: [{ sla_state: 'desc' }, { due_at: { sort: 'asc', nulls: 'last' } }],
    }),
    prisma.dispute.findMany({ where: { deal: { exporter_org_id: org.id } }, select: { id: true, type: true, status: true, severity: true, summary: true } }),
    prisma.shipment.findMany({ where: { deal: { exporter_org_id: org.id } }, select: { id: true, status: true } }),
    prisma.discoveryRun.findFirst({ where: { exporter_org_id: org.id }, orderBy: { created_at: 'desc' }, select: { id: true, status: true, created_at: true } }),
    prisma.marketAssessment.findMany({
      where: { run: { exporter_org_id: org.id }, OR: [{ is_selected: true }, { saved_at: { not: null } }] },
      select: { country_code: true, overall_score: true, is_selected: true },
      take: 10,
    }),
    prisma.agentAssignment.findMany({ where: { exporter_org_id: org.id }, include: { agent: { select: { name: true } }, assigned_by: { select: { name: true } } }, orderBy: { started_at: 'desc' } }),
    prisma.auditEvent.findMany({
      where: { exporter_org_id: org.id, object_type: { in: ['deal', 'task', 'document', 'shipment', 'payment', 'buyer_lead'] } },
      orderBy: { timestamp: 'desc' },
      include: { actor: { select: { name: true } } },
      take: 30,
    }),
    canSeeInternal
      ? prisma.internalNote.findMany({ where: { scope_type: 'exporter_org', scope_id: org.id }, include: { author: { select: { name: true } } }, orderBy: { created_at: 'desc' } })
      : Promise.resolve([]),
    prisma.message.findFirst({ where: { exporter_org_id: org.id }, orderBy: { created_at: 'desc' }, select: { created_at: true } }),
  ]);

  const health = deals.some((d) => d.risk_state === 'blocked')
    ? { label: 'Blocked', tone: 'critical' as const }
    : deals.some((d) => d.risk_state === 'at_risk')
      ? { label: 'At risk', tone: 'warning' as const }
      : { label: 'Normal', tone: 'positive' as const };

  const activeDeals = deals.filter((d) => ['negotiating', 'terms_agreed', 'deal_locked', 'executing'].includes(d.stage));

  const tasksByLane = {
    agent: tasks.filter((t) => t.owner_role === UserRole.agent),
    exporter: tasks.filter((t) => t.owner_role === UserRole.exporter_owner || t.owner_role === UserRole.exporter_member),
    ops: tasks.filter((t) => t.owner_role === UserRole.ops_supervisor),
  };

  // Timeline: AuditEvent rows plus AgentAssignment history, merged by time — the same
  // "the timeline is the real objects, not a summary" rule AC03 applies to every other
  // section on this page.
  type TimelineRow = { at: Date; label: string; detail: string };
  const timeline: TimelineRow[] = [
    ...auditEvents.map((e) => ({
      at: e.timestamp,
      label: `${e.object_type.replace(/_/g, ' ')} ${e.action.replace(/_/g, ' ')}`,
      detail: e.actor?.name ?? 'ClearTrade',
    })),
    ...assignments.map((a) => ({
      at: a.started_at,
      label: a.ended_at ? 'Assignment ended' : 'Agent assigned',
      detail: `${a.agent.name}${a.assigned_by ? ` · by ${a.assigned_by.name}` : ''}${a.reason ? ` · ${a.reason}` : ''}`,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  const readiness = org.readiness_assessments[0] ?? null;
  const blockers = (readiness?.blockers ?? []) as { code: string; severity: string; summary: string }[];

  // Tenant- and assignment-safe: buyerControlRows asserts org access through the same helper
  // every other org-scoped read uses, so this cannot surface an unassigned exporter's buyers.
  const buyerRows = activeTab === 'buyers' ? await buyerControlRows(principal, exporterOrgId) : [];
  // D-033: the markets an official importer list covers, and whether one is imported here yet.
  const canFindBuyers = activeTab === 'buyers' && permits(principal, 'buyer_discovery.run');
  const buyerMarkets: FindBuyersMarket[] = canFindBuyers
    ? await Promise.all(Object.values(IMPORTER_LIST_SOURCES).map(async (source) => ({
        code: source.country_code,
        name: source.country_code === 'GB' ? 'United Kingdom' : source.country_code === 'CA' ? 'Canada' : source.country_code,
        unavailable: (await activeImporterLists(source.key)).length ? null : `No ${source.label} list has been imported on this environment yet.`,
      })))
    : [];
  const buyerProducts = org.products
    .filter((p) => p.hs_classification_status === 'confirmed' && p.hs_code && /^\d{6}$/.test(p.hs_code))
    .map((p) => ({ id: p.id, name: p.name, hs6: p.hs_code! }));
  const visibleBuyerRows = showAll ? buyerRows : activeOnlyCandidates(buyerRows);

  return (
    <div className="space-y-4 py-4 md:py-6">
      {/* Account header */}
      <Card as="header" elevated>
        <PageHeader
          eyebrow="Exporter 360"
          title={org.display_name}
          description={`${org.city ? `${org.city}, ` : ''}${org.state ?? ''} · ${org.country}`}
          actions={<StatusChip label={health.label} tone={health.tone} icon={health.tone === 'positive' ? 'check' : 'alert'} />}
        />
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <span className="text-[var(--color-text-secondary)]">
            Assignment: {org.assigned_agent ? <span className="text-primary">{org.assigned_agent.name}</span> : <span className="text-[var(--color-critical-text)]">Unassigned</span>}
          </span>
          <span className="text-[var(--color-text-secondary)]">Readiness: <span className="text-primary">{org.readiness_status.replace(/_/g, ' ')}</span>{readiness?.score !== null && readiness?.score !== undefined ? ` (${readiness.score})` : ''}</span>
          <span className="text-[var(--color-text-secondary)]">Journey: <span className="text-primary">{JOURNEY_LABELS[org.journey_stage] ?? org.journey_stage}</span></span>
          <span className="text-[var(--color-text-secondary)]">Latest contact: <span className="text-primary">{fmt(lastMessage?.created_at ?? null)}</span></span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <CreateTaskForm exporterOrgId={org.id} />
        </div>
      </Card>

      {/* Exporter-scoped sections are tabs, not routes: they always concern ONE exporter, so
          nesting them keeps a single assignment check and a single data load. */}
      <nav aria-label="Exporter sections" className="flex gap-1 border-b border-[var(--color-border)]">
        {([['overview', 'Overview'], ['demand', 'Demand Discovery'], ['buyers', 'Buyer Discovery']] as const).map(([key, label]) => (
          <a
            key={key}
            href={`?tab=${key}`}
            aria-current={activeTab === key ? 'page' : undefined}
            className={`focus-visible-ring rounded-t px-3 py-2 text-sm font-medium ${
              activeTab === key
                ? 'border-b-2 border-primary text-primary'
                : 'text-[var(--color-text-secondary)] hover:text-primary'
            }`}
          >
            {label}
          </a>
        ))}
      </nav>

      {activeTab === 'demand' ? (
        <div className="space-y-4">
        {/* The full AI-vs-decision table for all markets moved behind "Manage market decisions"
            on each product — it is also now scoped to THAT product's own run rather than the
            org's most recently run product, which is what `latestDiscoveryRun` gave every
            product before this. See CountryTruthWork and the per-product `markets/manage` route. */}
        <CountryTruthWork exporterOrgId={org.id} />
        </div>
      ) : activeTab === 'buyers' ? (
        <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
          <h2 className="text-lg font-semibold text-primary">Buyer Discovery control</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Three separate layers: what the model recommends, what ClearTrade is operationally
            doing, and what agents have decided. Agent decisions never change the AI score.
          </p>
          {canFindBuyers ? (
            <div className="mt-4">
              <FindBuyersForm exporterOrgId={org.id} products={buyerProducts} markets={buyerMarkets} />
            </div>
          ) : null}
          <div className="mt-4">
            <BuyerDiscoveryControl
              rows={visibleBuyerRows}
              showAll={showAll}
              totalCount={buyerRows.length}
            />
          </div>
        </section>
      ) : (
        <>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* Products / commercial profile */}
        <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card xl:col-span-2">
          <h2 className="text-lg font-semibold text-primary">Products &amp; commercial profile</h2>
          {org.products.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">No products on record.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {org.products.map((p) => (
                <li key={p.id} className="rounded-md border border-[var(--color-border)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-normal text-primary">{p.name}</p>
                    <span className="text-xs text-[var(--color-text-secondary)]">HS <span className="record">{p.hs_code ?? 'unassigned'}</span> ({p.hs_code_source})</span>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-[var(--color-text-secondary)] sm:grid-cols-3">
                    <div><dt className="uppercase text-[var(--color-text-muted)]">Capacity</dt><dd className="text-primary">{p.capacity_value ? `${p.capacity_value} ${p.capacity_unit ?? ''}` : '—'}</dd></div>
                    <div><dt className="uppercase text-[var(--color-text-muted)]">MOQ</dt><dd className="text-primary">{p.moq_value ? `${p.moq_value} ${p.moq_unit ?? ''}` : '—'}</dd></div>
                    <div><dt className="uppercase text-[var(--color-text-muted)]">Target price</dt><dd className="text-primary">{p.price_target_amount ? `${p.price_target_currency ?? ''} ${p.price_target_amount}` : '—'}</dd></div>
                    <div><dt className="uppercase text-[var(--color-text-muted)]">Lead time</dt><dd className="text-primary">{p.lead_time_days ? `${p.lead_time_days} days` : '—'}</dd></div>
                    <div><dt className="uppercase text-[var(--color-text-muted)]">Desired order</dt><dd className="text-primary">{p.desired_order_size_amount ? `${p.desired_order_size_currency ?? ''} ${p.desired_order_size_amount}` : '—'}</dd></div>
                    <div><dt className="uppercase text-[var(--color-text-muted)]">Customization</dt><dd className="text-primary">{p.customization_capability ?? '—'}</dd></div>
                    <div><dt className="uppercase text-[var(--color-text-muted)]">Packaging capability</dt><dd className="text-primary">{p.packaging_capability ?? '—'}</dd></div>
                  </dl>
                  {p.certifications.length > 0 ? (
                    <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
                      Certifications: {p.certifications.map((c) => `${c.name} (${c.status.replace(/_/g, ' ')})`).join(', ')}
                    </p>
                  ) : null}
                  <div className="mt-2">
                    <ProductQuickEditForm
                      exporterOrgId={org.id}
                      productId={p.id}
                      initial={{
                        capacity_value: p.capacity_value?.toString() ?? '',
                        capacity_unit: p.capacity_unit ?? '',
                        moq_value: p.moq_value?.toString() ?? '',
                        moq_unit: p.moq_unit ?? '',
                        price_target_amount: p.price_target_amount?.toString() ?? '',
                        price_target_currency: p.price_target_currency ?? '',
                        price_target_quantity_unit: p.price_target_quantity_unit ?? '',
                        price_target_incoterm: p.price_target_incoterm ?? '',
                        lead_time_days: p.lead_time_days?.toString() ?? '',
                        delivery_commitment_days: p.delivery_commitment_days?.toString() ?? '',
                        desired_order_size_amount: p.desired_order_size_amount?.toString() ?? '',
                        desired_order_size_currency: p.desired_order_size_currency ?? '',
                        customization_capability: p.customization_capability ?? '',
                        packaging_capability: p.packaging_capability ?? '',
                        packaging: p.packaging ?? '',
                      }}
                    />
                  </div>
                  <ProductClassificationForm productId={p.id} status={p.hs_classification_status}/>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Discovery summary */}
        <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
          <h2 className="text-lg font-semibold text-primary">Discovery summary</h2>
          {latestDiscoveryRun ? (
            <p className="mt-2 text-sm text-primary">
              Latest run: {latestDiscoveryRun.status} · {fmt(latestDiscoveryRun.created_at)}
            </p>
          ) : (
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">No discovery runs yet.</p>
          )}
          {savedMarkets.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {savedMarkets.map((m, i) => (
                <li key={i}><StatusChip label={`${m.country_code} · ${m.overall_score}`} tone="info" icon="dot" size="sm" /></li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-[var(--color-text-secondary)]">No markets saved/selected yet.</p>
          )}
        </section>
      </div>

      {/* Execution readiness */}
      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Execution readiness</h2>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span className="text-[var(--color-text-secondary)]">IEC: <span className="text-primary">{org.iec.replace(/_/g, ' ')}</span></span>
          <span className="text-[var(--color-text-secondary)]">GSTIN: <span className="text-primary">{org.gstin ?? 'Not on file'}</span></span>
        </div>
        {blockers.length > 0 ? (
          <ul className="mt-3 space-y-1.5">
            {blockers.map((b, i) => (
              <li key={i}><StatusChip label={b.summary} tone={b.severity === 'critical' || b.severity === 'high' ? 'critical' : 'warning'} icon="alert" size="sm" /></li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">No open readiness gaps on the current assessment.</p>
        )}
      </section>

      {/* Buyer pipeline */}
      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-primary">Buyer pipeline</h2>
          <Link href={`/agent/outreach?exporter=${org.id}`} className="focus-visible-ring text-sm font-medium text-primary underline underline-offset-2">
            Open in Outreach CRM
          </Link>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {leadStageCounts.map((s) => (
            <StatusChip key={s.stage} label={`${LEAD_STAGE_LABELS[s.stage] ?? s.stage}: ${s._count}`} tone="neutral" icon="dot" size="sm" />
          ))}
          {leadStageCounts.length === 0 ? <p className="text-sm text-[var(--color-text-secondary)]">No leads yet.</p> : null}
        </div>
        {highPriorityLeads.length > 0 ? (
          <ul className="mt-3 space-y-1.5">
            {highPriorityLeads.map((l) => (
              <li key={l.id}>
                <Link href={`/agent/leads/${l.id}`} className="focus-visible-ring text-sm font-medium text-primary underline underline-offset-2">
                  {l.buyer.display_name}
                </Link>
                <span className="ml-2 text-xs text-[var(--color-text-secondary)]">{l.product.name} · {LEAD_STAGE_LABELS[l.stage]}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* Deals */}
      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Deals</h2>
        {activeDeals.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">No negotiating or executing deals.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {activeDeals.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] pb-2 last:border-0">
                <Link href={`/agent/deals/${d.id}`} className="focus-visible-ring text-sm font-medium text-primary underline underline-offset-2">
                  {d.buyer.display_name} · {d.product?.name ?? 'No product'}
                </Link>
                <StatusChip label={DEAL_STAGE_LABELS[d.stage]} tone={d.risk_state === 'blocked' ? 'critical' : d.risk_state === 'at_risk' ? 'warning' : 'neutral'} icon="dot" size="sm" />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Tasks & blockers — agent/exporter/ops separated */}
      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Tasks &amp; blockers</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          {(['agent', 'exporter', 'ops'] as const).map((lane) => (
            <div key={lane}>
              <h3 className="text-sm font-semibold text-primary">{OWNER_LANE_LABELS[lane === 'exporter' ? 'exporter_owner' : lane === 'agent' ? 'agent' : 'ops_supervisor']} ({tasksByLane[lane].length})</h3>
              {tasksByLane[lane].length === 0 ? (
                <p className="mt-1 text-xs text-[var(--color-text-secondary)]">None.</p>
              ) : (
                <ul className="mt-1.5 space-y-1.5">
                  {tasksByLane[lane].map((t) => (
                    <li key={t.id} className="text-sm">
                      <span className="text-primary">{t.title}</span>
                      {t.visibility === Visibility.internal ? <StatusChip label="Internal" tone="neutral" icon="block" size="sm" className="ml-1.5" /> : null}
                      {t.blocked_reason ? <p className="text-xs text-[var(--color-critical-text)]">Blocked: {t.blocked_reason}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* History */}
      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">History</h2>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <MetricCard label="Shipments" value={shipments.length} secondaryText={`${shipments.filter((s) => s.status === 'delivered').length} delivered`} />
          <MetricCard label="Disputes" value={disputes.length} secondaryText={`${disputes.filter((d) => !['resolved', 'closed'].includes(d.status)).length} open`} />
          <MetricCard label="Deals total" value={deals.length} />
        </div>
      </section>

      {/* Communication — the two composition modes side by side, deliberately styled
          as opposites (AC02). */}
      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Communication</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <MessageForm endpoint={`/api/v1/exporters/${org.id}/messages`} />
          {canSeeInternal ? <InternalNoteForm endpoint={`/api/v1/exporters/${org.id}/internal-notes`} /> : null}
        </div>
        {canSeeInternal && internalNotes.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {internalNotes.map((n) => (
              <li key={n.id} className="rounded-md border border-[var(--color-border)] bg-surface-muted p-2">
                <p className="text-sm text-primary">{n.body}</p>
                <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{n.author.name} · {fmt(n.created_at)}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* Timeline */}
      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Timeline</h2>
        {timeline.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">No recorded account events yet.</p>
        ) : (
          <ol className="mt-3 space-y-2 border-l border-[var(--color-border)] pl-4">
            {timeline.map((e, i) => (
              <li key={i}>
                <p className="text-sm font-normal capitalize text-primary">{e.label}</p>
                <p className="text-xs text-[var(--color-text-secondary)]">{fmt(e.at)} · {e.detail}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
        </>
      )}
    </div>
  );
}
