/**
 * The inputs of the top-30 review (D-048, docs/38 §3.6): for each of the 30 largest markets by
 * India's 2024 non-fuel goods exports, what the regional geography says today, in the form the
 * review's checker and challenger read it (`docs/regional-review/`).
 *
 * `scripts/regional-review-inputs.ts` writes one file per market. The tests hold the committed files
 * to the registry, so a registry change that is not carried into them fails rather than sending a
 * review out on stale data.
 */
import { marketGeography, regionalGeography } from './market-geography';

/** E-076: India's 2024 non-fuel goods exports by partner, US$ million (UN Comtrade), the 30 largest. */
export const REVIEW_MARKETS = [
  { rank: 1, iso2: 'US', name: 'United States', exports_2024_usd_m: 75065 },
  { rank: 2, iso2: 'AE', name: 'United Arab Emirates', exports_2024_usd_m: 28488 },
  { rank: 3, iso2: 'CN', name: 'China', exports_2024_usd_m: 13675 },
  { rank: 4, iso2: 'GB', name: 'United Kingdom', exports_2024_usd_m: 12722 },
  { rank: 5, iso2: 'SA', name: 'Saudi Arabia', exports_2024_usd_m: 11672 },
  { rank: 6, iso2: 'DE', name: 'Germany', exports_2024_usd_m: 10233 },
  { rank: 7, iso2: 'NL', name: 'Netherlands', exports_2024_usd_m: 9311 },
  { rank: 8, iso2: 'BD', name: 'Bangladesh', exports_2024_usd_m: 8928 },
  { rank: 9, iso2: 'SG', name: 'Singapore', exports_2024_usd_m: 8857 },
  { rank: 10, iso2: 'IT', name: 'Italy', exports_2024_usd_m: 8151 },
  { rank: 11, iso2: 'FR', name: 'France', exports_2024_usd_m: 6404 },
  { rank: 12, iso2: 'HK', name: 'Hong Kong', exports_2024_usd_m: 6287 },
  { rank: 13, iso2: 'BE', name: 'Belgium', exports_2024_usd_m: 6171 },
  { rank: 14, iso2: 'BR', name: 'Brazil', exports_2024_usd_m: 5651 },
  { rank: 15, iso2: 'MX', name: 'Mexico', exports_2024_usd_m: 5632 },
  { rank: 16, iso2: 'JP', name: 'Japan', exports_2024_usd_m: 5618 },
  { rank: 17, iso2: 'VN', name: 'Vietnam', exports_2024_usd_m: 5455 },
  { rank: 18, iso2: 'TR', name: 'Türkiye', exports_2024_usd_m: 5436 },
  { rank: 19, iso2: 'MY', name: 'Malaysia', exports_2024_usd_m: 5070 },
  { rank: 20, iso2: 'KR', name: 'South Korea', exports_2024_usd_m: 4855 },
  { rank: 21, iso2: 'RU', name: 'Russia', exports_2024_usd_m: 4841 },
  { rank: 22, iso2: 'ES', name: 'Spain', exports_2024_usd_m: 4793 },
  { rank: 23, iso2: 'TH', name: 'Thailand', exports_2024_usd_m: 4777 },
  { rank: 24, iso2: 'NP', name: 'Nepal', exports_2024_usd_m: 4761 },
  { rank: 25, iso2: 'ID', name: 'Indonesia', exports_2024_usd_m: 4576 },
  { rank: 26, iso2: 'ZA', name: 'South Africa', exports_2024_usd_m: 4548 },
  { rank: 27, iso2: 'CA', name: 'Canada', exports_2024_usd_m: 4073 },
  { rank: 28, iso2: 'AU', name: 'Australia', exports_2024_usd_m: 3978 },
  { rank: 29, iso2: 'LK', name: 'Sri Lanka', exports_2024_usd_m: 3649 },
  { rank: 30, iso2: 'EG', name: 'Egypt', exports_2024_usd_m: 2964 },
] as const;

export type ReviewMarket = (typeof REVIEW_MARKETS)[number];

export const REVIEW_INPUTS_DIR = 'docs/regional-review/markets';

export interface ReviewInput {
  rank: number;
  iso2: string;
  name: string;
  exports_2024_usd_m: number;
  /** The geography reviewed: the checksum ties the review's findings to the data it read. */
  registry: { version: string; rule_version: string; checksum: string };
  current: {
    shape: string;
    rule: { shape: string; centres: number; effective_centres: number };
    override: { shape: string; reason: string } | null;
    hubs: { name: string; merged: string[]; population: number; region: string | null }[];
    regions: { code: string; name: string; local_name?: string; type: string | null; hubs: string[] }[];
    gateways: { kind: string; name: string; iata?: string; region: string }[];
    /** Left out of every market by the owner's decision (D-049); not to be added back. */
    excluded_divisions?: { code: string; name: string; reason: string }[];
  };
}

export const reviewInputFile = (market: ReviewMarket) => `${String(market.rank).padStart(2, '0')}-${market.iso2}.json`;

/** What the registry says today about one review market. */
export function reviewInput(market: ReviewMarket): ReviewInput {
  const geography = marketGeography(market.iso2);
  if (!geography) throw new Error(`${market.iso2} is not one of the registry's markets.`);
  const registry = regionalGeography();
  return {
    rank: market.rank,
    iso2: market.iso2,
    name: market.name,
    exports_2024_usd_m: market.exports_2024_usd_m,
    registry: { version: registry.version, rule_version: registry.rule_version, checksum: registry.checksum },
    current: {
      shape: geography.shape,
      rule: { shape: geography.rule.shape, centres: geography.rule.centres, effective_centres: geography.rule.effective_centres },
      override: geography.override ? { shape: geography.override.shape, reason: geography.override.reason } : null,
      hubs: geography.centres.map((centre) => ({ name: centre.name, merged: centre.merged, population: centre.population, region: centre.region })),
      regions: geography.regions.map((region) => ({ code: region.code, name: region.name, ...(region.local_name ? { local_name: region.local_name } : {}), type: region.type, hubs: region.hubs })),
      gateways: geography.gateways.map((gateway) => ({ kind: gateway.kind, name: gateway.name, ...(gateway.iata ? { iata: gateway.iata } : {}), region: gateway.region })),
      ...(geography.excluded_divisions.length ? { excluded_divisions: geography.excluded_divisions.map((entry) => ({ code: entry.code, name: entry.name, reason: entry.reason })) } : {}),
    },
  };
}

/** The file's canonical text, one hub, region or gateway per line: the tests compare it byte for byte. */
export function serializeReviewInput(input: ReviewInput): string {
  const json = (value: unknown) => JSON.stringify(value);
  const list = (items: readonly unknown[]) => (items.length ? `[\n${items.map((item) => `   ${json(item)}`).join(',\n')}\n  ]` : '[]');
  const current = input.current;
  return [
    '{',
    ` "rank": ${json(input.rank)},`,
    ` "iso2": ${json(input.iso2)},`,
    ` "name": ${json(input.name)},`,
    ` "exports_2024_usd_m": ${json(input.exports_2024_usd_m)},`,
    ` "registry": ${json(input.registry)},`,
    ' "current": {',
    `  "shape": ${json(current.shape)},`,
    `  "rule": ${json(current.rule)},`,
    `  "override": ${json(current.override)},`,
    `  "hubs": ${list(current.hubs)},`,
    `  "regions": ${list(current.regions)},`,
    `  "gateways": ${list(current.gateways)}${current.excluded_divisions ? ',' : ''}`,
    ...(current.excluded_divisions ? [`  "excluded_divisions": ${list(current.excluded_divisions)}`] : []),
    ' }',
    '}',
    '',
  ].join('\n');
}
