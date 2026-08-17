-- Explainable decision-time snapshot for buyer decisions.
--
-- A MarketAssessment is written per DiscoveryRun, so an earlier one survives a recompute and
-- the foreign key alone is enough to reconstruct what an agent overruled. A
-- BuyerFitAssessment is unique on (buyer_id, product_id, exporter_org_id) and UPSERTED, so a
-- recompute overwrites score, components, input_snapshot and computed_at in place. After that
-- the foreign key points at numbers that did not exist when the decision was made, and the
-- headline score snapshot alone cannot explain WHY the agent disagreed.
--
-- These columns therefore copy the explainable state rather than referencing it.
-- `BuyerFeatureSnapshot` is not an option as a stable reference: it is also unique per buyer
-- and updated in place, so there is no immutable per-computation row to point at.
--
-- Nullable throughout because market decisions do not populate them, and because decisions
-- recorded before this migration genuinely have no snapshot — a default would fabricate one.

ALTER TABLE "AgentDecision"
    ADD COLUMN "original_components"          JSONB,
    ADD COLUMN "original_input_snapshot"      JSONB,
    ADD COLUMN "original_input_snapshot_hash" TEXT,
    ADD COLUMN "original_computed_at"         TIMESTAMP(3),
    ADD COLUMN "original_evidence_origins"    "EvidenceOrigin"[];

-- A buyer decision must carry the explainable snapshot, because for buyers it is the only
-- surviving record. Enforced in the database rather than left to the service: the whole point
-- of the column is that it cannot be reconstructed afterwards, so a row missing it is
-- permanently unexplainable and must never be insertable.
--
-- Scoped to rows created from now on. Existing rows predate the column and cannot be
-- back-filled without inventing values, so they are exempted by timestamp rather than being
-- rewritten — this table is append-only.
ALTER TABLE "AgentDecision" ADD CONSTRAINT "AgentDecision_buyer_snapshot_required" CHECK (
    "target" <> 'buyer'
 OR "created_at" < TIMESTAMP '2026-08-18 00:00:00'
 OR ("original_components" IS NOT NULL AND "original_computed_at" IS NOT NULL)
);
