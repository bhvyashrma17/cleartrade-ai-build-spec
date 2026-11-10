import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { EvidenceOrigin, JobStatus, OrgTier, ProductClassificationStatus, ReferenceDatasetReleaseStatus, UserRole } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import type { Principal } from '../src/types';
import { hmrcLine } from './helpers/hmrc-lines';

/**
 * The members' Buyers page (E-055, E-056): per product, the markets its latest v5 run handed on, with
 * an importer count only where a list of that market's official source is imported here. Canada has
 * no list yet (its reader is not built, R-45), so its row must not say the list found no importer.
 */

const auth = vi.hoisted(() => ({ caller: null as Principal | null }));
vi.mock('../src/lib/auth', () => ({
  getPrincipal: vi.fn(async () => auth.caller),
  requirePrincipal: vi.fn(async () => auth.caller),
}));
const { default: BuyersPage } = await import('../src/app/app/buyers/page');
const { AgentCuratedBuyers } = await import('../src/app/app/buyers/AgentCuratedBuyers');
const { activeImporterLists, importImporterList } = await import('../src/lib/buyer-discovery/importer-list-service');
const { BUYER_DISCOVERY_MODEL, runBuyerDiscoveryJob } = await import('../src/lib/buyer-discovery/service');

const MARKER = `buyers-page-${randomUUID().slice(0, 8)}`;
const period = `20${String(30 + Math.floor(Math.random() * 60)).padStart(2, '0')}0${1 + Math.floor(Math.random() * 8)}`;
let ops: Principal;
let owner: Principal;
let orgId = '';
let productId = '';

beforeAll(async () => {
  const opsUser = await prisma.user.create({ data: { email: `${MARKER}-ops@test.local`, name: 'Ops', role: UserRole.ops_supervisor } });
  const org = await prisma.exporterOrg.create({ data: { display_name: `${MARKER} exporter`, tier: OrgTier.paid } });
  const ownerUser = await prisma.user.create({ data: { email: `${MARKER}-owner@test.local`, name: 'Owner', role: UserRole.exporter_owner, exporter_org_id: org.id } });
  const product = await prisma.product.create({ data: { exporter_org_id: org.id, name: `${MARKER} basmati`, description: 'Basmati rice', hs_code: '100630', hs_classification_status: ProductClassificationStatus.confirmed, evidence_origin: EvidenceOrigin.fixture } });
  ops = { id: opsUser.id, email: opsUser.email, name: 'Ops', role: UserRole.ops_supervisor, exporter_org_id: null, tier: OrgTier.paid };
  owner = { id: ownerUser.id, email: ownerUser.email, name: 'Owner', role: UserRole.exporter_owner, exporter_org_id: org.id, tier: OrgTier.paid };
  orgId = org.id;
  productId = product.id;

  const run = await prisma.discoveryRun.create({ data: { exporter_org_id: orgId, product_id: productId, model_version: 'market-opportunity-v5', status: JobStatus.completed, completed_at: new Date('2026-11-10T07:00:00Z') } });
  const market = (country: string, rank: number, handedOff: boolean) => ({ run_id: run.id, product_id: productId, country_code: country, confidence_score: 80, overall_score: 90 - rank, model_version: 'market-opportunity-v5', weight_profile_key: 'test', weight_profile_version: 1, market_status: 'ranked', rank, handed_off: handedOff, classification_hs6_code: '100630' });
  await prisma.marketAssessment.createMany({ data: [market('GB', 1, true), market('CA', 2, true), market('US', 3, true), market('DE', 11, false)] });

  // An HMRC list with two importers of rice, then the buyer-discovery job the hand-off would run.
  const lines = [
    hmrcLine(period, 1, `${MARKER} RICE IMPORTS LIMITED`, ['UNIT 4', 'SOUTHALL'], 'UB2 4SD', ['10063098', '10063027']),
    hmrcLine(period, 1, `${MARKER} FOODS LTD`, ['2 DOCK ROAD', 'LEICESTER'], 'LE1 1AA', ['10063098']),
  ].join('\n');
  await importImporterList({
    source_key: 'uk_hmrc_importers', source_url: 'https://www.uktradeinfo.com/media/test/importers.zip', retrieved_at: new Date('2026-10-22T00:00:00Z'),
    correlation_id: randomUUID(), evidence_origin: EvidenceOrigin.fixture, actor: ops, files: [{ name: 'importers.txt', bytes: Buffer.from(lines, 'latin1') }],
  });
  await runBuyerDiscoveryJob({ exporter_org_id: orgId, product_id: productId, country_code: 'GB', hs6: '100630', source_key: 'uk_hmrc_importers' }, randomUUID());
});

afterAll(async () => {
  await prisma.importerListRelease.updateMany({ where: { imported_by_id: ops.id, status: ReferenceDatasetReleaseStatus.active }, data: { status: ReferenceDatasetReleaseStatus.superseded, superseded_at: new Date() } });
  await prisma.$disconnect();
});

describe('the members’ Buyers page', () => {
  test('counts importers only where a list of the market’s source is imported here', async () => {
    expect(await activeImporterLists('ca_cid_major_importers')).toEqual([]);
    const fits = await prisma.buyerFitAssessment.count({ where: { exporter_org_id: orgId, product_id: productId, model_version: BUYER_DISCOVERY_MODEL, buyer: { country_code: 'GB' } } });
    expect(fits).toBeGreaterThanOrEqual(2);

    auth.caller = owner;
    const page = await BuyersPage();
    const products = (page.props as { products: { id: string; markets: { country_code: string; rank: number | null; importers: { source: string; count: number } | null }[] }[] }).products;
    const ours = products.find((product) => product.id === productId)!;
    // Only the handed-off markets, in rank order.
    expect(ours.markets.map((market) => market.country_code)).toEqual(['GB', 'CA', 'US']);
    expect(ours.markets[0]!.importers).toEqual({ source: 'HMRC importer details (UK Trade Info)', count: fits });
    // Canada has an official source but no list here: no count, so no "none found" claim.
    expect(ours.markets[1]!.importers).toBeNull();
    expect(ours.markets[2]!.importers).toBeNull();

    const html = renderToStaticMarkup(createElement(AgentCuratedBuyers, { products: [ours] as never }));
    expect(html).toContain(`${fits} importers found in the HMRC importer details (UK Trade Info); your agent reviews them`);
    expect(html).not.toContain('Canadian Importers Database');
    expect(html.match(/Your agent finds and vets importers here/g)).toHaveLength(2);
    expect(html).toContain(`/app/markets/`);
  });

  test('a list of the source that holds no importer of the product says so', async () => {
    const other = await prisma.product.create({ data: { exporter_org_id: orgId, name: `${MARKER} jute bags`, description: 'Jute bags', hs_code: '630510', hs_classification_status: ProductClassificationStatus.confirmed, evidence_origin: EvidenceOrigin.fixture } });
    const run = await prisma.discoveryRun.create({ data: { exporter_org_id: orgId, product_id: other.id, model_version: 'market-opportunity-v5', status: JobStatus.partial, completed_at: new Date('2026-11-10T08:00:00Z') } });
    await prisma.marketAssessment.create({ data: { run_id: run.id, product_id: other.id, country_code: 'GB', confidence_score: 70, overall_score: 75, model_version: 'market-opportunity-v5', weight_profile_key: 'test', weight_profile_version: 1, market_status: 'ranked', rank: 1, handed_off: true, classification_hs6_code: '630510' } });

    auth.caller = owner;
    const page = await BuyersPage();
    const products = (page.props as { products: { id: string; run_completed_at: string | null; markets: { importers: { source: string; count: number } | null }[] }[] }).products;
    const jute = products.find((product) => product.id === other.id)!;
    expect(jute.run_completed_at).toBe('2026-11-10T08:00:00.000Z');
    expect(jute.markets[0]!.importers).toEqual({ source: 'HMRC importer details (UK Trade Info)', count: 0 });
    expect(renderToStaticMarkup(createElement(AgentCuratedBuyers, { products: [jute] as never }))).toContain('No importer of this product in the HMRC importer details (UK Trade Info) yet; your agent searches further');
  });
});
