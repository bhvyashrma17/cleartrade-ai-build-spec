import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EvidenceOrigin, JobStatus, OrgTier, ReferenceDatasetReleaseStatus, UserRole } from '@prisma/client';
import { DemandDiscoveryV5Panel } from '../src/components/ops/DemandDiscoveryV5Panel';
import { demandDiscoveryV5Operations } from '../src/lib/demand-discovery-v5/operations';
import { prisma } from '../src/lib/prisma';
import { importReferenceDataset } from '../src/lib/reference-datasets/service';
import type { Principal } from '../src/types';

/**
 * The operations view of Demand Discovery v5: what runs read, what a missing dataset costs, and
 * which runs ran and what they could not use. Other suites share this schema, so assertions are
 * about this suite's own rows and about consistency, never about a clean slate.
 */
const MARKER = `v5-ops-${randomUUID()}`;
let ops: Principal;
let agent: Principal;

beforeAll(async () => {
  const opsUser = await prisma.user.create({ data: { email: `${MARKER}-ops@test.local`, name: 'Ops', role: UserRole.ops_supervisor } });
  const agentUser = await prisma.user.create({ data: { email: `${MARKER}-agent@test.local`, name: 'Agent', role: UserRole.agent } });
  ops = { id: opsUser.id, email: opsUser.email, name: 'Ops', role: UserRole.ops_supervisor, exporter_org_id: null, tier: OrgTier.paid };
  agent = { id: agentUser.id, email: agentUser.email, name: 'Agent', role: UserRole.agent, exporter_org_id: null, tier: OrgTier.paid };
});

afterAll(async () => {
  await prisma.referenceDatasetRelease.updateMany({ where: { imported_by_id: ops.id, status: ReferenceDatasetReleaseStatus.active }, data: { status: ReferenceDatasetReleaseStatus.superseded, superseded_at: new Date() } });
  await prisma.$disconnect();
});

describe('Demand Discovery v5 operations view', () => {
  test('is for operations staff only', async () => {
    await expect(demandDiscoveryV5Operations(agent)).rejects.toThrow(/operations staff/);
  });

  test('lists every dataset a run reads with what its absence costs, and the runs with their notes', async () => {
    const org = await prisma.exporterOrg.create({ data: { display_name: `${MARKER} exporter`, tier: OrgTier.paid } });
    const product = await prisma.product.create({ data: { exporter_org_id: org.id, name: `${MARKER} product`, description: 'Synthetic', evidence_origin: EvidenceOrigin.fixture } });
    const run = await prisma.discoveryRun.create({
      data: {
        exporter_org_id: org.id, product_id: product.id, model_version: 'market-opportunity-v5', trigger: 'classification_confirmed', status: JobStatus.partial,
        completed_at: new Date(), summary: { ranked: 41, handed_off: [{ market: 'US', rank: 1 }, { market: 'AE', rank: 2 }], notes: ['Distance fit is not scored: capital coordinates (CEPII GeoDist) are not imported.'] },
      },
    });
    const bytes = Buffer.concat([readFileSync(resolve('data/reference/india-trade-agreements-v1.json')), Buffer.from(`\n${' '.repeat(3)}\n`)]);
    await importReferenceDataset({ actor: ops, dataset_key: 'india:trade-agreements', bytes, source_url: 'https://github.com/bhvyashrma17/cleartrade-ai-build-spec', retrieved_at: new Date('2026-10-13T00:00:00Z'), correlation_id: randomUUID(), evidence_origin: EvidenceOrigin.fixture });

    const view = await demandDiscoveryV5Operations(ops);
    expect(view.available).toBe(view.baci.length > 0);
    expect(view.unavailable_reason).toBe(view.available ? null : 'No CEPII BACI release is ready in this environment.');
    const keys = view.reference.map((item) => item.key);
    expect(keys).toEqual(expect.arrayContaining(['wdi:LP.LPI.OVRL.XQ', 'wdi:TM.TAX.TCOM.SM.AR.ZS', 'wdi:TM.TAX.MANF.SM.AR.ZS', 'india:trade-agreements', 'ecgc:country-risk:short-term', 'cepii:geo_cepii']));
    expect(keys.some((key) => key.startsWith('comtrade:availability:'))).toBe(view.baci.length > 0);
    expect(view.reference.every((item) => item.when_missing.length > 10)).toBe(true);
    expect(view.reference.find((item) => item.key === 'india:trade-agreements')!.active).toMatchObject({ version: expect.stringMatching(/^india-trade-agreements-v1/), row_count: expect.any(Number) });

    const row = view.runs.find((item) => item.id === run.id)!;
    expect(row).toMatchObject({ status: JobStatus.partial, product: `${MARKER} product`, exporter: `${MARKER} exporter`, ranked: 41, top_markets: ['US', 'AE'], notes: [expect.stringMatching(/Distance fit is not scored/)] });
    expect(view.last_7_days.partial).toBeGreaterThanOrEqual(1);

    const html = renderToStaticMarkup(createElement(DemandDiscoveryV5Panel, { overview: view }));
    expect(html).toContain('Demand Discovery v5');
    // docs/36 §7a: when each input stops being current, on the same page; the Control Tower links to it.
    expect(view.freshness[0].key).toBe('cepii_baci');
    expect(view.freshness.find((item) => item.key === 'india:trade-agreements')).toMatchObject({ group: 'reference', current: { version: expect.stringMatching(/^india-trade-agreements-v1/) }, due_at: expect.any(String) });
    expect(html).toContain('id="data-freshness"');
    expect(html).toContain('Data freshness');
    expect(html).toContain('Capital coordinates do not change.');
    expect(html).toContain(`${MARKER} product`);
    expect(html).toContain('What this run could not use (1)');
    expect(html).toContain('Distance is not scored.');
    expect(view.switches.fx_fetch_missing).toBe(true);
    expect(html).toContain('ECB rates fetched by runs when missing');
    expect(view.switches.tariff_acquisition).toBe(true);
    expect(html).toContain('official tariff look-up on');
    // D-029: the Singapore copy runs read, saved by the worker in SSO's nightly window.
    expect(view.singapore_tariff).toMatchObject({ enabled: false, next_window_at: expect.any(Date) });
    expect(html).toContain('Singapore tariff, saved nightly 03:00–07:00 Singapore Time: refresh off');
  });
});
