/**
 * Exporter-facing number formatting.
 *
 * The frozen rationale on a MarketAssessment reads `DE's recorded 100630 import market was
 * 511317180.09 in 2025` and `changed at 10.734514179614% CAGR`. Those are the true stored
 * values and must stay exactly that in the audit surfaces — but rendering fourteen significant
 * figures to an SME exporter implies a precision the underlying trade statistic does not have.
 *
 * Rounding here is presentational only. Nothing in this file feeds a score, and no rounded
 * value is ever written back.
 */

/** `511317180.09` → `$511M`. Never invents a currency: provider trade values are USD. */
export function usdCompact(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 0 : 1)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

/** `10.734514179614` → `10.7%`. Sign is kept: a contraction must not read as growth. */
export function percent(value: number | null | undefined, digits = 1): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${value.toFixed(digits)}%`;
}

/** A growth rate carries its direction explicitly, so `+10.7%` never reads as a level. */
export function signedPercent(value: number | null | undefined, digits = 1): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

/**
 * A share of a market, stated as a share. `india_market_share` is published by the metrics
 * calculator on a 0–100 scale; anything outside that is refused rather than rescaled, because
 * silently multiplying by 100 is how a 0.75 fraction becomes a 75% claim that was never made.
 */
export function sharePercent(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value < 0 || value > 100) return null;
  return `${value.toFixed(1)}%`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `31 Aug 2026`, in UTC — the clock every frozen assessment is stamped in. */
export function shortDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** `2021–2025` from the period set an assessment actually used. */
export function periodRange(periods: readonly number[] | null | undefined): string | null {
  if (!periods?.length) return null;
  const sorted = [...periods].sort((left, right) => left - right);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  return first === last ? String(first) : `${first}–${last}`;
}
