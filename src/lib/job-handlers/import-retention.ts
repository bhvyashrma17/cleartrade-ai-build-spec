import type { JobContext, JobOutcome } from '@/lib/jobs';
import { enforceImportRecordRetention } from '@/lib/import-record-rights';

export async function runImportRecordRetention(ctx: JobContext): Promise<JobOutcome> {
  const payload = ctx.payload as { dry_run?: boolean; now?: string };
  const now = payload.now ? new Date(payload.now) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error('Retention job now must be a valid timestamp.');
  const result = await enforceImportRecordRetention({ now, dryRun: payload.dry_run === true });
  return { status: 'completed', result };
}
