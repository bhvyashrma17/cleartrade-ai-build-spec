/**
 * Discovery engine selection — the single place that decides which implementation runs.
 *
 * This factory is the entire cost of swapping in a real provider: add an implementation
 * of `DiscoveryEngine`, add a case here. Nothing in the job system, the routes, the
 * schema, or the UI names an engine, so none of them change (docs/02: "don't bind the
 * frontend to an assumed AI provider or algorithm").
 */

import type { DiscoveryEngine } from './engine';
import { MockDiscoveryEngine } from './mock-engine';
import { WarehouseDiscoveryEngine } from './warehouse-engine';

export type { DiscoveryEngine, DiscoveryInput, DiscoveryResult, MarketAssessmentDraft } from './engine';
export { MockDiscoveryEngine } from './mock-engine';
export { WarehouseDiscoveryEngine } from './warehouse-engine';

let cached: DiscoveryEngine | null = null;

export function getDiscoveryEngine(): DiscoveryEngine {
  if (cached) return cached;

  // `warehouse` is now the default: rankings are computed from ingested Comtrade flows
  // rather than simulated. The mock stays reachable via DISCOVERY_ENGINE=mock — it is still
  // the right engine for a UI demo against an empty warehouse, and for any test that wants
  // ranked results without seeding trade data first.
  switch (process.env.DISCOVERY_ENGINE ?? 'warehouse') {
    case 'mock':
      // Latency is overridable so tests don't wait on simulated work.
      cached = new MockDiscoveryEngine(Number(process.env.DISCOVERY_MOCK_LATENCY_MS ?? 2400));
      return cached;
    case 'warehouse':
    default:
      cached = new WarehouseDiscoveryEngine();
      return cached;
  }
}

/** Test seam — lets a suite inject a fake without going through the environment. */
export function setDiscoveryEngine(engine: DiscoveryEngine | null) {
  cached = engine;
}
