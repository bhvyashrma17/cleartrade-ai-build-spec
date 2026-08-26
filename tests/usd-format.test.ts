import { describe, expect, test } from 'vitest';
import { formatCompactUsd } from '../src/lib/usd-format';

describe('Agent compact USD formatting', () => {
  test('uses USD millions and billions, never Indian crore notation', () => {
    expect(formatCompactUsd(511_317_180)).toBe('$511.3M');
    expect(formatCompactUsd(1_562_408_518)).toBe('$1.56B');
    expect(formatCompactUsd(511_317_180)).not.toContain('Cr');
  });
});
