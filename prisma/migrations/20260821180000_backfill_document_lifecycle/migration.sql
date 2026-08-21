-- Add the five canonical document capabilities to deals that were locked before they existed.
--
-- Idempotency has two layers: NOT EXISTS avoids creating a second logical document when any
-- version already exists, and the established (deal_id, doc_type, version) unique constraint
-- resolves concurrent/repeated execution safely. Historical rows and snapshots are untouched.
WITH latest_snapshot AS (
  SELECT DISTINCT ON (ds."deal_id") ds."deal_id", ds."id"
  FROM "DealSnapshot" ds
  ORDER BY ds."deal_id", ds."version" DESC
), new_type AS (
  SELECT unnest(ARRAY[
    'shipping_instructions'::"DocType",
    'vgm_declaration'::"DocType",
    'bill_of_exchange'::"DocType",
    'carrier_instructions'::"DocType",
    'bank_collection_letter'::"DocType"
  ]) AS "doc_type"
)
INSERT INTO "Document" (
  "id", "deal_id", "doc_type", "version", "is_current_version", "source",
  "generation_status", "review_status", "approval_status", "filing_status",
  "generated_from_snapshot_id", "created_at", "updated_at"
)
SELECT
  'doccap_' || md5(ls."deal_id" || ':' || nt."doc_type"::text),
  ls."deal_id",
  nt."doc_type",
  1,
  TRUE,
  'generated'::"DocumentSource",
  'queued'::"GenerationStatus",
  'not_reviewed'::"ReviewStatus",
  'pending'::"ApprovalStatus",
  'not_applicable'::"FilingStatus",
  ls."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM latest_snapshot ls
CROSS JOIN new_type nt
WHERE NOT EXISTS (
  SELECT 1
  FROM "Document" existing
  WHERE existing."deal_id" = ls."deal_id"
    AND existing."doc_type" = nt."doc_type"
)
ON CONFLICT ("deal_id", "doc_type", "version") DO NOTHING;
