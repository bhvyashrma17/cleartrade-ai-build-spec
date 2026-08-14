/**
 * `comtrade_ingest` job — batch warehouse ingest of one HS chapter of Comtrade trade
 * flows. Scheduled/manual only (`scripts/ingest-comtrade.ts`); nothing in a user's
 * discovery run ever enqueues this.
 *
 * Two status axes, deliberately decoupled (see the comment on `IngestRun` in
 * `prisma/schema.prisma`): a Comtrade-side failure (rate limit exhausted, bad response)
 * is caught here and written to `IngestRun.status`/`error` — it never throws, so the JOB
 * itself always finishes in a success state. Only a genuinely unexpected failure (cannot
 * even write the `IngestRun` row) should throw and go through the job system's own
 * attempt/retry machinery like every other handler.
 *
 * Idempotent per `(reporter, partner, hs_code, year, source)`: each row is `upsert`ed on
 * that compound key, so rerunning the same ingest updates rows in place rather than
 * duplicating them.
 */

import { IngestStatus, Prisma, TradeDataSource } from '@prisma/client';
import { ComtradeRateLimitError, getComtradeClient } from '@/lib/comtrade';
import type { FlowDirection } from '@/lib/comtrade';
import { getConfig } from '@/lib/config';
import type { JobContext, JobOutcome } from '@/lib/jobs';
import { prisma } from '@/lib/prisma';

interface ComtradeIngestPayload {
  hs_chapter: string;
  reporter?: string;
  partner?: string;
  year?: number;
  flow_direction?: FlowDirection;
  ingest_run_id?: string;
}

/** India, per Comtrade's numeric reporter code — this platform's default reporter. */
const DEFAULT_REPORTER = '699';
/** World, per Comtrade's numeric partner code — aggregate demand across all partners. */
const DEFAULT_PARTNER = '0';

export async function runComtradeIngest(ctx: JobContext): Promise<JobOutcome> {
  const payload = ctx.payload as unknown as ComtradeIngestPayload;
  if (!payload?.hs_chapter) throw new Error('comtrade_ingest job has no hs_chapter parameter.');

  const params = {
    hs_chapter: payload.hs_chapter,
    reporter: payload.reporter ?? DEFAULT_REPORTER,
    partner: payload.partner ?? DEFAULT_PARTNER,
    // Comtrade's current year is typically incomplete; default to the prior one.
    year: payload.year ?? new Date().getFullYear() - 1,
    flow_direction: payload.flow_direction ?? 'export',
  };

  let ingestRun = payload.ingest_run_id ? await prisma.ingestRun.findUnique({ where: { id: payload.ingest_run_id } }) : null;
  if (ingestRun?.status === IngestStatus.completed) throw new Error(`IngestRun ${ingestRun.id} is already complete.`);
  let recordsWritten = ingestRun?.records_written ?? 0;
  try {
    const policy = await getConfig('comtrade.policy');
    const client = getComtradeClient(policy);
    let progress = ingestRun?.progress as { hs_codes?: string[]; next_index?: number } | null;
    if (!progress?.hs_codes) {
      const resolution = await client.resolveChapter(params.hs_chapter);
      progress = { hs_codes: resolution.hs_codes, next_index: 0 };
      ingestRun = await prisma.ingestRun.create({ data: { source: TradeDataSource.comtrade, status: IngestStatus.running, params: params as unknown as Prisma.InputJsonValue, total_codes: resolution.hs_codes.length, progress: progress as unknown as Prisma.InputJsonValue } });
    } else {
      ingestRun = await prisma.ingestRun.update({ where: { id: ingestRun!.id }, data: { status: IngestStatus.running, error: null, retry_after: null } });
    }
    const codes = progress.hs_codes!;
    let nextIndex = progress.next_index ?? 0;
    let requestsThisInvocation = 0;
    while (nextIndex < codes.length) {
      if (requestsThisInvocation >= (policy.daily_request_budget ?? 450)) {
        const retryAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await prisma.ingestRun.update({ where: { id: ingestRun.id }, data: { status: IngestStatus.throttled, retry_after: retryAt, completed_codes: nextIndex, progress: { hs_codes: codes, next_index: nextIndex }, error: 'Local daily Comtrade request budget reached; resume after retry_after.' } });
        return { status: 'partial', result: { ingest_run_id: ingestRun.id, records_written: recordsWritten, throttled: true, retry_after: retryAt.toISOString(), ...params } };
      }
      if (requestsThisInvocation > 0 && policy.request_delay_ms > 0) await new Promise((resolve) => setTimeout(resolve, policy.request_delay_ms));
      const hsCodes = codes.slice(nextIndex, nextIndex + (policy.hs_codes_per_request ?? 50));
      let fetched;
      try { fetched = await client.fetchChapter({ ...params, hs_codes: hsCodes }); }
      catch (error) {
        if (error instanceof ComtradeRateLimitError) {
          const retryAt = new Date(Date.now() + (error.retryAfterMs ?? 24 * 60 * 60 * 1000));
          await prisma.ingestRun.update({ where: { id: ingestRun.id }, data: { status: IngestStatus.throttled, throttle_count: { increment: 1 }, last_throttled_at: new Date(), retry_after: retryAt, completed_codes: nextIndex, progress: { hs_codes: codes, next_index: nextIndex }, error: error.message } });
          return { status: 'partial', result: { ingest_run_id: ingestRun.id, records_written: recordsWritten, throttled: true, retry_after: retryAt.toISOString(), ...params } };
        }
        throw error;
      }
      requestsThisInvocation += fetched.request_count;
      for (const row of fetched.rows) {
      const quantity = row.quantity != null && row.quantity !== 0 ? row.quantity : null;
      const unitValue = quantity != null ? row.value / quantity : null;

      await prisma.tradeFlow.upsert({
        where: {
          reporter_partner_hs_code_year_source: {
            reporter: row.reporter,
            partner: row.partner,
            hs_code: row.hs_code,
            year: row.year,
            source: TradeDataSource.comtrade,
          },
        },
        create: {
          reporter: row.reporter,
          partner: row.partner,
          hs_code: row.hs_code,
          year: row.year,
          period: row.period,
          value: new Prisma.Decimal(row.value),
          quantity: quantity != null ? new Prisma.Decimal(quantity) : null,
          unit: row.unit,
          unit_value: unitValue != null ? new Prisma.Decimal(unitValue) : null,
          flow_direction: params.flow_direction,
          source: TradeDataSource.comtrade,
        },
        update: {
          period: row.period,
          value: new Prisma.Decimal(row.value),
          quantity: quantity != null ? new Prisma.Decimal(quantity) : null,
          unit: row.unit,
          unit_value: unitValue != null ? new Prisma.Decimal(unitValue) : null,
          flow_direction: params.flow_direction,
          ingested_at: new Date(),
        },
      });
      recordsWritten++;
      }
      nextIndex += hsCodes.length;
      await prisma.ingestRun.update({ where: { id: ingestRun.id }, data: { records_written: recordsWritten, completed_codes: nextIndex, request_count: { increment: fetched.request_count }, progress: { hs_codes: codes, next_index: nextIndex } } });
      void ctx.reportProgress((nextIndex / codes.length) * 100).catch(() => undefined);
    }

    await prisma.ingestRun.update({
      where: { id: ingestRun.id },
      data: { status: IngestStatus.completed, records_written: recordsWritten, completed_codes: codes.length, completed_at: new Date(), retry_after: null },
    });

    return {
      status: 'completed',
      result: { ingest_run_id: ingestRun.id, records_written: recordsWritten, ...params },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = recordsWritten > 0 ? IngestStatus.partial : IngestStatus.failed;

    if (!ingestRun) throw error;
    await prisma.ingestRun.update({
      where: { id: ingestRun.id },
      data: { status, records_written: recordsWritten, error: message.slice(0, 1000), completed_at: new Date() },
    });

    // Never throw for a business-logic failure — the failure is fully recorded on
    // IngestRun above. The job still completes (or partially completes) successfully.
    return {
      status: recordsWritten > 0 ? 'partial' : 'completed',
      result: { ingest_run_id: ingestRun.id, records_written: recordsWritten, error: message, ...params },
    };
  }
}
