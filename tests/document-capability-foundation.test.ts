import { DocType } from '@prisma/client';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import {
  documentApplicability, documentReadiness, hashContext,
  type DocumentGenerationContext,
} from '../src/lib/document-data';
import {
  DOCUMENT_FORMAT_SUPPORT, LegacyDocumentEngine, UnrenderableTextError, buildDocumentModel,
  preflightPdfGlyphs, type DocumentRenderRequest,
} from '../src/lib/document-generation';
import { formatDocumentMoney } from '../src/lib/document-money';

function context(overrides: Partial<DocumentGenerationContext> = {}): DocumentGenerationContext {
  const base: DocumentGenerationContext = {
    builder_version: 3,
    money_policy_version: 'v1',
    doc_type: DocType.shipping_instructions,
    built_at: '2026-08-21T00:00:00.000Z',
    exporter: {
      org_id: 'org-a', legal_name: 'Alpha Exports Pvt Ltd', display_name: 'Alpha',
      address: { line1: '12 Dock Road', line2: null, city: 'Mumbai', region: 'MH', postal_code: '400001', country_code: 'IN' },
      iec_number: 'IEC001', iec_status: 'verified', gstin: 'GST001', ad_code: '6390004',
      country_of_origin: 'IN',
    },
    buyer: {
      buyer_id: 'buyer-a', document_name: 'Nordwind GmbH', legal_name: 'Nordwind GmbH',
      address: { line1: 'Hafenstrasse 4', line2: null, city: 'Hamburg', region: null, postal_code: '20457', country_code: 'DE' },
      tax_identifier: null, tax_identifier_type: null, contact_email: null, contact_phone: null,
    },
    deal: {
      deal_id: 'deal-a', stage: 'executing', incoterm: 'FOB', incoterm_place: 'Nhava Sheva',
      payment_terms: { type: 'advance', description: '100% advance' }, buyer_reference: 'PO-1',
      currency: 'USD', goods_total: { amount: '1543.125', currency: 'USD' },
      items: [{
        description: 'Basmati rice', hs_code: '100630', itc_hs_code: '10063020',
        quantity: { value: '1250', unit: 'kg' }, unit_price: { amount: '1.2345', currency: 'USD' },
        line_total: { amount: '1543.125', currency: 'USD' },
      }],
    },
    shipment: {
      shipment_id: 'shipment-a', status: 'booking', mode: 'sea',
      port_of_loading: { name: 'Nhava Sheva', unlocode: 'INNSA', country_code: 'IN' },
      port_of_discharge: { name: 'Hamburg', unlocode: 'DEHAM', country_code: 'DE' },
      final_destination_country: 'DE', final_destination_name: 'Hamburg',
      booking_reference: 'BOOK-1', freight_partner: { name: 'Carrier Ltd', email: null, phone: null },
      freight_payment_term: 'prepaid', handling_instructions: null,
      notify_party: {
        mode: 'none', name: null,
        address: { line1: null, line2: null, city: null, region: null, postal_code: null, country_code: null },
        email: null, phone: null,
      },
      containerized: true,
      containers: [
        {
          sequence: 1, container_number: 'MSCU1234567', container_type: "40'HC", seal_number: 'S1',
          tare_weight_kg: '3800', verified_gross_mass_kg: '29200', vgm_method: 'method_1',
          method_2_component_mass_kg: null, verified_at: '2026-08-20T00:00:00.000Z',
          verifier_name: 'Authorized Weigher', verifier_capacity: 'Weighbridge operator', evidence_ref: 'EV-1',
        },
        {
          sequence: 2, container_number: 'MSCU7654321', container_type: "40'HC", seal_number: 'S2',
          tare_weight_kg: '3750', verified_gross_mass_kg: '28750', vgm_method: 'method_2',
          method_2_component_mass_kg: '25000', verified_at: '2026-08-20T00:00:00.000Z',
          verifier_name: 'Exporter Signatory', verifier_capacity: 'Authorized person', evidence_ref: 'EV-2',
        },
      ],
      vessel_or_flight_no: 'MV Concord', voyage_no: '024W', container_no: 'legacy-one',
      container_type: null, seal_no: null, transport_document_type: null,
      transport_document_no: null, transport_document_date: null, shipping_bill_no: null,
      shipping_bill_date: null, marks_and_numbers: 'ALPHA/HAM/1-50', shipped_on_date: null,
      packages: [{
        sequence: 1, package_type: 'bag', package_count: 50, net_weight_kg: '25',
        gross_weight_kg: '25.4', volume_cbm: null, dimensions_cm: null,
        contents_description: 'Rice bags',
      }],
      package_totals: { package_count: 50, net_weight_kg: '1250', gross_weight_kg: '1270', volume_cbm: null },
    },
    financial: {
      freight: null, insurance: null, insurance_policy: null, other_charges: null,
      fob_value: { amount: '1543.125', currency: 'USD' }, cif_value: null,
      invoice_total: { amount: '1543.125', currency: 'USD' },
      exchange_rate: { base_currency: 'USD', quote_currency: 'INR', rate: '88.425', source: 'bank_quoted', source_reference: 'Q1', rate_date: '2026-08-20T00:00:00.000Z' },
      invoice_total_in_quote_currency: { amount: '136454.765625', currency: 'INR' },
    },
    references: { invoice_number: '00001/2026-27', invoice_date: '2026-08-21T00:00:00.000Z', deal_id: 'deal-a', document_version: 1 },
    trade_finance: {
      payment_mechanism: 'ADVANCE', payment: null, bill_of_exchange: null,
      bank_presentation: null,
    },
  };
  return { ...base, ...overrides };
}

function documentaryContext(overrides: Partial<DocumentGenerationContext> = {}): DocumentGenerationContext {
  const base = context();
  return context({
    deal: { ...base.deal, payment_terms: { type: 'DP', description: 'Documents against payment' } },
    trade_finance: {
      payment_mechanism: 'DP',
      payment: { id: 'pay-1', amount: { amount: '1543.1250', currency: 'USD' }, reference: 'COLL-1' },
      bill_of_exchange: {
        type: 'usance', tenor_days: 60, place_of_drawing: 'Mumbai',
        drawn_on_date: '2026-08-21T00:00:00.000Z',
      },
      bank_presentation: {
        type: 'collection', collection_instructions: 'Release documents against payment.',
        charges_instruction: 'All foreign bank charges for drawee.',
        bank: {
          name: 'Example Bank', branch_name: 'Fort Branch', branch_address: 'Mumbai',
          ifsc: 'EXAM0001', swift_bic: 'EXAMINBB', ad_code: '6390004', account_reference: 'A/C ending 1234',
        },
        enclosed_documents: [
          { document_id: 'ci-1', doc_type: 'CI', version: 1, original_count: 1, copy_count: 2 },
          { document_id: 'pl-1', doc_type: 'packing_list', version: 1, original_count: 1, copy_count: 1 },
        ],
      },
    },
    ...overrides,
  });
}

const metadata = {
  brand_name: 'ClearTrade AI', generated_at: new Date('2026-08-21T10:00:00.000Z'),
  audit_id: 'DOC-V1-ABCDEF12', draft: false,
};

function request(docType: DocType, ctx: DocumentGenerationContext, draft = false): DocumentRenderRequest {
  return {
    doc_type: docType, format: 'html', snapshot_id: 'snapshot-1', content_hash: 'a'.repeat(64),
    version: 1, context: { ...ctx, doc_type: docType }, metadata: { ...metadata, draft },
  };
}

function readZipEntry(buffer: Buffer, name: string): string | null {
  let offset = 0;
  while (offset < buffer.length - 4) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) { offset += 1; continue; }
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const entryName = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const dataStart = offset + 30 + nameLength + extraLength;
    if (entryName === name && compressedSize > 0) {
      const data = buffer.subarray(dataStart, dataStart + compressedSize);
      return method === 0 ? data.toString('utf8') : inflateRawSync(data).toString('utf8');
    }
    offset = dataStart + Math.max(compressedSize, 1);
  }
  return null;
}

describe('new document applicability', () => {
  test('VGM is not applicable to air or explicitly non-containerized sea shipments', () => {
    const air = context({ shipment: { ...context().shipment, mode: 'air', containerized: false, containers: [] } });
    expect(documentReadiness(air, DocType.vgm_declaration)).toMatchObject({
      status: 'not_applicable', applicability: { code: 'not_sea' }, missing: [], invalid: [],
    });

    const bulkSea = context({ shipment: { ...context().shipment, mode: 'sea', containerized: false, containers: [] } });
    expect(documentReadiness(bulkSea, DocType.vgm_declaration)).toMatchObject({
      status: 'not_applicable', applicability: { code: 'not_containerized' },
    });
  });

  test('carrier instructions select B/L for sea and AWB for air', () => {
    expect(documentApplicability(context(), DocType.carrier_instructions).variant)
      .toBe('bill_of_lading_instructions');
    const air = context({ shipment: { ...context().shipment, mode: 'air' } });
    expect(documentApplicability(air, DocType.carrier_instructions).variant)
      .toBe('air_waybill_instructions');
  });

  test('bills and bank letters apply only to classified documentary mechanisms', () => {
    expect(documentReadiness(context(), DocType.bill_of_exchange).status).toBe('not_applicable');
    expect(documentReadiness(context(), DocType.bank_collection_letter).status).toBe('not_applicable');

    const dp = context({
      deal: { ...context().deal, payment_terms: { type: 'DP', description: 'Documents against payment' } },
      trade_finance: { ...context().trade_finance!, payment_mechanism: 'DP' },
    });
    expect(documentApplicability(dp, DocType.bill_of_exchange).status).toBe('applicable');
    expect(documentApplicability(dp, DocType.bank_collection_letter).status).toBe('applicable');
  });
});

describe('new document readiness', () => {
  test('two independently verified containers make VGM ready', () => {
    expect(documentReadiness(context(), DocType.vgm_declaration)).toMatchObject({
      status: 'ready', missing: [], invalid: [],
    });
  });

  test('package mass never substitutes for missing verified VGM', () => {
    const containers = context().shipment.containers!.map((entry, index) =>
      index === 1 ? { ...entry, verified_gross_mass_kg: null, vgm_method: null, verified_at: null, verifier_name: null } : entry);
    const ctx = context({ shipment: { ...context().shipment, containers } });
    const readiness = documentReadiness(ctx, DocType.vgm_declaration);
    expect(readiness.status).toBe('missing_data');
    expect(readiness.missing.map((issue) => issue.field)).toContain('shipment.containers[].verified_gross_mass_kg');
    expect(ctx.shipment.package_totals.gross_weight_kg).toBe('1270');
  });

  test('an inconsistent Method 2 calculation blocks rather than becoming advice', () => {
    const containers = context().shipment.containers!.map((entry, index) =>
      index === 1 ? { ...entry, verified_gross_mass_kg: '29000' } : entry);
    const readiness = documentReadiness(
      context({ shipment: { ...context().shipment, containers } }), DocType.vgm_declaration,
    );
    expect(readiness.status).toBe('blocked');
    expect(readiness.invalid[0]?.detail).toContain('component mass plus tare');
  });

  test('notify party is advisory when undecided and blocking only when explicitly named', () => {
    const undecided = context({ shipment: { ...context().shipment, notify_party: null } });
    const advisory = documentReadiness(undecided, DocType.shipping_instructions);
    expect(advisory.status).toBe('ready');
    expect(advisory.advisory.map((issue) => issue.field)).toContain('shipment.notify_party.mode');

    const named = context({
      shipment: {
        ...context().shipment,
        notify_party: {
          mode: 'named', name: 'Notify Co',
          address: { line1: null, line2: null, city: null, region: null, postal_code: null, country_code: null },
          email: null, phone: null,
        },
      },
    });
    expect(documentReadiness(named, DocType.shipping_instructions).missing.map((issue) => issue.field))
      .toContain('shipment.notify_party');
  });

  test('a complete bill and bank presentation are ready and preserve decimal money', () => {
    const tradeFinance = {
      payment_mechanism: 'DP',
      payment: { id: 'pay-1', amount: { amount: '1543.1250', currency: 'USD' }, reference: 'COLL-1' },
      bill_of_exchange: { type: 'usance', tenor_days: 60, place_of_drawing: 'Mumbai', drawn_on_date: '2026-08-21T00:00:00.000Z' },
      bank_presentation: {
        type: 'collection', collection_instructions: 'Release documents against payment.',
        charges_instruction: 'All foreign bank charges for drawee.',
        bank: {
          name: 'Example Bank', branch_name: 'Fort Branch', branch_address: 'Mumbai',
          ifsc: 'EXAM0001', swift_bic: 'EXAMINBB', ad_code: '6390004', account_reference: 'A/C ending 1234',
        },
        enclosed_documents: [{ document_id: 'ci-1', doc_type: 'CI', version: 1, original_count: 1, copy_count: 2 }],
      },
    };
    const ctx = context({
      deal: { ...context().deal, payment_terms: { type: 'DP', description: 'Documents against payment' } },
      trade_finance: tradeFinance,
    });
    expect(documentReadiness(ctx, DocType.bill_of_exchange).status).toBe('ready');
    expect(documentReadiness(ctx, DocType.bank_collection_letter).status).toBe('ready');
    expect(ctx.trade_finance?.payment?.amount.amount).toBe('1543.1250');
    expect(formatDocumentMoney(ctx.trade_finance!.payment!.amount.amount, 'USD', ctx.money_policy_version))
      .toBe('USD 1,543.13');
  });
});

describe('snapshot and renderer compatibility', () => {
  test('a historical v2 context with no new sections remains readable and hashable', () => {
    const current = context();
    const { trade_finance: _tradeFinance, ...legacy } = current;
    const v2 = {
      ...legacy, builder_version: 2,
      shipment: {
        ...legacy.shipment,
        containers: undefined, containerized: undefined, notify_party: undefined,
        booking_reference: undefined, freight_partner: undefined, freight_payment_term: undefined,
      },
    } as DocumentGenerationContext;
    expect(documentReadiness(v2, DocType.PI).status).toBe('ready');
    expect(hashContext(v2)).toMatch(/^[0-9a-f]{64}$/);
  });

  test('all twelve generated types use the same three formats', () => {
    for (const type of [
      DocType.PI, DocType.CI, DocType.packing_list, DocType.shipping_bill_draft,
      DocType.COO_draft, DocType.declaration, DocType.insurance_declaration,
    ]) expect(DOCUMENT_FORMAT_SUPPORT[type]).toEqual(['pdf', 'docx', 'html']);

    for (const type of [
      DocType.shipping_instructions, DocType.vgm_declaration, DocType.bill_of_exchange,
      DocType.carrier_instructions, DocType.bank_collection_letter,
    ]) expect(DOCUMENT_FORMAT_SUPPORT[type]).toEqual(['pdf', 'docx', 'html']);
  });

  test('the original seven document models retain their golden structure', () => {
    const types = [
      DocType.PI, DocType.CI, DocType.packing_list, DocType.shipping_bill_draft,
      DocType.COO_draft, DocType.declaration, DocType.insurance_declaration,
    ];
    const digests = Object.fromEntries(types.map((type) => {
      const model = buildDocumentModel(type, context(), metadata, 'a'.repeat(64));
      return [type, createHash('sha256').update(JSON.stringify(model)).digest('hex')];
    }));
    expect(digests).toEqual({
      PI: '188ef816ed5ac36106fa7b75bd691568bc4dd5270d77206f40fe46bfddaa85b3',
      CI: '0f1ff23dd20faa77925ca6da49cf3399aa9409ab37912e1c2e1fba432ea6e848',
      packing_list: 'd720534b445d7ab8d5d387caba89cd9666f8ee0198651beee4c2ae1d7079649c',
      shipping_bill_draft: 'a520c308f6e0131757489c8cf1708cbdc6e5468487c2bdfe54d9fbaeb01bac4b',
      COO_draft: 'f2e3b6d085d2075f6e45b4617ca0fee7619e89119e76f0882bb5984b80ba6319',
      declaration: '15c9d9793ed9f600541b9da2c447be542b4efffbc0515f2a7f4815eb40f4ea0a',
      insurance_declaration: 'ebd2cc1cd943978442dc13adb0b8dc729d394020ad0f4a2587614491a5d64488',
    });
  });

  test('all twelve pass the deterministic shared visual-contract harness', async () => {
    const engine = new LegacyDocumentEngine();
    const documentary = documentaryContext();
    const cases = [
      [DocType.PI, context()], [DocType.CI, context()],
      [DocType.packing_list, context()], [DocType.shipping_bill_draft, context()],
      [DocType.COO_draft, context()], [DocType.declaration, context()],
      [DocType.insurance_declaration, context()], [DocType.shipping_instructions, context()],
      [DocType.vgm_declaration, context()], [DocType.bill_of_exchange, documentary],
      [DocType.carrier_instructions, context()], [DocType.bank_collection_letter, documentary],
    ] as const;

    for (const [type, ctx] of cases) {
      const renderRequest = request(type, ctx, true);
      const model = buildDocumentModel(type, renderRequest.context, renderRequest.metadata, renderRequest.content_hash);

      // Adapters supply content blocks only. Header hierarchy, watermark and footer are the
      // same model-level contract for every type, which prevents a one-off template style.
      expect(model.title).toBe(model.title.toUpperCase());
      expect(model.subtitle).toBe('DRAFT — not an issued document');
      expect(model.watermark).toBe('DRAFT');
      expect(model.reference).toHaveLength(3);
      expect(model.reference.map((row) => row.label)).toContain('Version');
      expect(model.reference.every((row) => Boolean(row.label) && !('style' in row))).toBe(true);
      expect(model.footer).toMatchObject({
        brand: 'ClearTrade AI', auditId: 'DOC-V1-ABCDEF12', contentHash: 'a'.repeat(64),
      });
      for (const block of model.blocks.filter((candidate) => candidate.kind === 'table')) {
        if (block.kind !== 'table') continue;
        expect(block.columns.every((column) => Boolean(column.header) && !('style' in column))).toBe(true);
      }

      const [pdf, docx, html] = await Promise.all([
        engine.render({ ...renderRequest, format: 'pdf' }),
        engine.render({ ...renderRequest, format: 'docx' }),
        engine.render({ ...renderRequest, format: 'html' }),
      ]);
      const htmlText = html.bytes.toString('utf8');
      const documentXml = readZipEntry(docx.bytes, 'word/document.xml') ?? '';
      const footerXml = readZipEntry(docx.bytes, 'word/footer1.xml') ?? '';

      expect(pdf.bytes.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pdf.provenance).toMatchObject({ engine: 'legacy', engine_version: '1.1.0', doc_type: type, draft: true });
      expect(htmlText).toContain('<div class="head">');
      expect(htmlText).toContain('<div class="watermark">DRAFT</div>');
      expect(htmlText).toContain('<footer><span>ClearTrade AI');
      expect(htmlText).toContain('font-family: "Helvetica Neue", Helvetica, Arial, sans-serif');
      expect(documentXml).toContain(model.title);
      expect(documentXml).toContain('Calibri');
      expect(documentXml).toContain('DRAFT — not an issued document');
      expect(footerXml).toContain('ClearTrade AI');
    }
  });
});

describe('new typed rendering adapters', () => {
  test('shipping instructions contain operational sections without masquerading as a B/L', () => {
    const model = buildDocumentModel(DocType.shipping_instructions, context(), metadata, 'a'.repeat(64));
    const flat = JSON.stringify(model);
    expect(model.title).toBe('SHIPPING INSTRUCTIONS');
    for (const value of ['Routing', 'Shipping terms', 'Goods', 'Packages', 'Containers', 'BOOK-1', 'ALPHA/HAM/1-50']) {
      expect(flat).toContain(value);
    }
    expect(flat).toContain('not a Bill of Lading');
  });

  test('VGM renders each verified container independently and states shipper authority', () => {
    const model = buildDocumentModel(DocType.vgm_declaration, context(), metadata, 'a'.repeat(64));
    const table = model.blocks.find((block) => block.kind === 'table' && block.title === 'Verified container masses');
    expect(model.title).toBe('VERIFIED GROSS MASS DECLARATION');
    expect(table?.kind).toBe('table');
    if (table?.kind === 'table') {
      expect(table.rows).toHaveLength(2);
      expect(table.rows[0]).toContain('29,200 kg');
      expect(table.rows[1]).toContain('28,750 kg');
      expect(table.rows[0]).toContain('Method 1');
      expect(table.rows[1]).toContain('Method 2');
    }
    const flat = JSON.stringify(model);
    expect(flat).toContain("shipper's declared VGM values");
    expect(flat).toContain('No package weight or estimated cargo mass has been substituted');
    expect(flat).not.toContain('1,270 kg');
  });

  test('Bill of Exchange uses canonical amount, tenor, references, and neutral authority wording', () => {
    const model = buildDocumentModel(DocType.bill_of_exchange, documentaryContext(), metadata, 'a'.repeat(64));
    const flat = JSON.stringify(model);
    expect(model.title).toBe('BILL OF EXCHANGE');
    expect(flat).toContain('USD 1,543.13');
    expect(flat).toContain('At 60 days');
    expect(flat).toContain('00001/2026-27');
    expect(flat).toContain('ClearTrade generation does not constitute drawee acceptance, payment, or bank confirmation');
    expect(flat).not.toMatch(/marked as paid|accepted by bank/i);
  });

  test('carrier mode deterministically selects B/L or AWB instructions', () => {
    const sea = buildDocumentModel(DocType.carrier_instructions, context(), metadata, 'a'.repeat(64));
    const airContext = context({ shipment: { ...context().shipment, mode: 'air', containerized: false, containers: [] } });
    const air = buildDocumentModel(DocType.carrier_instructions, airContext, metadata, 'a'.repeat(64));
    expect(sea.title).toBe('BILL OF LADING INSTRUCTIONS');
    expect(air.title).toBe('AIR WAYBILL INSTRUCTIONS');
    expect(JSON.stringify(sea)).toContain('Instructions for carrier/forwarder preparation.');
    expect(JSON.stringify(air)).toContain('not an issued Air Waybill');
  });

  test('bank cover letter contains presentation data and no bank-confirmation claim', () => {
    const model = buildDocumentModel(DocType.bank_collection_letter, documentaryContext(), metadata, 'a'.repeat(64));
    const flat = JSON.stringify(model);
    expect(model.title).toBe('BANK DOCUMENT PRESENTATION / COLLECTION COVER LETTER');
    for (const value of ['Example Bank', 'Fort Branch', 'USD 1,543.13', 'COLL-1', 'Documents enclosed', 'packing list']) {
      expect(flat).toContain(value);
    }
    expect(flat).toContain('not bank acceptance, negotiation, payment, or realization confirmation');
  });

  test('draft labelling and watermark are shared by every new model', () => {
    for (const [type, ctx] of [
      [DocType.shipping_instructions, context()],
      [DocType.vgm_declaration, context()],
      [DocType.bill_of_exchange, documentaryContext()],
      [DocType.carrier_instructions, context()],
      [DocType.bank_collection_letter, documentaryContext()],
    ] as const) {
      const model = buildDocumentModel(type, ctx, { ...metadata, draft: true }, 'a'.repeat(64));
      expect(model.watermark).toBe('DRAFT');
      expect(model.subtitle).toBe('DRAFT — not an issued document');
    }
  });

  test('PDF Unicode preflight remains fail-closed for a new document type', async () => {
    const unicode = context({ buyer: { ...context().buyer, document_name: 'नॉर्डविंड GmbH' } });
    const model = buildDocumentModel(DocType.shipping_instructions, unicode, metadata, 'a'.repeat(64));
    expect(preflightPdfGlyphs(model).some((issue) => issue.label.includes('Buyer / Consignee'))).toBe(true);
    const engine = new LegacyDocumentEngine();
    await expect(engine.render({ ...request(DocType.shipping_instructions, unicode), format: 'pdf' }))
      .rejects.toBeInstanceOf(UnrenderableTextError);
    await expect(engine.render({ ...request(DocType.shipping_instructions, unicode, true), format: 'pdf' }))
      .resolves.toMatchObject({ mime_type: 'application/pdf' });
  });

  test('each new type renders PDF, DOCX, and HTML from the same model values', async () => {
    const engine = new LegacyDocumentEngine();
    const cases = [
      [DocType.shipping_instructions, context(), 'BOOK-1'],
      [DocType.vgm_declaration, context(), 'MSCU7654321'],
      [DocType.bill_of_exchange, documentaryContext(), 'USD 1,543.13'],
      [DocType.carrier_instructions, context(), 'BILL OF LADING INSTRUCTIONS'],
      [DocType.bank_collection_letter, documentaryContext(), 'COLL-1'],
    ] as const;

    for (const [type, ctx, marker] of cases) {
      const base = request(type, ctx);
      const [pdf, docx, html] = await Promise.all([
        engine.render({ ...base, format: 'pdf' }),
        engine.render({ ...base, format: 'docx' }),
        engine.render({ ...base, format: 'html' }),
      ]);
      expect(pdf.bytes.subarray(0, 5).toString()).toBe('%PDF-');
      expect(html.bytes.toString('utf8')).toContain(marker);
      expect(readZipEntry(docx.bytes, 'word/document.xml')).toContain(marker);
      expect(pdf.provenance).toMatchObject({ snapshot_id: 'snapshot-1', doc_type: type, builder_version: 3 });
    }
  });
});
