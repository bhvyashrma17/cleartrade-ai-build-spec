/**
 * EXP-14 Shipment & CHA Tracking. Status is a direct render of `Shipment.status`
 * (AC01) via `SHIPMENT_STATUS_DISPLAY` — nothing on this page infers it from milestones
 * or chat. The milestone timeline renders ETA and actual as two distinct columns (AC02).
 * CHA filing reference fields (booking/customs/shipping-bill refs, partner assignment)
 * are read-only here — the only exporter-facing mutation (`ConfirmPickupForm`) posts a
 * schema that cannot carry them (AC03).
 */

import { ConfirmPickupForm } from '@/components/shipment/ConfirmPickupForm';
import { MilestoneEvidenceUpload } from '@/components/shipment/MilestoneEvidenceUpload';
import { RaiseIssueButton } from '@/components/shipment/RaiseIssueButton';
import {
  EXCEPTION_STATE_DISPLAY,
  MILESTONE_STATE_DISPLAY,
  SHIPMENT_STATUS_DISPLAY,
  shipmentChip,
} from '@/components/shipment/statusDisplay';
import { StatusChip, Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui';
import { prisma } from '@/lib/prisma';
import { MILESTONE_LABELS } from '@/lib/state-machines/shipment';
import { loadDealForWorkspace } from '../loadDeal';

function fmt(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

export default async function DealShipmentPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const { deal } = await loadDealForWorkspace(dealId);
  if (!deal) return null;

  const shipment = await prisma.shipment.findFirst({
    where: { deal_id: dealId },
    include: {
      cha_partner: { select: { display_name: true } },
      freight_partner: { select: { display_name: true } },
      milestones: { orderBy: { sequence: 'asc' } },
    },
  });

  if (!shipment) {
    return (
      <section className="rounded-lg border border-dashed border-[var(--color-border-strong)] bg-surface p-8 text-center">
        <p className="text-sm font-normal text-primary">No shipment yet</p>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Shipment tracking begins once your agent creates the shipment record for this deal. There is
          nothing to show until then.
        </p>
      </section>
    );
  }

  const statusChip = shipmentChip(SHIPMENT_STATUS_DISPLAY, shipment.status);
  const exceptionChip = shipmentChip(EXCEPTION_STATE_DISPLAY, shipment.exception_state);
  const canConfirmPickup = shipment.status === 'booking';

  return (
    <div className="space-y-4">
      {shipment.exception_state !== 'none' ? (
        <div
          role="alert"
          className="rounded-lg border border-[color-mix(in_srgb,var(--color-critical)_25%,transparent)] bg-[color-mix(in_srgb,var(--color-critical)_5%,transparent)] p-4"
        >
          <div className="flex items-center gap-2">
            <StatusChip {...exceptionChip} size="sm" />
            <p className="text-sm font-normal text-primary">This shipment has an open issue.</p>
          </div>
          {shipment.exception_reason ? (
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{shipment.exception_reason}</p>
          ) : null}
        </div>
      ) : null}

      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-primary">Shipment</h2>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              {shipment.mode ? shipment.mode.replace('_', ' ') : 'Mode not set'} · {shipment.incoterm ?? 'Incoterm not set'}
            </p>
          </div>
          <span data-testid="shipment-status-chip">
            <StatusChip {...statusChip} />
          </span>
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase text-[var(--color-text-muted)]">CHA partner</dt>
            <dd className="mt-0.5 text-sm text-primary">{shipment.cha_partner?.display_name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-[var(--color-text-muted)]">Freight partner</dt>
            <dd className="mt-0.5 text-sm text-primary">{shipment.freight_partner?.display_name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-[var(--color-text-muted)]">Booking ref</dt>
            <dd className="record mt-0.5 select-all text-primary">{shipment.booking_ref ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-[var(--color-text-muted)]">Customs ref</dt>
            <dd className="record mt-0.5 select-all text-primary">{shipment.customs_ref ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-[var(--color-text-muted)]">Shipping bill no.</dt>
            <dd className="record mt-0.5 select-all text-primary">{shipment.shipping_bill_no ?? '—'}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-[var(--color-text-secondary)]">
          Filing references are set by your CHA/agent and shown here read-only.
        </p>

        {canConfirmPickup ? (
          <div className="mt-4">
            <ConfirmPickupForm dealId={dealId} />
          </div>
        ) : null}
        <div className="mt-3">
          <RaiseIssueButton dealId={dealId} />
        </div>
      </section>

      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Milestone timeline</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          ETA and actual are tracked separately for every milestone.
        </p>
        {/* PHONE: one card per milestone. ETA and actual are deliberately separate facts
            (docs/07), and a 720px table on a 375px screen puts them on opposite sides of a
            horizontal scroll — you cannot compare the two numbers the row exists to
            compare. */}
        <ul className="mt-4 space-y-3 md:hidden">
          {shipment.milestones.map((m) => {
            const chip = shipmentChip(MILESTONE_STATE_DISPLAY, m.state);
            const diverges = m.eta_at && m.actual_at && m.eta_at.getTime() !== m.actual_at.getTime();
            return (
              <li key={m.id} className="rounded-lg border border-[var(--color-border)] bg-surface-muted p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-medium text-primary">{MILESTONE_LABELS[m.code as keyof typeof MILESTONE_LABELS] ?? m.label}</p>
                  <StatusChip {...chip} size="sm" />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">ETA</dt>
                    <dd className="mt-1 text-sm text-[var(--color-text-secondary)]">{fmt(m.eta_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Actual</dt>
                    <dd className="mt-1 text-sm text-[var(--color-text-secondary)]">{fmt(m.actual_at)}</dd>
                  </div>
                </dl>
                {diverges ? <div className="mt-2"><StatusChip label="Delayed vs ETA" tone="warning" icon="alert" size="sm" /></div> : null}
                <div className="mt-3">
                  {m.evidence_ref ? (
                    <span className="text-xs text-[var(--color-text-secondary)]">Evidence uploaded</span>
                  ) : (
                    <MilestoneEvidenceUpload dealId={dealId} milestoneId={m.id} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <div className="mt-4 hidden overflow-x-auto md:block">
          <Table className="min-w-[720px]">
            <Thead className="text-xs uppercase text-[var(--color-text-muted)]">
              <Tr>
                <Th>Milestone</Th>
                <Th>State</Th>
                <Th>ETA</Th>
                <Th>Actual</Th>
                <Th>Evidence</Th>
              </Tr>
            </Thead>
            <Tbody>
              {shipment.milestones.map((m) => {
                const chip = shipmentChip(MILESTONE_STATE_DISPLAY, m.state);
                const diverges = m.eta_at && m.actual_at && m.eta_at.getTime() !== m.actual_at.getTime();
                return (
                  <Tr key={m.id} className="align-top">
                    <Td className="font-medium text-primary">{MILESTONE_LABELS[m.code as keyof typeof MILESTONE_LABELS] ?? m.label}</Td>
                    <Td><StatusChip {...chip} size="sm" /></Td>
                    <Td className="text-[var(--color-text-secondary)]">{fmt(m.eta_at)}</Td>
                    <Td className="text-[var(--color-text-secondary)]">
                      {fmt(m.actual_at)}
                      {diverges ? (
                        <span className="ml-1.5 inline-block">
                          <StatusChip label="Delayed vs ETA" tone="warning" icon="alert" size="sm" />
                        </span>
                      ) : null}
                    </Td>
                    <Td>
                      {m.evidence_ref ? (
                        <span className="text-xs text-[var(--color-text-secondary)]">Uploaded</span>
                      ) : (
                        <MilestoneEvidenceUpload dealId={dealId} milestoneId={m.id} />
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        </div>
      </section>
    </div>
  );
}
