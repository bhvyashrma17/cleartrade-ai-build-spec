/**
 * Deterministic mock discovery engine.
 *
 * There is no AI provider wired up yet, and the guest funnel dead-ends without *something*
 * behind the job. This produces plausible ranked markets so the whole pipeline — enqueue,
 * claim, progress, persist, poll, render — is exercisable end to end.
 *
 * Two properties matter:
 *
 *   - **Deterministic.** The same input always yields the same ranking, seeded from a hash
 *     of the input. A test asserting "turmeric ranks the UAE top" stays true, and a demo
 *     doesn't reshuffle between runs. Randomness here would make the job system itself
 *     untestable.
 *   - **Realistically slow.** It sleeps in steps and reports progress, because a handler
 *     that returns instantly would never exercise `processing`, progress reporting, or
 *     stale-job recovery — the parts most likely to be wrong.
 *
 * It is a stand-in for a provider, not a model of trade economics. The numbers are
 * internally consistent and stable; they are not researched, and nothing should be
 * inferred from them. Swapping in a real engine touches only `getDiscoveryEngine()`.
 */

import { createHash } from 'node:crypto';
import type {
  DiscoveryEngine,
  DiscoveryInput,
  DiscoveryResult,
  MarketAssessmentDraft,
} from './engine';

/** Candidate destination markets with characteristics stable enough to rank against. */
const MARKETS: { code: string; name: string; affinity: string[]; tariffBand: string }[] = [
  { code: 'AE', name: 'United Arab Emirates', affinity: ['spice', 'food', 'textile', 'rice'], tariffBand: 'low' },
  { code: 'US', name: 'United States', affinity: ['spice', 'textile', 'organic', 'food'], tariffBand: 'medium' },
  { code: 'GB', name: 'United Kingdom', affinity: ['spice', 'textile', 'organic'], tariffBand: 'medium' },
  { code: 'DE', name: 'Germany', affinity: ['organic', 'textile', 'machinery'], tariffBand: 'medium' },
  { code: 'NL', name: 'Netherlands', affinity: ['spice', 'food', 'organic'], tariffBand: 'medium' },
  { code: 'SA', name: 'Saudi Arabia', affinity: ['rice', 'spice', 'food'], tariffBand: 'low' },
  { code: 'AU', name: 'Australia', affinity: ['spice', 'food', 'textile'], tariffBand: 'low' },
  { code: 'JP', name: 'Japan', affinity: ['organic', 'spice', 'machinery'], tariffBand: 'high' },
  { code: 'SG', name: 'Singapore', affinity: ['spice', 'food', 'rice'], tariffBand: 'low' },
  { code: 'CA', name: 'Canada', affinity: ['spice', 'textile', 'organic'], tariffBand: 'medium' },
];

const TARIFF_NOTE: Record<string, string> = {
  low: 'Low or nil duty on most Indian-origin goods in this category.',
  medium: 'Moderate duty; check preferential rates before quoting.',
  high: 'Higher duty and stricter documentation — price accordingly.',
};

/** Stable 32-bit seed from the input, so ranking is reproducible. */
function seedFrom(input: DiscoveryInput): number {
  const basis = `${input.description.trim().toLowerCase()}|${input.hs_code ?? ''}`;
  return parseInt(createHash('sha256').update(basis).digest('hex').slice(0, 8), 16);
}

/** Deterministic pseudo-random in [0,1) — mulberry32. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Crude keyword affinity — enough to make rankings track the input rather than ignore it. */
function affinityScore(description: string, affinity: string[]): number {
  const text = description.toLowerCase();
  return affinity.reduce((score, term) => (text.includes(term) ? score + 1 : score), 0);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class MockDiscoveryEngine implements DiscoveryEngine {
  readonly name = 'mock-v1';

  /** Total simulated work, split across steps so progress is observable. */
  constructor(private readonly latencyMs = 2400) {}

  async rank(
    input: DiscoveryInput,
    signal?: { onProgress?: (pct: number) => void },
  ): Promise<DiscoveryResult> {
    const random = rng(seedFrom(input));
    const requested = (input.target_countries ?? []).map((c) => c.toUpperCase());
    const pool = requested.length ? MARKETS.filter((m) => requested.includes(m.code)) : MARKETS;

    // A caller can name a country we have no data for. That is `partial`, not failure:
    // docs/09 §3 wants the successful records rendered with the gaps clearly marked.
    const unknown = requested.filter((c) => !MARKETS.some((m) => m.code === c));

    const steps = 4;
    const drafts: MarketAssessmentDraft[] = [];

    for (let step = 0; step < steps; step += 1) {
      await sleep(this.latencyMs / steps);
      signal?.onProgress?.(Math.round(((step + 1) / steps) * 90));
    }

    for (const market of pool) {
      const affinity = affinityScore(input.description, market.affinity);
      const jitter = random();

      // Weighted so affinity dominates but every market gets a stable spread.
      const demand = clamp(38 + affinity * 14 + jitter * 22);
      const growth = clamp(34 + affinity * 10 + random() * 30);
      const competition = clamp(30 + random() * 45);
      // Competition is a cost, not a benefit — it subtracts.
      const overall = clamp(Math.round(demand * 0.45 + growth * 0.3 + (100 - competition) * 0.25));

      drafts.push({
        country_code: market.code,
        overall_score: overall,
        demand_score: Math.round(demand),
        growth_score: Math.round(growth),
        competition_score: Math.round(competition),
        india_share: Number((random() * 12).toFixed(3)),
        tariff_summary: { band: market.tariffBand, note: TARIFF_NOTE[market.tariffBand] },
        certification_requirements: affinity > 0 ? ['Phytosanitary certificate', 'Certificate of Origin'] : [],
        logistics_summary: {
          typical_transit_days: 12 + Math.round(random() * 24),
          common_mode: market.tariffBand === 'low' ? 'sea' : 'sea/air',
        },
        price_band_min: Number((2 + random() * 3).toFixed(2)),
        price_band_max: Number((6 + random() * 6).toFixed(2)),
        price_band_currency: 'USD',
        rationale: buildRationale(market.name, overall, demand, competition, affinity),
      });
    }

    drafts.sort((a, b) => b.overall_score! - a.overall_score!);
    signal?.onProgress?.(100);

    return {
      assessments: drafts,
      partial: unknown.length > 0,
      missing: unknown.length ? unknown.map((c) => `No market data for ${c}`) : undefined,
      provenance: {
        engine: this.name,
        // Labelled so the UI can mark it as generated rather than researched (docs/00 §6).
        generated: 'simulated',
        note: 'Placeholder rankings from a deterministic mock. Not real market research.',
      },
    };
  }
}

function clamp(value: number): number {
  return Math.max(1, Math.min(99, Math.round(value)));
}

/** Plain language first, per docs/00 §7 — a score with no reason is not an answer. */
function buildRationale(
  name: string,
  overall: number,
  demand: number,
  competition: number,
  affinity: number,
): string {
  const strength = overall >= 70 ? 'Strong match' : overall >= 50 ? 'Worth considering' : 'Weaker fit';
  const demandNote = demand >= 60 ? 'steady import demand' : 'modest import demand';
  const compNote = competition >= 60 ? 'a crowded supplier base' : 'room for new suppliers';
  const fitNote = affinity > 0 ? ' Your product category is already traded into this market.' : '';
  return `${strength} for ${name}: ${demandNote} and ${compNote}.${fitNote}`;
}
