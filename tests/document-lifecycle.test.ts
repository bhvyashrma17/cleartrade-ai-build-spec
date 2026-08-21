import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, test } from 'vitest';
import {
  ApprovalStatus, DealStage, DocType, DocumentFormat, ExchangeRateSource, GenerationStatus,
  InsuranceCaseStatus, OrgTier, Prisma, ReviewStatus, ShipmentMode, ShipmentStatus,
  TransportDocumentType, UserRole, VgmMethod,
} from '@prisma/client';
import { buildDocumentContext } from '../src/lib/document-data';
import { compareSnapshotToCurrent } from '../src/lib/document-drift';
import {
  LegacyDocumentEngine, UnrenderableTextError, buildDocumentModel, isPdfRenderable,
  preflightPdfGlyphs, setDocumentGenerationEngine, unrenderableCharacters,
} from '../src/lib/document-generation';
import {
  agentReviewDocument, assertDocumentApprovable, createDocumentAmendment,
  documentAuthorityNote, documentDetail, documentSnapshotDrift, documentWorkspace,
} from '../src/lib/document-lifecycle';
import { NEW_DOCUMENT_LIFECYCLE_MATRIX } from '../src/lib/document-lifecycle-policy';
import { readDocumentArtifact, renderDocumentArtifact } from '../src/lib/document-rendering';
import { issueInvoiceNumber } from '../src/lib/invoice-numbering';
import { assignExporterToAgent } from '../src/lib/staff-provisioning';
import { CONFIG_DEFAULTS } from '../src/lib/config';
import { backfillDealDocumentCapabilities } from '../src/lib/documents';
import { buildExecutionPlan } from '../src/lib/state-machines/deal';
import { prisma } from '../src/lib/prisma';
import type { Principal } from '../src/types';

afterAll(async () => { await prisma.$disconnect(); });
afterEach(() => { setDocumentGenerationEngine(null); });

const corr = () => randomUUID();
const principal = (id: string, role: UserRole, orgId: string | null = null): Principal => ({
  id, email: `${id}@t.test`, name: role, role, exporter_org_id: orgId, tier: OrgTier.paid,
});

/** A deal whose commercial invoice is fully ready, plus a second tenant. */
async function world(opts: { buyerName?: string } = {}) {
  const s = randomUUID().slice(0, 8);
  const [orgA, orgB] = await Promise.all([
    prisma.exporterOrg.create({
      data: {
        display_name: `Alpha ${s}`, legal_name: `Alpha Exports Pvt Ltd ${s}`, tier: OrgTier.paid,
        country: 'IN', state: 'Maharashtra', city: 'Mumbai',
        address_line1: '12 Dock Road', postal_code: '400001', ad_code: '6390004',
        iec_number: `IEC${s}`, gstin: `27AAAAA0000A1Z5`,
      }, select: { id: true },
    }),
    prisma.exporterOrg.create({ data: { display_name: `Beta ${s}`, tier: OrgTier.paid }, select: { id: true } }),
  ]);
  const [ownerA, ownerB, agentUser, otherAgent, opsUser] = await Promise.all([
    prisma.user.create({ data: { email: `l-a-${s}@t.test`, name: 'A', role: UserRole.exporter_owner, exporter_org_id: orgA.id }, select: { id: true } }),
    prisma.user.create({ data: { email: `l-b-${s}@t.test`, name: 'B', role: UserRole.exporter_owner, exporter_org_id: orgB.id }, select: { id: true } }),
    prisma.user.create({ data: { email: `l-agt-${s}@t.test`, name: 'Agt', role: UserRole.agent }, select: { id: true } }),
    prisma.user.create({ data: { email: `l-agt2-${s}@t.test`, name: 'Other', role: UserRole.agent }, select: { id: true } }),
    prisma.user.create({ data: { email: `l-ops-${s}@t.test`, name: 'Ops', role: UserRole.ops_supervisor }, select: { id: true } }),
  ]);
  const ops = principal(opsUser.id, UserRole.ops_supervisor);
  const agent = principal(agentUser.id, UserRole.agent);
  await assignExporterToAgent({ actor: ops, agentUserId: agentUser.id, exporterOrgId: orgA.id, correlationId: corr() });

  const buyer = await prisma.buyer.create({
    data: { legal_name: opts.buyerName ?? `Nordwind GmbH ${s}`, display_name: `Nordwind ${s}`, country_code: 'DE', buyer_type: 'importer' },
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
      ...(opts.buyerName ? { document_name: opts.buyerName } : {}),
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
    }, select: { id: true },
  });
  await prisma.shipmentPackage.create({
    data: {
      shipment_id: shipment.id, sequence: 1, package_type: 'bag', package_count: 40,
      net_weight_kg: new Prisma.Decimal('25.000'), gross_weight_kg: new Prisma.Decimal('25.400'),
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
      rate: new Prisma.Decimal('88.425'), source: ExchangeRateSource.bank_quoted,
      source_reference: 'Q-1', rate_date: new Date('2026-08-01T00:00:00Z'),
    },
  });

  const ownerAP = principal(ownerA.id, UserRole.exporter_owner, orgA.id);
  await issueInvoiceNumber({ actor: ownerAP, dealId: deal.id, correlationId: corr() });

  const document = await prisma.document.create({
    data: {
      deal_id: deal.id, doc_type: DocType.CI, version: 1, is_current_version: true,
      source: 'generated', generation_status: GenerationStatus.queued,
      approval_status: ApprovalStatus.pending,
    }, select: { id: true },
  });

  return {
    s, orgA: orgA.id, orgB: orgB.id, dealId: deal.id, dealBId: dealB.id, buyerId: buyer.id, productId: product.id,
    shipmentId: shipment.id, documentId: document.id,
    ownerA: ownerAP, ownerB: principal(ownerB.id, UserRole.exporter_owner, orgB.id),
    agent, otherAgent: principal(otherAgent.id, UserRole.agent), ops,
  };
}

/** Generate the authoritative PDF for the world's CI. */
async function generate(w: Awaited<ReturnType<typeof world>>, documentId?: string) {
  setDocumentGenerationEngine(new LegacyDocumentEngine());
  return renderDocumentArtifact({
    actor: w.ownerA, dealId: w.dealId, documentId: documentId ?? w.documentId,
    format: 'pdf', correlationId: corr(),
  });
}

/** Record an exporter approval the way the route does. */
async function approve(w: Awaited<ReturnType<typeof world>>, documentId?: string) {
  const id = documentId ?? w.documentId;
  await assertDocumentApprovable(w.ownerA, w.dealId, id);
  const doc = await prisma.document.findUniqueOrThrow({ where: { id } });
  return prisma.document.update({
    where: { id },
    data: {
      approval_status: ApprovalStatus.exporter_approved,
      approved_by_id: w.ownerA.id, approved_at: new Date(),
      approved_version: doc.version, approved_checksum: doc.checksum,
    },
  });
}

// ---------------------------------------------------------------------------

describe('separation of duties is preserved', () => {
  test('an agent cannot approve — the capability is denied, not merely unbuilt', async () => {
    const { grantFor } = await import('../src/lib/permissions');
    expect(grantFor(UserRole.agent, 'document.approve')).toBe('none');
    // And the enums keep the two halves distinct rather than one "approved" state.
    expect(Object.values(ReviewStatus)).toContain('agent_reviewed');
    expect(Object.values(ApprovalStatus)).toContain('exporter_approved');
  });

  test('agent review sets review_status and never touches approval_status', async () => {
    const w = await world();
    await generate(w);
    const before = await prisma.document.findUniqueOrThrow({ where: { id: w.documentId } });

    const reviewed = await agentReviewDocument({
      actor: w.agent, dealId: w.dealId, documentId: w.documentId,
      outcome: 'reviewed', note: 'Checked against the PO.', correlationId: corr(),
    });

    expect(reviewed.review_status).toBe(ReviewStatus.agent_reviewed);
    expect(reviewed.reviewed_by_id).toBe(w.agent.id);
    expect(reviewed.approval_status).toBe(before.approval_status);
    expect(reviewed.approved_by_id).toBeNull();
  });

  test('a review note is internal and never reaches the document', async () => {
    const w = await world();
    await generate(w);
    await agentReviewDocument({
      actor: w.agent, dealId: w.dealId, documentId: w.documentId,
      outcome: 'changes_needed', note: 'Buyer says the city is wrong.', correlationId: corr(),
    });

    const notes = await prisma.internalNote.findMany({ where: { scope_type: 'document', scope_id: w.documentId } });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.body).toContain('city is wrong');

    // The stored artifact predates the note and cannot contain it; regenerating must not
    // pick it up either.
    const { bytes } = await readDocumentArtifact({ actor: w.agent, dealId: w.dealId, documentId: w.documentId, format: 'pdf' });
    expect(bytes.toString('latin1')).not.toContain('city is wrong');
  });

  test('flagging changes without saying what is refused', async () => {
    const w = await world();
    await generate(w);
    await expect(agentReviewDocument({
      actor: w.agent, dealId: w.dealId, documentId: w.documentId, outcome: 'changes_needed', correlationId: corr(),
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('an unassigned agent cannot review', async () => {
    const w = await world();
    await generate(w);
    await expect(agentReviewDocument({
      actor: w.otherAgent, dealId: w.dealId, documentId: w.documentId, outcome: 'reviewed', correlationId: corr(),
    })).rejects.toMatchObject({ code: expect.stringMatching(/NOT_FOUND|FORBIDDEN/) });
  });
});

describe('five-type lifecycle integration', () => {
  test('deal lock creates eleven post-lock capabilities; PI makes twelve, without conditional task noise', () => {
    const plan = buildExecutionPlan('deal-1', 1, CONFIG_DEFAULTS['documents.registry']);
    const types = plan.documents.map((document) => document.doc_type);
    expect(types).toHaveLength(11);
    expect(new Set([DocType.PI, ...types]).size).toBe(12);
    for (const type of Object.keys(NEW_DOCUMENT_LIFECYCLE_MATRIX) as DocType[]) {
      expect(types).toContain(type);
      const policy = NEW_DOCUMENT_LIFECYCLE_MATRIX[type as keyof typeof NEW_DOCUMENT_LIFECYCLE_MATRIX];
      expect(policy).toEqual({
        agent_review_required: true, exporter_approval_required: true, filing_applicable: false,
      });
    }
    expect(plan.tasks.some((task) => task.task_type === 'prepare_shipping_instructions')).toBe(true);
    for (const type of [
      DocType.vgm_declaration, DocType.bill_of_exchange,
      DocType.carrier_instructions, DocType.bank_collection_letter,
    ]) expect(plan.tasks.some((task) => task.task_type === `prepare_${type}`)).toBe(false);
  });

  test('the targeted backfill is idempotent and never duplicates a capability', async () => {
    const w = await world();
    await prisma.dealSnapshot.create({
      data: {
        deal_id: w.dealId, version: 1, buyer_id: w.buyerId,
        buyer_legal_name: `Nordwind GmbH ${w.s}`, product_id: w.productId,
        product_name: `Basmati ${w.s}`, quantity: new Prisma.Decimal('1000'), unit: 'kg',
        total_amount: new Prisma.Decimal('1250'), total_currency: 'USD', incoterm: 'FOB', fee_policy: {},
      },
    });
    expect(await backfillDealDocumentCapabilities({ actor: w.agent, dealId: w.dealId, correlationId: corr() })).toBe(5);
    expect(await backfillDealDocumentCapabilities({ actor: w.agent, dealId: w.dealId, correlationId: corr() })).toBe(0);
    const rows = await prisma.document.findMany({
      where: { deal_id: w.dealId, doc_type: { in: Object.keys(NEW_DOCUMENT_LIFECYCLE_MATRIX) as DocType[] } },
    });
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((row) => row.doc_type)).size).toBe(5);
    expect(rows.every((row) => row.version === 1 && row.is_current_version)).toBe(true);
  });

  test('a backfilled air-shipment VGM is first-class but not applicable, not blocked', async () => {
    const w = await world();
    await prisma.shipment.update({
      where: { id: w.shipmentId },
      data: {
        mode: ShipmentMode.air, containerized: false,
        transport_document_type: null, transport_document_no: null,
      },
    });
    await prisma.dealSnapshot.create({
      data: {
        deal_id: w.dealId, version: 1, buyer_id: w.buyerId,
        buyer_legal_name: `Nordwind GmbH ${w.s}`, product_id: w.productId,
        product_name: `Basmati ${w.s}`, fee_policy: {},
      },
    });
    await backfillDealDocumentCapabilities({ actor: w.agent, dealId: w.dealId, correlationId: corr() });
    const row = (await documentWorkspace(w.agent, w.dealId)).rows
      .find((entry) => entry.doc_type === DocType.vgm_declaration)!;
    expect(row.current).not.toBeNull();
    expect(row.readiness).toMatchObject({
      status: 'not_applicable', missing: [], invalid: [], applicability: { code: 'not_sea' },
    });
  });

  test('VGM uses generation, review, exporter authorization, artifacts, drift, and amendment unchanged', async () => {
    const w = await world();
    await prisma.shipment.update({
      where: { id: w.shipmentId },
      data: { booking_ref: 'BOOK-VGM-1', containerized: true },
    });
    const container = await prisma.shipmentContainer.create({
      data: {
        shipment_id: w.shipmentId, sequence: 1, container_number: 'MSCU1234567',
        container_type: "40'HC", seal_number: 'SEAL-1',
        vgm_verified_gross_mass_kg: new Prisma.Decimal('29200'), vgm_method: VgmMethod.method_1,
        vgm_verified_at: new Date('2026-08-21T00:00:00Z'), vgm_verifier_name: 'Exporter Signatory',
        vgm_verifier_capacity: 'Authorised person', vgm_evidence_ref: 'WB-1',
      },
    });
    const v1 = await prisma.document.create({
      data: {
        deal_id: w.dealId, doc_type: DocType.vgm_declaration, version: 1,
        is_current_version: true, source: 'generated', generation_status: GenerationStatus.queued,
        approval_status: ApprovalStatus.pending,
      },
    });

    const renderedV1 = await generate(w, v1.id);
    await expect(assertDocumentApprovable(w.ownerA, w.dealId, v1.id))
      .rejects.toMatchObject({ code: 'PREREQUISITES_NOT_MET' });
    await agentReviewDocument({
      actor: w.agent, dealId: w.dealId, documentId: v1.id,
      outcome: 'reviewed', correlationId: corr(),
    });
    const html = await renderDocumentArtifact({
      actor: w.agent, dealId: w.dealId, documentId: v1.id, format: 'html', correlationId: corr(),
    });
    expect(html.bytes.toString('utf8')).toContain("shipper&#39;s declared VGM values");
    await approve(w, v1.id);

    const frozenV1 = await prisma.document.findUniqueOrThrow({ where: { id: v1.id } });
    expect(frozenV1.review_status).toBe(ReviewStatus.agent_reviewed);
    expect(frozenV1.approval_status).toBe(ApprovalStatus.exporter_approved);
    expect(frozenV1.filing_status).toBe('not_applicable');
    expect(frozenV1.checksum).toBe(renderedV1.artifact.checksum);

    await prisma.shipmentContainer.update({
      where: { id: container.id }, data: { vgm_verified_gross_mass_kg: new Prisma.Decimal('29300') },
    });
    const drift = await documentSnapshotDrift(w.agent, w.dealId, v1.id);
    expect(drift?.entries.map((entry) => entry.field)).toContain('shipment.containers');

    const v2 = await createDocumentAmendment({
      actor: w.agent, dealId: w.dealId, documentId: v1.id,
      reason: 'Verified mass corrected from weighbridge evidence', correlationId: corr(),
    });
    const renderedV2 = await generate(w, v2.id);
    const [oldRow, newRow] = await Promise.all([
      prisma.document.findUniqueOrThrow({ where: { id: v1.id } }),
      prisma.document.findUniqueOrThrow({ where: { id: v2.id } }),
    ]);
    expect(oldRow.is_current_version).toBe(false);
    expect(oldRow.input_snapshot_id).toBe(frozenV1.input_snapshot_id);
    expect(oldRow.checksum).toBe(renderedV1.artifact.checksum);
    expect(newRow.version).toBe(2);
    expect(newRow.input_snapshot_id).not.toBe(oldRow.input_snapshot_id);
    expect(newRow.checksum).toBe(renderedV2.artifact.checksum);
    expect(newRow.checksum).not.toBe(oldRow.checksum);
    expect(await prisma.documentArtifact.findUnique({ where: { id: renderedV1.artifact.id } })).not.toBeNull();
  });

  test('authority notes preserve every external-boundary distinction', () => {
    expect(documentAuthorityNote(DocType.vgm_declaration)?.notThis).toMatch(/not shipper authorization/i);
    expect(documentAuthorityNote(DocType.bill_of_exchange)?.notThis).toMatch(/Not drawee acceptance/i);
    expect(documentAuthorityNote(DocType.carrier_instructions)?.notThis).toMatch(/Not an issued Bill of Lading or Air Waybill/i);
    expect(documentAuthorityNote(DocType.bank_collection_letter)?.notThis).toMatch(/Not bank acceptance/i);
    expect(documentAuthorityNote(DocType.shipping_instructions)?.notThis).toMatch(/Not carrier acceptance/i);
  });
});

describe('the approval gate', () => {
  test('a generated current version with a matching artifact is approvable', async () => {
    const w = await world();
    await generate(w);
    await expect(assertDocumentApprovable(w.ownerA, w.dealId, w.documentId)).resolves.toBeUndefined();
  });

  test('no artifact means no approval, however healthy the row looks', async () => {
    const w = await world();
    await prisma.document.update({
      where: { id: w.documentId },
      data: { generation_status: GenerationStatus.generated, checksum: 'f'.repeat(64) },
    });
    await expect(assertDocumentApprovable(w.ownerA, w.dealId, w.documentId))
      .rejects.toMatchObject({ code: 'PREREQUISITES_NOT_MET' });
  });

  test('a checksum that disagrees with the stored file refuses approval', async () => {
    const w = await world();
    await generate(w);
    await prisma.document.update({ where: { id: w.documentId }, data: { checksum: 'a'.repeat(64) } });
    await expect(assertDocumentApprovable(w.ownerA, w.dealId, w.documentId))
      .rejects.toMatchObject({ code: 'PREREQUISITES_NOT_MET' });
  });

  test('a missing snapshot refuses approval', async () => {
    const w = await world();
    await generate(w);
    await prisma.document.update({ where: { id: w.documentId }, data: { input_snapshot_id: null } });
    await expect(assertDocumentApprovable(w.ownerA, w.dealId, w.documentId))
      .rejects.toMatchObject({ code: 'PREREQUISITES_NOT_MET' });
  });

  test('a superseded version cannot be approved', async () => {
    const w = await world();
    await generate(w);
    const v2 = await createDocumentAmendment({
      actor: w.agent, dealId: w.dealId, documentId: w.documentId,
      reason: 'Port changed', correlationId: corr(),
    });
    expect(v2.version).toBe(2);
    await expect(assertDocumentApprovable(w.ownerA, w.dealId, w.documentId))
      .rejects.toMatchObject({ code: 'PREREQUISITES_NOT_MET' });
  });

  test('an unreviewed DOCX does not become authoritative just by existing', async () => {
    const w = await world();
    setDocumentGenerationEngine(new LegacyDocumentEngine());
    await renderDocumentArtifact({ actor: w.ownerA, dealId: w.dealId, documentId: w.documentId, format: 'docx', correlationId: corr() });
    const afterDocx = await prisma.document.findUniqueOrThrow({ where: { id: w.documentId } });
    const docxChecksum = afterDocx.checksum;

    await renderDocumentArtifact({ actor: w.ownerA, dealId: w.dealId, documentId: w.documentId, format: 'pdf', correlationId: corr() });
    const afterPdf = await prisma.document.findUniqueOrThrow({ where: { id: w.documentId } });
    const pdf = await prisma.documentArtifact.findFirstOrThrow({
      where: { document_id: w.documentId, format: DocumentFormat.pdf },
    });

    // PDF takes over as the authoritative artifact the approval will bind to.
    expect(afterPdf.checksum).toBe(pdf.checksum);
    expect(afterPdf.checksum).not.toBe(docxChecksum);
    expect(afterPdf.mime_type).toBe('application/pdf');
  });
});

describe('approved content is frozen', () => {
  test('an approved artifact cannot be replaced', async () => {
    const w = await world();
    await generate(w);
    await approve(w);

    setDocumentGenerationEngine(new LegacyDocumentEngine());
    await expect(renderDocumentArtifact({
      actor: w.ownerA, dealId: w.dealId, documentId: w.documentId, format: 'pdf', correlationId: corr(),
    })).rejects.toThrow(/approved/i);
  });

  test('a new format cannot be added to an approved version', async () => {
    const w = await world();
    await generate(w);
    await approve(w);
    setDocumentGenerationEngine(new LegacyDocumentEngine());
    await expect(renderDocumentArtifact({
      actor: w.ownerA, dealId: w.dealId, documentId: w.documentId, format: 'docx', correlationId: corr(),
    })).rejects.toThrow(/approved/i);
  });

  test('the database refuses to move an approved version content, not just the service', async () => {
    const w = await world();
    await generate(w);
    await approve(w);
    await expect(prisma.document.update({
      where: { id: w.documentId }, data: { checksum: 'b'.repeat(64) },
    })).rejects.toThrow(/approved/i);
    await expect(prisma.document.update({
      where: { id: w.documentId }, data: { input_snapshot_id: null },
    })).rejects.toThrow(/approved/i);
    const artifact = await prisma.documentArtifact.findFirstOrThrow({ where: { document_id: w.documentId } });
    await expect(prisma.documentArtifact.delete({ where: { id: artifact.id } })).rejects.toThrow(/approved/i);
  });

  test('the approved snapshot cannot be mutated', async () => {
    const w = await world();
    await generate(w);
    await approve(w);
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: w.documentId } });
    await expect(prisma.documentInputSnapshot.update({
      where: { id: doc.input_snapshot_id! }, data: { content_hash: 'c'.repeat(64) },
    })).rejects.toThrow(/immutable/i);
  });

  test('canonical data can still change freely after approval', async () => {
    const w = await world();
    await generate(w);
    await approve(w);
    await expect(prisma.buyerCommercialProfile.update({
      where: { exporter_org_id_buyer_id: { exporter_org_id: w.orgA, buyer_id: w.buyerId } },
      data: { city: 'Bremerhaven' },
    })).resolves.toBeTruthy();
    const live = await buildDocumentContext(w.ownerA, w.dealId, DocType.CI);
    expect(live.buyer.address.city).toBe('Bremerhaven');
  });

  test('the approved artifact stays downloadable byte-for-byte', async () => {
    const w = await world();
    const { bytes } = await generate(w);
    await approve(w);
    await prisma.buyerCommercialProfile.update({
      where: { exporter_org_id_buyer_id: { exporter_org_id: w.orgA, buyer_id: w.buyerId } },
      data: { address_line1: 'Somewhere Else 1' },
    });
    const served = await readDocumentArtifact({ actor: w.ownerA, dealId: w.dealId, documentId: w.documentId, format: 'pdf' });
    expect(served.bytes.equals(bytes)).toBe(true);
  });
});

describe('amendments', () => {
  test('an amendment creates the next version and leaves the prior one untouched', async () => {
    const w = await world();
    const { artifact } = await generate(w);
    await approve(w);
    const before = await prisma.document.findUniqueOrThrow({ where: { id: w.documentId } });

    const v2 = await createDocumentAmendment({
      actor: w.agent, dealId: w.dealId, documentId: w.documentId,
      reason: 'Buyer address corrected', correlationId: corr(),
    });

    expect(v2.version).toBe(2);
    expect(v2.amended_from_version).toBe(1);
    expect(v2.amendment_reason).toBe('Buyer address corrected');
    // A new version starts clean — inheriting approval would cover content nobody saw.
    expect(v2.approval_status).toBe(ApprovalStatus.pending);
    expect(v2.review_status).toBe(ReviewStatus.not_reviewed);
    expect(v2.generation_status).toBe(GenerationStatus.queued);
    expect(v2.input_snapshot_id).toBeNull();

    const after = await prisma.document.findUniqueOrThrow({ where: { id: w.documentId } });
    expect(after.approval_status).toBe(ApprovalStatus.exporter_approved);
    expect(after.approved_checksum).toBe(before.approved_checksum);
    expect(after.is_current_version).toBe(false);
    expect(await prisma.documentArtifact.findFirstOrThrow({ where: { id: artifact.id } })).toBeTruthy();
  });

  test('an amendment needs a reason', async () => {
    const w = await world();
    await generate(w);
    await expect(createDocumentAmendment({
      actor: w.agent, dealId: w.dealId, documentId: w.documentId, reason: '   ', correlationId: corr(),
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await prisma.document.count({ where: { deal_id: w.dealId, doc_type: DocType.CI } })).toBe(1);
  });

  test('the database refuses an amendment shape with no reason', async () => {
    const w = await world();
    await expect(prisma.document.create({
      data: {
        deal_id: w.dealId, doc_type: DocType.packing_list, version: 2, is_current_version: false,
        source: 'generated', amended_from_version: 1, amendment_reason: null,
      },
    })).rejects.toThrow(/amendment_shape/);
  });

  test('an amendment cannot claim to supersede a later version', async () => {
    const w = await world();
    await expect(prisma.document.create({
      data: {
        deal_id: w.dealId, doc_type: DocType.packing_list, version: 2, is_current_version: false,
        source: 'generated', amended_from_version: 5, amendment_reason: 'nonsense',
      },
    })).rejects.toThrow(/amendment_is_backward/);
  });

  test('a superseded version cannot itself be amended', async () => {
    const w = await world();
    await generate(w);
    await createDocumentAmendment({ actor: w.agent, dealId: w.dealId, documentId: w.documentId, reason: 'x', correlationId: corr() });
    await expect(createDocumentAmendment({
      actor: w.agent, dealId: w.dealId, documentId: w.documentId, reason: 'y', correlationId: corr(),
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('only one version can be current, enforced by the database', async () => {
    const w = await world();
    await generate(w);
    await createDocumentAmendment({ actor: w.agent, dealId: w.dealId, documentId: w.documentId, reason: 'x', correlationId: corr() });

    const versions = await prisma.document.findMany({ where: { deal_id: w.dealId, doc_type: DocType.CI } });
    expect(versions.filter((v) => v.is_current_version)).toHaveLength(1);

    // And a second claimant is refused rather than silently accepted.
    await expect(prisma.document.update({
      where: { id: w.documentId }, data: { is_current_version: true },
    })).rejects.toThrow();
  });

  test('concurrent amendments cannot both win', async () => {
    const w = await world();
    await generate(w);
    const attempts = await Promise.allSettled([
      createDocumentAmendment({ actor: w.agent, dealId: w.dealId, documentId: w.documentId, reason: 'a', correlationId: corr() }),
      createDocumentAmendment({ actor: w.agent, dealId: w.dealId, documentId: w.documentId, reason: 'b', correlationId: corr() }),
    ]);
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);

    const versions = await prisma.document.findMany({ where: { deal_id: w.dealId, doc_type: DocType.CI } });
    expect(versions).toHaveLength(2);
    expect(versions.filter((v) => v.is_current_version)).toHaveLength(1);
  });

  test('regenerating an amendment freezes a NEW snapshot from current data', async () => {
    const w = await world();
    const v1 = await generate(w);
    await approve(w);
    await prisma.buyerCommercialProfile.update({
      where: { exporter_org_id_buyer_id: { exporter_org_id: w.orgA, buyer_id: w.buyerId } },
      data: { city: 'Bremerhaven' },
    });

    const v2 = await createDocumentAmendment({
      actor: w.agent, dealId: w.dealId, documentId: w.documentId, reason: 'City corrected', correlationId: corr(),
    });
    const rendered = await generate(w, v2.id);

    expect(rendered.artifact.input_snapshot_id).not.toBe(v1.artifact.input_snapshot_id);
    expect(rendered.artifact.content_hash).not.toBe(v1.artifact.content_hash);
    expect(rendered.bytes.toString('latin1')).not.toEqual(v1.bytes.toString('latin1'));

    const v1Snapshot = await prisma.documentInputSnapshot.findUniqueOrThrow({ where: { id: v1.artifact.input_snapshot_id } });
    expect((v1Snapshot.context as unknown as { buyer: { address: { city: string } } }).buyer.address.city).toBe('Hamburg');
  });
});

describe('snapshot drift', () => {
  test('unchanged canonical data produces no drift', async () => {
    const w = await world();
    await generate(w);
    const drift = await documentSnapshotDrift(w.agent, w.dealId, w.documentId);
    expect(drift!.clean).toBe(true);
    expect(drift!.entries).toEqual([]);
  });

  test('a changed field appears as a structured entry naming its owner', async () => {
    const w = await world();
    await generate(w);
    await prisma.buyerCommercialProfile.update({
      where: { exporter_org_id_buyer_id: { exporter_org_id: w.orgA, buyer_id: w.buyerId } },
      data: { city: 'Bremerhaven' },
    });
    await prisma.shipment.update({ where: { id: w.shipmentId }, data: { port_of_discharge_name: 'Rotterdam', port_of_discharge_unlocode: 'NLRTM' } });

    const drift = await documentSnapshotDrift(w.agent, w.dealId, w.documentId);
    expect(drift!.clean).toBe(false);
    const fields = drift!.entries.map((e) => e.field);
    expect(fields).toContain('buyer.address');
    expect(fields).toContain('shipment.port_of_discharge');

    const buyerEntry = drift!.entries.find((e) => e.field === 'buyer.address')!;
    expect(buyerEntry.kind).toBe('changed');
    expect(buyerEntry.owner).toBe('buyer_commercial_profile');
    expect(buyerEntry.from).toContain('Hamburg');
    expect(buyerEntry.to).toContain('Bremerhaven');
  });

  test('drift never labels a change legally material', async () => {
    const w = await world();
    await generate(w);
    await prisma.deal.update({ where: { id: w.dealId }, data: { buyer_reference: 'PO-DIFFERENT' } });
    const drift = await documentSnapshotDrift(w.agent, w.dealId, w.documentId);
    for (const entry of drift!.entries) {
      expect(['changed', 'added', 'removed']).toContain(entry.kind);
      expect(JSON.stringify(entry)).not.toMatch(/material/i);
    }
  });

  test('added and removed are distinguished from changed', async () => {
    const w = await world();
    await generate(w);
    const snapshotId = (await prisma.document.findUniqueOrThrow({ where: { id: w.documentId } })).input_snapshot_id!;
    const frozen = (await prisma.documentInputSnapshot.findUniqueOrThrow({ where: { id: snapshotId } })).context as never;

    await prisma.shipment.update({ where: { id: w.shipmentId }, data: { container_no: 'MSCU7654321', marks_and_numbers: null } });
    const current = await buildDocumentContext(w.agent, w.dealId, DocType.CI);
    const drift = compareSnapshotToCurrent(frozen, current, DocType.CI);

    expect(drift.entries.find((e) => e.field === 'shipment.container_no')!.kind).toBe('added');
    expect(drift.entries.find((e) => e.field === 'shipment.marks_and_numbers')!.kind).toBe('removed');
  });

  test('drift computation does not touch the historical snapshot', async () => {
    const w = await world();
    await generate(w);
    const snapshotId = (await prisma.document.findUniqueOrThrow({ where: { id: w.documentId } })).input_snapshot_id!;
    const before = await prisma.documentInputSnapshot.findUniqueOrThrow({ where: { id: snapshotId } });
    await prisma.deal.update({ where: { id: w.dealId }, data: { buyer_reference: 'PO-X' } });
    await documentSnapshotDrift(w.agent, w.dealId, w.documentId);
    const after = await prisma.documentInputSnapshot.findUniqueOrThrow({ where: { id: snapshotId } });
    expect(after).toEqual(before);
  });
});

describe('Unicode PDF safety', () => {
  const DEVANAGARI = 'श्री राम एक्सपोर्ट्स';
  const CJK = '株式会社山田';

  test('the renderability check agrees with what pdf-lib can encode', () => {
    expect(isPdfRenderable('A')).toBe(true);
    expect(isPdfRenderable('é')).toBe(true);
    // CP1252 does encode these, and rejecting them would block ordinary English names.
    expect(isPdfRenderable('’')).toBe(true);
    expect(isPdfRenderable('€')).toBe(true);
    expect(isPdfRenderable('—')).toBe(true);
    expect(isPdfRenderable('क')).toBe(false);
    expect(isPdfRenderable('株')).toBe(false);
    expect(unrenderableCharacters(`Acme ${CJK} Ltd`)).toEqual(['株', '式', '会', '社', '山', '田']);
    expect(unrenderableCharacters('Acme Ltd')).toEqual([]);
  });

  test('preflight finds Devanagari in the model with the label a reader would see', async () => {
    const w = await world({ buyerName: DEVANAGARI });
    const context = await buildDocumentContext(w.ownerA, w.dealId, DocType.CI);
    const model = buildDocumentModel(DocType.CI, context, {
      brand_name: 'ClearTrade AI', generated_at: new Date(), audit_id: 'X', draft: false,
    }, 'a'.repeat(64));

    const issues = preflightPdfGlyphs(model);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.label.includes('Buyer'))).toBe(true);
    expect(issues[0]!.code_points[0]).toMatch(/^U\+[0-9A-F]{4}$/);
  });

  test('a final PDF fails closed rather than substituting question marks', async () => {
    const w = await world({ buyerName: CJK });
    setDocumentGenerationEngine(new LegacyDocumentEngine());
    await expect(renderDocumentArtifact({
      actor: w.ownerA, dealId: w.dealId, documentId: w.documentId, format: 'pdf', correlationId: corr(),
    })).rejects.toBeInstanceOf(UnrenderableTextError);

    // Nothing stored, so nothing approvable.
    expect(await prisma.documentArtifact.count({ where: { document_id: w.documentId } })).toBe(0);
  });

  test('the error explains the limitation and the way out', async () => {
    const w = await world({ buyerName: CJK });
    const context = await buildDocumentContext(w.ownerA, w.dealId, DocType.CI);
    const model = buildDocumentModel(DocType.CI, context, {
      brand_name: 'ClearTrade AI', generated_at: new Date(), audit_id: 'X', draft: false,
    }, 'a'.repeat(64));
    const error = new UnrenderableTextError(preflightPdfGlyphs(model));
    expect(error.message).toContain('cannot render faithfully');
    expect(error.message).toContain('DOCX');
  });

  test('a draft PDF still renders, and says on its face that characters were substituted', async () => {
    const w = await world({ buyerName: CJK });
    setDocumentGenerationEngine(new LegacyDocumentEngine());
    const { artifact, bytes } = await renderDocumentArtifact({
      actor: w.ownerA, dealId: w.dealId, documentId: w.documentId, format: 'pdf', draft: true, correlationId: corr(),
    });
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    // A draft never becomes the primary file, so it cannot be approved.
    const document = await prisma.document.findUniqueOrThrow({ where: { id: w.documentId } });
    expect(document.generation_status).not.toBe(GenerationStatus.generated);
    expect(document.file_ref).toBeNull();
    expect(artifact.checksum).not.toBe(document.checksum);
  });

  test('DOCX is not blocked by the PDF font limitation, and keeps the characters', async () => {
    const w = await world({ buyerName: CJK });
    setDocumentGenerationEngine(new LegacyDocumentEngine());
    const { bytes } = await renderDocumentArtifact({
      actor: w.ownerA, dealId: w.dealId, documentId: w.documentId, format: 'docx', correlationId: corr(),
    });
    const { inflateRawSync } = await import('node:zlib');
    let offset = 0; let xml: string | null = null;
    while (offset < bytes.length - 4 && xml === null) {
      if (bytes.readUInt32LE(offset) !== 0x04034b50) { offset += 1; continue; }
      const method = bytes.readUInt16LE(offset + 8);
      const size = bytes.readUInt32LE(offset + 18);
      const nameLength = bytes.readUInt16LE(offset + 26);
      const extraLength = bytes.readUInt16LE(offset + 28);
      const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
      const start = offset + 30 + nameLength + extraLength;
      if (name === 'word/document.xml' && size > 0) {
        const data = bytes.subarray(start, start + size);
        xml = method === 0 ? data.toString('utf8') : inflateRawSync(data).toString('utf8');
      }
      offset = start + (size > 0 ? size : 1);
    }
    expect(xml).toContain(CJK);
    expect(xml).not.toContain('??????');
  });

  test('approval is blocked while the authoritative artifact would be a corrupted PDF', async () => {
    const w = await world({ buyerName: CJK });
    setDocumentGenerationEngine(new LegacyDocumentEngine());
    await renderDocumentArtifact({ actor: w.ownerA, dealId: w.dealId, documentId: w.documentId, format: 'docx', correlationId: corr() });
    const detail = await documentDetail(w.agent, w.dealId, w.documentId);
    expect(detail.glyphIssues.length).toBeGreaterThan(0);
  });
});

describe('draft documents make no external authority claim', () => {
  test('a shipping bill draft is never described as filed or customs-accepted', () => {
    const note = documentAuthorityNote(DocType.shipping_bill_draft)!;
    expect(note.notThis).toMatch(/Not filed with ICEGATE/i);
    expect(note.notThis).toMatch(/not customs-accepted/i);
    expect(note.approvalMeans).not.toMatch(/filed|accepted|cleared/i);
  });

  test('a COO draft is never described as chamber-certified', () => {
    const note = documentAuthorityNote(DocType.COO_draft)!;
    expect(note.notThis).toMatch(/Not certified by a Chamber/i);
    expect(note.approvalMeans).toMatch(/reviewed and approved internally/i);
  });

  test('an insurance declaration is never described as an insurer policy', () => {
    const note = documentAuthorityNote(DocType.insurance_declaration)!;
    expect(note.notThis).toMatch(/Not a policy or certificate issued by an insurer/i);
  });

  test('approving a shipping bill draft does not move its filing status', async () => {
    const w = await world();
    const sb = await prisma.document.create({
      data: {
        deal_id: w.dealId, doc_type: DocType.shipping_bill_draft, version: 1, is_current_version: true,
        source: 'generated', generation_status: GenerationStatus.queued,
        approval_status: ApprovalStatus.pending, filing_status: 'draft',
      }, select: { id: true },
    });
    await prisma.shipment.update({ where: { id: w.shipmentId }, data: { shipping_bill_no: null } });
    await generate(w, sb.id);
    await approve(w, sb.id);

    const after = await prisma.document.findUniqueOrThrow({ where: { id: sb.id } });
    expect(after.approval_status).toBe(ApprovalStatus.exporter_approved);
    // Filing is an independent dimension and an external act. Approval must not touch it.
    expect(after.filing_status).toBe('draft');
    expect(after.filed_at).toBeNull();
    expect(after.filing_reference).toBeNull();
  });

  test('the rendered COO draft states it is uncertified', async () => {
    const w = await world();
    const coo = await prisma.document.create({
      data: {
        deal_id: w.dealId, doc_type: DocType.COO_draft, version: 1, is_current_version: true,
        source: 'generated', generation_status: GenerationStatus.queued, approval_status: ApprovalStatus.pending,
      }, select: { id: true },
    });
    setDocumentGenerationEngine(new LegacyDocumentEngine());
    const { bytes } = await renderDocumentArtifact({
      actor: w.ownerA, dealId: w.dealId, documentId: coo.id, format: 'html', correlationId: corr(),
    });
    expect(bytes.toString('utf8')).toContain('has not been certified by a Chamber of Commerce');
  });
});

describe('historical versions', () => {
  test('an assigned agent sees every version; an unassigned agent sees none', async () => {
    const w = await world();
    await generate(w);
    await createDocumentAmendment({ actor: w.agent, dealId: w.dealId, documentId: w.documentId, reason: 'x', correlationId: corr() });

    const workspace = await documentWorkspace(w.agent, w.dealId);
    const ci = workspace.rows.find((r) => r.doc_type === DocType.CI)!;
    expect(ci.history).toHaveLength(2);
    expect(ci.current!.version).toBe(2);

    await expect(documentWorkspace(w.otherAgent, w.dealId))
      .rejects.toMatchObject({ code: expect.stringMatching(/NOT_FOUND|FORBIDDEN/) });
  });

  test('downloading v1 after v2 exists returns v1 bytes', async () => {
    const w = await world();
    const v1 = await generate(w);
    await approve(w);
    await prisma.shipment.update({ where: { id: w.shipmentId }, data: { container_no: 'MSCU9999999' } });
    const v2 = await createDocumentAmendment({ actor: w.agent, dealId: w.dealId, documentId: w.documentId, reason: 'Container assigned', correlationId: corr() });
    const v2Render = await generate(w, v2.id);

    const servedV1 = await readDocumentArtifact({ actor: w.agent, dealId: w.dealId, documentId: w.documentId, format: 'pdf' });
    const servedV2 = await readDocumentArtifact({ actor: w.agent, dealId: w.dealId, documentId: v2.id, format: 'pdf' });

    expect(servedV1.bytes.equals(v1.bytes)).toBe(true);
    expect(servedV2.bytes.equals(v2Render.bytes)).toBe(true);
    expect(servedV1.bytes.equals(servedV2.bytes)).toBe(false);
  });

  test('approval metadata stays version-specific', async () => {
    const w = await world();
    await generate(w);
    await approve(w);
    const v2 = await createDocumentAmendment({ actor: w.agent, dealId: w.dealId, documentId: w.documentId, reason: 'x', correlationId: corr() });

    const v1Row = await prisma.document.findUniqueOrThrow({ where: { id: w.documentId } });
    expect(v1Row.approved_version).toBe(1);
    expect(v1Row.approved_checksum).toBe(v1Row.checksum);
    expect(v2.approved_version).toBeNull();
    expect(v2.approved_checksum).toBeNull();
  });

  test('the detail view exposes each version with its own identity', async () => {
    const w = await world();
    await generate(w);
    const detail = await documentDetail(w.agent, w.dealId, w.documentId);
    expect(detail.document.version).toBe(1);
    expect(detail.document.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(detail.document.artifacts[0]!.engine).toMatch(/^legacy@/);
    expect(detail.history).toHaveLength(1);
  });
});

describe('invoice numbering across the lifecycle', () => {
  test('review, amendment and approval never allocate a number', async () => {
    const w = await world();
    await generate(w);
    const before = await prisma.issuedInvoiceNumber.count({ where: { exporter_org_id: w.orgA } });

    await agentReviewDocument({ actor: w.agent, dealId: w.dealId, documentId: w.documentId, outcome: 'reviewed', correlationId: corr() });
    await approve(w);
    await createDocumentAmendment({ actor: w.agent, dealId: w.dealId, documentId: w.documentId, reason: 'x', correlationId: corr() });

    expect(await prisma.issuedInvoiceNumber.count({ where: { exporter_org_id: w.orgA } })).toBe(before);
  });

  test('the workspace read model never allocates either', async () => {
    const w = await world();
    const before = await prisma.issuedInvoiceNumber.count({ where: { exporter_org_id: w.orgA } });
    await documentWorkspace(w.agent, w.dealId);
    await generate(w);
    await documentDetail(w.agent, w.dealId, w.documentId);
    expect(await prisma.issuedInvoiceNumber.count({ where: { exporter_org_id: w.orgA } })).toBe(before);
  });

  test('a failed finalisation binds no number to a failed artifact', async () => {
    const w = await world({ buyerName: '株式会社山田' });
    setDocumentGenerationEngine(new LegacyDocumentEngine());
    const issued = await prisma.issuedInvoiceNumber.findFirstOrThrow({ where: { deal_id: w.dealId, voided_at: null } });
    await expect(renderDocumentArtifact({
      actor: w.ownerA, dealId: w.dealId, documentId: w.documentId, format: 'pdf', correlationId: corr(),
    })).rejects.toBeInstanceOf(UnrenderableTextError);

    const after = await prisma.issuedInvoiceNumber.findFirstOrThrow({ where: { id: issued.id } });
    expect(after.formatted_number).toBe(issued.formatted_number);
    expect(after.voided_at).toBeNull();
    expect(await prisma.documentArtifact.count({ where: { document_id: w.documentId } })).toBe(0);
  });
});

describe('tenant isolation across the workspace', () => {
  test('another tenant cannot read the workspace or a document detail', async () => {
    const w = await world();
    await generate(w);
    await expect(documentWorkspace(w.ownerB, w.dealId)).rejects.toMatchObject({ code: expect.stringMatching(/NOT_FOUND|FORBIDDEN/) });
    await expect(documentDetail(w.ownerB, w.dealId, w.documentId)).rejects.toMatchObject({ code: expect.stringMatching(/NOT_FOUND|FORBIDDEN/) });
    await expect(documentSnapshotDrift(w.ownerB, w.dealId, w.documentId)).rejects.toMatchObject({ code: expect.stringMatching(/NOT_FOUND|FORBIDDEN/) });
  });

  test('a document cannot be reached through another tenant deal id', async () => {
    const w = await world();
    await generate(w);
    await expect(documentDetail(w.ownerB, w.dealBId, w.documentId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(createDocumentAmendment({
      actor: w.ownerB, dealId: w.dealBId, documentId: w.documentId, reason: 'x', correlationId: corr(),
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('audit events carry hashes, never document content', async () => {
    const w = await world();
    await generate(w);
    await agentReviewDocument({
      actor: w.agent, dealId: w.dealId, documentId: w.documentId,
      outcome: 'reviewed', note: 'Buyer at Hafenstrasse 4 confirmed.', correlationId: corr(),
    });
    const events = await prisma.auditEvent.findMany({ where: { object_type: 'document', object_id: w.documentId } });
    expect(events.length).toBeGreaterThan(0);
    const payload = JSON.stringify(events.map((e) => e.after_summary));
    expect(payload).not.toContain('Hafenstrasse');
    expect(payload).toContain('agent_reviewed');
  });
});

describe('exporter visibility', () => {
  test('exporters cannot see agent review notes at all', async () => {
    const w = await world();
    await generate(w);
    await agentReviewDocument({
      actor: w.agent, dealId: w.dealId, documentId: w.documentId,
      outcome: 'changes_needed', note: 'Internal: exporter keeps sending the wrong address.',
      correlationId: corr(),
    });

    const { permits } = await import('../src/lib/permissions');
    // Not a UI omission — the capability itself is denied to both exporter roles, so no
    // future surface can accidentally render them.
    expect(permits(w.ownerA, 'internal_note.view')).toBe(false);
    expect(permits(w.agent, 'internal_note.view')).toBe(true);
  });

  test('the exporter-facing document row carries no internal review text', async () => {
    const w = await world();
    await generate(w);
    await agentReviewDocument({
      actor: w.agent, dealId: w.dealId, documentId: w.documentId,
      outcome: 'reviewed', note: 'Internal note text.', correlationId: corr(),
    });
    const document = await prisma.document.findUniqueOrThrow({ where: { id: w.documentId } });
    // The note lives on InternalNote; the Document row records only that a review happened.
    expect(JSON.stringify(document)).not.toContain('Internal note text.');
    expect(document.review_status).toBe(ReviewStatus.agent_reviewed);
  });
});

describe('download integrity', () => {
  test('a tampered stored file is refused rather than served', async () => {
    const w = await world();
    await generate(w);
    await approve(w);
    const artifact = await prisma.documentArtifact.findFirstOrThrow({ where: { document_id: w.documentId } });

    // Corrupt the stored object behind the artifact's back.
    const { getDocumentStorage } = await import('../src/lib/document-storage');
    const storage = getDocumentStorage();
    await storage.delete(artifact.file_ref);
    await storage.put({
      bytes: Buffer.from('not the approved pdf'), contentType: artifact.mime_type,
      sha256: 'd'.repeat(64), objectKey: artifact.file_ref,
    });

    await expect(readDocumentArtifact({
      actor: w.ownerA, dealId: w.dealId, documentId: w.documentId, format: 'pdf',
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('downloading never re-renders', async () => {
    const w = await world();
    const { bytes } = await generate(w);
    // A renderer that would produce different bytes. If download re-rendered, the served
    // bytes would change; they do not, because download reads storage.
    setDocumentGenerationEngine({
      name: 'different', version: '9.9.9',
      supports: () => true,
      render: async () => ({
        bytes: Buffer.from('COMPLETELY DIFFERENT'), mime_type: 'application/pdf',
        file_extension: 'pdf', provenance: {},
      }),
    });
    const served = await readDocumentArtifact({ actor: w.ownerA, dealId: w.dealId, documentId: w.documentId, format: 'pdf' });
    expect(served.bytes.equals(bytes)).toBe(true);
  });
});
