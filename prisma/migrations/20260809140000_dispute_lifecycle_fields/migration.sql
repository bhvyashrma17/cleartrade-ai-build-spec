-- EXP-16 / OPS-06 dispute lifecycle. `waiting_on` records the waiting party/reason for
-- `investigating -> waiting_external` (docs/07 §7.7); `closure_basis` records how a case
-- was closed (exporter acceptance vs another authorized basis), distinct from the
-- resolution text itself (OPS-06-AC03).

ALTER TABLE "Dispute" ADD COLUMN "waiting_on" TEXT;
ALTER TABLE "Dispute" ADD COLUMN "closure_basis" TEXT;
