-- Evidence origins fail closed. Existing rows are unknown unless their fixture identity is
-- mechanically provable; no development row is promoted to real evidence.
ALTER TYPE "TradeSourceMode" ADD VALUE IF NOT EXISTS 'public_real';
ALTER TYPE "TradeSourceMode" ADD VALUE IF NOT EXISTS 'imported_real';
ALTER TYPE "TradeSourceMode" ADD VALUE IF NOT EXISTS 'manually_entered_real';

CREATE TYPE "EvidenceOrigin" AS ENUM (
  'unknown_legacy', 'fixture', 'mock', 'preview', 'authenticated_real',
  'public_real', 'imported_real', 'manually_entered_real'
);

ALTER TABLE "MarketAssessment"
  ADD COLUMN "evidence_origins" "EvidenceOrigin"[] NOT NULL DEFAULT ARRAY['unknown_legacy']::"EvidenceOrigin"[];

-- ImportRecord, buyer-intelligence, and sanctions tables are created by later historical
-- migrations. Their evidence columns are added in the post-buyer migration so a database
-- can be built from zero in timestamp order.
