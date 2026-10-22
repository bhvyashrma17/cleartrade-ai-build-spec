/**
 * `buyer_discovery` — real buyers for one exporter, product and market from the market's official
 * importer list (D-033, docs/38 §2). The work is in `runBuyerDiscoveryJob`; this adapts it to the
 * queue. A market with no imported list completes with that reason rather than failing, because a
 * retry would not change the answer.
 */
import type { Prisma } from '@prisma/client';
import { runBuyerDiscoveryJob } from '@/lib/buyer-discovery/service';
import type { ImporterListSourceKey } from '@/lib/buyer-discovery/importer-lists';
import type { JobContext, JobOutcome } from '@/lib/jobs';

export async function runBuyerDiscovery(ctx: JobContext): Promise<JobOutcome> {
  const payload = (ctx.payload ?? {}) as { exporter_org_id?: string; product_id?: string; country_code?: string; hs6?: string; source_key?: ImporterListSourceKey };
  if (!payload.exporter_org_id || !payload.product_id || !payload.country_code || !payload.hs6 || !payload.source_key) {
    throw new Error('buyer_discovery job is missing its exporter, product, market, HS6 or source.');
  }
  await ctx.reportProgress(5);
  const result = await runBuyerDiscoveryJob({ exporter_org_id: payload.exporter_org_id, product_id: payload.product_id, country_code: payload.country_code, hs6: payload.hs6, source_key: payload.source_key }, ctx.correlation_id);
  return { status: 'completed', result: result as unknown as Prisma.InputJsonValue };
}
