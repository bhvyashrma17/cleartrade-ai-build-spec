-- Existing prices are deliberately left without a quantity or Incoterm basis.
-- They remain unavailable to Export Economics until explicitly completed; this
-- migration does not infer commercial semantics for legacy Product rows.
ALTER TABLE "Product"
  ADD COLUMN "price_target_quantity_unit" TEXT,
  ADD COLUMN "price_target_incoterm" VARCHAR(3);

