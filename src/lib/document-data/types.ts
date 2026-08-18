/**
 * The typed contract a document generator is given.
 *
 * This is the replacement for the legacy `documentPdfService.ts` pattern, where each
 * renderer received a Prisma `Invoice` aggregate and reached into whatever relations it
 * happened to need. Two things went wrong there and neither is possible here:
 *
 *   - the renderer was coupled to the database, so the schema could not change without
 *     breaking templates, and templates read fields that did not exist (`exporter.iecNo`,
 *     `invoice.brandName`) which silently rendered blank;
 *   - `undefined` flowed into the page as an empty cell, so a missing weight printed as an
 *     official-looking `0.00`.
 *
 * Here every field is explicitly `| null`, every money value is a string carrying its
 * currency, and a renderer that wants a value it was not given cannot invent one — the
 * readiness service decides whether a document may be built at all, before this is used.
 *
 * Nothing in this file imports Prisma. That is the point: the eventual
 * `LegacyDocumentEngine` maps FROM this shape and never queries.
 */

/** A money value that always travels with its currency. Amount is a decimal string, never a JS number. */
export interface ContextMoney {
  amount: string;
  currency: string;
}

/** A quantity that always travels with its unit. */
export interface ContextQuantity {
  value: string;
  unit: string | null;
}

/**
 * Structured postal address. Rendered into lines by the consumer, never stored pre-joined —
 * a joined string cannot be corrected field by field, which is what Part 4 of the phase spec
 * is protecting against.
 */
export interface ContextAddress {
  line1: string | null;
  line2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country_code: string | null;
}

/**
 * A port or place as an identity rather than a label.
 *
 * `unlocode: null` means "not known" and stays null all the way to the page. It is never
 * derived from `name`, because a plausible-looking wrong code on a shipping bill is worse
 * than an obviously absent one.
 */
export interface ContextLocation {
  name: string | null;
  unlocode: string | null;
  country_code: string | null;
}

export interface ContextExporter {
  org_id: string;
  legal_name: string | null;
  display_name: string;
  address: ContextAddress;
  iec_number: string | null;
  /** Whether the IEC has actually been verified, not merely typed in. */
  iec_status: string;
  gstin: string | null;
  ad_code: string | null;
  country_of_origin: string | null;
}

export interface ContextBuyer {
  buyer_id: string;
  /** The name that goes on the document — the profile override if set, else the legal name. */
  document_name: string;
  legal_name: string;
  address: ContextAddress;
  tax_identifier: string | null;
  tax_identifier_type: string | null;
  contact_email: string | null;
  contact_phone: string | null;
}

export interface ContextLineItem {
  description: string;
  hs_code: string | null;
  itc_hs_code: string | null;
  quantity: ContextQuantity | null;
  unit_price: ContextMoney | null;
  line_total: ContextMoney | null;
}

export interface ContextDeal {
  deal_id: string;
  stage: string;
  incoterm: string | null;
  incoterm_place: string | null;
  payment_terms: unknown;
  buyer_reference: string | null;
  currency: string | null;
  /** Sum of the line items. Derived at build time, never stored (Part 7). */
  goods_total: ContextMoney | null;
  items: ContextLineItem[];
}

export interface ContextPackageLine {
  sequence: number;
  package_type: string;
  package_count: number;
  net_weight_kg: string | null;
  gross_weight_kg: string | null;
  volume_cbm: string | null;
  dimensions_cm: { length: string | null; width: string | null; height: string | null } | null;
  contents_description: string | null;
}

/** All derived by summing package lines. Null when no package line supplies the input. */
export interface ContextPackageTotals {
  package_count: number;
  net_weight_kg: string | null;
  gross_weight_kg: string | null;
  volume_cbm: string | null;
}

export interface ContextShipment {
  shipment_id: string | null;
  status: string | null;
  mode: string | null;
  port_of_loading: ContextLocation;
  port_of_discharge: ContextLocation;
  final_destination_country: string | null;
  vessel_or_flight_no: string | null;
  voyage_no: string | null;
  container_no: string | null;
  container_type: string | null;
  seal_no: string | null;
  transport_document_type: string | null;
  transport_document_no: string | null;
  transport_document_date: string | null;
  shipping_bill_no: string | null;
  shipping_bill_date: string | null;
  marks_and_numbers: string | null;
  shipped_on_date: string | null;
  packages: ContextPackageLine[];
  package_totals: ContextPackageTotals;
}

/**
 * An exchange rate with everything needed to defend it later. A rate without its source and
 * applicable date is not usable on a document, so all four travel together or the whole
 * object is null.
 */
export interface ContextExchangeRate {
  base_currency: string;
  quote_currency: string;
  rate: string;
  source: string;
  source_reference: string | null;
  rate_date: string;
}

export interface ContextFinancial {
  freight: ContextMoney | null;
  insurance: ContextMoney | null;
  other_charges: ContextMoney | null;
  /** Derived: goods total, less freight and insurance when the incoterm includes them. */
  fob_value: ContextMoney | null;
  /** Derived: FOB + freight + insurance. Null when an input is missing — never partial. */
  cif_value: ContextMoney | null;
  invoice_total: ContextMoney | null;
  exchange_rate: ContextExchangeRate | null;
  /** invoice_total converted at `exchange_rate`. Null if either input is absent. */
  invoice_total_in_quote_currency: ContextMoney | null;
}

export interface ContextReferences {
  /** The official invoice number, present only once formally issued. Never allocated by a preview. */
  invoice_number: string | null;
  invoice_date: string | null;
  deal_id: string;
  document_version: number | null;
}

/** Everything a document generator is allowed to see. */
export interface DocumentGenerationContext {
  builder_version: number;
  doc_type: string;
  built_at: string;
  exporter: ContextExporter;
  buyer: ContextBuyer;
  deal: ContextDeal;
  shipment: ContextShipment;
  financial: ContextFinancial;
  references: ContextReferences;
}

/** Bumped whenever the shape above changes, so an old snapshot is never read under new assumptions. */
export const DOCUMENT_CONTEXT_BUILDER_VERSION = 1;
