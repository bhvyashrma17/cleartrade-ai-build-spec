import type { JobContext, JobOutcome } from '@/lib/jobs';
import { runBuyerIntelligence } from '@/lib/buyer-intelligence';

export async function runBuyerIntelligenceJob(ctx: JobContext): Promise<JobOutcome> {
  const payload = ctx.payload as { exporter_org_id?: string; product_id?: string };
  if (!payload.exporter_org_id || !payload.product_id) throw new Error('buyer_intelligence requires exporter_org_id and product_id.');
  await ctx.reportProgress(5);
  const result = await runBuyerIntelligence({ exporter_org_id: payload.exporter_org_id, product_id: payload.product_id });
  await ctx.reportProgress(100);
  return { status: 'completed', result };
}
