import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test } from 'vitest';
import { OrgTier, UserRole } from '@prisma/client';
import { approveMarketScan, requestMarketScan } from '../src/lib/country-discovery/scan-requests';
import { startMarketDiscovery } from '../src/lib/country-discovery/service';
import { requestDeepCountryTruthFromScreening } from '../src/lib/country-truth-deep-request';
import { requestCountryTruthDiscovery } from '../src/lib/country-truth-discovery-request';
import { assertEarlierEnginesRetired, EARLIER_ENGINES_RETIRED_MESSAGE } from '../src/lib/demand-discovery-v5/earlier-engines';
import { enqueueGlobalCountryScreening } from '../src/lib/job-handlers/country-screening';
import type { Principal } from '../src/types';

/**
 * The earlier discovery engines are retired (owner, 30 Oct 2026, D-036). In staging and production
 * nothing starts a Country Truth v4 scan, scan request or detailed analysis, or a warehouse-engine
 * run; Demand Discovery v5 is the only engine. Their code stays only so stored runs remain readable
 * and their own suites keep running here.
 */
const ops: Principal = { id: 'ops-user', email: 'ops@test.local', name: 'Ops', role: UserRole.ops_supervisor, exporter_org_id: null, tier: OrgTier.paid };
const savedEnv = process.env.APP_ENV;

afterEach(() => {
  if (savedEnv === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = savedEnv;
});

describe('the retirement guard', () => {
  test('refuses in staging and production with the reason, and lets other environments through', () => {
    for (const APP_ENV of ['staging', 'production']) {
      let caught: unknown;
      try {
        assertEarlierEnginesRetired('A global market scan', { ...process.env, APP_ENV });
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({ code: 'PREREQUISITES_NOT_MET', message: EARLIER_ENGINES_RETIRED_MESSAGE });
      expect((caught as { blockers: { reason: string }[] }).blockers[0]!.reason).toBe('RETIRED: A global market scan belongs to a retired engine.');
    }
    for (const APP_ENV of ['test', 'development']) expect(() => assertEarlierEnginesRetired('A global market scan', { ...process.env, APP_ENV })).not.toThrow();
  });
});

describe('in a real environment every entry point refuses before writing anything', () => {
  const entryPoints: [string, () => Promise<unknown>][] = [
    ['a market scan request', () => requestMarketScan({ actor: ops, exporter_org_id: 'org', product_id: 'product', correlation_id: 'c' })],
    ['approving a market scan', () => approveMarketScan({ actor: ops, request_id: 'request', correlation_id: 'c' })],
    ['a market scan started by staff', () => startMarketDiscovery(ops, 'org', 'product', 'c')],
    ['a global screening job', () => enqueueGlobalCountryScreening({} as never)],
    ['a detailed Country Truth analysis', () => requestDeepCountryTruthFromScreening({ actor: ops, exporter_org_id: 'org', product_id: 'product', screening_run_id: 'run', correlation_id: 'c' } as never)],
    ['a Country Truth analysis of chosen markets', () => requestCountryTruthDiscovery({ actor: ops, exporter_org_id: 'org', product_id: 'product', candidate_countries: ['DE'], correlation_id: 'c' })],
  ];

  for (const [name, start] of entryPoints) {
    test(name, async () => {
      process.env.APP_ENV = 'staging';
      await expect(start()).rejects.toMatchObject({ code: 'PREREQUISITES_NOT_MET', message: EARLIER_ENGINES_RETIRED_MESSAGE });
    });
  }
});

describe('no fallback to an earlier engine', () => {
  test('a manual Demand Discovery run goes to v5 or is refused with the reason', () => {
    const route = readFileSync('src/app/api/v1/discovery-runs/route.ts', 'utf8');
    expect(route).toContain('demandDiscoveryV5Availability');
    expect(route).toContain('the earlier discovery engines are retired');
    expect(route).not.toContain('JobType.demand_discovery');
    expect(route).not.toContain('enqueueJob');
  });

  test('the warehouse verification script refuses staging and production', () => {
    expect(readFileSync('scripts/verify-warehouse-discovery.ts', 'utf8')).toContain("assertEarlierEnginesRetired('The warehouse engine verification')");
  });
});
