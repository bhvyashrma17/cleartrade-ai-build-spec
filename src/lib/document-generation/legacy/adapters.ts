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
import { documentApplicability, type DocumentGenerationContext } from '@/lib/document-data';
import type { DocumentRenderMetadata } from '../engine';
import {
  addressLines, cell, date, decimal, exchangeRate, money as formatMoney,
  paymentTerms, port, quantity, unitPrice as formatUnitPrice,
} from './format';
import type { Block, DocumentModel, KeyValueBlock, TableBlock } from './model';

const DOC_TITLES: Record<string, string> = {
  [DocType.PI]: 'PROFORMA INVOICE',
  [DocType.CI]: 'COMMERCIAL INVOICE',
  [DocType.packing_list]: 'PACKING LIST',
  [DocType.shipping_bill_draft]: 'SHIPPING BILL (DRAFT)',
  [DocType.COO_draft]: 'CERTIFICATE OF ORIGIN (DRAFT)',
  [DocType.declaration]: 'EXPORTER DECLARATION',
  [DocType.insurance_declaration]: 'INSURANCE DECLARATION',
  [DocType.shipping_instructions]: 'SHIPPING INSTRUCTIONS',
  [DocType.vgm_declaration]: 'VERIFIED GROSS MASS DECLARATION',
  [DocType.bill_of_exchange]: 'BILL OF EXCHANGE',
  [DocType.bank_collection_letter]: 'BANK DOCUMENT PRESENTATION / COLLECTION COVER LETTER',
};

type Ctx = DocumentGenerationContext;

/**
 * Money formatters bound to the policy frozen in THIS context.
 *
 * Bound once per call rather than reaching for the current policy inside each helper: a
 * document re-rendered years later must present its amounts the way it did when it was
 * generated, and the only way to guarantee that is to read the version off the frozen input.
 */
const moneyOf = (c: Ctx) => (v: Parameters<typeof formatMoney>[0]) => formatMoney(v, c.money_policy_version);
const unitPriceOf = (c: Ctx) => (v: Parameters<typeof formatUnitPrice>[0]) => formatUnitPrice(v, c.money_policy_version);

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
  const money = moneyOf(c);
  const unitPrice = unitPriceOf(c);
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
          // Unit price keeps its agreed precision; the line amount is rounded to the currency.
          quantity(item.quantity), unitPrice(item.unit_price), money(item.line_total),
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
function exchangeRateBlock(c: Ctx): Block | null {
  const money = moneyOf(c);
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
      // The rate itself is NOT rounded to the quote currency's minor units — doing so would
      // break the conversion it states.
      { label: 'Rate', value: `1 ${rate.base_currency} = ${rate.quote_currency} ${exchangeRate(rate.rate)}` },
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

function partyPair(
  left: { heading: string; name: string; lines?: string[] },
  right: { heading: string; name: string; lines?: string[] },
): Block {
  return {
    kind: 'parties',
    left: { heading: left.heading, lines: [left.name, ...(left.lines ?? [])] },
    right: { heading: right.heading, lines: [right.name, ...(right.lines ?? [])] },
  };
}

function notifyParty(c: Ctx): KeyValueBlock | null {
  const notify = c.shipment.notify_party;
  if (!notify || notify.mode === 'none') return null;
  if (notify.mode === 'same_as_consignee') {
    return {
      kind: 'key_values', title: 'Notify party', columns: 1,
      rows: [{ label: 'Party', value: 'Same as consignee' }],
    };
  }
  return {
    kind: 'key_values', title: 'Notify party', columns: 2,
    rows: [
      { label: 'Name', value: cell(notify.name) },
      { label: 'Address', value: cell(addressLines(notify.address).join(', ')) },
      { label: 'Email', value: cell(notify.email) },
      { label: 'Phone', value: cell(notify.phone) },
    ].filter((row) => row.value !== null),
  };
}

function routing(c: Ctx): KeyValueBlock {
  return {
    kind: 'key_values', title: 'Routing', columns: 2,
    rows: [
      { label: 'Transport mode', value: cell(c.shipment.mode) },
      { label: 'Port of loading', value: port(c.shipment.port_of_loading) },
      { label: 'Port of discharge', value: port(c.shipment.port_of_discharge) },
      { label: 'Final destination', value: cell(c.shipment.final_destination_name ?? c.shipment.final_destination_country) },
      { label: 'Booking reference', value: cell(c.shipment.booking_reference) },
      { label: 'Carrier / forwarder', value: cell(c.shipment.freight_partner?.name) },
      { label: 'Vessel / flight', value: cell(c.shipment.vessel_or_flight_no) },
      { label: 'Voyage', value: cell(c.shipment.voyage_no) },
    ].filter((row) => row.value !== null),
  };
}

function shippingTerms(c: Ctx): KeyValueBlock {
  return {
    kind: 'key_values', title: 'Shipping terms', columns: 2,
    rows: [
      { label: 'Incoterm', value: cell(c.deal.incoterm ? `${c.deal.incoterm}${c.deal.incoterm_place ? ` ${c.deal.incoterm_place}` : ''}` : null) },
      { label: 'Freight terms', value: cell(c.shipment.freight_payment_term) },
      { label: 'Marks and numbers', value: cell(c.shipment.marks_and_numbers) },
      { label: 'Buyer reference', value: cell(c.deal.buyer_reference) },
    ],
  };
}

function containerDetails(c: Ctx): TableBlock | null {
  const containers = c.shipment.containers ?? [];
  if (containers.length === 0) return null;
  return {
    kind: 'table', title: 'Containers',
    columns: [
      { header: 'Sr', align: 'center', width: 8 },
      { header: 'Container no', width: 32 },
      { header: 'Type', width: 25 },
      { header: 'Seal no', width: 35 },
    ],
    rows: containers.map((container) => [
      String(container.sequence), cell(container.container_number),
      cell(container.container_type), cell(container.seal_number),
    ]),
  };
}

function shippingInstructionsAdapter(c: Ctx): Block[] {
  const blocks: Block[] = [
    parties(c),
    { kind: 'note', paragraphs: ['Instructions to the appointed carrier or freight forwarder for preparation and movement of this shipment.'] },
  ];
  const notify = notifyParty(c);
  if (notify) blocks.push(notify);
  blocks.push(routing(c), shippingTerms(c), goodsTable(c, { priced: false }), packagesTable(c));
  const containers = containerDetails(c);
  if (containers) blocks.push(containers);
  if (c.shipment.handling_instructions) {
    blocks.push({ kind: 'note', title: 'Special instructions', paragraphs: [c.shipment.handling_instructions] });
  }
  blocks.push({
    kind: 'note', muted: true,
    paragraphs: ['These are operational shipping instructions. They are not a Bill of Lading, Air Waybill, or carrier-issued transport document.'],
  });
  blocks.push(signature(c));
  return blocks;
}

function vgmDeclarationAdapter(c: Ctx): Block[] {
  const exporter = c.exporter.legal_name ?? c.exporter.display_name;
  const containers = c.shipment.containers ?? [];
  return [
    partyPair(
      { heading: 'Shipper', name: exporter, lines: addressLines(c.exporter.address) },
      {
        heading: 'Shipment', name: c.shipment.booking_reference ?? c.references.deal_id,
        lines: [c.shipment.freight_partner?.name, port(c.shipment.port_of_loading), port(c.shipment.port_of_discharge)]
          .filter((line): line is string => Boolean(line)),
      },
    ),
    {
      kind: 'table', title: 'Verified container masses',
      columns: [
        { header: 'Container no', width: 22 },
        { header: 'Type', width: 12 },
        { header: 'Seal no', width: 14 },
        { header: 'VGM', align: 'right', width: 16 },
        { header: 'Method', width: 12 },
        { header: 'Verified on', width: 15 },
        { header: 'Verifier / authorised person', width: 24 },
      ],
      rows: containers.map((container) => [
        cell(container.container_number), cell(container.container_type), cell(container.seal_number),
        decimal(container.verified_gross_mass_kg, 'kg'),
        container.vgm_method === 'method_1' ? 'Method 1' : container.vgm_method === 'method_2' ? 'Method 2' : cell(container.vgm_method),
        date(container.verified_at),
        cell([container.verifier_name, container.verifier_capacity].filter(Boolean).join(' — ')),
      ]),
    },
    {
      kind: 'note', title: 'Shipper declaration',
      paragraphs: [
        `We, ${exporter}, declare that the verified gross masses stated above are the shipper's declared VGM values, recorded using the stated verification methods and authorised-person details.`,
        'No package weight or estimated cargo mass has been substituted for a verified gross mass in this declaration.',
      ],
    },
    signature(c),
  ];
}

function billOfExchangeAdapter(c: Ctx): Block[] {
  const bill = c.trade_finance?.bill_of_exchange;
  const payment = c.trade_finance?.payment;
  const exporter = c.exporter.legal_name ?? c.exporter.display_name;
  const billType = bill?.type === 'usance' ? 'Usance' : bill?.type === 'sight' ? 'Sight' : cell(bill?.type);
  const payable = bill?.type === 'usance'
    ? `At ${bill.tenor_days} days, pay against this Bill of Exchange the stated amount to the order of the drawer, subject to the recorded payment terms.`
    : 'At sight, pay against this Bill of Exchange the stated amount to the order of the drawer, subject to the recorded payment terms.';
  return [
    partyPair(
      { heading: 'Drawer', name: exporter, lines: addressLines(c.exporter.address) },
      { heading: 'Drawee', name: c.buyer.document_name, lines: addressLines(c.buyer.address) },
    ),
    { kind: 'note', title: 'Payable wording', paragraphs: [payable] },
    {
      kind: 'key_values', title: 'Draft particulars', columns: 2,
      rows: [
        { label: 'Amount', value: moneyOf(c)(payment?.amount) },
        { label: 'Draft type', value: billType },
        { label: 'Tenor', value: bill?.type === 'usance' && bill.tenor_days ? `${bill.tenor_days} days` : 'At sight' },
        { label: 'Place of drawing', value: cell(bill?.place_of_drawing) },
        { label: 'Date of drawing', value: date(bill?.drawn_on_date) },
        { label: 'Payment mechanism', value: cell(c.trade_finance?.payment_mechanism) },
        { label: 'Payment reference', value: cell(payment?.reference) },
        { label: 'Recorded payment terms', value: paymentTerms(c.deal.payment_terms) },
      ],
    },
    {
      kind: 'key_values', title: 'Commercial and shipment references', columns: 2,
      rows: [
        { label: 'Invoice no', value: cell(c.references.invoice_number) },
        { label: 'Invoice date', value: date(c.references.invoice_date) },
        { label: 'Shipment reference', value: cell(c.shipment.booking_reference ?? c.shipment.transport_document_no) },
        { label: 'Deal reference', value: cell(c.references.deal_id) },
      ],
    },
    {
      kind: 'note', muted: true,
      paragraphs: ['Generated as a commercial draft for presentation. ClearTrade generation does not constitute drawee acceptance, payment, or bank confirmation.'],
    },
    signature(c),
  ];
}

function carrierInstructionsAdapter(c: Ctx): Block[] {
  const blocks = shippingInstructionsAdapter(c);
  // Replace the broader shipping-instruction notes while retaining the exact shared visual
  // blocks for parties, routing, cargo, packages, containers and signature.
  return [
    blocks[0]!,
    { kind: 'note', paragraphs: ['Instructions for carrier/forwarder preparation.'] },
    ...blocks.slice(2, -2),
    {
      kind: 'note', muted: true,
      paragraphs: [c.shipment.mode === 'air'
        ? 'These are preparation instructions only. This is not an issued Air Waybill and carries no carrier acceptance.'
        : 'These are preparation instructions only. This is not an issued Bill of Lading and carries no carrier acceptance.'],
    },
    blocks[blocks.length - 1]!,
  ];
}

function bankCollectionLetterAdapter(c: Ctx): Block[] {
  const presentation = c.trade_finance?.bank_presentation;
  const bank = presentation?.bank;
  const payment = c.trade_finance?.payment;
  const exporter = c.exporter.legal_name ?? c.exporter.display_name;
  return [
    partyPair(
      { heading: 'From', name: exporter, lines: addressLines(c.exporter.address) },
      {
        heading: 'To', name: bank?.name ?? 'Bank',
        lines: [bank?.branch_name, bank?.branch_address].filter((line): line is string => Boolean(line)),
      },
    ),
    {
      kind: 'note', title: 'Presentation request',
      paragraphs: [
        `Please handle the enclosed export documents under the recorded ${presentation?.type ?? 'bank presentation'} instructions set out below.`,
      ],
    },
    {
      kind: 'key_values', title: 'Presentation details', columns: 2,
      rows: [
        { label: 'Presentation type', value: cell(presentation?.type) },
        { label: 'Amount', value: moneyOf(c)(payment?.amount) },
        { label: 'Payment mechanism', value: cell(c.trade_finance?.payment_mechanism) },
        { label: 'Payment reference', value: cell(payment?.reference) },
        { label: 'Invoice no', value: cell(c.references.invoice_number) },
        { label: 'Invoice date', value: date(c.references.invoice_date) },
        { label: 'Shipment reference', value: cell(c.shipment.booking_reference ?? c.shipment.transport_document_no) },
        { label: 'Deal reference', value: cell(c.references.deal_id) },
      ],
    },
    {
      kind: 'key_values', title: 'Bank details', columns: 2,
      rows: [
        { label: 'Bank', value: cell(bank?.name) },
        { label: 'Branch', value: cell(bank?.branch_name) },
        { label: 'Account reference', value: cell(bank?.account_reference) },
        { label: 'IFSC', value: cell(bank?.ifsc) },
        { label: 'SWIFT / BIC', value: cell(bank?.swift_bic) },
        { label: 'AD code', value: cell(bank?.ad_code) },
      ].filter((row) => row.value !== null),
    },
    {
      kind: 'table', title: 'Documents enclosed',
      columns: [
        { header: 'Document', width: 50 },
        { header: 'Version', align: 'center', width: 15 },
        { header: 'Originals', align: 'right', width: 17 },
        { header: 'Copies', align: 'right', width: 18 },
      ],
      rows: (presentation?.enclosed_documents ?? []).map((document) => [
        document.doc_type.replace(/_/g, ' '), String(document.version),
        String(document.original_count), String(document.copy_count),
      ]),
    },
    {
      kind: 'note', title: 'Collection / negotiation instructions',
      paragraphs: [presentation?.collection_instructions ?? ''],
    },
    {
      kind: 'note', title: 'Charges', paragraphs: [presentation?.charges_instruction ?? ''],
    },
    {
      kind: 'note', muted: true,
      paragraphs: ['This is a document-presentation covering letter. It is not bank acceptance, negotiation, payment, or realization confirmation.'],
    },
    signature(c),
  ];
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
  const money = moneyOf(c);
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
    const fx = exchangeRateBlock(c);
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
      { label: 'FOB value', value: moneyOf(c)(c.financial.fob_value) },
      { label: 'Freight', value: moneyOf(c)(c.financial.freight) },
      { label: 'Insurance', value: moneyOf(c)(c.financial.insurance) },
      { label: 'CIF value', value: moneyOf(c)(c.financial.cif_value) },
      { label: 'Other charges', value: moneyOf(c)(c.financial.other_charges) },
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
      { label: 'Value', value: moneyOf(c)(c.deal.goods_total) },
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
      { label: 'Sum insured', value: moneyOf(c)(c.financial.insurance_policy?.covered_amount ?? null) },
      { label: 'Premium', value: moneyOf(c)(c.financial.insurance) },
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

  [DocType.shipping_instructions]: shippingInstructionsAdapter,
  [DocType.vgm_declaration]: vgmDeclarationAdapter,
  [DocType.bill_of_exchange]: billOfExchangeAdapter,
  [DocType.carrier_instructions]: carrierInstructionsAdapter,
  [DocType.bank_collection_letter]: bankCollectionLetterAdapter,
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

  const title = docType === DocType.carrier_instructions
    ? documentApplicability(context, docType).variant === 'air_waybill_instructions'
      ? 'AIR WAYBILL INSTRUCTIONS'
      : 'BILL OF LADING INSTRUCTIONS'
    : DOC_TITLES[docType] ?? docType.toUpperCase();

  return {
    title,
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
