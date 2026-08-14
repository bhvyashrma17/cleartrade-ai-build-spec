/**
 * Comtrade client selection — the single place that decides which implementation runs.
 * Mirrors `src/lib/discovery/index.ts` exactly, for the same reason: nothing in the job
 * system, the schema, or scripts names a client, so none of them change when a real key
 * is wired up.
 *
 * Defaults to the mock client. This sandboxed environment has no outbound network access,
 * and no `COMTRADE_API_KEY` is configured, so the real client cannot be exercised here —
 * the mock is what lets the ingest job, its idempotency, and its IngestRun bookkeeping be
 * verified end to end regardless.
 */

import type { ComtradePolicy } from '@/lib/config';
import type { ComtradeClient } from './client';
import { MockComtradeClient } from './mock-client';
import { ComtradeApiClient } from './real-client';

export type {
  ComtradeClient,
  ComtradeFetchParams,
  ComtradeFetchResult,
  ComtradeFlowRow,
  FlowDirection,
} from './client';
export { ComtradeRateLimitError } from './client';
export { MockComtradeClient } from './mock-client';

let cached: ComtradeClient | null = null;

export function getComtradeClient(policy: ComtradePolicy): ComtradeClient {
  if (cached) return cached;

  switch (process.env.COMTRADE_CLIENT ?? 'mock') {
    case 'real': {
      const apiKey = process.env.COMTRADE_API_KEY;
      if (!apiKey) throw new Error('COMTRADE_CLIENT=real requires COMTRADE_API_KEY.');
      cached = new ComtradeApiClient(apiKey, policy);
      return cached;
    }
    case 'preview':
      cached = new ComtradeApiClient(null, policy, true);
      return cached;
    case 'mock':
    default:
      cached = new MockComtradeClient();
      return cached;
  }
}

/** Test seam — lets a suite inject a fake without going through the environment. */
export function setComtradeClient(client: ComtradeClient | null) {
  cached = client;
}
