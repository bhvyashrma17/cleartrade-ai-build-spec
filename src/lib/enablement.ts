/**
 * EXP-03 Enablement Center — the classification layer over readiness tasks.
 *
 * `src/lib/job-handlers/readiness.ts` already creates one `Task` per finding, with
 * `task_type: readiness_<code>` and `priority: high` for a required finding vs `normal`
 * for a recommended one. This file is what turns that raw signal into the two things
 * EXP-03 needs on top of it:
 *
 *   - AC01 "required vs recommended visible" — `isRequiredReadinessTask()` reads the
 *     SAME priority field the job handler already writes, so the UI's grouping can never
 *     drift from what actually gated the readiness score.
 *   - AC03 "evidence review outcome is auditable" — a codified split between findings an
 *     exporter may self-attest (informational/process confirmations) and findings that
 *     require uploaded evidence an agent/ops reviews before the task can complete
 *     (regulatory identifiers, where a bare self-report is not verification — the same
 *     principle the readiness questionnaire itself already encodes for IEC/GST/AD code:
 *     "a number entered on its own is not verification").
 *
 * Both routes that touch task completion (`PATCH /api/v1/tasks/:taskId` and
 * `POST /api/v1/tasks/:taskId/self-complete`) import this so "server rejects protected
 * tasks" is enforced from ONE classification, not two copies that could disagree.
 */

import { TaskPriority } from '@prisma/client';

const READINESS_TASK_PREFIX = 'readiness_';

/** Findings that require uploaded, agent/ops-reviewed evidence before the task can complete. */
const EVIDENCE_REQUIRED_CODES = new Set(['iec', 'gst', 'ad_code']);

/** Findings the exporter may mark complete themselves — no external verification needed. */
const SELF_ATTESTABLE_CODES = new Set(['product', 'capacity', 'packaging_qc', 'samples']);

export function readinessCodeFromTaskType(taskType: string | null): string | null {
  if (!taskType?.startsWith(READINESS_TASK_PREFIX)) return null;
  return taskType.slice(READINESS_TASK_PREFIX.length);
}

export function isReadinessTask(taskType: string | null): boolean {
  return readinessCodeFromTaskType(taskType) !== null;
}

/** AC01: mirrors the job handler's own `priority: high` for a required finding. */
export function isRequiredReadinessTask(priority: TaskPriority): boolean {
  return priority === TaskPriority.high || priority === TaskPriority.urgent;
}

export function isEvidenceRequiredReadinessTask(taskType: string | null): boolean {
  const code = readinessCodeFromTaskType(taskType);
  return code !== null && EVIDENCE_REQUIRED_CODES.has(code);
}

export function isSelfAttestableReadinessTask(taskType: string | null): boolean {
  const code = readinessCodeFromTaskType(taskType);
  return code !== null && SELF_ATTESTABLE_CODES.has(code);
}

/** Plain-language "why it matters" copy — EXP-03's task row requirement. */
const WHY_IT_MATTERS: Record<string, string> = {
  product: 'Buyers and market matching both depend on a clear product description.',
  capacity: 'Buyers need to know you can actually fulfil the volumes they require.',
  iec: 'An Import Export Code is legally required to export from India.',
  gst: 'GST registration is required for export invoicing and compliance.',
  ad_code: 'An AD code from your bank is required to receive export payments.',
  packaging_qc: 'Buyers expect a documented packaging and quality-check process before they commit.',
  samples: 'Most buyers require an approved sample before placing a first order.',
};

export function whyItMatters(taskType: string | null): string | null {
  const code = readinessCodeFromTaskType(taskType);
  return code ? (WHY_IT_MATTERS[code] ?? null) : null;
}
