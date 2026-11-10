/**
 * The v5 engine's model identity, on its own so client components and pure view modules can read
 * it without the policy's server-only imports (`policy.ts` uses `node:crypto`).
 */
export const DEMAND_DISCOVERY_V5_MODEL = 'market-opportunity-v5';
