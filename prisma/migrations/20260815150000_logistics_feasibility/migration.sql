CREATE TYPE "LogisticsTransportMode" AS ENUM ('ocean', 'rail', 'road', 'air', 'multimodal');
CREATE TYPE "LogisticsEvidenceStatus" AS ENUM ('verified', 'needs_review', 'superseded');

ALTER TABLE "Product"
  ADD COLUMN "delivery_commitment_days" INTEGER,
  ADD COLUMN "logistics_constraint_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "logistics_constraints_confirmed" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "LogisticsRouteEvidence" (
  "id" TEXT NOT NULL,
  "origin_country" VARCHAR(2) NOT NULL,
  "origin_state" TEXT,
  "origin_city" TEXT,
  "origin_location_code" TEXT,
  "origin_gateway" TEXT,
  "destination_country" VARCHAR(2) NOT NULL,
  "destination_port" TEXT,
  "transport_mode" "LogisticsTransportMode" NOT NULL,
  "route_available" BOOLEAN NOT NULL,
  "transit_time_min_days" INTEGER,
  "transit_time_max_days" INTEGER,
  "freight_amount" DECIMAL(18,4),
  "freight_currency" VARCHAR(3),
  "freight_rate_basis" TEXT,
  "freight_retrieved_at" TIMESTAMP(3),
  "freight_valid_until" TIMESTAMP(3),
  "assumed_shipment_value_amount" DECIMAL(18,4),
  "assumed_shipment_value_currency" VARCHAR(3),
  "provider" TEXT NOT NULL,
  "source_reference" TEXT NOT NULL,
  "source_dataset_version" TEXT,
  "retrieved_at" TIMESTAMP(3) NOT NULL,
  "valid_until" TIMESTAMP(3),
  "equipment_assumption" TEXT,
  "supported_product_constraint_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "hs_code_scope" TEXT,
  "confidence" DECIMAL(5,4) NOT NULL,
  "status" "LogisticsEvidenceStatus" NOT NULL DEFAULT 'verified',
  "evidence_origin" "EvidenceOrigin" NOT NULL,
  "raw_evidence" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LogisticsRouteEvidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LogisticsRouteEvidence_provider_source_reference_key"
  ON "LogisticsRouteEvidence"("provider", "source_reference");
CREATE INDEX "LogisticsRouteEvidence_origin_country_destination_country_transport_mode_valid_until_idx"
  ON "LogisticsRouteEvidence"("origin_country", "destination_country", "transport_mode", "valid_until");
CREATE INDEX "LogisticsRouteEvidence_destination_country_hs_code_scope_status_idx"
  ON "LogisticsRouteEvidence"("destination_country", "hs_code_scope", "status");
