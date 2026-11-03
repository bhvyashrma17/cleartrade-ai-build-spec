/**
 * Exporter market-scan requests, and the staff approval that releases the metered work.
 *
 * A global screen acquires one authoritative observation per reporting market — roughly 218
 * metered provider calls against a quota the whole platform shares. Phase 1F made execution
 * staff-initiated for that reason, and `runGlobalCountryScreening` re-checks the requesting
 * actor's role when the job runs.
 *
 * Phase 1I briefly let the exporter enqueue that job directly: the job was accepted, retried
 * three times and failed an hour later with an internal message the exporter never saw. This
 * module is the correct shape of that flow. The exporter records a REQUEST — which spends
 * nothing — and a permitted staff principal approves it, at which point approval calls the
 * canonical screening service rather than reimplementing any part of it.
 *
 * What the request deliberately cannot carry: reporters, countries, provider mode, quota,
 * scoring policy, screening policy, worker options. Every one of those is derived server-side
 * at approval time. There is no field here through which a client could shape metered work.
 */
import { assertEarlierEnginesRetired } from '@/lib/demand-discovery-v5/earlier-engines';
import { JobStatus, JobType, MarketScanRequestStatus, UserRole } from '@prisma/client';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { estimateGlobalCountryScreeningQuota } from '@/lib/country-screening/service';
import { forbidden, notFound, validationError } from '@/lib/errors';
import { assertCan, assertOrgAccess } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';
import { startMarketDiscovery, SCREENING_PRINCIPALS } from './service';

/** Statuses in which a request is still live and no rival request may be raised. */
export const OPEN_REQUEST_STATUSES = [
  MarketScanRequestStatus.pending,
  MarketScanRequestStatus.approved,
  MarketScanRequestStatus.queued,
  MarketScanRequestStatus.running,
] as const;

const EXPORTER_ROLES: readonly UserRole[] = [UserRole.exporter_owner, UserRole.exporter_member];

async function loadProductForRequest(actor: Principal, exporterOrgId: string, productId: string) {
  await assertOrgAccess(actor, exporterOrgId);
  const product = await prisma.product.findFirst({
    where: { id: productId, exporter_org_id: exporterOrgId },
    include: { classification_history: { where: { status: 'confirmed' }, orderBy: { revision: 'desc' }, take: 1 } },
  });
  // NOT_FOUND rather than FORBIDDEN: a product in another tenant must be indistinguishable from
  // one that does not exist, or the error code becomes an existence oracle.
  if (!product) throw notFound('That product does not exist.');
  return { product, classification: product.classification_history[0] ?? null };
}

/**
 * Is there already a completed screen that answers this exact question?
 *
 * Reuse is defined by the SAME identity the screening job's own dedupe key uses — the
 * classification plus the screening and period policy hashes — rather than by a wall-clock
 * timeout invented for the UI. That matters because re-screening across a policy release is a
 * genuinely different question, not a duplicate, and the existing code already says so.
 */
export async function currentScreeningRunFor(classificationId: string) {
  return prisma.countryScreeningRun.findFirst({
    where: { product_classification_id: classificationId, status: 'completed' },
    orderBy: { created_at: 'desc' },
  });
}

async function activeScreeningJobFor(exporterOrgId: string, classificationId: string) {
  return prisma.job.findFirst({
    where: {
      type: JobType.country_screening, exporter_org_id: exporterOrgId,
      target_type: 'product_classification', target_id: classificationId,
      status: { in: [JobStatus.queued, JobStatus.processing] },
    },
    orderBy: { created_at: 'desc' },
  });
}

export interface RequestOutcome {
  request: Awaited<ReturnType<typeof prisma.marketScanRequest.findFirstOrThrow>>;
  /** False when an equivalent request already existed and was returned instead. */
  created: boolean;
  /** Set when the request was satisfied without any metered work. */
  satisfied_by_existing_run: boolean;
}

/**
 * Record an exporter's request for a market scan.
 *
 * Idempotent three ways, because a button that is clicked five times must not produce five
 * pieces of metered work:
 *   1. An open request for this classification is returned as-is.
 *   2. An in-flight screening job means the work is already happening.
 *   3. A completed screen under the current policy identity means the answer already exists.
 * A partial unique index enforces (1) in the database, so two concurrent submits cannot both win.
 */
export async function requestMarketScan(args: {
  actor: Principal;
  exporter_org_id: string;
  product_id: string;
  correlation_id: string;
}): Promise<RequestOutcome> {
  assertEarlierEnginesRetired('Requesting a market scan');
  const { actor } = args;
  if (!EXPORTER_ROLES.includes(actor.role) && !SCREENING_PRINCIPALS.includes(actor.role)) {
    throw forbidden('Only the exporter or its ClearTrade agent may request a market scan.');
  }
  assertCan(actor, 'demand_discovery.run');
  const { product, classification } = await loadProductForRequest(actor, args.exporter_org_id, args.product_id);
  if (!classification) {
    throw validationError([{ field: 'product_id', code: 'classification_required', message: 'This product needs a confirmed HS classification before markets can be compared.' }]);
  }

  const open = await prisma.marketScanRequest.findFirst({
    where: { product_classification_id: classification.id, status: { in: [...OPEN_REQUEST_STATUSES] } },
    orderBy: { requested_at: 'desc' },
  });
  if (open) return { request: open, created: false, satisfied_by_existing_run: false };

  const [existingRun, activeJob] = await Promise.all([
    currentScreeningRunFor(classification.id),
    activeScreeningJobFor(args.exporter_org_id, classification.id),
  ]);

  // Nothing to approve: the work is already running or already answered. The request is still
  // recorded — the exporter asked, and the trail should show what they were told — but it is
  // closed immediately against the existing run rather than queued for a human.
  if (existingRun || activeJob) {
    const request = await prisma.marketScanRequest.create({
      data: {
        exporter_org_id: args.exporter_org_id, product_id: product.id,
        product_classification_id: classification.id,
        hs6_code: classification.hs6_code, hs_revision: classification.nomenclature_version,
        requested_by_id: actor.id, correlation_id: args.correlation_id,
        status: activeJob ? MarketScanRequestStatus.running : MarketScanRequestStatus.completed,
        screening_job_id: activeJob?.id ?? null,
        screening_run_id: existingRun?.id ?? null,
        resolution_note: activeJob
          ? 'A market scan for this product was already running when the request was made.'
          : 'A current market scan already covered this product, so no new scan was needed.',
      },
    });
    await writeAuditEvent({
      actor, action: AUDIT_ACTIONS.create, object_type: 'market_scan_request', object_id: request.id,
      exporter_org_id: args.exporter_org_id,
      after_summary: { status: request.status, reused: true, screening_run_id: request.screening_run_id, screening_job_id: request.screening_job_id },
      correlation_id: args.correlation_id,
    });
    return { request, created: true, satisfied_by_existing_run: !activeJob };
  }

  try {
    const request = await prisma.marketScanRequest.create({
      data: {
        exporter_org_id: args.exporter_org_id, product_id: product.id,
        product_classification_id: classification.id,
        hs6_code: classification.hs6_code, hs_revision: classification.nomenclature_version,
        requested_by_id: actor.id, correlation_id: args.correlation_id,
        status: MarketScanRequestStatus.pending,
      },
    });
    await writeAuditEvent({
      actor, action: AUDIT_ACTIONS.create, object_type: 'market_scan_request', object_id: request.id,
      exporter_org_id: args.exporter_org_id,
      after_summary: { status: request.status, product_id: product.id, classification_id: classification.id, hs6: classification.hs6_code },
      correlation_id: args.correlation_id,
    });
    return { request, created: true, satisfied_by_existing_run: false };
  } catch (error) {
    // The partial unique index is what actually enforces "one open request"; this pre-check
    // above only produces the friendly answer in the common case. Under a double-submit race
    // the loser lands here and is handed the winner.
    const raced = await prisma.marketScanRequest.findFirst({
      where: { product_classification_id: classification.id, status: { in: [...OPEN_REQUEST_STATUSES] } },
      orderBy: { requested_at: 'desc' },
    });
    if (!raced) throw error;
    return { request: raced, created: false, satisfied_by_existing_run: false };
  }
}


export interface OperationsOverview {
  pending_scan_requests: number;
  running_scans: number;
  products_with_analysis: number;
  agent_actions_outstanding: number;
  evidence_requiring_review: number;
  active_taric_release: string | null;
}

/**
 * The ops/admin Demand Discovery overview.
 *
 * Counts only — the detail lives in the tabs beneath it. An operations landing page exists to
 * answer "is anything stuck?", and loading twenty products' full evidence to render five numbers
 * would make the page slow at exactly the moment somebody needs it.
 */
export async function demandDiscoveryOperations(actor: Principal): Promise<OperationsOverview> {
  if (!SCREENING_PRINCIPALS.includes(actor.role)) throw forbidden('Only ClearTrade staff can view Demand Discovery operations.');
  assertCan(actor, 'demand_discovery.run');

  const [pending, running, runs, refinements, release] = await Promise.all([
    prisma.marketScanRequest.count({ where: { status: MarketScanRequestStatus.pending } }),
    prisma.job.count({ where: { type: JobType.country_screening, status: { in: [JobStatus.queued, JobStatus.processing] } } }),
    prisma.discoveryRun.count({ where: { status: { in: [JobStatus.completed, JobStatus.partial] } } }),
    // A refinement still awaiting a decision is evidence a human has to look at.
    prisma.productClassificationRefinement.count({ where: { state: 'refinement_required', superseded_at: null } }),
    prisma.authorityRelease.findFirst({
      where: { source_family: 'EU_TARIC', status: 'active' },
      select: { label: true },
    }),
  ]);

  // Outstanding ClearTrade work is derived per product by `agentCountryTruthWork`; counting it
  // here would mean loading every product's assessments. The queue itself reports the figure, so
  // the overview reports what it can cheaply and truthfully know.
  return {
    pending_scan_requests: pending,
    running_scans: running,
    products_with_analysis: runs,
    agent_actions_outstanding: refinements,
    evidence_requiring_review: refinements,
    active_taric_release: release?.label ?? null,
  };
}

/** The exporter's own view of where their request stands. */
export async function currentScanRequest(actor: Principal, exporterOrgId: string, productId: string) {
  const { classification } = await loadProductForRequest(actor, exporterOrgId, productId);
  if (!classification) return null;
  return prisma.marketScanRequest.findFirst({
    where: { product_classification_id: classification.id },
    orderBy: { requested_at: 'desc' },
  });
}

export interface StaffQueueEntry {
  id: string;
  status: MarketScanRequestStatus;
  exporter_org_id: string;
  exporter_name: string;
  product: { id: string; name: string };
  hs6_code: string;
  hs_revision: string;
  requested_at: string;
  requested_by: string;
  /** True when the product's confirmed classification has moved since the request was raised. */
  classification_stale: boolean;
  /** A completed screen that already covers this classification, if one exists. */
  existing_run: { id: string; completed_at: string; shortlist_size: number | null } | null;
  /** Canonical planner estimate, present only when a run exists to estimate against. */
  acquisition_estimate: { requires_acquisition: number; available_quota: number | null; can_execute_full_screen: boolean } | null;
}

/**
 * The staff review queue.
 *
 * Scoped by the same tenant rules as everything else: an agent sees their assigned exporters,
 * ops/admin see all. An unassigned agent's queue is empty rather than unscoped.
 */
export async function marketScanQueue(actor: Principal): Promise<StaffQueueEntry[]> {
  if (!SCREENING_PRINCIPALS.includes(actor.role)) throw forbidden('Only ClearTrade staff can review market scan requests.');
  assertCan(actor, 'demand_discovery.run');

  const { assignedOrgIds, isOps } = await import('@/lib/permissions');
  const scope = isOps(actor) ? {} : { exporter_org_id: { in: await assignedOrgIds(actor) } };
  const requests = await prisma.marketScanRequest.findMany({
    where: { status: MarketScanRequestStatus.pending, ...scope },
    orderBy: { requested_at: 'asc' },
    include: {
      exporter_org: { select: { display_name: true } },
      product: { select: { id: true, name: true, classification_history: { where: { status: 'confirmed' }, orderBy: { revision: 'desc' }, take: 1 } } },
      requested_by: { select: { name: true, email: true } },
    },
  });

  const entries: StaffQueueEntry[] = [];
  for (const request of requests) {
    const current = request.product.classification_history[0] ?? null;
    const run = await currentScreeningRunFor(request.product_classification_id);
    let estimate: StaffQueueEntry['acquisition_estimate'] = null;
    if (run) {
      // Only the canonical planner may state a provider cost; nothing here approximates one.
      const quota = await estimateGlobalCountryScreeningQuota(run.id).catch(() => null);
      if (quota) estimate = { requires_acquisition: quota.requires_acquisition, available_quota: quota.available_quota, can_execute_full_screen: quota.can_execute_full_screen };
    }
    entries.push({
      id: request.id, status: request.status,
      exporter_org_id: request.exporter_org_id, exporter_name: request.exporter_org.display_name,
      product: { id: request.product.id, name: request.product.name },
      hs6_code: request.hs6_code, hs_revision: request.hs_revision,
      requested_at: request.requested_at.toISOString(),
      requested_by: request.requested_by.name || request.requested_by.email,
      classification_stale: current?.id !== request.product_classification_id,
      existing_run: run ? { id: run.id, completed_at: run.updated_at.toISOString(), shortlist_size: run.shortlist_size } : null,
      acquisition_estimate: estimate,
    });
  }
  return entries;
}

/**
 * Approve a request and hand off to the canonical screening service.
 *
 * Everything is re-checked here, at decision time, rather than trusted from creation time:
 * the actor's role and tenant access, the request's state, and — critically — that the
 * product's confirmed classification is still the one the request was raised against. A
 * classification that moved means the exporter asked about a different product identity than
 * the one we would screen, so this fails closed and requires a fresh request rather than
 * quietly spending ~218 provider calls on a stale question.
 */
export async function approveMarketScan(args: { actor: Principal; request_id: string; correlation_id: string }) {
  assertEarlierEnginesRetired('Approving a market scan');
  const { actor } = args;
  if (!SCREENING_PRINCIPALS.includes(actor.role)) throw forbidden('Only ClearTrade staff can approve a market scan.');
  assertCan(actor, 'demand_discovery.run');

  const request = await prisma.marketScanRequest.findUnique({ where: { id: args.request_id } });
  if (!request) throw notFound('That market scan request does not exist.');
  await assertOrgAccess(actor, request.exporter_org_id);
  if (request.status !== MarketScanRequestStatus.pending) {
    throw validationError([{ field: 'status', code: 'not_pending', message: `This request is ${request.status} and can no longer be approved.` }]);
  }
  // An exporter must never be able to release their own metered work, even if they somehow hold
  // a staff role on another surface.
  if (request.requested_by_id === actor.id && EXPORTER_ROLES.includes(actor.role)) {
    throw forbidden('A market scan cannot be approved by the person who requested it.');
  }

  const product = await prisma.product.findUnique({
    where: { id: request.product_id },
    include: { classification_history: { where: { status: 'confirmed' }, orderBy: { revision: 'desc' }, take: 1 } },
  });
  const current = product?.classification_history[0] ?? null;
  if (!current || current.id !== request.product_classification_id
    || current.hs6_code !== request.hs6_code || current.nomenclature_version !== request.hs_revision) {
    await prisma.marketScanRequest.update({
      where: { id: request.id },
      data: {
        status: MarketScanRequestStatus.rejected, decided_by_id: actor.id, decided_at: new Date(),
        rejection_reason: 'This product’s customs classification changed after the scan was requested. Please request the scan again so it runs against the current classification.',
      },
    });
    throw validationError([{ field: 'product_classification_id', code: 'classification_changed', message: 'The product classification changed after this request was made; a new request is required.' }]);
  }

  // The canonical service. Approval does not reimplement screening, choose markets, pick a
  // provider mode or touch quota — it calls the same entry point an operator would.
  const { job, created } = await startMarketDiscovery(actor, request.exporter_org_id, request.product_id, args.correlation_id);

  const updated = await prisma.marketScanRequest.update({
    where: { id: request.id },
    data: {
      status: MarketScanRequestStatus.queued, decided_by_id: actor.id, decided_at: new Date(),
      screening_job_id: job.id,
      resolution_note: created ? null : 'An equivalent screen was already in flight; this request was attached to it.',
    },
  });
  await writeAuditEvent({
    actor, action: AUDIT_ACTIONS.approve, object_type: 'market_scan_request', object_id: request.id,
    exporter_org_id: request.exporter_org_id,
    before_summary: { status: request.status },
    after_summary: { status: updated.status, screening_job_id: job.id, job_status: job.status, screening_launched: created },
    correlation_id: args.correlation_id,
  });
  return { request: updated, job, created };
}

/** Reject a request, with a reason the exporter is shown verbatim. */
export async function rejectMarketScan(args: { actor: Principal; request_id: string; reason: string; correlation_id: string }) {
  const { actor } = args;
  if (!SCREENING_PRINCIPALS.includes(actor.role)) throw forbidden('Only ClearTrade staff can reject a market scan.');
  assertCan(actor, 'demand_discovery.run');
  const reason = args.reason.trim();
  if (!reason) throw validationError([{ field: 'reason', code: 'required', message: 'A rejection must say why, so the exporter knows what to do next.' }]);

  const request = await prisma.marketScanRequest.findUnique({ where: { id: args.request_id } });
  if (!request) throw notFound('That market scan request does not exist.');
  await assertOrgAccess(actor, request.exporter_org_id);
  if (request.status !== MarketScanRequestStatus.pending) {
    throw validationError([{ field: 'status', code: 'not_pending', message: `This request is ${request.status} and can no longer be rejected.` }]);
  }

  const updated = await prisma.marketScanRequest.update({
    where: { id: request.id },
    data: { status: MarketScanRequestStatus.rejected, decided_by_id: actor.id, decided_at: new Date(), rejection_reason: reason },
  });
  await writeAuditEvent({
    actor, action: AUDIT_ACTIONS.reject, object_type: 'market_scan_request', object_id: request.id,
    exporter_org_id: request.exporter_org_id,
    before_summary: { status: request.status },
    after_summary: { status: updated.status, rejection_reason: reason },
    correlation_id: args.correlation_id,
  });
  return updated;
}

/**
 * Bring a request's status into line with the screening job it launched.
 *
 * The request row is a view onto the job, not a second source of truth: it never advances on
 * its own, only to whatever the job actually did. Called on read so the exporter's page cannot
 * show `queued` for a job that finished an hour ago.
 */
export async function reconcileScanRequest(requestId: string) {
  const request = await prisma.marketScanRequest.findUnique({ where: { id: requestId } });
  if (!request?.screening_job_id) return request;
  if (![MarketScanRequestStatus.approved, MarketScanRequestStatus.queued, MarketScanRequestStatus.running].includes(request.status as never)) return request;

  const job = await prisma.job.findUnique({ where: { id: request.screening_job_id } });
  if (!job) return request;
  const next =
    job.status === JobStatus.processing ? MarketScanRequestStatus.running
      : job.status === JobStatus.completed || job.status === JobStatus.partial ? MarketScanRequestStatus.completed
        : job.status === JobStatus.failed || job.status === JobStatus.cancelled ? MarketScanRequestStatus.failed
          : MarketScanRequestStatus.queued;
  const runId = (job.result as { screening_run_id?: string } | null)?.screening_run_id ?? request.screening_run_id;
  if (next === request.status && runId === request.screening_run_id) return request;
  return prisma.marketScanRequest.update({ where: { id: request.id }, data: { status: next, screening_run_id: runId ?? null } });
}
