import { createHash } from 'node:crypto';
import type { DiscoveryScoringPolicy } from '@/lib/config';

function canonical(value:unknown):unknown {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));
  return value;
}

// Widened from DiscoveryScoringPolicy to any policy object so BuyerFit can hash its own policy
// with the SAME canonicalization. A second implementation would key-order differently and
// produce a different hash for identical content, which would silently break the one property
// a policy hash has to have.
export function canonicalPolicyJson(policy:object){return JSON.stringify(canonical(policy));}
export function scoringPolicyHash(policy:object){return createHash('sha256').update(canonicalPolicyJson(policy)).digest('hex');}

export function assertSupportedScoringModel(policy:DiscoveryScoringPolicy){
  if(policy.model_version!=='market-attractiveness-v2'&&policy.model_version!=='market-attractiveness-v3'&&!policy.model_version.startsWith('test'))throw new Error(`Unsupported Demand Discovery model version ${policy.model_version}.`);
  return policy.model_version;
}

export function historicalPolicyFromSnapshot(snapshot:unknown):DiscoveryScoringPolicy|null{
  if(!snapshot||typeof snapshot!=='object')return null;
  const policy=snapshot as DiscoveryScoringPolicy;
  try{assertSupportedScoringModel(policy);return policy;}catch{return null;}
}
