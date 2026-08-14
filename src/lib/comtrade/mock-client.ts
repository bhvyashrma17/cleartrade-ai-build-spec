/**
 * Deterministic stand-in for the real Comtrade API — same role as
 * `discovery/mock-engine.ts`'s `MockDiscoveryEngine`: hash-seeded, not random, so two runs
 * with identical parameters produce identical rows. That determinism is what makes the
 * ingest job's idempotency and the scoring engine's reproducibility verifiable at all in an
 * environment with no outbound network access.
 *
 * Three properties are deliberate, and each is load-bearing for the scoring engine that
 * reads this data downstream:
 *
 *   1. **The HS-code set is a function of the chapter alone**, never of reporter/partner/year.
 *      HS is a global classification: subheading 090111 exists in every country's statistics.
 *      Seeding the code set per-tuple (the obvious shortcut) would give each reporter a
 *      disjoint set of codes, and every cross-country query — "who imports 090111?" — would
 *      return exactly one country. Only the VALUES vary per tuple.
 *   2. **Values trend across years** via a stable per-reporter growth factor, so a 5-year
 *      CAGR computed over this data is a real number rather than noise around zero.
 *   3. **Partner shares are stable per reporter**, so a supplier-concentration HHI means
 *      something and India's share of a given market doesn't jump between years.
 *
 * It is a stand-in for a provider, not a model of trade economics. The magnitudes are
 * internally consistent and stable; they are not researched, and nothing should be inferred
 * from them.
 */

import type { ComtradeClient, ComtradeFetchParams, ComtradeFetchResult, ComtradeFlowRow } from './client';
import { WORLD_PARTNER } from './areas';

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const UNITS = ['kg', 'No', 'Litre'];

/** The chapter's subheadings — stable across every reporter, partner, and year. */
function subheadingsForChapter(chapter: string): string[] {
  const rng = mulberry32(hashSeed(`chapter:${chapter}`));
  const count = 6 + Math.floor(rng() * 6);
  const codes = new Set<string>();
  while (codes.size < count) {
    const heading = String(1 + Math.floor(rng() * 99)).padStart(2, '0');
    const sub = String(1 + Math.floor(rng() * 99)).padStart(2, '0');
    codes.add(`${chapter}${heading}${sub}`.slice(0, 6));
  }
  return [...codes].sort();
}

/** A reporter's own market scale and growth trajectory — stable across years and partners. */
function reporterProfile(reporter: string) {
  const rng = mulberry32(hashSeed(`reporter:${reporter}`));
  return {
    /** Multiplier on every value this reporter imports — makes market sizes differ meaningfully. */
    scale: 0.15 + rng() * 6,
    /** Compound annual growth applied per year away from the base year. Some markets shrink. */
    growth: 0.93 + rng() * 0.22,
    /** Typical unit value band for this market — drives the price-fit subscore downstream. */
    priceBase: 1.4 + rng() * 9,
  };
}

/**
 * A partner's share of the reporter's imports. Stable per (reporter, partner) so India's
 * share of a market is a property of that market, not of the year it was queried.
 */
function partnerShare(reporter: string, partner: string): number {
  if (partner === WORLD_PARTNER) return 1;
  const rng = mulberry32(hashSeed(`share:${reporter}:${partner}`));
  return 0.01 + rng() * 0.34;
}

const BASE_YEAR = 2020;

export class MockComtradeClient implements ComtradeClient {
  readonly name = 'mock';

  async resolveChapter(hsChapter: string) {
    return { chapter: hsChapter, hs_codes: subheadingsForChapter(hsChapter) };
  }

  async fetchChapter(params: ComtradeFetchParams): Promise<ComtradeFetchResult> {
    const codes = params.hs_codes;
    const profile = reporterProfile(params.reporter);
    const share = partnerShare(params.reporter, params.partner);
    const trend = profile.growth ** (params.year - BASE_YEAR);

    const rows: ComtradeFlowRow[] = codes.map((hsCode, index) => {
      // Per-code magnitude is stable across years; only `trend` moves it.
      const codeRng = mulberry32(hashSeed(`code:${params.reporter}:${hsCode}`));
      const baseValue = 40_000 + codeRng() * 3_400_000;
      const value = Math.round(baseValue * profile.scale * share * trend * 100) / 100;

      // A tenth of series carry no quantity, mirroring real Comtrade gaps — this is what
      // exercises the "unit_value is null when quantity is null" path end to end.
      const hasQuantity = codeRng() > 0.1;
      const unitValue = profile.priceBase * (0.6 + codeRng() * 1.1);
      const quantity = hasQuantity ? Math.round((value / unitValue) * 1000) / 1000 : null;

      return {
        reporter: params.reporter,
        partner: params.partner,
        hs_code: hsCode,
        year: params.year,
        period: String(params.year),
        value,
        quantity,
        unit: hasQuantity ? UNITS[index % UNITS.length] : null,
      };
    });

    return { rows, request_count: 1 };
  }
}
