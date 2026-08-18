-- Phase 5 — canonical export-transaction and document data foundation.
--
-- Adds the business facts the document renderers consume, each to the model that already
-- owns that kind of fact, plus three things the application layer cannot guarantee on its
-- own: format constraints on identifiers, append-only enforcement on issued invoice numbers
-- and input snapshots, and the concurrency guarantee behind invoice numbering.
--
-- Nothing here is a per-document copy of a mutable value.

-- CreateEnum
CREATE TYPE "TransportDocumentType" AS ENUM ('bill_of_lading', 'air_waybill', 'courier_receipt', 'road_consignment_note');
-- CreateEnum
CREATE TYPE "ExchangeRateSource" AS ENUM ('rbi_reference', 'customs_notified', 'bank_quoted', 'manual_entry');
-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "buyer_reference" TEXT;
-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "input_snapshot_id" TEXT;
-- AlterTable
ALTER TABLE "ExporterOrg" ADD COLUMN     "ad_code" TEXT,
ADD COLUMN     "address_line1" TEXT,
ADD COLUMN     "address_line2" TEXT,
ADD COLUMN     "postal_code" TEXT;
-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "container_no" TEXT,
ADD COLUMN     "container_type" TEXT,
ADD COLUMN     "final_destination_country" VARCHAR(2),
ADD COLUMN     "freight_amount" DECIMAL(18,4),
ADD COLUMN     "freight_currency" VARCHAR(3),
ADD COLUMN     "marks_and_numbers" TEXT,
ADD COLUMN     "other_charges_amount" DECIMAL(18,4),
ADD COLUMN     "other_charges_currency" VARCHAR(3),
ADD COLUMN     "port_of_discharge_country" VARCHAR(2),
ADD COLUMN     "port_of_discharge_name" TEXT,
ADD COLUMN     "port_of_discharge_unlocode" VARCHAR(5),
ADD COLUMN     "port_of_loading_country" VARCHAR(2),
ADD COLUMN     "port_of_loading_name" TEXT,
ADD COLUMN     "port_of_loading_unlocode" VARCHAR(5),
ADD COLUMN     "seal_no" TEXT,
ADD COLUMN     "shipped_on_date" TIMESTAMP(3),
ADD COLUMN     "shipping_bill_date" TIMESTAMP(3),
ADD COLUMN     "transport_document_date" TIMESTAMP(3),
ADD COLUMN     "transport_document_no" TEXT,
ADD COLUMN     "transport_document_type" "TransportDocumentType",
ADD COLUMN     "vessel_or_flight_no" TEXT,
ADD COLUMN     "voyage_no" TEXT;
-- CreateTable
CREATE TABLE "BuyerCommercialProfile" (
    "id" TEXT NOT NULL,
    "exporter_org_id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "document_name" TEXT,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postal_code" TEXT,
    "country_code" VARCHAR(2),
    "tax_identifier" TEXT,
    "tax_identifier_type" TEXT,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_id" TEXT,

    CONSTRAINT "BuyerCommercialProfile_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "ShipmentPackage" (
    "id" TEXT NOT NULL,
    "shipment_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "package_type" TEXT NOT NULL,
    "package_count" INTEGER NOT NULL,
    "net_weight_kg" DECIMAL(12,3),
    "gross_weight_kg" DECIMAL(12,3),
    "length_cm" DECIMAL(10,2),
    "width_cm" DECIMAL(10,2),
    "height_cm" DECIMAL(10,2),
    "volume_cbm" DECIMAL(12,4),
    "contents_description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentPackage_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "ExchangeRateQuote" (
    "id" TEXT NOT NULL,
    "exporter_org_id" TEXT NOT NULL,
    "base_currency" VARCHAR(3) NOT NULL,
    "quote_currency" VARCHAR(3) NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "source" "ExchangeRateSource" NOT NULL,
    "source_reference" TEXT,
    "rate_date" TIMESTAMP(3) NOT NULL,
    "recorded_by_id" TEXT,
    "correlation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRateQuote_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "InvoiceSeries" (
    "id" TEXT NOT NULL,
    "exporter_org_id" TEXT NOT NULL,
    "series_key" TEXT NOT NULL,
    "prefix" TEXT NOT NULL DEFAULT '',
    "suffix" TEXT NOT NULL DEFAULT '',
    "pad_length" INTEGER NOT NULL DEFAULT 5,
    "next_number" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceSeries_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "IssuedInvoiceNumber" (
    "id" TEXT NOT NULL,
    "exporter_org_id" TEXT NOT NULL,
    "series_id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "sequence_number" INTEGER NOT NULL,
    "formatted_number" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issued_by_id" TEXT,
    "correlation_id" TEXT,
    "voided_at" TIMESTAMP(3),
    "void_reason" TEXT,
    "voided_by_id" TEXT,

    CONSTRAINT "IssuedInvoiceNumber_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "DocumentInputSnapshot" (
    "id" TEXT NOT NULL,
    "exporter_org_id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "doc_type" "DocType" NOT NULL,
    "builder_version" INTEGER NOT NULL DEFAULT 1,
    "context" JSONB NOT NULL,
    "content_hash" VARCHAR(64) NOT NULL,
    "created_by_id" TEXT,
    "correlation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentInputSnapshot_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "BuyerCommercialProfile_buyer_id_idx" ON "BuyerCommercialProfile"("buyer_id");
-- CreateIndex
CREATE UNIQUE INDEX "BuyerCommercialProfile_exporter_org_id_buyer_id_key" ON "BuyerCommercialProfile"("exporter_org_id", "buyer_id");
-- CreateIndex
CREATE INDEX "ShipmentPackage_shipment_id_idx" ON "ShipmentPackage"("shipment_id");
-- CreateIndex
CREATE UNIQUE INDEX "ShipmentPackage_shipment_id_sequence_key" ON "ShipmentPackage"("shipment_id", "sequence");
-- CreateIndex
CREATE INDEX "ExchangeRateQuote_exporter_org_id_base_currency_quote_curre_idx" ON "ExchangeRateQuote"("exporter_org_id", "base_currency", "quote_currency", "rate_date");
-- CreateIndex
CREATE UNIQUE INDEX "InvoiceSeries_exporter_org_id_series_key_key" ON "InvoiceSeries"("exporter_org_id", "series_key");
-- CreateIndex
CREATE INDEX "IssuedInvoiceNumber_deal_id_idx" ON "IssuedInvoiceNumber"("deal_id");
-- CreateIndex
CREATE UNIQUE INDEX "IssuedInvoiceNumber_series_id_sequence_number_key" ON "IssuedInvoiceNumber"("series_id", "sequence_number");
-- CreateIndex
CREATE UNIQUE INDEX "IssuedInvoiceNumber_exporter_org_id_formatted_number_key" ON "IssuedInvoiceNumber"("exporter_org_id", "formatted_number");
-- CreateIndex
CREATE INDEX "DocumentInputSnapshot_deal_id_doc_type_created_at_idx" ON "DocumentInputSnapshot"("deal_id", "doc_type", "created_at");
-- CreateIndex
CREATE UNIQUE INDEX "Document_input_snapshot_id_key" ON "Document"("input_snapshot_id");
-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_input_snapshot_id_fkey" FOREIGN KEY ("input_snapshot_id") REFERENCES "DocumentInputSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "BuyerCommercialProfile" ADD CONSTRAINT "BuyerCommercialProfile_exporter_org_id_fkey" FOREIGN KEY ("exporter_org_id") REFERENCES "ExporterOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "BuyerCommercialProfile" ADD CONSTRAINT "BuyerCommercialProfile_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "Buyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "BuyerCommercialProfile" ADD CONSTRAINT "BuyerCommercialProfile_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ShipmentPackage" ADD CONSTRAINT "ShipmentPackage_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ExchangeRateQuote" ADD CONSTRAINT "ExchangeRateQuote_exporter_org_id_fkey" FOREIGN KEY ("exporter_org_id") REFERENCES "ExporterOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ExchangeRateQuote" ADD CONSTRAINT "ExchangeRateQuote_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "InvoiceSeries" ADD CONSTRAINT "InvoiceSeries_exporter_org_id_fkey" FOREIGN KEY ("exporter_org_id") REFERENCES "ExporterOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "IssuedInvoiceNumber" ADD CONSTRAINT "IssuedInvoiceNumber_exporter_org_id_fkey" FOREIGN KEY ("exporter_org_id") REFERENCES "ExporterOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "IssuedInvoiceNumber" ADD CONSTRAINT "IssuedInvoiceNumber_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "InvoiceSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "IssuedInvoiceNumber" ADD CONSTRAINT "IssuedInvoiceNumber_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "IssuedInvoiceNumber" ADD CONSTRAINT "IssuedInvoiceNumber_issued_by_id_fkey" FOREIGN KEY ("issued_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "IssuedInvoiceNumber" ADD CONSTRAINT "IssuedInvoiceNumber_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "DocumentInputSnapshot" ADD CONSTRAINT "DocumentInputSnapshot_exporter_org_id_fkey" FOREIGN KEY ("exporter_org_id") REFERENCES "ExporterOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "DocumentInputSnapshot" ADD CONSTRAINT "DocumentInputSnapshot_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "DocumentInputSnapshot" ADD CONSTRAINT "DocumentInputSnapshot_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Identifier shape constraints
-- ---------------------------------------------------------------------------

-- A UN/LOCODE is 2 country letters + 3 alphanumerics (letters or digits 2-9). Enforcing the
-- shape here means a malformed code cannot reach a customs document through any code path,
-- and — because the column stays nullable — an unknown port code remains honestly NULL
-- rather than being padded into something that looks official.
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_pol_unlocode_shape" CHECK (
    "port_of_loading_unlocode" IS NULL
    OR "port_of_loading_unlocode" ~ '^[A-Z]{2}[A-Z2-9]{3}$');

ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_pod_unlocode_shape" CHECK (
    "port_of_discharge_unlocode" IS NULL
    OR "port_of_discharge_unlocode" ~ '^[A-Z]{2}[A-Z2-9]{3}$');

-- A transport document number without a type is unusable: "1234" tells a bank nothing about
-- whether it is a bill of lading or an air waybill. The type may exist alone (booked, number
-- not yet issued), but never the reverse.
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_transport_document_typed" CHECK (
    "transport_document_no" IS NULL OR "transport_document_type" IS NOT NULL);

-- A sea shipment cannot move on an air waybill, and an air shipment cannot move on a bill of
-- lading. Modes we do not have a specific document vocabulary for are left unconstrained.
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_transport_document_matches_mode" CHECK (
    "transport_document_type" IS NULL
    OR "mode" IS NULL
    OR NOT (("mode" = 'sea'  AND "transport_document_type" = 'air_waybill')
         OR ("mode" = 'air'  AND "transport_document_type" = 'bill_of_lading')));

-- A tax identifier whose type is unknown cannot be printed on a customs document: VAT, EORI
-- and a local GST number are not interchangeable.
ALTER TABLE "BuyerCommercialProfile" ADD CONSTRAINT "BuyerCommercialProfile_tax_id_typed" CHECK (
    "tax_identifier" IS NULL OR "tax_identifier_type" IS NOT NULL);

-- A package line describes at least one package, and weights are never negative.
ALTER TABLE "ShipmentPackage" ADD CONSTRAINT "ShipmentPackage_count_positive" CHECK ("package_count" > 0);
ALTER TABLE "ShipmentPackage" ADD CONSTRAINT "ShipmentPackage_weights_non_negative" CHECK (
    ("net_weight_kg" IS NULL OR "net_weight_kg" >= 0)
    AND ("gross_weight_kg" IS NULL OR "gross_weight_kg" >= 0)
    AND ("volume_cbm" IS NULL OR "volume_cbm" >= 0));

-- Gross weight includes the packaging, so it can never be below net. The legacy renderer
-- silently raised gross to net at print time, which hid the data-entry error instead of
-- surfacing it; refusing the row makes the correction happen where the fact is owned.
ALTER TABLE "ShipmentPackage" ADD CONSTRAINT "ShipmentPackage_gross_covers_net" CHECK (
    "net_weight_kg" IS NULL OR "gross_weight_kg" IS NULL OR "gross_weight_kg" >= "net_weight_kg");

-- ---------------------------------------------------------------------------
-- Exchange-rate provenance
-- ---------------------------------------------------------------------------

-- A rate must be a positive number and must convert between two DIFFERENT currencies.
ALTER TABLE "ExchangeRateQuote" ADD CONSTRAINT "ExchangeRateQuote_rate_positive" CHECK ("rate" > 0);
ALTER TABLE "ExchangeRateQuote" ADD CONSTRAINT "ExchangeRateQuote_currencies_differ" CHECK (
    "base_currency" <> "quote_currency");

-- The rule that matters: a regulatory source may only be claimed with a citation. Without
-- this, "RBI" is just a string an operator can select next to a number they invented — which
-- is exactly what the legacy service persisted when its public-API lookup fell through to a
-- hardcoded constant.
ALTER TABLE "ExchangeRateQuote" ADD CONSTRAINT "ExchangeRateQuote_regulatory_source_cited" CHECK (
    "source" NOT IN ('rbi_reference', 'customs_notified')
    OR ("source_reference" IS NOT NULL AND length(btrim("source_reference")) > 0));

-- ---------------------------------------------------------------------------
-- Invoice numbering
-- ---------------------------------------------------------------------------

ALTER TABLE "InvoiceSeries" ADD CONSTRAINT "InvoiceSeries_next_number_positive" CHECK ("next_number" >= 1);
ALTER TABLE "InvoiceSeries" ADD CONSTRAINT "InvoiceSeries_pad_length_sane" CHECK ("pad_length" BETWEEN 1 AND 12);
ALTER TABLE "IssuedInvoiceNumber" ADD CONSTRAINT "IssuedInvoiceNumber_sequence_positive" CHECK ("sequence_number" >= 1);

-- Void is a shape, not a flag: a voided row carries its timestamp and its reason together, or
-- it is not voided.
ALTER TABLE "IssuedInvoiceNumber" ADD CONSTRAINT "IssuedInvoiceNumber_void_shape" CHECK (
    ("voided_at" IS NULL AND "void_reason" IS NULL AND "voided_by_id" IS NULL)
    OR ("voided_at" IS NOT NULL AND "void_reason" IS NOT NULL));

-- One live official invoice number per deal. Voided numbers are excluded rather than deleted,
-- so reissuing after a void is possible while double-issuing is not — this is the constraint
-- that makes "no duplicate invoice numbers" structural instead of a service convention.
CREATE UNIQUE INDEX "IssuedInvoiceNumber_one_live_per_deal"
    ON "IssuedInvoiceNumber"("deal_id") WHERE "voided_at" IS NULL;

-- An issued number is immutable except for being voided. The trigger compares every other
-- column and refuses the update, so no service, script or console session can rewrite what a
-- document already states.
CREATE OR REPLACE FUNCTION "issued_invoice_number_refuse_rewrite"() RETURNS trigger AS $$
BEGIN
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."exporter_org_id" IS DISTINCT FROM OLD."exporter_org_id"
       OR NEW."series_id" IS DISTINCT FROM OLD."series_id"
       OR NEW."deal_id" IS DISTINCT FROM OLD."deal_id"
       OR NEW."sequence_number" IS DISTINCT FROM OLD."sequence_number"
       OR NEW."formatted_number" IS DISTINCT FROM OLD."formatted_number"
       OR NEW."issued_at" IS DISTINCT FROM OLD."issued_at"
       OR NEW."issued_by_id" IS DISTINCT FROM OLD."issued_by_id" THEN
        RAISE EXCEPTION 'IssuedInvoiceNumber % is immutable once issued; only voiding is permitted.', OLD."id"
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD."voided_at" IS NOT NULL AND NEW."voided_at" IS DISTINCT FROM OLD."voided_at" THEN
        RAISE EXCEPTION 'IssuedInvoiceNumber % is already voided; a void cannot be undone or restated.', OLD."id"
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "issued_invoice_number_immutable"
    BEFORE UPDATE ON "IssuedInvoiceNumber"
    FOR EACH ROW EXECUTE FUNCTION "issued_invoice_number_refuse_rewrite"();

-- Deleting an issued number would reopen the sequence and erase the evidence of what was
-- handed out. Voiding is the only retirement path.
CREATE OR REPLACE FUNCTION "issued_invoice_number_refuse_delete"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'IssuedInvoiceNumber % cannot be deleted; void it instead.', OLD."id"
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "issued_invoice_number_no_delete"
    BEFORE DELETE ON "IssuedInvoiceNumber"
    FOR EACH ROW EXECUTE FUNCTION "issued_invoice_number_refuse_delete"();

-- ---------------------------------------------------------------------------
-- Document input snapshots
-- ---------------------------------------------------------------------------

ALTER TABLE "DocumentInputSnapshot" ADD CONSTRAINT "DocumentInputSnapshot_hash_shape" CHECK (
    "content_hash" ~ '^[0-9a-f]{64}$');

-- Append-only, for the same reason AgentDecision is: the entire value of a snapshot is that
-- it says what was true at generation time. A snapshot that can be edited afterwards proves
-- nothing, and an issued document would no longer be reproducible.
CREATE OR REPLACE FUNCTION "document_input_snapshot_refuse_update"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'DocumentInputSnapshot % is immutable: freeze a new snapshot for a new document version.', OLD."id"
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "document_input_snapshot_no_update"
    BEFORE UPDATE ON "DocumentInputSnapshot"
    FOR EACH ROW EXECUTE FUNCTION "document_input_snapshot_refuse_update"();
