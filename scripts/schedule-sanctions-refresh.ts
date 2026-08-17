/**
 * Part F3 — the scheduled sanctions refresh tick.
 *
 * Designed to be run by the platform scheduler (cron / container schedule) as often as is
 * convenient — hourly is fine. The tick is NOT the cadence: it asks `dueDatasets()` which
 * datasets have actually elapsed their interval and enqueues only those. Running it more
 * often therefore does not refresh more often, which is what makes it safe to schedule
 * aggressively and what stops the provider being hammered (F8).
 *
 * Three separate mechanisms keep a duplicated or overlapping tick harmless:
 *
 *   1. `dueDatasets()` skips a dataset whose lease is currently held.
 *   2. `enqueueJob` dedupe_key collapses two ticks in the same cadence window into one job.
 *   3. The refresh lease itself is the real mutual exclusion — even if 1 and 2 were both
 *      bypassed, two workers cannot refresh the same dataset concurrently.
 *
 * Prints no secrets, no raw XML and no artifact URLs.
 */

import { JobType } from '@prisma/client';
import { enqueueJob } from '../src/lib/jobs';
import { prisma } from '../src/lib/prisma';
import { datasetSchedules, reclaimExpiredLeases, refreshIntervalHours } from '../src/lib/sanctions/scheduler';
import type { SanctionsSource } from '../src/lib/sanctions/sources';

/** Cadence window identifier — two ticks inside the same window dedupe to one job. */
function windowKey(dataset: SanctionsSource, now: Date): string {
  const hours = refreshIntervalHours(dataset);
  return `${Math.floor(now.getTime() / (hours * 3_600_000))}`;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const now = new Date();

  // A worker that crashed mid-refresh leaves a lease behind; it expires rather than
  // deadlocking the dataset, and this clears the tombstones each tick.
  const reclaimed = await reclaimExpiredLeases(now);
  if (reclaimed > 0) console.log(`Reclaimed ${reclaimed} expired refresh lease(s).`);

  const schedules = await datasetSchedules(now);
  console.log(`Sanctions refresh tick at ${now.toISOString()}${dryRun ? ' (dry run)' : ''}`);
  for (const s of schedules) {
    console.log(
      `  ${s.dataset.padEnd(28)} every ${String(s.interval_hours).padStart(3)}h · last attempt ${
        s.last_attempt_at?.toISOString().slice(0, 16) ?? 'never'
      } · next ${s.next_refresh_at?.toISOString().slice(0, 16) ?? 'now'} · ${
        s.refresh_in_progress ? 'IN PROGRESS' : s.due ? 'DUE' : 'not due'
      }`,
    );
  }

  const due = schedules.filter((s) => s.due && !s.refresh_in_progress).map((s) => s.dataset);
  if (due.length === 0) {
    console.log('Nothing due.');
    return;
  }
  if (dryRun) {
    console.log(`Would enqueue: ${due.join(', ')}`);
    return;
  }

  for (const dataset of due) {
    try {
      const job = await enqueueJob({
        type: JobType.sanctions_ingest,
        payload: { datasets: [dataset], scheduled_at: now.toISOString() },
        dedupe_key: `sanctions_refresh:${dataset}:${windowKey(dataset, now)}`,
      });
      console.log(`  enqueued ${dataset} → job ${job.id}`);
    } catch (error) {
      // JOB_ALREADY_RUNNING is the dedupe working, not a failure.
      console.log(`  ${dataset}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
