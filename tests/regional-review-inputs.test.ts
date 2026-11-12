import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { REVIEW_INPUTS_DIR, REVIEW_MARKETS, reviewInput, reviewInputFile, serializeReviewInput } from '../src/lib/regional-geography/review-inputs';
import { regionalGeography } from '../src/lib/regional-geography/market-geography';

/** The top-30 review kit (D-048, docs/38 §3.6, docs/regional-review/). */
const root = join(__dirname, '..');

describe('the top-30 review kit', () => {
  test('lists the 30 largest markets by 2024 exports, in order, all of them markets of the registry', () => {
    expect(REVIEW_MARKETS.map((market) => market.rank)).toEqual(Array.from({ length: 30 }, (_, index) => index + 1));
    const exports = REVIEW_MARKETS.map((market) => market.exports_2024_usd_m);
    expect(exports).toEqual([...exports].sort((a, b) => b - a));
    // E-076: the 30 take 79.9% of US$358,622 million.
    expect(Math.round((exports.reduce((sum, value) => sum + value, 0) / 358_622) * 1000) / 10).toBe(79.9);
    const markets = new Set(regionalGeography().markets.map((market) => market.iso2));
    expect(REVIEW_MARKETS.every((market) => markets.has(market.iso2))).toBe(true);
  });

  test('every committed input is exactly what the registry says today', () => {
    for (const market of REVIEW_MARKETS) {
      const committed = readFileSync(join(root, REVIEW_INPUTS_DIR, reviewInputFile(market)), 'utf8');
      expect(committed, reviewInputFile(market)).toBe(serializeReviewInput(reviewInput(market)));
      expect(JSON.parse(committed)).toEqual(JSON.parse(JSON.stringify(reviewInput(market))));
    }
  });

  test("the inputs carry what a reviewer needs: Bangladesh as the rule left it, Russia's excluded divisions", () => {
    const bangladesh = reviewInput(REVIEW_MARKETS.find((market) => market.iso2 === 'BD')!);
    expect(bangladesh.current.regions.map((region) => region.code)).toEqual(['BD-A', 'BD-B', 'BD-C', 'BD-D', 'BD-E', 'BD-F', 'BD-G']);
    expect(bangladesh.current.gateways.map((gateway) => gateway.name)).toContain("Zia Int'l Dhaka");
    expect(bangladesh.registry.checksum).toBe(regionalGeography().checksum);
    const russia = reviewInput(REVIEW_MARKETS.find((market) => market.iso2 === 'RU')!);
    expect(russia.current.excluded_divisions?.map((entry) => entry.code)).toEqual(['UA-43', 'UA-40']);
    expect(bangladesh.current.excluded_divisions).toBeUndefined();
  });

  test('the templates hold their placeholders and the rules for reading sources', () => {
    const checker = readFileSync(join(root, 'docs/regional-review/checker.md'), 'utf8');
    const challenger = readFileSync(join(root, 'docs/regional-review/challenger.md'), 'utf8');
    for (const placeholder of ['{{NAME}}', '{{ISO2}}', '{{CURRENT}}']) {
      expect(checker).toContain(placeholder);
      expect(challenger).toContain(placeholder);
    }
    expect(challenger).toContain('{{FINDINGS}}');
    for (const template of [checker, challenger]) {
      expect(template).toContain('WebFetch');
      expect(template).toContain('refused_sources');
      expect(template).toMatch(/no mirrors, caches, archive\.org, translators or proxies/i);
      expect(template).toContain('D-049');
    }
  });
});
