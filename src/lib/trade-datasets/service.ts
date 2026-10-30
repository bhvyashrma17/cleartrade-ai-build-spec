/**
 * Import and read retained trade dataset releases (docs/36 §3.1).
 *
 * The import follows the retained-release discipline already used for customs authority packs:
 * the operator states the archive's sha256 up front, the archive is parsed strictly, every
 * partition is stored with its own checksum, and a second import of the same bytes resolves to
 * UNCHANGED. A failed import leaves a `failed` release with its reason; it never leaves a
 * half-written `ready` one.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { EvidenceOrigin, Prisma, TradeDatasetReleaseStatus, UserRole } from '@prisma/client';
import { writeAuditEvent } from '@/lib/audit';
import { getDocumentStorage, type DocumentStorage } from '@/lib/document-storage';
import { forbidden, notFound, validationError } from '@/lib/errors';
import { appEnvironment } from '@/lib/evidence-environment';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';
import {
  BACI_LICENCE, BACI_PARSER_VERSION, BACI_PROVIDER, BaciFormatError, assertBaciDataHeader, classifyBaciMember,
  countBaciProducts, parseBaciDataLine, readBaciCountryFile, type BaciCountry, type BaciFlow, type BaciHsRevision, type BaciMember,
} from './baci';
import { readLines, readPartitionFlows, rawValueTokens, YearPartitionWriter, type EncodedPartition } from './partitions';
import { listZipEntries, openZipEntry, ZIP_READER_VERSION, type ZipEntry } from './zip-reader';

export const TRADE_DATASET_IMPORT_PRINCIPALS: readonly UserRole[] = [UserRole.ops_supervisor, UserRole.admin];

export interface ImportTradeDatasetArgs {
  actor: Principal;
  file_path: string;
  expect_sha256: string;
  provider: typeof BACI_PROVIDER;
  dataset_version: string;
  hs_revision: BaciHsRevision;
  source_url: string;
  retrieved_at: Date;
  correlation_id: string;
  evidence_origin?: EvidenceOrigin;
  storage?: DocumentStorage;
  /** Progress lines for the operator's terminal; never contains data values. */
  log?: (message: string) => void;
}

export type ImportTradeDatasetResult =
  | { change: 'NEW'; release_id: string; partition_count: number; row_count: number }
  | { change: 'UNCHANGED'; release_id: string; partition_count: number; row_count: number };

function assertImporter(actor: Principal) {
  if (!TRADE_DATASET_IMPORT_PRINCIPALS.includes(actor.role)) {
    throw forbidden('Only ClearTrade operations staff can import a trade dataset release.');
  }
}

async function fileSha256(path: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
    bytes += (chunk as Buffer).length;
  }
  return { sha256: hash.digest('hex'), bytes };
}

async function readMemberText(path: string, entry: ZipEntry, limitBytes = 64 * 1024 * 1024): Promise<string> {
  if (entry.uncompressedSize > limitBytes) throw new BaciFormatError(`${entry.name} is ${entry.uncompressedSize} bytes; reference members are read whole only up to ${limitBytes}.`);
  const chunks: Buffer[] = [];
  for await (const chunk of await openZipEntry(path, entry)) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function manifestSha256(partitions: readonly { year: number; hs_chapter: string; sha256: string; row_count: number }[]) {
  const lines = [...partitions]
    .sort((a, b) => a.year - b.year || a.hs_chapter.localeCompare(b.hs_chapter))
    .map((partition) => `${partition.year}/${partition.hs_chapter}:${partition.sha256}:${partition.row_count}`);
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

function objectKey(args: { provider: string; version: string; revision: string; archive_sha256: string; year: number; chapter: string }) {
  return `trade-datasets/${args.provider}/${args.version}/${args.revision}/${args.archive_sha256.slice(0, 16)}/${args.year}/${args.chapter}.csv.gz`;
}

interface PlannedArchive {
  data: Extract<BaciMember, { kind: 'data' }>[];
  countries: Extract<BaciMember, { kind: 'countries' }>;
  products: Extract<BaciMember, { kind: 'products' }> | null;
  other: string[];
}

function planArchive(entries: ZipEntry[], args: ImportTradeDatasetArgs): PlannedArchive {
  const members = entries.filter((entry) => !entry.name.endsWith('/')).map((entry) => classifyBaciMember(entry.name));
  const data = members.filter((member): member is Extract<BaciMember, { kind: 'data' }> => member.kind === 'data');
  const countries = members.filter((member): member is Extract<BaciMember, { kind: 'countries' }> => member.kind === 'countries');
  const products = members.filter((member): member is Extract<BaciMember, { kind: 'products' }> => member.kind === 'products');
  if (!data.length) throw new BaciFormatError('The archive holds no BACI data files.');
  const wrong = data.filter((member) => member.hs_revision !== args.hs_revision || member.version !== args.dataset_version);
  if (wrong.length) throw new BaciFormatError(`Data files ${wrong.map((member) => member.name).join(', ')} are not ${args.hs_revision} ${args.dataset_version}.`);
  const years = data.map((member) => member.year);
  if (new Set(years).size !== years.length) throw new BaciFormatError('The archive holds two data files for the same year.');
  if (countries.length !== 1 || countries[0].version !== args.dataset_version) {
    throw new BaciFormatError(`Expected exactly one country_codes file for ${args.dataset_version}; found ${countries.length}.`);
  }
  const matchingProducts = products.filter((member) => member.hs_revision === args.hs_revision && member.version === args.dataset_version);
  return {
    data: [...data].sort((a, b) => a.year - b.year),
    countries: countries[0],
    products: matchingProducts[0] ?? null,
    other: members.filter((member) => member.kind === 'other').map((member) => member.name),
  };
}

/** Validate, partition, retain and record one BACI archive. */
export async function importTradeDatasetRelease(args: ImportTradeDatasetArgs): Promise<ImportTradeDatasetResult> {
  assertImporter(args.actor);
  const log = args.log ?? (() => undefined);
  if (args.provider !== BACI_PROVIDER) throw validationError([{ field: 'provider', code: 'unsupported', message: `Unsupported trade dataset provider ${args.provider}.` }], `Unsupported trade dataset provider ${args.provider}.`);
  if (!/^V\d{6}$/.test(args.dataset_version)) throw validationError([{ field: 'dataset_version', code: 'invalid', message: 'BACI versions look like V202601.' }], 'BACI versions look like V202601.');
  const expected = args.expect_sha256.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) throw validationError([{ field: 'expect_sha256', code: 'invalid', message: 'The expected sha256 must be 64 hex characters.' }], 'The expected sha256 must be 64 hex characters.');

  const { sha256, bytes } = await fileSha256(args.file_path);
  if (sha256 !== expected) {
    throw validationError([{ field: 'expect_sha256', code: 'mismatch', message: `The archive's sha256 is ${sha256}, not the expected ${expected}. A different file is a different subject.` }], `The archive's sha256 is ${sha256}, not the expected ${expected}. A different file is a different subject.`);
  }
  const environment = appEnvironment();
  const identity = { provider: args.provider, dataset_version: args.dataset_version, hs_revision: args.hs_revision, archive_sha256: sha256, environment };

  const existing = await prisma.tradeDatasetRelease.findFirst({ where: { ...identity, status: { in: [TradeDatasetReleaseStatus.ready, TradeDatasetReleaseStatus.importing] } } });
  if (existing?.status === TradeDatasetReleaseStatus.importing) {
    throw validationError([{ field: 'release', code: 'in_progress', message: `Release ${existing.id} is still marked importing. Investigate, then mark it failed before retrying.` }], `Release ${existing.id} is still marked importing. Investigate, then mark it failed before retrying.`);
  }
  if (existing) {
    await writeAuditEvent({
      actor: args.actor, action: 'acquisition_unchanged', object_type: 'trade_dataset_release', object_id: existing.id,
      after_summary: { change_classification: 'UNCHANGED', ...identity }, correlation_id: args.correlation_id,
    });
    return { change: 'UNCHANGED', release_id: existing.id, partition_count: existing.partition_count, row_count: Number(existing.row_count) };
  }

  const entries = await listZipEntries(args.file_path);
  const plan = planArchive(entries, args);
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const release = await prisma.tradeDatasetRelease.create({
    data: {
      ...identity,
      first_year: plan.data[0].year,
      last_year: plan.data[plan.data.length - 1].year,
      source_url: args.source_url,
      licence: BACI_LICENCE,
      archive_bytes: BigInt(bytes),
      retrieved_at: args.retrieved_at,
      reader_version: ZIP_READER_VERSION,
      parser_version: BACI_PARSER_VERSION,
      evidence_origin: args.evidence_origin ?? EvidenceOrigin.imported_real,
      imported_by_id: args.actor.id,
      correlation_id: args.correlation_id,
    },
  });
  log(`release ${release.id}: ${plan.data.length} year files, ${entries.length} members`);

  try {
    const countryFile = readBaciCountryFile(await readMemberText(args.file_path, byName.get(plan.countries.name)!), plan.countries.name);
    const countries = countryFile.countries;
    const known = new Set(countries.map((country) => country.provider_code));
    if (!countries.some((country) => country.iso2 === 'IN')) throw new BaciFormatError('The country file has no India (ISO IN) entry.');
    const productCount = plan.products ? countBaciProducts(await readMemberText(args.file_path, byName.get(plan.products.name)!), plan.products.name) : null;

    const storage = args.storage ?? getDocumentStorage();
    const stored: (EncodedPartition & { object_key: string })[] = [];
    let rowCount = 0;
    for (const member of plan.data) {
      const writer = new YearPartitionWriter(member.year);
      let lineNumber = 0;
      let rows = 0;
      for await (const line of readLines(await openZipEntry(args.file_path, byName.get(member.name)!))) {
        lineNumber += 1;
        if (lineNumber === 1) { assertBaciDataHeader(line, member.name); continue; }
        if (!line.trim()) continue;
        const context = `${member.name} line ${lineNumber}`;
        const flow = parseBaciDataLine(line, context, member.year);
        if (!known.has(flow.exporter) || !known.has(flow.importer)) throw new BaciFormatError(`${context}: country code ${known.has(flow.exporter) ? flow.importer : flow.exporter} is not in the archive's country file.`);
        const raw = rawValueTokens(line);
        await writer.add(flow, raw.value, raw.quantity);
        rows += 1;
      }
      if (!rows) throw new BaciFormatError(`${member.name} holds no rows.`);
      for (const partition of await writer.finish()) {
        const key = objectKey({ provider: args.provider, version: args.dataset_version, revision: args.hs_revision, archive_sha256: sha256, year: partition.year, chapter: partition.hs_chapter });
        await storage.put({ bytes: partition.bytes, contentType: 'application/gzip', sha256: partition.sha256, objectKey: key });
        stored.push({ ...partition, object_key: key });
      }
      rowCount += rows;
      log(`  ${member.year}: ${rows} rows`);
    }

    const manifest = manifestSha256(stored);
    await prisma.$transaction(async (tx) => {
      await tx.tradeDatasetCountry.createMany({ data: countries.map((country: BaciCountry) => ({ release_id: release.id, ...country })) });
      await tx.tradeDatasetPartition.createMany({
        data: stored.map((partition) => ({
          release_id: release.id, year: partition.year, hs_chapter: partition.hs_chapter, object_key: partition.object_key,
          sha256: partition.sha256, bytes: partition.bytes.length, row_count: partition.row_count,
          value_sum: new Prisma.Decimal(partition.value_sum_thousandths).div(1000),
        })),
      });
      await tx.tradeDatasetRelease.update({
        where: { id: release.id },
        data: {
          status: TradeDatasetReleaseStatus.ready,
          row_count: BigInt(rowCount),
          partition_count: stored.length,
          manifest_sha256: manifest,
          completed_at: new Date(),
          validation: {
            members: entries.map((entry) => ({ name: entry.name, bytes: entry.uncompressedSize })),
            years: plan.data.map((member) => member.year),
            country_count: countries.length,
            iso2_from_iso3: countryFile.iso2_from_iso3,
            product_count: productCount,
            unrecognised_members: plan.other,
          },
        },
      });
      await writeAuditEvent({
        actor: args.actor, action: 'trade_dataset_release_imported', object_type: 'trade_dataset_release', object_id: release.id,
        after_summary: { change_classification: 'NEW', ...identity, row_count: rowCount, partition_count: stored.length, manifest_sha256: manifest },
        correlation_id: args.correlation_id, db: tx,
      });
    });
    return { change: 'NEW', release_id: release.id, partition_count: stored.length, row_count: rowCount };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await prisma.tradeDatasetRelease.update({ where: { id: release.id }, data: { status: TradeDatasetReleaseStatus.failed, validation: { error: reason.slice(0, 2000) } } });
    await writeAuditEvent({
      actor: args.actor, action: 'trade_dataset_release_failed', object_type: 'trade_dataset_release', object_id: release.id,
      after_summary: { ...identity, error: reason.slice(0, 500) }, correlation_id: args.correlation_id,
    });
    throw error;
  }
}

/** Marks an import that died mid-way as failed so the archive can be imported again. */
export async function abandonTradeDatasetImport(args: { actor: Principal; release_id: string; reason: string; correlation_id: string }) {
  assertImporter(args.actor);
  const release = await prisma.tradeDatasetRelease.findUnique({ where: { id: args.release_id } });
  if (!release) throw notFound('That trade dataset release does not exist.');
  if (release.status !== TradeDatasetReleaseStatus.importing) throw validationError([{ field: 'release', code: 'not_importing', message: `Release ${release.id} is ${release.status}, not importing.` }], `Release ${release.id} is ${release.status}, not importing.`);
  await prisma.tradeDatasetRelease.update({ where: { id: release.id }, data: { status: TradeDatasetReleaseStatus.failed, validation: { error: `Abandoned by operator: ${args.reason}`.slice(0, 2000) } } });
  await writeAuditEvent({
    actor: args.actor, action: 'trade_dataset_release_failed', object_type: 'trade_dataset_release', object_id: release.id,
    after_summary: { abandoned: true, reason: args.reason.slice(0, 500) }, correlation_id: args.correlation_id,
  });
}

/** The newest ready release for a provider and HS revision in this environment. */
export function latestReadyTradeDatasetRelease(provider: string, hsRevision: BaciHsRevision) {
  return prisma.tradeDatasetRelease.findFirst({
    where: { provider, hs_revision: hsRevision, environment: appEnvironment(), status: TradeDatasetReleaseStatus.ready },
    orderBy: [{ last_year: 'desc' }, { dataset_version: 'desc' }, { completed_at: 'desc' }],
  });
}

export interface ProductFlowRead {
  release_id: string;
  hs_revision: string;
  flows: BaciFlow[];
  /** The partitions read, with the checksums verified, for the run's provenance. */
  partitions: { year: number; hs_chapter: string; sha256: string; object_key: string }[];
  /** Years asked for that the release has no partition for in this chapter (no trade in it at all). */
  years_without_partition: number[];
}

/** Reads every flow of one HS6 product from a ready release, verifying each partition's checksum. */
/**
 * `db` lets a caller read the release and its partitions inside its own transaction — the Phase 1 gate
 * reads them in its read-only snapshot. The partition bytes themselves are checked against their SHA-256.
 */
export async function readProductFlows(args: { release_id: string; hs6: string; years?: readonly number[]; storage?: DocumentStorage; db?: Pick<Prisma.TransactionClient, 'tradeDatasetRelease' | 'tradeDatasetPartition'> }): Promise<ProductFlowRead> {
  if (!/^\d{6}$/.test(args.hs6)) throw validationError([{ field: 'hs6', code: 'invalid', message: 'A six-digit HS code is required.' }], 'A six-digit HS code is required.');
  const db = args.db ?? prisma;
  const release = await db.tradeDatasetRelease.findUnique({ where: { id: args.release_id } });
  if (!release || release.status !== TradeDatasetReleaseStatus.ready) throw notFound('No ready trade dataset release with that id.');
  const years = args.years ? [...new Set(args.years)].sort() : null;
  const partitions = await db.tradeDatasetPartition.findMany({
    where: { release_id: release.id, hs_chapter: args.hs6.slice(0, 2), ...(years ? { year: { in: years } } : {}) },
    orderBy: { year: 'asc' },
  });
  const storage = args.storage ?? getDocumentStorage();
  const flows: BaciFlow[] = [];
  for (const partition of partitions) {
    const bytes = await storage.get(partition.object_key);
    flows.push(...readPartitionFlows({ bytes, expected_sha256: partition.sha256, year: partition.year, hs6: args.hs6, label: `${release.id}/${partition.year}/${partition.hs_chapter}` }));
  }
  const requested = years ?? Array.from({ length: release.last_year - release.first_year + 1 }, (_, index) => release.first_year + index);
  const present = new Set(partitions.map((partition) => partition.year));
  return {
    release_id: release.id,
    hs_revision: release.hs_revision,
    flows,
    partitions: partitions.map((partition) => ({ year: partition.year, hs_chapter: partition.hs_chapter, sha256: partition.sha256, object_key: partition.object_key })),
    years_without_partition: requested.filter((year) => !present.has(year)),
  };
}
