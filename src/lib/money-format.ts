/**
 * Money in the units Indian exporters read: rupees in lakh (10^5) and crore (10^7) beside the US
 * dollar figures Demand Discovery computes in (owner decision 14 Oct 2026, D-023). Pure: the rate
 * comes from the caller (`src/lib/fx/display-rate.ts` on the server).
 */

const trimmed = (value: number) => (value >= 100 ? Math.round(value).toLocaleString('en-IN') : String(Number(value.toFixed(value >= 10 ? 1 : 2))));

/** ₹45.2 lakh, ₹10.3 crore, ₹8,40,000. */
export function formatInr(value: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1e7) return `${sign}₹${trimmed(abs / 1e7)} crore`;
  if (abs >= 1e5) return `${sign}₹${trimmed(abs / 1e5)} lakh`;
  return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`;
}

/** A price per kilogram in rupees: ₹176/kg, ₹4.25/kg. */
export function formatInrPerKg(value: number): string {
  return `₹${value >= 100 ? Math.round(value).toLocaleString('en-IN') : value.toFixed(2)}/kg`;
}

/** A price per kilogram in US dollars: $2.10/kg, $0.085/kg. */
export function formatUsdPerKg(value: number): string {
  if (value >= 100) return `$${Math.round(value).toLocaleString('en-US')}/kg`;
  return `$${value >= 0.1 ? value.toFixed(2) : value.toPrecision(2)}/kg`;
}

/**
 * Appends the rupee equivalent after every dollar amount in a sentence written by this codebase
 * (`formatUsd`, `formatUsdPerKg`): "$12.3 million" → "$12.3 million (₹103 crore)". With no rate the
 * sentence is returned unchanged.
 */
export function withRupees(text: string, inrPerUsd: number | null | undefined): string {
  if (inrPerUsd == null || !(inrPerUsd > 0)) return text;
  return text.replace(/\$(\d{1,3}(?:,\d{3})*(?:\.\d+)?)( billion| million)?(\/kg)?/g, (match, amount: string, scale: string | undefined, perKg: string | undefined) => {
    const usd = Number(amount.replace(/,/g, '')) * (scale === ' billion' ? 1e9 : scale === ' million' ? 1e6 : 1);
    if (!Number.isFinite(usd)) return match;
    return `${match} (${perKg ? formatInrPerKg(usd * inrPerUsd) : formatInr(usd * inrPerUsd)})`;
  });
}
