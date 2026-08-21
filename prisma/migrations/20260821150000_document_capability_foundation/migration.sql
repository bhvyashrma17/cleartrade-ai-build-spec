-- Five additional first-class document identifiers. Existing values and rows are untouched.
ALTER TYPE "DocType" ADD VALUE 'shipping_instructions';
ALTER TYPE "DocType" ADD VALUE 'vgm_declaration';
ALTER TYPE "DocType" ADD VALUE 'bill_of_exchange';
ALTER TYPE "DocType" ADD VALUE 'carrier_instructions';
ALTER TYPE "DocType" ADD VALUE 'bank_collection_letter';

CREATE TYPE "NotifyPartyMode" AS ENUM ('none', 'same_as_consignee', 'named');
CREATE TYPE "FreightPaymentTerm" AS ENUM ('prepaid', 'collect');
CREATE TYPE "VgmMethod" AS ENUM ('method_1', 'method_2');
CREATE TYPE "BillOfExchangeType" AS ENUM ('sight', 'usance');
CREATE TYPE "BankPresentationType" AS ENUM ('collection', 'negotiation');

ALTER TABLE "Shipment"
  ADD COLUMN "final_destination_name" TEXT,
  ADD COLUMN "notify_party_mode" "NotifyPartyMode",
  ADD COLUMN "notify_party_name" TEXT,
  ADD COLUMN "notify_party_address_line1" TEXT,
  ADD COLUMN "notify_party_address_line2" TEXT,
  ADD COLUMN "notify_party_city" TEXT,
  ADD COLUMN "notify_party_region" TEXT,
  ADD COLUMN "notify_party_postal_code" TEXT,
  ADD COLUMN "notify_party_country_code" VARCHAR(2),
  ADD COLUMN "notify_party_email" TEXT,
  ADD COLUMN "notify_party_phone" TEXT,
  ADD COLUMN "freight_payment_term" "FreightPaymentTerm",
  ADD COLUMN "handling_instructions" TEXT,
  ADD COLUMN "containerized" BOOLEAN;

CREATE TABLE "ShipmentContainer" (
  "id" TEXT NOT NULL,
  "shipment_id" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "container_number" TEXT NOT NULL,
  "container_type" TEXT,
  "seal_number" TEXT,
  "tare_weight_kg" DECIMAL(12,3),
  "vgm_verified_gross_mass_kg" DECIMAL(12,3),
  "vgm_method" "VgmMethod",
  "vgm_method_2_component_mass_kg" DECIMAL(12,3),
  "vgm_verified_at" TIMESTAMP(3),
  "vgm_verifier_name" TEXT,
  "vgm_verifier_capacity" TEXT,
  "vgm_evidence_ref" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShipmentContainer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExporterBankAccount" (
  "id" TEXT NOT NULL,
  "exporter_org_id" TEXT NOT NULL,
  "bank_name" TEXT NOT NULL,
  "branch_name" TEXT,
  "branch_address" TEXT,
  "ifsc" TEXT,
  "swift_bic" TEXT,
  "ad_code" TEXT,
  "account_reference" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExporterBankAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TradeFinanceInstruction" (
  "id" TEXT NOT NULL,
  "deal_id" TEXT NOT NULL,
  "payment_id" TEXT,
  "exporter_bank_account_id" TEXT,
  "bill_type" "BillOfExchangeType",
  "tenor_days" INTEGER,
  "place_of_drawing" TEXT,
  "drawn_on_date" TIMESTAMP(3),
  "bank_presentation_type" "BankPresentationType",
  "collection_instructions" TEXT,
  "charges_instruction" TEXT,
  "payment_reference" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TradeFinanceInstruction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BankPresentationItem" (
  "id" TEXT NOT NULL,
  "trade_finance_instruction_id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "original_count" INTEGER NOT NULL DEFAULT 0,
  "copy_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BankPresentationItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShipmentContainer_shipment_id_sequence_key" ON "ShipmentContainer"("shipment_id", "sequence");
CREATE UNIQUE INDEX "ShipmentContainer_shipment_id_container_number_key" ON "ShipmentContainer"("shipment_id", "container_number");
CREATE INDEX "ShipmentContainer_shipment_id_idx" ON "ShipmentContainer"("shipment_id");
CREATE INDEX "ExporterBankAccount_exporter_org_id_is_active_idx" ON "ExporterBankAccount"("exporter_org_id", "is_active");
CREATE UNIQUE INDEX "TradeFinanceInstruction_deal_id_key" ON "TradeFinanceInstruction"("deal_id");
CREATE INDEX "TradeFinanceInstruction_payment_id_idx" ON "TradeFinanceInstruction"("payment_id");
CREATE INDEX "TradeFinanceInstruction_exporter_bank_account_id_idx" ON "TradeFinanceInstruction"("exporter_bank_account_id");
CREATE UNIQUE INDEX "BankPresentationItem_trade_finance_instruction_id_document_id_key" ON "BankPresentationItem"("trade_finance_instruction_id", "document_id");
CREATE INDEX "BankPresentationItem_document_id_idx" ON "BankPresentationItem"("document_id");

ALTER TABLE "ShipmentContainer" ADD CONSTRAINT "ShipmentContainer_shipment_id_fkey"
  FOREIGN KEY ("shipment_id") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExporterBankAccount" ADD CONSTRAINT "ExporterBankAccount_exporter_org_id_fkey"
  FOREIGN KEY ("exporter_org_id") REFERENCES "ExporterOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TradeFinanceInstruction" ADD CONSTRAINT "TradeFinanceInstruction_deal_id_fkey"
  FOREIGN KEY ("deal_id") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TradeFinanceInstruction" ADD CONSTRAINT "TradeFinanceInstruction_payment_id_fkey"
  FOREIGN KEY ("payment_id") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TradeFinanceInstruction" ADD CONSTRAINT "TradeFinanceInstruction_exporter_bank_account_id_fkey"
  FOREIGN KEY ("exporter_bank_account_id") REFERENCES "ExporterBankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BankPresentationItem" ADD CONSTRAINT "BankPresentationItem_trade_finance_instruction_id_fkey"
  FOREIGN KEY ("trade_finance_instruction_id") REFERENCES "TradeFinanceInstruction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BankPresentationItem" ADD CONSTRAINT "BankPresentationItem_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ShipmentContainer" ADD CONSTRAINT "ShipmentContainer_positive_weights"
  CHECK (
    ("tare_weight_kg" IS NULL OR "tare_weight_kg" > 0) AND
    ("vgm_verified_gross_mass_kg" IS NULL OR "vgm_verified_gross_mass_kg" > 0) AND
    ("vgm_method_2_component_mass_kg" IS NULL OR "vgm_method_2_component_mass_kg" > 0)
  );
ALTER TABLE "ShipmentContainer" ADD CONSTRAINT "ShipmentContainer_vgm_complete_shape"
  CHECK (
    ("vgm_verified_gross_mass_kg" IS NULL AND "vgm_method" IS NULL AND "vgm_verified_at" IS NULL AND "vgm_verifier_name" IS NULL)
    OR
    ("vgm_verified_gross_mass_kg" IS NOT NULL AND "vgm_method" IS NOT NULL AND "vgm_verified_at" IS NOT NULL AND length(btrim("vgm_verifier_name")) > 0)
  );
ALTER TABLE "ShipmentContainer" ADD CONSTRAINT "ShipmentContainer_method_2_components"
  CHECK (
    "vgm_method" IS DISTINCT FROM 'method_2'::"VgmMethod"
    OR ("tare_weight_kg" IS NOT NULL AND "vgm_method_2_component_mass_kg" IS NOT NULL)
  );
ALTER TABLE "TradeFinanceInstruction" ADD CONSTRAINT "TradeFinanceInstruction_usance_tenor"
  CHECK ("bill_type" IS DISTINCT FROM 'usance'::"BillOfExchangeType" OR "tenor_days" > 0);
ALTER TABLE "BankPresentationItem" ADD CONSTRAINT "BankPresentationItem_nonnegative_counts"
  CHECK ("original_count" >= 0 AND "copy_count" >= 0 AND ("original_count" + "copy_count") > 0);
