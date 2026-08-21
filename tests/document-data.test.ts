import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, test } from 'vitest';
import {
  DealStage, DocType, ExchangeRateSource, InsuranceCaseStatus, OrgTier,
  Prisma, ShipmentMode, ShipmentStatus, TransportDocumentType, UserRole,
} from '@prisma/client';
import {
  allDocumentReadiness, buildDocumentContext, checkConsistency, documentReadiness, DocumentNotReadyError,
  freezeDocumentInput, hashContext, readDocumentSnapshot, verifySnapshotIntegrity,
} from '../src/lib/document-data';
import { deriveCif, deriveFob, shipmentPackageTotals, sumMoney } from '../src/lib/document-data/derive';
import {
  financialYearKey, invoiceSequenceReport, issueInvoiceNumber, issuedInvoiceNumberForDeal,
  previewNextInvoiceNumber, voidInvoiceNumber,
} from '../src/lib/invoice-numbering';
import { assignExporterToAgent } from '../src/lib/staff-provisioning';
import { prisma } from '../src/lib/prisma';
import type { Principal } from '../src/types';

afterAll(async () => { await prisma.$disconnect(); });

const corr = () => randomUUID();
const principal = (id: string, role: UserRole, orgId: string | null = null): Principal => ({
  id, email: `${id}@t.test`, name: role, role, exporter_org_id: orgId, tier: OrgTier.paid,
});

/**
 * A deal whose canonical data is complete enough for a commercial invoice, plus a second
 * exporter that shares the SAME global Buyer row — which is what makes the tenant tests real
 * rather than hypothetical.
 */
async function world(opts: { complete?: boolean } = {}) {
  const complete = opts.complete ?? true;
  const s = randomUUID().slice(0, 8);

  const [orgA, orgB] = await Promise.all([
    prisma.exporterOrg.create({
      data: {
        display_name: `Alpha ${s}`, legal_name: `Alpha Exports Pvt Ltd ${s}`, tier: OrgTier.paid,
        country: 'IN', state: 'Maharashtra', city: 'Mumbai',
        ...(complete ? { address_line1: '12 Dock Road', postal_code: '400001', ad_code: '6390004', iec_number: `IEC${s}` } : {}),
      },
      select: { id: true },
    }),
    prisma.exporterOrg.create({ data: { display_name: `Beta ${s}`, tier: OrgTier.paid }, select: { id: true } }),
  ]);

  const [ownerA, ownerB, agentUser, opsUser] = await Promise.all([
    prisma.user.create({ data: { email: `own-a-${s}@t.test`, name: 'A', role: UserRole.exporter_owner, exporter_org_id: orgA.id }, select: { id: true } }),
    prisma.user.create({ data: { email: `own-b-${s}@t.test`, name: 'B', role: UserRole.exporter_owner, exporter_org_id: orgB.id }, select: { id: true } }),
    prisma.user.create({ data: { email: `agt-${s}@t.test`, name: 'Agt', role: UserRole.agent }, select: { id: true } }),
    prisma.user.create({ data: { email: `ops-${s}@t.test`, name: 'Ops', role: UserRole.ops_supervisor }, select: { id: true } }),
  ]);

  const ops = principal(opsUser.id, UserRole.ops_supervisor);
  const agent = principal(agentUser.id, UserRole.agent);
  await assignExporterToAgent({ actor: ops, agentUserId: agentUser.id, exporterOrgId: orgA.id, correlationId: corr() });

  // ONE global Buyer, used by both orgs.
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
      payment_terms: { kind: 'advance' },
      buyer_reference: 'PO-99120',
    },
    select: { id: true },
  });

  // Same buyer, other tenant — proves the profile below does not leak.
  const productB = await prisma.product.create({ data: { exporter_org_id: orgB.id, name: `Other ${s}` }, select: { id: true } });
  const dealB = await prisma.deal.create({
    data: { exporter_org_id: orgB.id, buyer_id: buyer.id, product_id: productB.id, stage: DealStage.qualifying },
    select: { id: true },
  });

  if (complete) {
    await prisma.buyerCommercialProfile.create({
      data: {
        exporter_org_id: orgA.id, buyer_id: buyer.id,
        address_line1: 'Hafenstrasse 4', city: 'Hamburg', postal_code: '20457', country_code: 'DE',
        tax_identifier: 'DE123456789', tax_identifier_type: 'VAT',
      },
    });
  }

  const shipment = await prisma.shipment.create({
    data: {
      deal_id: deal.id, status: ShipmentStatus.booking, mode: ShipmentMode.sea, incoterm: 'FOB',
      ...(complete ? {
        port_of_loading_name: 'Nhava Sheva', port_of_loading_unlocode: 'INNSA', port_of_loading_country: 'IN',
        port_of_discharge_name: 'Hamburg', port_of_discharge_unlocode: 'DEHAM', port_of_discharge_country: 'DE',
        marks_and_numbers: 'ALPHA/HAM/1-40',
        transport_document_type: TransportDocumentType.bill_of_lading, transport_document_no: 'BL-77120',
      } : {}),
    },
    select: { id: true },
  });

  if (complete) {
    await prisma.shipmentPackage.createMany({
      data: [
        { shipment_id: shipment.id, sequence: 1, package_type: 'bag', package_count: 40, net_weight_kg: new Prisma.Decimal('25.000'), gross_weight_kg: new Prisma.Decimal('25.400'), volume_cbm: new Prisma.Decimal('0.0350') },
      ],
    });
  }

  return { s, orgA: orgA.id, orgB: orgB.id, dealId: deal.id, dealBId: dealB.id, buyerId: buyer.id, shipmentId: shipment.id,
    ownerA: principal(ownerA.id, UserRole.exporter_owner, orgA.id),
    ownerB: principal(ownerB.id, UserRole.exporter_owner, orgB.id),
    agent, ops };
}

// ---------------------------------------------------------------------------

describe('canonical ownership', () => {
  test('one fact, one owner: the buyer address lives with the tenant, not on the shared Buyer row', async () => {
    const w = await world();
    const buyer = await prisma.buyer.findUniqueOrThrow({ where: { id: w.buyerId } });
    // The global Buyer model carries no address columns at all — the address cannot be
    // written there even by accident.
    expect('address_line1' in buyer).toBe(false);
    expect(Object.keys(buyer).some((k) => k.includes('address'))).toBe(false);

    const ctxA = await buildDocumentContext(w.ownerA, w.dealId, DocType.CI);
    expect(ctxA.buyer.address.city).toBe('Hamburg');

    // Same buyer, other tenant, same global row — and no address.
    const ctxB = await buildDocumentContext(w.ownerB, w.dealBId, DocType.CI);
    expect(ctxB.buyer.buyer_id).toBe(ctxA.buyer.buyer_id);
    expect(ctxB.buyer.address.city).toBeNull();
    expect(ctxB.buyer.address.line1).toBeNull();
  });

  test('package totals are derived, never stored — no column can disagree with the lines', async () => {
    const w = await world();
    const ctx = await buildDocumentContext(w.ownerA, w.dealId, DocType.packing_list);
    // 40 bags x 25.4 kg. Derived at read time from the only rows that own the fact.
    expect(ctx.shipment.package_totals.package_count).toBe(40);
    expect(ctx.shipment.package_totals.gross_weight_kg).toBe('1016');
    expect(ctx.shipment.package_totals.net_weight_kg).toBe('1000');

    const shipment = await prisma.shipment.findUniqueOrThrow({ where: { id: w.shipmentId } });
    for (const key of Object.keys(shipment)) {
      expect(key).not.toMatch(/^(total_)?(package_count|gross_weight|net_weight|volume)/);
    }
  });

  test('editing the canonical owner changes every document that reads it', async () => {
    const w = await world();
    await prisma.exporterOrg.update({ where: { id: w.orgA }, data: { ad_code: '9999999' } });
    const ctx = await buildDocumentContext(w.ownerA, w.dealId, DocType.shipping_bill_draft);
    expect(ctx.exporter.ad_code).toBe('9999999');
    // One edit, and it is the same value everywhere — there is no per-document copy to update.
    const other = await buildDocumentContext(w.ownerA, w.dealId, DocType.CI);
    expect(other.exporter.ad_code).toBe('9999999');
  });

  test('insurance is read from InsuranceCase, not duplicated onto the shipment', async () => {
    const w = await world();
    const shipment = await prisma.shipment.findUniqueOrThrow({ where: { id: w.shipmentId } });
    expect(Object.keys(shipment).some((k) => k.startsWith('insurance_'))).toBe(false);

    await prisma.insuranceCase.create({
      data: {
        deal_id: w.dealId, status: InsuranceCaseStatus.bound,
        premium_amount: new Prisma.Decimal('30.00'), premium_currency: 'USD',
        covered_amount: new Prisma.Decimal('1375.00'), covered_currency: 'USD',
      },
    });
    const ctx = await buildDocumentContext(w.ownerA, w.dealId, DocType.insurance_declaration);
    expect(ctx.financial.insurance).toEqual({ amount: '30', currency: 'USD' });
  });
});

describe('tenant and assignment access', () => {
  test('new container and trade-finance facts remain scoped through their deal and exporter', async () => {
    const w = await world();
    await prisma.shipment.update({ where: { id: w.shipmentId }, data: { containerized: true } });
    await prisma.shipmentContainer.create({
      data: {
        shipment_id: w.shipmentId, sequence: 1, container_number: 'MSCU1234567',
        vgm_verified_gross_mass_kg: new Prisma.Decimal('29200'), vgm_method: 'method_1',
        vgm_verified_at: new Date(), vgm_verifier_name: 'Authorized Weigher',
      },
    });
    const payment = await prisma.payment.create({
      data: { deal_id: w.dealId, amount: new Prisma.Decimal('1250'), currency: 'USD', payment_method: 'DP' },
    });
    const bank = await prisma.exporterBankAccount.create({
      data: { exporter_org_id: w.orgA, bank_name: 'Tenant A Bank', account_reference: 'ending 1234' },
    });
    await prisma.tradeFinanceInstruction.create({
      data: { deal_id: w.dealId, payment_id: payment.id, exporter_bank_account_id: bank.id },
    });

    const own = await buildDocumentContext(w.ownerA, w.dealId, DocType.vgm_declaration);
    expect(own.shipment.containers?.map((container) => container.container_number)).toEqual(['MSCU1234567']);
    expect(own.trade_finance?.bank_presentation?.bank?.name).toBe('Tenant A Bank');

    await expect(buildDocumentContext(w.ownerB, w.dealId, DocType.vgm_declaration))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('an assigned agent can build a context for their exporter', async () => {
    const w = await world();
    const ctx = await buildDocumentContext(w.agent, w.dealId, DocType.CI);
    expect(ctx.exporter.org_id).toBe(w.orgA);
  });

  test('an unassigned agent cannot', async () => {
    const w = await world();
    const s = randomUUID().slice(0, 8);
    const stranger = await prisma.user.create({
      data: { email: `stranger-${s}@t.test`, name: 'X', role: UserRole.agent }, select: { id: true },
    });
    await expect(buildDocumentContext(principal(stranger.id, UserRole.agent), w.dealId, DocType.CI))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('an exporter cannot build a context for another tenant deal', async () => {
    const w = await world();
    await expect(buildDocumentContext(w.ownerB, w.dealId, DocType.CI))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('a snapshot cannot be read across tenants', async () => {
    const w = await world();
    await issueInvoiceNumber({ actor: w.ownerA, dealId: w.dealId, correlationId: corr() });
    await prisma.exchangeRateQuote.create({
      data: { exporter_org_id: w.orgA, base_currency: 'USD', quote_currency: 'INR', rate: new Prisma.Decimal('88.5'), source: ExchangeRateSource.bank_quoted, source_reference: 'Q1', rate_date: new Date() },
    });
    const { snapshot } = await freezeDocumentInput({ actor: w.ownerA, dealId: w.dealId, docType: DocType.CI, correlationId: corr() });
    await expect(readDocumentSnapshot(w.ownerB, snapshot.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(readDocumentSnapshot(w.ownerA, snapshot.id)).resolves.toBeTruthy();
  });
});

describe('invoice numbering', () => {
  test('concurrent issuance for one exporter never duplicates a number', async () => {
    const w = await world();
    const org = await prisma.exporterOrg.findUniqueOrThrow({ where: { id: w.orgA }, select: { id: true } });
    const buyer = await prisma.buyer.create({
      data: { legal_name: 'C', display_name: 'C', country_code: 'FR', buyer_type: 'importer' }, select: { id: true },
    });
    // Ten deals, ten simultaneous issuances against one series.
    const deals = await Promise.all(
      Array.from({ length: 10 }, () =>
        prisma.deal.create({ data: { exporter_org_id: org.id, buyer_id: buyer.id, stage: DealStage.executing }, select: { id: true } })),
    );

    const results = await Promise.all(
      deals.map((d) => issueInvoiceNumber({ actor: w.ownerA, dealId: d.id, correlationId: corr() })),
    );

    const numbers = results.map((r) => r.formatted_number);
    const sequences = results.map((r) => r.sequence_number);
    expect(new Set(numbers).size).toBe(10);
    expect(new Set(sequences).size).toBe(10);
    // Contiguous, so no number was burned by the race either.
    expect([...sequences].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test('preview and readiness never consume a number', async () => {
    const w = await world();
    const before = await previewNextInvoiceNumber(w.ownerA, w.orgA);
    expect(before.is_allocated).toBe(false);

    await previewNextInvoiceNumber(w.ownerA, w.orgA);
    await buildDocumentContext(w.ownerA, w.dealId, DocType.CI);
    const ctx = await buildDocumentContext(w.ownerA, w.dealId, DocType.CI);
    allDocumentReadiness(ctx);

    const after = await previewNextInvoiceNumber(w.ownerA, w.orgA);
    expect(after.preview_number).toBe(before.preview_number);
    expect(await prisma.issuedInvoiceNumber.count({ where: { exporter_org_id: w.orgA } })).toBe(0);
  });

  test('an issued number is immutable — the database refuses to rewrite it', async () => {
    const w = await world();
    const issued = await issueInvoiceNumber({ actor: w.ownerA, dealId: w.dealId, correlationId: corr() });
    await expect(
      prisma.issuedInvoiceNumber.update({ where: { id: issued.id }, data: { formatted_number: 'INV-00001/HACK' } }),
    ).rejects.toThrow(/immutable once issued/);
    await expect(
      prisma.issuedInvoiceNumber.update({ where: { id: issued.id }, data: { sequence_number: 999 } }),
    ).rejects.toThrow(/immutable once issued/);
    await expect(prisma.issuedInvoiceNumber.delete({ where: { id: issued.id } })).rejects.toThrow(/cannot be deleted/);
  });

  test('a deal cannot hold two live numbers, and voiding frees it to be reissued', async () => {
    const w = await world();
    const first = await issueInvoiceNumber({ actor: w.ownerA, dealId: w.dealId, correlationId: corr() });
    await expect(issueInvoiceNumber({ actor: w.ownerA, dealId: w.dealId, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await voidInvoiceNumber({ actor: w.ownerA, issuedInvoiceNumberId: first.id, reason: 'Buyer changed', correlationId: corr() });
    const second = await issueInvoiceNumber({ actor: w.ownerA, dealId: w.dealId, correlationId: corr() });

    // The voided number is retired, never recycled.
    expect(second.sequence_number).toBe(first.sequence_number + 1);
    expect(second.formatted_number).not.toBe(first.formatted_number);
    const live = await issuedInvoiceNumberForDeal(w.dealId);
    expect(live?.id).toBe(second.id);
  });

  test('a void cannot be undone or restated', async () => {
    const w = await world();
    const issued = await issueInvoiceNumber({ actor: w.ownerA, dealId: w.dealId, correlationId: corr() });
    await voidInvoiceNumber({ actor: w.ownerA, issuedInvoiceNumberId: issued.id, reason: 'Error', correlationId: corr() });
    await expect(
      prisma.issuedInvoiceNumber.update({ where: { id: issued.id }, data: { voided_at: null } }),
    ).rejects.toThrow(/already voided/);
  });

  test('exporter series do not collide, and each starts at 1', async () => {
    const w = await world();
    const a = await issueInvoiceNumber({ actor: w.ownerA, dealId: w.dealId, correlationId: corr() });
    const b = await issueInvoiceNumber({ actor: w.ownerB, dealId: w.dealBId, correlationId: corr() });
    expect(a.sequence_number).toBe(1);
    expect(b.sequence_number).toBe(1);
    expect(a.exporter_org_id).not.toBe(b.exporter_org_id);
    // Same visible number, different tenant — which is correct, and why uniqueness is scoped
    // per exporter rather than globally.
    expect(a.formatted_number).toBe(b.formatted_number);
  });

  test('an agent cannot issue for an exporter they are not assigned to', async () => {
    const w = await world();
    const s = randomUUID().slice(0, 8);
    const stranger = await prisma.user.create({ data: { email: `st2-${s}@t.test`, name: 'X', role: UserRole.agent }, select: { id: true } });
    await expect(issueInvoiceNumber({ actor: principal(stranger.id, UserRole.agent), dealId: w.dealId, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await prisma.issuedInvoiceNumber.count({ where: { deal_id: w.dealId } })).toBe(0);
  });

  test('the sequence report finds no gaps, and a void is not counted as one', async () => {
    const w = await world();
    const first = await issueInvoiceNumber({ actor: w.ownerA, dealId: w.dealId, correlationId: corr() });
    await voidInvoiceNumber({ actor: w.ownerA, issuedInvoiceNumberId: first.id, reason: 'x', correlationId: corr() });
    await issueInvoiceNumber({ actor: w.ownerA, dealId: w.dealId, correlationId: corr() });

    const report = await invoiceSequenceReport(w.ownerA, w.orgA);
    expect(report.total_issued).toBe(2);
    expect(report.total_voided).toBe(1);
    expect(report.gaps).toEqual([]);
  });

  test('the financial year key follows the Indian April-March year', () => {
    expect(financialYearKey(new Date('2026-04-01T00:00:00Z'))).toBe('2026-27');
    expect(financialYearKey(new Date('2027-03-31T00:00:00Z'))).toBe('2026-27');
    expect(financialYearKey(new Date('2026-03-31T00:00:00Z'))).toBe('2025-26');
  });
});

describe('financial precision', () => {
  test('decimals survive the round trip without float error', async () => {
    const w = await world();
    await prisma.deal.update({
      where: { id: w.dealId },
      data: { quantity: new Prisma.Decimal('3'), unit_price_amount: new Prisma.Decimal('0.1') },
    });
    const ctx = await buildDocumentContext(w.ownerA, w.dealId, DocType.CI);
    // 3 x 0.1. In IEEE 754 this is 0.30000000000000004.
    expect(ctx.deal.items[0]!.line_total).toEqual({ amount: '0.3', currency: 'USD' });
    expect(Number(ctx.deal.items[0]!.line_total!.amount)).not.toBe(0.1 + 0.1 + 0.1);
  });

  test('adding money requires one currency, and refuses rather than returning a wrong number', () => {
    expect(sumMoney([{ amount: '0.1', currency: 'USD' }, { amount: '0.2', currency: 'USD' }]))
      .toEqual({ amount: '0.3', currency: 'USD' });
    expect(sumMoney([{ amount: '10', currency: 'USD' }, { amount: '10', currency: 'EUR' }])).toBeNull();
  });

  test('a large total keeps its last cent', async () => {
    const w = await world();
    await prisma.deal.update({
      where: { id: w.dealId },
      data: { quantity: new Prisma.Decimal('1'), unit_price_amount: new Prisma.Decimal('12345678901.23') },
    });
    const ctx = await buildDocumentContext(w.ownerA, w.dealId, DocType.CI);
    expect(ctx.deal.goods_total!.amount).toBe('12345678901.23');
  });

  test('FOB and CIF derive only from complete inputs — never a partial figure', () => {
    const total = { amount: '1250.00', currency: 'USD' };
    const freight = { amount: '200.00', currency: 'USD' };
    const insurance = { amount: '30.00', currency: 'USD' };

    // FOB contract: the price already excludes both, so FOB is the price.
    // Passed through untouched: an FOB price needs no adjustment, so the figure the exporter
    // agreed is the figure that goes on the document, digit for digit.
    expect(deriveFob(total, 'FOB', null, null)).toEqual({ amount: '1250.00', currency: 'USD' });
    // CIF contract with both known: strip them back out.
    expect(deriveFob(total, 'CIF', freight, insurance)).toEqual({ amount: '1020', currency: 'USD' });
    // CIF contract with freight unknown: the answer is unknown, NOT the CIF total.
    expect(deriveFob(total, 'CIF', null, insurance)).toBeNull();
    // An unrecognised term does not get a guess.
    expect(deriveFob(total, 'XYZ', freight, insurance)).toBeNull();
    expect(deriveCif({ amount: '1020', currency: 'USD' }, freight, insurance)).toEqual({ amount: '1250', currency: 'USD' });
    expect(deriveCif({ amount: '1020', currency: 'USD' }, null, insurance)).toBeNull();
  });

  test('an unknown weight is null, never zero', () => {
    const totals = shipmentPackageTotals([
      { sequence: 1, package_type: 'bag', package_count: 2, net_weight_kg: '10', gross_weight_kg: null, volume_cbm: null, dimensions_cm: null, contents_description: null },
    ]);
    expect(totals.net_weight_kg).toBe('20');
    // The legacy renderer printed `Number(undefined || 0)` here, which is an official-looking
    // claim that the shipment weighs nothing.
    expect(totals.gross_weight_kg).toBeNull();
    expect(totals.volume_cbm).toBeNull();
  });

  test('exchange-rate source, citation and date are preserved through the context', async () => {
    const w = await world();
    await prisma.exchangeRateQuote.create({
      data: {
        exporter_org_id: w.orgA, base_currency: 'USD', quote_currency: 'INR',
        rate: new Prisma.Decimal('88.42500000'), source: ExchangeRateSource.rbi_reference,
        source_reference: 'RBI/2026-27/114', rate_date: new Date('2026-08-01T00:00:00Z'),
      },
    });
    const ctx = await buildDocumentContext(w.ownerA, w.dealId, DocType.CI);
    expect(ctx.financial.exchange_rate).toMatchObject({
      base_currency: 'USD', quote_currency: 'INR', rate: '88.425',
      source: 'rbi_reference', source_reference: 'RBI/2026-27/114',
    });
    expect(ctx.financial.invoice_total_in_quote_currency).toEqual({ amount: '110531.25', currency: 'INR' });
  });

  test('the database refuses a regulatory rate with no citation', async () => {
    const w = await world();
    await expect(prisma.exchangeRateQuote.create({
      data: {
        exporter_org_id: w.orgA, base_currency: 'USD', quote_currency: 'INR',
        rate: new Prisma.Decimal('88.5'), source: ExchangeRateSource.rbi_reference,
        source_reference: null, rate_date: new Date(),
      },
    })).rejects.toThrow(/regulatory_source_cited/);

    // A manually entered rate is allowed without one — it just says so honestly.
    await expect(prisma.exchangeRateQuote.create({
      data: {
        exporter_org_id: w.orgA, base_currency: 'USD', quote_currency: 'INR',
        rate: new Prisma.Decimal('88.5'), source: ExchangeRateSource.manual_entry, rate_date: new Date(),
      },
    })).resolves.toBeTruthy();
  });

  test('a rate recorded later does not retroactively apply to an earlier date', async () => {
    const w = await world();
    await prisma.exchangeRateQuote.createMany({
      data: [
        { exporter_org_id: w.orgA, base_currency: 'USD', quote_currency: 'INR', rate: new Prisma.Decimal('88'), source: ExchangeRateSource.bank_quoted, rate_date: new Date('2026-08-01T00:00:00Z') },
        { exporter_org_id: w.orgA, base_currency: 'USD', quote_currency: 'INR', rate: new Prisma.Decimal('91'), source: ExchangeRateSource.bank_quoted, rate_date: new Date('2026-09-01T00:00:00Z') },
      ],
    });
    const ctx = await buildDocumentContext(w.ownerA, w.dealId, DocType.CI, { on: new Date('2026-08-15T00:00:00Z') });
    expect(ctx.financial.exchange_rate!.rate).toBe('88');
  });
});

describe('readiness', () => {
  test('an otherwise complete CI is blocked only by the specifically owned invoice-number fact', async () => {
    const w = await world();
    await prisma.exchangeRateQuote.create({
      data: {
        exporter_org_id: w.orgA, base_currency: 'USD', quote_currency: 'INR',
        rate: new Prisma.Decimal('88.5'), source: ExchangeRateSource.bank_quoted,
        rate_date: new Date(),
      },
    });

    const ctx = await buildDocumentContext(w.ownerA, w.dealId, DocType.CI);
    const readiness = documentReadiness(ctx, DocType.CI);

    expect(readiness.status).not.toBe('ready');
    expect(readiness.invalid).toEqual([]);
    expect(readiness.missing).toEqual([
      expect.objectContaining({
        field: 'references.invoice_number', label: 'Issued invoice number',
        owner: 'invoice_number', reason: 'required_for_this_document',
      }),
    ]);
    expect(documentReadiness(ctx, DocType.PI).missing.map((issue) => issue.field))
      .not.toContain('references.invoice_number');
  });

  test('complete canonical data makes the commercial invoice ready', async () => {
    const w = await world();
    await issueInvoiceNumber({ actor: w.ownerA, dealId: w.dealId, correlationId: corr() });
    await prisma.exchangeRateQuote.create({
      data: { exporter_org_id: w.orgA, base_currency: 'USD', quote_currency: 'INR', rate: new Prisma.Decimal('88.5'), source: ExchangeRateSource.bank_quoted, rate_date: new Date() },
    });
    const ctx = await buildDocumentContext(w.ownerA, w.dealId, DocType.CI);
    const readiness = documentReadiness(ctx, DocType.CI);
    expect(readiness).toMatchObject({ status: 'ready', missing: [], invalid: [] });
  });

  test('a missing required field is reported as missing, with the owner that fixes it', async () => {
    const w = await world({ complete: false });
    const ctx = await buildDocumentContext(w.ownerA, w.dealId, DocType.shipping_bill_draft);
    const readiness = documentReadiness(ctx, DocType.shipping_bill_draft);

    expect(readiness.status).not.toBe('ready');
    const adCode = readiness.missing.find((m) => m.field === 'exporter.ad_code');
    expect(adCode).toMatchObject({
      field: 'exporter.ad_code', reason: 'required_for_this_document', owner: 'exporter_org',
    });
  });

  test('an unknown field is absent, not empty or zero', async () => {
    const w = await world({ complete: false });
    const ctx = await buildDocumentContext(w.ownerA, w.dealId, DocType.packing_list);
    expect(ctx.exporter.ad_code).toBeNull();
    expect(ctx.exporter.address.line1).toBeNull();
    expect(ctx.buyer.address.city).toBeNull();
    expect(ctx.shipment.package_totals.gross_weight_kg).toBeNull();
    // Nothing collapsed to '' or 0 on the way through.
    expect(ctx.exporter.ad_code as unknown).not.toBe('');
    expect(ctx.shipment.package_totals.gross_weight_kg as unknown).not.toBe(0);
  });

  test('a conditionally required field applies only when its condition holds', async () => {
    const w = await world();
    await issueInvoiceNumber({ actor: w.ownerA, dealId: w.dealId, correlationId: corr() });

    // USD deal: the INR conversion is required, and says why.
    const usd = documentReadiness(await buildDocumentContext(w.ownerA, w.dealId, DocType.CI), DocType.CI);
    const fx = usd.missing.find((m) => m.field === 'financial.exchange_rate');
    expect(fx).toMatchObject({ reason: 'conditionally_required', owner: 'exchange_rate_quote' });
    expect(fx!.condition).toContain('USD');

    // Same deal priced in INR: no conversion is needed, so it is not a gap.
    await prisma.deal.update({
      where: { id: w.dealId },
      data: { total_currency: 'INR', unit_price_currency: 'INR', value_currency: 'INR' },
    });
    const inr = documentReadiness(await buildDocumentContext(w.ownerA, w.dealId, DocType.CI), DocType.CI);
    expect(inr.missing.find((m) => m.field === 'financial.exchange_rate')).toBeUndefined();
  });

  test('a proforma is ready before shipping data exists — it is issued before there is any', async () => {
    const w = await world();
    const ctx = await buildDocumentContext(w.ownerA, w.dealId, DocType.PI);
    expect(documentReadiness(ctx, DocType.PI).status).toBe('ready');
    // The commercial invoice, by contrast, still needs its issued number.
    expect(documentReadiness(ctx, DocType.CI).missing.map((m) => m.field)).toContain('references.invoice_number');
  });

  test('an unusable value is blocked, not merely missing', async () => {
    const w = await world();
    // A CIF price with no freight recorded: FOB genuinely cannot be derived.
    await prisma.deal.update({ where: { id: w.dealId }, data: { incoterm: 'CIF' } });
    const ctx = await buildDocumentContext(w.ownerA, w.dealId, DocType.shipping_bill_draft);
    const readiness = documentReadiness(ctx, DocType.shipping_bill_draft);

    expect(readiness.status).toBe('blocked');
    expect(readiness.invalid.map((i) => i.field)).toContain('financial.freight');
    expect(readiness.invalid.find((i) => i.field === 'financial.freight')!.detail).toContain('CIF');
  });

  test('every supported document type is assessed, and `other` is not', async () => {
    const w = await world();
    const ctx = await buildDocumentContext(w.ownerA, w.dealId, DocType.CI);
    const all = allDocumentReadiness(ctx);
    expect(all.map((r) => r.documentType).sort()).toEqual(
      [
        'COO_draft', 'CI', 'PI', 'declaration', 'insurance_declaration', 'packing_list',
        'shipping_bill_draft', 'shipping_instructions', 'vgm_declaration', 'bill_of_exchange',
        'carrier_instructions', 'bank_collection_letter',
      ].sort(),
    );
    expect(all.some((r) => r.documentType === DocType.other)).toBe(false);
  });
});

describe('snapshots', () => {
  async function ready(w: Awaited<ReturnType<typeof world>>) {
    await issueInvoiceNumber({ actor: w.ownerA, dealId: w.dealId, correlationId: corr() });
    await prisma.exchangeRateQuote.create({
      data: { exporter_org_id: w.orgA, base_currency: 'USD', quote_currency: 'INR', rate: new Prisma.Decimal('88.5'), source: ExchangeRateSource.bank_quoted, rate_date: new Date() },
    });
  }

  test('freezing refuses to snapshot a document that is not ready', async () => {
    const w = await world({ complete: false });
    await expect(freezeDocumentInput({ actor: w.ownerA, dealId: w.dealId, docType: DocType.CI, correlationId: corr() }))
      .rejects.toBeInstanceOf(DocumentNotReadyError);
    expect(await prisma.documentInputSnapshot.count({ where: { deal_id: w.dealId } })).toBe(0);
  });

  test('a snapshot freezes the exact input, and later edits do not touch it', async () => {
    const w = await world();
    await ready(w);
    const { snapshot } = await freezeDocumentInput({ actor: w.ownerA, dealId: w.dealId, docType: DocType.CI, correlationId: corr() });
    const frozen = (snapshot.context as unknown as { buyer: { address: { city: string } } }).buyer.address.city;
    expect(frozen).toBe('Hamburg');

    // Correct the canonical record — which is exactly what an agent is supposed to do.
    await prisma.buyerCommercialProfile.update({
      where: { exporter_org_id_buyer_id: { exporter_org_id: w.orgA, buyer_id: w.buyerId } },
      data: { city: 'Bremerhaven' },
    });

    const reread = await prisma.documentInputSnapshot.findUniqueOrThrow({ where: { id: snapshot.id } });
    expect((reread.context as unknown as { buyer: { address: { city: string } } }).buyer.address.city).toBe('Hamburg');
    // And the live context does reflect the correction — both facts are true at once, which is
    // the whole point of the layer.
    const live = await buildDocumentContext(w.ownerA, w.dealId, DocType.CI);
    expect(live.buyer.address.city).toBe('Bremerhaven');
  });

  test('a snapshot cannot be updated or rewritten', async () => {
    const w = await world();
    await ready(w);
    const { snapshot } = await freezeDocumentInput({ actor: w.ownerA, dealId: w.dealId, docType: DocType.CI, correlationId: corr() });
    await expect(
      prisma.documentInputSnapshot.update({ where: { id: snapshot.id }, data: { content_hash: 'a'.repeat(64) } }),
    ).rejects.toThrow(/immutable/);
  });

  test('the hash is stable and is a property of the data, not of when it was built', async () => {
    const w = await world();
    await ready(w);
    const a = await buildDocumentContext(w.ownerA, w.dealId, DocType.CI, { on: new Date('2026-08-01T00:00:00Z') });
    const b = await buildDocumentContext(w.ownerA, w.dealId, DocType.CI, { on: new Date('2026-08-02T00:00:00Z') });
    expect(hashContext(a)).toBe(hashContext(b));
    expect(hashContext(a)).toMatch(/^[0-9a-f]{64}$/);

    // A real change to the data does move the hash.
    await prisma.deal.update({ where: { id: w.dealId }, data: { buyer_reference: 'PO-DIFFERENT' } });
    const c = await buildDocumentContext(w.ownerA, w.dealId, DocType.CI, { on: new Date('2026-08-01T00:00:00Z') });
    expect(hashContext(c)).not.toBe(hashContext(a));
  });

  test('a stored snapshot verifies against its own hash', async () => {
    const w = await world();
    await ready(w);
    const { snapshot } = await freezeDocumentInput({ actor: w.ownerA, dealId: w.dealId, docType: DocType.CI, correlationId: corr() });
    expect(verifySnapshotIntegrity(snapshot)).toBe(true);
  });

  test('a new version snapshots again and leaves the prior snapshot alone', async () => {
    const w = await world();
    await ready(w);
    const v1 = await freezeDocumentInput({ actor: w.ownerA, dealId: w.dealId, docType: DocType.CI, documentVersion: 1, correlationId: corr() });
    await prisma.exporterOrg.update({ where: { id: w.orgA }, data: { address_line1: '99 New Dock Road' } });
    const v2 = await freezeDocumentInput({ actor: w.ownerA, dealId: w.dealId, docType: DocType.CI, documentVersion: 2, correlationId: corr() });

    expect(v1.snapshot.id).not.toBe(v2.snapshot.id);
    expect(v1.snapshot.content_hash).not.toBe(v2.snapshot.content_hash);
    const v1Reread = await prisma.documentInputSnapshot.findUniqueOrThrow({ where: { id: v1.snapshot.id } });
    expect(v1Reread.content_hash).toBe(v1.snapshot.content_hash);
    expect((v1Reread.context as unknown as { exporter: { address: { line1: string } } }).exporter.address.line1)
      .toBe('12 Dock Road');
  });

  test('freezing does not allocate an invoice number', async () => {
    const w = await world();
    await ready(w);
    const before = await prisma.issuedInvoiceNumber.count({ where: { exporter_org_id: w.orgA } });
    await freezeDocumentInput({ actor: w.ownerA, dealId: w.dealId, docType: DocType.CI, correlationId: corr() });
    expect(await prisma.issuedInvoiceNumber.count({ where: { exporter_org_id: w.orgA } })).toBe(before);
  });

  test('the audit event records the hash, not the buyer address', async () => {
    const w = await world();
    await ready(w);
    const { snapshot } = await freezeDocumentInput({ actor: w.ownerA, dealId: w.dealId, docType: DocType.CI, correlationId: corr() });
    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { object_type: 'document_input_snapshot', object_id: snapshot.id },
    });
    const payload = JSON.stringify(event.after_summary);
    expect(payload).toContain(snapshot.content_hash);
    expect(payload).not.toContain('Hafenstrasse');
    expect(payload).not.toContain('Hamburg');
  });
});

describe('database-level data integrity', () => {
  test('a malformed UN/LOCODE is refused', async () => {
    const w = await world();
    await expect(prisma.shipment.update({
      where: { id: w.shipmentId }, data: { port_of_loading_unlocode: 'NOTACODE' },
    })).rejects.toThrow();
    // An unknown code stays null rather than being invented.
    await expect(prisma.shipment.update({
      where: { id: w.shipmentId }, data: { port_of_loading_unlocode: null },
    })).resolves.toBeTruthy();
  });

  test('a sea shipment cannot carry an air waybill', async () => {
    const w = await world();
    await expect(prisma.shipment.update({
      where: { id: w.shipmentId },
      data: { mode: ShipmentMode.sea, transport_document_type: TransportDocumentType.air_waybill },
    })).rejects.toThrow(/transport_document_matches_mode/);
  });

  test('a transport document number requires its type', async () => {
    const w = await world();
    await expect(prisma.shipment.update({
      where: { id: w.shipmentId },
      data: { transport_document_type: null, transport_document_no: 'XYZ' },
    })).rejects.toThrow(/transport_document_typed/);
  });

  test('gross weight below net is refused rather than silently corrected', async () => {
    const w = await world();
    await expect(prisma.shipmentPackage.create({
      data: {
        shipment_id: w.shipmentId, sequence: 90, package_type: 'bag', package_count: 1,
        net_weight_kg: new Prisma.Decimal('25'), gross_weight_kg: new Prisma.Decimal('20'),
      },
    })).rejects.toThrow(/gross_covers_net/);
  });

  test('a buyer tax identifier requires its type', async () => {
    const w = await world();
    const s = randomUUID().slice(0, 8);
    const org = await prisma.exporterOrg.create({ data: { display_name: `T ${s}`, tier: OrgTier.paid }, select: { id: true } });
    await expect(prisma.buyerCommercialProfile.create({
      data: { exporter_org_id: org.id, buyer_id: w.buyerId, tax_identifier: 'DE123', tax_identifier_type: null },
    })).rejects.toThrow(/tax_id_typed/);
  });
});

describe('consistency rules mapped from the legacy engines', () => {
  test('a mismatch the legacy engine checked for cannot arise here', async () => {
    const w = await world();
    const ci = await buildDocumentContext(w.ownerA, w.dealId, DocType.CI);
    const pl = await buildDocumentContext(w.ownerA, w.dealId, DocType.packing_list);
    // PORT_MISMATCH, CURRENCY_MISMATCH and INCOTERM_MISMATCH existed because each legacy
    // document stored its own copy. Two documents on one deal read the same owner, so the
    // values are identical by construction — the rule has nothing to compare.
    expect(pl.shipment.port_of_loading).toEqual(ci.shipment.port_of_loading);
    expect(pl.deal.currency).toBe(ci.deal.currency);
    expect(pl.deal.incoterm).toBe(ci.deal.incoterm);
  });

  test('goods shipped before the invoice date is flagged', async () => {
    const w = await world();
    await issueInvoiceNumber({ actor: w.ownerA, dealId: w.dealId, correlationId: corr() });
    await prisma.shipment.update({
      where: { id: w.shipmentId }, data: { shipped_on_date: new Date('2020-01-01T00:00:00Z') },
    });
    const ctx = await buildDocumentContext(w.ownerA, w.dealId, DocType.CI);
    const findings = checkConsistency(ctx);
    expect(findings.map((f) => f.rule)).toContain('DATE_SEQUENCE_ERROR');
  });

  test('package weight that disagrees with the agreed quantity is flagged, within tolerance', async () => {
    const w = await world();
    // Deal is for 1000 kg; packages total 1000 kg net. No finding.
    let ctx = await buildDocumentContext(w.ownerA, w.dealId, DocType.packing_list);
    expect(checkConsistency(ctx).map((f) => f.rule)).not.toContain('WEIGHT_VARIANCE');

    await prisma.shipmentPackage.updateMany({
      where: { shipment_id: w.shipmentId }, data: { net_weight_kg: new Prisma.Decimal('10.000') },
    });
    ctx = await buildDocumentContext(w.ownerA, w.dealId, DocType.packing_list);
    expect(checkConsistency(ctx).map((f) => f.rule)).toContain('WEIGHT_VARIANCE');
  });

  test('a unit it cannot convert makes the rule decline rather than guess', async () => {
    const w = await world();
    await prisma.deal.update({ where: { id: w.dealId }, data: { unit: 'cartons' } });
    const ctx = await buildDocumentContext(w.ownerA, w.dealId, DocType.packing_list);
    // 1000 cartons vs 1000 kg is not a comparison; the legacy engine would have compared the
    // numbers anyway.
    expect(checkConsistency(ctx).map((f) => f.rule)).not.toContain('WEIGHT_VARIANCE');
  });

  test('freight recorded against an FOB price is surfaced, not silently added in', async () => {
    const w = await world();
    await prisma.shipment.update({
      where: { id: w.shipmentId },
      data: { freight_amount: new Prisma.Decimal('200.00'), freight_currency: 'USD' },
    });
    const ctx = await buildDocumentContext(w.ownerA, w.dealId, DocType.CI);
    expect(checkConsistency(ctx).map((f) => f.rule)).toContain('FREIGHT_OUTSIDE_PRICE');
    // And the invoice value is unchanged — the freight did not leak into it.
    expect(ctx.financial.invoice_total).toEqual({ amount: '1250', currency: 'USD' });
  });
});

describe('advisory findings inform, they do not block (Phase 8 regression)', () => {
  /**
   * The Phase 8 pilot found this: an ordinary FOB shipment that records its booked freight
   * fires FREIGHT_OUTSIDE_PRICE, whose own message says "confirm". That finding was being
   * merged into `invalid`, so readiness reported `blocked` and the deal could not produce a
   * single document. Advice must not sit in the gate.
   */
  test('freight on an FOB deal is advisory, and the document stays ready', async () => {
    const w = await world();
    await issueInvoiceNumber({ actor: w.ownerA, dealId: w.dealId, correlationId: corr() });
    await prisma.exchangeRateQuote.create({
      data: {
        exporter_org_id: w.orgA, base_currency: 'USD', quote_currency: 'INR',
        rate: new Prisma.Decimal('88.5'), source: ExchangeRateSource.bank_quoted, rate_date: new Date(),
      },
    });
    await prisma.shipment.update({
      where: { id: w.shipmentId },
      data: { freight_amount: new Prisma.Decimal('200.00'), freight_currency: 'USD' },
    });

    const readiness = documentReadiness(
      await buildDocumentContext(w.ownerA, w.dealId, DocType.CI), DocType.CI,
    );

    expect(readiness.status).toBe('ready');
    expect(readiness.invalid).toEqual([]);
    // Still surfaced — the agent is the one who can tell whether it is a mistake.
    expect(readiness.advisory.map((a) => a.field)).toContain('financial.freight');
  });

  test('shipping before the invoice date is advisory too', async () => {
    const w = await world();
    await issueInvoiceNumber({ actor: w.ownerA, dealId: w.dealId, correlationId: corr() });
    await prisma.shipment.update({
      where: { id: w.shipmentId }, data: { shipped_on_date: new Date('2020-01-01T00:00:00Z') },
    });
    const readiness = documentReadiness(
      await buildDocumentContext(w.ownerA, w.dealId, DocType.packing_list), DocType.packing_list,
    );
    expect(readiness.invalid.map((i) => i.field)).not.toContain('shipment.shipped_on_date');
    expect(readiness.advisory.map((a) => a.field)).toContain('shipment.shipped_on_date');
  });

  test('a genuine impossibility still blocks', async () => {
    const w = await world();
    // A CIF price with no freight recorded: FOB cannot be derived at all. Not advice.
    await prisma.deal.update({ where: { id: w.dealId }, data: { incoterm: 'CIF' } });
    const readiness = documentReadiness(
      await buildDocumentContext(w.ownerA, w.dealId, DocType.shipping_bill_draft),
      DocType.shipping_bill_draft,
    );
    expect(readiness.status).toBe('blocked');
    expect(readiness.invalid.map((i) => i.field)).toContain('financial.freight');
  });

  test('gross below net remains blocking, not advisory', async () => {
    const w = await world();
    const context = await buildDocumentContext(w.ownerA, w.dealId, DocType.packing_list);
    // The database refuses such a row, so this is constructed directly to exercise the rule
    // as it would behave against a snapshot frozen before that constraint existed.
    const tampered = {
      ...context,
      shipment: {
        ...context.shipment,
        packages: [{
          sequence: 1, package_type: 'bag', package_count: 1,
          net_weight_kg: '25', gross_weight_kg: '20', volume_cbm: null,
          dimensions_cm: null, contents_description: null,
        }],
      },
    };
    const findings = checkConsistency(tampered);
    const grossBelowNet = findings.find((f) => f.rule === 'GROSS_BELOW_NET')!;
    expect(grossBelowNet.severity).toBe('blocking');
    expect(documentReadiness(tampered, DocType.packing_list).status).toBe('blocked');
  });
});
