import { createHash, createHmac } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { IngestStatus, Prisma, TradeDataSource } from '@prisma/client';
import { z } from 'zod';
import { assertImportRecordUse } from '@/lib/import-record-rights';
import type { JobContext, JobOutcome } from '@/lib/jobs';
import { prisma } from '@/lib/prisma';

const licenseSchema = z.object({
  source_provider: z.string().min(1), license_type: z.string().min(1),
  allowed_to_display: z.boolean(), allowed_to_export: z.boolean(), allowed_to_cache: z.boolean(),
  retention_limit: z.string().datetime().nullable(), personal_data_flag: z.boolean(),
  retrieved_at: z.string().datetime(), scope: z.literal('us_inward_vessel_manifest'),
}).strict();
const rowSchema = z.object({
  source_record_id: z.string().min(1), buyer_ref: z.string().min(1).nullable().optional(),
  raw_consignee_string: z.string().min(1).nullable().optional(), hs_code: z.string().regex(/^\d{6}$/).nullable().optional(),
  country: z.literal('US').default('US'), shipment_date: z.string().datetime(),
  value: z.union([z.string(), z.number()]).nullable().optional(), value_currency: z.string().length(3).nullable().optional(), quantity: z.union([z.string(), z.number()]).nullable().optional(),
  quantity_unit: z.string().min(1).nullable().optional(),
  origin_country: z.string().length(2).nullable().optional(), port: z.string().nullable().optional(),
  shipper_name: z.string().nullable().optional(),
}).strict();

interface Payload { file_path: string; license_file_path: string; ingest_run_id?: string; batch_size?: number; record_budget?: number }
type Progress = { file_path: string; license_sha256: string; next_line: number };

async function countDataLines(path: string) {
  let count = 0;
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) if (line.trim()) count++;
  return count;
}

export async function runCbpManifestIngest(ctx: JobContext): Promise<JobOutcome> {
  const payload = ctx.payload as unknown as Payload;
  if (!payload?.file_path || !payload.license_file_path) throw new Error('CBP ingest requires file_path and license_file_path.');
  const licenseBytes = await readFile(payload.license_file_path);
  const license = licenseSchema.parse(JSON.parse(licenseBytes.toString('utf8')));
  const retention = license.retention_limit ? new Date(license.retention_limit) : null;
  assertImportRecordUse({ ...license, retention_limit: retention }, 'cache');
  const licenseHash = createHash('sha256').update(licenseBytes).digest('hex');
  const total = await countDataLines(payload.file_path);
  let run = payload.ingest_run_id ? await prisma.ingestRun.findUnique({ where: { id: payload.ingest_run_id } }) : null;
  if (run?.status === IngestStatus.completed) throw new Error(`IngestRun ${run.id} is already complete.`);
  let progress = run?.progress as Progress | null;
  if (progress && (progress.file_path !== payload.file_path || progress.license_sha256 !== licenseHash)) {
    throw new Error('Resume input or licensing metadata differs from the original ingest run.');
  }
  progress ??= { file_path: payload.file_path, license_sha256: licenseHash, next_line: 0 };
  run = run
    ? await prisma.ingestRun.update({ where: { id: run.id }, data: { status: IngestStatus.running, error: null, completed_at: null } })
    : await prisma.ingestRun.create({ data: { source: TradeDataSource.cbp_vessel_manifest, status: IngestStatus.running, params: { file_path: payload.file_path, license_file_path: payload.license_file_path }, records_total: total, progress } });
  const secret = process.env.IMPORT_BUYER_REF_SECRET;
  const batchSize = Math.max(1, Math.min(payload.batch_size ?? 250, 1000));
  const budget = payload.record_budget == null ? Infinity : Math.max(0, payload.record_budget);
  let lineIndex = 0, processedThisInvocation = 0, written = run.records_written;
  let batch: Array<z.infer<typeof rowSchema>> = [];

  const flush = async () => {
    if (!batch.length) return;
    await prisma.$transaction(batch.map((row) => {
      if (row.raw_consignee_string && !row.buyer_ref && !secret) throw new Error('IMPORT_BUYER_REF_SECRET is required to pseudonymize consignee names.');
      const buyerRef = row.buyer_ref ?? (row.raw_consignee_string ? createHmac('sha256', secret!).update(row.raw_consignee_string.trim().toUpperCase()).digest('hex') : null);
      const data = {
        buyer_ref: buyerRef, raw_consignee_string: row.raw_consignee_string ?? null, hs_code: row.hs_code ?? null,
        country: row.country, shipment_date: new Date(row.shipment_date), value: row.value == null ? null : new Prisma.Decimal(row.value), value_currency: row.value_currency?.toUpperCase() ?? null,
        quantity: row.quantity == null || new Prisma.Decimal(row.quantity).lte(0) ? null : new Prisma.Decimal(row.quantity),
        quantity_unit: row.quantity == null || new Prisma.Decimal(row.quantity).lte(0) ? null : row.quantity_unit ?? null,
        origin_country: row.origin_country?.toUpperCase() ?? null, port: row.port ?? null, shipper_name: row.shipper_name ?? null,
        source: TradeDataSource.cbp_vessel_manifest, retrieved_at: new Date(license.retrieved_at),
        source_provider: license.source_provider, license_type: license.license_type,
        allowed_to_display: license.allowed_to_display, allowed_to_export: license.allowed_to_export,
        allowed_to_cache: license.allowed_to_cache, retention_limit: retention, personal_data_flag: license.personal_data_flag,
      };
      return prisma.importRecord.upsert({ where: { source_record_id: row.source_record_id }, create: { source_record_id: row.source_record_id, ...data }, update: data });
    }));
    written += batch.length;
    batch = [];
    progress!.next_line = lineIndex;
    await prisma.ingestRun.update({ where: { id: run!.id }, data: { records_written: written, records_processed: lineIndex, progress } });
    void ctx.reportProgress(total ? (lineIndex / total) * 100 : 100).catch(() => undefined);
  };

  try {
    const lines = createInterface({ input: createReadStream(payload.file_path), crlfDelay: Infinity });
    for await (const text of lines) {
      if (!text.trim()) continue;
      lineIndex++;
      if (lineIndex <= progress.next_line) continue;
      if (processedThisInvocation >= budget) break;
      batch.push(rowSchema.parse(JSON.parse(text)));
      processedThisInvocation++;
      if (batch.length >= batchSize) await flush();
    }
    await flush();
    const complete = progress.next_line >= total;
    await prisma.ingestRun.update({ where: { id: run.id }, data: { status: complete ? IngestStatus.completed : IngestStatus.partial, completed_at: complete ? new Date() : null } });
    return { status: complete ? 'completed' : 'partial', result: { ingest_run_id: run.id, records_written: written, records_processed: progress.next_line, records_total: total } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.ingestRun.update({ where: { id: run.id }, data: { status: progress.next_line ? IngestStatus.partial : IngestStatus.failed, error: message.slice(0, 1000) } });
    return { status: progress.next_line ? 'partial' : 'completed', result: { ingest_run_id: run.id, records_written: written, error: message } };
  }
}
