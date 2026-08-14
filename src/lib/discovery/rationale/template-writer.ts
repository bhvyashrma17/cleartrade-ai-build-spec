/**
 * Deterministic rationale writer — the default, and the fallback.
 *
 * Two jobs. It is what runs when no model is configured (no API key, or `RATIONALE_WRITER`
 * left at its default), and it is what the caller falls back to when a model's output
 * violates the no-digits contract. Both paths must produce something an exporter can read,
 * so this is written as real explanatory copy rather than a placeholder string.
 *
 * Deterministic by construction — no clock, no randomness, no model — which is what lets
 * `scripts/verify-warehouse-discovery.ts` assert that two runs over the same
 * `input_snapshot` produce byte-identical assessments. A model-written rationale is
 * non-deterministic by nature, so reproducibility is verified against this writer; the
 * scores themselves are reproducible either way, since prose never feeds back into them.
 */

import type { RationaleFacts, RationaleWriter } from './writer';

const STANDING_OPENER: Record<RationaleFacts['standing'], string> = {
  top: 'A leading match',
  strong: 'A strong candidate',
  moderate: 'Worth considering',
  weak: 'A weaker fit',
};

const DEMAND_CLAUSE: Record<RationaleFacts['demand'], string> = {
  large: 'imports at substantial volume',
  moderate: 'imports at moderate volume',
  small: 'is a smaller import market',
  unknown: 'has no volume figures in our data',
};

const GROWTH_CLAUSE: Record<RationaleFacts['growth'], string> = {
  'growing quickly': 'and demand has been rising sharply',
  growing: 'and demand has been rising',
  flat: 'though demand has been broadly flat',
  shrinking: 'though demand has been contracting',
  unknown: 'though we cannot yet measure its trend',
};

const SUPPLIER_CLAUSE: Record<RationaleFacts['supplier_base'], string> = {
  fragmented: 'No single supplier country dominates, which leaves room for a new entrant.',
  mixed: 'Supply is split across several established countries.',
  concentrated: 'A small number of supplier countries hold most of this market, so displacing an incumbent is the harder path.',
  unknown: 'We do not yet hold supplier-level data for this market.',
};

const INDIA_CLAUSE: Record<RationaleFacts['india_presence'], string> = {
  established: 'Indian goods already hold a meaningful position here, so the compliance and buyer-acceptance path is well trodden.',
  emerging: 'Indian goods have a foothold here but the position is still small.',
  minimal: 'Indian goods are barely present, which means both an open field and an untested route.',
  unknown: 'We hold no data on India-origin trade into this market.',
};

export class TemplateRationaleWriter implements RationaleWriter {
  readonly name = 'template-v1';

  async write(facts: RationaleFacts): Promise<string> {
    const sentences = [
      `${STANDING_OPENER[facts.standing]}: this market ${DEMAND_CLAUSE[facts.demand]} ${GROWTH_CLAUSE[facts.growth]}.`,
      SUPPLIER_CLAUSE[facts.supplier_base],
      INDIA_CLAUSE[facts.india_presence],
    ];

    if (facts.unavailable_criteria.length > 0) {
      // Naming the gaps is required, not optional — docs/04 EXP-04-AC02. A score built on
      // four of six criteria must say so rather than presenting as a complete assessment.
      sentences.push(
        `Scored without ${facts.unavailable_criteria.join(' and ')}, which we hold no data for yet.`,
      );
    }

    return sentences.join(' ');
  }
}
