/**
 * GET /api/v1/jobs/:id — universal job status polling (docs/09 §5).
 *
 * Authorization is the subtle part. A job id is an opaque cuid, but "unguessable" is not
 * access control, and docs/09 §5 names polling endpoints as one of the surfaces most
 * commonly left unchecked. Access is decided by the job's owning tenant:
 *
 *   - a job carrying `exporter_org_id` is readable by whoever can reach that org, via the
 *     same `canAccessOrg()` every other resource uses — so a guest sees only their own
 *     runs, an agent only their assigned orgs, ops everything;
 *   - a job with no tenant (a platform-level export) is ops-only;
 *   - anything else returns NOT_FOUND, never FORBIDDEN, so polling cannot be used to
 *     probe which job ids exist (docs/09 §4).
 */

import { JobStatus } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { errorResponse, newCorrelationId, notFound, single } from '@/lib/errors';
import { isTerminal } from '@/lib/jobs';
import { canAccessOrg, isOps } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  const correlationId = newCorrelationId();

  try {
    const principal = await requirePrincipal();
    const { jobId } = await context.params;

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        type: true,
        status: true,
        progress: true,
        progress_stage: true,
        exporter_org_id: true,
        target_type: true,
        target_id: true,
        result: true,
        error_code: true,
        error_message: true,
        attempts: true,
        max_attempts: true,
        started_at: true,
        completed_at: true,
        created_at: true,
        correlation_id: true,
      },
    });

    // Same answer for "no such job" and "not yours" — do not leak existence.
    if (!job) throw notFound('That job is not available.');
    const permitted = job.exporter_org_id
      ? await canAccessOrg(principal, job.exporter_org_id)
      : isOps(principal);
    if (!permitted) throw notFound('That job is not available.');

    const policy = await getConfig('jobs.policy');
    const done = isTerminal(job.status);

    return NextResponse.json(
      single(
        {
          job_id: job.id,
          type: job.type,
          status: job.status,
          progress: job.progress,
          progress_stage: job.progress_stage,
          target: job.target_type ? { type: job.target_type, id: job.target_id } : null,
          // Only a finished job has a meaningful result; exposing a partial one mid-flight
          // would invite the UI to render half a ranking as if it were final.
          result: done ? job.result : null,
          error: job.error_code
            ? { code: job.error_code, message: job.error_message }
            : null,
          attempts: job.attempts,
          max_attempts: job.max_attempts,
          started_at: job.started_at?.toISOString() ?? null,
          completed_at: job.completed_at?.toISOString() ?? null,
          created_at: job.created_at.toISOString(),
          // The reference id docs/09 §4 asks for on a failure.
          correlation_id: job.correlation_id,
        },
        {
          // Server-driven polling: the client should not hardcode an interval, and should
          // stop entirely once the job is terminal.
          poll_after_ms: done ? null : policy.client_poll_interval_ms,
          is_terminal: done,
          // `partial` is a success with gaps — flagged explicitly so the UI does not have
          // to infer it from the status string (docs/09 §3).
          is_partial: job.status === JobStatus.partial,
        },
      ),
      { headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
