/**
 * Regional demand (D-033, docs/38): request, run and read the regional view of one Demand Discovery
 * v5 market — where inside the market the product's imports arrive.
 *
 * A request creates a `RegionalDemandRun` and enqueues one `regional_demand_discovery` job for it.
 * Requests come from the market page (the exporter, their agent or ops), from the hand-off of a v5
 * run's top markets (D-019), or from the operator script. An unfinished run for the same market is
 * returned instead of starting a second one. Only markets with a configured official source are
 * accepted (`REGIONAL_SOURCES`).
 */
import { AuditSource, JobType, RegionalDemandStatus, type Prisma, type RegionalDemandRun } from '@prisma/client';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { DEMAND_DISCOVERY_V5_MODEL } from '@/lib/demand-discovery-v5/policy';
import { notFound, validationError } from '@/lib/errors';
import { enqueueJob } from '@/lib/jobs';
import { log } from '@/lib/observability';
import { assertCan, assertOrgAccess } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';
import { US_REGIONAL_SOURCE, type RegionalDemandResultV1 } from './census';

export interface RegionalSource {
  key: string;
  country_code: string;
  /** Who publishes the figures, as the market page names them. */
  publisher: string;
}

export const REGIONAL_SOURCES: Readonly<Record<string, RegionalSource>> = {
  US: { key: US_REGIONAL_SOURCE.key, country_code: 'US', publisher: 'U.S. Census Bureau' },
  GB: { key: 'uk_hmrc_importers', country_code: 'GB', publisher: 'HMRC' },
  CA: { key: 'ca_cid_major_importers', country_code: 'CA', publisher: 'Canadian Importers Database' },
};

export function regionalSourceFor(countryCode: string): RegionalSource | null {
  return REGIONAL_SOURCES[countryCode.toUpperCase()] ?? null;
}

export type RegionalTrigger = 'hand_off' | 'requested' | 'operator';
const OPEN: RegionalDemandStatus[] = [RegionalDemandStatus.queued, RegionalDemandStatus.running];

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function requestRegionalDemand(args: {
  market_assessment_id: string;
  actor: Principal | null;
  trigger: RegionalTrigger;
  correlation_id: string;
}): Promise<{ run: RegionalDemandRun; created: boolean }> {
  const assessment = await prisma.marketAssessment.findUnique({
    where: { id: args.market_assessment_id },
    select: { id: true, country_code: true, product_id: true, classification_hs6_code: true, model_version: true, run: { select: { exporter_org_id: true } } },
  });
  if (!assessment) throw notFound('That market is not available.');
  if (args.actor) {
    assertCan(args.actor, 'demand_discovery.run');
    await assertOrgAccess(args.actor, assessment.run.exporter_org_id);
  }
  const refuse = (field: string, code: string, message: string) => validationError([{ field, code, message }], message);
  if (assessment.model_version !== DEMAND_DISCOVERY_V5_MODEL) {
    throw refuse('market_assessment_id', 'not_v5', 'Regional demand reads a Demand Discovery v5 market. Run Demand Discovery again for this product first.');
  }
  const source = regionalSourceFor(assessment.country_code);
  if (!source) {
    throw refuse('country_code', 'not_available', `Regional figures for ${assessment.country_code} are not connected yet. They are available for ${Object.keys(REGIONAL_SOURCES).join(', ')}.`);
  }
  const hs6 = assessment.classification_hs6_code;
  if (!hs6 || !/^\d{6}$/.test(hs6)) {
    throw refuse('classification_hs6_code', 'required', 'This market has no confirmed six-digit HS code to look up.');
  }

  const open = await prisma.regionalDemandRun.findFirst({ where: { market_assessment_id: assessment.id, status: { in: OPEN } }, orderBy: { created_at: 'desc' } });
  if (open) return { run: open, created: false };

  const exporterOrgId = assessment.run.exporter_org_id;
  const run = await prisma.regionalDemandRun.create({
    data: {
      market_assessment_id: assessment.id, exporter_org_id: exporterOrgId, product_id: assessment.product_id, country_code: assessment.country_code,
      hs6_code: hs6, source_key: source.key, trigger: args.trigger, requested_by_id: args.actor?.id ?? null,
    },
  });
  try {
    const job = await enqueueJob({
      type: JobType.regional_demand_discovery, payload: { regional_demand_run_id: run.id }, exporter_org_id: exporterOrgId,
      requested_by_id: args.actor?.id ?? null, target_type: 'regional_demand_run', target_id: run.id,
      dedupe_key: `regional_demand:${assessment.id}`, correlation_id: args.correlation_id,
    });
    const updated = await prisma.regionalDemandRun.update({ where: { id: run.id }, data: { job_id: job.id } });
    await writeAuditEvent({
      actor: args.actor, action: AUDIT_ACTIONS.create, object_type: 'regional_demand_run', object_id: run.id, exporter_org_id: exporterOrgId,
      after_summary: { market_assessment_id: assessment.id, country_code: assessment.country_code, hs6_code: hs6, source_key: source.key, trigger: args.trigger, job_id: job.id },
      correlation_id: args.correlation_id, source: args.actor ? AuditSource.web : AuditSource.job,
    });
    return { run: updated, created: true };
  } catch (error) {
    // The run never started; say why rather than leave it queued with no job behind it.
    await prisma.regionalDemandRun.update({ where: { id: run.id }, data: { status: RegionalDemandStatus.failed, reason: describe(error), completed_at: new Date() } }).catch(() => undefined);
    throw error;
  }
}

/**
 * D-019: a finished v5 run hands its top markets on to regional discovery. Requests one run for each
 * handed-off market that has a regional source. Never throws: a hand-off that cannot start is logged
 * and the v5 run's own outcome stands.
 */
export async function requestHandOffRegionalDemand(discoveryRunId: string, correlationId: string): Promise<{ requested: string[]; refused: { country_code: string; reason: string }[] }> {
  const requested: string[] = [];
  const refused: { country_code: string; reason: string }[] = [];
  const markets = await prisma.marketAssessment.findMany({
    where: { run_id: discoveryRunId, handed_off: true, country_code: { in: Object.keys(REGIONAL_SOURCES) } },
    select: { id: true, country_code: true },
    orderBy: { rank: 'asc' },
  });
  for (const market of markets) {
    try {
      await requestRegionalDemand({ market_assessment_id: market.id, actor: null, trigger: 'hand_off', correlation_id: correlationId });
      requested.push(market.country_code);
    } catch (error) {
      refused.push({ country_code: market.country_code, reason: describe(error) });
      log('warn', 'regional_demand_hand_off_refused', { discovery_run_id: discoveryRunId, country_code: market.country_code, reason: describe(error) });
    }
  }
  return { requested, refused };
}

export interface RegionalRunView {
  id: string;
  status: RegionalDemandStatus;
  trigger: string;
  reason: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface RegionalDemandView {
  supported: boolean;
  publisher: string | null;
  /** The newest run of any status: what is happening now. */
  latest: RegionalRunView | null;
  /** The newest completed run and its figures: what the page shows. */
  shown: (RegionalRunView & { result: RegionalDemandResultV1 }) | null;
}

const runView = (run: RegionalDemandRun): RegionalRunView => ({
  id: run.id, status: run.status, trigger: run.trigger, reason: run.reason,
  created_at: run.created_at.toISOString(), completed_at: run.completed_at?.toISOString() ?? null,
});

/** What the market page needs. Callers must already have checked access to the market. */
export async function regionalDemandView(marketAssessmentId: string, countryCode: string, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<RegionalDemandView> {
  const source = regionalSourceFor(countryCode);
  if (!source) return { supported: false, publisher: null, latest: null, shown: null };
  const [latest, shown] = await Promise.all([
    db.regionalDemandRun.findFirst({ where: { market_assessment_id: marketAssessmentId }, orderBy: { created_at: 'desc' } }),
    db.regionalDemandRun.findFirst({ where: { market_assessment_id: marketAssessmentId, status: RegionalDemandStatus.completed }, orderBy: { completed_at: 'desc' } }),
  ]);
  return {
    supported: true,
    publisher: source.publisher,
    latest: latest ? runView(latest) : null,
    shown: shown && shown.result ? { ...runView(shown), result: shown.result as unknown as RegionalDemandResultV1 } : null,
  };
}
