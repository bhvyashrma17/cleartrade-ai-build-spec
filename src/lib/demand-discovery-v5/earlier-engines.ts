/**
 * The earlier discovery engines are retired (owner, 30 Oct 2026, D-036): Country Truth v4 (global
 * market scans, scan requests and detailed analysis) and the warehouse engine no longer start work
 * in staging or production. Demand Discovery v5 (docs/36) is the only engine: it scores every
 * product in all 218 markets, starting when the product's HS code is confirmed.
 *
 * Their code stays for now so stored runs remain readable and their own tests keep running. In a
 * real environment every entry point that would start one calls this first and refuses, before
 * anything is written.
 */
import { prerequisitesNotMet } from '@/lib/errors';
import { isRealWorkflowEnvironment } from '@/lib/evidence-environment';

export const EARLIER_ENGINES_RETIRED_MESSAGE =
  'Country Truth v4 and the earlier discovery engines are retired. Demand Discovery v5 scores every product in all 218 markets, starting when its HS code is confirmed.';

export function assertEarlierEnginesRetired(action: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!isRealWorkflowEnvironment(env)) return;
  throw prerequisitesNotMet(
    [{ object_type: 'demand_discovery_engine', object_id: 'earlier_engines', reason: `RETIRED: ${action} belongs to a retired engine.` }],
    EARLIER_ENGINES_RETIRED_MESSAGE,
  );
}
