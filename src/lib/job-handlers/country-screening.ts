/**
 * Durable Stage A global country screening.
 *
 * The service beneath this handler is already resumable — every country's state lives in a row,
 * and compatible evidence is never reacquired — so the job's own contribution is narrow and
 * deliberate: it freezes the policy identity the screen was requested under, refuses to run if
 * that identity has drifted, and checkpoints the run id so a worker restart, a retry or a
 * duplicate execution reattaches to the same `CountryScreeningRun` rather than starting a
 * second one. A completed run short-circuits: re-running the job costs no provider call.
 *
 * It ends at the shortlist. Deep acquisition remains the existing `country_truth_discovery`
 * job's work, driven by the reporter set this one produces.
 */

import { JobStatus, JobType, ProductClassificationStatus, TradeSourceMode, UserRole, type Prisma } from '@prisma/client';
import { z } from 'zod';
import { canonicalHash } from '@/lib/country-evidence/planner';
import { getConfigWithVersion } from '@/lib/config';
import { createGlobalCountryScreeningRun, executeGlobalCountryScreeningRun, globalCountryScreeningShortlist } from '@/lib/country-screening/service';
import { enqueueJob, updateJobStage, type JobContext, type JobOutcome } from '@/lib/jobs';
import { prisma } from '@/lib/prisma';
import { requireCountryTruthClassification } from '@/lib/product-classification';

const payloadSchema = z.object({
  schema_version: z.literal('global-country-screening-job-v1'),
  exporter_org_id: z.string().min(1),
  product_id: z.string().min(1),
  product_classification_id: z.string().min(1),
  hs6: z.string().regex(/^\d{6}$/),
  hs_revision: z.enum(['2022', 'HS2022']),
  source_mode: z.enum([TradeSourceMode.authenticated, TradeSourceMode.fixture, TradeSourceMode.mock]),
  requested_by_agent_id: z.string().min(1),
  requested_at: z.string().datetime(),
  policies: z.object({
    country_screening: z.object({ config_version: z.number().int().positive(), policy_version: z.string().min(1), policy_hash: z.string().min(1), universe_version: z.string().min(1), screening_algorithm_version: z.string().min(1) }),
    country_period_selection: z.object({ config_version: z.number().int().positive(), policy_version: z.string().min(1), policy_hash: z.string().min(1), max_fallback_lookback_years: z.number().int().min(0) }),
  }),
});

type Payload = z.infer<typeof payloadSchema>;
type Checkpoint = { schema_version: 'global-country-screening-checkpoint-v1'; screening_run_id?: string; shortlist_reporters?: string[] };
const json = (value: unknown) => value as Prisma.InputJsonValue;

export function screeningPolicyIdentity(configured: { value: { policy_version: string; universe_version: string; screening_algorithm_version: string }; version: number }) {
  return { config_version: configured.version, policy_version: configured.value.policy_version, policy_hash: canonicalHash({ ...configured.value, config_version: configured.version }), universe_version: configured.value.universe_version, screening_algorithm_version: configured.value.screening_algorithm_version };
}

export function periodSelectionPolicyIdentity(configured: { value: { policy_version: string; max_fallback_lookback_years: number }; version: number }) {
  return { config_version: configured.version, policy_version: configured.value.policy_version, policy_hash: canonicalHash({ ...configured.value, config_version: configured.version }), max_fallback_lookback_years: configured.value.max_fallback_lookback_years };
}

async function validatePolicyIdentity(payload: Payload) {
  const configured = await getConfigWithVersion('country_screening.policy');
  const identity = screeningPolicyIdentity(configured);
  const frozen = payload.policies.country_screening;
  if (identity.config_version !== frozen.config_version || identity.policy_version !== frozen.policy_version || identity.policy_hash !== frozen.policy_hash || identity.universe_version !== frozen.universe_version || identity.screening_algorithm_version !== frozen.screening_algorithm_version) {
    throw new Error('Country screening policy identity no longer matches the frozen job payload.');
  }
  // The period policy decides which year each market is judged on, so drifting it mid-flight
  // would silently change the question the frozen job was approved to ask.
  const periodConfigured = await getConfigWithVersion('country_period_selection.policy');
  const periodIdentity = periodSelectionPolicyIdentity(periodConfigured);
  const frozenPeriod = payload.policies.country_period_selection;
  if (periodIdentity.config_version !== frozenPeriod.config_version || periodIdentity.policy_version !== frozenPeriod.policy_version || periodIdentity.policy_hash !== frozenPeriod.policy_hash || periodIdentity.max_fallback_lookback_years !== frozenPeriod.max_fallback_lookback_years) {
    throw new Error('Country period selection policy identity no longer matches the frozen job payload.');
  }
}

async function validateFrozenIdentity(ctx: JobContext, payload: Payload) {
  const job = await prisma.job.findUnique({ where: { id: ctx.job_id }, select: { type: true, exporter_org_id: true, requested_by_id: true, target_type: true, target_id: true, checkpoint: true } });
  if (!job || job.type !== JobType.country_screening || job.exporter_org_id !== payload.exporter_org_id || ctx.exporter_org_id !== payload.exporter_org_id || job.requested_by_id !== payload.requested_by_agent_id || job.target_type !== 'product_classification' || job.target_id !== payload.product_classification_id || ctx.target_id !== payload.product_classification_id) throw new Error('Country screening job identity does not match its frozen payload.');
  const actor = await prisma.user.findUnique({ where: { id: payload.requested_by_agent_id }, select: { role: true } });
  if (!actor || ![UserRole.agent, UserRole.ops_supervisor, UserRole.admin].includes(actor.role as 'agent' | 'ops_supervisor' | 'admin')) throw new Error('Country screening requesting actor is no longer a permitted staff principal.');
  const product = await prisma.product.findFirst({ where: { id: payload.product_id, exporter_org_id: payload.exporter_org_id }, select: { id: true, hs_classification_revision: true } });
  if (!product) throw new Error('Country screening product no longer belongs to the frozen exporter.');
  const classification = await requireCountryTruthClassification(payload.product_classification_id);
  if (classification.product_id !== product.id || classification.hs6_code !== payload.hs6 || classification.nomenclature_version !== payload.hs_revision || classification.status !== ProductClassificationStatus.confirmed || classification.revision !== product.hs_classification_revision) throw new Error('Country screening classification no longer matches the frozen job identity.');
  await validatePolicyIdentity(payload);
  return ((job.checkpoint ?? { schema_version: 'global-country-screening-checkpoint-v1' }) as unknown) as Checkpoint;
}

export async function runGlobalCountryScreening(ctx: JobContext): Promise<JobOutcome> {
  const parsed = payloadSchema.safeParse(ctx.payload);
  if (!parsed.success) throw new Error(`Invalid country_screening payload: ${parsed.error.issues.map(issue => issue.path.join('.')).join(', ')}`);
  const payload = parsed.data, stored = await validateFrozenIdentity(ctx, payload);
  const checkpoint: Checkpoint = { ...stored, schema_version: 'global-country-screening-checkpoint-v1' };
  const stage = async (name: string, progress: number, patch: Partial<Checkpoint> = {}) => {
    Object.assign(checkpoint, patch);
    if (ctx.reportStage) await ctx.reportStage(name, progress, json(checkpoint));
    else await updateJobStage(ctx.job_id, name, progress, json(checkpoint));
  };
  const asOf = new Date(payload.requested_at);
  if (Number.isNaN(asOf.getTime())) throw new Error('Country screening requested timestamp is invalid.');

  await stage('planning', 5);
  const run = await createGlobalCountryScreeningRun({ product_classification_id: payload.product_classification_id, as_of_date: asOf, source_mode: payload.source_mode });
  if (checkpoint.screening_run_id && checkpoint.screening_run_id !== run.id) throw new Error('Checkpointed country screening run does not match the frozen job identity.');
  if (run.hs_code !== payload.hs6 || run.hs_revision !== payload.hs_revision || run.policy_version !== payload.policies.country_screening.policy_version || run.policy_hash !== payload.policies.country_screening.policy_hash || run.universe_version !== payload.policies.country_screening.universe_version || run.period_selection_policy_version !== payload.policies.country_period_selection.policy_version || run.period_selection_policy_hash !== payload.policies.country_period_selection.policy_hash) throw new Error('Resolved country screening run does not match the frozen job identity.');

  await stage('screening', 25, { screening_run_id: run.id });
  const execution = await executeGlobalCountryScreeningRun(run.id);
  await stage('shortlisting', 85);
  const shortlist = await globalCountryScreeningShortlist(run.id);
  const reporters = shortlist.map(candidate => candidate.reporter_code);
  await stage('completed', 100, { shortlist_reporters: reporters });

  const complete = execution.status === 'completed';
  return {
    status: complete ? JobStatus.completed : JobStatus.partial,
    result: json({ schema_version: 'global-country-screening-result-v1', screening_run_id: run.id, screening_status: execution.status, universe_size: run.universe_size, preferred_period: run.screening_period, max_fallback_lookback_years: run.max_fallback_lookback_years, eligible_count: execution.eligible_count, shortlist_size: execution.shortlist_size, shortlist_reporters: reporters, shortlist, physical_calls: execution.physical_calls, total_physical_calls: execution.total_physical_calls, quota: execution.quota }),
  };
}

/**
 * Build the frozen job payload for one confirmed classification.
 *
 * Deliberately no country list: the whole point of Phase 1F is that the caller does not supply
 * candidate markets, so the request carries a product and a policy identity and nothing else.
 */
export async function buildGlobalCountryScreeningPayload(args: { exporter_org_id: string; product_id: string; product_classification_id: string; hs6: string; hs_revision: '2022' | 'HS2022'; source_mode: TradeSourceMode; requested_by_agent_id: string; requested_at?: Date }): Promise<Payload> {
  const configured = await getConfigWithVersion('country_screening.policy');
  return payloadSchema.parse({
    schema_version: 'global-country-screening-job-v1', exporter_org_id: args.exporter_org_id, product_id: args.product_id,
    product_classification_id: args.product_classification_id, hs6: args.hs6, hs_revision: args.hs_revision,
    source_mode: args.source_mode, requested_by_agent_id: args.requested_by_agent_id,
    requested_at: (args.requested_at ?? new Date()).toISOString(),
    policies: { country_screening: screeningPolicyIdentity(configured), country_period_selection: periodSelectionPolicyIdentity(await getConfigWithVersion('country_period_selection.policy')) },
  });
}

/** Enqueue one screen. The dedupe key is the frozen work identity, so a double submit is a no-op. */
export async function enqueueGlobalCountryScreening(args: Parameters<typeof buildGlobalCountryScreeningPayload>[0] & { correlation_id?: string }) {
  const payload = await buildGlobalCountryScreeningPayload(args);
  // The preferred period and the period policy are part of the work identity: re-screening
// across a release boundary is a different question, not a duplicate of the previous one.
const dedupeKey = `country_screening:${canonicalHash({ classification_id: payload.product_classification_id, policy_hash: payload.policies.country_screening.policy_hash, period_policy_hash: payload.policies.country_period_selection.policy_hash, requested_at: payload.requested_at, source_mode: payload.source_mode })}`;
  const job = await enqueueJob({ type: JobType.country_screening, payload: json(payload), exporter_org_id: payload.exporter_org_id, requested_by_id: payload.requested_by_agent_id, target_type: 'product_classification', target_id: payload.product_classification_id, dedupe_key: dedupeKey, correlation_id: args.correlation_id });
  return { job, payload };
}

export const __test__ = { payloadSchema, validatePolicyIdentity };
