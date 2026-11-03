/**
 * BACI flows in the engine's units and identities (docs/36 §2, §4).
 *
 * BACI publishes value in thousands of USD and quantity in metric tons, keyed by its own numeric
 * country codes. The engine speaks USD, kg and ISO alpha-2. The archive's own country file is the
 * only authority for the code → ISO mapping (never an alias map, AGENTS.md); a code without an ISO
 * identity there — 490 "Asia, nes", which is Taiwan — keeps a provider-scoped identity so its trade
 * still counts in every share and concentration.
 */
import type { BaciFlow } from '@/lib/trade-datasets/baci';
import type { TradeFlowInput } from './series';

export interface BaciCountryIdentity {
  provider_code: string;
  iso2: string | null;
}

export interface BaciFlowConversion {
  flows: TradeFlowInput[];
  /** ISO alpha-2 identities the release's country file covers: a market here has a BACI series. */
  markets_covered: Set<string>;
  /** Flows that became trade of a country with itself once two codes shared one ISO identity. */
  dropped_self_flows: number;
}

export const baciProviderIdentity = (code: string) => `cepii_baci:${code}`;

export function baciFlowsToTradeFlows(flows: readonly BaciFlow[], countries: readonly BaciCountryIdentity[]): BaciFlowConversion {
  const identity = new Map<string, string>();
  const covered = new Set<string>();
  for (const country of countries) {
    identity.set(country.provider_code, country.iso2 ?? baciProviderIdentity(country.provider_code));
    if (country.iso2) covered.add(country.iso2);
  }
  const result: TradeFlowInput[] = [];
  let dropped = 0;
  for (const flow of flows) {
    const exporter = identity.get(flow.exporter);
    const importer = identity.get(flow.importer);
    if (!exporter || !importer) throw new Error(`BACI code ${exporter ? flow.importer : flow.exporter} is not in the release's country file.`);
    if (exporter === importer) {
      dropped += 1;
      continue;
    }
    result.push({
      year: flow.year,
      exporter,
      importer,
      value_usd: flow.value_kusd * 1000,
      quantity_kg: flow.quantity_t == null ? null : flow.quantity_t * 1000,
    });
  }
  return { flows: sortFlows(result), markets_covered: covered, dropped_self_flows: dropped };
}

/** A fixed order, so sums — and every score built on them — do not depend on read order. */
export function sortFlows<T extends TradeFlowInput>(flows: T[]): T[] {
  return flows.sort((a, b) => a.year - b.year || (a.importer < b.importer ? -1 : a.importer > b.importer ? 1 : 0) || (a.exporter < b.exporter ? -1 : a.exporter > b.exporter ? 1 : 0) || a.value_usd - b.value_usd);
}
