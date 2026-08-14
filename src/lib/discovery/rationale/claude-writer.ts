/**
 * Claude-backed rationale writer.
 *
 * Writes the qualitative half of a market rationale — why the ranking reads the way it
 * does, in plain language an exporter can act on. It is handed the characterisations in
 * `RationaleFacts` (bands and directions: "large", "growing", "concentrated") and never a
 * magnitude, so there is no figure in its context for it to restate, round, or embellish.
 *
 * Three layers keep the no-numbers rule from depending on the model behaving:
 *
 *   1. The input carries no numbers, so a correct answer cannot contain one.
 *   2. The system prompt states the constraint plainly (current models follow a stated
 *      constraint closely; shouting at them causes over-correction, not compliance).
 *   3. `assertNoDigits()` in the caller rejects any output containing a digit and falls
 *      back to the deterministic writer. This is the layer that actually holds — the first
 *      two make violations rare, the third makes them harmless.
 *
 * Selection is via `RATIONALE_WRITER=claude` plus `ANTHROPIC_API_KEY`; the default is the
 * deterministic writer, so nothing here runs unless deliberately switched on.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { RationaleFacts, RationaleWriter } from './writer';

const SYSTEM_PROMPT = `You explain export-market rankings to Indian manufacturers, many of them first-time exporters.

You are given a qualitative characterisation of one destination market. Write one or two sentences explaining what the characterisation means for an exporter deciding whether to pursue this market.

Rules:
- Write no numerals and no digits of any kind. Do not state figures, percentages, ranks, years, or quantities, even ones you can infer. The numbers are rendered separately by the system; your job is the interpretation around them. A response containing a digit is discarded.
- Only describe what the characterisation actually says. Do not add market knowledge of your own, name competitor countries, or speculate about tariffs, certification, or logistics — those are separate data sources this system does not yet hold.
- Where a criterion is marked unknown, say the data is missing rather than guessing at it.
- Plain language first, customs jargon only where unavoidable. Address the reader as "you".
- Be direct and concrete. No preamble, no restating the question, no hedging disclaimers.`;

function factsToPrompt(facts: RationaleFacts): string {
  const lines = [
    `Product context: ${facts.product_context || 'not specified'}`,
    `Destination market (ISO country code): ${facts.country_code}`,
    `Overall standing in this search: ${facts.standing}`,
    `Import demand: ${facts.demand}`,
    `Demand trend: ${facts.growth}`,
    `Incumbent supplier base: ${facts.supplier_base}`,
    `Existing India-origin presence: ${facts.india_presence}`,
  ];
  if (facts.unavailable_criteria.length > 0) {
    lines.push(`Criteria with no data available: ${facts.unavailable_criteria.join(', ')}`);
  }
  return lines.join('\n');
}

export class ClaudeRationaleWriter implements RationaleWriter {
  readonly name = 'claude-opus-5';

  private readonly client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic(apiKey ? { apiKey } : {});
  }

  async write(facts: RationaleFacts): Promise<string> {
    const response = await this.client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      // Effort is low deliberately: this is a short, tightly-specified rewriting task, not
      // an analysis. Thinking stays on (the default) — disabling it on this model can leak
      // internal tags into the visible response, which is exactly the output we then have
      // to discard.
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: factsToPrompt(facts) }],
    });

    // Check stop_reason before touching content: a refusal returns HTTP 200 with an empty
    // or partial content array, and indexing into it blindly would throw here rather than
    // degrade to the fallback writer.
    if (response.stop_reason === 'refusal') {
      throw new Error('Rationale generation was declined by the model safety classifier.');
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join(' ')
      .trim();

    if (!text) throw new Error('Model returned no text for the rationale.');
    return text;
  }
}
