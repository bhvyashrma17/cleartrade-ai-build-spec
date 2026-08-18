/**
 * Typed adapters: frozen canonical context -> document model, one per supported document type.
 *
 * Everything a renderer ever sees passes through here, and every mapping is deliberate. There
 * is no spread of the context into a template and no `any` anywhere, which is what makes the
 * legacy failure mode impossible: those templates read `exporter.iecNo`, `exporter.gstIN`,
 * `exporter.exchangeRateRef`, `invoice.brandName` and `invoice.poRef` — none of which existed
 * on their own schema — and rendered them as blanks because the input was typed `any`. Here a
 * field that does not exist on `DocumentGenerationContext` is a compile error.
 *
 * Adapters format; they never compute. FOB, CIF, totals and package sums were derived once, in
 * Phase 5, and frozen into the snapshot. Recomputing them here would create a second answer
 * that could disagree with the one readiness approved.
 */

import { DocType } from '@prisma/client';
import type { DocumentGenerationContext } from '@/lib/document-data';
import type { DocumentRenderMetadata } from '../engine';
import { addressLines, cell, date, decimal, money, paymentTerms, port, quantity } from './format';
import type { Block, DocumentModel, KeyValueBlock, TableBlock } from './model';

const DOC_TITLES: Record<string, string> = {
  [DocType.PI]: 'PROFORMA INVOICE',
  [DocType.CI]: 'COMMERCIAL INVOICE',
  [DocType.packing_list]: 'PACKING LIST',
  [DocType.shipping_bill_draft]: 'SHIPPING BILL (DRAFT)',
  [DocType.COO_draft]: 'CERTIFICATE OF ORIGIN (DRAFT)',
  [DocType.declaration]: 'EXPORTER DECLARATION',
  [DocType.insurance_declaration]: 'INSURANCE DECLARATION',
};

type Ctx = DocumentGenerationContext;

/** Exporter and buyer, side by side. Every document opens with it. */
function parties(c: Ctx): Block {
  const exporterName = c.exporter.legal_name ?? c.exporter.display_name;
  return {
    kind: 'parties',
    left: {
      heading: 'Exporter',
      lines: [exporterName, ...addressLines(c.exporter.address)],
    },
    right: {
      heading: 'Buyer / Consignee',
      lines: [c.buyer.document_name, ...addressLines(c.buyer.address)],
    },
  };
}

/**
 * Regulatory identifiers.
 *
 * These are precisely the fields the legacy `any` interfaces lost. IEC and GSTIN were read as
 * `exporter.iecNo`/`exporter.gstIN` against a schema whose columns were `iec`/`gstin`, so both
 * printed blank on every document. They are named explicitly here and covered by a regression
 * test.
 */
function identifiers(c: Ctx, opts: { adCode?: boolean } = {}): KeyValueBlock {
  const rows = [
    { label: 'IEC', value: cell(c.exporter.iec_number) },
    { label: 'GSTIN', value: cell(c.exporter.gstin) },
  ];
  if (opts.adCode) rows.push({ label: 'AD code', value: cell(c.exporter.ad_code) });
  if (c.buyer.tax_identifier) {
    rows.push({
      label: c.buyer.tax_identifier_type ?? 'Buyer tax ID',
      value: cell(c.buyer.tax_identifier),
    });
  }
  return { kind: 'key_values', title: 'Identifiers', columns: 2, rows };
}

/** Commercial terms. `buyer_reference` is the buyer's PO — the legacy `invoice.poRef` blank. */
function commercialTerms(c: Ctx): KeyValueBlock {
  return {
    kind: 'key_values',
    title: 'Commercial terms',
    columns: 2,
    rows: [
      { label: 'Incoterm', value: cell(c.deal.incoterm ? `${c.deal.incoterm}${c.deal.incoterm_place ? ` ${c.deal.incoterm_place}` : ''}` : null) },
      { label: 'Payment terms', value: paymentTerms(c.deal.payment_terms) },
      { label: 'Buyer reference', value: cell(c.deal.buyer_reference) },
      { label: 'Country of origin', value: cell(c.exporter.country_of_origin) },
    ],
  };
}

/** Goods, one row per line item, with a totals band. */
function goodsTable(c: Ctx, opts: { priced: boolean }): TableBlock {
  const columns = opts.priced
    ? [
        { header: 'Sr', align: 'center' as const, width: 6 },
        { header: 'Description', width: 38 },
        { header: 'HS code', width: 14 },
        { header: 'Quantity', align: 'right' as const, width: 14 },
        { header: 'Unit price', align: 'right' as const, width: 14 },
        { header: 'Amount', align: 'right' as const, width: 14 },
      ]
    : [
        { header: 'Sr', align: 'center' as const, width: 8 },
        { header: 'Description', width: 52 },
        { header: 'HS code', width: 20 },
        { header: 'Quantity', align: 'right' as const, width: 20 },
      ];

  const rows = c.deal.items.map((item, i) =>
    opts.priced
      ? [
          String(i + 1), cell(item.description), cell(item.itc_hs_code ?? item.hs_code),
          quantity(item.quantity), money(item.unit_price), money(item.line_total),
        ]
      : [String(i + 1), cell(item.description), cell(item.itc_hs_code ?? item.hs_code), quantity(item.quantity)],
  );

  return {
    kind: 'table',
    title: 'Goods',
    columns,
    rows,
    ...(opts.priced ? { totals: [{ label: 'Total', value: money(c.deal.goods_total) }] } : {}),
  };
}

/** Transport. Rows with no value are dropped, so an air shipment shows no vessel line. */
function transport(c: Ctx, opts: { ports?: boolean } = { ports: true }): KeyValueBlock {
  const rows = [
    ...(opts.ports
      ? [
          { label: 'Port of loading', value: port(c.shipment.port_of_loading) },
          { label: 'Port of discharge', value: port(c.shipment.port_of_discharge) },
        ]
      : []),
    { label: 'Final destination', value: cell(c.shipment.final_destination_country) },
    { label: 'Mode', value: cell(c.shipment.mode) },
    { label: 'Vessel / flight', value: cell(c.shipment.vessel_or_flight_no) },
    { label: 'Voyage', value: cell(c.shipment.voyage_no) },
    {
      label: c.shipment.transport_document_type === 'air_waybill' ? 'AWB no' : 'B/L no',
      value: cell(c.shipment.transport_document_no),
    },
    { label: 'Container / seal', value: cell([c.shipment.container_no, c.shipment.seal_no].filter(Boolean).join(' / ') || null) },
    { label: 'Marks and numbers', value: cell(c.shipment.marks_and_numbers) },
    { label: 'Shipped on', value: date(c.shipment.shipped_on_date) },
  ].filter((r) => r.value !== null);

  return { kind: 'key_values', title: 'Transport', columns: 2, rows };
}

/** Packages, one row per package line. Totals are the frozen derived sums, never recomputed. */
function packagesTable(c: Ctx): TableBlock {
  return {
    kind: 'table',
    title: 'Packages',
    columns: [
      { header: 'Sr', align: 'center', width: 6 },
      { header: 'Type', width: 16 },
      { header: 'Count', align: 'right', width: 10 },
      { header: 'Contents', width: 26 },
      { header: 'Net (kg)', align: 'right', width: 14 },
      { header: 'Gross (kg)', align: 'right', width: 14 },
      { header: 'CBM', align: 'right', width: 14 },
    ],
    rows: c.shipment.packages.map((p) => [
      String(p.sequence), cell(p.package_type), String(p.package_count),
      cell(p.contents_description),
      // Absent stays absent. The legacy renderer turned these into 0.00.
      decimal(p.net_weight_kg), decimal(p.gross_weight_kg), decimal(p.volume_cbm),
    ]),
    totals: [
      { label: 'Total packages', value: String(c.shipment.package_totals.package_count) },
      { label: 'Total net weight', value: decimal(c.shipment.package_totals.net_weight_kg, 'kg') },
      { label: 'Total gross weight', value: decimal(c.shipment.package_totals.gross_weight_kg, 'kg') },
      { label: 'Total volume', value: decimal(c.shipment.package_totals.volume_cbm, 'CBM') },
    ],
  };
}

/**
 * The exchange rate, rendered truthfully.
 *
 * The recorded rate is printed, with the source it was recorded under and the citation given
 * for it. The legacy PDF instead DERIVED a rate by dividing the INR total by the foreign total
 * and printed the result to two decimals — a number that had never been quoted by anyone. The
 * source is stated as what it is: `manual_entry` says so, and `rbi_reference` shows the
 * notification it cited, because Phase 5 stores an operator assertion, not a verified feed.
 */
function exchangeRate(c: Ctx): Block | null {
  const rate = c.financial.exchange_rate;
  if (!rate) return null;
  const sourceLabel: Record<string, string> = {
    rbi_reference: 'RBI reference rate',
    customs_notified: 'Customs notified rate',
    bank_quoted: 'Bank quoted',
    manual_entry: 'Manually recorded',
  };
  return {
    kind: 'key_values',
    title: 'Exchange rate',
    columns: 2,
    rows: [
      { label: 'Rate', value: `1 ${rate.base_currency} = ${rate.quote_currency} ${rate.rate}` },
      { label: 'Applicable date', value: date(rate.rate_date) },
      { label: 'Source', value: sourceLabel[rate.source] ?? rate.source },
      { label: 'Citation', value: cell(rate.source_reference) },
      { label: 'Value in INR', value: money(c.financial.invoice_total_in_quote_currency) },
    ].filter((r) => r.value !== null),
  };
}

function signature(c: Ctx): Block {
  return {
    kind: 'signature',
    forParty: `For ${c.exporter.legal_name ?? c.exporter.display_name}`,
    caption: 'Authorised Signatory',
  };
}

/** Reference block: what identifies this document. */
function reference(c: Ctx, meta: DocumentRenderMetadata, docType: DocType): { label: string; value: ReturnType<typeof cell> }[] {
  const invoiceish = docType === DocType.CI || docType === DocType.PI;
  const rows: { label: string; value: ReturnType<typeof cell> }[] = [];

  if (docType === DocType.CI) {
    rows.push({ label: 'Invoice no', value: cell(c.references.invoice_number) });
    rows.push({ label: 'Invoice date', value: date(c.references.invoice_date) });
  } else if (invoiceish) {
    // A proforma is a quotation and carries no official invoice number — Phase 5's readiness
    // rules say so, and printing the CI's number here would misrepresent it.
    rows.push({ label: 'Reference', value: cell(c.deal.buyer_reference) });
    rows.push({ label: 'Date', value: date(meta.generated_at) });
  } else {
    rows.push({ label: 'Invoice no', value: cell(c.references.invoice_number) });
    rows.push({ label: 'Date', value: date(meta.generated_at) });
  }

  if (docType === DocType.shipping_bill_draft && c.shipment.shipping_bill_no) {
    rows.push({ label: 'Shipping bill no', value: cell(c.shipment.shipping_bill_no) });
    rows.push({ label: 'Shipping bill date', value: date(c.shipment.shipping_bill_date) });
  }

  rows.push({ label: 'Version', value: String(c.references.document_version ?? 1) });
  return rows;
}

/**
 * FEMA declaration wording, selected by payment terms.
 *
 * Adapted from the legacy `templates/femaAdvance | femaLC | femaDocumentaryCollection |
 * nonRestricted` files. The legacy version did `String.replace` over `{{exporterName}}`
 * placeholders against an untyped invoice, which is why an unknown placeholder rendered as
 * literal `{{...}}` on the page. Here the wording is a function of typed values.
 */
function declarationParagraphs(c: Ctx): string[] {
  const terms = String(paymentTerms(c.deal.payment_terms) ?? '').toLowerCase();
  const exporter = c.exporter.legal_name ?? c.exporter.display_name;
  const value = money(c.deal.goods_total) ?? 'the invoice value';

  const base = [
    `We, ${exporter}, declare that the particulars given in this document and its accompanying invoice are true and correct to the best of our knowledge and belief.`,
    `We declare that the goods described are of ${c.exporter.country_of_origin ?? 'the stated'} origin and that the export value of ${value} represents the full export value agreed with the buyer.`,
  ];

  if (terms.includes('advance')) {
    base.push('Payment has been received in advance. We undertake to comply with the Foreign Exchange Management Act, 1999 and the RBI Master Direction on Export of Goods and Services in respect of this consignment.');
  } else if (terms.includes('lc') || terms.includes('letter of credit')) {
    base.push('Payment is secured by documentary credit. We undertake to realise and repatriate the export proceeds within the period prescribed under the Foreign Exchange Management Act, 1999.');
  } else if (['da', 'dp', 'cad', 'collection'].some((k) => terms.includes(k))) {
    base.push('Payment is on documentary collection terms. We undertake to realise and repatriate the export proceeds within the period prescribed under the Foreign Exchange Management Act, 1999.');
  } else {
    base.push('We undertake to realise and repatriate the export proceeds within the period prescribed under the Foreign Exchange Management Act, 1999.');
  }

  return base;
}

/** Every adapter, keyed by document type. A type absent from this map is unsupported. */
const ADAPTERS: Partial<Record<DocType, (c: Ctx, meta: DocumentRenderMetadata) => Block[]>> = {
  [DocType.PI]: (c) => [
    parties(c), identifiers(c), commercialTerms(c), goodsTable(c, { priced: true }),
    {
      kind: 'note', muted: true,
      paragraphs: ['This proforma invoice is a quotation. It is not an issued commercial invoice and carries no invoice number.'],
    },
    signature(c),
  ],

  [DocType.CI]: (c) => {
    const blocks: Block[] = [parties(c), identifiers(c), commercialTerms(c), goodsTable(c, { priced: true })];
    const fx = exchangeRate(c);
    if (fx) blocks.push(fx);
    const t = transport(c);
    if (t.rows.length > 0) blocks.push(t);
    blocks.push(signature(c));
    return blocks;
  },

  [DocType.packing_list]: (c) => [
    parties(c), identifiers(c),
    { kind: 'key_values', title: 'Consignment', columns: 2, rows: [
      { label: 'Incoterm', value: cell(c.deal.incoterm) },
      { label: 'Buyer reference', value: cell(c.deal.buyer_reference) },
      { label: 'Marks and numbers', value: cell(c.shipment.marks_and_numbers) },
      { label: 'Country of origin', value: cell(c.exporter.country_of_origin) },
    ] },
    goodsTable(c, { priced: false }),
    packagesTable(c),
    transport(c),
    // Documented limitation rather than fabricated data — see the phase note on per-carton marks.
    { kind: 'note', muted: true, paragraphs: [
      'Marks and numbers apply to the consignment as a whole. Package lines are not individually marked.',
    ] },
    signature(c),
  ],

  [DocType.shipping_bill_draft]: (c) => [
    parties(c), identifiers(c, { adCode: true }), commercialTerms(c),
    goodsTable(c, { priced: true }),
    { kind: 'key_values', title: 'Valuation', columns: 2, rows: [
      { label: 'FOB value', value: money(c.financial.fob_value) },
      { label: 'Freight', value: money(c.financial.freight) },
      { label: 'Insurance', value: money(c.financial.insurance) },
      { label: 'CIF value', value: money(c.financial.cif_value) },
      { label: 'Other charges', value: money(c.financial.other_charges) },
    ].filter((r) => r.value !== null) },
    transport(c),
    { kind: 'note', muted: true, paragraphs: [
      'Draft prepared for filing. This is not a customs-accepted shipping bill and carries no ICEGATE acknowledgement.',
    ] },
    signature(c),
  ],

  [DocType.COO_draft]: (c) => [
    parties(c), identifiers(c),
    { kind: 'key_values', title: 'Origin', columns: 2, rows: [
      { label: 'Country of origin', value: cell(c.exporter.country_of_origin) },
      { label: 'Port of discharge', value: port(c.shipment.port_of_discharge) },
      { label: 'Destination country', value: cell(c.shipment.final_destination_country ?? c.buyer.address.country_code) },
      { label: 'Transport', value: cell(c.shipment.mode) },
    ].filter((r) => r.value !== null) },
    goodsTable(c, { priced: false }),
    // No chamber name, no registration number, no certifying authority. ClearTrade has no
    // chamber workflow, so any value in those boxes would be fabricated certification.
    { kind: 'note', muted: true, paragraphs: [
      'Draft only. This document has not been certified by a Chamber of Commerce or any other issuing authority, and no certification reference has been assigned.',
    ] },
    signature(c),
  ],

  [DocType.declaration]: (c) => [
    parties(c), identifiers(c),
    { kind: 'key_values', title: 'Consignment', columns: 2, rows: [
      { label: 'Invoice no', value: cell(c.references.invoice_number) },
      { label: 'Value', value: money(c.deal.goods_total) },
      { label: 'Incoterm', value: cell(c.deal.incoterm) },
      { label: 'Payment terms', value: paymentTerms(c.deal.payment_terms) },
    ] },
    { kind: 'note', title: 'Declaration', paragraphs: declarationParagraphs(c) },
    signature(c),
  ],

  [DocType.insurance_declaration]: (c) => [
    parties(c), identifiers(c),
    { kind: 'key_values', title: 'Policy', columns: 2, rows: [
      { label: 'Insurer', value: cell(c.financial.insurance_policy?.provider_name ?? null) },
      { label: 'Policy reference', value: cell(c.financial.insurance_policy?.policy_ref ?? null) },
      // The sum insured, NOT the premium. Conflating them would put the cost of cover in the
      // box that states how much cover exists.
      { label: 'Sum insured', value: money(c.financial.insurance_policy?.covered_amount ?? null) },
      { label: 'Premium', value: money(c.financial.insurance) },
      { label: 'Status', value: cell(c.financial.insurance_policy?.status ?? null) },
    ].filter((r) => r.value !== null) },
    goodsTable(c, { priced: true }),
    transport(c),
    // No signature block, deliberately.
    //
    // Every other document here carries one because the exporter is asserting something: the
    // declaration makes FEMA undertakings, the invoice states an agreed price. This one asserts
    // nothing — it restates cover the INSURER granted, read back from InsuranceCase. Printing
    // "For <exporter> / Authorised Signatory" on it would imply an attestation the exporter was
    // never asked to make, which is exactly why the registry sets `approval_required: false`.
    // The signature line and the approval policy have to agree, and the policy is the one that
    // matches what the document actually says.
    {
      kind: 'note', muted: true,
      paragraphs: [
        'This declaration restates the insurance cover recorded against this shipment. It is not a policy or certificate issued by an insurer, and it does not itself provide cover — the insurer\'s own document is the cover.',
      ],
    },
  ],
};

export function isSupportedDocType(docType: string): docType is DocType {
  return docType in ADAPTERS;
}

export function buildDocumentModel(
  docType: DocType,
  context: Ctx,
  metadata: DocumentRenderMetadata,
  contentHash: string,
): DocumentModel {
  const adapter = ADAPTERS[docType];
  if (!adapter) throw new Error(`No adapter for document type ${docType}.`);

  return {
    title: DOC_TITLES[docType] ?? docType.toUpperCase(),
    // A draft says so on its face, in the title area, not only in a watermark.
    ...(metadata.draft ? { subtitle: 'DRAFT — not an issued document' } : {}),
    reference: reference(context, metadata, docType),
    blocks: adapter(context, metadata),
    footer: {
      brand: metadata.brand_name,
      auditId: metadata.audit_id,
      contentHash,
      generatedAt: metadata.generated_at,
    },
    ...(metadata.draft ? { watermark: 'DRAFT' } : {}),
  };
}
