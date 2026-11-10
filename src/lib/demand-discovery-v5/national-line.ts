/**
 * D-045 (owner, 10 Nov 2026): where a market's tariff splits the product's HS6 into national lines
 * with different duties, which line — and so which official duty — applies. Pure.
 *
 * Order, as the owner chose ("Description, then a question"):
 *   1. Answers on file for the product and the market, given by the exporter or its agent on the
 *      tariff-line questions. They always win.
 *   2. What the product's own words state ("Basmati rice" is Basmati; "not parboiled" is not), for
 *      each attribute the answers leave open (`answersNamedIn`).
 *   3. Otherwise the line stays open: the run keeps its labelled estimate and the market asks the
 *      first question that would narrow it.
 *
 * Nothing here guesses. The duty is settled only when every line still in scope carries the same
 * duty, so a line the answers cannot tell apart never changes the figure; when every candidate
 * carries the same duty to begin with, the split never mattered. The lines are the official
 * source's own (`resolution_detail.declarable_candidates`), never a code anyone typed.
 */
import { answersNamedIn, deriveRefinementQuestions, narrowCandidates, type CandidateLine } from '@/lib/market-access/classification-refinement';

/** How the line was settled: by answers on file, the product's own words, both, or because every line carries one duty. */
export type LineChoiceBasis = 'answers' | 'description' | 'description_and_answers' | 'one_duty';

export interface LineChoice {
  basis: LineChoiceBasis;
  /** The national lines still in scope, all carrying the scored duty. */
  codes: string[];
  /** The answers that narrowed the candidates, by where each came from. */
  from_answers: Record<string, string>;
  from_description: Record<string, string>;
}

export type NationalLineOutcome =
  | { status: 'chosen'; lines: CandidateLine[]; choice: LineChoice }
  | { status: 'open'; remaining: CandidateLine[]; question: string | null; questions: number };

const sameText = (value: string | null | undefined) => (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Every line carries one stated duty. A line without a duty never settles anything. */
function oneDuty(lines: readonly CandidateLine[]): boolean {
  if (!lines.length) return false;
  const first = lines[0]!;
  if (!sameText(first.duty_expression) || first.duty_kind === 'none') return false;
  return lines.every((line) => sameText(line.duty_expression) === sameText(first.duty_expression) && line.duty_kind === first.duty_kind);
}

/** Candidates in force on `asOf` (a candidate states its own validity when its source does). */
export function currentCandidates(candidates: readonly CandidateLine[], asOf: Date): CandidateLine[] {
  const at = asOf.getTime();
  return candidates.filter((line) => {
    const from = line.effective_from ? Date.parse(line.effective_from) : null;
    const to = line.effective_to ? Date.parse(line.effective_to) : null;
    return (from == null || !Number.isFinite(from) || from <= at) && (to == null || !Number.isFinite(to) || to > at);
  });
}

export function chooseNationalLines(args: {
  candidates: readonly CandidateLine[];
  /** The product's own words: its name and description. */
  product_text: string;
  /** Answers on file for this product and market (`deciding_attributes`), if any. */
  answers?: Readonly<Record<string, unknown>> | null;
}): NationalLineOutcome {
  const candidates = [...args.candidates];
  const codes = (lines: readonly CandidateLine[]) => lines.map((line) => line.national_tariff_code).sort();
  if (oneDuty(candidates)) return { status: 'chosen', lines: candidates, choice: { basis: 'one_duty', codes: codes(candidates), from_answers: {}, from_description: {} } };

  const given: Record<string, string> = {};
  for (const [attribute, answer] of Object.entries(args.answers ?? {})) if (answer === 'yes' || answer === 'no') given[attribute] = answer;
  const named = answersNamedIn(args.product_text);
  const described: Record<string, string> = {};
  for (const [attribute, answer] of Object.entries(named)) if (!(attribute in given)) described[attribute] = answer;

  const narrowing = narrowCandidates(candidates, { ...described, ...given });
  if (oneDuty(narrowing.remaining)) {
    const fromAnswers: Record<string, string> = {};
    const fromDescription: Record<string, string> = {};
    for (const step of narrowing.applied) (step.attribute in given ? fromAnswers : fromDescription)[step.attribute] = step.answer;
    const usedAnswers = Object.keys(fromAnswers).length > 0;
    const usedDescription = Object.keys(fromDescription).length > 0;
    const basis: LineChoiceBasis = usedAnswers && usedDescription ? 'description_and_answers' : usedAnswers ? 'answers' : 'description';
    return { status: 'chosen', lines: narrowing.remaining, choice: { basis, codes: codes(narrowing.remaining), from_answers: fromAnswers, from_description: fromDescription } };
  }
  const questions = deriveRefinementQuestions(narrowing.remaining);
  return { status: 'open', remaining: narrowing.remaining, question: questions[0]?.question ?? null, questions: questions.length };
}
