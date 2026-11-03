-- D-033, docs/38 §2. Official importer lists for Real Buyer Discovery: HMRC's monthly importer
-- details (UK) and ISED's Canadian Importers Database. Forward-only and additive: two new tables and
-- one nullable unique column on Buyer, so an importer found again in a later list updates its row.

CREATE TABLE "ImporterListRelease" (
    "id" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "country_code" VARCHAR(2) NOT NULL,
    "period" TEXT NOT NULL,
    "file_manifest" JSONB NOT NULL,
    "source_url" TEXT NOT NULL,
    "source_sha256" TEXT NOT NULL,
    "source_bytes" INTEGER NOT NULL,
    "licence" TEXT NOT NULL,
    "parser_version" TEXT NOT NULL,
    "row_count" INTEGER NOT NULL,
    "validation" JSONB NOT NULL DEFAULT '{}',
    "status" "ReferenceDatasetReleaseStatus" NOT NULL DEFAULT 'active',
    "retrieved_at" TIMESTAMP(3) NOT NULL,
    "environment" TEXT NOT NULL,
    "evidence_origin" "EvidenceOrigin" NOT NULL,
    "imported_by_id" TEXT NOT NULL,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_at" TIMESTAMP(3),
    "correlation_id" TEXT,

    CONSTRAINT "ImporterListRelease_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ImporterListRelease_source_known" CHECK ("source_key" IN ('uk_hmrc_importers', 'ca_cid_major_importers'))
);

CREATE UNIQUE INDEX "ImporterListRelease_identity_key" ON "ImporterListRelease"("source_key", "source_sha256", "parser_version", "environment");
CREATE INDEX "ImporterListRelease_source_key_environment_status_period_idx" ON "ImporterListRelease"("source_key", "environment", "status", "period");

CREATE TABLE "ImporterListEntry" (
    "id" TEXT NOT NULL,
    "release_id" TEXT NOT NULL,
    "entity_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address_lines" TEXT[],
    "town" TEXT,
    "postcode" TEXT,
    "region_code" TEXT,
    "region_name" TEXT,
    "hs_codes" TEXT[],
    "hs6_codes" TEXT[],
    "origin_hs6" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "ImporterListEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ImporterListEntry_release_id_entity_key_key" ON "ImporterListEntry"("release_id", "entity_key");
CREATE INDEX "ImporterListEntry_hs6_codes_idx" ON "ImporterListEntry" USING GIN ("hs6_codes" array_ops);
CREATE INDEX "ImporterListEntry_origin_hs6_idx" ON "ImporterListEntry" USING GIN ("origin_hs6" array_ops);

ALTER TABLE "ImporterListEntry" ADD CONSTRAINT "ImporterListEntry_release_id_fkey"
    FOREIGN KEY ("release_id") REFERENCES "ImporterListRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Buyer" ADD COLUMN "source_entity_key" TEXT;
CREATE UNIQUE INDEX "Buyer_source_entity_key_key" ON "Buyer"("source_entity_key");
