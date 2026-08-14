/**
 * Local/dev seed data for the BuyerLead vertical slice (AGENTS.md "build order").
 *
 * Every seeded row gets a deterministic id so this script is safe to re-run: it
 * upserts rather than piling up duplicates on a second `npm run db:seed`.
 *
 * Passwords are hashed with `hashPassword()` from src/lib/auth.ts — the same bcrypt
 * helper the credentials provider verifies against — so these accounts can actually
 * sign in through the real login flow, not just exist as rows.
 */

import {
  CommitmentFeeStatus,
  DealStage,
  IecStatus,
  JourneyStage,
  OrgTier,
  ProposalStatus,
  ReadinessStatus,
  RiskState,
  TaskPriority,
  TaskState,
  UserRole,
  VerificationStatus,
  Visibility,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { hashPassword } from '@/lib/auth';
import { renderDocumentText } from '@/lib/document-generation';
import { prisma } from '@/lib/prisma';

const SEED_PASSWORD = 'Password123!';

async function main() {
  const password_hash = await hashPassword(SEED_PASSWORD);

  // ---------------------------------------------------------------------------
  // ExporterOrg — ready + IEC verified, so this org can reach deal_locked
  // (docs/07 §7.2 requires a verified IEC as a lock prerequisite).
  // ---------------------------------------------------------------------------
  const org = await prisma.exporterOrg.upsert({
    where: { id: 'seed-org-1' },
    // `tier` is set on BOTH branches on purpose. ExporterOrg.tier defaults to `guest`,
    // so without it on `create` a fresh database would seed the whole fixture as a guest
    // org and every paid-tier verification would fail; without it on `update` an existing
    // database that drifted would never be corrected.
    update: {
      tier: OrgTier.paid,
      commitment_fee_status: CommitmentFeeStatus.paid,
      commitment_fee_amount: 15000,
      commitment_fee_currency: 'INR',
      commitment_fee_policy_version: 1,
    },
    create: {
      id: 'seed-org-1',
      legal_name: 'Sunrise Agro Exports Pvt Ltd',
      display_name: 'Sunrise Agro Exports',
      gstin: '27AAAPL1234C1Z5',
      iec: IecStatus.verified,
      iec_number: 'IEC0912345678',
      country: 'IN',
      state: 'Maharashtra',
      city: 'Nashik',
      readiness_status: ReadinessStatus.ready,
      journey_stage: JourneyStage.ready,
      tier: OrgTier.paid,
      // Mirrors the migration backfill for pre-existing paid orgs: grandfathered, not a
      // real self-reported/bank-confirmed payment. Amount/currency match the FeePolicy
      // v1 fixture below ('15000.00' INR) — hardcoded here for the same reason
      // `lockedFeePolicySnapshot` further down hardcodes it: this is seed data mirroring
      // a specific fixture version, not application logic reading it live.
      commitment_fee_status: CommitmentFeeStatus.paid,
      commitment_fee_amount: 15000,
      commitment_fee_currency: 'INR',
      commitment_fee_policy_version: 1,
      commitment_fee_source: 'manual_ops',
      commitment_fee_due_at: new Date('2026-01-01T00:00:00Z'),
      commitment_fee_paid_at: new Date('2026-01-01T00:00:00Z'),
    },
  });

  // ---------------------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------------------
  const owner = await prisma.user.upsert({
    where: { email: 'owner@sunriseagro.example' },
    update: {},
    create: {
      id: 'seed-user-owner',
      email: 'owner@sunriseagro.example',
      name: 'Priya Deshmukh',
      password_hash,
      role: UserRole.exporter_owner,
      exporter_org_id: org.id,
    },
  });

  // EXP-17-AC03 needs a real exporter_member principal to verify against — "Org member
  // role is enforced server-side" is untestable without a member who isn't the owner.
  const member = await prisma.user.upsert({
    where: { email: 'member@sunriseagro.example' },
    update: {},
    create: {
      id: 'seed-user-member',
      email: 'member@sunriseagro.example',
      name: 'Arjun Nair',
      password_hash,
      role: UserRole.exporter_member,
      exporter_org_id: org.id,
    },
  });

  const agent = await prisma.user.upsert({
    where: { email: 'agent@cleartrade.example' },
    update: {},
    create: {
      id: 'seed-user-agent',
      email: 'agent@cleartrade.example',
      name: 'Rahul Menon',
      password_hash,
      role: UserRole.agent,
    },
  });

  const opsSupervisor = await prisma.user.upsert({
    where: { email: 'ops@cleartrade.example' },
    update: {},
    create: {
      id: 'seed-user-ops',
      email: 'ops@cleartrade.example',
      name: 'Ananya Iyer',
      password_hash,
      role: UserRole.ops_supervisor,
    },
  });

  // Distinct from ops_supervisor: /ops/finance and fee-policy edits are ops_finance/admin
  // only (docs/06 OPS-05). Without this fixture, /ops/finance can never be exercised by a
  // logged-in session — a supervisor gets AccessDenied there — so verification scripts
  // either skip the page or silently measure the wrong thing.
  const opsFinance = await prisma.user.upsert({
    where: { email: 'finance@cleartrade.example' },
    update: {},
    create: {
      id: 'seed-user-ops-finance',
      email: 'finance@cleartrade.example',
      name: 'Karan Bhatt',
      password_hash,
      role: UserRole.ops_finance,
    },
  });

  // OPS-07's config registry and partner directory writes are Admin-only. Without this
  // fixture there is no loggable-in `admin` session in the whole seed, so those write
  // paths — and `fee_policy.edit`'s admin grant — can never be exercised end to end.
  const admin = await prisma.user.upsert({
    where: { email: 'admin@cleartrade.example' },
    update: {},
    create: {
      id: 'seed-user-admin',
      email: 'admin@cleartrade.example',
      name: 'Devika Shah',
      password_hash,
      role: UserRole.admin,
    },
  });

  // Denormalized default agent on the org, plus the AgentAssignment row that
  // src/lib/permissions.ts `assignedOrgIds()` actually reads for tenant scoping.
  await prisma.exporterOrg.update({
    where: { id: org.id },
    data: { assigned_agent_id: agent.id },
  });

  await prisma.agentAssignment.upsert({
    where: { id: 'seed-assignment-1' },
    update: { status: 'active', ended_at: null },
    create: {
      id: 'seed-assignment-1',
      exporter_org_id: org.id,
      agent_user_id: agent.id,
      assigned_by_id: opsSupervisor.id,
      status: 'active',
    },
  });

  // ---------------------------------------------------------------------------
  // Products
  // ---------------------------------------------------------------------------
  const turmeric = await prisma.product.upsert({
    where: { id: 'seed-product-turmeric' },
    update: {},
    create: {
      id: 'seed-product-turmeric',
      exporter_org_id: org.id,
      name: 'Organic Turmeric Powder',
      description: 'Single-origin turmeric powder, steam-sterilized, curcumin content 3-5%.',
      hs_code: '09103030',
      hs_code_source: 'user_confirmed',
      capacity_value: 5000,
      capacity_unit: 'kg/month',
      moq_value: 500,
      moq_unit: 'kg',
      price_target_amount: 3.5,
      price_target_currency: 'USD',
      packaging: '25kg multi-layer PP bags on pallets',
    },
  });

  const bedsheets = await prisma.product.upsert({
    where: { id: 'seed-product-bedsheets' },
    update: {},
    create: {
      id: 'seed-product-bedsheets',
      exporter_org_id: org.id,
      name: 'Cotton Bedsheet Sets — King Size',
      description: '100% cotton, 300 thread count, king-size fitted + flat + 2 pillow covers.',
      hs_code: '63022100',
      hs_code_source: 'user_confirmed',
      capacity_value: 2000,
      capacity_unit: 'sets/month',
      moq_value: 100,
      moq_unit: 'sets',
      price_target_amount: 18,
      price_target_currency: 'USD',
      packaging: 'Poly bag, 6 sets per export carton',
    },
  });

  // ---------------------------------------------------------------------------
  // Buyers — varied verification_status; "Rapid Import Partners" carries a risk flag.
  // ---------------------------------------------------------------------------
  const buyers = await Promise.all([
    prisma.buyer.upsert({
      where: { id: 'seed-buyer-1' },
      update: {},
      create: {
        id: 'seed-buyer-1',
        legal_name: 'Spice Trading Co. LLC',
        display_name: 'Spice Trading Co.',
        country_code: 'US',
        website: 'https://spicetradingco.example',
        buyer_type: 'importer',
        import_activity_summary: { shipments_last_12mo: 42, top_origin_countries: ['IN', 'VN', 'LK'] },
        verification_status: VerificationStatus.verified,
        risk_flags: [],
        last_activity_at: new Date('2026-07-28T00:00:00Z'),
      },
    }),
    prisma.buyer.upsert({
      where: { id: 'seed-buyer-2' },
      update: {},
      create: {
        id: 'seed-buyer-2',
        legal_name: 'Global Textiles Ltd',
        display_name: 'Global Textiles',
        country_code: 'GB',
        website: 'https://globaltextiles.example',
        buyer_type: 'wholesaler',
        import_activity_summary: { shipments_last_12mo: 15, top_origin_countries: ['IN', 'PK', 'BD'] },
        verification_status: VerificationStatus.partially_verified,
        risk_flags: [],
        last_activity_at: new Date('2026-07-15T00:00:00Z'),
      },
    }),
    prisma.buyer.upsert({
      where: { id: 'seed-buyer-3' },
      update: {},
      create: {
        id: 'seed-buyer-3',
        legal_name: 'Gulf Foods General Trading LLC',
        display_name: 'Gulf Foods General Trading',
        country_code: 'AE',
        website: 'https://gulffoodstrading.example',
        buyer_type: 'distributor',
        import_activity_summary: { shipments_last_12mo: 61, top_origin_countries: ['IN', 'EG', 'TR'] },
        verification_status: VerificationStatus.verified,
        risk_flags: [],
        last_activity_at: new Date('2026-08-01T00:00:00Z'),
      },
    }),
    prisma.buyer.upsert({
      where: { id: 'seed-buyer-4' },
      update: {},
      create: {
        id: 'seed-buyer-4',
        legal_name: 'EuroHome Living GmbH',
        display_name: 'EuroHome Living',
        country_code: 'DE',
        website: 'https://eurohomeliving.example',
        buyer_type: 'retail_chain',
        import_activity_summary: { shipments_last_12mo: 3, top_origin_countries: ['IN', 'CN'] },
        verification_status: VerificationStatus.unverified,
        risk_flags: [],
        last_activity_at: new Date('2026-05-10T00:00:00Z'),
      },
    }),
    prisma.buyer.upsert({
      where: { id: 'seed-buyer-5' },
      update: {},
      create: {
        id: 'seed-buyer-5',
        legal_name: 'Rapid Import Partners Inc',
        display_name: 'Rapid Import Partners',
        country_code: 'US',
        website: 'https://rapidimportpartners.example',
        buyer_type: 'importer',
        import_activity_summary: { shipments_last_12mo: 8, top_origin_countries: ['IN'] },
        verification_status: VerificationStatus.unverified,
        risk_flags: [
          {
            code: 'payment_history',
            severity: 'high',
            summary: 'A prior exporter reported a payment dispute with this buyer in the last 12 months.',
          },
        ],
        last_activity_at: new Date('2026-06-02T00:00:00Z'),
      },
    }),
  ]);

  // ---------------------------------------------------------------------------
  // Deals — EXP-08/EXP-09 have no data to render without these. One locked (so the
  // workspace's "terms are frozen, read-only" state and the risk banner have something
  // real to show) and one negotiating (so the pipeline differentiates active stages,
  // EXP-08-AC01). `upsert` by fixed id, same as every other fixture in this file.
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // FeePolicy — a hard prerequisite for deal lock, and it was missing entirely.
  //
  // `collectDealLockBlockers()` refuses to lock without an active policy ("No active fee
  // policy is configured, so the deal's fee terms cannot be frozen") because docs/01 §2
  // forbids falling back to a hardcoded constant for anything commercial. `getFeePolicy()`
  // likewise throws rather than inventing one. Until now nothing exercised that path, so
  // the gap was invisible; the lock flow cannot work at all without this row.
  // ---------------------------------------------------------------------------
  await prisma.feePolicy.upsert({
    where: { version: 1 },
    update: { is_active: true },
    create: {
      id: 'seed-fee-policy-v1',
      version: 1,
      commitment_fee_amount: 15000,
      commitment_fee_currency: 'INR',
      commitment_fee_status: CommitmentFeeStatus.paid,
      success_fee_rate: 0.025,
      small_shipment_threshold_amount: 500000,
      small_shipment_threshold_currency: 'INR',
      small_shipment_rate: 0.035,
      small_shipment_flat_amount: 20000,
      agent_share_rate: 0.4,
      minimum_shipment_amount: 100000,
      minimum_shipment_currency: 'INR',
      is_active: true,
      effective_from: new Date('2026-01-01T00:00:00Z'),
    },
  });

  const lockedFeePolicySnapshot = {
    version: 1,
    commitment_fee_amount: '15000.00',
    commitment_fee_currency: 'INR',
    commitment_fee_status: 'paid',
    success_fee_rate: '0.0250',
    agent_share_rate: '0.4000',
  };

  const lockedDeal = await prisma.deal.upsert({
    where: { id: 'seed-deal-locked' },
    update: {},
    create: {
      id: 'seed-deal-locked',
      exporter_org_id: org.id,
      buyer_id: 'seed-buyer-3', // Gulf Foods General Trading (AE) — verified
      product_id: turmeric.id,
      stage: DealStage.deal_locked,
      value_amount: 42000,
      value_currency: 'USD',
      quantity: 12000,
      unit: 'kg',
      unit_price_amount: 3.5,
      unit_price_currency: 'USD',
      total_amount: 42000,
      total_currency: 'USD',
      incoterm: 'FOB',
      incoterm_place: 'Nhava Sheva',
      payment_terms: { type: 'LC', description: '30% advance, 70% against BL via irrevocable LC at sight' },
      delivery_terms: {
        ship_window_start: '2026-08-25',
        ship_window_end: '2026-09-05',
        notes: 'Buyer requires pre-shipment sample approval.',
      },
      // Locked but blocked — exercises AC04 (risk banner must persist across every tab)
      // with a reason that is actually plausible for a deal already past lock.
      risk_state: RiskState.blocked,
      risk_reason: 'Buyer requested a change to payment terms after lock — pending Ops review before shipment documents proceed.',
      owner_agent_id: agent.id,
      quoted_fee_policy: lockedFeePolicySnapshot,
      locked_at: new Date('2026-07-20T10:00:00Z'),
    },
  });

  const lockedSnapshot = await prisma.dealSnapshot.upsert({
    where: { deal_id_version: { deal_id: lockedDeal.id, version: 1 } },
    update: {},
    create: {
      deal_id: lockedDeal.id,
      version: 1,
      buyer_id: 'seed-buyer-3',
      buyer_legal_name: 'Gulf Foods General Trading LLC',
      product_id: turmeric.id,
      product_name: turmeric.name,
      sku: null,
      quantity: 12000,
      unit: 'kg',
      unit_price_amount: 3.5,
      unit_price_currency: 'USD',
      total_amount: 42000,
      total_currency: 'USD',
      incoterm: 'FOB',
      incoterm_place: 'Nhava Sheva',
      payment_terms: { type: 'LC', description: '30% advance, 70% against BL via irrevocable LC at sight' },
      ship_window_start: new Date('2026-08-25T00:00:00Z'),
      ship_window_end: new Date('2026-09-05T00:00:00Z'),
      special_conditions: 'Buyer requires pre-shipment sample approval.',
      fee_policy: lockedFeePolicySnapshot,
      created_by_id: agent.id,
      created_at: new Date('2026-07-20T10:00:00Z'),
    },
  });

  // ---------------------------------------------------------------------------
  // Document checklist for the locked deal (EXP-12/EXP-13). Deliberately varied so
  // every required UI state has a real row behind it: generated+approved, awaiting
  // approval, not yet generated, filed (read-only), changes-requested, failed, and a
  // superseded prior version. Checksums are computed with the SAME deterministic
  // renderer the download route uses, so "approved_checksum matches the current
  // checksum" is genuinely true for this fixture, not just asserted.
  //
  // renderDocumentText() takes the exact snapshot shape DocumentGenerationInput
  // expects — mirrored here rather than imported as a type to keep this seed script
  // decoupled from route-layer types (AGENTS.md folder contract: prisma/ imports only
  // what it needs, not the whole app).
  // ---------------------------------------------------------------------------
  const lockedSnapshotForRender = {
    buyer_legal_name: lockedSnapshot.buyer_legal_name,
    product_name: lockedSnapshot.product_name,
    sku: lockedSnapshot.sku,
    quantity: lockedSnapshot.quantity?.toString() ?? null,
    unit: lockedSnapshot.unit,
    unit_price_amount: lockedSnapshot.unit_price_amount?.toString() ?? null,
    unit_price_currency: lockedSnapshot.unit_price_currency,
    total_amount: lockedSnapshot.total_amount?.toString() ?? null,
    total_currency: lockedSnapshot.total_currency,
    incoterm: lockedSnapshot.incoterm,
    incoterm_place: lockedSnapshot.incoterm_place,
    payment_terms: lockedSnapshot.payment_terms,
    ship_window_start: lockedSnapshot.ship_window_start,
    ship_window_end: lockedSnapshot.ship_window_end,
    special_conditions: lockedSnapshot.special_conditions,
  };

  function renderedChecksum(docType: string, version: number): { content: string; checksum: string; size: number } {
    const content = renderDocumentText({ doc_type: docType, deal_id: lockedDeal.id, version, snapshot: lockedSnapshotForRender });
    return { content, checksum: createHash('sha256').update(content).digest('hex'), size: Buffer.byteLength(content, 'utf8') };
  }

  // PI — generated, reviewed, exporter-approved. The clean "everything went right" row.
  const piRender = renderedChecksum('PI', 1);
  await prisma.document.upsert({
    where: { deal_id_doc_type_version: { deal_id: lockedDeal.id, doc_type: 'PI', version: 1 } },
    update: {},
    create: {
      deal_id: lockedDeal.id,
      doc_type: 'PI',
      version: 1,
      is_current_version: true,
      source: 'generated',
      generated_from_snapshot_id: lockedSnapshot.id,
      generation_status: 'generated',
      review_status: 'agent_reviewed',
      reviewed_by_id: agent.id,
      reviewed_at: new Date('2026-07-20T12:00:00Z'),
      approval_status: 'exporter_approved',
      approved_by_id: owner.id,
      approved_at: new Date('2026-07-20T15:00:00Z'),
      approved_version: 1,
      approved_checksum: piRender.checksum,
      filing_status: 'not_applicable',
      file_ref: `generated://seed-doc-pi/v1`,
      file_name: 'PI_v1.txt',
      mime_type: 'text/plain',
      file_size_bytes: piRender.size,
      checksum: piRender.checksum,
    },
  });

  // CI — v1 generated+approved, then superseded by a fresh v2 the agent hasn't
  // generated yet. Exercises version history AND "cannot approve a superseded version."
  const ciV1Render = renderedChecksum('CI', 1);
  await prisma.document.upsert({
    where: { deal_id_doc_type_version: { deal_id: lockedDeal.id, doc_type: 'CI', version: 1 } },
    update: {},
    create: {
      deal_id: lockedDeal.id,
      doc_type: 'CI',
      version: 1,
      is_current_version: false,
      source: 'generated',
      generated_from_snapshot_id: lockedSnapshot.id,
      generation_status: 'generated',
      review_status: 'agent_reviewed',
      reviewed_by_id: agent.id,
      reviewed_at: new Date('2026-07-19T09:00:00Z'),
      approval_status: 'exporter_approved',
      approved_by_id: owner.id,
      approved_at: new Date('2026-07-19T11:00:00Z'),
      approved_version: 1,
      approved_checksum: ciV1Render.checksum,
      filing_status: 'not_applicable',
      file_ref: `generated://seed-doc-ci/v1`,
      file_name: 'CI_v1.txt',
      mime_type: 'text/plain',
      file_size_bytes: ciV1Render.size,
      checksum: ciV1Render.checksum,
    },
  });
  await prisma.document.upsert({
    where: { deal_id_doc_type_version: { deal_id: lockedDeal.id, doc_type: 'CI', version: 2 } },
    update: {},
    create: {
      deal_id: lockedDeal.id,
      doc_type: 'CI',
      version: 2,
      is_current_version: true,
      source: 'generated',
      generated_from_snapshot_id: lockedSnapshot.id,
      generation_status: 'queued',
      review_status: 'not_reviewed',
      approval_status: 'pending',
      filing_status: 'not_applicable',
    },
  });

  // packing_list — not generated yet. Exercises the "Generate" primary CTA.
  await prisma.document.upsert({
    where: { deal_id_doc_type_version: { deal_id: lockedDeal.id, doc_type: 'packing_list', version: 1 } },
    update: {},
    create: {
      deal_id: lockedDeal.id,
      doc_type: 'packing_list',
      version: 1,
      is_current_version: true,
      source: 'generated',
      generated_from_snapshot_id: lockedSnapshot.id,
      generation_status: 'queued',
      review_status: 'not_reviewed',
      approval_status: 'pending',
      filing_status: 'not_applicable',
    },
  });

  // shipping_bill_draft — filed. Read-only in the UI; the AC04 fixture (a filed row
  // that an upload must never mutate).
  const sbRender = renderedChecksum('shipping_bill_draft', 1);
  await prisma.document.upsert({
    where: { deal_id_doc_type_version: { deal_id: lockedDeal.id, doc_type: 'shipping_bill_draft', version: 1 } },
    update: {},
    create: {
      deal_id: lockedDeal.id,
      doc_type: 'shipping_bill_draft',
      version: 1,
      is_current_version: true,
      source: 'generated',
      generated_from_snapshot_id: lockedSnapshot.id,
      generation_status: 'generated',
      review_status: 'agent_reviewed',
      reviewed_by_id: agent.id,
      reviewed_at: new Date('2026-07-21T09:00:00Z'),
      approval_status: 'exporter_approved',
      approved_by_id: owner.id,
      approved_at: new Date('2026-07-21T10:00:00Z'),
      approved_version: 1,
      approved_checksum: sbRender.checksum,
      filing_status: 'filed',
      filing_reference: 'SB-2607210091',
      filed_at: new Date('2026-07-22T08:00:00Z'),
      file_ref: `generated://seed-doc-sb/v1`,
      file_name: 'shipping_bill_draft_v1.txt',
      mime_type: 'text/plain',
      file_size_bytes: sbRender.size,
      checksum: sbRender.checksum,
    },
  });

  // COO_draft — exporter requested changes. Exercises the exception column + regenerate.
  await prisma.document.upsert({
    where: { deal_id_doc_type_version: { deal_id: lockedDeal.id, doc_type: 'COO_draft', version: 1 } },
    update: {},
    create: {
      deal_id: lockedDeal.id,
      doc_type: 'COO_draft',
      version: 1,
      is_current_version: true,
      source: 'generated',
      generated_from_snapshot_id: lockedSnapshot.id,
      generation_status: 'generated',
      review_status: 'agent_reviewed',
      reviewed_by_id: agent.id,
      reviewed_at: new Date('2026-07-21T09:30:00Z'),
      approval_status: 'rejected',
      changes_requested_reason: 'The product name on the certificate doesn’t match the invoice — please correct before we can approve.',
      filing_status: 'draft',
      file_ref: `generated://seed-doc-coo/v1`,
      file_name: 'COO_draft_v1.txt',
      mime_type: 'text/plain',
      file_size_bytes: renderedChecksum('COO_draft', 1).size,
      checksum: renderedChecksum('COO_draft', 1).checksum,
    },
  });

  // declaration — generation failed. Exercises the failure state + Retry CTA.
  await prisma.document.upsert({
    where: { deal_id_doc_type_version: { deal_id: lockedDeal.id, doc_type: 'declaration', version: 1 } },
    update: {},
    create: {
      deal_id: lockedDeal.id,
      doc_type: 'declaration',
      version: 1,
      is_current_version: true,
      source: 'generated',
      generated_from_snapshot_id: lockedSnapshot.id,
      generation_status: 'failed',
      generation_error: 'Mock rendering error — fixture seeded in a failed state to exercise the retry path.',
      review_status: 'not_reviewed',
      approval_status: 'pending',
      filing_status: 'draft',
    },
  });

  // insurance_declaration — optional (approval not required by the registry), simply
  // not generated yet.
  await prisma.document.upsert({
    where: { deal_id_doc_type_version: { deal_id: lockedDeal.id, doc_type: 'insurance_declaration', version: 1 } },
    update: {},
    create: {
      deal_id: lockedDeal.id,
      doc_type: 'insurance_declaration',
      version: 1,
      is_current_version: true,
      source: 'generated',
      generated_from_snapshot_id: lockedSnapshot.id,
      generation_status: 'queued',
      review_status: 'not_reviewed',
      approval_status: 'not_required',
      filing_status: 'not_applicable',
    },
  });

  // ---------------------------------------------------------------------------
  // Shipment & CHA tracking (EXP-14). One CHA and one freight Partner, a shipment
  // mid-timeline (in_transit) with one genuine ETA-vs-actual divergence on the customs
  // milestone (delayed by two days — a real exception the timeline should surface, not
  // an invented one), and filing references an exporter must never be able to edit.
  // ---------------------------------------------------------------------------
  const chaPartner = await prisma.partner.upsert({
    where: { id: 'seed-partner-cha-1' },
    update: {},
    create: {
      id: 'seed-partner-cha-1',
      type: 'cha',
      legal_name: 'Konkan Customs House Agents Pvt Ltd',
      display_name: 'Konkan CHA',
      country_code: 'IN',
      contact_email: 'ops@konkancha.example',
      contact_phone: '+91-22-5550-1010',
      partner_status: 'active',
    },
  });

  const freightPartner = await prisma.partner.upsert({
    where: { id: 'seed-partner-freight-1' },
    update: {},
    create: {
      id: 'seed-partner-freight-1',
      type: 'freight',
      legal_name: 'Sagar Freight Forwarders LLP',
      display_name: 'Sagar Freight',
      country_code: 'IN',
      contact_email: 'bookings@sagarfreight.example',
      contact_phone: '+91-22-5550-2020',
      partner_status: 'active',
    },
  });

  await prisma.partner.upsert({
    where: { id: 'seed-partner-insurance-1' },
    update: {},
    create: {
      id: 'seed-partner-insurance-1',
      type: 'insurance',
      legal_name: 'Bharat Trade Cover Insurance Co.',
      display_name: 'Bharat Trade Cover',
      country_code: 'IN',
      contact_email: 'quotes@bharattradecover.example',
      contact_phone: '+91-22-5550-3030',
      partner_status: 'active',
    },
  });

  const lockedShipment = await prisma.shipment.upsert({
    where: { id: 'seed-shipment-locked-1' },
    update: {},
    create: {
      id: 'seed-shipment-locked-1',
      deal_id: lockedDeal.id,
      status: 'in_transit',
      mode: 'sea',
      origin: { port: 'Nhava Sheva', country_code: 'IN' },
      destination: { port: 'Jebel Ali', country_code: 'AE' },
      incoterm: lockedDeal.incoterm,
      cha_partner_id: chaPartner.id,
      freight_partner_id: freightPartner.id,
      booking_ref: 'BKG-NHV-88213',
      customs_ref: 'CUS-IN-2026-451092',
      shipping_bill_no: 'SB-4471002',
      exception_state: 'watch',
      exception_reason: 'Customs clearance ran two days past the original ETA; cleared without a hold.',
      exception_owner_id: agent.id,
    },
  });

  const milestoneRows: {
    code: string;
    label: string;
    state: 'complete' | 'in_progress' | 'pending';
    sequence: number;
    eta: string;
    actual: string | null;
  }[] = [
    { code: 'planning', label: 'Planning', state: 'complete', sequence: 1, eta: '2026-07-21T00:00:00Z', actual: '2026-07-21T00:00:00Z' },
    { code: 'booking', label: 'Booking confirmed', state: 'complete', sequence: 2, eta: '2026-07-24T00:00:00Z', actual: '2026-07-24T00:00:00Z' },
    { code: 'pickup', label: 'Pickup', state: 'complete', sequence: 3, eta: '2026-07-27T00:00:00Z', actual: '2026-07-27T00:00:00Z' },
    // The genuine divergence: cleared two days later than planned.
    { code: 'customs', label: 'Customs clearance', state: 'complete', sequence: 4, eta: '2026-07-29T00:00:00Z', actual: '2026-07-31T00:00:00Z' },
    { code: 'loaded', label: 'Loaded', state: 'complete', sequence: 5, eta: '2026-08-01T00:00:00Z', actual: '2026-08-01T00:00:00Z' },
    { code: 'in_transit', label: 'In transit', state: 'in_progress', sequence: 6, eta: '2026-08-20T00:00:00Z', actual: null },
    { code: 'arrived', label: 'Arrived', state: 'pending', sequence: 7, eta: '2026-08-22T00:00:00Z', actual: null },
    { code: 'delivered', label: 'Delivered', state: 'pending', sequence: 8, eta: '2026-08-25T00:00:00Z', actual: null },
  ];

  for (const m of milestoneRows) {
    await prisma.shipmentMilestone.upsert({
      where: { shipment_id_code: { shipment_id: lockedShipment.id, code: m.code } },
      update: {},
      create: {
        shipment_id: lockedShipment.id,
        code: m.code,
        label: m.label,
        state: m.state,
        sequence: m.sequence,
        eta_at: new Date(m.eta),
        actual_at: m.actual ? new Date(m.actual) : null,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Payment, banking visibility & insurance (EXP-15). Two installments per the deal's
  // "30% advance, 70% against BL" terms: the advance fully received (AA-verified), the
  // balance partially received with BRC still pending — brc_status is independent of
  // received/realized (AC04), so this fixture deliberately leaves it lagging behind.
  // ---------------------------------------------------------------------------
  await prisma.payment.upsert({
    where: { id: 'seed-payment-locked-1' },
    update: {},
    create: {
      id: 'seed-payment-locked-1',
      deal_id: lockedDeal.id,
      amount: 12600,
      currency: 'USD',
      amount_received: 12600,
      payment_method: 'wire',
      status: 'realized',
      due_at: new Date('2026-07-22T00:00:00Z'),
      received_at: new Date('2026-07-21T00:00:00Z'),
      realized_at: new Date('2026-07-23T00:00:00Z'),
      brc_status: 'verified',
      source: 'AA',
      label: '30% advance',
      sequence: 1,
    },
  });

  await prisma.payment.upsert({
    where: { id: 'seed-payment-locked-2' },
    update: {},
    create: {
      id: 'seed-payment-locked-2',
      deal_id: lockedDeal.id,
      amount: 29400,
      currency: 'USD',
      amount_received: 18000,
      payment_method: 'LC',
      status: 'partially_received',
      due_at: new Date('2026-09-10T00:00:00Z'),
      received_at: new Date('2026-08-28T00:00:00Z'),
      evidence_refs: [{ note: 'First tranche against BL received via bank partner.', recorded_by: agent.id, recorded_at: '2026-08-28T09:00:00Z' }],
      brc_status: 'pending',
      source: 'bank_partner',
      label: '70% against BL',
      sequence: 2,
    },
  });

  // ---------------------------------------------------------------------------
  // AGT-06 execution fixtures.
  //
  // The handoff row is what makes AC02 testable with real data: the CHA assignment on
  // Shipment says WHO, this says who sent the packet, when, and under what reference the
  // partner acknowledged it. The internal note gives the leak sweep something real to
  // hunt for — a string that must appear on /agent/deals/:id and on no exporter surface
  // or exporter-facing API response anywhere.
  // ---------------------------------------------------------------------------
  await prisma.partnerHandoff.upsert({
    where: { id: 'seed-handoff-cha-1' },
    update: {},
    create: {
      id: 'seed-handoff-cha-1',
      deal_id: lockedDeal.id,
      shipment_id: lockedShipment.id,
      partner_id: chaPartner.id,
      lane: 'cha',
      status: 'acknowledged',
      owner_user_id: agent.id,
      reference: 'KCHA-JOB-77120',
      notes: 'Sent invoice, packing list and SB draft for filing.',
      sent_at: new Date('2026-07-28T06:30:00Z'),
      acknowledged_at: new Date('2026-07-28T11:15:00Z'),
    },
  });

  await prisma.internalNote.upsert({
    where: { id: 'seed-internal-note-locked-1' },
    update: {},
    create: {
      id: 'seed-internal-note-locked-1',
      scope_type: 'deal',
      scope_id: lockedDeal.id,
      deal_id: lockedDeal.id,
      author_user_id: agent.id,
      body: 'INTERNAL-ONLY-CANARY: margin on this deal is thin after the customs delay — do not offer the buyer a further discount without Ops sign-off.',
    },
  });

  await prisma.insuranceCase.upsert({
    where: { id: 'seed-insurance-case-locked-1' },
    update: {},
    create: {
      id: 'seed-insurance-case-locked-1',
      deal_id: lockedDeal.id,
      shipment_id: lockedShipment.id,
      status: 'quote_requested',
      notes: 'Requested cargo cover for the sea leg given the customs delay.',
      quote_requested_at: new Date('2026-08-01T00:00:00Z'),
    },
  });

  // ---------------------------------------------------------------------------
  // EXP-16 Messages, Support & Disputes. A real conversation (so the thread isn't
  // empty), one case mid-flow at proposed_resolution (so "Accept resolution" has
  // something real to accept), and one closed case (so "Resolved history" isn't
  // empty either). AC01's separation is structural, not something the fixture has to
  // prove — but seeding both a message thread AND a dispute on the same deal is the
  // natural check that neither accidentally became the other.
  // ---------------------------------------------------------------------------
  await prisma.message.upsert({
    where: { id: 'seed-message-locked-1' },
    update: {},
    create: {
      id: 'seed-message-locked-1',
      thread_key: `deal:${lockedDeal.id}`,
      deal_id: lockedDeal.id,
      exporter_org_id: org.id,
      author_user_id: owner.id,
      body: 'Hi Rahul — following up on the customs delay. Anything you need from us to keep things moving?',
      created_at: new Date('2026-08-01T09:15:00Z'),
    },
  });
  await prisma.message.upsert({
    where: { id: 'seed-message-locked-2' },
    update: {},
    create: {
      id: 'seed-message-locked-2',
      thread_key: `deal:${lockedDeal.id}`,
      deal_id: lockedDeal.id,
      exporter_org_id: org.id,
      author_user_id: agent.id,
      body: 'Cleared this morning without a hold — we lost two days but nothing further needed from your side.',
      created_at: new Date('2026-08-01T11:40:00Z'),
    },
  });

  await prisma.dispute.upsert({
    where: { id: 'seed-dispute-locked-proposed' },
    update: {},
    create: {
      id: 'seed-dispute-locked-proposed',
      scope_type: 'deal',
      scope_id: lockedDeal.id,
      deal_id: lockedDeal.id,
      type: 'quality',
      severity: 'medium',
      status: 'proposed_resolution',
      owner_user_id: agent.id,
      summary: 'Buyer reports the sample colour ran slightly darker than the approved swatch on the first pallet.',
      resolution:
        'Agreed a 1.5% credit note against the next shipment rather than a rework, since the variance is within the buyer’s own tolerance letter. Awaiting your acceptance.',
    },
  });

  await prisma.dispute.upsert({
    where: { id: 'seed-dispute-locked-closed' },
    update: {},
    create: {
      id: 'seed-dispute-locked-closed',
      scope_type: 'shipment',
      scope_id: lockedShipment.id,
      deal_id: lockedDeal.id,
      shipment_id: lockedShipment.id,
      type: 'logistics',
      severity: 'low',
      status: 'closed',
      owner_user_id: agent.id,
      summary: 'Pickup slot needed to move by four hours to match the CHA’s customs window.',
      resolution: 'Freight partner confirmed the later slot at no extra cost.',
      closure_basis: 'exporter_accepted',
      accepted_at: new Date('2026-07-27T08:00:00Z'),
      closed_at: new Date('2026-07-27T08:00:00Z'),
    },
  });

  const negotiatingDeal = await prisma.deal.upsert({
    where: { id: 'seed-deal-negotiating' },
    update: {},
    create: {
      id: 'seed-deal-negotiating',
      exporter_org_id: org.id,
      buyer_id: 'seed-buyer-1', // Spice Trading Co. (US) — verified
      product_id: bedsheets.id,
      stage: DealStage.negotiating,
      value_amount: 14400,
      value_currency: 'USD',
      quantity: 800,
      unit: 'sets',
      unit_price_amount: 18,
      unit_price_currency: 'USD',
      total_amount: 14400,
      total_currency: 'USD',
      incoterm: 'CIF',
      incoterm_place: 'Hamburg',
      payment_terms: { type: 'TT', description: '50% advance, 50% before shipment' },
      risk_state: RiskState.normal,
      owner_agent_id: agent.id,
    },
  });

  // One exporter-owned "next action" per deal, so the Overview tab's Next Actions zone
  // isn't empty — plus one INTERNAL task on the locked deal, seeded specifically so
  // browser-verify can assert it never reaches the exporter-facing workspace.
  await prisma.task.upsert({
    where: { id: 'seed-task-deal-locked-1' },
    update: {},
    create: {
      id: 'seed-task-deal-locked-1',
      scope_type: 'deal',
      scope_id: lockedDeal.id,
      deal_id: lockedDeal.id,
      exporter_org_id: org.id,
      title: 'Confirm revised payment terms with buyer',
      description: 'Gulf Foods proposed a change to the LC terms after lock — confirm acceptance before documents proceed.',
      owner_user_id: owner.id,
      owner_role: UserRole.exporter_owner,
      state: TaskState.in_progress,
      priority: TaskPriority.high,
      due_at: new Date(Date.now() + 2 * 86_400_000),
      visibility: Visibility.exporter_visible,
    },
  });

  await prisma.task.upsert({
    where: { id: 'seed-task-deal-locked-internal' },
    update: {},
    create: {
      id: 'seed-task-deal-locked-internal',
      scope_type: 'deal',
      scope_id: lockedDeal.id,
      deal_id: lockedDeal.id,
      exporter_org_id: org.id,
      title: 'Agent commission reconciliation for revised terms',
      description: 'Recompute agent share if the amended payment terms change the fee basis.',
      owner_user_id: agent.id,
      owner_role: UserRole.agent,
      state: TaskState.not_started,
      priority: TaskPriority.normal,
      visibility: Visibility.internal,
    },
  });

  await prisma.task.upsert({
    where: { id: 'seed-task-deal-negotiating-1' },
    update: {},
    create: {
      id: 'seed-task-deal-negotiating-1',
      scope_type: 'deal',
      scope_id: negotiatingDeal.id,
      deal_id: negotiatingDeal.id,
      exporter_org_id: org.id,
      title: 'Send revised proforma invoice',
      description: 'Spice Trading Co. asked for a revised PI reflecting the agreed unit price.',
      owner_user_id: owner.id,
      owner_role: UserRole.exporter_owner,
      state: TaskState.not_started,
      priority: TaskPriority.normal,
      due_at: new Date(Date.now() + 5 * 86_400_000),
      visibility: Visibility.exporter_visible,
    },
  });

  // ---------------------------------------------------------------------------
  // Commercial proposals (EXP-10 / AGT-05).
  //
  // The negotiating deal gets a real version history so the diff view has two versions
  // to compare and the exporter has something live to approve: v1 superseded, v2
  // awaiting exporter approval with several fields changed against v1.
  //
  // The locked deal gets a single approved v1 that matches its DealSnapshot — a locked
  // deal must have an accepted proposal behind it, or `collectDealLockBlockers()` would
  // (correctly) say no accepted version is recorded.
  // ---------------------------------------------------------------------------

  await prisma.dealProposal.upsert({
    where: { deal_id_version: { deal_id: negotiatingDeal.id, version: 1 } },
    update: {},
    create: {
      deal_id: negotiatingDeal.id,
      version: 1,
      status: ProposalStatus.superseded,
      quantity: 600,
      unit: 'sets',
      unit_price_amount: 19.5,
      unit_price_currency: 'USD',
      total_amount: 11700,
      total_currency: 'USD',
      incoterm: 'FOB',
      incoterm_place: 'Mundra',
      payment_terms: { type: 'TT', description: '30% advance, 70% before shipment' },
      ship_window_start: new Date('2026-09-10T00:00:00Z'),
      ship_window_end: new Date('2026-09-20T00:00:00Z'),
      agent_note: 'Opening position based on the buyer’s indicative volume.',
      proposed_by_id: agent.id,
      proposed_at: new Date('2026-07-30T09:00:00Z'),
      created_at: new Date('2026-07-30T09:00:00Z'),
    },
  });

  await prisma.dealProposal.upsert({
    where: { deal_id_version: { deal_id: negotiatingDeal.id, version: 2 } },
    update: {},
    create: {
      deal_id: negotiatingDeal.id,
      version: 2,
      status: ProposalStatus.awaiting_exporter,
      // Changed against v1: quantity, unit price, total, incoterm/place, payment terms,
      // ship window — enough that the "changed fields highlighted" diff is meaningful.
      quantity: 800,
      unit: 'sets',
      unit_price_amount: 18,
      unit_price_currency: 'USD',
      total_amount: 14400,
      total_currency: 'USD',
      incoterm: 'CIF',
      incoterm_place: 'Hamburg',
      payment_terms: { type: 'TT', description: '50% advance, 50% before shipment' },
      ship_window_start: new Date('2026-09-05T00:00:00Z'),
      ship_window_end: new Date('2026-09-18T00:00:00Z'),
      special_conditions: 'Buyer to confirm carton markings before production.',
      agent_note: 'Buyer accepted a larger volume in exchange for the lower unit price.',
      buyer_status: 'verbal_interest',
      buyer_status_note: 'Buyer confirmed verbally on a call; nothing signed yet.',
      proposed_by_id: agent.id,
      proposed_at: new Date('2026-08-04T11:30:00Z'),
      created_at: new Date('2026-08-04T11:30:00Z'),
    },
  });

  await prisma.dealProposal.upsert({
    where: { deal_id_version: { deal_id: lockedDeal.id, version: 1 } },
    update: {},
    create: {
      deal_id: lockedDeal.id,
      version: 1,
      status: ProposalStatus.approved,
      quantity: 12000,
      unit: 'kg',
      unit_price_amount: 3.5,
      unit_price_currency: 'USD',
      total_amount: 42000,
      total_currency: 'USD',
      incoterm: 'FOB',
      incoterm_place: 'Nhava Sheva',
      payment_terms: { type: 'LC', description: '30% advance, 70% against BL via irrevocable LC at sight' },
      ship_window_start: new Date('2026-08-25T00:00:00Z'),
      ship_window_end: new Date('2026-09-05T00:00:00Z'),
      special_conditions: 'Buyer requires pre-shipment sample approval.',
      agent_note: 'Final terms after two rounds; buyer confirmed the LC route with their bank.',
      buyer_status: 'accepted',
      buyer_status_note: 'Buyer countersigned the proforma invoice.',
      proposed_by_id: agent.id,
      proposed_at: new Date('2026-07-18T10:00:00Z'),
      // AGT-05-AC02: approval is recorded against the EXPORTER, never the agent.
      approved_by_id: owner.id,
      approved_at: new Date('2026-07-19T14:20:00Z'),
      created_at: new Date('2026-07-18T10:00:00Z'),
    },
  });

  // ---------------------------------------------------------------------------
  // EXP-03 Enablement Center. Task rows seeded DIRECTLY rather than through a live
  // `is_current: true` ReadinessAssessment on purpose: `scripts/verify-journey.ts` J2
  // submits a real assessment against this SAME org and asserts against whatever the
  // job handler produces from ITS OWN answers. Seeding a current/draft assessment row
  // would prefill the exporter portal's readiness form and could silently change what
  // J2 submits (e.g. a pre-filled `packaging_qc` answer would suppress that recommended
  // finding). Task rows have no such dependency — the Enablement Center page reads them
  // directly — so this fixture is realistic without coupling to that suite's fixture.
  //
  // Deliberately NOT fully "ready": one required task (`gst`) is mid-review, one
  // (`ad_code`) was rejected and is waiting on the exporter — real varied states for
  // every UI branch (waiting review / rejected+reason / approved) rather than one happy
  // path. `ExporterOrg.readiness_status` stays `ready`, untouched, exactly as every
  // other verified suite already depends on — this fixture is a UI-testing snapshot of
  // the Task/TaskEvidence layer, not a claim about the org's cached summary status.
  // ---------------------------------------------------------------------------
  // Every task/evidence `update` mirrors its `create` (not `{}`) — these task_types are
  // exactly what `runReadinessAssessment()` matches on too, and a real assessment run
  // (verify-journey.ts J2 submits one against this same org) can update or even cancel
  // them. Re-seeding must reconverge to this fixture's intended demo states regardless
  // of what a prior verification run left behind, the same "seed enforces its own
  // fixture" discipline `exporterOrg.upsert` already uses above.
  const iecTaskFields = {
    scope_type: 'exporter_org' as const,
    scope_id: org.id,
    exporter_org_id: org.id,
    title: 'Verify your IEC',
    description: 'Record and verify your IEC; a number entered on its own is not verification.',
    owner_user_id: owner.id,
    owner_role: UserRole.exporter_owner,
    state: TaskState.done,
    priority: TaskPriority.high,
    completed_at: new Date('2026-07-15T09:00:00Z'),
    blocked_reason: null,
    waiting_on: null,
    cancel_reason: null,
    visibility: Visibility.exporter_visible,
    task_type: 'readiness_iec',
  };
  const readinessTaskIec = await prisma.task.upsert({
    where: { id: 'seed-task-readiness-iec' },
    update: iecTaskFields,
    create: { id: 'seed-task-readiness-iec', ...iecTaskFields },
  });
  await prisma.taskEvidence.upsert({
    where: { id: 'seed-evidence-iec-1' },
    update: {},
    create: {
      id: 'seed-evidence-iec-1',
      task_id: readinessTaskIec.id,
      file_ref: 'seed/iec-certificate.pdf',
      file_name: 'iec-certificate.pdf',
      uploaded_by_id: owner.id,
      uploaded_at: new Date('2026-07-14T11:00:00Z'),
      review_status: 'approved',
      reviewed_by_id: agent.id,
      reviewed_at: new Date('2026-07-15T09:00:00Z'),
    },
  });

  const gstTaskFields = {
    scope_type: 'exporter_org' as const,
    scope_id: org.id,
    exporter_org_id: org.id,
    title: 'Verify your GSTIN',
    description: 'Record and verify your GSTIN; a number entered on its own is not verification.',
    owner_user_id: owner.id,
    owner_role: UserRole.exporter_owner,
    state: TaskState.in_progress,
    priority: TaskPriority.high,
    due_at: new Date('2026-08-15T00:00:00Z'),
    blocked_reason: null,
    waiting_on: null,
    cancel_reason: null,
    completed_at: null,
    visibility: Visibility.exporter_visible,
    task_type: 'readiness_gst',
  };
  const readinessTaskGst = await prisma.task.upsert({
    where: { id: 'seed-task-readiness-gst' },
    update: gstTaskFields,
    create: { id: 'seed-task-readiness-gst', ...gstTaskFields },
  });
  await prisma.taskEvidence.upsert({
    where: { id: 'seed-evidence-gst-1' },
    update: {},
    create: {
      id: 'seed-evidence-gst-1',
      task_id: readinessTaskGst.id,
      file_ref: 'seed/gstin-certificate.pdf',
      file_name: 'gstin-certificate.pdf',
      uploaded_by_id: owner.id,
      uploaded_at: new Date('2026-08-05T10:00:00Z'),
      review_status: 'pending',
    },
  });

  const adCodeTaskFields = {
    scope_type: 'exporter_org' as const,
    scope_id: org.id,
    exporter_org_id: org.id,
    title: 'Verify your AD code',
    description: 'Record and verify your AD code; a number entered on its own is not verification.',
    owner_user_id: owner.id,
    owner_role: UserRole.exporter_owner,
    state: TaskState.waiting,
    priority: TaskPriority.high,
    blocked_reason: 'The scanned certificate is illegible — please re-upload a clearer copy.',
    waiting_on: 'Re-upload requested',
    cancel_reason: null,
    completed_at: null,
    due_at: new Date('2026-08-10T00:00:00Z'),
    visibility: Visibility.exporter_visible,
    task_type: 'readiness_ad_code',
  };
  const readinessTaskAdCode = await prisma.task.upsert({
    where: { id: 'seed-task-readiness-ad-code' },
    update: adCodeTaskFields,
    create: { id: 'seed-task-readiness-ad-code', ...adCodeTaskFields },
  });
  await prisma.taskEvidence.upsert({
    where: { id: 'seed-evidence-ad-code-1' },
    update: {},
    create: {
      id: 'seed-evidence-ad-code-1',
      task_id: readinessTaskAdCode.id,
      file_ref: 'seed/ad-code-scan.pdf',
      file_name: 'ad-code-scan.pdf',
      uploaded_by_id: owner.id,
      uploaded_at: new Date('2026-08-03T08:00:00Z'),
      review_status: 'rejected',
      review_note: 'The scanned certificate is illegible — please re-upload a clearer copy.',
      reviewed_by_id: agent.id,
      reviewed_at: new Date('2026-08-03T15:00:00Z'),
    },
  });

  const packagingQcTaskFields = {
    scope_type: 'exporter_org' as const,
    scope_id: org.id,
    exporter_org_id: org.id,
    title: 'Confirm packaging and QC process',
    description: 'Document how the product will be packed and quality checked.',
    owner_user_id: owner.id,
    owner_role: UserRole.exporter_owner,
    state: TaskState.not_started,
    priority: TaskPriority.normal,
    blocked_reason: null,
    waiting_on: null,
    cancel_reason: null,
    completed_at: null,
    visibility: Visibility.exporter_visible,
    task_type: 'readiness_packaging_qc',
  };
  await prisma.task.upsert({
    where: { id: 'seed-task-readiness-packaging-qc' },
    update: packagingQcTaskFields,
    create: { id: 'seed-task-readiness-packaging-qc', ...packagingQcTaskFields },
  });

  const samplesTaskFields = {
    scope_type: 'exporter_org' as const,
    scope_id: org.id,
    exporter_org_id: org.id,
    title: 'Plan an export sample',
    description: 'Prepare a sample plan before buyer outreach.',
    owner_user_id: owner.id,
    owner_role: UserRole.exporter_owner,
    state: TaskState.done,
    priority: TaskPriority.normal,
    completed_at: new Date('2026-07-20T00:00:00Z'),
    blocked_reason: null,
    waiting_on: null,
    cancel_reason: null,
    visibility: Visibility.exporter_visible,
    task_type: 'readiness_samples',
  };
  await prisma.task.upsert({
    where: { id: 'seed-task-readiness-samples' },
    update: samplesTaskFields,
    create: { id: 'seed-task-readiness-samples', ...samplesTaskFields },
  });

  // ---------------------------------------------------------------------------
  // AGT-08 / OPS-05 agent payout.
  //
  // Seeded in `paid` state with one adjustment, which is the only fixture shape that
  // exercises the whole record at once: a frozen snapshot, an additive correction that
  // did NOT rewrite it, and a payment reference. The figures are the real arithmetic for
  // this deal — 42,000 USD basis x 2.5% success fee = 1,050 fee, x 40% agent share = 420
  // — so the seeded row agrees with what `recomputePayoutForDeal()` would have produced,
  // rather than being decorative numbers that drift from the live calculation.
  //
  // Deliberately NOT seeded for the negotiating deal: it has not reached a tracked stage,
  // and inventing a payout there would contradict the eligibility rule this screen exists
  // to make legible.
  // ---------------------------------------------------------------------------
  const payoutFields = {
    deal_id: lockedDeal.id,
    agent_user_id: agent.id,
    state: 'paid' as const,
    basis_amount: 42000,
    basis_currency: 'USD',
    fee_amount: 1050,
    fee_currency: 'USD',
    fee_rule: 'success_fee',
    agent_share_rate: '0.4',
    amount: 420,
    currency: 'USD',
    fee_policy_version: 1,
    calculation_snapshot: {
      computed_at: '2026-07-25T00:00:00.000Z',
      basis: { amount: '42000', currency: 'USD' },
      fee_rule: 'success_fee',
      fee_rate: '0.025',
      fee_result: { amount: '1050.00', currency: 'USD' },
      agent_share_rate: '0.4',
      agent_amount: { amount: '420.00', currency: 'USD' },
      fee_policy_version: 1,
      eligibility_rule: 'payment_realized+no_open_dispute',
    },
    eligibility_rule: 'payment_realized+no_open_dispute',
    eligible_at: new Date('2026-07-25T00:00:00Z'),
    approved_at: new Date('2026-07-28T00:00:00Z'),
    approved_by_id: opsFinance.id,
    paid_at: new Date('2026-07-31T00:00:00Z'),
    payment_reference: 'NEFT-CT-2026-0731-0042',
    ineligible_reason: null,
  };
  const seedPayout = await prisma.payout.upsert({
    where: { deal_id_agent_user_id: { deal_id: lockedDeal.id, agent_user_id: agent.id } },
    update: payoutFields,
    create: payoutFields,
  });

  // The additive correction (OPS-05-AC03). Note the payout's own `amount` above stays
  // 420 — this row is what makes the net 399, and both figures remain readable.
  await prisma.payoutAdjustment.upsert({
    where: { id: 'seed-payout-adjustment-1' },
    update: {},
    create: {
      id: 'seed-payout-adjustment-1',
      payout_id: seedPayout.id,
      amount: -21,
      currency: 'USD',
      reason: 'Partial clawback: 5% of the success fee was waived for the exporter after the quality dispute.',
      created_by_id: opsFinance.id,
      created_at: new Date('2026-07-30T00:00:00Z'),
    },
  });

  // ---------------------------------------------------------------------------
  // EXP-17 Notifications & Account.
  // ---------------------------------------------------------------------------
  await prisma.notification.upsert({
    where: { user_id_dedupe_key: { user_id: owner.id, dedupe_key: 'seed-notif-1' } },
    update: {},
    create: {
      user_id: owner.id,
      type: 'commercial_terms_proposed',
      title: 'New commercial terms to review',
      body: 'Your agent sent version 2 of the commercial terms for approval.',
      severity: 'action_required',
      object_type: 'deal',
      object_id: negotiatingDeal.id,
      deep_link: `/app/deals/${negotiatingDeal.id}/commercial`,
      dedupe_key: 'seed-notif-1',
      read_at: null,
      created_at: new Date('2026-08-08T09:00:00Z'),
    },
  });
  await prisma.notification.upsert({
    where: { user_id_dedupe_key: { user_id: owner.id, dedupe_key: 'seed-notif-2' } },
    update: {},
    create: {
      user_id: owner.id,
      type: 'dispute_resolution_proposed',
      title: 'A resolution has been proposed',
      body: 'Agreed a 1.5% credit note against the next shipment rather than a rework.',
      severity: 'action_required',
      object_type: 'dispute',
      object_id: 'seed-dispute-locked-proposed',
      deep_link: `/app/deals/${lockedDeal.id}/support`,
      dedupe_key: 'seed-notif-2',
      read_at: null,
      created_at: new Date('2026-08-09T14:00:00Z'),
    },
  });
  await prisma.notification.upsert({
    where: { user_id_dedupe_key: { user_id: owner.id, dedupe_key: 'seed-notif-3' } },
    update: {},
    create: {
      user_id: owner.id,
      type: 'document_generation',
      title: 'Commercial invoice generated',
      body: 'CI v2 is ready for your review.',
      severity: 'info',
      object_type: 'document',
      deep_link: `/app/deals/${lockedDeal.id}/documents`,
      dedupe_key: 'seed-notif-3',
      // Already read — demonstrates the read/unread visual distinction, not just the
      // empty and all-unread cases.
      read_at: new Date('2026-08-07T10:15:00Z'),
      created_at: new Date('2026-08-07T09:45:00Z'),
    },
  });

  // A commercial-category email preference switched off, so the Preferences panel has
  // a real "not all defaults" row to render, not just the all-enabled default state.
  await prisma.notificationPreference.upsert({
    where: { user_id_category: { user_id: owner.id, category: 'commercial' } },
    update: {},
    create: { user_id: owner.id, category: 'commercial', email_enabled: false, in_app_enabled: true },
  });

  // A pending invitation — "Invite pending: visible status + resend/revoke" (docs/04).
  await prisma.invitation.upsert({
    where: { id: 'seed-invitation-1' },
    update: {},
    create: {
      id: 'seed-invitation-1',
      exporter_org_id: org.id,
      email: 'new-analyst@sunriseagro.example',
      role: UserRole.exporter_member,
      status: 'pending',
      token: 'seed-invitation-token-1',
      invited_by_id: owner.id,
      expires_at: new Date(Date.now() + 14 * 86_400_000),
    },
  });

  // ---------------------------------------------------------------------------
  // EXP-07 Buyer Detail: contacts, sourced evidence, and varied relationship states so
  // every branch (converted lead, shortlisted-no-lead, not shortlisted) has real data.
  // ---------------------------------------------------------------------------
  await prisma.buyerContact.upsert({
    where: { id: 'seed-contact-buyer3-1' },
    update: {},
    create: {
      id: 'seed-contact-buyer3-1',
      buyer_id: 'seed-buyer-3',
      name: 'Fatima Al Nuaimi',
      role_title: 'Procurement Manager',
      email: 'f.alnuaimi@gulffoods.example',
      phone: '+971-4-555-0199',
      verification_status: VerificationStatus.verified,
      provenance: 'Confirmed via company website and a direct call, 2026-06-10.',
      verified_at: new Date('2026-06-10T00:00:00Z'),
    },
  });
  await prisma.buyerSourceEvidence.upsert({
    where: { id: 'seed-evidence-buyer3-1' },
    update: {},
    create: {
      id: 'seed-evidence-buyer3-1',
      buyer_id: 'seed-buyer-3',
      source_type: 'import_records',
      source_ref: 'UAE customs import filings',
      summary: 'Recurring turmeric and spice imports from India over the last 12 months.',
      observed_at: new Date('2026-06-01T00:00:00Z'),
    },
  });
  await prisma.buyerSourceEvidence.upsert({
    where: { id: 'seed-evidence-buyer5-1' },
    update: {},
    create: {
      id: 'seed-evidence-buyer5-1',
      buyer_id: 'seed-buyer-5',
      source_type: 'trade_reference',
      source_ref: 'Exporter-reported dispute log',
      summary: 'A prior exporter reported a payment dispute with this buyer.',
      observed_at: new Date('2026-06-02T00:00:00Z'),
    },
  });

  // Spice Trading Co. (buyer-1) already converted — its lead is linked to the
  // negotiating deal, so the Buyer Detail page's "Converted to a deal" state has a real
  // row behind it. Deliberately NOT buyer-3 (Gulf Foods): `verify-journey.ts` J7 creates
  // a fresh lead against whichever buyer sorts first by `last_activity_at` with no
  // filters, which is always Gulf Foods (the most recently active buyer) — seeding a
  // lead there would collide with J7's own row and make its "Lead created" assertion
  // fail with a DUPLICATE_LEAD response instead. Buyer-1 is never that buyer.
  // `update` mirrors `create` — an upsert that only fills in on first-create would leave
  // a PRIOR run's row (from this fixture or any other) silently un-converged.
  const buyer1LeadFields = {
    stage: 'converted' as const,
    assigned_agent_id: agent.id,
    deal_id: negotiatingDeal.id,
    interest_level: 'high' as const,
    fit_score: 91,
    fit_score_basis: { basis: 'Repeat importer of Indian textiles, verified contact, strong price fit.' },
  };
  await prisma.buyerLead.upsert({
    where: { exporter_org_id_product_id_buyer_id: { exporter_org_id: org.id, product_id: bedsheets.id, buyer_id: 'seed-buyer-1' } },
    update: buyer1LeadFields,
    create: { exporter_org_id: org.id, product_id: bedsheets.id, buyer_id: 'seed-buyer-1', created_by_id: owner.id, ...buyer1LeadFields },
  });

  // Rapid Import Partners (buyer-5, the risk-flagged one) is shortlisted but has no
  // lead yet — the "shortlisted, no lead created yet" branch.
  await prisma.buyerShortlist.upsert({
    where: { exporter_org_id_buyer_id_product_id: { exporter_org_id: org.id, buyer_id: 'seed-buyer-5', product_id: turmeric.id } },
    update: {},
    create: { exporter_org_id: org.id, buyer_id: 'seed-buyer-5', product_id: turmeric.id, created_by_id: owner.id },
  });

  // ---------------------------------------------------------------------------
  // Tier fixtures — one org per tier, so the paywall is testable without hand-rolling
  // rows. `seed-org-1` above is the paid tenant; these two are its free and guest peers.
  // ---------------------------------------------------------------------------

  const freeOrg = await prisma.exporterOrg.upsert({
    where: { id: 'seed-org-free' },
    update: {
      tier: OrgTier.free,
      commitment_fee_status: CommitmentFeeStatus.due,
      commitment_fee_amount: 15000,
      commitment_fee_currency: 'INR',
      commitment_fee_policy_version: 1,
    },
    create: {
      id: 'seed-org-free',
      display_name: 'Deccan Spice Traders',
      legal_name: 'Deccan Spice Traders LLP',
      country: 'IN',
      state: 'Telangana',
      city: 'Hyderabad',
      tier: OrgTier.free,
      upgraded_at: new Date('2026-07-01T00:00:00Z'),
      // Registered but hasn't paid — the exact state /app/billing's "pay CTA" branch
      // exercises, and what the `commitment_fee.pay` capability tests against.
      commitment_fee_status: CommitmentFeeStatus.due,
      commitment_fee_amount: 15000,
      commitment_fee_currency: 'INR',
      commitment_fee_policy_version: 1,
      commitment_fee_due_at: new Date('2026-07-01T00:00:00Z'),
    },
  });

  const freeOwner = await prisma.user.upsert({
    where: { email: 'free@deccanspice.example' },
    update: {},
    create: {
      id: 'seed-user-free',
      email: 'free@deccanspice.example',
      name: 'Meera Rao',
      password_hash: await hashPassword(SEED_PASSWORD),
      role: UserRole.exporter_owner,
      exporter_org_id: freeOrg.id,
    },
  });

  // A guest fixture mirrors exactly what mintGuest() produces at runtime: no password
  // (the row cannot be logged into) and a synthetic .invalid address. It exists so the
  // guest paywall can be exercised in tests; a real guest is minted on first search.
  const guestOrg = await prisma.exporterOrg.upsert({
    where: { id: 'seed-org-guest' },
    update: { tier: OrgTier.guest },
    create: {
      id: 'seed-org-guest',
      display_name: 'Guest workspace',
      tier: OrgTier.guest,
      guest_expires_at: new Date(Date.now() + 30 * 86_400_000),
    },
  });

  await prisma.user.upsert({
    where: { email: 'guest-seed-org-guest@guest.invalid' },
    update: {},
    create: {
      id: 'seed-user-guest',
      email: 'guest-seed-org-guest@guest.invalid',
      name: 'Guest',
      password_hash: null,
      role: UserRole.exporter_owner,
      exporter_org_id: guestOrg.id,
    },
  });

  const warehouse = await seedTradeWarehouse();

  console.log('Seed complete.\n');
  console.log(`Trade warehouse: ${warehouse} TradeFlow rows (chapters ${WAREHOUSE_CHAPTERS.join(', ')}).`);
  console.log('ExporterOrg:', org.display_name, `(${org.id})`);
  console.log('Products:', turmeric.name, `(${turmeric.id})`, '|', bedsheets.name, `(${bedsheets.id})`);
  console.log('Buyers:', buyers.map((b) => `${b.display_name} [${b.verification_status}]`).join(', '));
  console.log(`Deals: ${lockedDeal.id} [deal_locked, blocked] | ${negotiatingDeal.id} [negotiating]`);
  console.log('\nLogin accounts (password for all:', SEED_PASSWORD, '):');
  console.log(`  Exporter owner  ${owner.email}  -> /app  [tier: paid]`);
  console.log(`  Exporter member ${member.email}  -> /app  [tier: paid]`);
  console.log(`  Exporter owner  ${freeOwner.email}  -> /app  [tier: free]`);
  console.log(`  Agent           ${agent.email}  -> /agent (assigned to ${org.display_name})`);
  console.log(`  Ops supervisor  ${opsSupervisor.email}  -> /ops`);
  console.log(`  Ops finance     ${opsFinance.email}  -> /ops/finance`);
  console.log(`  Admin           ${admin.email}  -> /ops/audit`);
  console.log(`\nGuest fixture: org ${guestOrg.id} (no login — guests are minted on first search).`);
}

/**
 * Trade warehouse fixture — the data Demand Discovery now ranks on.
 *
 * `WarehouseDiscoveryEngine` is the default engine, so with an empty `TradeFlow` table
 * every discovery run correctly returns "no data for this HS code" — accurate, and useless
 * as a fixture. This gives the seeded org's own products (turmeric HS 0910, bedsheets
 * HS 6302) something real to rank.
 *
 * Built by running the REAL `comtrade_ingest` job rather than inserting rows, so the seed
 * exercises the same handler production uses — upsert idempotency included, which is what
 * makes re-running `npm run db:seed` safe here. That also keeps this honest under the
 * AGENTS.md rule about seeds hand-placing end states: the ingest path is exercised, not
 * bypassed.
 *
 * Values come from the deterministic mock Comtrade client. They are plausible in shape and
 * stable across runs; they are not real trade figures, and the run's provenance says so.
 */
const WAREHOUSE_CHAPTERS = ['09', '63'];
/** Importing markets: US, Germany, UAE, UK, Japan, Australia. */
const WAREHOUSE_REPORTERS = ['842', '276', '784', '826', '392', '36'];
/** World (the denominator), India (the share), plus China/Brazil/Vietnam (the supplier spread). */
const WAREHOUSE_PARTNERS = ['0', '699', '156', '76', '704'];

async function seedTradeWarehouse(): Promise<number> {
  const { registerAllJobHandlers } = await import('@/lib/job-handlers');
  const { enqueueJob, claimNextJob, runClaimedJob } = await import('@/lib/jobs');
  const { JobType } = await import('@prisma/client');

  registerAllJobHandlers();

  // Five years so the 5-year CAGR the growth subscore needs has real history to read.
  const latestYear = new Date().getFullYear() - 1;
  const years = [4, 3, 2, 1, 0].map((back) => latestYear - back);

  for (const hs_chapter of WAREHOUSE_CHAPTERS) {
    for (const reporter of WAREHOUSE_REPORTERS) {
      for (const partner of WAREHOUSE_PARTNERS) {
        for (const year of years) {
          await enqueueJob({
            type: JobType.comtrade_ingest,
            payload: { hs_chapter, reporter, partner, year, flow_direction: 'import' },
            dedupe_key: `seed-comtrade:${hs_chapter}:${reporter}:${partner}:${year}`,
          });
        }
      }
    }
  }

  // Drain until nothing is left QUEUED, rather than stopping at the first null claim.
  // `claimNextJob` returning null does not mean the queue is empty — it also happens when
  // another process (a running `npm run worker`) won the race for every candidate it looked
  // at. Treating that as "done" is what silently left this fixture with gaps: the seed
  // exited early and the warehouse ended up missing whole years for some markets, which
  // then showed up downstream as markets with no measurable growth.
  for (;;) {
    const claimed = await claimNextJob([JobType.comtrade_ingest]);
    if (claimed) {
      await runClaimedJob({
        id: claimed.id,
        type: claimed.type,
        attempt_no: claimed.attempt_no,
        payload: claimed.payload,
        exporter_org_id: claimed.exporter_org_id,
        target_id: claimed.target_id,
        correlation_id: claimed.correlation_id,
      });
      continue;
    }
    const stillQueued = await prisma.job.count({
      where: { type: JobType.comtrade_ingest, status: 'queued' },
    });
    if (stillQueued === 0) break;
    // Someone else is working the queue; give them a moment rather than spinning.
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return prisma.tradeFlow.count();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
