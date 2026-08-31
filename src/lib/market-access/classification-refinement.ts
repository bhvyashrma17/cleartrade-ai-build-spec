/**
 * Product classification refinement: HS6 → the destination's declarable national tariff line.
 *
 * The strategic point of this module is the questionnaire, not the selection. A UK exporter of
 * rice faces 108 declarable commodity codes under HS 1006.30. Showing them to a manufacturer is
 * not a product decision, it is a nomenclature exam. So the candidate DESCRIPTIONS are mined for
 * the attributes that actually separate them, and those become product questions — "is the rice
 * parboiled?", "is it Basmati?" — which an exporter can answer about their own goods.
 *
 * Nothing here picks a line. Derivation only ever narrows the candidate set using product facts
 * that are already known; when the remaining candidates still differ, the outcome is a question,
 * never a guess. An agent may curate a question the taxonomy could not produce, and that question
 * carries its author.
 */
import { EvidenceAssertionClass, EvidenceOrigin, Prisma, UserRole } from '@prisma/client';
import { forbidden, notFound, validationError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';

export const CLASSIFICATION_REFINEMENT_VERSION = 'classification-refinement-v1' as const;

export type RefinementState =
  | 'unresolved'
  | 'refinement_required'
  | 'exporter_declared_selection'
  | 'agent_verified_selection'
  | 'authoritative_verified'
  | 'superseded';

export interface CandidateLine {
  national_tariff_code: string;
  description: string;
  /** Ancestry descriptions, outermost first. The distinguishing words usually live here. */
  description_path?: string[];
  duty_expression: string | null;
  duty_kind: string | null;
  effective_from?: string | null;
  effective_to?: string | null;
}

/**
 * One product question, derived from a distinction the candidate descriptions actually make.
 *
 * `attribute` is the product fact the answer establishes; `options` map an answer to the
 * candidates it keeps. A question is only emitted when it genuinely partitions the set.
 */
export interface RefinementQuestion {
  key: string;
  question: string;
  attribute: string;
  /** `derived` questions come from the candidate taxonomy; `curated` ones from an agent. */
  origin: 'derived' | 'curated';
  options: Array<{ value: string; label: string; keeps_codes: string[] }>;
  authored_by_id?: string | null;
}

/**
 * Attributes worth asking a manufacturer about, and the words that signal them.
 *
 * These are matched against the authority's own candidate descriptions — they never assert what
 * a tariff line means. If a term does not appear in the returned candidates, no question is
 * produced for it, which is why this cannot invent a distinction the source did not make.
 */
const PRODUCT_ATTRIBUTE_SIGNALS: ReadonlyArray<{
  attribute: string;
  question: string;
  positive: RegExp;
  positiveLabel: string;
  negativeLabel: string;
}> = Object.freeze([
  { attribute: 'parboiled', question: 'Is the rice parboiled?', positive: /\bparboiled\b/i, positiveLabel: 'Yes — parboiled', negativeLabel: 'No — not parboiled' },
  { attribute: 'basmati', question: 'Is this Basmati rice?', positive: /\bbasmati\b/i, positiveLabel: 'Yes — Basmati', negativeLabel: 'No — not Basmati' },
  { attribute: 'aromatic', question: 'Is this an aromatic rice variety?', positive: /\baromatic\b/i, positiveLabel: 'Yes — aromatic', negativeLabel: 'No — not aromatic' },
  { attribute: 'husked_brown', question: 'Is the rice husked (brown) rather than milled?', positive: /\bhusked\b|\bbrown rice\b/i, positiveLabel: 'Yes — husked/brown', negativeLabel: 'No — milled' },
  { attribute: 'wholly_milled', question: 'Is the rice wholly milled rather than semi-milled?', positive: /\bwholly milled\b/i, positiveLabel: 'Yes — wholly milled', negativeLabel: 'No — semi-milled' },
  { attribute: 'organic', question: 'Is the product certified organic?', positive: /\borganic\b/i, positiveLabel: 'Yes — certified organic', negativeLabel: 'No' },
  { attribute: 'grain_length', question: 'What is the grain length category?', positive: /\blong grain\b/i, positiveLabel: 'Long grain', negativeLabel: 'Round or medium grain' },
  { attribute: 'retail_pack_5kg_or_less', question: 'Is the product packed for retail in immediate packings of 5 kg or less?', positive: /not exceeding 5\s*kg/i, positiveLabel: 'Yes — 5 kg or less', negativeLabel: 'No — larger than 5 kg' },
]);

const textOf = (line: CandidateLine) => [line.description, ...(line.description_path ?? [])].join(' | ');

/**
 * Derive the smallest useful set of product questions from the candidate set.
 *
 * A signal is only a question when the candidates genuinely split on it — every candidate
 * matching, or none matching, tells the exporter nothing and is skipped.
 */
export function deriveRefinementQuestions(candidates: readonly CandidateLine[]): RefinementQuestion[] {
  const questions: RefinementQuestion[] = [];
  if (candidates.length < 2) return questions;
  for (const signal of PRODUCT_ATTRIBUTE_SIGNALS) {
    const yes = candidates.filter((line) => signal.positive.test(textOf(line)));
    const no = candidates.filter((line) => !signal.positive.test(textOf(line)));
    if (!yes.length || !no.length) continue;
    questions.push({
      key: signal.attribute,
      question: signal.question,
      attribute: signal.attribute,
      origin: 'derived',
      options: [
        { value: 'yes', label: signal.positiveLabel, keeps_codes: yes.map((line) => line.national_tariff_code).sort() },
        { value: 'no', label: signal.negativeLabel, keeps_codes: no.map((line) => line.national_tariff_code).sort() },
      ],
    });
  }
  // Most-discriminating first: the question that splits the set most evenly removes the most
  // uncertainty per answer, which is what keeps the questionnaire short.
  return questions.sort((left, right) => {
    const balance = (question: RefinementQuestion) => Math.abs(question.options[0]!.keeps_codes.length - question.options[1]!.keeps_codes.length);
    return balance(left) - balance(right) || left.key.localeCompare(right.key);
  });
}

export interface RefinementNarrowing {
  remaining: CandidateLine[];
  applied: Array<{ attribute: string; answer: string; remaining_after: number }>;
  outstanding_questions: RefinementQuestion[];
  /** Set only when exactly one candidate survives. */
  determined_code: string | null;
}

/**
 * Narrow the candidates using product answers already on file.
 *
 * Only answers that are actually known are applied; an unknown attribute leaves the set intact
 * rather than being treated as "no". A single survivor is REPORTED, not selected — recording it
 * is a separate, attributed decision.
 */
export function narrowCandidates(candidates: readonly CandidateLine[], answers: Readonly<Record<string, string | null | undefined>>): RefinementNarrowing {
  let remaining = [...candidates];
  const applied: RefinementNarrowing['applied'] = [];
  for (const signal of PRODUCT_ATTRIBUTE_SIGNALS) {
    const answer = answers[signal.attribute];
    if (answer !== 'yes' && answer !== 'no') continue;
    const next = remaining.filter((line) => signal.positive.test(textOf(line)) === (answer === 'yes'));
    // An answer that eliminates every candidate is a contradiction, not a narrowing; keep the
    // previous set so the exporter is asked again rather than left with nothing.
    if (!next.length) continue;
    remaining = next;
    applied.push({ attribute: signal.attribute, answer, remaining_after: remaining.length });
    if (remaining.length === 1) break;
  }
  return {
    remaining,
    applied,
    outstanding_questions: remaining.length > 1 ? deriveRefinementQuestions(remaining) : [],
    determined_code: remaining.length === 1 ? remaining[0]!.national_tariff_code : null,
  };
}

const SELECTION_STATES: readonly RefinementState[] = ['exporter_declared_selection', 'agent_verified_selection', 'authoritative_verified'];

export interface RecordRefinementArgs {
  actor: { id: string; role: UserRole };
  exporter_org_id: string;
  product_id: string;
  product_classification_id: string;
  destination_country: string;
  national_code_system: string;
  source_authority: string;
  source_reference: string;
  source_snapshot_id?: string | null;
  candidates: readonly CandidateLine[];
  /** Omit to record the candidate set and its questions without choosing anything. */
  selected_national_code?: string | null;
  selection_rationale?: string | null;
  deciding_attributes?: Record<string, string> | null;
  state: RefinementState;
  effective_from?: Date | null;
  effective_to?: Date | null;
  curated_questions?: RefinementQuestion[];
  now?: Date;
}

const AGENT_ROLES: readonly UserRole[] = [UserRole.agent, UserRole.ops_supervisor, UserRole.admin];

/**
 * Record a refinement, verifying every claim the caller makes about it server-side.
 *
 * A client may not submit an arbitrary tariff code: the selection must be one of the candidates
 * the authoritative source returned, must sit beneath the frozen HS6, and must be current. And
 * an exporter cannot file an agent-verified selection — verification is somebody else's act.
 */
export async function recordClassificationRefinement(args: RecordRefinementArgs) {
  const now = args.now ?? new Date();
  const classification = await prisma.productClassification.findUnique({ where: { id: args.product_classification_id }, include: { product: true } });
  if (!classification) throw notFound('That product classification does not exist.');
  if (classification.product_id !== args.product_id || classification.product.exporter_org_id !== args.exporter_org_id) {
    throw validationError([{ field: 'product_classification_id', code: 'mismatch', message: 'That classification does not belong to this product and exporter.' }]);
  }
  const hs6 = classification.hs6_code;

  const isAgent = AGENT_ROLES.includes(args.actor.role);
  if (args.state === 'agent_verified_selection' || args.state === 'authoritative_verified') {
    if (!isAgent) throw forbidden('Only an agent or operations reviewer may record a verified classification selection.');
  }
  if (args.state === 'superseded') throw validationError([{ field: 'state', code: 'invalid', message: 'Supersession is recorded by filing a replacement, not by declaring it.' }]);

  const fields: Array<{ field: string; code: string; message: string }> = [];
  if (!/^[A-Z]{2}$/.test(args.destination_country)) fields.push({ field: 'destination_country', code: 'invalid', message: 'An ISO alpha-2 destination is required.' });
  if (!args.candidates.length) fields.push({ field: 'candidates', code: 'required', message: 'The authoritative candidate set must be recorded, even when no line is selected.' });
  const seen = new Set<string>();
  for (const [index, candidate] of args.candidates.entries()) {
    if (!candidate.national_tariff_code.startsWith(hs6)) fields.push({ field: `candidates[${index}]`, code: 'invalid', message: `Candidate ${candidate.national_tariff_code} does not sit beneath HS6 ${hs6}.` });
    if (candidate.national_tariff_code.length <= hs6.length) fields.push({ field: `candidates[${index}]`, code: 'invalid', message: 'A candidate must be a national line, not the HS6 itself.' });
    if (seen.has(candidate.national_tariff_code)) fields.push({ field: `candidates[${index}]`, code: 'duplicate', message: `Candidate ${candidate.national_tariff_code} is listed twice.` });
    seen.add(candidate.national_tariff_code);
  }

  const selected = args.selected_national_code?.trim() || null;
  if (SELECTION_STATES.includes(args.state)) {
    if (!selected) fields.push({ field: 'selected_national_code', code: 'required', message: 'A selection state requires a selected national line.' });
    else {
      const candidate = args.candidates.find((line) => line.national_tariff_code === selected);
      // This is the injection guard: the code must have come from the authority, not the client.
      if (!candidate) fields.push({ field: 'selected_national_code', code: 'not_a_candidate', message: `${selected} is not among the candidate lines the authoritative source returned.` });
      else {
        if (candidate.effective_from && new Date(candidate.effective_from).getTime() > now.getTime()) fields.push({ field: 'selected_national_code', code: 'not_yet_effective', message: 'That line is not yet in force.' });
        if (candidate.effective_to && new Date(candidate.effective_to).getTime() <= now.getTime()) fields.push({ field: 'selected_national_code', code: 'expired', message: 'That line is no longer in force.' });
      }
      if (!args.selection_rationale?.trim()) fields.push({ field: 'selection_rationale', code: 'required', message: 'A selection must record why this line and not its siblings.' });
    }
  } else if (selected) {
    fields.push({ field: 'selected_national_code', code: 'invalid', message: 'A non-selection state may not carry a selected line.' });
  }
  if (fields.length) throw validationError(fields);

  const questions = [
    ...deriveRefinementQuestions(args.candidates),
    ...(args.curated_questions ?? []).map((question) => ({ ...question, origin: 'curated' as const, authored_by_id: args.actor.id })),
  ];

  const assertionClass = args.state === 'authoritative_verified'
    ? EvidenceAssertionClass.authoritative_public
    : args.state === 'agent_verified_selection'
      ? EvidenceAssertionClass.agent_verified
      : args.state === 'exporter_declared_selection'
        ? EvidenceAssertionClass.exporter_declared
        : EvidenceAssertionClass.authoritative_public;

  return prisma.$transaction(async (tx) => {
    const created = await tx.productClassificationRefinement.create({
      data: {
        exporter_org_id: args.exporter_org_id, product_id: args.product_id, product_classification_id: args.product_classification_id,
        hs6_code: hs6, hs_revision: classification.nomenclature_version, destination_country: args.destination_country,
        national_code_system: args.national_code_system, source_snapshot_id: args.source_snapshot_id ?? null,
        state: args.state,
        candidate_lines: args.candidates as unknown as Prisma.InputJsonValue,
        candidate_count: args.candidates.length,
        selected_national_code: selected,
        selection_rationale: args.selection_rationale?.trim() || null,
        deciding_attributes: (args.deciding_attributes ?? null) as Prisma.InputJsonValue,
        outstanding_questions: questions as unknown as Prisma.InputJsonValue,
        source_authority: args.source_authority, source_reference: args.source_reference,
        effective_from: args.effective_from ?? null, effective_to: args.effective_to ?? null,
        decided_by_id: SELECTION_STATES.includes(args.state) ? args.actor.id : null,
        decided_at: SELECTION_STATES.includes(args.state) ? now : null,
        assertion_class: assertionClass,
        evidence_origin: args.state === 'authoritative_verified' ? EvidenceOrigin.public_real : EvidenceOrigin.manually_entered_real,
      },
    });
    // Supersede the previous live refinement for the same product/destination. The old row keeps
    // its content; only the forward-only supersession annotation is written, so an assessment
    // that cited it still reads exactly as it did.
    await tx.productClassificationRefinement.updateMany({
      where: { product_id: args.product_id, destination_country: args.destination_country, superseded_at: null, id: { not: created.id } },
      data: { superseded_at: now, superseded_by_id: created.id },
    });
    return created;
  });
}

/** The refinement in force for this product/destination at a frozen clock, if any. */
export async function currentRefinement(args: { product_id: string; destination_country: string; as_of: Date }) {
  return prisma.productClassificationRefinement.findFirst({
    where: {
      product_id: args.product_id,
      destination_country: args.destination_country,
      created_at: { lte: args.as_of },
      OR: [{ superseded_at: null }, { superseded_at: { gt: args.as_of } }],
    },
    orderBy: { created_at: 'desc' },
  });
}
