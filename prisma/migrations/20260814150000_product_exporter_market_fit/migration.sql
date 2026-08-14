ALTER TABLE "Product"
ADD COLUMN "lead_time_days" INTEGER,
ADD COLUMN "desired_order_size_amount" DECIMAL(18,4),
ADD COLUMN "desired_order_size_currency" VARCHAR(3),
ADD COLUMN "customization_capability" TEXT,
ADD COLUMN "packaging_capability" TEXT;
