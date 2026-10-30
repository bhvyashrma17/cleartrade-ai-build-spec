/**
 * Demand Discovery v5 archetype runs (D-003; docs/36 §10 step 7): a v5 run for each Phase 1
 * archetype on staging, then each run's top 10 compared with India's real export destinations.
 *
 * The portal has no screen for adding a product (products come from sign-up or the seed scripts),
 * so `startArchetypeRuns` sets up what the step needs through the services the portal itself uses:
 * a test exporter made paid by a manual membership that the named staff account grants (dated and
 * audited, like a pilot comp), one product per archetype in the Phase 1 gate policy, and each
 * archetype's HS code proposed and confirmed with `proposeClassification` / `confirmClassification`.
 * The confirmation is audited and starts v5 for a paid tenant (D-018), exactly as in the portal.
 */
import { EvidenceOrigin, OrgTier, ProductClassificationMethod, ProductClassificationStatus, SubscriptionPlanCode, UserRole } from '@prisma/client';
import { grantManualMembership } from '@/lib/billing/subscription-service';
import { getConfig } from '@/lib/config';
import { compareRunWithIndiaExports } from '@/lib/demand-discovery-v5/calibration-report';
import { DEMAND_DISCOVERY_V5_MODEL } from '@/lib/demand-discovery-v5/policy';
import { dutyBasisOf, type DutyBasis } from '@/lib/demand-discovery-v5/duty-basis';
import { demandDiscoveryV5Availability, startDemandDiscoveryV5 } from '@/lib/demand-discovery-v5/service';
import { PHASE_1_GATE_POLICY_V2 } from '@/lib/phase-1-gate/policy';
import { confirmClassification, proposeClassification } from '@/lib/product-classification';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';

export const ARCHETYPE_EXPORTER_NAME = '[TEST] DD5 archetypes';
/** Dated, because a comp with no end date is how tenants quietly keep free access (subscription-service). */
export const ARCHETYPE_MEMBERSHIP_DAYS = 90;
const STAFF: readonly UserRole[] = [UserRole.agent, UserRole.ops_supervisor, UserRole.admin];
const FINISHED: readonly string[] = ['completed', 'partial'];

export const archetypeProductName = (label: string) => `[TEST] ${label}`;

export interface ArchetypeRun { id: string; status: string; created_at: string; completed_at: string | null; classification_id: string | null }

export interface ArchetypeStartItem {
  key: string;
  hs6: string;
  product_id: string;
  product_created: boolean;
  /** confirmed: the code was proposed and confirmed (which starts v5); started: a run was started for the
   * code already confirmed; left_alone: the confirmed code already has a run (use --rerun for a new one). */
  action: 'confirmed' | 'started' | 'left_alone';
  classification_id: string;
  run_started: boolean;
  /** Why no run started, in the service's own words. */
  not_started_reason: string | null;
  run: ArchetypeRun | null;
}

const describe = (error: unknown) => {
  const fields = (error as { fields?: { message?: string }[] } | null)?.fields?.map((field) => field.message).filter(Boolean) ?? [];
  return fields.length ? fields.join(' ') : error instanceof Error ? error.message : String(error);
};

async function findExporter() {
  const orgs = await prisma.exporterOrg.findMany({ where: { display_name: ARCHETYPE_EXPORTER_NAME }, select: { id: true, tier: true, paid_until: true }, take: 2 });
  if (orgs.length > 1) throw new Error(`More than one exporter is named "${ARCHETYPE_EXPORTER_NAME}"; resolve that by hand first.`);
  return orgs[0] ?? null;
}

async function latestV5Run(productId: string, classificationId?: string): Promise<ArchetypeRun | null> {
  const run = await prisma.discoveryRun.findFirst({
    where: { product_id: productId, model_version: DEMAND_DISCOVERY_V5_MODEL, ...(classificationId ? { classification_id: classificationId } : {}) },
    orderBy: { created_at: 'desc' },
    select: { id: true, status: true, created_at: true, completed_at: true, classification_id: true },
  });
  return run ? { id: run.id, status: run.status, created_at: run.created_at.toISOString(), completed_at: run.completed_at?.toISOString() ?? null, classification_id: run.classification_id } : null;
}

/**
 * Safe to repeat: it reuses the exporter and products, renews the membership only once it has run out,
 * never proposes a code that is already confirmed, and leaves a product alone once its confirmed code
 * has a v5 run unless `rerun` asks for a fresh one.
 */
export async function startArchetypeRuns(args: { actor: Principal; correlation_id: string; rerun?: boolean; now?: Date }) {
  if (!STAFF.includes(args.actor.role)) throw new Error('Archetype runs are set up by an agent, ops supervisor or admin.');
  const now = args.now ?? new Date();

  let org = await findExporter();
  const exporterCreated = !org;
  if (!org) org = await prisma.exporterOrg.create({ data: { display_name: ARCHETYPE_EXPORTER_NAME, country: 'IN', tier: OrgTier.free }, select: { id: true, tier: true, paid_until: true } });
  let membership: 'granted' | 'active' = 'active';
  if (org.tier !== OrgTier.paid || !org.paid_until || org.paid_until.getTime() <= now.getTime()) {
    // A membership records its plan's price (a subscription amount must be positive); a manual one moves no money.
    const price = (await getConfig('billing.plans'))[SubscriptionPlanCode.premium_monthly];
    await grantManualMembership({
      exporterOrgId: org.id, planCode: SubscriptionPlanCode.premium_monthly, amount: price.amount, currency: price.currency,
      paidUntil: new Date(now.getTime() + ARCHETYPE_MEMBERSHIP_DAYS * 86_400_000), actor: args.actor, correlationId: args.correlation_id,
      reason: 'Staging test exporter for the Demand Discovery v5 archetype runs (D-003, docs/36 §10 step 7).',
    });
    membership = 'granted';
  }

  const items: ArchetypeStartItem[] = [];
  for (const archetype of PHASE_1_GATE_POLICY_V2.archetypes.value) {
    const name = archetypeProductName(archetype.label);
    const select = { id: true, hs_code: true, hs_classification_status: true } as const;
    let product = await prisma.product.findFirst({ where: { exporter_org_id: org.id, name }, select });
    const productCreated = !product;
    if (!product) {
      product = await prisma.product.create({
        data: { exporter_org_id: org.id, name, description: `${archetype.label}. Test product for the Demand Discovery v5 archetype run (D-003).`, evidence_origin: EvidenceOrigin.manually_entered_real },
        select,
      });
    }
    const confirmed = product.hs_classification_status === ProductClassificationStatus.confirmed && product.hs_code === archetype.hs6
      ? await prisma.productClassification.findFirst({ where: { product_id: product.id, status: ProductClassificationStatus.confirmed, hs6_code: archetype.hs6 }, orderBy: { confirmed_at: 'desc' }, select: { id: true } })
      : null;

    if (!confirmed) {
      const candidate = await proposeClassification({
        product_id: product.id, hs6_code: archetype.hs6, itc_hs_code: null, nomenclature: 'HS', nomenclature_version: '2022',
        method: ProductClassificationMethod.agent_supplied, confidence: 1,
        rationale: `Phase 1 archetype "${archetype.key}": ${archetype.label}, HS 2022 subheading ${archetype.hs6} (docs/34 §2).`,
        source_references: [{ label: 'Phase 1 gate policy v2, archetypes', reference: 'docs/34-phase-1-acceptance-gate.md §2' }],
        evidence: { archetype: archetype.key, hs_revision: archetype.hs_revision, source: 'PHASE_1_GATE_POLICY_V2.archetypes' },
      }, args.actor, args.correlation_id);
      await confirmClassification({ classification_id: candidate.id, product_id: product.id }, args.actor, args.correlation_id);
      // `confirmClassification` records what its auto-start did on the classification's audit trail.
      const event = await prisma.auditEvent.findFirst({ where: { action: 'demand_discovery_auto_start', object_type: 'product_classification', object_id: candidate.id }, orderBy: { timestamp: 'desc' }, select: { after_summary: true } });
      const summary = (event?.after_summary ?? null) as { started?: boolean; reason?: string | null } | null;
      const run = await latestV5Run(product.id, candidate.id);
      items.push({
        key: archetype.key, hs6: archetype.hs6, product_id: product.id, product_created: productCreated, action: 'confirmed', classification_id: candidate.id,
        run_started: summary?.started === true, not_started_reason: summary?.started === true ? null : summary?.reason ?? 'No auto-start was recorded.', run,
      });
      continue;
    }

    const existing = await latestV5Run(product.id, confirmed.id);
    if (existing && !args.rerun) {
      items.push({ key: archetype.key, hs6: archetype.hs6, product_id: product.id, product_created: productCreated, action: 'left_alone', classification_id: confirmed.id, run_started: false, not_started_reason: null, run: existing });
      continue;
    }
    let reason: string | null = null;
    const availability = await demandDiscoveryV5Availability();
    if (!availability.available) reason = availability.reason;
    else {
      try { await startDemandDiscoveryV5({ product_id: product.id, actor: args.actor, trigger: 'manual', correlation_id: args.correlation_id }); }
      catch (error) { reason = describe(error); }
    }
    items.push({
      key: archetype.key, hs6: archetype.hs6, product_id: product.id, product_created: productCreated, action: 'started', classification_id: confirmed.id,
      run_started: reason == null, not_started_reason: reason, run: await latestV5Run(product.id, confirmed.id),
    });
  }
  return { exporter_org_id: org.id, exporter_created: exporterCreated, membership, items };
}

export { dutyBasisOf, type DutyBasis } from './duty-basis';

export interface ArchetypeStatusItem {
  key: string;
  hs6: string;
  product_id: string | null;
  run: ArchetypeRun | null;
  markets: {
    by_status: Record<string, number>;
    /** Over the markets v5 did not exclude. */
    duty_basis: Record<DutyBasis, number>;
    common_tariff_markets: Record<string, number>;
    /** Markets whose own tariff was read from a retained schedule (D-031), by schedule. */
    schedule_read_markets: Record<string, number>;
    top: { rank: number; market: string; overall: number | null }[];
  } | null;
  comparison: { verdict: string; overlap: number; top: number; india_top: string[]; run_top: string[]; missed: { market: string; status: string | null; rank: number | null }[] } | null;
  comparison_error: string | null;
}

export async function archetypeRunStatus(args: { compare?: boolean; top?: number } = {}) {
  const top = args.top ?? 10;
  const org = await findExporter();
  const items: ArchetypeStatusItem[] = [];
  for (const archetype of PHASE_1_GATE_POLICY_V2.archetypes.value) {
    const product = org ? await prisma.product.findFirst({ where: { exporter_org_id: org.id, name: archetypeProductName(archetype.label) }, select: { id: true } }) : null;
    const run = product ? await latestV5Run(product.id) : null;
    const item: ArchetypeStatusItem = { key: archetype.key, hs6: archetype.hs6, product_id: product?.id ?? null, run, markets: null, comparison: null, comparison_error: null };
    if (run && FINISHED.includes(run.status)) {
      const rows = await prisma.marketAssessment.findMany({ where: { run_id: run.id }, select: { country_code: true, market_status: true, rank: true, overall_score: true, score_breakdown: true } });
      const byStatus: Record<string, number> = {};
      const dutyBasis: Record<DutyBasis, number> = { official: 0, common_tariff: 0, schedule_read: 0, agent_recorded: 0, rule: 0, estimate: 0, none: 0 };
      const unions: Record<string, number> = {};
      const schedules: Record<string, number> = {};
      for (const row of rows) {
        const status = row.market_status ?? 'unknown';
        byStatus[status] = (byStatus[status] ?? 0) + 1;
        if (status === 'excluded') continue;
        const duty = dutyBasisOf(row.score_breakdown);
        dutyBasis[duty.basis] += 1;
        if (duty.union) unions[duty.union] = (unions[duty.union] ?? 0) + 1;
        if (duty.schedule) schedules[duty.schedule] = (schedules[duty.schedule] ?? 0) + 1;
      }
      const ranked = rows.filter((row): row is typeof row & { rank: number } => row.rank != null).sort((a, b) => a.rank - b.rank).slice(0, top);
      item.markets = { by_status: byStatus, duty_basis: dutyBasis, common_tariff_markets: unions, schedule_read_markets: schedules, top: ranked.map((row) => ({ rank: row.rank, market: row.country_code, overall: row.overall_score })) };
      if (args.compare !== false) {
        try {
          const report = await compareRunWithIndiaExports(run.id, top);
          item.comparison = {
            verdict: report.verdict, overlap: report.overlap, top: report.top,
            india_top: report.india_top.map((entry) => entry.market), run_top: report.run_top.map((entry) => entry.market),
            missed: report.missed.map((entry) => ({ market: entry.market, status: entry.status, rank: entry.rank })),
          };
        } catch (error) {
          item.comparison_error = describe(error);
        }
      }
    }
    items.push(item);
  }
  return { exporter_org_id: org?.id ?? null, items };
}
