import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  BULK_QUALIFICATION_REQUIRED,
  MAX_BULK_DECODES_PER_WORKER,
  requiresBulkQualification,
} from '@/lib/market-access/bulk-release-gate';

/**
 * The gate's *decision* logic and the concurrency invariant it depends on. Deliberately no real
 * archives and no database here — recording and verdict-against-a-live-release are exercised by
 * `scripts/qualify-bulk-release.ts` against staging. What must never regress silently is the
 * reasoning: which families need qualification, and the worker property that makes a single
 * bulk-decode budget sufficient.
 */

describe('which families need real-archive qualification', () => {
  test('bulk-archive families require it; per-chapter page families do not', () => {
    expect(requiresBulkQualification('CA_CBSA')).toBe(true);
    expect(requiresBulkQualification('NZ_CUSTOMS')).toBe(true);
    expect(requiresBulkQualification('EU_TARIC')).toBe(true);
    // Japan and Australia publish small per-chapter pages; their risk is cache accumulation across
    // chapters, which BoundedBundleCache bounds structurally, not a single oversized decode.
    expect(requiresBulkQualification('JP_CUSTOMS')).toBe(false);
    expect(requiresBulkQualification('AU_ABF')).toBe(false);
  });

  test('an unknown family defaults to not-required rather than throwing, but is absent from the table', () => {
    // Defaulting to false keeps a new non-bulk adapter from being blocked by an omission; the
    // table is the explicit record of what has been considered.
    expect(requiresBulkQualification('SOME_FUTURE_FAMILY')).toBe(false);
    expect(Object.keys(BULK_QUALIFICATION_REQUIRED)).not.toContain('SOME_FUTURE_FAMILY');
  });
});

describe('the single-bulk-decode budget matches how the worker actually runs', () => {
  test('the declared policy is one bulk decode per worker process', () => {
    expect(MAX_BULK_DECODES_PER_WORKER).toBe(1);
  });

  /**
   * This is the load-bearing assumption behind the whole memory budget: peak RSS was measured for
   * ONE decode, and that is only a sufficient budget while a worker cannot run two at once.
   *
   * Measured evidence (staging, real archives): two "concurrent" NZ decodes peaked at 598MB versus
   * 597MB for a single decode — they serialised rather than overlapping. Two independent reasons:
   * the worker claims exactly one job and awaits it to completion before looping, and the NZ and
   * Japan readers are synchronous functions that never yield the event loop mid-decode.
   *
   * Rather than add a semaphore for a condition that cannot currently arise (and that could strand
   * jobs if it went wrong), this pins the invariant so that introducing worker concurrency has to
   * consciously confront the bulk-memory question instead of silently invalidating the budget.
   */
  test('the worker claims one job and awaits it before looping — no in-process job concurrency', () => {
    const worker = readFileSync(join(process.cwd(), 'scripts/worker.ts'), 'utf8');
    // One claim per tick, awaited to completion.
    expect(worker).toMatch(/const job = await claimNextJob\(\);/);
    expect(worker).toMatch(/await runClaimedJob\(/);
    // No fan-out of jobs within a tick. If this ever changes, the single-decode memory budget in
    // bulk-operational-qualification.ts stops being sufficient and must be re-derived.
    expect(worker).not.toMatch(/Promise\.all\([^)]*claimNextJob/);
    expect(worker).not.toMatch(/Promise\.all\([^)]*runClaimedJob/);
  });

  test('the bulk readers that dominate memory are synchronous, so they cannot interleave', () => {
    const root = process.cwd();
    const nz = readFileSync(join(root, 'src/lib/market-access/providers/nz-bundle.ts'), 'utf8');
    const jp = readFileSync(join(root, 'src/lib/market-access/providers/japan-bundle.ts'), 'utf8');
    // Synchronous by signature: no `async` on the exported reader, so a decode runs to completion
    // without yielding. This is why two overlapping NZ decodes measured the same as one.
    expect(nz).toMatch(/^export function readNzAuthorityBundle/m);
    expect(jp).toMatch(/^export function readJapanAuthorityBundle/m);
  });
});
