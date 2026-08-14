/**
 * Rationale writing — the boundary between computed facts and generated prose.
 *
 * THE HARD RULE, enforced structurally rather than by instruction: a rationale writer is
 * handed already-computed facts and returns **qualitative prose containing no digits**. The
 * numbers in a finished rationale are concatenated in by `src/lib/discovery/rationale/index.ts`
 * from the same `ScoredMarket` the arithmetic produced — the writer never has the
 * opportunity to state one.
 *
 * Why enforcement rather than a well-written prompt: a prompt that says "don't invent
 * numbers" is a request, and a model that ignores it fails silently and plausibly. "Ranks
 * third among Gulf markets with 12% growth" reads exactly like a fact. In trade data a
 * fabricated figure is a liability an exporter may act on, so the guarantee has to survive
 * a model that is wrong, and the only guarantee that does is one where the wrong output is
 * mechanically detectable. A digit in the writer's output is therefore not a bad rationale
 * to be tolerated — it is a contract violation, rejected by `assertNoDigits()`, with the
 * deterministic writer used instead.
 *
 * The facts below are deliberately QUALITATIVE — bands and directions, not magnitudes. The
 * writer cannot leak a figure it was never shown.
 */

/** Qualitative characterisation of one market. No magnitudes, by construction. */
export interface RationaleFacts {
  country_code: string;
  /** Where this market landed in the run's ranking. */
  standing: 'top' | 'strong' | 'moderate' | 'weak';
  demand: 'large' | 'moderate' | 'small' | 'unknown';
  growth: 'growing quickly' | 'growing' | 'flat' | 'shrinking' | 'unknown';
  /** How concentrated the incumbent supplier base is. */
  supplier_base: 'fragmented' | 'mixed' | 'concentrated' | 'unknown';
  /** India's existing presence in this market. */
  india_presence: 'established' | 'emerging' | 'minimal' | 'unknown';
  /** Which criteria had no warehouse data and so did not contribute. */
  unavailable_criteria: string[];
  /** Free-text product context from the run's input snapshot. Never a number we computed. */
  product_context: string;
}

export interface RationaleWriter {
  /** Stable identifier recorded on the run's provenance, so a stored rationale says what wrote it. */
  readonly name: string;
  /**
   * Return one or two sentences of qualitative prose. MUST NOT contain digits — the caller
   * rejects output that does and falls back to the deterministic writer.
   */
  write(facts: RationaleFacts): Promise<string>;
}

/**
 * The guard that makes the rule real.
 *
 * Rejects any digit at all rather than trying to distinguish "legitimate" numbers from
 * fabricated ones — that distinction cannot be drawn reliably from text, and a rule that
 * needs judgement to enforce is not a rule. Prose has no business carrying figures here
 * anyway: every number the user sees is appended by the caller from computed facts.
 */
export function containsDigits(text: string): boolean {
  return /[0-9]/.test(text);
}

/** Throws when prose violates the no-numbers contract. Callers catch and fall back. */
export function assertNoDigits(text: string, writerName: string): void {
  if (containsDigits(text)) {
    throw new Error(
      `Rationale writer "${writerName}" emitted digits, violating the numbers-from-arithmetic-only rule. Output rejected.`,
    );
  }
}
