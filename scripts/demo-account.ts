/**
 * A demonstration account on staging (D-033): one exporter with a login, one agent assigned to it,
 * a dated manual membership, and the Phase 1 archetype products with their HS codes confirmed — which
 * starts Demand Discovery v5 for each (D-018), whose top markets then go on to regional and buyer
 * discovery (D-019). Everything goes through the services the portal itself uses, and is audited.
 *
 *   DEMO_PASSWORD='<choose one>' npx tsx --env-file=<staging operator env> scripts/demo-account.ts setup --actor-email=<ops supervisor or admin> [--org-name="ClearTrade Demo Exporter"] [--exporter-email=demo-exporter@demo.invalid] [--agent-email=demo-agent@demo.invalid] [--products=carpets,rice,brassware]
 *   npx tsx --env-file=<staging operator env> scripts/demo-account.ts status [--exporter-email=demo-exporter@demo.invalid]
 *
 * Safe to repeat: it reuses the organisation, users, assignment and products it finds, renews the
 * membership only once it has run out, and confirms a product's code only once. The password is read
 * from DEMO_PASSWORD in the operator's own shell and is never printed. Refuses production.
 */
import { randomUUID } from 'node:crypto';
import { EvidenceOrigin, OrgTier, ProductClassificationMethod, ProductClassificationStatus, SubscriptionPlanCode, UserRole } from '@prisma/client';
import { hashPassword } from '@/lib/auth';
import { grantManualMembership } from '@/lib/billing/subscription-service';
import { BUYER_DISCOVERY_MODEL } from '@/lib/buyer-discovery/service';
import { getConfig } from '@/lib/config';
import { DEMAND_DISCOVERY_V5_MODEL } from '@/lib/demand-discovery-v5/policy';
import { PHASE_1_GATE_POLICY_V3 } from '@/lib/phase-1-gate/policy';
import { confirmClassification, proposeClassification } from '@/lib/product-classification';
import { prisma } from '@/lib/prisma';
import { validateDatabaseEnvironment } from '@/lib/runtime-config';
import type { Principal } from '@/types';

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)?.trim();
const USAGE = 'Usage: DEMO_PASSWORD=... demo-account.ts setup --actor-email=<ops supervisor or admin> [--org-name=...] [--exporter-email=...] [--agent-email=...] [--products=carpets,rice,brassware] | status [--exporter-email=...]';
const PRODUCT_NAMES: Record<string, string> = { carpets: 'Hand-knotted wool carpets', rice: 'Rice (basmati and non-basmati)', brassware: 'Brass and copper kitchenware' };
const MEMBERSHIP_DAYS = 30;

async function setup() {
  const password = process.env.DEMO_PASSWORD;
  if (!password || password.length < 10) throw new Error('Set DEMO_PASSWORD (10+ characters) in your own shell first. It is never printed.');
  const actorEmail = arg('actor-email')?.toLowerCase();
  if (!actorEmail) throw new Error(`Missing --actor-email. ${USAGE}`);
  const actorUser = await prisma.user.findUnique({ where: { email: actorEmail } });
  const staff: UserRole[] = [UserRole.ops_supervisor, UserRole.admin];
  if (!actorUser || !staff.includes(actorUser.role)) throw new Error(`${actorEmail} must be an existing ops supervisor or admin.`);
  const actor: Principal = { id: actorUser.id, email: actorUser.email, name: actorUser.name ?? '', role: actorUser.role, exporter_org_id: null, tier: OrgTier.paid };
  const correlationId = randomUUID();
  const orgName = arg('org-name') ?? 'ClearTrade Demo Exporter';
  const exporterEmail = (arg('exporter-email') ?? 'demo-exporter@demo.invalid').toLowerCase();
  const agentEmail = (arg('agent-email') ?? 'demo-agent@demo.invalid').toLowerCase();
  const keys = (arg('products') ?? 'carpets,rice,brassware').split(',').map((key) => key.trim()).filter(Boolean);
  const archetypes = PHASE_1_GATE_POLICY_V3.archetypes.value.filter((archetype) => keys.includes(archetype.key));
  if (archetypes.length !== keys.length) throw new Error(`--products must be some of ${PHASE_1_GATE_POLICY_V3.archetypes.value.map((a) => a.key).join(', ')}.`);
  const passwordHash = await hashPassword(password);

  let org = await prisma.exporterOrg.findFirst({ where: { display_name: orgName }, select: { id: true, tier: true, paid_until: true } });
  const orgCreated = !org;
  if (!org) org = await prisma.exporterOrg.create({ data: { display_name: orgName, legal_name: orgName, country: 'IN', tier: OrgTier.free }, select: { id: true, tier: true, paid_until: true } });

  const existingExporter = await prisma.user.findUnique({ where: { email: exporterEmail } });
  if (existingExporter && existingExporter.exporter_org_id !== org.id) throw new Error(`${exporterEmail} already belongs to another organisation; choose another --exporter-email.`);
  const exporter = existingExporter ?? await prisma.user.create({ data: { email: exporterEmail, name: `${orgName} (owner)`, role: UserRole.exporter_owner, exporter_org_id: org.id, password_hash: passwordHash } });
  if (existingExporter) await prisma.user.update({ where: { id: exporter.id }, data: { password_hash: passwordHash } });

  const existingAgent = await prisma.user.findUnique({ where: { email: agentEmail } });
  if (existingAgent && existingAgent.role !== UserRole.agent) throw new Error(`${agentEmail} exists but is not an agent; choose another --agent-email.`);
  const agent = existingAgent ?? await prisma.user.create({ data: { email: agentEmail, name: 'Demo agent', role: UserRole.agent, password_hash: passwordHash } });
  if (existingAgent) await prisma.user.update({ where: { id: agent.id }, data: { password_hash: passwordHash } });
  const assignment = await prisma.agentAssignment.findFirst({ where: { exporter_org_id: org.id, agent_user_id: agent.id, status: 'active' } });
  if (!assignment) await prisma.agentAssignment.create({ data: { exporter_org_id: org.id, agent_user_id: agent.id, status: 'active', assigned_by_id: actor.id, reason: 'Demonstration account (D-033).' } });

  let membership: 'granted' | 'active' = 'active';
  const now = new Date();
  if (org.tier !== OrgTier.paid || !org.paid_until || org.paid_until.getTime() <= now.getTime()) {
    const price = (await getConfig('billing.plans'))[SubscriptionPlanCode.premium_monthly];
    await grantManualMembership({
      exporterOrgId: org.id, planCode: SubscriptionPlanCode.premium_monthly, amount: price.amount, currency: price.currency,
      paidUntil: new Date(now.getTime() + MEMBERSHIP_DAYS * 86_400_000), actor, correlationId, reason: 'Staging demonstration account for the 24 Oct 2026 pitch (D-033).',
    });
    membership = 'granted';
  }

  const products = [];
  for (const archetype of archetypes) {
    const name = PRODUCT_NAMES[archetype.key] ?? archetype.label;
    let product = await prisma.product.findFirst({ where: { exporter_org_id: org.id, name }, select: { id: true, hs_code: true, hs_classification_status: true } });
    if (!product) product = await prisma.product.create({ data: { exporter_org_id: org.id, name, description: `${archetype.label}. Demonstration product.`, evidence_origin: EvidenceOrigin.manually_entered_real }, select: { id: true, hs_code: true, hs_classification_status: true } });
    let action: 'confirmed' | 'already_confirmed' = 'already_confirmed';
    if (!(product.hs_classification_status === ProductClassificationStatus.confirmed && product.hs_code === archetype.hs6)) {
      const candidate = await proposeClassification({
        product_id: product.id, hs6_code: archetype.hs6, itc_hs_code: null, nomenclature: 'HS', nomenclature_version: '2022', method: ProductClassificationMethod.agent_supplied, confidence: 1,
        rationale: `Demonstration product "${archetype.key}": ${archetype.label}, HS 2022 subheading ${archetype.hs6}.`,
        source_references: [{ label: 'Phase 1 gate policy v2, archetypes', reference: 'docs/34-phase-1-acceptance-gate.md §2' }], evidence: { archetype: archetype.key, demo: true },
      }, actor, correlationId);
      await confirmClassification({ classification_id: candidate.id, product_id: product.id }, actor, correlationId);
      action = 'confirmed';
    }
    const run = await prisma.discoveryRun.findFirst({ where: { product_id: product.id, model_version: DEMAND_DISCOVERY_V5_MODEL }, orderBy: { created_at: 'desc' }, select: { id: true, status: true } });
    products.push({ key: archetype.key, name, hs6: archetype.hs6, product_id: product.id, action, v5_run: run });
  }
  console.log(JSON.stringify({
    org: { id: org.id, name: orgName, created: orgCreated, membership }, exporter_login: exporter.email, agent_login: agent.email, password: '(DEMO_PASSWORD — not printed)', products,
    next: 'Wait for the v5 runs (scripts/demo-account.ts status), then open the portal as the exporter and as the agent.',
  }, null, 2));
}

async function status() {
  const exporterEmail = (arg('exporter-email') ?? 'demo-exporter@demo.invalid').toLowerCase();
  const exporter = await prisma.user.findUnique({ where: { email: exporterEmail }, select: { exporter_org_id: true } });
  if (!exporter?.exporter_org_id) throw new Error(`No exporter user ${exporterEmail}.`);
  const org = await prisma.exporterOrg.findUniqueOrThrow({ where: { id: exporter.exporter_org_id }, select: { id: true, display_name: true, tier: true, paid_until: true, products: { select: { id: true, name: true, hs_code: true, hs_classification_status: true } } } });
  const products = [];
  for (const product of org.products) {
    const run = await prisma.discoveryRun.findFirst({ where: { product_id: product.id, model_version: DEMAND_DISCOVERY_V5_MODEL }, orderBy: { created_at: 'desc' }, select: { id: true, status: true, completed_at: true } });
    const top = run ? await prisma.marketAssessment.findMany({ where: { run_id: run.id, market_status: 'ranked' }, orderBy: { rank: 'asc' }, take: 10, select: { id: true, country_code: true, rank: true, overall_score: true } }) : [];
    const focus = run ? await prisma.marketAssessment.findMany({ where: { run_id: run.id, country_code: { in: ['US', 'GB', 'CA'] } }, select: { id: true, country_code: true, rank: true, market_status: true } }) : [];
    const regional = [];
    for (const market of focus) {
      const latest = await prisma.regionalDemandRun.findFirst({ where: { market_assessment_id: market.id }, orderBy: { created_at: 'desc' }, select: { status: true, reason: true } });
      regional.push({ country_code: market.country_code, rank: market.rank, status: market.market_status, market_page: `/app/markets/${market.id}`, regional: latest ?? null });
    }
    const buyers = await prisma.buyerFitAssessment.groupBy({ by: ['product_id'], where: { exporter_org_id: org.id, product_id: product.id, model_version: BUYER_DISCOVERY_MODEL }, _count: true });
    products.push({ name: product.name, hs: product.hs_code, classification: product.hs_classification_status, v5_run: run, top10: top.map((m) => `${m.rank}. ${m.country_code} (${m.overall_score})`), us_gb_ca: regional, official_list_buyers: buyers[0]?._count ?? 0 });
  }
  console.log(JSON.stringify({ org: { id: org.id, name: org.display_name, tier: org.tier, paid_until: org.paid_until }, agent_page: `/agent/exporters/${org.id}?tab=buyers`, products }, null, 2));
}

async function main() {
  const database = validateDatabaseEnvironment('worker');
  if (database.environment === 'production' || process.env.DATABASE_ENVIRONMENT === 'production') throw new Error('demo-account refuses production.');
  console.log(JSON.stringify({ environment: database.environment, database_fingerprint: database.database_fingerprint.slice(0, 12) }));
  if (process.argv[2] === 'setup') return setup();
  if (process.argv[2] === 'status') return status();
  throw new Error(USAGE);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
