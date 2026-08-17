/**
 * Server-derived sanctions source health (Part E).
 *
 * All state is computed HERE, on the server, from the active screening policy and the
 * database. `/ops/sanctions` renders the result and derives nothing itself — a dashboard
 * that recomputed policy in the browser could disagree with the gate that actually blocks
 * buyer screening, and the page would then be lying about the control.
 *
 * This module is read-only. It never mutates snapshots and is not itself a gate: buyer
 * screening keeps calling `sanctionsCoverage()`/`screenCounterparty()` directly.
 */

import { SanctionsCompletenessStatus, SanctionsSnapshotState, UserRole } from '@prisma/client';
import { canAccessPortal } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import {
  SANCTIONS_FRESHNESS_POLICY_STATUS,
  SANCTIONS_SCREENING_POLICY,
  sanctionsCoverage,
} from '@/lib/sanctions/screening';
import { datasetSchedules } from '@/lib/sanctions/scheduler';
import { SANCTIONS_SOURCE_CONTRACTS, type SanctionsSource } from '@/lib/sanctions/sources';
import { artifactRetentionRequired } from '@/lib/sanctions/artifact-store';

export type GlobalScreeningState = 'READY' | 'DEGRADED' | 'BLOCKED';

/**
 * Roles permitted to read sanctions source health (E5).
 *
 * Named here rather than inlined in the page so the gate is directly testable and so a future
 * page cannot widen it by accident. This is the SECOND of two gates: `requirePortalAccess('/ops')`
 * already excludes exporters, agents and unauthenticated callers by portal; this narrows the
 * Ops portal itself to supervisors and admins. Ops-finance is deliberately excluded — it has no
 * sanctions remit.
 */
export const SANCTIONS_OPS_ROLES: readonly UserRole[] = [UserRole.ops_supervisor, UserRole.admin];

/** Whether a role may read the sanctions source-health surface. Fails closed. */
export function canViewSanctionsSourceHealth(role: UserRole): boolean {
  return canAccessPortal(role, '/ops') && SANCTIONS_OPS_ROLES.includes(role);
}

export interface DatasetHealth {
  dataset: SanctionsSource;
  authority: string;
  dataset_name: string;
  source_contract_version: string;
  required: boolean;
  policy_approval: string;

  active_snapshot_id: string | null;
  lifecycle_state: SanctionsSnapshotState | null;
  completeness: SanctionsCompletenessStatus | null;
  evidence_origin: string | null;

  provider_published_at: Date | null;
  provider_version: string | null;
  retrieved_at: Date | null;
  age_hours: number | null;
  freshness_threshold_days: number;
  freshness_status: 'FRESH' | 'STALE' | 'UNKNOWN';

  retrieved_count: number | null;
  parsed_count: number | null;
  rejected_count: number | null;
  parse_error_count: number;
  anomaly_count: number;
  anomalies: { code: string; severity: string; detail: string }[];
  checksum_abbrev: string | null;

  artifact_retained: boolean;
  artifact_storage_provider: string | null;
  artifact_verification: string | null;
  artifact_required: boolean;

  last_complete_refresh: Date | null;
  latest_attempt_at: Date | null;
  latest_attempt_state: SanctionsSnapshotState | null;
  latest_failure_stage: string | null;
  latest_failure_reason: string | null;

  refresh_in_progress: boolean;
  next_refresh_at: Date | null;
  refresh_interval_hours: number;
  /** True when the newest attempt failed but an older COMPLETE snapshot is still serving. */
  serving_previous_after_failure: boolean;
}

export interface AuthorityRollup {
  authority: string;
  datasets: string[];
  complete: boolean;
  /** Named explicitly so a green authority chip can never hide a failed member dataset. */
  failing_datasets: string[];
}

export interface SanctionsSourceHealth {
  policy_version: string;
  global_state: GlobalScreeningState;
  global_reasons: string[];
  freshness_policy_status: string;
  freshness_threshold_days: number;
  datasets: DatasetHealth[];
  authorities: AuthorityRollup[];
}

const abbrev = (s: string | null | undefined) => (s && s !== 'unavailable' ? `${s.slice(0, 12)}…` : null);

export async function sanctionsSourceHealth(now = new Date()): Promise<SanctionsSourceHealth> {
  const required = [...SANCTIONS_SCREENING_POLICY.required_datasets] as SanctionsSource[];
  const [coverage, schedules, activeSnapshots, latestAttempts, artifacts] = await Promise.all([
    sanctionsCoverage(now),
    datasetSchedules(now),
    prisma.sanctionsSourceSnapshot.findMany({ where: { source: { in: required }, state: SanctionsSnapshotState.active } }),
    prisma.sanctionsSourceSnapshot.findMany({
      where: { source: { in: required } },
      orderBy: { fetched_at: 'desc' },
    }),
    prisma.sanctionsArtifact.findMany({ where: { dataset: { in: required } }, orderBy: { persisted_at: 'desc' } }),
  ]);

  const thresholdDays = coverage.max_age_days;
  const retentionRequired = artifactRetentionRequired();

  const datasets: DatasetHealth[] = required.map((dataset) => {
    const contract = SANCTIONS_SOURCE_CONTRACTS[dataset];
    const active = activeSnapshots.find((s) => s.source === dataset) ?? null;
    const latest = latestAttempts.find((s) => s.source === dataset) ?? null;
    const schedule = schedules.find((s) => s.dataset === dataset);
    const coverageRow = coverage.sources.find((s) => s.source === dataset);
    const artifact = active ? artifacts.find((a) => a.snapshot_id === active.id) ?? null : null;

    const ageHours = active?.last_successful_full_refresh
      ? Math.round(((now.getTime() - active.last_successful_full_refresh.getTime()) / 3_600_000) * 100) / 100
      : null;

    return {
      dataset,
      authority: contract.authority,
      dataset_name: contract.dataset_name,
      source_contract_version: contract.contract_version,
      required: true,
      policy_approval: SANCTIONS_SCREENING_POLICY.approvals.required_dataset_set,

      active_snapshot_id: active?.id ?? null,
      lifecycle_state: active?.state ?? null,
      completeness: active?.completeness_status ?? null,
      evidence_origin: active?.evidence_origin ?? null,

      provider_published_at: active?.source_update_date ?? null,
      provider_version: active?.source_version ?? null,
      retrieved_at: active?.fetched_at ?? null,
      age_hours: ageHours,
      freshness_threshold_days: thresholdDays,
      freshness_status: !active ? 'UNKNOWN' : coverageRow?.status === SanctionsCompletenessStatus.STALE ? 'STALE' : 'FRESH',

      retrieved_count: active?.retrieved_count ?? null,
      parsed_count: active?.parsed_entity_count ?? null,
      rejected_count: active?.rejected_records ?? null,
      parse_error_count: Array.isArray(active?.parse_errors) ? (active!.parse_errors as unknown[]).length : 0,
      anomaly_count: Array.isArray(active?.anomalies) ? (active!.anomalies as unknown[]).length : 0,
      anomalies: (Array.isArray(active?.anomalies) ? active!.anomalies : []) as DatasetHealth['anomalies'],
      checksum_abbrev: abbrev(active?.checksum),

      artifact_retained: Boolean(active?.artifact_ref),
      artifact_storage_provider: artifact?.storage_provider ?? null,
      artifact_verification: artifact?.verification_status ?? null,
      artifact_required: retentionRequired,

      last_complete_refresh: active?.last_successful_full_refresh ?? null,
      latest_attempt_at: latest?.fetched_at ?? null,
      latest_attempt_state: latest?.state ?? null,
      latest_failure_stage: latest && latest.failure_stage !== 'none' ? latest.failure_stage : null,
      latest_failure_reason: latest?.failure_reason ?? null,

      refresh_in_progress: schedule?.refresh_in_progress ?? false,
      next_refresh_at: schedule?.next_refresh_at ?? null,
      refresh_interval_hours: schedule?.interval_hours ?? 0,
      // E4: make "an older snapshot is serving because the newest attempt failed" explicit
      // rather than leaving Ops to infer it from two timestamps.
      serving_previous_after_failure: Boolean(active && latest && latest.id !== active.id && latest.state === SanctionsSnapshotState.rejected),
    };
  });

  // E2: the rollup comes from the SAME authorityCoverage() screening uses, so an authority
  // can never read green here while screening treats it as uncovered. Only the per-authority
  // list of which member datasets are failing is added on top.
  const authorities: AuthorityRollup[] = coverage.authorities.map((a) => ({
    authority: a.authority,
    datasets: a.datasets,
    complete: a.complete,
    failing_datasets: a.datasets.filter(
      (d) => coverage.sources.find((s) => s.source === d)?.status !== SanctionsCompletenessStatus.COMPLETE,
    ),
  }));

  // --- Global state, derived from the SAME coverage call screening uses -----
  const reasons: string[] = [];
  for (const d of datasets) {
    if (!d.active_snapshot_id) reasons.push(`${d.dataset}: no active snapshot`);
    else if (d.completeness !== SanctionsCompletenessStatus.COMPLETE) reasons.push(`${d.dataset}: snapshot is ${d.completeness}`);
    else if (d.freshness_status === 'STALE') reasons.push(`${d.dataset}: stale beyond the ${thresholdDays}-day threshold`);
    if (d.artifact_required && d.active_snapshot_id && !d.artifact_retained) reasons.push(`${d.dataset}: raw artifact not retained`);
  }
  const degraded = datasets.filter((d) => d.serving_previous_after_failure || d.latest_failure_stage);
  const globalState: GlobalScreeningState = !coverage.complete || reasons.length > 0 ? 'BLOCKED' : degraded.length > 0 ? 'DEGRADED' : 'READY';
  if (globalState === 'DEGRADED') {
    for (const d of degraded) reasons.push(`${d.dataset}: latest refresh failed (${d.latest_failure_stage ?? 'unknown stage'}); serving the previous COMPLETE snapshot`);
  }

  return {
    policy_version: SANCTIONS_SCREENING_POLICY.version,
    global_state: globalState,
    global_reasons: reasons,
    freshness_policy_status: SANCTIONS_FRESHNESS_POLICY_STATUS,
    freshness_threshold_days: thresholdDays,
    datasets,
    authorities,
  };
}
