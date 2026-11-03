/** Agent-facing compact USD display. Never applies Indian crore/lakh notation to USD. */
export function formatCompactUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: Math.abs(value) >= 1_000_000_000 ? 2 : 1,
  }).format(value);
}
