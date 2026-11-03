/**
 * Market time series for one HS6 product (docs/36 §4), built from bilateral flows.
 *
 * Flows come from BACI (reconciled, FOB) or, as a fallback, from Comtrade. A market's imports in a
 * year are the flows into it; BACI records only strictly positive flows, so a year with no flow is
 * a recorded absence of trade, not a missing value. Supplier identity is ISO alpha-2 where the
 * provider's own country reference gives one, else `provider:<code>`, so a real supplier without an
 * ISO identity (BACI 490, "Asia, nes") still counts in shares and concentration.
 */

export interface TradeFlowInput {
  year: number;
  exporter: string;
  importer: string;
  value_usd: number;
  quantity_kg: number | null;
}

export interface SupplierYear {
  value_usd: number;
  quantity_kg: number | null;
}

export interface MarketYear {
  year: number;
  total_usd: number;
  india_usd: number;
  /** Value of the suppliers whose quantity is reported. */
  value_with_quantity_usd: number;
  quantity_kg_reported: number;
  suppliers: Map<string, SupplierYear>;
}

export interface MarketSeries {
  market: string;
  years: Map<number, MarketYear>;
  /** The market's own exports of the product per year, for the trading-hub note. */
  exports_usd: Map<number, number>;
}

export const INDIA = 'IN';

/** Builds a series for every market in `markets`, including markets with no flow at all. */
export function buildMarketSeries(flows: readonly TradeFlowInput[], markets: Iterable<string>): Map<string, MarketSeries> {
  const result = new Map<string, MarketSeries>();
  for (const market of markets) result.set(market, { market, years: new Map(), exports_usd: new Map() });
  for (const flow of flows) {
    if (!(flow.value_usd > 0)) throw new Error(`Flow ${flow.exporter}->${flow.importer} ${flow.year} has non-positive value ${flow.value_usd}.`);
    const importer = result.get(flow.importer);
    if (importer) {
      let year = importer.years.get(flow.year);
      if (!year) {
        year = { year: flow.year, total_usd: 0, india_usd: 0, value_with_quantity_usd: 0, quantity_kg_reported: 0, suppliers: new Map() };
        importer.years.set(flow.year, year);
      }
      year.total_usd += flow.value_usd;
      if (flow.exporter === INDIA) year.india_usd += flow.value_usd;
      if (flow.quantity_kg != null && flow.quantity_kg > 0) {
        year.value_with_quantity_usd += flow.value_usd;
        year.quantity_kg_reported += flow.quantity_kg;
      }
      const supplier = year.suppliers.get(flow.exporter);
      if (supplier) {
        supplier.value_usd += flow.value_usd;
        supplier.quantity_kg = supplier.quantity_kg != null && flow.quantity_kg != null ? supplier.quantity_kg + flow.quantity_kg : null;
      } else {
        year.suppliers.set(flow.exporter, { value_usd: flow.value_usd, quantity_kg: flow.quantity_kg });
      }
    }
    const exporter = result.get(flow.exporter);
    if (exporter) exporter.exports_usd.set(flow.year, (exporter.exports_usd.get(flow.year) ?? 0) + flow.value_usd);
  }
  return result;
}

/** A market's imports in `year`; 0 when it recorded no flow that year. */
export function importsIn(series: MarketSeries, year: number): number {
  return series.years.get(year)?.total_usd ?? 0;
}

export interface UnitValuePoint {
  /** USD per kg. */
  unit_value: number;
  /** Weight in kg. */
  quantity_kg: number;
}

/** India's unit values to every destination in `year`, one point per destination with a quantity. */
export function indiaExportUnitValues(flows: readonly TradeFlowInput[], year: number): UnitValuePoint[] {
  const byDestination = new Map<string, { value: number; quantity: number }>();
  for (const flow of flows) {
    if (flow.exporter !== INDIA || flow.year !== year || flow.quantity_kg == null || !(flow.quantity_kg > 0)) continue;
    const current = byDestination.get(flow.importer) ?? { value: 0, quantity: 0 };
    current.value += flow.value_usd;
    current.quantity += flow.quantity_kg;
    byDestination.set(flow.importer, current);
  }
  return [...byDestination.values()].map((point) => ({ unit_value: point.value / point.quantity, quantity_kg: point.quantity }));
}

/** A market's supplier unit values in `year`, one point per supplier with a quantity. */
export function marketUnitValues(series: MarketSeries, year: number): UnitValuePoint[] {
  const marketYear = series.years.get(year);
  if (!marketYear) return [];
  return [...marketYear.suppliers.values()]
    .filter((supplier) => supplier.quantity_kg != null && supplier.quantity_kg > 0)
    .map((supplier) => ({ unit_value: supplier.value_usd / supplier.quantity_kg!, quantity_kg: supplier.quantity_kg! }));
}
