/**
 * Staging pilot data — seed, promote, status, reset.
 *
 * Phase 9 needs three exporters to validate against: one complete enough to reach an approved
 * document, one deliberately missing canonical fields so readiness blocks correctly, and one
 * belonging to a DIFFERENT agent so tenant isolation is tested against a populated tenant
 * rather than an empty one.
 *
 * Everything it creates is labelled `[PILOT]` and uses the reserved `pilot.invalid` email
 * domain (RFC 2606 — can never resolve or collide with a real address), so `reset` can find
 * exactly its own rows and nothing else. There is no "delete everything" path.
 *
 * ENVIRONMENT GATE: refuses to run unless APP_ENV is `staging` or `local`. Production is
 * rejected explicitly rather than merely not matched, so a mis-set variable cannot make this
 * runnable there.
 *
 *   railway run -- npx tsx scripts/staging-pilot.ts status
 *   PILOT_PASSWORD='<choose one>' railway run -- npx tsx scripts/staging-pilot.ts seed
 *   railway run -- npx tsx scripts/staging-pilot.ts promote you@example.com
 *   railway run -- npx tsx scripts/staging-pilot.ts reset
 *
 * Passwords are never printed and never hard-coded: `seed` reads PILOT_PASSWORD from the
 * operator's own shell, so the value stays with whoever ran it.
 */

import {
  DealStage, DisputeSeverity, DisputeStatus, DocType, EvidenceOrigin, ExceptionState,
  ExchangeRateSource, GenerationStatus, InsuranceCaseStatus, OrgTier, Prisma, PrismaClient,
  ScopeType, ShipmentMode, ShipmentStatus, SlaState, TaskPriority, TaskState,
  TransportDocumentType, UserRole,
} from '@prisma/client';
import { hashPassword } from '../src/lib/auth';

const prisma = new PrismaClient();

const LABEL = '[PILOT]';
/** RFC 2606 reserved TLD: unroutable, and unmistakably not a real person. */
const DOMAIN = 'pilot.invalid';
const isPilotEmail = { contains: `@${DOMAIN}` };

function assertSafeEnvironment() {
  const env = process.env.APP_ENV ?? 'local';
  if (env === 'production' || process.env.DATABASE_ENVIRONMENT === 'production') {
    throw new Error('staging-pilot refuses to run against production.');
  }
  if (env !== 'staging' && env !== 'local') {
    throw new Error(`staging-pilot expects APP_ENV=staging or local, found "${env}".`);
  }
  return env;
}

/** Money chosen to exercise the Phase 8.1 policy: 1250 x 1.2345 = 1543.125 -> USD 1,543.13. */
const MONEY = {
  quantity: '1250', unitPrice: '1.2345', total: '1543.1250', currency: 'USD',
  freight: '212.50', premium: '38.75', covered: '1697.44', fxRate: '88.42537500',
};

interface SeedSpec {
  key: 'A' | 'B' | 'C';
  name: string;
  /** B omits one exporter field, one buyer field and one shipment field. */
  complete: boolean;
}

async function seedExporter(spec: SeedSpec, passwordHash: string) {
  const slug = spec.key.toLowerCase();

  const org = await prisma.exporterOrg.create({
    data: {
      display_name: `${LABEL} ${spec.name}`,
      legal_name: `${spec.name} Exports Private Limited`,
      tier: OrgTier.paid, country: 'IN', state: 'Maharashtra', city: 'Mumbai',
      address_line1: '12 Dock Road, Ballard Estate', postal_code: '400001',
      iec_number: `IEC${slug.toUpperCase()}0099001`, gstin: '27AAAAA0000A1Z5',
      // Exporter B's exporter-level gap: no AD code, which blocks only the shipping bill.
      ...(spec.complete ? { ad_code: '6390004' } : {}),
    },
    select: { id: true },
  });

  const owner = await prisma.user.create({
    data: {
      email: `exporter-${slug}@${DOMAIN}`, name: `${LABEL} ${spec.name} Owner`,
      role: UserRole.exporter_owner, exporter_org_id: org.id, password_hash: passwordHash,
    },
    select: { id: true, email: true },
  });

  const product = await prisma.product.create({
    data: {
      exporter_org_id: org.id, name: `${LABEL} Basmati rice 1121`,
      description: 'Basmati rice, 1121 steam, 2% broken, jute bags',
      hs_code: '100630', itc_hs_code: '10063020', hs_code_source: 'user_confirmed',
      evidence_origin: EvidenceOrigin.manually_entered_real,
    },
    select: { id: true },
  });

  const buyer = await prisma.buyer.create({
    data: {
      legal_name: `${LABEL} Nordwind Handels GmbH ${spec.key}`,
      display_name: `${LABEL} Nordwind ${spec.key}`,
      country_code: 'DE', buyer_type: 'importer',
    },
    select: { id: true },
  });

  await prisma.buyerCommercialProfile.create({
    data: {
      exporter_org_id: org.id, buyer_id: buyer.id,
      address_line1: 'Hafenstrasse 4',
      // Exporter B's buyer-level gap: no city, so every document needing a buyer address blocks.
      ...(spec.complete ? { city: 'Hamburg', postal_code: '20457' } : {}),
      country_code: 'DE', tax_identifier: 'DE811234567', tax_identifier_type: 'VAT',
    },
  });

  const deal = await prisma.deal.create({
    data: {
      exporter_org_id: org.id, buyer_id: buyer.id, product_id: product.id,
      stage: DealStage.executing, incoterm: 'FOB', incoterm_place: 'Nhava Sheva',
      quantity: new Prisma.Decimal(MONEY.quantity), unit: 'kg',
      unit_price_amount: new Prisma.Decimal(MONEY.unitPrice), unit_price_currency: MONEY.currency,
      total_amount: new Prisma.Decimal(MONEY.total), total_currency: MONEY.currency,
      payment_terms: { kind: 'advance', label: 'Advance' },
      buyer_reference: `PO-${spec.key}-4471`,
    },
    select: { id: true },
  });

  const shipment = await prisma.shipment.create({
    data: {
      deal_id: deal.id, status: ShipmentStatus.booking, mode: ShipmentMode.sea, incoterm: 'FOB',
      port_of_loading_name: 'Nhava Sheva', port_of_loading_unlocode: 'INNSA', port_of_loading_country: 'IN',
      // Exporter B's shipment-level gap: no discharge port.
      ...(spec.complete
        ? { port_of_discharge_name: 'Hamburg', port_of_discharge_unlocode: 'DEHAM', port_of_discharge_country: 'DE' }
        : {}),
      final_destination_country: 'DE', marks_and_numbers: `${spec.name.toUpperCase()}/HAM/1-50`,
      transport_document_type: TransportDocumentType.bill_of_lading,
      transport_document_no: `BL-${spec.key}-77120`,
      vessel_or_flight_no: 'MV Concord Trader', voyage_no: '024W',
      container_no: 'MSCU1234567', container_type: "40'HC", seal_no: 'SL889120',
      shipped_on_date: new Date('2026-08-14T00:00:00Z'),
      freight_amount: new Prisma.Decimal(MONEY.freight), freight_currency: MONEY.currency,
    },
    select: { id: true },
  });

  // 50 lines so the packing-list PDF genuinely paginates.
  await prisma.shipmentPackage.createMany({
    data: Array.from({ length: 50 }, (_, i) => ({
      shipment_id: shipment.id, sequence: i + 1, package_type: 'jute bag', package_count: 1,
      net_weight_kg: new Prisma.Decimal('25.000'), gross_weight_kg: new Prisma.Decimal('25.400'),
      volume_cbm: new Prisma.Decimal('0.0350'),
      contents_description: `Bag ${i + 1} of 50 - Basmati 1121 steam, lot ${4000 + i}`,
    })),
  });

  await prisma.insuranceCase.create({
    data: {
      deal_id: deal.id, status: InsuranceCaseStatus.bound,
      provider_name: 'Oriental Insurance', policy_ref: `POL-${spec.key}-8891`,
      premium_amount: new Prisma.Decimal(MONEY.premium), premium_currency: MONEY.currency,
      covered_amount: new Prisma.Decimal(MONEY.covered), covered_currency: MONEY.currency,
    },
  });

  await prisma.exchangeRateQuote.create({
    data: {
      exporter_org_id: org.id, base_currency: MONEY.currency, quote_currency: 'INR',
      rate: new Prisma.Decimal(MONEY.fxRate), source: ExchangeRateSource.bank_quoted,
      source_reference: `QUOTE-${spec.key}-11`, rate_date: new Date('2026-08-12T00:00:00Z'),
    },
  });

  // The document checklist, in the shape deal lock produces.
  for (const docType of [
    DocType.PI, DocType.CI, DocType.packing_list, DocType.shipping_bill_draft,
    DocType.COO_draft, DocType.declaration, DocType.insurance_declaration,
  ]) {
    await prisma.document.create({
      data: {
        deal_id: deal.id, doc_type: docType, version: 1, is_current_version: true,
        source: 'generated', generation_status: GenerationStatus.queued,
        approval_status: docType === DocType.insurance_declaration ? 'not_required' : 'pending',
        filing_status: ([DocType.shipping_bill_draft, DocType.COO_draft, DocType.declaration] as DocType[])
          .includes(docType) ? 'draft' : 'not_applicable',
      },
    });
  }

  // Escalation sources, so /agent/escalations has something real to aggregate.
  await prisma.task.create({
    data: {
      scope_type: ScopeType.deal, scope_id: deal.id, deal_id: deal.id, exporter_org_id: org.id,
      title: `${LABEL} Chase B/L release`, state: TaskState.in_progress,
      sla_state: SlaState.escalated, priority: TaskPriority.high, owner_role: UserRole.agent,
    },
  });
  await prisma.dispute.create({
    data: {
      deal_id: deal.id, scope_type: ScopeType.deal, scope_id: deal.id, type: 'quality',
      severity: DisputeSeverity.high, status: DisputeStatus.open,
      summary: `${LABEL} Moisture content disputed on arrival`,
    },
  });
  await prisma.shipment.update({
    where: { id: shipment.id },
    data: { exception_state: ExceptionState.blocked, exception_reason: `${LABEL} Customs hold at discharge` },
  });

  return { orgId: org.id, ownerEmail: owner.email, dealId: deal.id };
}

async function seed() {
  const env = assertSafeEnvironment();
  const password = process.env.PILOT_PASSWORD;
  if (!password || password.length < 10) {
    throw new Error('Set PILOT_PASSWORD (10+ chars) in your own shell before seeding. It is never printed.');
  }

  const existing = await prisma.user.count({ where: { email: isPilotEmail } });
  if (existing > 0) {
    throw new Error(`${existing} pilot user(s) already exist. Run "reset" first if you want a clean pilot.`);
  }

  const passwordHash = await hashPassword(password);

  const a = await seedExporter({ key: 'A', name: 'Alpha', complete: true }, passwordHash);
  const b = await seedExporter({ key: 'B', name: 'Bravo', complete: false }, passwordHash);
  const c = await seedExporter({ key: 'C', name: 'Charlie', complete: true }, passwordHash);

  // Exporter C is assigned to a DIFFERENT agent, so isolation is testable against a populated
  // tenant. Agent A is deliberately NOT created here — you create that one through the real
  // staff-invitation flow during UAT, which is the thing being tested.
  const agentC = await prisma.user.create({
    data: {
      email: `agent-c@${DOMAIN}`, name: `${LABEL} Agent C`,
      role: UserRole.agent, password_hash: passwordHash,
    },
    select: { id: true },
  });
  await prisma.agentAssignment.create({
    data: { agent_user_id: agentC.id, exporter_org_id: c.orgId, status: 'active', assigned_by_id: agentC.id },
  });

  console.log(`environment            ${env}`);
  console.log(`exporter A (complete)  ${a.ownerEmail}   org=${a.orgId}  deal=${a.dealId}`);
  console.log(`exporter B (blocked)   ${b.ownerEmail}   org=${b.orgId}  deal=${b.dealId}`);
  console.log(`exporter C (isolation) ${c.ownerEmail}   org=${c.orgId}  deal=${c.dealId}`);
  console.log(`agent for C            agent-c@${DOMAIN}`);
  console.log('password               (the PILOT_PASSWORD you supplied - not printed)');
}

/** Elevate ONE existing, named user to admin. Never creates an account. */
async function promote(email: string) {
  const env = assertSafeEnvironment();
  if (!email) throw new Error('Usage: promote <email>');

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, email: true, role: true, exporter_org_id: true },
  });
  if (!user) {
    throw new Error(`No user "${email}" exists in the ${env} database. Sign in through the staging UI first, then re-run.`);
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      role: UserRole.admin,
      // Detached from any tenant, deliberately. `getPrincipal` derives tier as
      // `exporter_org?.tier ?? paid` precisely so that "staff have no tenant and are governed
      // by the role matrix alone" — leaving a sign-up's auto-created free-tier org attached
      // would make this admin read as FREE tier and hit paid-gated capabilities. Clearing it
      // is also what the account would have looked like had it come from a staff invitation.
      exporter_org_id: null,
    },
    select: { email: true, role: true, exporter_org_id: true },
  });

  console.log(`promoted   ${updated.email}`);
  console.log(`role       ${user.role} -> ${updated.role}`);
  console.log(`org        ${user.exporter_org_id ?? '(none)'} -> ${updated.exporter_org_id ?? '(none, reads as paid tier)'}`);
}

async function status() {
  const env = assertSafeEnvironment();
  const [users, orgs, deals, docs, artifacts, assignments, invitations] = await Promise.all([
    prisma.user.count({ where: { email: isPilotEmail } }),
    prisma.exporterOrg.count({ where: { display_name: { startsWith: LABEL } } }),
    prisma.deal.count(),
    prisma.document.count(),
    prisma.documentArtifact.count(),
    prisma.agentAssignment.count(),
    prisma.staffInvitation.count(),
  ]);
  const byRole = await prisma.user.groupBy({ by: ['role'], _count: { _all: true } });

  console.log(`environment        ${env}`);
  console.log(`pilot users        ${users}`);
  console.log(`pilot orgs         ${orgs}`);
  console.log(`deals (all)        ${deals}`);
  console.log(`documents (all)    ${docs}`);
  console.log(`artifacts (all)    ${artifacts}`);
  console.log(`assignments (all)  ${assignments}`);
  console.log(`staff invitations  ${invitations}`);
  console.log(`users by role      ${JSON.stringify(byRole.map((r) => [r.role, r._count._all]))}`);
}

/**
 * Remove pilot data only.
 *
 * Scoped by the `[PILOT]` label and the reserved email domain, so anything else in staging is
 * untouched. Deletion order matters and is NOT "children before parents" in the usual sense —
 * `ExporterOrg` cascades to nearly everything scoped under it (Product, Deal and everything
 * hanging off Deal, BuyerLead, AgentDecision, ReadinessAssessment, Invitation,
 * BuyerCommercialProfile, ExchangeRateQuote, DocumentInputSnapshot, InvoiceSeries), so deleting
 * the org is usually the ONE step that clears the most ground. What it does NOT clear is
 * exactly what broke the first version of this function:
 *
 *   - `AuditEvent.actor_user_id` carries no FK relation to ExporterOrg at all — the column is
 *     explicitly denormalized (see the schema comment on it) — so org deletion never touches it;
 *   - `StaffInvitation.{invited_by_id,revoked_by_id,accepted_user_id}` reference User directly,
 *     unscoped by org;
 *   - `User.exporter_org_id` is the OWNER's own outbound FK to the org. Deleting the org while
 *     that field is still set fails exactly like deleting a user while `AgentAssignment` still
 *     pointed at them — same shape of bug, different table;
 *   - `AgentAssignment.{agent_user_id,assigned_by_id}` reference User directly. The org-side
 *     cascade removes an org-scoped assignment row as a side effect of deleting the org, but an
 *     explicit delete here is what actually fixes the reported failure, and covers the case
 *     (not present in this fixture, but not impossible) of a pilot agent assigned to a
 *     non-pilot org.
 *
 * All in one transaction: a reset that fails partway must not leave a half-deleted pilot
 * dataset that then makes a re-run's `seed` guard ("pilot users already exist") true for data
 * you can no longer see, or false for data you still can.
 *
 * Idempotent: an empty pilot (already reset, or never seeded) matches zero rows at every step
 * and reports zero counts rather than erroring.
 */
async function reset() {
  const env = assertSafeEnvironment();

  const [orgs, users] = await Promise.all([
    prisma.exporterOrg.findMany({ where: { display_name: { startsWith: LABEL } }, select: { id: true } }),
    prisma.user.findMany({ where: { email: isPilotEmail }, select: { id: true } }),
  ]);
  const orgIds = orgs.map((o) => o.id);
  const userIds = users.map((u) => u.id);

  // Issued invoice numbers are protected by a no-delete trigger, so a pilot org cannot be
  // removed while it holds any — the cascade would hit the trigger and the whole transaction
  // would abort. Checked and refused BEFORE the transaction opens, so a doomed reset never
  // starts rather than rolling back after doing the (cheap, safe) discovery work above.
  const issued = orgIds.length
    ? await prisma.issuedInvoiceNumber.count({ where: { exporter_org_id: { in: orgIds } } })
    : 0;
  if (issued > 0) {
    console.log(`refusing: ${issued} issued invoice number(s) exist and are append-only by design.`);
    console.log('Create a fresh pilot with different labels instead of deleting issued numbers.');
    return;
  }

  if (orgIds.length === 0 && userIds.length === 0) {
    console.log(`environment      ${env}`);
    console.log('nothing to reset — no pilot orgs or pilot users found.');
    return;
  }

  const [
    orgAgentFieldCleared, ownerOrgFieldCleared, deletedAudit, deletedInvites,
    deletedAssignments, deletedOrgs, deletedBuyers, deletedUsers,
  ] = await prisma.$transaction([
    // Defensive: a non-pilot org's `assigned_agent_id` pointing at a pilot agent would block
    // deleting that USER later. Not expected from this fixture's own flows, but nulling a
    // nullable field is free and closes the gap rather than assuming it can't happen.
    prisma.exporterOrg.updateMany({
      where: { assigned_agent_id: { in: userIds } },
      data: { assigned_agent_id: null },
    }),
    // The pilot OWNERS' own outbound FK to their org. Must be cleared before the org can be
    // deleted — the org has no cascade path back through this field, only forward through it.
    prisma.user.updateMany({
      where: { id: { in: userIds }, exporter_org_id: { in: orgIds } },
      data: { exporter_org_id: null },
    }),
    // Audit rows survive independent of their subject by design (an audit trail that vanished
    // with the account it recorded would defeat the point), so they are never cascade-deleted
    // and must be cleared explicitly. Scoped by actor OR by the denormalized org id, since a
    // real UAT session writes both kinds.
    prisma.auditEvent.deleteMany({
      where: { OR: [{ actor_user_id: { in: userIds } }, { exporter_org_id: { in: orgIds } }] },
    }),
    prisma.staffInvitation.deleteMany({
      where: {
        OR: [
          { email: isPilotEmail },
          { invited_by_id: { in: userIds } },
          { revoked_by_id: { in: userIds } },
          { accepted_user_id: { in: userIds } },
        ],
      },
    }),
    prisma.agentAssignment.deleteMany({
      where: { OR: [{ agent_user_id: { in: userIds } }, { assigned_by_id: { in: userIds } }] },
    }),
    // Cascades away everything genuinely scoped to the org — see the function comment above
    // for the full list. This is deliberately AFTER the explicit deletes above, not before:
    // those clear the references org-deletion cannot reach. `in: []` matches zero rows when
    // there are no pilot orgs, so this needs no separate empty-array guard.
    prisma.exporterOrg.deleteMany({ where: { id: { in: orgIds } } }),
    // Buyer is global and carries no tenant FK (Phase 6's architectural guard), so it is
    // never touched by the org cascade and is removed on its own, by label, once nothing
    // scoped to a pilot org still points at it.
    prisma.buyer.deleteMany({ where: { display_name: { startsWith: LABEL } } }),
    // Last: every inbound reference that could block a User row has been cleared or deleted
    // above, in dependency order.
    prisma.user.deleteMany({ where: { email: isPilotEmail } }),
  ]);

  console.log(`environment          ${env}`);
  console.log(`org agent refs cleared   ${orgAgentFieldCleared.count}`);
  console.log(`owner org refs cleared   ${ownerOrgFieldCleared.count}`);
  console.log(`audit events removed     ${deletedAudit.count}`);
  console.log(`invites removed          ${deletedInvites.count}`);
  console.log(`assignments removed      ${deletedAssignments.count}`);
  console.log(`orgs removed             ${deletedOrgs.count}`);
  console.log(`buyers removed           ${deletedBuyers.count}`);
  console.log(`users removed            ${deletedUsers.count}`);
}

async function main() {
  const [command, argument] = process.argv.slice(2);
  switch (command) {
    case 'seed': return seed();
    case 'promote': return promote(argument ?? '');
    case 'status': return status();
    case 'reset': return reset();
    default:
      console.log('Usage: staging-pilot.ts <seed|promote <email>|status|reset>');
      process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
