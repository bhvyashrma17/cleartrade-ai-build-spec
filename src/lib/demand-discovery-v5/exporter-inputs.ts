/**
 * The exporter's own figures for the two exporter-fit metrics (docs/36 §4 #11, #12).
 *
 * - Price fit needs the exporter's FOB (or EXW) price per kg in USD: a price per mass unit, or a
 *   price per piece with the piece's net weight, converted at an ECB rate frozen on the run.
 * - Volume fit needs yearly capacity in kg: a capacity in a mass unit and its period.
 *
 * Anything else — a price per carton without a weight, CIF terms, a capacity in pieces — leaves the
 * metric unavailable with the reason, never guessed. Mass factors are the exact SI definitions.
 */
import { canonicalProductUnit } from '@/lib/product-profile';

const KG_PER_UNIT: Readonly<Record<string, number>> = { g: 0.001, kg: 1, tonne: 1000, lb: 0.45359237 };
const PERIODS_PER_YEAR: Readonly<Record<string, number>> = { day: 365, week: 52, month: 12, year: 1 };
const PERIOD_ALIASES: Readonly<Record<string, string>> = { daily: 'day', d: 'day', weekly: 'week', wk: 'week', monthly: 'month', mo: 'month', mon: 'month', yearly: 'year', annual: 'year', annually: 'year', yr: 'year', pa: 'year' };

export function kgPerUnit(unit: string | null | undefined): number | null {
  const canonical = canonicalProductUnit(unit);
  return canonical != null && canonical in KG_PER_UNIT ? KG_PER_UNIT[canonical] : null;
}

function periodsPerYear(period: string | null | undefined): number | null {
  if (period == null) return null;
  const normalized = period.trim().toLowerCase().replace(/^per\s+/, '');
  const canonical = PERIOD_ALIASES[normalized] ?? normalized;
  return PERIODS_PER_YEAR[canonical] ?? null;
}

export type ExporterFigure = { value: number; basis: Record<string, string | number> } | { value: null; reason: string };

/**
 * USD per kg from the product's target price. `usdPerUnitOfCurrency` is the frozen ECB-derived
 * rate (1 for USD), or null when no rate is available for the run's date.
 */
export function exporterUsdPerKg(product: {
  price_target_amount: number | null;
  price_target_currency: string | null;
  price_target_quantity_unit: string | null;
  price_target_incoterm: string | null;
  unit_net_weight_value: number | null;
  unit_net_weight_unit: string | null;
}, usdPerUnitOfCurrency: number | null): ExporterFigure {
  const { price_target_amount: amount, price_target_currency: currency, price_target_quantity_unit: quantityUnit } = product;
  if (amount == null || !(amount > 0) || !currency || !quantityUnit) return { value: null, reason: 'Your FOB price per kg is not on the product form yet.' };
  const incoterm = product.price_target_incoterm?.trim().toUpperCase() ?? null;
  if (incoterm !== 'FOB' && incoterm !== 'EXW') return { value: null, reason: `Your price is quoted ${incoterm ?? 'without delivery terms'}; price fit compares FOB (or EXW) prices.` };
  let kgPerQuantity = kgPerUnit(quantityUnit);
  let weightBasis: string = quantityUnit;
  if (kgPerQuantity == null) {
    const unit = canonicalProductUnit(quantityUnit);
    const pieceWeight = product.unit_net_weight_value != null ? kgPerUnit(product.unit_net_weight_unit) : null;
    if ((unit === 'piece' || unit === 'unit') && pieceWeight != null && product.unit_net_weight_value! > 0) {
      kgPerQuantity = product.unit_net_weight_value! * pieceWeight;
      weightBasis = `${unit} net weight ${product.unit_net_weight_value} ${product.unit_net_weight_unit}`;
    } else {
      return { value: null, reason: `Your price is per ${quantityUnit}; price fit needs a price per kg, or a piece price with the piece's net weight.` };
    }
  }
  if (usdPerUnitOfCurrency == null || !(usdPerUnitOfCurrency > 0)) return { value: null, reason: `No published exchange rate for ${currency.toUpperCase()} on the run date.` };
  const value = (amount / kgPerQuantity) * usdPerUnitOfCurrency;
  return { value, basis: { amount, currency: currency.toUpperCase(), quantity_unit: weightBasis, incoterm, usd_per_unit_of_currency: usdPerUnitOfCurrency } };
}

/** Yearly capacity in kg. A unit like `kg/month` carries its own period; otherwise `capacity_period`, then monthly (the field's definition). */
export function exporterYearlyKg(product: { capacity_value: number | null; capacity_unit: string | null; capacity_period: string | null }): ExporterFigure {
  if (product.capacity_value == null || !(product.capacity_value > 0) || !product.capacity_unit) return { value: null, reason: 'Your monthly capacity in a weight unit is not on the product form yet.' };
  const [unitPart, periodPart] = product.capacity_unit.split('/').map((part) => part.trim());
  const kg = kgPerUnit(unitPart);
  if (kg == null) return { value: null, reason: `Your capacity is in ${unitPart}; volume fit needs a weight (kg or tonnes).` };
  const periodText = periodPart || product.capacity_period || 'month';
  const perYear = periodsPerYear(periodText);
  if (perYear == null) return { value: null, reason: `Capacity period "${periodText}" is not a day, week, month or year.` };
  return { value: product.capacity_value * kg * perYear, basis: { capacity_value: product.capacity_value, unit: unitPart, period: periodText, periods_per_year: perYear } };
}

/** The exporter's two figures as a finished run froze them, for the results page (stage 1, item 7). */
export interface ExporterFitView {
  /** Points each measure carries in the policy the run used; null when the run stored no policy. */
  points: { price_fit: number | null; volume_fit: number | null };
  price: { usd_per_kg: number | null; reason: string | null };
  capacity: { kg_per_year: number | null; reason: string | null };
}

/** Reads `frozen_inputs.exporter` and the policy snapshot defensively; null for a run that froze no exporter figures. */
export function exporterFitView(frozenInputs: unknown, policySnapshot: unknown): ExporterFitView | null {
  const record = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
  const exporter = record(record(frozenInputs)?.exporter);
  if (!exporter) return null;
  const figure = (value: unknown) => {
    const stored = record(value);
    return { value: typeof stored?.value === 'number' && Number.isFinite(stored.value) ? stored.value : null, reason: typeof stored?.reason === 'string' ? stored.reason : null };
  };
  const points = record(record(policySnapshot)?.points);
  const point = (key: string) => (typeof points?.[key] === 'number' ? (points[key] as number) : null);
  const price = figure(exporter.usd_per_kg);
  const capacity = figure(exporter.yearly_kg);
  return {
    points: { price_fit: point('price_fit'), volume_fit: point('volume_fit') },
    price: { usd_per_kg: price.value, reason: price.value == null ? price.reason : null },
    capacity: { kg_per_year: capacity.value, reason: capacity.value == null ? capacity.reason : null },
  };
}
