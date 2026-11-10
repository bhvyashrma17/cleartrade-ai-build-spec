/**
 * What a member reads for a discovery run's state (docs/03: plain status copy, never a raw enum).
 * The same words as the run's status chip on the Markets page (`RunProgress` in
 * `src/app/app/markets/DemandDiscovery.tsx`).
 */
import type { JobStatus } from '@prisma/client';

const RUN_STATUS_LABELS: Readonly<Record<JobStatus, string>> = {
  queued: 'Search queued',
  processing: 'Searching markets',
  completed: 'Markets ranked',
  partial: 'Ranked, with gaps',
  failed: 'Search failed',
  cancelled: 'Search cancelled',
};

export function runStatusLabel(status: string): string {
  return RUN_STATUS_LABELS[status as JobStatus] ?? 'Status unknown';
}
