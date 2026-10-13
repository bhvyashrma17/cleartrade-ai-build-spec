/**
 * Batched Comtrade rows in the shapes the v5 engine takes (docs/36 §3.3, §5.3).
 *
 * - the newest-year link needs, per market, what it reported for World and for India in `L` and
 *   `L+1` — `null` when it did not report the year at all, 0 when it reported the year and recorded
 *   no such import (Comtrade sends no row for a zero flow);
 * - the market-level fallback needs a market's own imports by partner, over consecutive years it
 *   reported;
 * - the release-level fallback also needs India's own exports by destination, for India's price.
 *
 * Whether a market reported a year comes from Comtrade's data-availability list (getDa), or from
 * the presence of any row for it in the response. Partner identity comes from the provider's own
 * reporter reference; a partner without an ISO identity keeps `un_comtrade:<code>`.
 */
import type { BatchedComtradeRow } from '@/lib/comtrade/batch';
import type { ComtradeNewestYearInput } from './chain-link';
import type { TradeFlowInput } from './series';

export const COMTRADE_WORLD = '0';
export const COMTRADE_INDIA = '699';

export interface MarketReporter {
  iso2: string;
  reporter_code: string;
}

/** Reporter codes with annual HS data, per year (getDa). */
export type ReportedYears = ReadonlyMap<number, ReadonlySet<string>>;

export const comtradeProviderIdentity = (code: string) => `un_comtrade:${code}`;

/** Partner code → ISO alpha-2 from the provider's reporter reference; anything else keeps a provider identity. */
export function comtradePartnerIdentity(reporters: readonly { reporter_code: string; iso2: string }[]): (code: string) => string {
  const byCode = new Map(reporters.map((reporter) => [reporter.reporter_code, reporter.iso2]));
  return (code) => byCode.get(code) ?? comtradeProviderIdentity(code);
}

function indexRows(rows: readonly BatchedComtradeRow[], flow: 'M' | 'X') {
  const byKey = new Map<string, BatchedComtradeRow>();
  const reporterYears = new Set<string>();
  for (const row of rows) {
    if (row.flow !== flow) continue;
    byKey.set(`${row.reporter_code}:${row.partner_code}:${row.period}`, row);
    reporterYears.add(`${row.reporter_code}:${row.period}`);
  }
  return { byKey, reporterYears };
}

export function newestYearInputs(args: {
  rows: readonly BatchedComtradeRow[];
  base_year: number;
  markets: readonly MarketReporter[];
  reported: ReportedYears;
}): Map<string, ComtradeNewestYearInput> {
  const { byKey, reporterYears } = indexRows(args.rows, 'M');
  const reported = (reporter: string, period: number) => args.reported.get(period)?.has(reporter) === true || reporterYears.has(`${reporter}:${period}`);
  const value = (reporter: string, partner: string, period: number): number | null => {
    if (!reported(reporter, period)) return null;
    const row = byKey.get(`${reporter}:${partner}:${period}`);
    return row ? row.value_usd : 0;
  };
  const result = new Map<string, ComtradeNewestYearInput>();
  for (const market of args.markets) {
    const code = market.reporter_code;
    result.set(market.iso2, {
      market: market.iso2,
      base_year: args.base_year,
      world_base_usd: value(code, COMTRADE_WORLD, args.base_year),
      world_newest_usd: value(code, COMTRADE_WORLD, args.base_year + 1),
      india_base_usd: value(code, COMTRADE_INDIA, args.base_year),
      india_newest_usd: value(code, COMTRADE_INDIA, args.base_year + 1),
    });
  }
  return result;
}

export interface FallbackSeries {
  years: number[];
  flows: TradeFlowInput[];
  /** Partner rows whose value the provider withheld or garbled: not counted, and reported. */
  withheld_rows: number;
}

/**
 * A market's own imports by partner over the longest run of consecutive reported years that ends
 * at its latest reported year, at most `window_years` long — so a year inside the window is never
 * a year the market simply did not report.
 */
export function fallbackMarketSeries(args: {
  rows: readonly BatchedComtradeRow[];
  market: MarketReporter;
  candidate_years: readonly number[];
  reported: ReportedYears;
  window_years: number;
  partner_identity: (code: string) => string;
}): FallbackSeries | null {
  const code = args.market.reporter_code;
  const own = args.rows.filter((row) => row.flow === 'M' && row.reporter_code === code);
  const withRows = new Set(own.map((row) => row.period));
  const reported = [...args.candidate_years].filter((year) => args.reported.get(year)?.has(code) || withRows.has(year)).sort((a, b) => a - b);
  if (!reported.length) return null;
  const years = [reported[reported.length - 1]];
  for (let index = reported.length - 2; index >= 0 && years.length < args.window_years; index -= 1) {
    if (reported[index] !== years[0] - 1) break;
    years.unshift(reported[index]);
  }
  const inWindow = new Set(years);
  let withheld = 0;
  const flows: TradeFlowInput[] = [];
  for (const row of own) {
    if (!inWindow.has(row.period) || row.partner_code === COMTRADE_WORLD) continue;
    if (row.value_usd == null) {
      withheld += 1;
      continue;
    }
    if (!(row.value_usd > 0)) continue;
    const exporter = args.partner_identity(row.partner_code);
    if (exporter === args.market.iso2) continue;
    flows.push({ year: row.period, exporter, importer: args.market.iso2, value_usd: row.value_usd, quantity_kg: row.net_weight_kg != null && row.net_weight_kg > 0 ? row.net_weight_kg : null });
  }
  return { years, flows, withheld_rows: withheld };
}

/** India's reported exports by destination (flow X, reporter 699), for India's price without BACI. */
export function indiaExportFlows(rows: readonly BatchedComtradeRow[], partnerIdentity: (code: string) => string): TradeFlowInput[] {
  return rows
    .filter((row) => row.flow === 'X' && row.reporter_code === COMTRADE_INDIA && row.partner_code !== COMTRADE_WORLD && row.value_usd != null && row.value_usd > 0)
    .map((row) => ({ year: row.period, exporter: 'IN', importer: partnerIdentity(row.partner_code), value_usd: row.value_usd!, quantity_kg: row.net_weight_kg != null && row.net_weight_kg > 0 ? row.net_weight_kg : null }))
    .filter((flow) => flow.importer !== 'IN');
}
