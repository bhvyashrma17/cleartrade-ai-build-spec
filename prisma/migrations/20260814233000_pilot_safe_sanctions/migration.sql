CREATE TYPE "SanctionsCompletenessStatus" AS ENUM ('COMPLETE','PARTIAL','FAILED','STALE');
CREATE TYPE "SanctionsScreeningResultState" AS ENUM ('clear','possible_match','confirmed_match','insufficient_screening_coverage');
CREATE TYPE "SanctionsReviewDecisionValue" AS ENUM ('confirmed_match','false_positive','needs_more_information');

ALTER TABLE "SanctionsSourceSnapshot"
  ADD COLUMN "retrieved_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "parsed_entity_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "rejected_records" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "parse_errors" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "last_successful_full_refresh" TIMESTAMP(3),
  ADD COLUMN "source_update_date" TIMESTAMP(3),
  ADD COLUMN "source_version" TEXT,
  ADD COLUMN "completeness_status" "SanctionsCompletenessStatus" NOT NULL DEFAULT 'FAILED';

ALTER TABLE "SanctionsEntity"
  ADD COLUMN "aliases" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "countries" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "addresses" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "dates" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "identifiers" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "programs" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "remarks" TEXT,
  ADD COLUMN "source_published_at" TIMESTAMP(3),
  ADD COLUMN "source_version" TEXT;

CREATE TABLE "SanctionsScreeningCase" (
  "id" TEXT NOT NULL, "buyer_id" TEXT, "searched_name" TEXT NOT NULL,
  "normalized_name" TEXT NOT NULL, "searched_country" TEXT, "searched_address" TEXT,
  "searched_entity_type" TEXT, "searched_identifiers" JSONB NOT NULL DEFAULT '[]',
  "result_state" "SanctionsScreeningResultState" NOT NULL, "source_entity_id" TEXT,
  "evidence" JSONB NOT NULL, "algorithm_version" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "resolved_at" TIMESTAMP(3),
  CONSTRAINT "SanctionsScreeningCase_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SanctionsReviewDecision" (
  "id" TEXT NOT NULL, "screening_case_id" TEXT NOT NULL, "reviewer_user_id" TEXT NOT NULL,
  "decision" "SanctionsReviewDecisionValue" NOT NULL, "reason" TEXT NOT NULL,
  "evidence" JSONB, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SanctionsReviewDecision_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SanctionsScreeningCase_result_state_created_at_idx" ON "SanctionsScreeningCase"("result_state","created_at");
CREATE INDEX "SanctionsScreeningCase_buyer_id_created_at_idx" ON "SanctionsScreeningCase"("buyer_id","created_at");
CREATE INDEX "SanctionsReviewDecision_screening_case_id_created_at_idx" ON "SanctionsReviewDecision"("screening_case_id","created_at");
CREATE INDEX "SanctionsReviewDecision_reviewer_user_id_created_at_idx" ON "SanctionsReviewDecision"("reviewer_user_id","created_at");
ALTER TABLE "SanctionsScreeningCase" ADD CONSTRAINT "SanctionsScreeningCase_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "Buyer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SanctionsScreeningCase" ADD CONSTRAINT "SanctionsScreeningCase_source_entity_id_fkey" FOREIGN KEY ("source_entity_id") REFERENCES "SanctionsEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SanctionsReviewDecision" ADD CONSTRAINT "SanctionsReviewDecision_screening_case_id_fkey" FOREIGN KEY ("screening_case_id") REFERENCES "SanctionsScreeningCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SanctionsReviewDecision" ADD CONSTRAINT "SanctionsReviewDecision_reviewer_user_id_fkey" FOREIGN KEY ("reviewer_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing snapshots did not record enough parser evidence to prove completeness.
UPDATE "SanctionsSourceSnapshot" SET "completeness_status"='PARTIAL', "coverage_complete"=false,
  "retrieved_count"="record_count", "parsed_entity_count"=0,
  "parse_errors"='["Legacy snapshot lacks source-specific parse metrics"]';
