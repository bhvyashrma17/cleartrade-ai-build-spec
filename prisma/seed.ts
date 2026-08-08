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

import { IecStatus, JourneyStage, OrgTier, ReadinessStatus, UserRole, VerificationStatus } from '@prisma/client';
import { hashPassword } from '@/lib/auth';
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
    update: { tier: OrgTier.paid },
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
  // Tier fixtures — one org per tier, so the paywall is testable without hand-rolling
  // rows. `seed-org-1` above is the paid tenant; these two are its free and guest peers.
  // ---------------------------------------------------------------------------

  const freeOrg = await prisma.exporterOrg.upsert({
    where: { id: 'seed-org-free' },
    update: { tier: OrgTier.free },
    create: {
      id: 'seed-org-free',
      display_name: 'Deccan Spice Traders',
      legal_name: 'Deccan Spice Traders LLP',
      country: 'IN',
      state: 'Telangana',
      city: 'Hyderabad',
      tier: OrgTier.free,
      upgraded_at: new Date('2026-07-01T00:00:00Z'),
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

  console.log('Seed complete.\n');
  console.log('ExporterOrg:', org.display_name, `(${org.id})`);
  console.log('Products:', turmeric.name, `(${turmeric.id})`, '|', bedsheets.name, `(${bedsheets.id})`);
  console.log('Buyers:', buyers.map((b) => `${b.display_name} [${b.verification_status}]`).join(', '));
  console.log('\nLogin accounts (password for all:', SEED_PASSWORD, '):');
  console.log(`  Exporter owner  ${owner.email}  -> /app  [tier: paid]`);
  console.log(`  Exporter owner  ${freeOwner.email}  -> /app  [tier: free]`);
  console.log(`  Agent           ${agent.email}  -> /agent (assigned to ${org.display_name})`);
  console.log(`  Ops supervisor  ${opsSupervisor.email}  -> /ops`);
  console.log(`\nGuest fixture: org ${guestOrg.id} (no login — guests are minted on first search).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
