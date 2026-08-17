/**
 * Demand Discovery control — the read model behind the agent's market control surface.
 *
 * Two rules govern this whole file:
 *
 *   1. **The model's output is read, never recomputed.** Weights in particular: the effective
 *      (renormalised) weights are decided by the scoring engine when a component turns out to
 *      be unavailable, and are written onto the assessment's `field_provenance`. Recomputing
 *      them here — even with the same formula — would produce a number that merely looks like
 *      the one that made the score, and would silently diverge the moment the engine changed.
 *
 *   2. **There is no blended score.** `operationalOrder` is a workflow ordering, not a score
 *      and not an "effective AI rank". It is labelled as such everywhere it surfaces, and the
 *      AI rank/score remain separately readable on every row.
 *
 * NOTE ON WHERE WEIGHTS LIVE: the brief specified `scoring_policy_snapshot`. That column holds
 * the *policy* (base weights and archetype profiles) — it does not hold what was actually
 * applied to a given country, because renormalisation is per-assessment. The applied values
 * are on `field_provenance`, written by warehouse-engine.ts. This module reads both from where
 * they genuinely are; see `readWeights`.
 */

import { AgentDecisionAction, type AgentDecision, type MarketAssessment, type Prisma } from '@prisma/client';
import { effectiveState as decisionState, type AgentDecisionState } from '@/lib/agent-decisions';
import { prisma as prismaDefault } from '@/lib/prisma';

type PrismaLike = Prisma.TransactionClient | typeof prismaDefault;

// ---------------------------------------------------------------------------
// State buckets
// ---------------------------------------------------------------------------

/**
 * What an agent's current decision means for workflow placement.
 *
 * `terminal` is the load-bearing one: a rejected market must not fall back to its model rank,
 * because that would place a market the agent explicitly removed back among the live
 * candidates purely on the strength of the AI's opinion — the exact override-erasure this
 * layer exists to prevent.
 */
export type OperationalBucket = 'active' | 'flagged' | 'terminal';

const TERMINAL_ACTIONS: readonly AgentDecisionAction[] = [
  AgentDecisionAction.reject,
  AgentDecisionAction.mark_not_selected,
  // Phase 3 buyer equivalents, listed here so the single bucketing rule covers both targets.
  AgentDecisionAction.disqualify,
  AgentDecisionAction.unqualify,
];

/** Still operationally live, but carrying a state the agent must see. */
const FLAGGED_ACTIONS: readonly AgentDecisionAction[] = [
  AgentDecisionAction.pause_automation,
  AgentDecisionAction.request_review,
];

/**
 * Bucket a candidate from its CURRENT decision.
 *
 * A decision that is superseded or expired is not current, so the caller passes null and the
 * candidate is `active` — which is the correct reading of `restore`: it returns the candidate
 * to the active list, and whether it then carries an agent priority depends on whether the
 * restoring decision supplied one.
 */
export function bucketFor(current: Pick<AgentDecision, 'action'> | null): OperationalBucket {
  if (!current) return 'active';
  if (TERMINAL_ACTIONS.includes(current.action)) return 'terminal';
  if (FLAGGED_ACTIONS.includes(current.action)) return 'flagged';
  return 'active';
}

// ---------------------------------------------------------------------------
// Operational order
// ---------------------------------------------------------------------------

export interface OperationalCandidate {
  /** The model's rank within its run. Null when the model produced no score. */
  modelRank: number | null;
  current: (AgentDecision & { state: AgentDecisionState }) | null;
}

/**
 * The workflow ordering for one candidate: `agent_priority ?? model_rank`, and only for
 * candidates that are operationally eligible.
 *
 * Returns null — rendered as "—" — for terminal candidates and for candidates the model never
 * scored. Null is deliberate rather than a large sentinel number: a sentinel would sort into
 * the list and read as a real position, which is precisely the fake rank the brief forbids.
 */
export function operationalOrder(candidate: OperationalCandidate): number | null {
  if (bucketFor(candidate.current) === 'terminal') return null;
  return candidate.current?.agent_priority ?? candidate.modelRank;
}

const BUCKET_SORT: Record<OperationalBucket, number> = { active: 0, flagged: 0, terminal: 1 };

/**
 * Sort candidates into operational order.
 *
 * Terminal candidates sort after everything else and keep a null order rather than being
 * dropped, so an "All" view can show them with their state instead of pretending they never
 * existed. Within a bucket, a candidate with no order (model produced no score) sorts last —
 * unranked is not the same as ranked-poorly, and hoisting it to the top would invent a
 * priority the model never expressed.
 */
export function sortByOperationalOrder<T extends OperationalCandidate>(candidates: T[]): T[] {
  return [...candidates].sort((a, b) => {
    const bucketDelta = BUCKET_SORT[bucketFor(a.current)] - BUCKET_SORT[bucketFor(b.current)];
    if (bucketDelta !== 0) return bucketDelta;
    const aOrder = operationalOrder(a);
    const bOrder = operationalOrder(b);
    if (aOrder === null && bOrder === null) return 0;
    if (aOrder === null) return 1;
    if (bOrder === null) return -1;
    return aOrder - bOrder;
  });
}

/** The default agent view hides terminal candidates; "All" shows them, sorted last. */
export function activeOnly<T extends OperationalCandidate>(candidates: T[]): T[] {
  return candidates.filter((c) => bucketFor(c.current) !== 'terminal');
}

// ---------------------------------------------------------------------------
// Reading the model's own numbers — never recomputing them
// ---------------------------------------------------------------------------

/** The eight scored components, in display order, with their score and weight-profile key. */
export const COMPONENTS = [
  { field: 'demand_score', weightKey: 'demand_strength', label: 'Demand strength' },
  { field: 'growth_score', weightKey: 'growth_momentum', label: 'Growth momentum' },
  { field: 'competition_score', weightKey: 'competitive_opportunity', label: 'Competitive opportunity' },
  { field: 'market_access_score', weightKey: 'market_access', label: 'Market access' },
  { field: 'export_economics_score', weightKey: 'export_economics', label: 'Export economics' },
  { field: 'exporter_market_fit_score', weightKey: 'exporter_market_fit', label: 'Exporter–market fit' },
  { field: 'logistics_feasibility_score', weightKey: 'logistics_feasibility', label: 'Logistics feasibility' },
  { field: 'risk_resilience_score', weightKey: 'risk_resilience', label: 'Risk resilience' },
] as const;

export type ComponentField = (typeof COMPONENTS)[number]['field'];

export interface ComponentView {
  field: ComponentField;
  label: string;
  score: number | null;
  /** From the weight profile, as recorded on this assessment. Null when not recorded. */
  baseWeight: number | null;
  /** Renormalised weight actually applied, as recorded by the engine. Never recomputed. */
  effectiveWeight: number | null;
  /** Present only when the engine could not compute the component. */
  unavailableReason: string | null;
  /** Whatever provenance the engine recorded — source, basis, retrieval, evidence ids. */
  provenance: Record<string, unknown> | null;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const asNumber = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/**
 * Read base and effective weights for one component from the assessment's provenance.
 *
 * Two locations, because the engine writes both: per-component
 * (`component_weight` / `effective_renormalized_weight`) and once at the overall level
 * (`overall_score.input_evidence.base_weights` / `.effective_weights`). The per-component
 * values win; the overall block is the fallback for rows written before the per-component
 * decoration existed. Anything absent stays null rather than being derived — a weight this
 * module invented would be indistinguishable from one the engine applied.
 */
function readWeights(
  provenance: Record<string, unknown> | null,
  componentProvenance: Record<string, unknown> | null,
  weightKey: string,
): { baseWeight: number | null; effectiveWeight: number | null } {
  const direct = {
    baseWeight: asNumber(componentProvenance?.component_weight),
    effectiveWeight: asNumber(componentProvenance?.effective_renormalized_weight),
  };
  if (direct.baseWeight !== null || direct.effectiveWeight !== null) return direct;

  const overall = asRecord(provenance?.overall_score);
  const inputEvidence = asRecord(overall?.input_evidence);
  return {
    baseWeight: asNumber(asRecord(inputEvidence?.base_weights)?.[weightKey]),
    effectiveWeight: asNumber(asRecord(inputEvidence?.effective_weights)?.[weightKey]),
  };
}

/**
 * The AI half of the control surface: every component with its score, both weights, and the
 * reason it is missing when it is.
 *
 * `{status:'unavailable', reason}` is the engine's own shape for a gap (docs/04 EXP-04-AC02
 * forbids fabricating a missing value), so a gap is surfaced as a gap rather than collapsing
 * to a null score that reads as a genuine zero.
 */
export function componentViews(assessment: MarketAssessment): ComponentView[] {
  const provenance = asRecord(assessment.field_provenance);
  return COMPONENTS.map(({ field, weightKey, label }) => {
    const componentProvenance = asRecord(provenance?.[field]);
    const unavailable = componentProvenance?.status === 'unavailable';
    return {
      field,
      label,
      score: assessment[field],
      ...readWeights(provenance, componentProvenance, weightKey),
      unavailableReason: unavailable ? String(componentProvenance?.reason ?? 'Not available.') : null,
      provenance: componentProvenance,
    };
  });
}

/** Model/policy identity and recomputability, read verbatim off the assessment. */
export function modelProvenance(assessment: MarketAssessment) {
  return {
    modelVersion: assessment.model_version,
    weightProfileKey: assessment.weight_profile_key,
    weightProfileVersion: assessment.weight_profile_version,
    scoringPolicyVersion: assessment.scoring_policy_version,
    scoringPolicyHash: assessment.scoring_policy_hash,
    asOfDate: assessment.as_of_date,
    reproducibilityStatus: assessment.reproducibility_status,
    evidenceOrigins: assessment.evidence_origins,
    confidenceScore: assessment.confidence_score,
    eligibilityStatus: assessment.eligibility_status,
    generatedAt: assessment.generated_at,
  };
}

// ---------------------------------------------------------------------------
// Table sorting
// ---------------------------------------------------------------------------

/**
 * Sortable columns. An allowlist rather than a free-form field name, so a URL parameter can
 * never reach an arbitrary column.
 */
export const SORT_KEYS = [
  'operational_order', 'ai_rank', 'agent_priority', 'ai_score', 'confidence',
  ...COMPONENTS.map((c) => c.field),
] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export function isSortKey(value: string | null | undefined): value is SortKey {
  return Boolean(value) && (SORT_KEYS as readonly string[]).includes(value!);
}

export interface SortableRow extends OperationalCandidate {
  assessment: MarketAssessment;
}

/**
 * Sort rows by an allowlisted column.
 *
 * Score-like columns sort descending (higher is better) while rank-like columns sort ascending
 * (1 is best), because a table that flips the meaning of "first row" between columns is a
 * usability trap. Nulls always sort last regardless of direction — a missing component is not
 * a zero, and must not lead the table when sorted ascending.
 */
export function sortRows<T extends SortableRow>(rows: T[], key: SortKey, direction: 'asc' | 'desc' = 'asc'): T[] {
  if (key === 'operational_order') return direction === 'asc' ? sortByOperationalOrder(rows) : sortByOperationalOrder(rows).reverse();

  const valueOf = (row: T): number | null => {
    switch (key) {
      case 'ai_rank': return row.modelRank;
      case 'agent_priority': return row.current?.agent_priority ?? null;
      case 'ai_score': return row.assessment.overall_score;
      case 'confidence': return row.assessment.confidence_score;
      default: return row.assessment[key];
    }
  };

  return [...rows].sort((a, b) => {
    const av = valueOf(a);
    const bv = valueOf(b);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return direction === 'asc' ? av - bv : bv - av;
  });
}

/** Rank-like columns count up from 1; score-like columns are better when higher. */
export const DEFAULT_DIRECTION: Record<SortKey, 'asc' | 'desc'> = {
  operational_order: 'asc', ai_rank: 'asc', agent_priority: 'asc',
  ai_score: 'desc', confidence: 'desc',
  ...(Object.fromEntries(COMPONENTS.map((c) => [c.field, 'desc'])) as Record<ComponentField, 'desc'>),
};

// ---------------------------------------------------------------------------
// Assembling the control surface
// ---------------------------------------------------------------------------

/**
 * Load every market in a run with its model rank and its current agent decision.
 *
 * Rank is computed the way the engine orders (`@@index([run_id, overall_score])`) and by
 * counting strictly-greater scores, so ties share a rank rather than inventing an order the
 * model never expressed — the same rule `agent-decisions.ts` freezes onto a decision.
 */
export async function marketControlRows(runId: string, db: PrismaLike = prismaDefault) {
  const assessments = await db.marketAssessment.findMany({
    where: { run_id: runId },
    orderBy: [{ overall_score: 'desc' }, { country_code: 'asc' }],
  });

  const decisions = await db.agentDecision.findMany({
    where: { market_assessment_id: { in: assessments.map((a) => a.id) } },
    orderBy: { created_at: 'desc' },
    include: { superseded_by: { select: { id: true } } },
  });

  const now = new Date();
  // Decisions arrive newest-first, so the first one seen per subject is that subject's tip.
  const latestBySubject = new Map<string, AgentDecision & { state: AgentDecisionState }>();
  for (const decision of decisions) {
    const subject = decision.market_assessment_id;
    if (!subject || latestBySubject.has(subject)) continue;
    latestBySubject.set(subject, { ...decision, state: decisionState(decision, now) });
  }

  return assessments.map((assessment) => {
    const latest = latestBySubject.get(assessment.id) ?? null;
    // Only the tip may be current, and only while still in force. A superseded or expired tip
    // means no current decision — it must not fall through to an older row, which would
    // resurrect an instruction the agent already replaced (see agent-decisions.ts).
    const current = latest && latest.state === 'active' ? latest : null;
    const modelRank = rankOf(assessment, assessments);
    return {
      assessment,
      modelRank,
      current,
      latest,
      bucket: bucketFor(current),
      operationalOrder: operationalOrder({ modelRank, current }),
      components: componentViews(assessment),
      provenance: modelProvenance(assessment),
    };
  });
}

export type MarketControlRow = Awaited<ReturnType<typeof marketControlRows>>[number];

function rankOf(assessment: MarketAssessment, all: MarketAssessment[]): number | null {
  if (assessment.overall_score == null) return null;
  return 1 + all.filter((a) => a.overall_score != null && a.overall_score > assessment.overall_score!).length;
}
