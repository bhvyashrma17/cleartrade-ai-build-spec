-- Universal commercial/logistics facts for physical goods. All new facts are nullable (or
-- empty lists) so absence remains unknown and existing products are not assigned invented data.
ALTER TABLE "Product"
  ADD COLUMN "commercial_quantity_unit" TEXT,
  ADD COLUMN "piece_unit_name" TEXT,
  ADD COLUMN "desired_order_quantity_value" DECIMAL(18,4),
  ADD COLUMN "desired_order_quantity_unit" TEXT,
  ADD COLUMN "customization_available" BOOLEAN,
  ADD COLUMN "private_label_available" BOOLEAN,
  ADD COLUMN "packaging_customization_available" BOOLEAN,
  ADD COLUMN "units_per_package" INTEGER,
  ADD COLUMN "package_weight_value" DECIMAL(18,4),
  ADD COLUMN "package_weight_unit" TEXT,
  ADD COLUMN "package_volume_value" DECIMAL(18,4),
  ADD COLUMN "package_volume_unit" TEXT,
  ADD COLUMN "carton_configuration" TEXT,
  ADD COLUMN "pallet_configuration" TEXT,
  ADD COLUMN "transport_mode_compatibility" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "fragile" BOOLEAN,
  ADD COLUMN "perishable" BOOLEAN,
  ADD COLUMN "hazardous" BOOLEAN,
  ADD COLUMN "dangerous_goods_un_number" TEXT,
  ADD COLUMN "dangerous_goods_hazard_class" TEXT,
  ADD COLUMN "unit_net_weight_value" DECIMAL(18,4),
  ADD COLUMN "unit_net_weight_unit" TEXT,
  ADD COLUMN "unit_gross_weight_value" DECIMAL(18,4),
  ADD COLUMN "unit_gross_weight_unit" TEXT,
  ADD COLUMN "unit_length_value" DECIMAL(18,4),
  ADD COLUMN "unit_width_value" DECIMAL(18,4),
  ADD COLUMN "unit_height_value" DECIMAL(18,4),
  ADD COLUMN "unit_dimension_unit" TEXT,
  ADD COLUMN "unit_volume_value" DECIMAL(18,4),
  ADD COLUMN "unit_volume_unit" TEXT,
  ADD COLUMN "available_capacity_unit" TEXT;

ALTER TABLE "ProductCertification"
  ADD COLUMN "issue_date" TIMESTAMP(3),
  ADD COLUMN "declaration_state" TEXT NOT NULL DEFAULT 'unknown';

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_units_per_package_positive" CHECK ("units_per_package" IS NULL OR "units_per_package" > 0),
  ADD CONSTRAINT "Product_physical_values_positive" CHECK (
    ("package_weight_value" IS NULL OR "package_weight_value" > 0) AND
    ("package_volume_value" IS NULL OR "package_volume_value" > 0) AND
    ("unit_net_weight_value" IS NULL OR "unit_net_weight_value" > 0) AND
    ("unit_gross_weight_value" IS NULL OR "unit_gross_weight_value" > 0) AND
    ("unit_length_value" IS NULL OR "unit_length_value" > 0) AND
    ("unit_width_value" IS NULL OR "unit_width_value" > 0) AND
    ("unit_height_value" IS NULL OR "unit_height_value" > 0) AND
    ("unit_volume_value" IS NULL OR "unit_volume_value" > 0)
  );
