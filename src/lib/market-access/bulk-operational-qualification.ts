/**
 * Operational qualification for BULK / file-based authority adapters.
 *
 * This is deliberately NOT a second tariff-semantics framework. `vendor-qualification.ts` answers
 * "does this adapter represent duties, dates, origins and quotas correctly?" and remains the
 * authority on meaning. This module answers a different question that meaning-level tests cannot
 * reach: "does decoding this authority's REAL archive fit inside the worker we actually run?"
 *
 * The distinction is not academic. The New Zealand pack passed every semantic test and every local
 * gate against small hand-built fixtures, then OOM-killed the staging worker three times on first
 * contact with the real CusMod archive: ~945K rows, ~1.9M `Date` allocations, ~977MB RSS against a
 * 1GB container. Fixture-shaped tests could not have caught it, because the defect was purely a
 * function of scale. This gate exists so that class of failure is caught before deploy rather than
 * by a canary afterwards.
 *
 * ## Why the thresholds are what they are
 *
 * The staging worker (`cleartrade-worker`) runs with a 1GiB memory limit — confirmed from Railway
 * metrics (`MEMORY_LIMIT_GB` = 0.99999744). Three claims on that budget have to coexist:
 *
 *   1. Baseline process footprint. Observed idle worker RSS is ~130MB (Node runtime, Prisma client
 *      and its connection pool, the job loop).
 *   2. The bulk decode itself — what this gate measures.
 *   3. Headroom V8 genuinely needs above steady-state RSS. A mark-compact pass can transiently
 *      hold both old and new copies of what it is moving, so a process sitting near the container
 *      ceiling dies during collection, not during allocation. This is precisely how the NZ crash
 *      presented: the fatal log was a GC trace, not an allocation failure.
 *
 * `PEAK_RSS_CEILING_BYTES` is therefore set at 70% of the container (716MB), leaving ~300MB for GC
 * transients and any concurrently-running job. It is derived from the container budget, not fitted
 * to current adapters: NZ measures ~535MB post-fix and passes at ~75% of the ceiling, which is a
 * real margin rather than a threshold drawn around an observed number. Had the threshold been
 * reverse-engineered to let NZ pass, it would sit just above 535MB and would have admitted the
 * pre-fix 977MB regression's smaller cousins indefinitely.
 *
 * `WARN_RSS_BYTES` (60% of container) is not a failure. It marks an adapter that still fits but
 * has stopped having comfortable room to grow — a source whose archive grows every year will cross
 * the ceiling eventually, and the warning is where that gets noticed.
 *
 * ## What this gate cannot tell you
 *
 * RSS is a process-wide measurement, so a decode's attributed cost includes allocator slack and
 * anything else live at the time. Runs are therefore reported with both absolute peak RSS (what
 * the container's OOM killer actually acts on) and the delta attributable to the decode. Neither
 * is a substitute for the other: the ceiling is enforced on absolute peak because that is what
 * kills the process, while the delta is what tells you whether a regression came from this parser.
 */

/** The staging worker's real memory limit, from Railway `MEMORY_LIMIT_GB`. */
export const WORKER_MEMORY_LIMIT_BYTES = 1024 * 1024 * 1024;

/** 70% of the container: fail above this. See the module comment for the derivation. */
export const PEAK_RSS_CEILING_BYTES = Math.floor(WORKER_MEMORY_LIMIT_BYTES * 0.7);

/** 60% of the container: still passing, but flagged as having lost comfortable headroom. */
export const WARN_RSS_BYTES = Math.floor(WORKER_MEMORY_LIMIT_BYTES * 0.6);

export type BulkQualificationStatus = 'passed' | 'warned' | 'failed';

export interface BulkQualificationMeasurement {
  /** Bytes as fetched from the authority (compressed, if the authority compresses). */
  source_bytes: number;
  /** Bytes after decompression, when the format has a distinct decompressed size. */
  decompressed_bytes: number | null;
  /** Rows/records the reader produced — the scale figure fixtures never exercise. */
  row_count: number;
  /** Absolute process RSS at its highest observed point during the decode. */
  peak_rss_bytes: number;
  /** Peak RSS minus the pre-decode baseline: the cost attributable to this decode. */
  attributed_rss_bytes: number;
  /** Heap retained after the decode returns, sampled post-collection where available. */
  retained_heap_bytes: number;
  duration_ms: number;
}

export interface BulkQualificationResult extends BulkQualificationMeasurement {
  adapter: string;
  status: BulkQualificationStatus;
  /** Peak RSS as a fraction of the worker's real limit, for reporting. */
  worker_memory_fraction: number;
  bytes_retained_per_row: number | null;
  findings: string[];
  ceiling_bytes: number;
  warn_bytes: number;
}

/**
 * Samples RSS while `decode` runs, so a transient spike inside the parser is caught rather than
 * only the quiescent value after it returns. The NZ regression's worst moment was mid-parse.
 */
export async function measureBulkDecode<T>(
  adapter: string,
  decode: () => T | Promise<T>,
  options: { sample_interval_ms?: number; describe?: (value: T) => Pick<BulkQualificationMeasurement, 'row_count'> & Partial<BulkQualificationMeasurement> } = {},
): Promise<{ value: T; measurement: BulkQualificationMeasurement }> {
  const interval = options.sample_interval_ms ?? 25;
  const baseline = process.memoryUsage().rss;
  let peak = baseline;
  const timer = setInterval(() => {
    const rss = process.memoryUsage().rss;
    if (rss > peak) peak = rss;
  }, interval);
  // Keeping the sampler off the ref-count means it can never hold the process open on its own.
  if (typeof timer.unref === 'function') timer.unref();

  const startedAt = Date.now();
  let value: T;
  try {
    value = await decode();
  } finally {
    clearInterval(timer);
  }
  const duration = Date.now() - startedAt;
  const after = process.memoryUsage();
  if (after.rss > peak) peak = after.rss;

  const described = options.describe?.(value);
  return {
    value,
    measurement: {
      source_bytes: described?.source_bytes ?? 0,
      decompressed_bytes: described?.decompressed_bytes ?? null,
      row_count: described?.row_count ?? 0,
      peak_rss_bytes: peak,
      attributed_rss_bytes: Math.max(0, peak - baseline),
      retained_heap_bytes: described?.retained_heap_bytes ?? after.heapUsed,
      duration_ms: duration,
    },
  };
}

/** Applies the container-derived thresholds and explains, in words, what the numbers mean. */
export function gradeBulkQualification(adapter: string, measurement: BulkQualificationMeasurement): BulkQualificationResult {
  const findings: string[] = [];
  let status: BulkQualificationStatus = 'passed';

  if (measurement.peak_rss_bytes > PEAK_RSS_CEILING_BYTES) {
    status = 'failed';
    findings.push(
      `Peak RSS ${mb(measurement.peak_rss_bytes)} exceeds the ${mb(PEAK_RSS_CEILING_BYTES)} ceiling `
      + `(70% of the ${mb(WORKER_MEMORY_LIMIT_BYTES)} worker). A decode this large leaves too little `
      + 'room for GC transients and concurrent jobs, which is how a worker OOMs mid-collection.',
    );
  } else if (measurement.peak_rss_bytes > WARN_RSS_BYTES) {
    status = 'warned';
    findings.push(
      `Peak RSS ${mb(measurement.peak_rss_bytes)} is past the ${mb(WARN_RSS_BYTES)} comfort line but `
      + `within the ${mb(PEAK_RSS_CEILING_BYTES)} ceiling. This adapter still fits, but has little `
      + 'room for source growth.',
    );
  }

  // A decode that retains materially more than its own source is materializing intermediate
  // representations — the exact shape of the pre-fix NZ reader, which held a full string[][] of
  // split cells alongside the typed rows it built from them.
  const source = measurement.decompressed_bytes ?? measurement.source_bytes;
  if (source > 0 && measurement.attributed_rss_bytes > source * 8) {
    findings.push(
      `Decode retained ~${mb(measurement.attributed_rss_bytes)} against a ${mb(source)} source `
      + `(${(measurement.attributed_rss_bytes / source).toFixed(1)}x). That ratio usually means the `
      + 'parser materializes an intermediate copy of the whole source rather than building rows as it walks it.',
    );
  }

  return {
    adapter,
    status,
    ...measurement,
    worker_memory_fraction: measurement.peak_rss_bytes / WORKER_MEMORY_LIMIT_BYTES,
    bytes_retained_per_row: measurement.row_count > 0 ? measurement.attributed_rss_bytes / measurement.row_count : null,
    findings,
    ceiling_bytes: PEAK_RSS_CEILING_BYTES,
    warn_bytes: WARN_RSS_BYTES,
  };
}

function mb(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
}

export function formatBulkQualification(result: BulkQualificationResult): string {
  const lines = [
    `[${result.status.toUpperCase()}] ${result.adapter}`,
    `  source            ${mb(result.source_bytes)}${result.decompressed_bytes ? ` (decompressed ${mb(result.decompressed_bytes)})` : ''}`,
    `  rows              ${result.row_count.toLocaleString()}`,
    `  peak RSS          ${mb(result.peak_rss_bytes)} (${(result.worker_memory_fraction * 100).toFixed(1)}% of worker limit)`,
    `  attributed RSS    ${mb(result.attributed_rss_bytes)}`,
    `  retained heap     ${mb(result.retained_heap_bytes)}`,
    `  bytes/row         ${result.bytes_retained_per_row === null ? 'n/a' : result.bytes_retained_per_row.toFixed(0)}`,
    `  duration          ${result.duration_ms}ms`,
    `  ceiling / warn    ${mb(result.ceiling_bytes)} / ${mb(result.warn_bytes)}`,
  ];
  for (const finding of result.findings) lines.push(`  ! ${finding}`);
  return lines.join('\n');
}
