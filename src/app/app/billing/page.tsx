/**
 * `/app/billing` — pay the commitment fee (docs/01 §2, docs/14 §3).
 *
 * This is the page `UpgradeNotice`'s `requiredTier="paid"` CTA has always pointed at
 * (`src/components/ui/UpgradeNotice.tsx`); it did not exist before this change, so every
 * paid-tier upsell in the product was previously a dead link. Paying here is what flips
 * `ExporterOrg.tier` to `paid`, unlocking full ranked Demand Discovery and the rest of the
 * `paid`-gated surface.
 */

import { OrgTier } from '@prisma/client';
import { requireExporterPrincipal } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { CommitmentFeeCard } from './CommitmentFeeCard';

export default async function BillingPage() {
  const principal = await requireExporterPrincipal();

  const org = await prisma.exporterOrg.findUniqueOrThrow({
    where: { id: principal.exporter_org_id },
    select: {
      tier: true,
      commitment_fee_status: true,
      commitment_fee_amount: true,
      commitment_fee_currency: true,
      commitment_fee_paid_at: true,
    },
  });

  return (
    <div className="mx-auto max-w-2xl p-6">
      <header className="mb-6">
        <h1 className="font-serif text-title-page text-primary">Commitment fee</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          A one-time fee that unlocks full ranked Demand Discovery, Buyer Discovery contacts, and
          the agent-assisted workflow.
        </p>
      </header>

      <CommitmentFeeCard
        tier={org.tier}
        status={org.commitment_fee_status}
        amount={org.commitment_fee_amount?.toString() ?? null}
        currency={org.commitment_fee_currency}
        paidAt={org.commitment_fee_paid_at?.toISOString() ?? null}
        canPay={org.tier !== OrgTier.guest}
      />
    </div>
  );
}
