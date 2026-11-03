/**
 * Screening run → Deep Country Truth: the production entry point.
 *
 * Gap B. The pilot surface (`requestCountryTruthDiscovery`) takes country names and resolves
 * them through a three-country alias table, so a Phase 1G global shortlist could not be handed
 * to the engine at all — the 20-market deep baseline had to be driven by an operator script.
 * This module closes that: the caller names a COMPLETED screening run and nothing else about
 * which markets to analyse. The shortlist is read from the frozen run, so there is no request
 * field through which a client could add, remove or substitute a market after screening closed.
 *
 * The pilot surface is untouched and still serves the exporter-facing route.
 */
import { assertEarlierEnginesRetired } from '@/lib/demand-discovery-v5/earlier-engines';
import { JobType, type Prisma } from '@prisma/client';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { getConfig } from '@/lib/config';
import { comtradeReporterRegistry } from '@/lib/comtrade/reporter-registry';
import { planDeepCountryTruthFromScreening, globalCountryScreeningShortlist } from '@/lib/country-screening/service';
import { forbidden, notFound, validationError } from '@/lib/errors';
import { enqueueJob, findInFlightJob } from '@/lib/jobs';
import { assertCan, assertOrgAccess } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { UserRole } from '@prisma/client';
import type { Principal } from '@/types';
import {
  buildCountryTruthDiscoveryPayload,
  countryTruthDiscoveryDedupeKey,
  resolveCountryTruthClassificationContext,
  type CountryTruthDiscoveryPayload,
} from '@/lib/country-truth-discovery-request';

const COMPLETED = 'completed';

export interface DeepCountryTruthRequestArgs {
  actor: Principal;
  exporter_org_id: string;
  product_id: string;
  screening_run_id: string;
  correlation_id: string;
}

/**
 * Request Deep Country Truth for every market a completed global screen shortlisted.
 *
 * Idempotent through the job dedupe key, which includes the screening run identity: repeating
 * the same request while the job is in flight returns that job rather than starting a rival one.
 */
export async function requestDeepCountryTruthFromScreening(args: DeepCountryTruthRequestArgs) {
  assertEarlierEnginesRetired('A detailed Country Truth analysis');
  const { actor } = args;
  const allowedRoles: readonly UserRole[] = [UserRole.agent, UserRole.ops_supervisor, UserRole.admin];
  if (!allowedRoles.includes(actor.role)) throw forbidden('Only assigned Agents or authorized operations staff can request Country Truth analysis.');
  assertCan(actor, 'demand_discovery.run');
  // Tenant authorization is server-side and is checked against the exporter org named in the
  // request, before anything about the screening run is read.
  await assertOrgAccess(actor, args.exporter_org_id);

  const run = await prisma.countryScreeningRun.findUnique({ where: { id: args.screening_run_id } });
  if (!run) throw notFound('That country screening run does not exist.');
  // A provisional shortlist is still moving. Spending roughly eleven provider calls per market
  // on an answer the next execution may change is the exact waste Stage A exists to prevent.
  if (run.status !== COMPLETED) {
    throw validationError([{ field: 'screening_run_id', code: 'screening_incomplete', message: `Country screening run ${run.id} is ${run.status}; deep Country Truth requires a completed screen.` }]);
  }

  const context = await resolveCountryTruthClassificationContext(args.exporter_org_id, args.product_id);
  // The screen was run FOR a classification. Analysing a different product against its shortlist
  // would silently reuse another product's market selection.
  if (run.product_classification_id !== context.classification.id) {
    throw validationError([{ field: 'screening_run_id', code: 'classification_mismatch', message: 'That screening run was produced for a different product classification.' }]);
  }
  if (run.hs_code !== context.hs6 || run.hs_revision !== context.classification.nomenclature_version) {
    throw validationError([{ field: 'screening_run_id', code: 'classification_mismatch', message: 'That screening run was produced for a different HS identity.' }]);
  }

  const shortlist = await globalCountryScreeningShortlist(run.id);
  if (!shortlist.length) throw validationError([{ field: 'screening_run_id', code: 'empty_shortlist', message: 'That screening run shortlisted no markets; deep Country Truth has nothing to acquire.' }]);
  const policy = await getConfig('country_screening.policy');
  if (shortlist.length > policy.max_shortlist_size) {
    throw validationError([{ field: 'screening_run_id', code: 'shortlist_too_large', message: `That screening run shortlisted ${shortlist.length} markets, above the configured maximum of ${policy.max_shortlist_size}.` }]);
  }

  // Country identity comes from the checked-in provider reporter reference, never from an alias
  // table and never from the request. A reporter the registry cannot round-trip is refused
  // rather than analysed under a guessed ISO identity.
  const registry = comtradeReporterRegistry();
  const byReporter = new Map(registry.reporters.map((entry) => [entry.reporter_code, entry]));
  const candidates = shortlist.map((candidate) => {
    const entry = byReporter.get(candidate.reporter_code);
    if (!entry) throw validationError([{ field: 'screening_run_id', code: 'unknown_reporter', message: `Shortlisted reporter ${candidate.reporter_code} is not in reporter registry ${registry.version}.` }]);
    if (entry.iso2.toUpperCase() !== candidate.country_code.toUpperCase()) {
      throw validationError([{ field: 'screening_run_id', code: 'reporter_identity_conflict', message: `Reporter ${candidate.reporter_code} resolves to ${entry.iso2} but the screening result recorded ${candidate.country_code}.` }]);
    }
    return { country_code: entry.iso2.toUpperCase(), country_name: candidate.country_name, reporter_code: candidate.reporter_code };
  }).sort((left, right) => left.reporter_code.localeCompare(right.reporter_code));

  // Build (or reuse) the canonical deep plan through the existing Phase 1G bridge, so the plan
  // this job binds to is the same one an operator dry-plan would produce.
  const plan = await planDeepCountryTruthFromScreening(run.id);
  const planReporters = [...plan.candidate_reporters].sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(planReporters) !== JSON.stringify(candidates.map((item) => item.reporter_code).sort((left, right) => left.localeCompare(right)))) {
    throw validationError([{ field: 'screening_run_id', code: 'plan_shortlist_mismatch', message: 'The deep evidence plan does not cover exactly the frozen shortlist.' }]);
  }
  if (plan.screening_run_id == null) {
    await prisma.countryEvidencePlan.update({ where: { id: plan.id }, data: { screening_run_id: run.id } });
  } else if (plan.screening_run_id !== run.id) {
    throw validationError([{ field: 'screening_run_id', code: 'plan_belongs_to_other_run', message: `Deep evidence plan ${plan.id} already belongs to screening run ${plan.screening_run_id}.` }]);
  }

  const windows = (plan.reporter_period_windows ?? null) as Record<string, number[]> | null;
  const payload = await buildCountryTruthDiscoveryPayload({
    context,
    exporter_org_id: args.exporter_org_id,
    candidates,
    requested_by_agent_id: actor.id,
    // The scoring clock IS the frozen screen's as-of date, which is what makes the job re-derive
    // this plan instead of minting a new one under a wall-clock date.
    requested_at: plan.as_of_date,
    reporter_period_windows: windows ?? undefined,
    preferred_period: plan.preferred_period ?? undefined,
    provenance: {
      screening_run_id: run.id,
      screening_run_key: run.run_key,
      screening_policy_version: run.policy_version,
      screening_policy_hash: run.policy_hash,
      shortlist_size: shortlist.length,
      shortlist_reporters: candidates.map((item) => item.reporter_code),
      country_evidence_plan_id: plan.id,
      country_evidence_plan_key: plan.plan_key,
    },
  });

  const dedupeKey = countryTruthDiscoveryDedupeKey(payload);
  const existing = await findInFlightJob(dedupeKey);
  if (existing) return { job: existing, payload: existing.payload as unknown as CountryTruthDiscoveryPayload, plan, created: false };

  let job;
  try {
    job = await enqueueJob({ type: JobType.country_truth_discovery, payload: payload as unknown as Prisma.InputJsonValue, exporter_org_id: args.exporter_org_id, requested_by_id: actor.id, target_type: 'product_classification', target_id: context.classification.id, dedupe_key: dedupeKey, correlation_id: args.correlation_id });
  } catch (error) {
    const raced = await findInFlightJob(dedupeKey);
    if (!raced) throw error;
    return { job: raced, payload: raced.payload as unknown as CountryTruthDiscoveryPayload, plan, created: false };
  }
  await writeAuditEvent({
    actor,
    action: AUDIT_ACTIONS.create,
    object_type: 'country_truth_job',
    object_id: job.id,
    exporter_org_id: args.exporter_org_id,
    after_summary: {
      source: 'global_country_screening',
      screening_run_id: run.id,
      screening_run_key: run.run_key,
      country_evidence_plan_id: plan.id,
      country_evidence_plan_key: plan.plan_key,
      product_id: context.product.id,
      classification_id: context.classification.id,
      hs6: payload.hs6,
      shortlist_size: shortlist.length,
      reporter_codes: candidates.map((item) => item.reporter_code),
      exporter_fact_snapshot_checksum: payload.exporter_fact_snapshot_checksum,
      policy_hashes: Object.values(payload.policies).map((item) => item.policy_hash),
    },
    correlation_id: args.correlation_id,
  });
  return { job, payload, plan, created: true };
}
