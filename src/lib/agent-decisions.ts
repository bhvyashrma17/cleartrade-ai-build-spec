/**
 * Agent decision layer — the audited human-control surface over Demand and Buyer Discovery.
 *
 * The single rule this module exists to enforce: **an agent's judgement is recorded
 * alongside the model's output, never on top of it.** Nothing here writes
 * `MarketAssessment.overall_score`, `BuyerFitAssessment.score`, their component breakdowns,
 * confidence, provenance or policy hashes. `docs/30` §3c depends on both halves surviving
 * independently — "the model ranked this 7th, the agent ranked it 1st, the deal closed" is
 * only answerable if neither value was ever overwritten by the other.
 *
 * Append-only by construction: the only exported write is `recordAgentDecision`. There is no
 * update and no delete, and the database refuses UPDATE via trigger (see the
 * 20260817200000_agent_decision_layer migration) so the guarantee does not rest on this
 * module remaining the only caller.
 *
 * "Is this decision still in force?" is DERIVED, not stored — see `effectiveState`. Expiry
 * makes currency a function of time, so a stored flag would be wrong the moment the clock
 * moved past it, and correcting it would require the UPDATE this table forbids.
 */

import { createHash } from 'node:crypto';
import { AgentDecisionAction, AgentDecisionTarget, Prisma, type AgentDecision, type EvidenceOrigin } from '@prisma/client';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { forbidden, notFound, validationError } from '@/lib/errors';
import { isAgent, isOps, assignedOrgIds } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';

type Db = Prisma.TransactionClient | typeof prisma;

// ---------------------------------------------------------------------------
// Which actions mean something for which target
//
// Mirrored by the `AgentDecision_action_matches_target` CHECK constraint. Duplicated
// deliberately: the constraint is the guarantee, this map is what lets the service reject a
// bad pairing with a field-level error naming both halves instead of surfacing a raw
// Postgres constraint violation.
// ---------------------------------------------------------------------------

/** Actions that are meaningful for either target. */
const SHARED_ACTIONS = [
  AgentDecisionAction.promote,
  AgentDecisionAction.demote,
  AgentDecisionAction.restore,
  AgentDecisionAction.pause_automation,
  AgentDecisionAction.resume_automation,
  AgentDecisionAction.request_review,
] as const;

export const ACTIONS_BY_TARGET: Record<AgentDecisionTarget, readonly AgentDecisionAction[]> = {
  [AgentDecisionTarget.market]: [
    ...SHARED_ACTIONS,
    // A recommended market is `reject`ed; a buyer is `disqualify`ed. Different words because
    // they are different acts — rejecting a market is a commercial call about a country,
    // disqualifying a buyer is a judgement about a counterparty.
    AgentDecisionAction.reject,
    AgentDecisionAction.mark_selected,
    AgentDecisionAction.mark_not_selected,
  ],
  [AgentDecisionTarget.buyer]: [
    ...SHARED_ACTIONS,
    AgentDecisionAction.shortlist,
    AgentDecisionAction.disqualify,
    AgentDecisionAction.qualify,
    AgentDecisionAction.unqualify,
  ],
};

/** Actions where an operational ordering is meaningful. A rejection has no priority. */
const PRIORITY_ACTIONS: readonly AgentDecisionAction[] = [
  AgentDecisionAction.promote,
  AgentDecisionAction.demote,
  AgentDecisionAction.shortlist,
  AgentDecisionAction.mark_selected,
];

export function actionAppliesTo(target: AgentDecisionTarget, action: AgentDecisionAction): boolean {
  return ACTIONS_BY_TARGET[target].includes(action);
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

/**
 * Only an agent assigned to this exporter, or an authorized Ops role, may record a decision.
 *
 * Deliberately stricter than `canAccessOrg`, which also admits an exporter reading their own
 * org: this is the *agent* control layer, and an exporter recording an "agent decision" about
 * their own AI recommendations would make the AI-vs-human comparison meaningless — the
 * override would no longer represent independent judgement.
 *
 * Failure mode differs by reason, which is a leak decision rather than a cosmetic one:
 *   - wrong ROLE  -> FORBIDDEN. An exporter already knows their own org exists; hiding it
 *                    would be theatre, and the honest answer is "not your action".
 *   - unassigned  -> NOT_FOUND. docs/09 §4: never confirm that another tenant's org exists.
 */
export async function assertCanRecordAgentDecision(principal: Principal, orgId: string): Promise<void> {
  if (isOps(principal)) return;
  if (!isAgent(principal)) {
    throw forbidden('Only an assigned agent or Ops may record an agent decision.');
  }
  const assigned = await assignedOrgIds(principal);
  if (!assigned.includes(orgId)) throw notFound();
}

// ---------------------------------------------------------------------------
// Effective state — derived, never stored
// ---------------------------------------------------------------------------

export type AgentDecisionState = 'active' | 'expired' | 'superseded';

/**
 * Whether a decision still governs, as of `now`.
 *
 * Supersession outranks expiry: a decision replaced by a newer one is superseded whether or
 * not it also happened to expire, because that is the more specific and more useful fact.
 */
export function effectiveState(
  decision: Pick<AgentDecision, 'expires_at'> & { superseded_by?: { id: string } | null },
  now: Date = new Date(),
): AgentDecisionState {
  if (decision.superseded_by) return 'superseded';
  if (decision.expires_at && decision.expires_at.getTime() <= now.getTime()) return 'expired';
  return 'active';
}

// ---------------------------------------------------------------------------
// Recording a decision — the only write path
// ---------------------------------------------------------------------------

export interface RecordAgentDecisionInput {
  actor: Principal;
  target: AgentDecisionTarget;
  /** MarketAssessment.id when target is `market`, BuyerFitAssessment.id when `buyer`. */
  subjectId: string;
  action: AgentDecisionAction;
  reason: string;
  agentPriority?: number | null;
  expiresAt?: Date | null;
  correlationId: string;
}

/**
 * Serialize decisions about one subject.
 *
 * Two agents deciding on the same market at the same instant would both read the same chain
 * tip and both try to supersede it. The UNIQUE index on `supersedes_id` means one of them
 * fails with a raw constraint error — correct, but it turns a routine race into an error the
 * caller has to interpret. A transaction-scoped advisory lock makes the second writer wait
 * and then chain onto the first, so the outcome is a deterministic linear chain either way.
 *
 * Advisory rather than `SELECT … FOR UPDATE` on the assessment row: locking the assessment
 * would block a concurrent discovery recompute, and a decision must never be able to stall
 * the scoring engine. The lock is released automatically when the transaction ends.
 */
async function lockSubject(tx: Db, subjectId: string): Promise<void> {
  // `$executeRaw`, not `$queryRaw`: the lock function returns `void`, which Prisma cannot
  // deserialize as a column. `hashtextextended` yields the bigint the lock function expects
  // — a collision would only ever serialize two unrelated subjects briefly, never admit a
  // race on the same one.
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', subjectId);
}

/**
 * Record one agent decision.
 *
 * The subject is read inside the transaction so the `original_*` snapshot is taken from the
 * same committed state the decision is written against — reading it beforehand would leave a
 * window in which a recompute lands between the read and the insert, and the row would then
 * claim the agent overruled a score they never saw.
 */
export async function recordAgentDecision(
  input: RecordAgentDecisionInput,
  db: Db = prisma,
): Promise<AgentDecision> {
  const reason = input.reason?.trim() ?? '';
  if (!reason) {
    throw validationError([{ field: 'reason', code: 'required', message: 'A reason is required for every agent decision.' }]);
  }
  if (!actionAppliesTo(input.target, input.action)) {
    throw validationError([{
      field: 'action',
      code: 'invalid_for_target',
      message: `Action "${input.action}" does not apply to a ${input.target} decision.`,
    }]);
  }
  if (input.agentPriority != null) {
    if (!Number.isInteger(input.agentPriority) || input.agentPriority < 1) {
      throw validationError([{ field: 'agent_priority', code: 'invalid', message: 'Operational priority must be a positive integer.' }]);
    }
    if (!PRIORITY_ACTIONS.includes(input.action)) {
      throw validationError([{
        field: 'agent_priority',
        code: 'invalid_for_action',
        message: `Action "${input.action}" does not carry an operational priority.`,
      }]);
    }
  }

  const run = async (tx: Db) => {
    // Before reading the chain tip, so the tip cannot change under us mid-transaction.
    await lockSubject(tx, input.subjectId);

    const subject = input.target === AgentDecisionTarget.market
      ? await marketSubject(tx, input.subjectId)
      : await buyerSubject(tx, input.subjectId);

    // Authorization uses the org the SUBJECT belongs to, never an org id supplied by the
    // caller — otherwise an agent assigned to org A could record a decision about org B's
    // assessment simply by naming their own org.
    await assertCanRecordAgentDecision(input.actor, subject.exporterOrgId);

    // Supersession is derived, never supplied. A caller-chosen `supersedesId` could name a
    // historical row, another subject's decision, or another exporter's — all of which the
    // database now refuses, but the better fix is to remove the choice: there is exactly one
    // correct answer (the current tip of this subject's chain) and the service computes it.
    const supersedesId = await chainTip(tx, input.target, input.subjectId);

    const decision = await tx.agentDecision.create({
      data: {
        exporter_org_id: subject.exporterOrgId,
        actor_user_id: input.actor.id,
        target: input.target,
        action: input.action,
        market_assessment_id: input.target === AgentDecisionTarget.market ? input.subjectId : null,
        buyer_fit_assessment_id: input.target === AgentDecisionTarget.buyer ? input.subjectId : null,
        agent_priority: input.agentPriority ?? null,
        reason,
        original_score: subject.score,
        original_rank: subject.rank,
        original_confidence_score: subject.confidenceScore,
        original_model_version: subject.modelVersion,
        original_policy_hash: subject.policyHash,
        original_policy_version: subject.policyVersion ?? null,
        ...(subject.components !== undefined ? { original_components: subject.components } : {}),
        ...(subject.inputSnapshot !== undefined ? { original_input_snapshot: subject.inputSnapshot } : {}),
        original_input_snapshot_hash: subject.inputSnapshotHash ?? null,
        original_computed_at: subject.computedAt ?? null,
        original_evidence_origins: subject.evidenceOrigins ?? [],
        expires_at: input.expiresAt ?? null,
        supersedes_id: supersedesId,
      },
    });

    // Same transaction as the insert: a decision that commits without its audit row (or the
    // reverse) is worse than either failing.
    await writeAuditEvent({
      db: tx,
      actor: input.actor,
      // `override` rather than `create`: docs/08 — an override must be findable as its own
      // category, not buried among routine row creations.
      action: AUDIT_ACTIONS.override,
      object_type: 'agent_decision',
      object_id: decision.id,
      exporter_org_id: subject.exporterOrgId,
      after_summary: {
        target: input.target,
        action: input.action,
        subject_id: input.subjectId,
        agent_priority: decision.agent_priority,
        reason,
        // The model's view at decision time, so the audit trail alone shows what was overruled.
        original_score: subject.score,
        original_rank: subject.rank,
        original_model_version: subject.modelVersion,
        supersedes_id: decision.supersedes_id,
        expires_at: decision.expires_at?.toISOString() ?? null,
      },
      correlation_id: input.correlationId,
    });

    return decision;
  };

  // Reuse an ambient transaction when the caller already opened one; otherwise open our own,
  // because the insert and its audit row must not be separable.
  return 'agentDecision' in db && '$transaction' in db
    ? (db as typeof prisma).$transaction((tx) => run(tx))
    : run(db);
}

interface SubjectSnapshot {
  exporterOrgId: string;
  score: number | null;
  rank: number | null;
  confidenceScore: number | null;
  modelVersion: string | null;
  policyHash: string | null;
  policyVersion?: number | null;
  /**
   * Explainable state, copied only where the subject is updated in place.
   *
   * Populated for buyers, whose assessment is upserted and therefore destroys what the agent
   * saw. Left undefined for markets, whose per-run assessment survives a recompute and can be
   * read back through the foreign key.
   */
  components?: Prisma.InputJsonValue;
  inputSnapshot?: Prisma.InputJsonValue;
  inputSnapshotHash?: string | null;
  computedAt?: Date | null;
  evidenceOrigins?: EvidenceOrigin[];
}

/** Read the market assessment and its rank within its run. */
async function marketSubject(db: Db, id: string): Promise<SubjectSnapshot> {
  const assessment = await db.marketAssessment.findUnique({
    where: { id },
    select: {
      id: true, run_id: true, overall_score: true, confidence_score: true,
      model_version: true, scoring_policy_hash: true,
      run: { select: { exporter_org_id: true } },
    },
  });
  if (!assessment) throw notFound('Market assessment not found.');

  // Rank is not stored — it is the model's ordering within the run, so it is computed the
  // same way the UI orders (@@index([run_id, overall_score])) and then frozen onto the row.
  // Counting strictly-greater scores makes ties share a rank rather than inventing an order
  // the model never expressed.
  const rank = assessment.overall_score == null
    ? null
    : 1 + await db.marketAssessment.count({
        where: { run_id: assessment.run_id, overall_score: { gt: assessment.overall_score } },
      });

  return {
    exporterOrgId: assessment.run.exporter_org_id,
    score: assessment.overall_score,
    rank,
    confidenceScore: assessment.confidence_score,
    modelVersion: assessment.model_version,
    policyHash: assessment.scoring_policy_hash,
  };
}

/** Read the buyer fit assessment and its rank within (org, product). */
async function buyerSubject(db: Db, id: string): Promise<SubjectSnapshot> {
  const assessment = await db.buyerFitAssessment.findUnique({
    where: { id },
    select: {
      id: true, exporter_org_id: true, product_id: true, score: true,
      confidence_score: true, model_version: true,
      components: true, input_snapshot: true, computed_at: true, evidence_origins: true,
      scoring_policy_hash: true, scoring_policy_version: true,
    },
  });
  if (!assessment) throw notFound('Buyer fit assessment not found.');

  const rank = assessment.score == null
    ? null
    : 1 + await db.buyerFitAssessment.count({
        where: {
          exporter_org_id: assessment.exporter_org_id,
          product_id: assessment.product_id,
          score: { gt: assessment.score },
        },
      });

  return {
    exporterOrgId: assessment.exporter_org_id,
    score: assessment.score,
    rank,
    confidenceScore: assessment.confidence_score,
    modelVersion: assessment.model_version,
    // Copied when present. Null on assessments written before BuyerFit captured its policy —
    // those are explicitly legacy rather than being attributed to today's policy.
    policyHash: assessment.scoring_policy_hash,
    policyVersion: assessment.scoring_policy_version,
    // Copied, not referenced: the upsert in buyer-intelligence.ts overwrites all of these on
    // the next recompute, so this decision row is the only place they survive.
    components: assessment.components as Prisma.InputJsonValue,
    inputSnapshot: assessment.input_snapshot as Prisma.InputJsonValue,
    inputSnapshotHash: createHash('sha256')
      .update(JSON.stringify(assessment.input_snapshot ?? null))
      .digest('hex'),
    computedAt: assessment.computed_at,
    evidenceOrigins: assessment.evidence_origins,
  };
}

/**
 * The tip of this subject's decision chain: the one decision nothing else supersedes.
 *
 * Structural rather than "newest by created_at", matching the database trigger exactly — two
 * rows can share a timestamp, but only one can be unreferenced. Returns null when the subject
 * has no decisions yet, which is the only case in which a root decision is valid.
 */
async function chainTip(db: Db, target: AgentDecisionTarget, subjectId: string): Promise<string | null> {
  const subjectWhere = target === AgentDecisionTarget.market
    ? { market_assessment_id: subjectId }
    : { buyer_fit_assessment_id: subjectId };
  const tip = await db.agentDecision.findFirst({
    where: { ...subjectWhere, superseded_by: { is: null } },
    select: { id: true },
  });
  return tip?.id ?? null;
}

// ---------------------------------------------------------------------------
// Named actions
//
// Thin wrappers so callers name an intent rather than assembling an enum, and so an
// impossible pairing is a type error at the call site instead of a runtime rejection.
// ---------------------------------------------------------------------------

type MarketArgs = Omit<RecordAgentDecisionInput, 'target' | 'action'>;
type BuyerArgs = Omit<RecordAgentDecisionInput, 'target' | 'action'>;

const market = (action: AgentDecisionAction) => (args: MarketArgs, db?: Db) =>
  recordAgentDecision({ ...args, target: AgentDecisionTarget.market, action }, db);
const buyer = (action: AgentDecisionAction) => (args: BuyerArgs, db?: Db) =>
  recordAgentDecision({ ...args, target: AgentDecisionTarget.buyer, action }, db);

/** Market decisions. `promoteMarket` carries the operational rank via `agentPriority`. */
export const promoteMarket = market(AgentDecisionAction.promote);
export const demoteMarket = market(AgentDecisionAction.demote);
export const rejectMarket = market(AgentDecisionAction.reject);
export const restoreMarket = market(AgentDecisionAction.restore);
export const markMarketSelected = market(AgentDecisionAction.mark_selected);
export const markMarketNotSelected = market(AgentDecisionAction.mark_not_selected);
export const pauseMarketAutomation = market(AgentDecisionAction.pause_automation);
export const resumeMarketAutomation = market(AgentDecisionAction.resume_automation);
export const requestMarketReview = market(AgentDecisionAction.request_review);

/** Buyer decisions. */
export const promoteBuyer = buyer(AgentDecisionAction.promote);
export const demoteBuyer = buyer(AgentDecisionAction.demote);
export const shortlistBuyer = buyer(AgentDecisionAction.shortlist);
export const disqualifyBuyer = buyer(AgentDecisionAction.disqualify);
export const restoreBuyer = buyer(AgentDecisionAction.restore);
export const qualifyBuyer = buyer(AgentDecisionAction.qualify);
export const unqualifyBuyer = buyer(AgentDecisionAction.unqualify);
export const pauseBuyerAutomation = buyer(AgentDecisionAction.pause_automation);
export const resumeBuyerAutomation = buyer(AgentDecisionAction.resume_automation);
export const requestBuyerReview = buyer(AgentDecisionAction.request_review);

// ---------------------------------------------------------------------------
// Read model — AI recommendation and agent decision, side by side
// ---------------------------------------------------------------------------

/**
 * The two halves are returned as two named objects, never merged.
 *
 * There is deliberately no "effective score" field anywhere in this shape. A single blended
 * number would be the one thing the UI reaches for, and it would erase exactly the
 * distinction docs/30 requires the interface to show — once a caller can read a combined
 * value, "what did the model say?" stops being answerable downstream.
 */
export interface DecisionView<TRecommendation> {
  recommendation: TRecommendation;
  decision: {
    /** The newest decision still in force, or null. Never an older one — see `decisionsFor`. */
    current: (AgentDecision & { state: AgentDecisionState }) | null;
    /**
     * The newest decision whatever its state, so a lapsed instruction stays visible.
     * Without this, an expired decision would be indistinguishable from none ever made.
     */
    latest: (AgentDecision & { state: AgentDecisionState }) | null;
    /** Full chain, newest first. Every decision ever recorded about this subject. */
    history: (AgentDecision & { state: AgentDecisionState })[];
  };
}

const withState = (rows: (AgentDecision & { superseded_by: { id: string } | null })[], now: Date) =>
  rows.map((row) => ({ ...row, state: effectiveState(row, now) }));

const DECISION_SELECT = { include: { superseded_by: { select: { id: true } } } } as const;

/** Decisions about one subject, newest first, with the current one identified. */
async function decisionsFor(
  db: Db,
  where: Prisma.AgentDecisionWhereInput,
  now: Date,
) {
  const rows = await db.agentDecision.findMany({
    where,
    orderBy: { created_at: 'desc' },
    ...DECISION_SELECT,
  });
  const history = withState(rows, now);
  const latest = history[0] ?? null;
  // Only the NEWEST row can be current. Scanning past a lapsed decision to an older active
  // one would resurrect an instruction the agent already replaced: "promoted, then rejected
  // for a quarter" must not silently become "promoted again" when the quarter ends. The
  // expiry says this decision stopped speaking, not that the previous one started again —
  // that inference is the caller's to make from `history`, with the lapse visible.
  const current = latest && latest.state === 'active' ? latest : null;
  return { current, latest, history };
}

/** Demand Discovery: the model's assessment plus the agent decision layer over it. */
export async function marketDecisionView(
  assessmentId: string,
  db: Db = prisma,
  now: Date = new Date(),
) {
  const recommendation = await db.marketAssessment.findUnique({ where: { id: assessmentId } });
  if (!recommendation) throw notFound('Market assessment not found.');
  return {
    recommendation,
    decision: await decisionsFor(db, { market_assessment_id: assessmentId }, now),
  };
}

/** Buyer Discovery: the model's fit assessment plus the agent decision layer over it. */
export async function buyerDecisionView(
  assessmentId: string,
  db: Db = prisma,
  now: Date = new Date(),
) {
  const recommendation = await db.buyerFitAssessment.findUnique({ where: { id: assessmentId } });
  if (!recommendation) throw notFound('Buyer fit assessment not found.');
  return {
    recommendation,
    decision: await decisionsFor(db, { buyer_fit_assessment_id: assessmentId }, now),
  };
}

/** Every decision for an org, newest first — the audit/history surface. */
export async function agentDecisionsForOrg(
  orgId: string,
  opts: { target?: AgentDecisionTarget; take?: number } = {},
  db: Db = prisma,
  now: Date = new Date(),
) {
  const rows = await db.agentDecision.findMany({
    where: { exporter_org_id: orgId, ...(opts.target ? { target: opts.target } : {}) },
    orderBy: { created_at: 'desc' },
    take: opts.take ?? 100,
    ...DECISION_SELECT,
  });
  return withState(rows, now);
}

/**
 * The learning-loop read: AI ranking -> human override -> realised outcome.
 *
 * Joins each buyer decision to the `BuyerOutcome` for the same buyer and org, so
 * `original_score`/`original_rank` (what the model said when the agent acted) can be
 * compared against `converted`. The comparison uses the frozen `original_*` columns rather
 * than the live assessment on purpose: assessments are recomputed as evidence changes, and
 * joining through to today's score would measure the wrong thing entirely.
 *
 * Read-only and unaggregated — the analysis itself is deliberately left outside this module
 * until there is enough data to know which question is worth asking.
 */
export async function buyerOverrideOutcomes(orgId: string, db: Db = prisma) {
  const decisions = await db.agentDecision.findMany({
    where: { exporter_org_id: orgId, target: AgentDecisionTarget.buyer },
    orderBy: { created_at: 'asc' },
    include: { buyer_fit_assessment: { select: { buyer_id: true, product_id: true } } },
  });

  const buyerIds = [...new Set(decisions.map((d) => d.buyer_fit_assessment?.buyer_id).filter((v): v is string => Boolean(v)))];
  const outcomes = buyerIds.length
    ? await db.buyerOutcome.findMany({ where: { exporter_org_id: orgId, buyer_id: { in: buyerIds } } })
    : [];
  const byBuyer = new Map(outcomes.map((o) => [o.buyer_id, o]));

  return decisions.map((decision) => ({
    decision,
    buyer_id: decision.buyer_fit_assessment?.buyer_id ?? null,
    model_score_at_decision: decision.original_score,
    model_rank_at_decision: decision.original_rank,
    outcome: decision.buyer_fit_assessment ? byBuyer.get(decision.buyer_fit_assessment.buyer_id) ?? null : null,
  }));
}
