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
import { StatusChip } from '@/components/ui';
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
        <p className="text-sm font-medium text-primary">No shipment yet</p>
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
            <p className="text-sm font-medium text-primary">This shipment has an open issue.</p>
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
            <dd className="mt-0.5 select-all font-mono text-sm text-primary">{shipment.booking_ref ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-[var(--color-text-muted)]">Customs ref</dt>
            <dd className="mt-0.5 select-all font-mono text-sm text-primary">{shipment.customs_ref ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-[var(--color-text-muted)]">Shipping bill no.</dt>
            <dd className="mt-0.5 select-all font-mono text-sm text-primary">{shipment.shipping_bill_no ?? '—'}</dd>
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
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs uppercase text-[var(--color-text-muted)]">
              <tr>
                <th className="pb-2">Milestone</th>
                <th className="pb-2">State</th>
                <th className="pb-2">ETA</th>
                <th className="pb-2">Actual</th>
                <th className="pb-2">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {shipment.milestones.map((m) => {
                const chip = shipmentChip(MILESTONE_STATE_DISPLAY, m.state);
                const diverges = m.eta_at && m.actual_at && m.eta_at.getTime() !== m.actual_at.getTime();
                return (
                  <tr key={m.id} className="border-t border-[var(--color-border)] align-top">
                    <td className="py-3 font-medium text-primary">{MILESTONE_LABELS[m.code as keyof typeof MILESTONE_LABELS] ?? m.label}</td>
                    <td className="py-3"><StatusChip {...chip} size="sm" /></td>
                    <td className="py-3 text-[var(--color-text-secondary)]">{fmt(m.eta_at)}</td>
                    <td className="py-3 text-[var(--color-text-secondary)]">
                      {fmt(m.actual_at)}
                      {diverges ? (
                        <span className="ml-1.5 inline-block">
                          <StatusChip label="Delayed vs ETA" tone="warning" icon="alert" size="sm" />
                        </span>
                      ) : null}
                    </td>
                    <td className="py-3">
                      {m.evidence_ref ? (
                        <span className="text-xs text-[var(--color-text-secondary)]">Uploaded</span>
                      ) : (
                        <MilestoneEvidenceUpload dealId={dealId} milestoneId={m.id} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
