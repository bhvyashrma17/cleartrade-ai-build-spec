import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { EvidenceOrigin, JobStatus, ProductClassificationMethod, ProductClassificationStatus, UserRole } from '@prisma/client';
import { DEMAND_DISCOVERY_V5_MODEL } from '@/lib/demand-discovery-v5/policy';
import { refreshReasons, sweepV5Refresh, type RefreshState } from '@/lib/demand-discovery-v5/refresh';
import { prisma } from '@/lib/prisma';

/** Stage 1, item 5 (E-040): a finished run that newer data would change is re-run, oldest first, within a daily budget. */
const AS_OF = new Date('2026-10-20T00:00:00Z');
const frozen = { baci: { hs17: { release_id: 'baci17-a' }, hs22: { release_id: 'baci22-a' } }, reference: { 'wdi:LP.LPI.OVRL.XQ': { release_id: 'lpi-a' }, 'ecgc:country-risk:short-term': null } };
const state = (overrides: Partial<RefreshState> = {}): RefreshState => ({
  baci: { HS17: 'baci17-a', HS22: 'baci22-a' }, reference: new Map([['wdi:LP.LPI.OVRL.XQ', 'lpi-a'], ['geo:unrelated', 'geo-z']]), tariff_releases: [], ...overrides,
});

describe('refresh reasons', () => {
  test('a run on the current releases is current; a dataset it never read does not make it stale', () => {
    expect(refreshReasons({ frozen_inputs: frozen, as_of: AS_OF }, state())).toEqual([]);
  });

  test('a newer BACI release, a newer or newly available reference release and a later tariff release each say so', () => {
    const reasons = refreshReasons({ frozen_inputs: frozen, as_of: AS_OF }, state({
      baci: { HS17: 'baci17-a', HS22: 'baci22-b' },
      reference: new Map([['wdi:LP.LPI.OVRL.XQ', 'lpi-b'], ['ecgc:country-risk:short-term', 'ecgc-a']]),
      tariff_releases: [
        { id: 't1', authority: 'European Commission (TARIC)', activated_at: new Date('2026-10-25T00:00:00Z') },
        { id: 't2', authority: 'Brazil CAMEX', activated_at: new Date('2026-10-01T00:00:00Z') },
      ],
    }));
    expect(reasons).toEqual([
      'A newer CEPII BACI HS22 release is ready.',
      'ecgc:country-risk:short-term has a newer release.',
      'wdi:LP.LPI.OVRL.XQ has a newer release.',
      'Official tariffs released since the run: European Commission (TARIC).',
    ]);
    // A run that read no HS17 release is stale once one exists.
    expect(refreshReasons({ frozen_inputs: { baci: { hs17: null, hs22: { release_id: 'baci22-a' } } }, as_of: AS_OF }, state())).toEqual(['A newer CEPII BACI HS17 release is ready.']);
    expect(refreshReasons({ frozen_inputs: null, as_of: AS_OF }, state({ baci: { HS17: null, HS22: null }, reference: new Map() }))).toEqual([]);
  });
});

async function productWithRun(args: { org_id: string; staff_id: string; status: JobStatus; completed: string; classification?: ProductClassificationStatus; frozen_inputs?: unknown }) {
  const product = await prisma.product.create({ data: { exporter_org_id: args.org_id, name: `[TEST] refresh ${randomUUID().slice(0, 8)}`, evidence_origin: EvidenceOrigin.fixture, hs_code: '741810', hs_classification_status: ProductClassificationStatus.confirmed }, select: { id: true } });
  const classification = await prisma.productClassification.create({
    data: {
      product_id: product.id, revision: 1, hs6_code: '741810', nomenclature: 'HS', nomenclature_version: '2022', method: ProductClassificationMethod.agent_supplied, product_facts_snapshot: {}, evidence: {},
      rationale: 'Test.', source_references: [], confidence: 1, status: args.classification ?? ProductClassificationStatus.confirmed, proposed_by_id: args.staff_id,
    },
    select: { id: true },
  });
  const run = await prisma.discoveryRun.create({
    data: {
      exporter_org_id: args.org_id, product_id: product.id, classification_id: classification.id, model_version: DEMAND_DISCOVERY_V5_MODEL, status: args.status, as_of_date: AS_OF,
      completed_at: new Date(args.completed), input_snapshot: { hs_code: '741810' }, frozen_inputs: (args.frozen_inputs ?? frozen) as object,
    },
    select: { id: true },
  });
  return { product_id: product.id, run_id: run.id };
}

describe('the refresh sweep', () => {
  test('re-runs out-of-date products oldest first within the daily budget, and skips the rest with a reason', async () => {
    const org = await prisma.exporterOrg.create({ data: { display_name: `[TEST] refresh ${randomUUID().slice(0, 8)}`, country: 'IN' }, select: { id: true } });
    const staff = await prisma.user.create({ data: { email: `refresh-${randomUUID().slice(0, 8)}@t.test`, name: 'Refresh staff', role: UserRole.agent }, select: { id: true } });
    // Dated 2020 so these come before any other test's runs in the oldest-first order.
    const newer = await productWithRun({ org_id: org.id, staff_id: staff.id, status: JobStatus.completed, completed: '2020-01-03T00:00:00Z' });
    const older = await productWithRun({ org_id: org.id, staff_id: staff.id, status: JobStatus.partial, completed: '2020-01-02T00:00:00Z' });
    const oldest = await productWithRun({ org_id: org.id, staff_id: staff.id, status: JobStatus.completed, completed: '2020-01-01T00:00:00Z' });
    const current = await productWithRun({ org_id: org.id, staff_id: staff.id, status: JobStatus.completed, completed: '2019-12-01T00:00:00Z', frozen_inputs: { baci: { hs17: { release_id: 'baci17-a' }, hs22: { release_id: 'baci22-b' } } } });
    const failed = await productWithRun({ org_id: org.id, staff_id: staff.id, status: JobStatus.failed, completed: '2019-12-01T00:00:00Z' });
    const oldCode = await productWithRun({ org_id: org.id, staff_id: staff.id, status: JobStatus.completed, completed: '2019-12-01T00:00:00Z', classification: ProductClassificationStatus.superseded });
    const ours = new Set([newer, older, oldest, current, failed, oldCode].map((item) => item.product_id));

    const started: string[] = [];
    const start = async (args: { product_id: string; trigger: string; actor: unknown }) => {
      expect(args).toMatchObject({ trigger: 'refresh', actor: null });
      started.push(args.product_id);
      return { run_id: `refresh-of-${args.product_id}`, job_id: 'job', status: JobStatus.queued };
    };
    const result = await sweepV5Refresh({ now: new Date('2026-10-31T06:00:00Z'), state: state({ baci: { HS17: 'baci17-a', HS22: 'baci22-b' } }), start: start as never, daily_budget: 2 });
    // Oldest first, two of three: the third waits for tomorrow's budget.
    expect(started).toEqual([oldest.product_id, older.product_id]);
    expect(result!.started).toEqual([
      { product_id: oldest.product_id, run_id: `refresh-of-${oldest.product_id}`, replaces: oldest.run_id, reasons: ['A newer CEPII BACI HS22 release is ready.'] },
      { product_id: older.product_id, run_id: `refresh-of-${older.product_id}`, replaces: older.run_id, reasons: ['A newer CEPII BACI HS22 release is ready.'] },
    ]);
    expect(result!.skipped.filter((item) => ours.has(item.product_id))).toEqual([{ product_id: newer.product_id, reason: "Today's refresh budget (2 runs) is used." }]);
    expect(result!.budget_left).toBe(0);
    // The current run, the failed one and the one under a superseded code are never touched.
    for (const run of [current, failed, oldCode]) expect([...started, ...result!.skipped.map((item) => item.product_id)]).not.toContain(run.product_id);

    // A start that is refused (another run in flight, an unpaid tenant) is skipped with its reason and costs no budget.
    const refused = await sweepV5Refresh({ now: new Date('2026-10-31T07:00:00Z'), state: state({ baci: { HS17: 'baci17-a', HS22: 'baci22-b' } }), start: (async () => { throw new Error('A run is already in progress.'); }) as never, daily_budget: 1 });
    expect(refused!.skipped.find((item) => item.product_id === oldest.product_id)).toEqual({ product_id: oldest.product_id, reason: 'A run is already in progress.' });
    expect(refused!.started).toEqual([]);
  });
});
