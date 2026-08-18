/**
 * Phase 8 pilot fixtures.
 *
 * Three exporters that together exercise the whole system rather than one happy path:
 *
 *   A — complete. Everything a document needs, so the full workflow reaches approval.
 *   B — deliberately missing one exporter field, one buyer field and one shipment field, so
 *       readiness must block the documents that need them and pass the ones that do not.
 *   C — assigned to a DIFFERENT agent. Every isolation test points at C, and the point is that
 *       C is fully populated: an empty tenant would pass an isolation test by having nothing
 *       to leak, which proves nothing.
 *
 * Deterministic: every id is derived from one suffix, so a failure names the row it came from.
 * Nothing here mocks a state transition — canonical rows are created the way the product
 * creates them, and the workflow tests drive real services over them.
 */

import { randomUUID } from 'node:crypto';
import {
  DealStage, DisputeSeverity, DisputeStatus, DocType, EvidenceOrigin, ExceptionState,
  ExchangeRateSource, GenerationStatus, InsuranceCaseStatus, OrgTier, Prisma, ScopeType,
  ShipmentMode, ShipmentStatus, SlaState, TaskPriority, TaskState, TransportDocumentType,
  UserRole,
} from '@prisma/client';
import { assignExporterToAgent } from '../../src/lib/staff-provisioning';
import { issueInvoiceNumber } from '../../src/lib/invoice-numbering';
import { prisma } from '../../src/lib/prisma';
import type { Principal } from '../../src/types';

export const principalFor = (
  id: string, role: UserRole, orgId: string | null = null, tier: OrgTier = OrgTier.paid,
): Principal => ({ id, email: `${id}@pilot.test`, name: role, role, exporter_org_id: orgId, tier });

export const corr = () => randomUUID();

/** Values chosen to expose financial bugs, not to look tidy. */
export const PILOT_MONEY = {
  /** Fractional unit price: 1250 x 1.2345 = 1543.125, which no float sum reproduces exactly. */
  quantity: '1250',
  unitPrice: '1.2345',
  lineTotal: '1543.1250',
  currency: 'USD',
  freight: '212.50',
  insurancePremium: '38.75',
  /** Eight-decimal rate, the precision the column actually stores. */
  fxRate: '88.42537500',
  sumInsured: '1697.44',
};

export interface PilotExporter {
  orgId: string;
  ownerPrincipal: Principal;
  buyerId: string;
  productId: string;
  dealId: string;
  shipmentId: string | null;
  documentIds: Record<string, string>;
}

interface BuildOptions {
  suffix: string;
  name: string;
  complete: boolean;
  /** Populates the exception rows the escalation queue aggregates. */
  withExceptions?: boolean;
}

async function buildExporter(opts: BuildOptions): Promise<PilotExporter> {
  const { suffix, name, complete } = opts;

  const org = await prisma.exporterOrg.create({
    data: {
      display_name: name,
      legal_name: `${name} Exports Private Limited`,
      tier: OrgTier.paid,
      country: 'IN', state: 'Maharashtra', city: 'Mumbai',
      address_line1: '12 Dock Road, Ballard Estate',
      postal_code: '400001',
      iec_number: `IEC${suffix}`,
      gstin: '27AAAAA0000A1Z5',
      // Exporter B's deliberate exporter-level gap. Blocks the shipping bill and nothing else.
      ...(complete ? { ad_code: '6390004' } : {}),
    },
    select: { id: true },
  });

  const owner = await prisma.user.create({
    data: { email: `owner-${suffix}@pilot.test`, name: `${name} Owner`, role: UserRole.exporter_owner, exporter_org_id: org.id },
    select: { id: true },
  });

  const product = await prisma.product.create({
    data: {
      exporter_org_id: org.id,
      name: `Basmati rice ${suffix}`,
      description: 'Basmati rice, 1121 steam, 2% broken, jute bags',
      hs_code: '100630', itc_hs_code: '10063020', hs_code_source: 'user_confirmed',
      evidence_origin: EvidenceOrigin.manually_entered_real,
    },
    select: { id: true },
  });

  const buyer = await prisma.buyer.create({
    data: {
      legal_name: `Nordwind Handels GmbH ${suffix}`,
      display_name: `Nordwind ${suffix}`,
      country_code: 'DE', buyer_type: 'importer',
    },
    select: { id: true },
  });

  await prisma.buyerCommercialProfile.create({
    data: {
      exporter_org_id: org.id, buyer_id: buyer.id,
      address_line1: 'Hafenstrasse 4',
      // Exporter B's deliberate buyer-level gap: no city, so every document needing a buyer
      // address blocks.
      ...(complete ? { city: 'Hamburg', postal_code: '20457' } : {}),
      country_code: 'DE',
      tax_identifier: 'DE811234567', tax_identifier_type: 'VAT',
      contact_email: `ops@nordwind-${suffix}.example`,
    },
  });

  const deal = await prisma.deal.create({
    data: {
      exporter_org_id: org.id, buyer_id: buyer.id, product_id: product.id,
      stage: DealStage.executing,
      incoterm: 'FOB', incoterm_place: 'Nhava Sheva',
      quantity: new Prisma.Decimal(PILOT_MONEY.quantity), unit: 'kg',
      unit_price_amount: new Prisma.Decimal(PILOT_MONEY.unitPrice), unit_price_currency: PILOT_MONEY.currency,
      total_amount: new Prisma.Decimal(PILOT_MONEY.lineTotal), total_currency: PILOT_MONEY.currency,
      payment_terms: { kind: 'advance', label: 'Advance' },
      buyer_reference: `PO-${suffix.toUpperCase()}-4471`,
    },
    select: { id: true },
  });

  const shipment = await prisma.shipment.create({
    data: {
      deal_id: deal.id, status: ShipmentStatus.booking, mode: ShipmentMode.sea, incoterm: 'FOB',
      port_of_loading_name: 'Nhava Sheva', port_of_loading_unlocode: 'INNSA', port_of_loading_country: 'IN',
      // Exporter B's deliberate shipment-level gap: no discharge port.
      ...(complete
        ? { port_of_discharge_name: 'Hamburg', port_of_discharge_unlocode: 'DEHAM', port_of_discharge_country: 'DE' }
        : {}),
      final_destination_country: 'DE',
      marks_and_numbers: `${name.toUpperCase()}/HAM/1-50`,
      transport_document_type: TransportDocumentType.bill_of_lading,
      transport_document_no: `BL-${suffix.toUpperCase()}-77120`,
      vessel_or_flight_no: 'MV Concord Trader', voyage_no: '024W',
      container_no: 'MSCU1234567', container_type: "40'HC", seal_no: 'SL889120',
      shipped_on_date: new Date('2026-08-14T00:00:00Z'),
      freight_amount: new Prisma.Decimal(PILOT_MONEY.freight), freight_currency: PILOT_MONEY.currency,
    },
    select: { id: true },
  });

  // 50 lines, so the packing list genuinely paginates rather than fitting on one page.
  await prisma.shipmentPackage.createMany({
    data: Array.from({ length: 50 }, (_, i) => ({
      shipment_id: shipment.id, sequence: i + 1, package_type: 'jute bag', package_count: 1,
      net_weight_kg: new Prisma.Decimal('25.000'), gross_weight_kg: new Prisma.Decimal('25.400'),
      volume_cbm: new Prisma.Decimal('0.0350'),
      contents_description: `Bag ${i + 1} of 50 — Basmati 1121 steam, lot ${4000 + i}`,
    })),
  });

  await prisma.insuranceCase.create({
    data: {
      deal_id: deal.id, status: InsuranceCaseStatus.bound,
      provider_name: 'Oriental Insurance', policy_ref: `POL-${suffix.toUpperCase()}-8891`,
      premium_amount: new Prisma.Decimal(PILOT_MONEY.insurancePremium), premium_currency: PILOT_MONEY.currency,
      covered_amount: new Prisma.Decimal(PILOT_MONEY.sumInsured), covered_currency: PILOT_MONEY.currency,
    },
  });

  await prisma.exchangeRateQuote.create({
    data: {
      exporter_org_id: org.id, base_currency: PILOT_MONEY.currency, quote_currency: 'INR',
      rate: new Prisma.Decimal(PILOT_MONEY.fxRate),
      source: ExchangeRateSource.bank_quoted, source_reference: `QUOTE-${suffix.toUpperCase()}-11`,
      rate_date: new Date('2026-08-12T00:00:00Z'),
    },
  });

  const ownerPrincipal = principalFor(owner.id, UserRole.exporter_owner, org.id);
  await issueInvoiceNumber({ actor: ownerPrincipal, dealId: deal.id, correlationId: corr() });

  // The document checklist, created the way the deal lock creates it.
  const docTypes: DocType[] = [
    DocType.PI, DocType.CI, DocType.packing_list, DocType.shipping_bill_draft,
    DocType.COO_draft, DocType.declaration, DocType.insurance_declaration,
  ];
  const documentIds: Record<string, string> = {};
  for (const docType of docTypes) {
    const row = await prisma.document.create({
      data: {
        deal_id: deal.id, doc_type: docType, version: 1, is_current_version: true,
        source: 'generated', generation_status: GenerationStatus.queued,
        approval_status: docType === DocType.insurance_declaration ? 'not_required' : 'pending',
        filing_status: ([DocType.shipping_bill_draft, DocType.COO_draft, DocType.declaration] as DocType[]).includes(docType)
          ? 'draft' : 'not_applicable',
      },
      select: { id: true },
    });
    documentIds[docType] = row.id;
  }

  if (opts.withExceptions) {
    await prisma.task.create({
      data: {
        scope_type: ScopeType.deal, scope_id: deal.id, deal_id: deal.id, exporter_org_id: org.id,
        title: `Chase B/L release ${suffix}`, state: TaskState.in_progress,
        sla_state: SlaState.escalated, priority: TaskPriority.high, owner_role: UserRole.agent,
      },
    });
    await prisma.dispute.create({
      data: {
        deal_id: deal.id, scope_type: ScopeType.deal, scope_id: deal.id, type: 'quality',
        severity: DisputeSeverity.high, status: DisputeStatus.open,
        summary: `Moisture content disputed on arrival ${suffix}`,
      },
    });
    await prisma.shipment.update({
      where: { id: shipment.id },
      data: { exception_state: ExceptionState.blocked, exception_reason: `Customs hold at discharge ${suffix}` },
    });
  }

  return {
    orgId: org.id, ownerPrincipal, buyerId: buyer.id, productId: product.id,
    dealId: deal.id, shipmentId: shipment.id, documentIds,
  };
}

export interface PilotWorld {
  suffix: string;
  ops: Principal;
  /** The agent under test, assigned to A and B only. */
  agent: Principal;
  /** A second agent, assigned to C only. */
  otherAgent: Principal;
  A: PilotExporter;
  B: PilotExporter;
  C: PilotExporter;
}

/**
 * Build the pilot world.
 *
 * Agent is assigned A and B; otherAgent is assigned C. Every isolation assertion is therefore
 * about a tenant that exists, is populated, and belongs to someone else.
 */
export async function buildPilotWorld(options: { withExceptions?: boolean } = {}): Promise<PilotWorld> {
  const suffix = randomUUID().slice(0, 8);

  const [opsUser, agentUser, otherAgentUser] = await Promise.all([
    prisma.user.create({ data: { email: `ops-${suffix}@pilot.test`, name: 'Pilot Ops', role: UserRole.ops_supervisor }, select: { id: true } }),
    prisma.user.create({ data: { email: `agent-${suffix}@pilot.test`, name: 'Pilot Agent', role: UserRole.agent }, select: { id: true } }),
    prisma.user.create({ data: { email: `agent2-${suffix}@pilot.test`, name: 'Other Agent', role: UserRole.agent }, select: { id: true } }),
  ]);

  const ops = principalFor(opsUser.id, UserRole.ops_supervisor);
  const agent = principalFor(agentUser.id, UserRole.agent);
  const otherAgent = principalFor(otherAgentUser.id, UserRole.agent);

  const A = await buildExporter({ suffix: `a${suffix}`, name: 'Alpha', complete: true, withExceptions: options.withExceptions });
  const B = await buildExporter({ suffix: `b${suffix}`, name: 'Bravo', complete: false });
  const C = await buildExporter({ suffix: `c${suffix}`, name: 'Charlie', complete: true, withExceptions: options.withExceptions });

  await assignExporterToAgent({ actor: ops, agentUserId: agentUser.id, exporterOrgId: A.orgId, correlationId: corr() });
  await assignExporterToAgent({ actor: ops, agentUserId: agentUser.id, exporterOrgId: B.orgId, correlationId: corr() });
  await assignExporterToAgent({ actor: ops, agentUserId: otherAgentUser.id, exporterOrgId: C.orgId, correlationId: corr() });

  return { suffix, ops, agent, otherAgent, A, B, C };
}
