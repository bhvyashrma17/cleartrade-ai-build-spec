/**
 * Buyer Discovery control — the read model behind the agent's buyer control surface.
 *
 * Assembles three layers that are deliberately kept apart all the way to the UI:
 *
 *   A. AI RECOMMENDATION — the persisted `BuyerFitAssessment`, read verbatim. Never
 *      recomputed, never blended, never edited from this side.
 *   B. CANONICAL OPERATIONAL STATE — what ClearTrade is actually doing: `BuyerShortlist`
 *      membership, `BuyerLead.stage`, the disqualification reason, real outreach state.
 *   C. AGENT DECISION — the immutable `AgentDecision` chain and its history.
 *
 * "On shortlist" and "Pipeline: contacted" are both true at once and are not reconciled into a
 * single status: selection and pipeline position are different facts, and a synthetic combined
 * label would destroy the ability to answer either question.
 *
 * Evidence is kept distinct from model components for the same reason. `volume_fit` is what the
 * model concluded; `shipment_count_12m` is a fact it drew on. Presenting them in one list would
 * imply the model consumed each signal directly, which it does not.
 *
 * Ordering primitives (`bucketFor`, `operationalOrder`, `sortByOperationalOrder`) are imported
 * from demand-control rather than reimplemented — they are generic over `OperationalCandidate`,
 * and a second copy would let market and buyer ordering drift apart.
 */

import {
  type AgentDecision,
  type BuyerFitAssessment,
  type BuyerLeadStage,
  type DisqualificationReason,
  type EvidenceOrigin,
  type Prisma,
} from '@prisma/client';
import { effectiveState, type AgentDecisionState } from '@/lib/agent-decisions';
import { bucketFor, operationalOrder, sortByOperationalOrder, type OperationalBucket } from '@/lib/demand-control';
import { assertOrgAccess } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';

type Db = Prisma.TransactionClient | typeof prisma;

// ---------------------------------------------------------------------------
// A. AI recommendation
// ---------------------------------------------------------------------------

/**
 * The four components the live scorer combines, with the keys it actually writes.
 *
 * `cert_fit` rather than `certification_fit`: the stored key is what `buyer-intelligence.ts`
 * emits, and renaming it here would silently read `undefined` and render every certification
 * component as missing.
 */
export const BUYER_COMPONENTS = [
  { key: 'volume_fit', label: 'Volume fit' },
  { key: 'price_fit', label: 'Price fit' },
  { key: 'cert_fit', label: 'Certification fit' },
  { key: 'outcome_prior', label: 'Outcome prior' },
] as const;

export type BuyerComponentKey = (typeof BUYER_COMPONENTS)[number]['key'];

export interface BuyerComponentView {
  key: BuyerComponentKey;
  label: string;
  /** Null when the model could not compute it. NOT zero — a gap is not a score of nothing. */
  score: number | null;
  /** The engine's own explanation for a gap, when it supplied one. */
  unavailableReason: string | null;
  /** Whatever supporting evidence the engine attached to this component. */
  evidence: Record<string, unknown> | null;
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const asNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Read the component breakdown out of the stored JSON, without interpreting gaps as zeros. */
export function buyerComponentViews(components: Prisma.JsonValue | null): BuyerComponentView[] {
  const root = asRecord(components);
  return BUYER_COMPONENTS.map(({ key, label }) => {
    const entry = asRecord(root?.[key]);
    return {
      key,
      label,
      score: asNumber(entry?.score),
      unavailableReason: typeof entry?.reason === 'string' ? entry.reason : null,
      evidence: asRecord(entry?.evidence),
    };
  });
}

export interface BuyerModelProvenance {
  modelVersion: string;
  confidenceScore: number;
  evidenceOrigins: EvidenceOrigin[];
  computedAt: Date;
  /** Null on assessments written before BuyerFit captured its policy. Never invented. */
  scoringPolicyVersion: number | null;
  scoringPolicyHash: string | null;
  scoringPolicySnapshot: Prisma.JsonValue | null;
  /** `legacy_non_recomputable` means exactly that — not "assume the current policy". */
  reproducibilityStatus: string;
  inputSnapshot: Prisma.JsonValue | null;
}

export function buyerModelProvenance(fit: BuyerFitAssessment): BuyerModelProvenance {
  return {
    modelVersion: fit.model_version,
    confidenceScore: fit.confidence_score,
    evidenceOrigins: fit.evidence_origins,
    computedAt: fit.computed_at,
    scoringPolicyVersion: fit.scoring_policy_version,
    scoringPolicyHash: fit.scoring_policy_hash,
    scoringPolicySnapshot: fit.scoring_policy_snapshot,
    reproducibilityStatus: fit.reproducibility_status,
    inputSnapshot: fit.input_snapshot,
  };
}

// ---------------------------------------------------------------------------
// B. Canonical operational state
// ---------------------------------------------------------------------------

export interface CanonicalBuyerState {
  /** Selection — membership of the exporter's shortlist. */
  onShortlist: boolean;
  shortlistedAt: Date | null;
  /** Pipeline — null when this buyer has never entered the pipeline. */
  leadId: string | null;
  leadStage: BuyerLeadStage | null;
  disqualificationReason: DisqualificationReason | null;
  disqualificationReasonText: string | null;
  /**
   * Outreach, from real canonical rows only. Null when nothing has been sent — never derived
   * from an AgentDecision, which records intent rather than delivery.
   */
  outreach: {
    lastContactAt: Date | null;
    interestLevel: string | null;
    lastAttemptChannel: string | null;
    lastAttemptStatus: string | null;
    lastAttemptAt: Date | null;
    attemptCount: number;
    lastActivitySummary: string | null;
    lastActivityAt: Date | null;
  } | null;
}

export interface BuyerEvidence {
  /** Supporting signals — NOT model components. Null where genuinely not stored. */
  shipmentCount12m: number | null;
  lastShipmentDate: Date | null;
  importFrequencyPerYear: string | null;
  typicalShipmentSize: string | null;
  quantityUnit: string | null;
  indiaSourcingHistory: boolean | null;
  purchasingTrend: string | null;
  supplierConcentration: string | null;
  featureComputedAt: Date | null;
  featureProvenance: Prisma.JsonValue | null;
  sourceEvidenceCount: number;
  sanctions: { resultState: string; algorithmVersion: string; screenedAt: Date } | null;
}

// ---------------------------------------------------------------------------
// The assembled row
// ---------------------------------------------------------------------------

export interface BuyerControlRow {
  fitId: string;
  buyerId: string;
  buyerName: string;
  countryCode: string;
  /** A. The model's own output. */
  fit: BuyerFitAssessment;
  components: BuyerComponentView[];
  provenance: BuyerModelProvenance;
  /** Rank by BuyerFit score within (org, product). Null when the model produced no score. */
  modelRank: number | null;
  /** B. What the system is actually doing. */
  canonical: CanonicalBuyerState;
  evidence: BuyerEvidence;
  /** C. Human intent. */
  current: (AgentDecision & { state: AgentDecisionState }) | null;
  latest: (AgentDecision & { state: AgentDecisionState }) | null;
  history: (AgentDecision & { state: AgentDecisionState })[];
  bucket: OperationalBucket;
  operationalOrder: number | null;
  /** Stable tie-break identity, consumed by sortByOperationalOrder. */
  subjectId: string;
  lastMeaningfulActivityAt: Date | null;
}

const decimalToString = (v: Prisma.Decimal | null) => (v === null ? null : v.toString());

/**
 * Load the buyer control surface for one exporter (optionally one product).
 *
 * Authorization is the caller's `Principal` checked through `assertOrgAccess`, the same helper
 * every other org-scoped read uses — there is no separate rule here, and no client-side check
 * is trusted. A caller without access gets NOT_FOUND rather than an empty list, so the surface
 * cannot be used to probe which orgs exist.
 */
export async function buyerControlRows(
  principal: Principal,
  exporterOrgId: string,
  opts: { productId?: string | null } = {},
  db: Db = prisma,
  now: Date = new Date(),
): Promise<BuyerControlRow[]> {
  await assertOrgAccess(principal, exporterOrgId);

  const fits = await db.buyerFitAssessment.findMany({
    where: { exporter_org_id: exporterOrgId, ...(opts.productId ? { product_id: opts.productId } : {}) },
    orderBy: [{ score: 'desc' }, { buyer_id: 'asc' }],
    include: {
      buyer: {
        include: {
          feature_snapshot: true,
          source_evidence: { select: { id: true } },
        },
      },
    },
  });
  if (fits.length === 0) return [];

  const buyerIds = [...new Set(fits.map((f) => f.buyer_id))];
  const productIds = [...new Set(fits.map((f) => f.product_id))];

  // All canonical state in three queries rather than per row.
  const [shortlists, leads, sanctions] = await Promise.all([
    db.buyerShortlist.findMany({
      where: { exporter_org_id: exporterOrgId, buyer_id: { in: buyerIds }, product_id: { in: productIds } },
    }),
    db.buyerLead.findMany({
      where: { exporter_org_id: exporterOrgId, buyer_id: { in: buyerIds }, product_id: { in: productIds } },
      include: {
        outreach_attempts: { orderBy: { attempted_at: 'desc' }, take: 1 },
        activities: { orderBy: { occurred_at: 'desc' }, take: 1 },
        _count: { select: { outreach_attempts: true } },
      },
    }),
    db.sanctionsScreeningCase.findMany({
      where: { buyer_id: { in: buyerIds } },
      orderBy: { created_at: 'desc' },
    }),
  ]);

  const decisions = await db.agentDecision.findMany({
    where: { buyer_fit_assessment_id: { in: fits.map((f) => f.id) } },
    orderBy: { created_at: 'desc' },
    include: { superseded_by: { select: { id: true } }, actor: { select: { id: true, name: true } } },
  });

  const key = (buyerId: string, productId: string) => `${buyerId}::${productId}`;
  const shortlistBy = new Map(shortlists.map((s) => [key(s.buyer_id, s.product_id ?? ''), s]));
  const leadBy = new Map(leads.map((l) => [key(l.buyer_id, l.product_id), l]));
  const sanctionsBy = new Map<string, (typeof sanctions)[number]>();
  for (const c of sanctions) if (c.buyer_id && !sanctionsBy.has(c.buyer_id)) sanctionsBy.set(c.buyer_id, c);

  const historyBy = new Map<string, (AgentDecision & { state: AgentDecisionState })[]>();
  for (const decision of decisions) {
    const subject = decision.buyer_fit_assessment_id;
    if (!subject) continue;
    const entry = { ...decision, state: effectiveState(decision, now) };
    const existing = historyBy.get(subject);
    if (existing) existing.push(entry);
    else historyBy.set(subject, [entry]);
  }

  // Rank within (product) by score, counting strictly-greater so ties share a rank rather than
  // inventing an order the model never expressed — the same rule the market surface uses.
  const rankOf = (fit: (typeof fits)[number]) =>
    fit.score == null
      ? null
      : 1 + fits.filter((o) => o.product_id === fit.product_id && o.score != null && o.score > fit.score!).length;

  const rows = fits.map((fit) => {
    const history = historyBy.get(fit.id) ?? [];
    const latest = history[0] ?? null;
    const current = latest && latest.state === 'active' ? latest : null;

    const shortlist = shortlistBy.get(key(fit.buyer_id, fit.product_id)) ?? null;
    const lead = leadBy.get(key(fit.buyer_id, fit.product_id)) ?? null;
    const attempt = lead?.outreach_attempts[0] ?? null;
    const activity = lead?.activities[0] ?? null;
    const sanctionsCase = sanctionsBy.get(fit.buyer_id) ?? null;
    const features = fit.buyer.feature_snapshot;

    const canonical: CanonicalBuyerState = {
      onShortlist: Boolean(shortlist),
      shortlistedAt: shortlist?.created_at ?? null,
      leadId: lead?.id ?? null,
      leadStage: lead?.stage ?? null,
      disqualificationReason: lead?.disqualification_reason ?? null,
      disqualificationReasonText: lead?.disqualification_reason_text ?? null,
      // Only real rows. No lead means no outreach state at all — not "not contacted",
      // which would be a claim about a pipeline the buyer has never entered.
      outreach: lead
        ? {
            lastContactAt: lead.last_contact_at,
            interestLevel: lead.interest_level,
            lastAttemptChannel: attempt?.channel ?? null,
            lastAttemptStatus: attempt?.delivery_status ?? null,
            lastAttemptAt: attempt?.attempted_at ?? null,
            attemptCount: lead._count.outreach_attempts,
            lastActivitySummary: activity?.summary ?? null,
            lastActivityAt: activity?.occurred_at ?? null,
          }
        : null,
    };

    const modelRank = rankOf(fit);
    const candidate = { modelRank, current, subjectId: fit.id };

    return {
      fitId: fit.id,
      buyerId: fit.buyer_id,
      buyerName: fit.buyer.display_name,
      countryCode: fit.buyer.country_code,
      fit,
      components: buyerComponentViews(fit.components),
      provenance: buyerModelProvenance(fit),
      modelRank,
      canonical,
      evidence: {
        shipmentCount12m: features?.shipment_count_12m ?? null,
        lastShipmentDate: features?.last_shipment_date ?? null,
        importFrequencyPerYear: decimalToString(features?.import_frequency_per_year ?? null),
        typicalShipmentSize: decimalToString(features?.typical_shipment_size ?? null),
        quantityUnit: features?.quantity_unit ?? null,
        indiaSourcingHistory: features?.india_sourcing_history ?? null,
        purchasingTrend: decimalToString(features?.purchasing_trend ?? null),
        supplierConcentration: decimalToString(features?.supplier_concentration ?? null),
        featureComputedAt: features?.computed_at ?? null,
        featureProvenance: features?.provenance ?? null,
        sourceEvidenceCount: fit.buyer.source_evidence.length,
        sanctions: sanctionsCase
          ? {
              resultState: sanctionsCase.result_state,
              algorithmVersion: sanctionsCase.algorithm_version,
              screenedAt: sanctionsCase.created_at,
            }
          : null,
      },
      current,
      latest,
      history,
      bucket: bucketFor(current),
      operationalOrder: operationalOrder(candidate),
      subjectId: fit.id,
      lastMeaningfulActivityAt: newest([
        activity?.occurred_at ?? null,
        attempt?.attempted_at ?? null,
        lead?.last_contact_at ?? null,
        latest?.created_at ?? null,
      ]),
    } satisfies BuyerControlRow;
  });

  return sortByOperationalOrder(rows);
}

function newest(dates: (Date | null)[]): Date | null {
  const present = dates.filter((d): d is Date => d instanceof Date);
  return present.length ? new Date(Math.max(...present.map((d) => d.getTime()))) : null;
}

// ---------------------------------------------------------------------------
// Sorting and filtering — allowlisted, server-side
// ---------------------------------------------------------------------------

export const BUYER_SORT_KEYS = [
  'operational_order', 'ai_score', 'confidence', 'agent_priority',
  ...BUYER_COMPONENTS.map((c) => c.key),
] as const;
export type BuyerSortKey = (typeof BUYER_SORT_KEYS)[number];

export function isBuyerSortKey(v: string | null | undefined): v is BuyerSortKey {
  return Boolean(v) && (BUYER_SORT_KEYS as readonly string[]).includes(v!);
}

/**
 * Sort assembled rows by an allowlisted key.
 *
 * Applied in memory over an already tenant-scoped result set. The BuyerFit components live in
 * a JSON column, and sorting them in SQL would mean a JSON-path expression per key; that is
 * worth doing when a real query plan says so, not before — the working set here is one
 * exporter's buyers, not a global table.
 */
export function sortBuyerRows(rows: BuyerControlRow[], key: BuyerSortKey, direction: 'asc' | 'desc' = 'asc'): BuyerControlRow[] {
  if (key === 'operational_order') {
    const sorted = sortByOperationalOrder(rows);
    return direction === 'asc' ? sorted : [...sorted].reverse();
  }
  const valueOf = (row: BuyerControlRow): number | null => {
    if (key === 'ai_score') return row.fit.score;
    if (key === 'confidence') return row.fit.confidence_score;
    if (key === 'agent_priority') return row.current?.agent_priority ?? null;
    return row.components.find((c) => c.key === key)?.score ?? null;
  };
  return [...rows].sort((a, b) => {
    const av = valueOf(a);
    const bv = valueOf(b);
    // Nulls last in both directions: a missing component is not a low score.
    if (av === null && bv === null) return a.subjectId.localeCompare(b.subjectId);
    if (av === null) return 1;
    if (bv === null) return -1;
    return direction === 'asc' ? av - bv : bv - av;
  });
}

export const BUYER_DEFAULT_DIRECTION: Record<BuyerSortKey, 'asc' | 'desc'> = {
  operational_order: 'asc', agent_priority: 'asc',
  ai_score: 'desc', confidence: 'desc',
  ...(Object.fromEntries(BUYER_COMPONENTS.map((c) => [c.key, 'desc'])) as Record<BuyerComponentKey, 'desc'>),
};

export interface BuyerFilters {
  shortlisted?: 'yes' | 'no';
  stage?: BuyerLeadStage | 'none';
  bucket?: OperationalBucket;
  country?: string;
  sanctions?: string;
  minScore?: number;
  minConfidence?: number;
}

/** Apply filters the current data genuinely supports. Unknown values are ignored, not guessed. */
export function filterBuyerRows(rows: BuyerControlRow[], f: BuyerFilters): BuyerControlRow[] {
  return rows.filter((row) => {
    if (f.shortlisted === 'yes' && !row.canonical.onShortlist) return false;
    if (f.shortlisted === 'no' && row.canonical.onShortlist) return false;
    if (f.stage === 'none' && row.canonical.leadStage !== null) return false;
    if (f.stage && f.stage !== 'none' && row.canonical.leadStage !== f.stage) return false;
    if (f.bucket && row.bucket !== f.bucket) return false;
    if (f.country && row.countryCode !== f.country) return false;
    if (f.sanctions && row.evidence.sanctions?.resultState !== f.sanctions) return false;
    if (f.minScore != null && (row.fit.score ?? -1) < f.minScore) return false;
    if (f.minConfidence != null && row.fit.confidence_score < f.minConfidence) return false;
    return true;
  });
}
