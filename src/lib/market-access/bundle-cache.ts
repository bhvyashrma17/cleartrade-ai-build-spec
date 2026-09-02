/**
 * A bounded, least-recently-used cache for decoded authority-release bundles.
 *
 * Every file/bulk provider decodes a retained artifact into an in-memory bundle and caches it by
 * release checksum, because re-decoding a multi-megabyte archive on every HS6 query would be
 * wasteful. Canada, New Zealand and Japan each grew an identical plain `Map` for this, with no
 * eviction — which is safe only while a source has one active release at a time.
 *
 * Japan breaks that assumption. It publishes one release per (date, chapter) pair, so a worker
 * serving queries across the full 96-chapter schedule would retain 96 decoded bundles. Measured
 * against the real August 2026 schedule, a decoded chapter costs roughly 9MB of RSS, so an
 * unbounded cache trends to ~860MB on top of a ~130MB baseline — at the 1GB staging worker's
 * limit, i.e. the same class of failure as the NZ bulk-parse OOM, arriving later and by a
 * different route. A capacity bound is the fix; the LRU ordering keeps the hot chapters resident.
 *
 * The bound is deliberately a count of bundles rather than a byte budget: bundle sizes here are
 * within one order of magnitude of each other, and a count is something a caller can reason about
 * without the cache having to measure retained object graphs (which Node cannot do cheaply or
 * accurately). Callers pick a capacity from their own source shape — see each service's call.
 */
export class BoundedBundleCache<T> {
  /** Insertion order is the LRU order: `Map` preserves it, and a re-set moves an entry to the end. */
  private readonly entries = new Map<string, T>();

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('A bundle cache needs a positive integer capacity.');
    }
  }

  get(key: string): T | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    // Refresh recency: delete + re-set moves this key to the newest position.
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: T): void {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
