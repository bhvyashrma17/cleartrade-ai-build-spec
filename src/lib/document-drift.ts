/**
 * Snapshot drift — what has changed in canonical data since a document version was frozen.
 *
 * The distinction this exists to make visible, and which the phase spec is emphatic about:
 *
 *     "current canonical data differs from this document snapshot"
 *
 * is NOT
 *
 *     "this historical document is invalid".
 *
 * An approved version was correct when it was approved. Drift means somebody should decide
 * whether a corrected version is needed — it is information for an agent, never a trigger. No
 * code path here creates a version, and nothing marks a historical document as wrong.
 *
 * Changes are labelled `changed` / `added` / `removed`. Deliberately not "materially
 * significant": ClearTrade has no rule that knows whether a corrected postal code matters to a
 * bank, and asserting materiality it cannot determine would be worse than saying nothing.
 */

import { DocType } from '@prisma/client';
import type { CanonicalOwner, DocumentGenerationContext } from '@/lib/document-data';

export type DriftKind = 'changed' | 'added' | 'removed';

export interface DriftEntry {
  /** Dotted path into the generation context. */
  field: string;
  label: string;
  owner: CanonicalOwner;
  kind: DriftKind;
  /** Values as rendered on the document. Shown only through authorised UI, never in audit. */
  from: string | null;
  to: string | null;
}

export interface SnapshotDrift {
  documentType: DocType;
  /** True when nothing a document reads has changed. */
  clean: boolean;
  entries: DriftEntry[];
}

/**
 * Fields worth comparing, with the owner that would be edited to change them.
 *
 * A curated list rather than a deep object diff: a generic diff would report `built_at` and
 * `document_version` on every comparison, which is noise that trains people to ignore the
 * panel. Every entry here is a value that actually appears on at least one document.
 */
const WATCHED: {
  field: string;
  label: string;
  owner: CanonicalOwner;
  docTypes?: DocType[];
  read: (c: DocumentGenerationContext) => string | null;
}[] = [
  { field: 'exporter.legal_name', label: 'Exporter legal name', owner: 'exporter_org', read: (c) => c.exporter.legal_name },
  { field: 'exporter.address', label: 'Exporter address', owner: 'exporter_org', read: (c) => joinAddress(c.exporter.address) },
  { field: 'exporter.iec_number', label: 'IEC', owner: 'exporter_org', read: (c) => c.exporter.iec_number },
  { field: 'exporter.gstin', label: 'GSTIN', owner: 'exporter_org', read: (c) => c.exporter.gstin },
  { field: 'exporter.ad_code', label: 'AD code', owner: 'exporter_org', read: (c) => c.exporter.ad_code },
  { field: 'buyer.document_name', label: 'Buyer name', owner: 'buyer_commercial_profile', read: (c) => c.buyer.document_name },
  { field: 'buyer.address', label: 'Buyer address', owner: 'buyer_commercial_profile', read: (c) => joinAddress(c.buyer.address) },
  { field: 'buyer.tax_identifier', label: 'Buyer tax identifier', owner: 'buyer_commercial_profile', read: (c) => c.buyer.tax_identifier },
  { field: 'deal.incoterm', label: 'Incoterm', owner: 'deal', read: (c) => joinNonNull([c.deal.incoterm, c.deal.incoterm_place]) },
  { field: 'deal.buyer_reference', label: 'Buyer reference', owner: 'deal', read: (c) => c.deal.buyer_reference },
  { field: 'deal.goods_total', label: 'Total value', owner: 'deal', read: (c) => moneyText(c.deal.goods_total) },
  { field: 'deal.items', label: 'Goods', owner: 'deal', read: (c) => c.deal.items
      .map((i) => `${i.description} / ${i.hs_code ?? ''} / ${i.quantity?.value ?? ''}${i.quantity?.unit ?? ''} / ${moneyText(i.unit_price) ?? ''}`)
      .join(' | ') || null },
  { field: 'shipment.port_of_loading', label: 'Port of loading', owner: 'shipment', read: (c) => portText(c.shipment.port_of_loading) },
  { field: 'shipment.port_of_discharge', label: 'Port of discharge', owner: 'shipment', read: (c) => portText(c.shipment.port_of_discharge) },
  { field: 'shipment.final_destination_country', label: 'Final destination', owner: 'shipment', read: (c) => c.shipment.final_destination_country },
  { field: 'shipment.transport_document_no', label: 'Transport document no', owner: 'shipment', read: (c) => c.shipment.transport_document_no },
  { field: 'shipment.vessel_or_flight_no', label: 'Vessel / flight', owner: 'shipment', read: (c) => c.shipment.vessel_or_flight_no },
  { field: 'shipment.container_no', label: 'Container', owner: 'shipment', read: (c) => c.shipment.container_no },
  { field: 'shipment.marks_and_numbers', label: 'Marks and numbers', owner: 'shipment', read: (c) => c.shipment.marks_and_numbers },
  { field: 'shipment.shipping_bill_no', label: 'Shipping bill no', owner: 'shipment', read: (c) => c.shipment.shipping_bill_no },
  { field: 'shipment.package_totals', label: 'Package totals', owner: 'shipment_packages', read: (c) =>
      `${c.shipment.package_totals.package_count} pkg / net ${c.shipment.package_totals.net_weight_kg ?? '-'} / gross ${c.shipment.package_totals.gross_weight_kg ?? '-'}` },
  { field: 'financial.freight', label: 'Freight', owner: 'shipment', read: (c) => moneyText(c.financial.freight) },
  { field: 'financial.insurance', label: 'Insurance premium', owner: 'insurance_case', read: (c) => moneyText(c.financial.insurance) },
  { field: 'financial.fob_value', label: 'FOB value', owner: 'shipment', read: (c) => moneyText(c.financial.fob_value) },
  { field: 'financial.exchange_rate', label: 'Exchange rate', owner: 'exchange_rate_quote', read: (c) =>
      c.financial.exchange_rate
        ? `${c.financial.exchange_rate.rate} ${c.financial.exchange_rate.base_currency}/${c.financial.exchange_rate.quote_currency} (${c.financial.exchange_rate.source})`
        : null },
  { field: 'references.invoice_number', label: 'Invoice number', owner: 'invoice_number', read: (c) => c.references.invoice_number },
  {
    field: 'deal.payment_terms', label: 'Payment terms', owner: 'deal',
    docTypes: [DocType.bill_of_exchange, DocType.bank_collection_letter],
    read: (c) => c.deal.payment_terms === null || c.deal.payment_terms === undefined
      ? null : JSON.stringify(c.deal.payment_terms),
  },
  {
    field: 'shipment.booking_reference', label: 'Booking reference', owner: 'shipment',
    docTypes: [DocType.shipping_instructions, DocType.vgm_declaration, DocType.carrier_instructions, DocType.bank_collection_letter],
    read: (c) => c.shipment.booking_reference ?? null,
  },
  {
    field: 'shipment.freight_payment_term', label: 'Freight terms', owner: 'shipment',
    docTypes: [DocType.shipping_instructions, DocType.carrier_instructions],
    read: (c) => c.shipment.freight_payment_term ?? null,
  },
  {
    field: 'shipment.final_destination_name', label: 'Final destination place', owner: 'shipment',
    docTypes: [DocType.shipping_instructions, DocType.carrier_instructions],
    read: (c) => c.shipment.final_destination_name ?? null,
  },
  {
    field: 'shipment.handling_instructions', label: 'Special handling instructions', owner: 'shipment',
    docTypes: [DocType.shipping_instructions, DocType.carrier_instructions],
    read: (c) => c.shipment.handling_instructions ?? null,
  },
  {
    field: 'shipment.notify_party', label: 'Notify party', owner: 'shipment',
    docTypes: [DocType.shipping_instructions, DocType.carrier_instructions],
    read: (c) => c.shipment.notify_party ? JSON.stringify(c.shipment.notify_party) : null,
  },
  {
    field: 'shipment.containers', label: 'Container and verified mass details', owner: 'shipment_containers',
    docTypes: [DocType.shipping_instructions, DocType.vgm_declaration, DocType.carrier_instructions],
    read: (c) => c.shipment.containers?.length ? JSON.stringify(c.shipment.containers) : null,
  },
  {
    field: 'trade_finance.bill_of_exchange', label: 'Bill of Exchange instructions', owner: 'trade_finance_instruction',
    docTypes: [DocType.bill_of_exchange],
    read: (c) => c.trade_finance?.bill_of_exchange ? JSON.stringify(c.trade_finance.bill_of_exchange) : null,
  },
  {
    field: 'trade_finance.payment', label: 'Selected payment', owner: 'trade_finance_instruction',
    docTypes: [DocType.bill_of_exchange, DocType.bank_collection_letter],
    read: (c) => c.trade_finance?.payment ? JSON.stringify(c.trade_finance.payment) : null,
  },
  {
    field: 'trade_finance.bank_presentation', label: 'Bank presentation instructions', owner: 'bank_presentation',
    docTypes: [DocType.bank_collection_letter],
    read: (c) => c.trade_finance?.bank_presentation ? JSON.stringify(c.trade_finance.bank_presentation) : null,
  },
];

function joinNonNull(parts: (string | null)[]): string | null {
  const kept = parts.filter((p): p is string => Boolean(p && p.trim()));
  return kept.length > 0 ? kept.join(' ') : null;
}

function joinAddress(address: {
  line1: string | null; line2: string | null; city: string | null;
  region: string | null; postal_code: string | null; country_code: string | null;
}): string | null {
  return joinNonNull([address.line1, address.line2, address.city, address.region, address.postal_code, address.country_code]);
}

const moneyText = (value: { amount: string; currency: string } | null) =>
  value ? `${value.currency} ${value.amount}` : null;

const portText = (value: { name: string | null; unlocode: string | null }) =>
  joinNonNull([value.name, value.unlocode]);

/**
 * Compare a frozen snapshot against a freshly built context.
 *
 * The frozen side is read as-is — this function never rebuilds it, and never writes anywhere.
 */
export function compareSnapshotToCurrent(
  frozen: DocumentGenerationContext,
  current: DocumentGenerationContext,
  documentType: DocType,
): SnapshotDrift {
  const entries: DriftEntry[] = [];

  for (const watched of WATCHED) {
    if (watched.docTypes && !watched.docTypes.includes(documentType)) continue;
    const from = watched.read(frozen);
    const to = watched.read(current);
    if (from === to) continue;

    const kind: DriftKind = from === null ? 'added' : to === null ? 'removed' : 'changed';
    entries.push({ field: watched.field, label: watched.label, owner: watched.owner, kind, from, to });
  }

  return { documentType, clean: entries.length === 0, entries };
}

/** Field names only. Safe for an audit payload; the values are not. */
export function driftFieldNames(drift: SnapshotDrift): string[] {
  return drift.entries.map((e) => e.field);
}
