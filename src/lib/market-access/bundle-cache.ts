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

/**
 * A single process-wide budget shared by every provider's decoded-bundle cache.
 *
 * Per-family caches are each bounded, but their SUM was not — and that is what actually killed a
 * worker. Staging, real archives, exact sequence from the deploy log: eight EU (TARIC) canaries,
 * then Canada, then New Zealand. TARIC's bundle sat in its capacity-1 cache (~150MB retained),
 * Canada's in its own (~80MB), and the NZ decode landed on top of both. The worker OOM'd at
 * `Runtime_AllocateInYoungGeneration` with no `job_finished`. The discriminating test: the same NZ
 * job, enqueued alone against the freshly restarted worker, completed normally.
 *
 * Every family had passed its own ceiling in isolation. Nothing was measuring co-residency, and
 * the gap gets strictly worse with each pack added — which is precisely the scaling question.
 *
 * The budget is expressed in bytes rather than entries because entries differ by more than an
 * order of magnitude (a TARIC bundle retains ~150MB, a Japan chapter ~9MB); an entry count cannot
 * bound the thing that matters. Weights are the measured retained cost per family, declared at the
 * call site, so this stays honest about being an estimate rather than a live measurement — Node
 * cannot cheaply size a retained object graph.
 *
 * 160MB is chosen from the worst case that has to survive, not from what would be convenient: New
 * Zealand's decode peaks at ~660MB on a ~130MB baseline, so roughly 230MB remains under the 1GiB
 * limit before the kernel intervenes. A 160MB cache budget keeps co-resident caches inside that
 * margin. The cost is honest and deliberate: alternating between two large bulk families evicts
 * and re-decodes (~3.5s), which is the right trade against a worker crash that strands a job.
 */
const GLOBAL_BUNDLE_CACHE_BUDGET_BYTES = 160 * 1024 * 1024;

interface GlobalEntry { value: unknown; weight: number }

/** Insertion order is LRU order across ALL families, so eviction is global rather than per-family. */
const globalEntries = new Map<string, GlobalEntry>();
let globalWeight = 0;

function evictToBudget(): void {
  while (globalWeight > GLOBAL_BUNDLE_CACHE_BUDGET_BYTES) {
    const oldest = globalEntries.keys().next();
    if (oldest.done) break;
    const entry = globalEntries.get(oldest.value);
    globalEntries.delete(oldest.value);
    globalWeight -= entry?.weight ?? 0;
  }
  if (globalWeight < 0) globalWeight = 0;
}

/**
 * A per-family view onto the shared budget.
 *
 * Keeps each provider's existing `get`/`set`/`clear` usage unchanged while making eviction a
 * global decision. `weightBytes` is that family's measured retained cost per bundle.
 */
export class SharedBudgetBundleCache<T> {
  constructor(private readonly namespace: string, private readonly weightBytes: number) {
    if (!Number.isFinite(weightBytes) || weightBytes <= 0) {
      throw new Error('A shared-budget bundle cache needs a positive per-entry weight in bytes.');
    }
  }

  private key(key: string) { return `${this.namespace}:${key}`; }

  get(key: string): T | undefined {
    const k = this.key(key);
    const entry = globalEntries.get(k);
    if (!entry) return undefined;
    // Refresh recency across the whole budget, not just within this family.
    globalEntries.delete(k);
    globalEntries.set(k, entry);
    return entry.value as T;
  }

  set(key: string, value: T): void {
    const k = this.key(key);
    const existing = globalEntries.get(k);
    if (existing) { globalEntries.delete(k); globalWeight -= existing.weight; }
    globalEntries.set(k, { value, weight: this.weightBytes });
    globalWeight += this.weightBytes;
    evictToBudget();
  }

  clear(): void {
    for (const k of [...globalEntries.keys()]) {
      if (k.startsWith(`${this.namespace}:`)) {
        globalWeight -= globalEntries.get(k)?.weight ?? 0;
        globalEntries.delete(k);
      }
    }
    if (globalWeight < 0) globalWeight = 0;
  }

  get size(): number {
    let n = 0;
    for (const k of globalEntries.keys()) if (k.startsWith(`${this.namespace}:`)) n += 1;
    return n;
  }
}

/** Test/ops visibility into the shared budget. */
export const __bundleCacheBudget__ = {
  budget_bytes: GLOBAL_BUNDLE_CACHE_BUDGET_BYTES,
  usedBytes: () => globalWeight,
  entryCount: () => globalEntries.size,
  reset: () => { globalEntries.clear(); globalWeight = 0; },
};
