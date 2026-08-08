/**
 * Handler registration.
 *
 * Importing this module wires every job type to its implementation. It lives outside
 * `src/lib/jobs.ts` for two reasons: the worker gets exactly one import to make, and the
 * queue mechanics never import a handler — which would be a cycle, since every handler
 * imports its types from the queue.
 *
 * Named `job-handlers/` rather than `jobs/` deliberately: a `jobs/` directory sitting
 * beside `jobs.ts` makes `@/lib/jobs` ambiguous to a reader even though the resolver
 * has a rule for it.
 *
 * Add a job type here when you add a handler; a type with no handler fails its jobs with
 * `NO_HANDLER` rather than silently leaving them queued forever.
 */

import { JobType } from '@prisma/client';
import { registerJobHandler } from '@/lib/jobs';
import { runDemandDiscovery } from '@/lib/job-handlers/discovery';
import { runDocumentGeneration } from '@/lib/job-handlers/documents';
import { runReadinessAssessment } from '@/lib/job-handlers/readiness';

let registered = false;

export function registerAllJobHandlers() {
  if (registered) return;
  registerJobHandler(JobType.demand_discovery, runDemandDiscovery);
  registerJobHandler(JobType.readiness_assessment, runReadinessAssessment);
  registerJobHandler(JobType.document_generation, runDocumentGeneration);
  // Not yet implemented — buyer_discovery, report_export. Jobs of those types fail fast
  // with NO_HANDLER instead of hanging.
  registered = true;
}
