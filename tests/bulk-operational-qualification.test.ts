import { describe, expect, test } from 'vitest';
import { BoundedBundleCache } from '@/lib/market-access/bundle-cache';
import {
  gradeBulkQualification,
  measureBulkDecode,
  PEAK_RSS_CEILING_BYTES,
  WARN_RSS_BYTES,
  WORKER_MEMORY_LIMIT_BYTES,
  type BulkQualificationMeasurement,
} from '@/lib/market-access/bulk-operational-qualification';

/**
 * These tests pin the *gate's own logic* and run in ordinary CI. They deliberately do not download
 * real government archives — that is what `scripts/qualify-bulk-adapters.ts` is for, run
 * explicitly. What must never regress silently is the grading: a threshold quietly raised to make
 * a failing adapter pass would defeat the entire point of the gate, and that is checked here.
 */

function measurement(over: Partial<BulkQualificationMeasurement> = {}): BulkQualificationMeasurement {
  return {
    source_bytes: 5_000_000,
    decompressed_bytes: 40_000_000,
    row_count: 900_000,
    peak_rss_bytes: 400 * 1024 * 1024,
    attributed_rss_bytes: 300 * 1024 * 1024,
    retained_heap_bytes: 250 * 1024 * 1024,
    duration_ms: 800,
    ...over,
  };
}

describe('bulk memory thresholds are derived from the real worker budget', () => {
  test('the ceiling and warn line are fixed fractions of the 1GiB worker, not fitted to an adapter', () => {
    expect(WORKER_MEMORY_LIMIT_BYTES).toBe(1024 * 1024 * 1024);
    expect(PEAK_RSS_CEILING_BYTES).toBe(Math.floor(WORKER_MEMORY_LIMIT_BYTES * 0.7));
    expect(WARN_RSS_BYTES).toBe(Math.floor(WORKER_MEMORY_LIMIT_BYTES * 0.6));
    expect(WARN_RSS_BYTES).toBeLessThan(PEAK_RSS_CEILING_BYTES);
  });

  test('the pre-fix NZ regression (977MB against a 1GB worker) would fail this gate', () => {
    // The exact shape of the incident this gate exists to prevent: it must not be admitted.
    const result = gradeBulkQualification('nz_regression', measurement({ peak_rss_bytes: 977 * 1024 * 1024, attributed_rss_bytes: 900 * 1024 * 1024 }));
    expect(result.status).toBe('failed');
    expect(result.findings.join(' ')).toMatch(/exceeds the .* ceiling/);
  });

  test('the post-fix NZ measurement passes, and with real margin rather than a hair', () => {
    const result = gradeBulkQualification('nz_customs_cusmod', measurement({ peak_rss_bytes: 535 * 1024 * 1024, attributed_rss_bytes: 405 * 1024 * 1024 }));
    expect(result.status).toBe('passed');
    // Margin is the point: a threshold drawn just above the observed value would be worthless.
    expect(result.peak_rss_bytes).toBeLessThan(PEAK_RSS_CEILING_BYTES * 0.8);
  });

  test('an adapter between the comfort line and the ceiling warns without failing', () => {
    const result = gradeBulkQualification('growing', measurement({ peak_rss_bytes: WARN_RSS_BYTES + 1024 * 1024 }));
    expect(result.status).toBe('warned');
    expect(result.findings.join(' ')).toMatch(/little room for source growth/);
  });

  test('retaining many times the source flags a whole-source materialisation, independently of the ceiling', () => {
    // Small absolute footprint (passes the ceiling) but a 20x retention ratio: the pre-fix NZ
    // shape, which held a full split-cell copy alongside the typed rows built from it.
    const result = gradeBulkQualification('materialiser', measurement({
      peak_rss_bytes: 200 * 1024 * 1024,
      attributed_rss_bytes: 200 * 1024 * 1024,
      decompressed_bytes: 10 * 1024 * 1024,
    }));
    expect(result.status).toBe('passed');
    expect(result.findings.join(' ')).toMatch(/materializes an intermediate copy/);
  });

  test('reports per-row cost so a scale regression is attributable, and never divides by zero', () => {
    expect(gradeBulkQualification('x', measurement({ row_count: 0 })).bytes_retained_per_row).toBeNull();
    const graded = gradeBulkQualification('x', measurement({ row_count: 1000, attributed_rss_bytes: 10_000 }));
    expect(graded.bytes_retained_per_row).toBe(10);
  });
});

describe('measureBulkDecode observes the decode rather than only its result', () => {
  test('captures duration and the described row count, and survives a throwing decode', async () => {
    const { value, measurement: m } = await measureBulkDecode(
      'test',
      () => ({ rows: new Array(1234).fill(0) }),
      { describe: (v) => ({ row_count: v.rows.length, source_bytes: 99 }) },
    );
    expect(value.rows).toHaveLength(1234);
    expect(m.row_count).toBe(1234);
    expect(m.source_bytes).toBe(99);
    expect(m.peak_rss_bytes).toBeGreaterThan(0);

    // The sampling interval must be torn down even when the decode throws, or the process keeps a
    // live timer per failed qualification run.
    await expect(measureBulkDecode('boom', () => { throw new Error('decode failed'); })).rejects.toThrow('decode failed');
  });
});

describe('decoded bundles are cached with a hard bound', () => {
  test('evicts least-recently-used beyond capacity, so 96 Japan chapters cannot accumulate', () => {
    const cache = new BoundedBundleCache<string>(3);
    cache.set('a', 'A'); cache.set('b', 'B'); cache.set('c', 'C');
    expect(cache.size).toBe(3);
    cache.set('d', 'D');
    expect(cache.size).toBe(3);
    expect(cache.get('a')).toBeUndefined(); // oldest evicted
    expect(cache.get('d')).toBe('D');
  });

  test('a read refreshes recency, so the hot chapter is not evicted by a cold one', () => {
    const cache = new BoundedBundleCache<string>(2);
    cache.set('hot', 'H');
    cache.set('cold', 'C');
    expect(cache.get('hot')).toBe('H'); // refresh 'hot'
    cache.set('new', 'N');              // evicts 'cold', not 'hot'
    expect(cache.get('hot')).toBe('H');
    expect(cache.get('cold')).toBeUndefined();
  });

  test('re-setting an existing key updates in place without growing the cache', () => {
    const cache = new BoundedBundleCache<string>(2);
    cache.set('k', 'v1');
    cache.set('k', 'v2');
    expect(cache.size).toBe(1);
    expect(cache.get('k')).toBe('v2');
  });

  test('rejects a nonsensical capacity rather than silently caching nothing or everything', () => {
    expect(() => new BoundedBundleCache(0)).toThrow(/positive integer capacity/);
    expect(() => new BoundedBundleCache(-1)).toThrow(/positive integer capacity/);
    expect(() => new BoundedBundleCache(1.5)).toThrow(/positive integer capacity/);
  });
});
