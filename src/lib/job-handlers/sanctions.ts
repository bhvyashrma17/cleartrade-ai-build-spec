/** Scheduled ingestion of official sanctions-list snapshots. Entity lists are not country embargoes. */
import { createHash } from 'crypto';
import { IngestStatus, Prisma } from '@prisma/client';
import type { JobContext, JobOutcome } from '@/lib/jobs';
import { prisma } from '@/lib/prisma';
import { normalizeEntityName } from '@/lib/buyer-intelligence';

const SOURCES = [
  { source: 'ofac_sdn', url: 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML', pattern: /<sdnEntry\b/g },
  { source: 'eu_financial_sanctions', url: 'https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList/content', pattern: /<sanctionEntity\b/g },
  { source: 'un_security_council', url: 'https://main.un.org/securitycouncil/sites/default/files/xml/en/consolidated.xml', pattern: /<(?:INDIVIDUAL|ENTITY)>/g },
] as const;

function decodeXml(value: string) { return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim(); }
function entityNames(source: string, xml: string) {
  const names: string[] = [];
  const patterns = source === 'eu_financial_sanctions'
    ? [/\bwholeName="([^"]+)"/g]
    : source === 'un_security_council'
      ? [/<FIRST_NAME>([^<]+)<\/FIRST_NAME>/g]
      : [/<lastName>([^<]+)<\/lastName>/g];
  for (const pattern of patterns) for (const match of xml.matchAll(pattern)) if (match[1]) names.push(decodeXml(match[1]));
  return [...new Set(names)].filter((name) => normalizeEntityName(name).length >= 4);
}

export async function runSanctionsIngest(ctx: JobContext): Promise<JobOutcome> {
  const run = await prisma.sanctionsIngestRun.create({ data: {} });
  const results: Record<string, unknown>[] = [];
  let observed = 0;
  try {
    for (const [index, source] of SOURCES.entries()) {
      try {
        const response = await fetch(source.url, { signal: AbortSignal.timeout(60_000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.text();
        const count = body.match(source.pattern)?.length ?? 0;
        if (count === 0) throw new Error('response contained no recognizable records');
        const checksum = createHash('sha256').update(body).digest('hex');
        const names = entityNames(source.source, body);
        await prisma.$transaction(async (tx) => {
          await tx.sanctionsEntity.updateMany({ where: { source: source.source }, data: { is_active: false } });
          for (const name of names) {
            const sourceRecordId = createHash('sha256').update(`${source.source}:${normalizeEntityName(name)}`).digest('hex');
            await tx.sanctionsEntity.upsert({ where: { source_source_record_id: { source: source.source, source_record_id: sourceRecordId } }, create: { source: source.source, source_record_id: sourceRecordId, name, normalized_name: normalizeEntityName(name), observed_at: new Date() }, update: { name, normalized_name: normalizeEntityName(name), observed_at: new Date(), is_active: true } });
          }
        });
        await prisma.sanctionsSourceSnapshot.upsert({ where: { source: source.source }, create: { source: source.source, source_url: source.url, checksum, record_count: count, metadata: { content_type: response.headers.get('content-type'), etag: response.headers.get('etag') } }, update: { source_url: source.url, checksum, record_count: count, fetched_at: new Date(), metadata: { content_type: response.headers.get('content-type'), etag: response.headers.get('etag') } } });
        observed += count; results.push({ source: source.source, status: 'completed', record_count: count, entities_written: names.length, checksum });
      } catch (error) {
        results.push({ source: source.source, status: 'failed', error: error instanceof Error ? error.message : String(error) });
      }
      await ctx.reportProgress(((index + 1) / SOURCES.length) * 100);
    }
    const failures = results.filter(result => result.status === 'failed');
    const status = failures.length ? (observed ? IngestStatus.partial : IngestStatus.failed) : IngestStatus.completed;
    const entitiesWritten = results.reduce((sum, result) => sum + (typeof result.entities_written === 'number' ? result.entities_written : 0), 0);
    await prisma.sanctionsIngestRun.update({ where: { id: run.id }, data: { status, records_observed: observed, restrictions_written: entitiesWritten, source_results: results as Prisma.InputJsonValue, completed_at: new Date(), error: failures.length ? `${failures.length} source(s) failed.` : null } });
    return { status: failures.length ? (observed ? 'partial' : 'completed') : 'completed', result: { sanctions_ingest_run_id: run.id, records_observed: observed, restrictions_written: entitiesWritten, source_results: results, note: 'Entity-list snapshots do not create country restrictions.' } as Prisma.InputJsonValue };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.sanctionsIngestRun.update({ where: { id: run.id }, data: { status: observed ? IngestStatus.partial : IngestStatus.failed, records_observed: observed, source_results: results as Prisma.InputJsonValue, error: message, completed_at: new Date() } });
    return { status: observed ? 'partial' : 'completed', result: { sanctions_ingest_run_id: run.id, records_observed: observed, error: message } };
  }
}
