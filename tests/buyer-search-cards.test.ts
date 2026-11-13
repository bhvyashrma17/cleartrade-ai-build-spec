import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EvidenceOrigin, JobStatus, OrgTier, UserRole } from '@prisma/client';
import { BuyerSearchCards } from '../src/components/agent/BuyerSearchCards';
import { DEMAND_DISCOVERY_V5_MODEL } from '../src/lib/demand-discovery-v5/policy';
import { prisma } from '../src/lib/prisma';
import type { RegionalArea, RegionalDemandResultV1 } from '../src/lib/regional-demand/census';
import { exporterSearchMarkets, marketSearchCards } from '../src/lib/regional-demand/search-cards';
import { regionalDemandView, type RegionalDemandView } from '../src/lib/regional-demand/service';
import { presentRegionalResult } from '../src/lib/regional-demand/view';
import type { Principal } from '../src/types';

/** The hand-off card for buyer discovery (D-048, docs/38 §1.4): hubs, search terms, gateways, evidence. */

const official = (result: RegionalDemandResultV1, evidence: 'your_product' | 'traders'): RegionalDemandView => ({
  supported: true, publisher: 'test', latest: null, estimate: null,
  shown: { id: 'run', status: 'completed', trigger: 'requested', reason: null, created_at: '', completed_at: '', result: presentRegionalResult(result) },
  evidence: { key: evidence, label: evidence === 'traders' ? 'Traders' : 'Your product', meaning: 'test' },
});

const stored = (country: string, key: string, views: RegionalDemandResultV1['views']): RegionalDemandResultV1 => ({
  version: 1, country_code: country, hs6: '570110',
  source: { key, label: `${key} label`, url: 'https://example.test/source', attribution: 'test', retrieved_at: '2026-11-12T00:00:00.000Z', requests: [] },
  period: { from: '2025-09', to: '2026-08', months: 12, label: 'Sep 2025 – Aug 2026' },
  totals: { india_value_usd: null, world_value_usd: null, india_share_percent: null, container_share_percent: null, air_share_percent: null },
  views, notes: [],
});

const state = (code: string, india: number, world: number): RegionalArea => ({
  code, name: code, india_value_usd: india, world_value_usd: world, india_share_percent: null, container_value_usd: 0, container_weight_kg: 0, air_value_usd: 0, india_months: 12,
});

describe('the cards for one market', () => {
  test('a hub-and-gateway estimate: the whole market, then each main city with its region, search terms and gateways', async () => {
    const cards = marketSearchCards({ country_code: 'AE', view: await regionalDemandView('none', 'AE') });
    expect(cards).toMatchObject({ version: 'buyer-search-card-v1', country_code: 'AE', shape: 'hub_and_gateway', evidence: { key: 'estimate' }, source: { url: 'https://www.naturalearthdata.com/' } });
    expect(cards.cards.map((card) => [card.scope, card.name, card.code, card.in_core])).toEqual([
      ['market', 'United Arab Emirates', 'AE', false], ['hub', 'Dubai', 'AE-DU', true], ['hub', 'Abu Dhabi', 'AE-AZ', true], ['hub', 'Al Ayn', 'AE-AZ', false],
    ]);
    const dubai = cards.cards[1]!;
    expect(dubai.cities).toEqual(['Dubai', 'Sharjah']);
    expect(dubai.search_terms).toEqual({ codes: ['AE-DU'], city_names: ['Dubai', 'Sharjah'], postcode_prefixes: null });
    expect(dubai.gateways.map((gateway) => gateway.iata ?? gateway.name)).toEqual(['Dubai', 'DXB']);
    expect(cards.notes).toEqual(['Ranked by the size of the main cities (an estimate), not by imports.', 'Postcode prefixes are not recorded for this market yet.']);
  });

  test('a one-place market has only its whole-market card', async () => {
    const cards = marketSearchCards({ country_code: 'SG', view: await regionalDemandView('none', 'SG') });
    expect(cards.cards).toHaveLength(1);
    expect(cards.cards[0]).toMatchObject({ scope: 'market', code: 'SG', cities: ['Singapore'] });
    expect(cards.cards[0]!.gateways.map((gateway) => gateway.name)).toEqual(['Singapore', 'Singapore Changi']);
    expect(cards.notes[0]).toBe('One search area: the whole market. No regional cards are needed.');
  });

  test('a market whose goods from India can also cross a land border says those posts are not recorded yet', async () => {
    const cards = marketSearchCards({ country_code: 'BD', view: await regionalDemandView('none', 'BD') });
    expect(cards.notes).toContain('Goods from India can also enter by land; border posts are not recorded yet.');
    expect(cards.cards.find((card) => card.name === 'Chattogram')).toMatchObject({ code: 'BD-B', in_core: true });
  });

  test('official US figures: each state as its ISO region, with the cities and gateways the geography holds there', () => {
    const view = official(stored('US', 'us_census_intltrade', [{ kind: 'state', title: 'Destination states', areas: [state('NY', 500, 900), state('GA', 200, 200), state('ZZ', 1, 1)], others: null }]), 'your_product');
    const cards = marketSearchCards({ country_code: 'US', view });
    expect(cards.source).toEqual({ label: 'us_census_intltrade label', url: 'https://example.test/source' });
    const [, newYork, georgia, unknown] = cards.cards;
    expect(newYork).toMatchObject({ scope: 'region', name: 'NY', code: 'US-NY', rank: 1, in_core: true, share_percent: 81.74 });
    expect(newYork!.cities).toEqual(['New York', 'Buffalo', 'Albany', 'Rochester', 'Syracuse']);
    expect(newYork!.search_terms.codes).toEqual(['US-NY', 'NY']);
    expect(newYork!.gateways.map((gateway) => gateway.iata ?? gateway.name)).toContain('JFK');
    expect(georgia).toMatchObject({ code: 'US-GA', in_core: false });
    // A code the geography does not hold is kept as the source's own, never made into an ISO code.
    expect(unknown).toMatchObject({ code: 'ZZ', cities: [], gateways: [], search_terms: { codes: ['ZZ'] } });
  });

  test("UK importer regions carry the postcode areas HMRC's list places importers by", () => {
    const view = official(stored('GB', 'uk_hmrc_importers', [{
      kind: 'region', measure: 'importers', title: 'Regions', others: null,
      areas: [{ code: 'TLI', name: 'London', importer_count: 30, india_importer_count: null, towns: ['LONDON', 'CROYDON'] }, { code: 'TLD', name: 'North West', importer_count: 5, india_importer_count: null, towns: ['MANCHESTER'] }],
    }]), 'traders');
    const cards = marketSearchCards({ country_code: 'GB', view });
    const london = cards.cards[1]!;
    expect(london).toMatchObject({ scope: 'region', name: 'London', code: 'TLI', in_core: true, cities: ['London', 'Croydon'] });
    expect(london.search_terms.postcode_prefixes).toEqual(expect.arrayContaining(['EC', 'WC', 'E', 'SW']));
    expect(cards.notes).not.toContain('Postcode prefixes are not recorded for this market yet.');
  });

  test('official figures not read yet: the whole market only, said so, never an estimate in their place', () => {
    const cards = marketSearchCards({ country_code: 'US', view: { supported: true, publisher: 'U.S. Census Bureau', latest: null, shown: null, evidence: { key: 'your_product', label: 'Your product', meaning: 'test' }, estimate: null } });
    expect(cards.cards.map((card) => card.scope)).toEqual(['market']);
    expect(cards.source).toBeNull();
    expect(cards.notes[0]).toBe('The official regional figures have not been read yet, so only the whole market is listed.');
  });
});

describe('the markets handed off to buyer discovery', () => {
  const marker = `cards-${randomUUID()}`;
  let owner: Principal;
  let stranger: Principal;
  let orgId = '';

  const org = async (tier: OrgTier) => {
    const created = await prisma.exporterOrg.create({ data: { display_name: `${marker} ${tier}`, tier } });
    const user = await prisma.user.create({ data: { email: `${marker}-${tier}-${randomUUID()}@test.local`, name: 'Owner', role: UserRole.exporter_owner, exporter_org_id: created.id } });
    return { created, principal: { id: user.id, email: user.email, name: 'Owner', role: UserRole.exporter_owner, exporter_org_id: created.id, tier } as Principal };
  };
  const run = (exporterOrgId: string, productId: string, completedAt: Date) => prisma.discoveryRun.create({ data: { exporter_org_id: exporterOrgId, product_id: productId, model_version: DEMAND_DISCOVERY_V5_MODEL, status: JobStatus.completed, completed_at: completedAt } });
  const market = (runId: string, productId: string, country: string, rank: number, handedOff: boolean) => prisma.marketAssessment.create({
    data: {
      run_id: runId, product_id: productId, country_code: country, confidence_score: 80, model_version: DEMAND_DISCOVERY_V5_MODEL, weight_profile_key: 'test', weight_profile_version: 1,
      // Only a fully scored (ranked) market is handed on (MarketAssessment_handoff_is_ranked).
      market_status: handedOff ? 'ranked' : 'not_enough_data', classification_hs6_code: '570110', evidence_origins: [EvidenceOrigin.fixture], rank, handed_off: handedOff,
    },
  });

  beforeAll(async () => {
    const paid = await org(OrgTier.paid);
    owner = paid.principal;
    orgId = paid.created.id;
    stranger = (await org(OrgTier.paid)).principal;
    const product = await prisma.product.create({ data: { exporter_org_id: orgId, name: `${marker} carpets`, description: 'Hand-knotted wool carpets', evidence_origin: EvidenceOrigin.fixture } });
    const older = await run(orgId, product.id, new Date('2026-10-01T00:00:00Z'));
    await market(older.id, product.id, 'FR', 1, true);
    const newest = await run(orgId, product.id, new Date('2026-11-01T00:00:00Z'));
    await market(newest.id, product.id, 'SG', 2, true);
    await market(newest.id, product.id, 'AE', 1, true);
    await market(newest.id, product.id, 'DE', 3, false);
  });

  afterAll(async () => {
    await prisma.marketAssessment.deleteMany({ where: { run: { exporter_org_id: orgId } } });
    await prisma.discoveryRun.deleteMany({ where: { exporter_org_id: orgId } });
  });

  test("lists the handed-off markets of each product's newest v5 run, in rank order, with their cards", async () => {
    const markets = await exporterSearchMarkets(owner, orgId);
    expect(markets.map((entry) => [entry.cards.country_code, entry.rank])).toEqual([['AE', 1], ['SG', 2]]);
    expect(markets[0]!.product.name).toBe(`${marker} carpets`);
    expect(markets[0]!.cards.cards.map((card) => card.name)).toEqual(['United Arab Emirates', 'Dubai', 'Abu Dhabi', 'Al Ayn']);
  });

  test('refuses anyone who may not see the exporter', async () => {
    await expect(exporterSearchMarkets(stranger, orgId)).rejects.toThrow();
  });

  test('the panel shows each market, its evidence, and the cards to start with', async () => {
    const html = renderToStaticMarkup(createElement(BuyerSearchCards, { markets: await exporterSearchMarkets(owner, orgId) }));
    expect(html).toContain('Where to search');
    expect(html).toContain('United Arab Emirates · Estimate');
    expect(html).toContain('Start here: in the 80%');
    expect(html).toContain('Dubai, Sharjah');
    expect(html).toContain('postcode prefixes not recorded yet');
    expect(html).toContain('Singapore · Not needed');
    expect(renderToStaticMarkup(createElement(BuyerSearchCards, { markets: [] }))).toContain('No markets have been handed off yet.');
  });
});
