-- AlterTable
ALTER TABLE "ExporterOrg" ADD COLUMN     "commitment_fee_amount" DECIMAL(18,4),
ADD COLUMN     "commitment_fee_currency" VARCHAR(3),
ADD COLUMN     "commitment_fee_due_at" TIMESTAMP(3),
ADD COLUMN     "commitment_fee_paid_at" TIMESTAMP(3),
ADD COLUMN     "commitment_fee_policy_version" INTEGER,
ADD COLUMN     "commitment_fee_source" "PaymentSource",
ADD COLUMN     "commitment_fee_status" "CommitmentFeeStatus" NOT NULL DEFAULT 'not_due';

-- Backfill: this column default is 'not_due' because that is correct for a brand-new
-- guest row, but every pre-existing row was created under an earlier assumption where
-- tier alone gated access. Without this, a pre-existing 'paid' org would suddenly show
-- an unpaid commitment fee, and a pre-existing 'free' org would show no CTA to pay one.
-- Same precedent as the tier backfill in 20260806172138_guest_freemium_tier.
--
-- paid  -> already had full access; treat the fee as settled (source: manual_ops, i.e.
--          "grandfathered", not a self-reported or bank-confirmed payment).
-- free  -> registered but tier never depended on the fee before this migration; the fee
--          becomes due now, exactly as it would for a brand-new registration.
-- guest -> stays 'not_due' (the column default already covers this).
UPDATE "ExporterOrg" o
SET "commitment_fee_status" = 'paid',
    "commitment_fee_amount" = fp."commitment_fee_amount",
    "commitment_fee_currency" = fp."commitment_fee_currency",
    "commitment_fee_policy_version" = fp."version",
    "commitment_fee_source" = 'manual_ops',
    "commitment_fee_due_at" = o."created_at",
    "commitment_fee_paid_at" = now()
FROM "FeePolicy" fp
WHERE o."tier" = 'paid'
  AND fp."is_active" = true
  AND fp."version" = (SELECT MAX(version) FROM "FeePolicy" WHERE "is_active" = true);

UPDATE "ExporterOrg" o
SET "commitment_fee_status" = 'due',
    "commitment_fee_amount" = fp."commitment_fee_amount",
    "commitment_fee_currency" = fp."commitment_fee_currency",
    "commitment_fee_policy_version" = fp."version",
    "commitment_fee_due_at" = now()
FROM "FeePolicy" fp
WHERE o."tier" = 'free'
  AND fp."is_active" = true
  AND fp."version" = (SELECT MAX(version) FROM "FeePolicy" WHERE "is_active" = true);
