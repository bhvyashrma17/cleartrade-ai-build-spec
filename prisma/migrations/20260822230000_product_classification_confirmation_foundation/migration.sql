ALTER TABLE "ProductClassification"
  ADD COLUMN "product_facts_snapshot" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN "rationale" TEXT NOT NULL DEFAULT 'Legacy classification; rationale retained in evidence where available.',
  ADD COLUMN "source_references" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "ProductClassification"
  ALTER COLUMN "product_facts_snapshot" DROP DEFAULT,
  ALTER COLUMN "rationale" DROP DEFAULT,
  ALTER COLUMN "source_references" DROP DEFAULT;

ALTER TABLE "ProductClassification"
  ADD CONSTRAINT "ProductClassification_rationale_not_blank"
  CHECK (length(btrim("rationale")) > 0),
  ADD CONSTRAINT "ProductClassification_itc_hs_projection"
  CHECK ("itc_hs_code" IS NULL OR ("nomenclature" = 'ITC-HS' AND substring("itc_hs_code" from 1 for 6) = "hs6_code"));

CREATE OR REPLACE FUNCTION prevent_product_classification_basis_mutation()
RETURNS trigger AS $$
BEGIN
  IF NEW."product_id" IS DISTINCT FROM OLD."product_id"
     OR NEW."revision" IS DISTINCT FROM OLD."revision"
     OR NEW."itc_hs_code" IS DISTINCT FROM OLD."itc_hs_code"
     OR NEW."hs6_code" IS DISTINCT FROM OLD."hs6_code"
     OR NEW."nomenclature" IS DISTINCT FROM OLD."nomenclature"
     OR NEW."nomenclature_version" IS DISTINCT FROM OLD."nomenclature_version"
     OR NEW."method" IS DISTINCT FROM OLD."method"
     OR NEW."product_facts_snapshot" IS DISTINCT FROM OLD."product_facts_snapshot"
     OR NEW."evidence" IS DISTINCT FROM OLD."evidence"
     OR NEW."rationale" IS DISTINCT FROM OLD."rationale"
     OR NEW."source_references" IS DISTINCT FROM OLD."source_references"
     OR NEW."confidence" IS DISTINCT FROM OLD."confidence"
     OR NEW."proposed_by_id" IS DISTINCT FROM OLD."proposed_by_id"
     OR NEW."proposed_at" IS DISTINCT FROM OLD."proposed_at" THEN
    RAISE EXCEPTION 'ProductClassification basis is immutable; propose a new revision instead.' USING ERRCODE = '23001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ProductClassification_basis_immutable"
BEFORE UPDATE ON "ProductClassification"
FOR EACH ROW EXECUTE FUNCTION prevent_product_classification_basis_mutation();
