import { randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { afterAll, afterEach, describe, expect, test } from 'vitest';
import {
  DealStage, DocType, DocumentFormat, ExchangeRateSource, GenerationStatus,
  InsuranceCaseStatus, OrgTier, Prisma, ShipmentMode, ShipmentStatus,
  TransportDocumentType, UserRole,
} from '@prisma/client';
import { buildDocumentContext, freezeDocumentInput } from '../src/lib/document-data';
import {
  DOCUMENT_FORMAT_SUPPORT, LegacyDocumentEngine, MockDocumentEngine,
  UnsupportedDocumentError, getDocumentGenerationEngine, setDocumentGenerationEngine,
  type DocumentRenderRequest,
} from '../src/lib/document-generation';
import { buildDocumentModel } from '../src/lib/document-generation/legacy';
import { documentArtifacts, readDocumentArtifact, renderDocumentArtifact } from '../src/lib/document-rendering';
import { issueInvoiceNumber } from '../src/lib/invoice-numbering';
import { assignExporterToAgent } from '../src/lib/staff-provisioning';
import { prisma } from '../src/lib/prisma';
import type { Principal } from '../src/types';

afterAll(async () => { await prisma.$disconnect(); });

/**
 * Extract one entry from a zip container.
 *
 * A DOCX is a zip, so its text is deflated — asserting on the raw buffer only ever proves the
 * part NAMES are present. This walks the local file headers and inflates the entry, which is
 * what makes "the DOCX actually contains the IEC number" a real assertion.
 */
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
    offset = dataStart + (compressedSize > 0 ? compressedSize : 1);
  }
  return null;
}
afterEach(() => { setDocumentGenerationEngine(null); });

const corr = () => randomUUID();
const principal = (id: string, role: UserRole, orgId: string | null = null): Principal => ({
  id, email: `${id}@t.test`, name: role, role, exporter_org_id: orgId, tier: OrgTier.paid,
});

/** A deal complete enough that every supported document type is ready. */
async function world() {
  const s = randomUUID().slice(0, 8);
  const [orgA, orgB] = await Promise.all([
    prisma.exporterOrg.create({
      data: {
        display_name: `Alpha ${s}`, legal_name: `Alpha Exports Pvt Ltd ${s}`, tier: OrgTier.paid,
        country: 'IN', state: 'Maharashtra', city: 'Mumbai',
        address_line1: '12 Dock Road', postal_code: '400001', ad_code: '6390004',
        iec_number: `IEC${s}`, gstin: `27AAAAA0000A1Z${s.slice(0, 1)}`,
      }, select: { id: true },
    }),
    prisma.exporterOrg.create({ data: { display_name: `Beta ${s}`, tier: OrgTier.paid }, select: { id: true } }),
  ]);
  const [ownerA, ownerB, agentUser, opsUser] = await Promise.all([
    prisma.user.create({ data: { email: `r-a-${s}@t.test`, name: 'A', role: UserRole.exporter_owner, exporter_org_id: orgA.id }, select: { id: true } }),
    prisma.user.create({ data: { email: `r-b-${s}@t.test`, name: 'B', role: UserRole.exporter_owner, exporter_org_id: orgB.id }, select: { id: true } }),
    prisma.user.create({ data: { email: `r-agt-${s}@t.test`, name: 'Agt', role: UserRole.agent }, select: { id: true } }),
    prisma.user.create({ data: { email: `r-ops-${s}@t.test`, name: 'Ops', role: UserRole.ops_supervisor }, select: { id: true } }),
  ]);
  const ops = principal(opsUser.id, UserRole.ops_supervisor);
  const agent = principal(agentUser.id, UserRole.agent);
  await assignExporterToAgent({ actor: ops, agentUserId: agentUser.id, exporterOrgId: orgA.id, correlationId: corr() });

  const buyer = await prisma.buyer.create({
    data: { legal_name: `Nordwind GmbH ${s}`, display_name: `Nordwind ${s}`, country_code: 'DE', buyer_type: 'importer' },
    select: { id: true },
  });
  const product = await prisma.product.create({
    data: { exporter_org_id: orgA.id, name: `Basmati ${s}`, description: 'Basmati rice, 1121 long grain', hs_code: '100630', itc_hs_code: '10063020' },
    select: { id: true },
  });
  const deal = await prisma.deal.create({
    data: {
      exporter_org_id: orgA.id, buyer_id: buyer.id, product_id: product.id, stage: DealStage.executing,
      incoterm: 'FOB', incoterm_place: 'Nhava Sheva',
      quantity: new Prisma.Decimal('1000'), unit: 'kg',
      unit_price_amount: new Prisma.Decimal('1.25'), unit_price_currency: 'USD',
      total_amount: new Prisma.Decimal('1250.00'), total_currency: 'USD',
      payment_terms: { kind: 'advance' }, buyer_reference: 'PO-99120',
    }, select: { id: true },
  });
  const dealB = await prisma.deal.create({
    data: { exporter_org_id: orgB.id, buyer_id: buyer.id, stage: DealStage.qualifying }, select: { id: true },
  });

  await prisma.buyerCommercialProfile.create({
    data: {
      exporter_org_id: orgA.id, buyer_id: buyer.id,
      address_line1: 'Hafenstrasse 4', city: 'Hamburg', postal_code: '20457', country_code: 'DE',
      tax_identifier: 'DE123456789', tax_identifier_type: 'VAT',
    },
  });

  const shipment = await prisma.shipment.create({
    data: {
      deal_id: deal.id, status: ShipmentStatus.booking, mode: ShipmentMode.sea, incoterm: 'FOB',
      port_of_loading_name: 'Nhava Sheva', port_of_loading_unlocode: 'INNSA', port_of_loading_country: 'IN',
      port_of_discharge_name: 'Hamburg', port_of_discharge_unlocode: 'DEHAM', port_of_discharge_country: 'DE',
      final_destination_country: 'DE', marks_and_numbers: 'ALPHA/HAM/1-40',
      transport_document_type: TransportDocumentType.bill_of_lading, transport_document_no: 'BL-77120',
      vessel_or_flight_no: 'MV Concord', container_no: 'MSCU1234567',
    }, select: { id: true },
  });
  await prisma.shipmentPackage.create({
    data: {
      shipment_id: shipment.id, sequence: 1, package_type: 'bag', package_count: 40,
      net_weight_kg: new Prisma.Decimal('25.000'), gross_weight_kg: new Prisma.Decimal('25.400'),
      volume_cbm: new Prisma.Decimal('0.0350'),
    },
  });
  await prisma.insuranceCase.create({
    data: {
      deal_id: deal.id, status: InsuranceCaseStatus.bound, provider_name: 'Oriental', policy_ref: 'POL-8891',
      premium_amount: new Prisma.Decimal('30.00'), premium_currency: 'USD',
      covered_amount: new Prisma.Decimal('1375.00'), covered_currency: 'USD',
    },
  });
  await prisma.exchangeRateQuote.create({
    data: {
      exporter_org_id: orgA.id, base_currency: 'USD', quote_currency: 'INR',
      rate: new Prisma.Decimal('88.42500000'), source: ExchangeRateSource.rbi_reference,
      source_reference: 'RBI/2026-27/114', rate_date: new Date('2026-08-01T00:00:00Z'),
    },
  });

  const ownerAP = principal(ownerA.id, UserRole.exporter_owner, orgA.id);
  await issueInvoiceNumber({ actor: ownerAP, dealId: deal.id, correlationId: corr() });

  const dealSnapshot = await prisma.dealSnapshot.create({
    data: {
      deal_id: deal.id, version: 1, buyer_id: buyer.id, buyer_legal_name: `Nordwind GmbH ${s}`,
      product_id: product.id, product_name: `Basmati ${s}`,
      quantity: new Prisma.Decimal('1000'), unit: 'kg',
      total_amount: new Prisma.Decimal('1250.00'), total_currency: 'USD',
      incoterm: 'FOB', fee_policy: {},
    }, select: { id: true },
  });

  const document = await prisma.document.create({
    data: {
      deal_id: deal.id, doc_type: DocType.CI, version: 1, is_current_version: true,
      source: 'generated', generation_status: GenerationStatus.queued,
      generated_from_snapshot_id: dealSnapshot.id,
    }, select: { id: true },
  });

  return {
    s, orgA: orgA.id, orgB: orgB.id, dealId: deal.id, dealBId: dealB.id, buyerId: buyer.id,
    shipmentId: shipment.id, documentId: document.id,
    ownerA: ownerAP, ownerB: principal(ownerB.id, UserRole.exporter_owner, orgB.id), agent, ops,
  };
}

async function frozenRequest(w: Awaited<ReturnType<typeof world>>, docType: DocType = DocType.CI) {
  const { snapshot, context } = await freezeDocumentInput({
    actor: w.ownerA, dealId: w.dealId, docType, documentVersion: 1, correlationId: corr(),
  });
  const request: DocumentRenderRequest = {
    doc_type: docType, format: 'pdf', snapshot_id: snapshot.id,
    content_hash: snapshot.content_hash, version: 1, context,
    metadata: { brand_name: 'ClearTrade AI', generated_at: new Date('2026-08-19T10:00:00Z'), audit_id: 'CI-V1-ABCDEF12', draft: false },
  };
  return { snapshot, context, request };
}

// ---------------------------------------------------------------------------

describe('engine selection', () => {
  test('mock is the default and still renders', async () => {
    const engine = getDocumentGenerationEngine({} as NodeJS.ProcessEnv);
    expect(engine.name).toBe('mock');
    setDocumentGenerationEngine(null);
    const w = await world();
    const { request } = await frozenRequest(w);
    const result = await new MockDocumentEngine().render({ ...request, format: 'html' });
    expect(result.mime_type).toBe('text/plain; charset=utf-8');
    expect(result.bytes.toString('utf8')).toContain('COMMERCIAL INVOICE');
  });

  test('legacy is selected explicitly, never inferred', () => {
    expect(getDocumentGenerationEngine({ DOCUMENT_ENGINE: 'legacy' } as never).name).toBe('legacy');
    setDocumentGenerationEngine(null);
    // No env var at all keeps the safe default.
    expect(getDocumentGenerationEngine({} as never).name).toBe('mock');
  });

  test('an unknown engine fails loudly rather than falling back', () => {
    setDocumentGenerationEngine(null);
    expect(() => getDocumentGenerationEngine({ DOCUMENT_ENGINE: 'legasy' } as never))
      .toThrow(/Unknown DOCUMENT_ENGINE/);
  });

  test('an unsupported document type is refused explicitly', async () => {
    const w = await world();
    const { request } = await frozenRequest(w);
    const engine = new LegacyDocumentEngine();
    expect(engine.supports('other', 'pdf')).toBe(false);
    await expect(engine.render({ ...request, doc_type: 'other' }))
      .rejects.toBeInstanceOf(UnsupportedDocumentError);
  });

  test('declared format support matches what the engine will actually do', () => {
    const engine = new LegacyDocumentEngine();
    for (const [docType, formats] of Object.entries(DOCUMENT_FORMAT_SUPPORT)) {
      for (const format of ['pdf', 'docx', 'html'] as const) {
        expect(engine.supports(docType, format)).toBe(formats.includes(format));
      }
    }
    expect(DOCUMENT_FORMAT_SUPPORT[DocType.other]).toEqual([]);
  });

  test('the engine never touches the database', async () => {
    const w = await world();
    const { request } = await frozenRequest(w);
    // Prove it structurally: the engine is handed the request and nothing else, and the
    // rendered bytes still contain data that only the frozen context could supply.
    const bytes = await new LegacyDocumentEngine().render({ ...request, format: 'html' });
    const html = bytes.bytes.toString('utf8');
    expect(html).toContain('Hafenstrasse 4');

    // Delete every row the renderer would have had to query, then render again from the same
    // frozen request. A renderer that queried anything would now fail or lose fields.
    await prisma.buyerCommercialProfile.deleteMany({ where: { exporter_org_id: w.orgA } });
    await prisma.shipmentPackage.deleteMany({ where: { shipment_id: w.shipmentId } });
    const again = await new LegacyDocumentEngine().render({ ...request, format: 'html' });
    expect(again.bytes.toString('utf8')).toContain('Hafenstrasse 4');
    expect(again.bytes.equals(bytes.bytes)).toBe(true);
  });
});

describe('typed adapters', () => {
  test('regulatory identifiers the legacy `any` interfaces silently lost are rendered', async () => {
    const w = await world();
    const { context, request } = await frozenRequest(w);
    const model = buildDocumentModel(DocType.CI, context, request.metadata, request.content_hash);
    const flat = JSON.stringify(model);

    // These are the exact fields the legacy templates read as `exporter.iecNo`,
    // `exporter.gstIN`, `invoice.poRef` and `exporter.exchangeRateRef` against a schema that
    // had none of them — every one printed blank.
    expect(flat).toContain(context.exporter.iec_number!);
    expect(flat).toContain(context.exporter.gstin!);
    expect(flat).toContain('PO-99120');
    expect(flat).toContain('RBI/2026-27/114');
    expect(flat).toContain(context.references.invoice_number!);
  });

  test('the AD code appears on the shipping bill and only there', async () => {
    const w = await world();
    const { context, request } = await frozenRequest(w, DocType.shipping_bill_draft);
    const sb = JSON.stringify(buildDocumentModel(DocType.shipping_bill_draft, context, request.metadata, request.content_hash));
    const ci = JSON.stringify(buildDocumentModel(DocType.CI, context, request.metadata, request.content_hash));
    expect(sb).toContain('AD code');
    expect(sb).toContain('6390004');
    expect(ci).not.toContain('AD code');
  });

  test('an absent optional value stays absent — it never becomes a zero or a blank', async () => {
    const w = await world();
    await prisma.shipmentPackage.updateMany({ where: { shipment_id: w.shipmentId }, data: { volume_cbm: null } });
    const { context, request } = await frozenRequest(w, DocType.packing_list);
    const model = buildDocumentModel(DocType.packing_list, context, request.metadata, request.content_hash);
    const packages = model.blocks.find((b) => b.kind === 'table' && b.title === 'Packages');
    expect(packages && packages.kind === 'table').toBe(true);
    if (packages?.kind === 'table') {
      const cbmIndex = packages.columns.findIndex((c) => c.header === 'CBM');
      // null, not '0' and not ''. The legacy renderer produced 0.00 here.
      expect(packages.rows[0]![cbmIndex]).toBeNull();
      expect(packages.totals!.find((t) => t.label === 'Total volume')!.value).toBeNull();
    }
  });

  test('decimal precision survives into the rendered model', async () => {
    const w = await world();
    // The packages describe 1000 kg; changing the deal to 3 units would trip the
    // weight-variance consistency rule and block readiness — correctly. Remove them so this
    // test exercises precision alone.
    await prisma.shipmentPackage.deleteMany({ where: { shipment_id: w.shipmentId } });
    await prisma.deal.update({
      where: { id: w.dealId },
      data: { quantity: new Prisma.Decimal('3'), unit_price_amount: new Prisma.Decimal('0.1'), total_amount: new Prisma.Decimal('0.3') },
    });
    const { context, request } = await frozenRequest(w);
    const model = buildDocumentModel(DocType.CI, context, request.metadata, request.content_hash);
    const goods = model.blocks.find((b) => b.kind === 'table' && b.title === 'Goods');
    if (goods?.kind === 'table') {
      // 3 x 0.1 = 0.30, not 0.30000000000000004.
      expect(goods.totals![0]!.value).toBe('USD 0.30');
    }
  });

  test('money keeps its currency and quantity keeps its unit', async () => {
    const w = await world();
    const { context, request } = await frozenRequest(w);
    const model = buildDocumentModel(DocType.CI, context, request.metadata, request.content_hash);
    const goods = model.blocks.find((b) => b.kind === 'table' && b.title === 'Goods');
    if (goods?.kind === 'table') {
      expect(goods.rows[0]!.join('|')).toContain('1,000 kg');
      expect(goods.rows[0]!.join('|')).toContain('USD 1.25');
      expect(goods.totals![0]!.value).toBe('USD 1,250.00');
    }
  });

  test('dates render stably in UTC regardless of the host timezone', async () => {
    const w = await world();
    const { context, request } = await frozenRequest(w);
    const model = buildDocumentModel(DocType.CI, context, request.metadata, request.content_hash);
    const invoiceDate = model.reference.find((r) => r.label === 'Invoice date');
    // `en-GB` short months are three letters except September, which ICU renders "Sept". The
    // original `[a-z]{2}` accepted only three, so this test failed every September regardless of
    // the timezone it was meant to be checking.
    expect(invoiceDate!.value).toMatch(/^\d{2} [A-Z][a-z]{2,4} \d{4}$/);
  });

  test('a proforma carries no invoice number, and a commercial invoice does', async () => {
    const w = await world();
    const { context, request } = await frozenRequest(w);
    const pi = buildDocumentModel(DocType.PI, context, request.metadata, request.content_hash);
    const ci = buildDocumentModel(DocType.CI, context, request.metadata, request.content_hash);
    expect(pi.reference.some((r) => r.label === 'Invoice no')).toBe(false);
    expect(ci.reference.find((r) => r.label === 'Invoice no')!.value).toBe(context.references.invoice_number);
    expect(JSON.stringify(pi)).toContain('not an issued commercial invoice');
  });

  test('a certificate of origin draft fabricates no chamber certification', async () => {
    const w = await world();
    const { context, request } = await frozenRequest(w, DocType.COO_draft);
    const flat = JSON.stringify(buildDocumentModel(DocType.COO_draft, context, request.metadata, request.content_hash));
    expect(flat).not.toMatch(/chamber name|registration number/i);
    expect(flat).toContain('has not been certified by a Chamber of Commerce');
  });

  test('the exchange rate is printed as recorded, with its source and citation', async () => {
    const w = await world();
    const { context, request } = await frozenRequest(w);
    const model = buildDocumentModel(DocType.CI, context, request.metadata, request.content_hash);
    const fx = model.blocks.find((b) => b.kind === 'key_values' && b.title === 'Exchange rate');
    if (fx?.kind === 'key_values') {
      // The recorded rate, not one back-derived by dividing totals the way the legacy PDF did.
      expect(fx.rows.find((r) => r.label === 'Rate')!.value).toBe('1 USD = INR 88.425');
      expect(fx.rows.find((r) => r.label === 'Source')!.value).toBe('RBI reference rate');
      expect(fx.rows.find((r) => r.label === 'Citation')!.value).toBe('RBI/2026-27/114');
    }
  });

  test('the insurance declaration separates sum insured from premium', async () => {
    const w = await world();
    const { context, request } = await frozenRequest(w, DocType.insurance_declaration);
    const model = buildDocumentModel(DocType.insurance_declaration, context, request.metadata, request.content_hash);
    const policy = model.blocks.find((b) => b.kind === 'key_values' && b.title === 'Policy');
    if (policy?.kind === 'key_values') {
      expect(policy.rows.find((r) => r.label === 'Sum insured')!.value).toBe('USD 1,375.00');
      expect(policy.rows.find((r) => r.label === 'Premium')!.value).toBe('USD 30.00');
      expect(policy.rows.find((r) => r.label === 'Policy reference')!.value).toBe('POL-8891');
    }
  });
});

describe('output formats', () => {
  test('PDF has a PDF signature and real content', async () => {
    const w = await world();
    const { request } = await frozenRequest(w);
    const result = await new LegacyDocumentEngine().render({ ...request, format: 'pdf' });
    expect(result.mime_type).toBe('application/pdf');
    expect(result.bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(result.bytes.subarray(-6).toString()).toContain('EOF');
    expect(result.bytes.length).toBeGreaterThan(1500);
  });

  test('DOCX is a real zip container with the expected parts', async () => {
    const w = await world();
    const { request } = await frozenRequest(w);
    const result = await new LegacyDocumentEngine().render({ ...request, format: 'docx' });
    expect(result.mime_type).toContain('wordprocessingml');
    // PK zip magic, then the OOXML parts a Word document must contain.
    expect(result.bytes.subarray(0, 2).toString()).toBe('PK');
    const raw = result.bytes.toString('latin1');
    expect(raw).toContain('word/document.xml');
    expect(raw).toContain('[Content_Types].xml');
    const xml = readZipEntry(result.bytes, 'word/document.xml');
    expect(xml).toContain('COMMERCIAL INVOICE');
  });

  test('HTML carries the same values as the model and escapes them', async () => {
    const w = await world();
    await prisma.buyerCommercialProfile.update({
      where: { exporter_org_id_buyer_id: { exporter_org_id: w.orgA, buyer_id: w.buyerId } },
      data: { document_name: 'Nordwind <script>alert(1)</script> GmbH' },
    });
    const { request } = await frozenRequest(w);
    const result = await new LegacyDocumentEngine().render({ ...request, format: 'html' });
    const html = result.bytes.toString('utf8');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('COMMERCIAL INVOICE');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('all three formats render from one snapshot and agree on the values', async () => {
    const w = await world();
    const { request, context } = await frozenRequest(w);
    const engine = new LegacyDocumentEngine();
    const html = (await engine.render({ ...request, format: 'html' })).bytes.toString('utf8');
    const docxBytes = (await engine.render({ ...request, format: 'docx' })).bytes;
    const docx = readZipEntry(docxBytes, 'word/document.xml');
    expect(docx).not.toBeNull();

    // A preview and a downloaded file that disagree is the failure this design prevents.
    for (const value of [context.exporter.iec_number!, 'PO-99120', 'Hafenstrasse 4']) {
      expect(html, `HTML is missing ${value}`).toContain(value);
      expect(docx!, `DOCX is missing ${value}`).toContain(value);
    }
  });

  test('a long packing list paginates instead of drawing off the page', async () => {
    const w = await world();
    await prisma.shipmentPackage.deleteMany({ where: { shipment_id: w.shipmentId } });
    await prisma.shipmentPackage.createMany({
      data: Array.from({ length: 90 }, (_, i) => ({
        shipment_id: w.shipmentId, sequence: i + 1, package_type: 'carton', package_count: 1,
        net_weight_kg: new Prisma.Decimal('11.000'), gross_weight_kg: new Prisma.Decimal('11.500'),
        contents_description: `Carton ${i + 1} — long grain rice, jute bag, lot ${1000 + i}`,
      })),
    });
    const { request } = await frozenRequest(w, DocType.packing_list);
    const result = await new LegacyDocumentEngine().render({ ...request, doc_type: DocType.packing_list, format: 'pdf' });
    // The legacy pdf-lib fallback had no pagination — 90 rows drew past y=0 and were lost.
    const { PDFDocument } = await import('pdf-lib');
    const parsed = await PDFDocument.load(result.bytes);
    expect(parsed.getPageCount()).toBeGreaterThan(1);
  });
});

describe('the snapshot is the render source', () => {
  test('editing canonical data after freezing does not change what the version renders', async () => {
    const w = await world();
    const { request } = await frozenRequest(w);
    const engine = new LegacyDocumentEngine();
    const before = (await engine.render({ ...request, format: 'html' })).bytes.toString('utf8');
    expect(before).toContain('Hafenstrasse 4');

    await prisma.buyerCommercialProfile.update({
      where: { exporter_org_id_buyer_id: { exporter_org_id: w.orgA, buyer_id: w.buyerId } },
      data: { address_line1: 'Neue Strasse 99', city: 'Bremerhaven' },
    });

    // Same frozen request, re-rendered: still the T1 address.
    const after = (await engine.render({ ...request, format: 'html' })).bytes.toString('utf8');
    expect(after).toContain('Hafenstrasse 4');
    expect(after).not.toContain('Neue Strasse 99');

    // While a freshly built context does see the correction — both true at once.
    const live = await buildDocumentContext(w.ownerA, w.dealId, DocType.CI);
    expect(live.buyer.address.line1).toBe('Neue Strasse 99');
  });

  test('rendering a second format reuses the same snapshot rather than freezing a new one', async () => {
    const w = await world();
    setDocumentGenerationEngine(new LegacyDocumentEngine());
    await renderDocumentArtifact({ actor: w.ownerA, dealId: w.dealId, documentId: w.documentId, format: 'pdf', correlationId: corr() });
    await prisma.exporterOrg.update({ where: { id: w.orgA }, data: { address_line1: '99 Changed Road' } });
    await renderDocumentArtifact({ actor: w.ownerA, dealId: w.dealId, documentId: w.documentId, format: 'docx', correlationId: corr() });

    const artifacts = await documentArtifacts(w.documentId);
    expect(artifacts).toHaveLength(2);
    // Both formats of one version came from one frozen input, so they cannot disagree.
    expect(new Set(artifacts.map((a) => a.input_snapshot_id)).size).toBe(1);
    expect(new Set(artifacts.map((a) => a.content_hash)).size).toBe(1);
    expect(await prisma.documentInputSnapshot.count({ where: { deal_id: w.dealId } })).toBe(1);
  });

  test('the same snapshot and the same timestamp render identical bytes', async () => {
    const w = await world();
    const { request } = await frozenRequest(w);
    const engine = new LegacyDocumentEngine();
    const a = await engine.render({ ...request, format: 'pdf' });
    const b = await engine.render({ ...request, format: 'pdf' });
    expect(a.bytes.equals(b.bytes)).toBe(true);
  });

  test('the generated-at timestamp is explicit metadata, not hidden nondeterminism', async () => {
    const w = await world();
    const { request } = await frozenRequest(w);
    const engine = new LegacyDocumentEngine();
    const a = await engine.render({ ...request, format: 'pdf' });
    const b = await engine.render({
      ...request, format: 'pdf',
      metadata: { ...request.metadata, generated_at: new Date('2027-01-01T00:00:00Z') },
    });
    // Different bytes, and the ONLY thing that changed is a value the caller supplied.
    expect(a.bytes.equals(b.bytes)).toBe(false);
  });
});

describe('invoice numbering is untouched by rendering', () => {
  test('rendering does not allocate a number', async () => {
    const w = await world();
    setDocumentGenerationEngine(new LegacyDocumentEngine());
    const before = await prisma.issuedInvoiceNumber.count({ where: { exporter_org_id: w.orgA } });
    await renderDocumentArtifact({ actor: w.ownerA, dealId: w.dealId, documentId: w.documentId, format: 'pdf', correlationId: corr() });
    await renderDocumentArtifact({ actor: w.ownerA, dealId: w.dealId, documentId: w.documentId, format: 'html', correlationId: corr() });
    expect(await prisma.issuedInvoiceNumber.count({ where: { exporter_org_id: w.orgA } })).toBe(before);
  });

  test('the issued number is what appears on the invoice', async () => {
    const w = await world();
    const issued = await prisma.issuedInvoiceNumber.findFirstOrThrow({ where: { deal_id: w.dealId, voided_at: null } });
    const { request } = await frozenRequest(w);
    const html = (await new LegacyDocumentEngine().render({ ...request, format: 'html' })).bytes.toString('utf8');
    expect(html).toContain(issued.formatted_number);
  });

  test('a failed render leaves the series untouched', async () => {
    const w = await world();
    setDocumentGenerationEngine({
      name: 'exploding', version: '0.0.0',
      supports: () => true,
      render: async () => { throw new Error('renderer exploded'); },
    });
    const seriesBefore = await prisma.invoiceSeries.findFirstOrThrow({ where: { exporter_org_id: w.orgA } });
    await expect(renderDocumentArtifact({ actor: w.ownerA, dealId: w.dealId, documentId: w.documentId, format: 'pdf', correlationId: corr() }))
      .rejects.toThrow('renderer exploded');

    const seriesAfter = await prisma.invoiceSeries.findFirstOrThrow({ where: { exporter_org_id: w.orgA } });
    expect(seriesAfter.next_number).toBe(seriesBefore.next_number);
    expect(await prisma.documentArtifact.count({ where: { document_id: w.documentId } })).toBe(0);
    // The failure is recorded on the document, and nothing else moved.
    const document = await prisma.document.findUniqueOrThrow({ where: { id: w.documentId } });
    expect(document.generation_status).toBe(GenerationStatus.failed);
    expect(document.generation_error).not.toContain('exploded');
  });

  test('a draft rendering is unmistakable and never becomes the primary file', async () => {
    const w = await world();
    setDocumentGenerationEngine(new LegacyDocumentEngine());
    await renderDocumentArtifact({ actor: w.ownerA, dealId: w.dealId, documentId: w.documentId, format: 'html', draft: true, correlationId: corr() });
    const artifact = await prisma.documentArtifact.findFirstOrThrow({ where: { document_id: w.documentId } });
    const bytes = await (await import('../src/lib/document-storage')).readStoredFile(artifact.file_ref);
    const html = bytes.toString('utf8');
    expect(html).toContain('DRAFT');
    expect(html).toContain('not an issued document');

    const document = await prisma.document.findUniqueOrThrow({ where: { id: w.documentId } });
    // The document is NOT marked generated by a draft, so a draft cannot be approved.
    expect(document.generation_status).not.toBe(GenerationStatus.generated);
    expect(document.file_ref).toBeNull();
  });
});

describe('bad data is refused before the renderer, never repaired by it', () => {
  test('gross below net cannot reach a renderer — the database refuses the row', async () => {
    const w = await world();
    await expect(prisma.shipmentPackage.create({
      data: {
        shipment_id: w.shipmentId, sequence: 77, package_type: 'bag', package_count: 1,
        net_weight_kg: new Prisma.Decimal('25'), gross_weight_kg: new Prisma.Decimal('20'),
      },
    })).rejects.toThrow(/gross_covers_net/);
  });

  test('a document missing required canonical data is refused, not rendered with blanks', async () => {
    const w = await world();
    setDocumentGenerationEngine(new LegacyDocumentEngine());
    await prisma.exporterOrg.update({ where: { id: w.orgA }, data: { ad_code: null } });
    const sb = await prisma.document.create({
      data: {
        deal_id: w.dealId, doc_type: DocType.shipping_bill_draft, version: 1,
        is_current_version: true, source: 'generated', generation_status: GenerationStatus.queued,
      }, select: { id: true },
    });
    await expect(renderDocumentArtifact({ actor: w.ownerA, dealId: w.dealId, documentId: sb.id, format: 'pdf', correlationId: corr() }))
      .rejects.toMatchObject({ code: 'PREREQUISITES_NOT_MET' });
    expect(await prisma.documentArtifact.count({ where: { document_id: sb.id } })).toBe(0);
  });

  test('no adapted renderer code contains a numeric fallback', async () => {
    const { readFile, readdir } = await import('node:fs/promises');
    const dir = 'src/lib/document-generation/legacy';
    const files = (await readdir(dir)).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(4);

    for (const file of files) {
      const source = (await readFile(`${dir}/${file}`, 'utf8'))
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      // The exact legacy idiom that turned an unknown weight into 0.00 on a customs document.
      expect(source, `${file} contains a numeric fallback`).not.toMatch(/\|\|\s*0\b/);
      expect(source, `${file} imports prisma`).not.toMatch(/from '@\/lib\/prisma'/);
      expect(source, `${file} reads process.env`).not.toMatch(/process\.env/);
      expect(source, `${file} references puppeteer`).not.toMatch(/puppeteer|chromium/i);
    }
  });
});

describe('tenant security', () => {
  test('an assigned agent can render for their exporter', async () => {
    const w = await world();
    setDocumentGenerationEngine(new LegacyDocumentEngine());
    const { artifact } = await renderDocumentArtifact({
      actor: w.agent, dealId: w.dealId, documentId: w.documentId, format: 'pdf', correlationId: corr(),
    });
    expect(artifact.generated_by_id).toBe(w.agent.id);
  });

  test('an unassigned agent cannot', async () => {
    const w = await world();
    setDocumentGenerationEngine(new LegacyDocumentEngine());
    const s = randomUUID().slice(0, 8);
    const stranger = await prisma.user.create({ data: { email: `str-${s}@t.test`, name: 'X', role: UserRole.agent }, select: { id: true } });
    await expect(renderDocumentArtifact({
      actor: principal(stranger.id, UserRole.agent), dealId: w.dealId, documentId: w.documentId,
      format: 'pdf', correlationId: corr(),
    })).rejects.toMatchObject({ code: expect.stringMatching(/NOT_FOUND|FORBIDDEN/) });
    expect(await prisma.documentArtifact.count({ where: { document_id: w.documentId } })).toBe(0);
  });

  test('another tenant cannot read the artifact', async () => {
    const w = await world();
    setDocumentGenerationEngine(new LegacyDocumentEngine());
    await renderDocumentArtifact({ actor: w.ownerA, dealId: w.dealId, documentId: w.documentId, format: 'pdf', correlationId: corr() });
    await expect(readDocumentArtifact({ actor: w.ownerB, dealId: w.dealId, documentId: w.documentId, format: 'pdf' }))
      .rejects.toMatchObject({ code: expect.stringMatching(/NOT_FOUND|FORBIDDEN/) });
    await expect(readDocumentArtifact({ actor: w.ownerA, dealId: w.dealId, documentId: w.documentId, format: 'pdf' }))
      .resolves.toBeTruthy();
  });

  test('a document cannot be reached through another tenant deal id', async () => {
    const w = await world();
    setDocumentGenerationEngine(new LegacyDocumentEngine());
    // Correct document id, wrong deal — `loadDocumentScoped` resolves through the deal, so the
    // mismatch is a 404 rather than a cross-tenant read.
    await expect(renderDocumentArtifact({
      actor: w.ownerB, dealId: w.dealBId, documentId: w.documentId, format: 'pdf', correlationId: corr(),
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('an artifact records the snapshot it came from, so it cannot be silently reattributed', async () => {
    const w = await world();
    setDocumentGenerationEngine(new LegacyDocumentEngine());
    const { artifact } = await renderDocumentArtifact({ actor: w.ownerA, dealId: w.dealId, documentId: w.documentId, format: 'pdf', correlationId: corr() });
    const snapshot = await prisma.documentInputSnapshot.findUniqueOrThrow({ where: { id: artifact.input_snapshot_id } });
    expect(snapshot.deal_id).toBe(w.dealId);
    expect(snapshot.exporter_org_id).toBe(w.orgA);
    expect(artifact.content_hash).toBe(snapshot.content_hash);
  });

  test('the audit event records hashes, not the buyer address', async () => {
    const w = await world();
    setDocumentGenerationEngine(new LegacyDocumentEngine());
    const { artifact } = await renderDocumentArtifact({ actor: w.ownerA, dealId: w.dealId, documentId: w.documentId, format: 'pdf', correlationId: corr() });
    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { object_type: 'document_artifact', object_id: artifact.id },
    });
    const payload = JSON.stringify(event.after_summary);
    expect(payload).toContain(artifact.checksum);
    expect(payload).not.toContain('Hafenstrasse');
    expect(payload).not.toContain('Nordwind');
  });
});

describe('storage integration', () => {
  test('artifacts go through the existing storage abstraction, not a second file store', async () => {
    const w = await world();
    setDocumentGenerationEngine(new LegacyDocumentEngine());
    const { artifact, bytes } = await renderDocumentArtifact({ actor: w.ownerA, dealId: w.dealId, documentId: w.documentId, format: 'pdf', correlationId: corr() });
    const { readStoredFile } = await import('../src/lib/document-storage');
    const stored = await readStoredFile(artifact.file_ref);
    expect(stored.equals(bytes)).toBe(true);

    const { createHash } = await import('node:crypto');
    expect(createHash('sha256').update(stored).digest('hex')).toBe(artifact.checksum);
    expect(artifact.file_size_bytes).toBe(stored.length);
  });

  test('re-rendering the same format replaces the artifact rather than accumulating rows', async () => {
    const w = await world();
    setDocumentGenerationEngine(new LegacyDocumentEngine());
    await renderDocumentArtifact({ actor: w.ownerA, dealId: w.dealId, documentId: w.documentId, format: 'pdf', correlationId: corr() });
    await renderDocumentArtifact({ actor: w.ownerA, dealId: w.dealId, documentId: w.documentId, format: 'pdf', correlationId: corr() });
    const rows = await prisma.documentArtifact.findMany({ where: { document_id: w.documentId, format: DocumentFormat.pdf } });
    expect(rows).toHaveLength(1);
  });

  test('the Document row points at the PDF as its primary artifact', async () => {
    const w = await world();
    setDocumentGenerationEngine(new LegacyDocumentEngine());
    await renderDocumentArtifact({ actor: w.ownerA, dealId: w.dealId, documentId: w.documentId, format: 'html', correlationId: corr() });
    await renderDocumentArtifact({ actor: w.ownerA, dealId: w.dealId, documentId: w.documentId, format: 'pdf', correlationId: corr() });
    const document = await prisma.document.findUniqueOrThrow({ where: { id: w.documentId } });
    expect(document.mime_type).toBe('application/pdf');
    expect(document.generation_status).toBe(GenerationStatus.generated);
    const pdf = await prisma.documentArtifact.findFirstOrThrow({ where: { document_id: w.documentId, format: DocumentFormat.pdf } });
    expect(document.checksum).toBe(pdf.checksum);
  });
});
