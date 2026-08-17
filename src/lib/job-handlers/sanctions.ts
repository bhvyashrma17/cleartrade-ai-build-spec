/**
 * Scheduled sanctions refresh with atomic snapshot activation (Phase 7).
 *
 * Sequence per source, and the order is the whole point:
 *   1. retrieve  (durable, artifact-validated — a 200 is not evidence)
 *   2. checksum  (SHA-256 over the raw bytes)
 *   3. parse     (source-specific adapter)
 *   4. validate  (completeness contract + anomaly detection vs. last known-good)
 *   5. persist   (entities written against a CANDIDATE snapshot, invisible to screening)
 *   6. activate  (only if the gate passed — one transaction, previous snapshot superseded)
 *
 * A failure at any step leaves the previously active snapshot serving, untouched. The
 * candidate is retained in a non-serving state so the failure is auditable rather than
 * vanishing. Screening never reads a half-populated dataset because it only ever joins
 * through `snapshot.state = 'active'`, and a snapshot becomes active exactly once, at the
 * end, after the gate.
 */

import {
  EvidenceOrigin,
  IngestStatus,
  JobStatus,
  Prisma,
  SanctionsCompletenessStatus,
  SanctionsFailureStage,
  SanctionsSnapshotState,
} from '@prisma/client';
import type { JobContext, JobOutcome } from '@/lib/jobs';
import { prisma } from '@/lib/prisma';
import { normalizeSanctionsName as normalizeEntityName } from '@/lib/sanctions/normalize';
import { SANCTIONS_ADAPTERS } from '@/lib/sanctions/adapters';
import { coverageRatios, evaluateCompleteness } from '@/lib/sanctions/completeness';
import { redactUrl, retrieveSanctionsArtifact } from '@/lib/sanctions/retrieval';
import { artifactRetentionRequired, persistSanctionsArtifact, verificationPermitsActivation } from '@/lib/sanctions/artifact-store';
import { acquireRefreshLease, releaseRefreshLease } from '@/lib/sanctions/scheduler';
import { sanctionsCoverage } from '@/lib/sanctions/screening';
import {
  contractMetadataForSnapshot,
  resolveSourceUrl,
  sanctionsContract,
  SANCTIONS_SOURCE_CONTRACTS,
  type SanctionsSource,
} from '@/lib/sanctions/sources';

export const SANCTIONS_SOURCES = (Object.keys(SANCTIONS_SOURCE_CONTRACTS) as SanctionsSource[]).map((source) => ({
  source,
  url: SANCTIONS_SOURCE_CONTRACTS[source].base_url,
}));

/** Entities are written in chunks so a 19k-record source does not build one giant statement. */
const WRITE_CHUNK = 500;

export interface RefreshSourceResult {
  source: SanctionsSource;
  snapshot_id: string | null;
  state: SanctionsSnapshotState;
  completeness_status: SanctionsCompletenessStatus | 'not_reached';
  failure_stage: SanctionsFailureStage;
  failure_reason: string | null;
  http_status: number | null;
  media_type: string | null;
  byte_length: number | null;
  checksum: string | null;
  retrieved_count: number;
  parsed_count: number;
  rejected_count: number;
  source_published_at: string | null;
  source_version: string | null;
  authoritative_record_count: number | null;
  anomalies: { code: string; severity: string; detail: string }[];
  activated: boolean;
  rationale: string;
  /** Part D operational surface. */
  artifact_id: string | null;
  artifact_retained: boolean;
  artifact_storage_provider: string | null;
  artifact_verification: string | null;
}

/** Refresh one source end to end. Never throws for an expected failure — it returns it. */
export async function refreshSanctionsSource(
  source: SanctionsSource,
  ingestRunId: string | null,
): Promise<RefreshSourceResult> {
  const contract = sanctionsContract(source);
  const meta = contractMetadataForSnapshot(contract);
  const safeUrl = redactUrl(resolveSourceUrl(contract));

  const base = {
    source,
    source_url: safeUrl,
    evidence_origin: EvidenceOrigin.public_real,
    ingest_run_id: ingestRunId,
    ...meta,
  };

  const fail = async (
    stage: SanctionsFailureStage,
    reason: string,
    extra: Partial<Prisma.SanctionsSourceSnapshotUncheckedCreateInput> = {},
  ): Promise<RefreshSourceResult> => {
    // The failed attempt is persisted as a REJECTED snapshot: it is history, it is
    // auditable, and it is never served. The previously active snapshot is untouched.
    const snapshot = await prisma.sanctionsSourceSnapshot.create({
      data: {
        ...base,
        checksum: 'unavailable',
        record_count: 0,
        completeness_status: SanctionsCompletenessStatus.FAILED,
        coverage_complete: false,
        state: SanctionsSnapshotState.rejected,
        failure_stage: stage,
        failure_reason: reason,
        parse_errors: [reason] as Prisma.InputJsonValue,
        ...extra,
      },
    });
    return {
      source,
      snapshot_id: snapshot.id,
      state: SanctionsSnapshotState.rejected,
      completeness_status: 'not_reached',
      failure_stage: stage,
      failure_reason: reason,
      http_status: (extra.http_status as number | undefined) ?? null,
      media_type: (extra.media_type as string | undefined) ?? null,
      byte_length: (extra.byte_length as number | undefined) ?? null,
      checksum: null,
      retrieved_count: 0,
      parsed_count: 0,
      rejected_count: 0,
      source_published_at: null,
      source_version: null,
      authoritative_record_count: null,
      anomalies: [],
      activated: false,
      rationale: `${stage} failure: ${reason}`,
      artifact_id: null,
      artifact_retained: false,
      artifact_storage_provider: null,
      artifact_verification: null,
    };
  };

  // --- 1/2. Retrieve + checksum -------------------------------------------
  const retrieval = await retrieveSanctionsArtifact(contract);
  if (!retrieval.ok) {
    return fail(retrieval.stage, retrieval.reason, {
      http_status: retrieval.http_status ?? undefined,
      media_type: retrieval.media_type ?? undefined,
      byte_length: retrieval.byte_length ?? undefined,
      fetched_at: retrieval.retrieved_at,
    });
  }
  if (retrieval.not_modified) {
    // Provider says nothing changed. The active snapshot remains correct and current; we
    // record the successful freshness check without creating a redundant snapshot.
    const active = await prisma.sanctionsSourceSnapshot.findFirst({
      where: { source, state: SanctionsSnapshotState.active },
    });
    if (active) {
      await prisma.sanctionsSourceSnapshot.update({
        where: { id: active.id },
        data: { fetched_at: retrieval.retrieved_at },
      });
    }
    return {
      source,
      snapshot_id: active?.id ?? null,
      state: SanctionsSnapshotState.active,
      completeness_status: active?.completeness_status ?? 'not_reached',
      failure_stage: SanctionsFailureStage.none,
      failure_reason: null,
      http_status: 304,
      media_type: null,
      byte_length: null,
      checksum: active?.checksum ?? null,
      retrieved_count: active?.retrieved_count ?? 0,
      parsed_count: active?.parsed_entity_count ?? 0,
      rejected_count: active?.rejected_records ?? 0,
      source_published_at: active?.source_update_date?.toISOString() ?? null,
      source_version: active?.source_version ?? null,
      authoritative_record_count: null,
      anomalies: [],
      activated: false,
      rationale: 'Provider returned 304 Not Modified; active snapshot remains current.',
      artifact_id: null,
      artifact_retained: Boolean(active?.artifact_ref),
      artifact_storage_provider: null,
      artifact_verification: null,
    };
  }

  // --- 3. Parse ------------------------------------------------------------
  let parse;
  try {
    parse = SANCTIONS_ADAPTERS[source](retrieval.body);
  } catch (error) {
    return fail(SanctionsFailureStage.parsing, `Adapter threw: ${error instanceof Error ? error.message : String(error)}`, {
      checksum: retrieval.sha256,
      http_status: retrieval.http_status,
      media_type: retrieval.media_type ?? undefined,
      byte_length: retrieval.byte_length,
      fetched_at: retrieval.retrieved_at,
      etag: retrieval.etag ?? undefined,
      last_modified: retrieval.last_modified ?? undefined,
    });
  }

  // --- 4. Validate completeness against the last known-good ----------------
  const previousActive = await prisma.sanctionsSourceSnapshot.findFirst({
    where: { source, state: SanctionsSnapshotState.active },
  });
  const previousMeta = (previousActive?.metadata ?? null) as { alias_coverage_ratio?: number; identifier_coverage_ratio?: number } | null;
  const ratios = coverageRatios(parse);
  const completeness = evaluateCompleteness({
    contract,
    parse,
    ...ratios,
    previous: previousActive
      ? {
          parsed_entity_count: previousActive.parsed_entity_count,
          alias_coverage_ratio: previousMeta?.alias_coverage_ratio ?? null,
          identifier_coverage_ratio: previousMeta?.identifier_coverage_ratio ?? null,
        }
      : null,
  });

  // --- 5. Persist the RAW ARTIFACT before anything can activate (Part D4) --
  // Retention happens before the candidate is written so that a mandatory-retention
  // environment can never end up with an activated snapshot whose source evidence was
  // never durably stored. A retention failure here leaves the incumbent serving.
  const retentionRequired = artifactRetentionRequired();
  let persisted: Awaited<ReturnType<typeof persistSanctionsArtifact>> | null = null;
  let retentionFailure: string | null = null;
  try {
    persisted = await persistSanctionsArtifact({
      dataset: source,
      bytes: Buffer.from(retrieval.body, 'utf8'),
      sha256: retrieval.sha256,
      media_type: retrieval.media_type,
    });
  } catch (error) {
    retentionFailure = `Artifact persistence failed: ${error instanceof Error ? error.message : String(error)}`;
  }

  if (!retentionFailure && persisted) {
    const permitted = verificationPermitsActivation(persisted.verification_status, retentionRequired);
    if (!permitted.ok) retentionFailure = permitted.reason;
  }

  if (retentionRequired && retentionFailure) {
    // Fail closed: no candidate is activated, and the previous active snapshot keeps
    // serving. The attempt is still recorded so the failure is operationally visible.
    return fail(SanctionsFailureStage.activation, retentionFailure, {
      checksum: retrieval.sha256,
      http_status: retrieval.http_status,
      media_type: retrieval.media_type ?? undefined,
      byte_length: retrieval.byte_length,
      fetched_at: retrieval.retrieved_at,
      retrieved_count: parse.retrieved_count,
      parsed_entity_count: parse.entities.length,
    });
  }

  // --- 6. Persist as a CANDIDATE (invisible to screening) ------------------
  const candidate = await prisma.sanctionsSourceSnapshot.create({
    data: {
      ...base,
      checksum: retrieval.sha256,
      record_count: parse.retrieved_count,
      retrieved_count: parse.retrieved_count,
      parsed_entity_count: parse.entities.length,
      rejected_records: parse.rejected_records,
      parse_errors: parse.parse_errors as Prisma.InputJsonValue,
      source_update_date: parse.source_update_date,
      source_version: parse.source_version,
      completeness_status: completeness.status,
      coverage_complete: completeness.coverage_complete,
      state: SanctionsSnapshotState.candidate,
      failure_stage: completeness.coverage_complete ? SanctionsFailureStage.none : SanctionsFailureStage.completeness,
      failure_reason: completeness.coverage_complete ? null : completeness.rationale,
      anomalies: completeness.anomalies as unknown as Prisma.InputJsonValue,
      fetched_at: retrieval.retrieved_at,
      http_status: retrieval.http_status,
      media_type: retrieval.media_type,
      byte_length: retrieval.byte_length,
      etag: retrieval.etag,
      last_modified: retrieval.last_modified,
      artifact_ref: persisted?.object_key ?? null,
      metadata: {
        content_type: retrieval.media_type,
        etag: retrieval.etag,
        final_url: retrieval.final_url,
        authoritative_record_count: parse.authoritative_record_count,
        alias_coverage_ratio: ratios.alias_coverage_ratio,
        identifier_coverage_ratio: ratios.identifier_coverage_ratio,
        completeness_rationale: completeness.rationale,
      } as Prisma.InputJsonValue,
    },
  });

  if (persisted) {
    await prisma.sanctionsArtifact.create({
      data: {
        dataset: source,
        source_contract_version: contract.contract_version,
        evidence_origin: EvidenceOrigin.public_real,
        source_reference: safeUrl,
        retrieved_at: retrieval.retrieved_at,
        provider_published_at: parse.source_update_date,
        provider_version: parse.source_version,
        http_status: retrieval.http_status,
        media_type: retrieval.media_type,
        byte_length: persisted.byte_length,
        sha256: persisted.sha256,
        etag: retrieval.etag,
        last_modified: retrieval.last_modified,
        storage_provider: persisted.storage_provider,
        object_key: persisted.object_key,
        object_version_id: persisted.object_version_id,
        verification_status: persisted.verification_status,
        verification_detail: persisted.verification_detail,
        verified_at: persisted.verified_at,
        snapshot_id: candidate.id,
        ingest_run_id: ingestRunId,
      },
    });
  }

  for (let i = 0; i < parse.entities.length; i += WRITE_CHUNK) {
    await prisma.sanctionsEntity.createMany({
      data: parse.entities.slice(i, i + WRITE_CHUNK).map((entity) => ({
        snapshot_id: candidate.id,
        source,
        source_record_id: entity.source_record_id,
        name: entity.primary_name,
        normalized_name: normalizeEntityName(entity.primary_name),
        normalized_aliases: entity.aliases.map(normalizeEntityName) as Prisma.InputJsonValue,
        entity_type: entity.entity_type,
        aliases: entity.aliases as Prisma.InputJsonValue,
        countries: entity.countries as Prisma.InputJsonValue,
        addresses: entity.addresses as Prisma.InputJsonValue,
        dates: entity.dates as Prisma.InputJsonValue,
        identifiers: entity.identifiers as unknown as Prisma.InputJsonValue,
        programs: entity.programs as Prisma.InputJsonValue,
        remarks: entity.remarks,
        source_published_at: entity.source_published_at ?? parse.source_update_date,
        source_version: entity.source_version ?? parse.source_version,
        observed_at: retrieval.retrieved_at,
        is_active: true,
        raw_snapshot: entity.raw as Prisma.InputJsonValue,
        evidence_origin: EvidenceOrigin.public_real,
      })),
      skipDuplicates: true,
    });
  }

  // --- 6. Activate — ONLY if the gate passed -------------------------------
  if (!completeness.coverage_complete) {
    await prisma.sanctionsSourceSnapshot.update({
      where: { id: candidate.id },
      data: { state: SanctionsSnapshotState.rejected },
    });
    return {
      source,
      snapshot_id: candidate.id,
      state: SanctionsSnapshotState.rejected,
      completeness_status: completeness.status,
      failure_stage: SanctionsFailureStage.completeness,
      failure_reason: completeness.rationale,
      http_status: retrieval.http_status,
      media_type: retrieval.media_type,
      byte_length: retrieval.byte_length,
      checksum: retrieval.sha256,
      retrieved_count: parse.retrieved_count,
      parsed_count: parse.entities.length,
      rejected_count: parse.rejected_records,
      source_published_at: parse.source_update_date?.toISOString() ?? null,
      source_version: parse.source_version,
      authoritative_record_count: parse.authoritative_record_count,
      anomalies: completeness.anomalies,
      activated: false,
      rationale: completeness.rationale,
      artifact_id: null,
      artifact_retained: Boolean(persisted),
      artifact_storage_provider: persisted?.storage_provider ?? null,
      artifact_verification: persisted?.verification_status ?? null,
    };
  }

  // Single transaction: supersede the incumbent and promote the candidate. Screening sees
  // exactly one active snapshot before and after; there is no interval with zero or two.
  await prisma.$transaction(async (tx) => {
    await tx.sanctionsSourceSnapshot.updateMany({
      where: { source, state: SanctionsSnapshotState.active },
      data: { state: SanctionsSnapshotState.superseded, superseded_at: new Date() },
    });
    await tx.sanctionsSourceSnapshot.update({
      where: { id: candidate.id },
      data: {
        state: SanctionsSnapshotState.active,
        activated_at: new Date(),
        last_successful_full_refresh: retrieval.retrieved_at,
      },
    });
  });

  return {
    source,
    snapshot_id: candidate.id,
    state: SanctionsSnapshotState.active,
    completeness_status: completeness.status,
    failure_stage: SanctionsFailureStage.none,
    failure_reason: null,
    http_status: retrieval.http_status,
    media_type: retrieval.media_type,
    byte_length: retrieval.byte_length,
    checksum: retrieval.sha256,
    retrieved_count: parse.retrieved_count,
    parsed_count: parse.entities.length,
    rejected_count: parse.rejected_records,
    source_published_at: parse.source_update_date?.toISOString() ?? null,
    source_version: parse.source_version,
    authoritative_record_count: parse.authoritative_record_count,
    anomalies: completeness.anomalies,
    activated: true,
    rationale: completeness.rationale,
    artifact_id: null,
    artifact_retained: Boolean(persisted),
    artifact_storage_provider: persisted?.storage_provider ?? null,
    artifact_verification: persisted?.verification_status ?? null,
  };
}

/**
 * Lease-guarded refresh (Part F4). Exactly one worker may refresh a dataset at a time; a
 * loser does NOT fail — it defers, because a concurrent refresh is already doing the work.
 * The lease is always released, including on an unexpected throw, so a crash inside the
 * refresh cannot strand the dataset (and if the process dies outright, TTL expiry reclaims).
 */
export async function refreshSanctionsSourceExclusive(
  source: SanctionsSource,
  ingestRunId: string | null,
  options: { owner?: string } = {},
): Promise<RefreshSourceResult & { deferred?: boolean }> {
  const lease = await acquireRefreshLease(source, { owner: options.owner, jobId: ingestRunId });
  if (!lease) {
    return {
      source, snapshot_id: null, state: SanctionsSnapshotState.candidate, completeness_status: 'not_reached',
      failure_stage: SanctionsFailureStage.none, failure_reason: null, http_status: null, media_type: null,
      byte_length: null, checksum: null, retrieved_count: 0, parsed_count: 0, rejected_count: 0,
      source_published_at: null, source_version: null, authoritative_record_count: null, anomalies: [],
      activated: false, rationale: 'Another worker holds the refresh lease for this dataset; deferred.',
      artifact_id: null, artifact_retained: false, artifact_storage_provider: null, artifact_verification: null,
      deferred: true,
    };
  }
  try {
    return await refreshSanctionsSource(source, ingestRunId);
  } finally {
    await releaseRefreshLease(source, lease.owner).catch(() => undefined);
  }
}

export async function runSanctionsIngest(ctx: JobContext): Promise<JobOutcome> {
  const run = await prisma.sanctionsIngestRun.create({ data: { evidence_origin: EvidenceOrigin.public_real } });
  const results: RefreshSourceResult[] = [];
  let observed = 0;
  let written = 0;

  // A scheduled tick refreshes only the datasets whose cadence has elapsed (F1/F3); a manual
  // or legacy invocation with no selection still refreshes everything. Unknown dataset names
  // are dropped rather than trusted — the payload is data, not a contract extension.
  const allSources = Object.keys(SANCTIONS_SOURCE_CONTRACTS) as SanctionsSource[];
  const requested = (ctx.payload as { datasets?: unknown } | null)?.datasets;
  const selected = Array.isArray(requested)
    ? allSources.filter((s) => (requested as unknown[]).includes(s))
    : allSources;
  const sources = selected.length > 0 ? selected : allSources;
  for (const [index, source] of sources.entries()) {
    // One source failing must never abort the others — partial coverage is still
    // information, and the coverage gate decides what it means for screening.
    let result: RefreshSourceResult;
    try {
      result = await refreshSanctionsSourceExclusive(source, run.id);
    } catch (error) {
      result = {
        source,
        snapshot_id: null,
        state: SanctionsSnapshotState.rejected,
        completeness_status: 'not_reached',
        failure_stage: SanctionsFailureStage.activation,
        failure_reason: error instanceof Error ? error.message : String(error),
        http_status: null,
        media_type: null,
        byte_length: null,
        checksum: null,
        retrieved_count: 0,
        parsed_count: 0,
        rejected_count: 0,
        source_published_at: null,
        source_version: null,
        authoritative_record_count: null,
        anomalies: [],
        activated: false,
        rationale: 'Unexpected refresh failure.',
        artifact_id: null,
        artifact_retained: false,
        artifact_storage_provider: null,
        artifact_verification: null,
      };
    }
    results.push(result);
    observed += result.retrieved_count;
    written += result.activated ? result.parsed_count : 0;
    await ctx.reportProgress(((index + 1) / sources.length) * 100);
  }

  const activated = results.filter((r) => r.activated);
  const status =
    activated.length === sources.length
      ? IngestStatus.completed
      : activated.length > 0
        ? IngestStatus.partial
        : IngestStatus.failed;

  await prisma.sanctionsIngestRun.update({
    where: { id: run.id },
    data: {
      status,
      records_observed: observed,
      restrictions_written: written,
      source_results: results as unknown as Prisma.InputJsonValue,
      completed_at: new Date(),
      error: activated.length === sources.length ? null : `${sources.length - activated.length} source(s) did not activate.`,
    },
  });

  // Coverage is a property of ALL required datasets, not of the ones this run happened to
  // refresh. Reporting "COMPLETE" because a one-dataset tick succeeded would misstate the
  // screening gate, so it is re-read rather than inferred from this run's results.
  const coverage = await sanctionsCoverage();

  return {
    status:
      status === IngestStatus.completed ? JobStatus.completed : status === IngestStatus.partial ? JobStatus.partial : JobStatus.failed,
    result: {
      sanctions_ingest_run_id: run.id,
      datasets_refreshed: sources,
      records_observed: observed,
      entities_written: written,
      source_results: results,
      screening_coverage: coverage.complete ? 'COMPLETE' : 'INCOMPLETE',
      note: 'Targeted entity lists do not create country restrictions.',
    } as unknown as Prisma.InputJsonValue,
  };
}

export const __test__ = { refreshSanctionsSource, refreshSanctionsSourceExclusive };
