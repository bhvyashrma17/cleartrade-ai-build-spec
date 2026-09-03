/**
 * The standing operational gate for bulk authority releases.
 *
 * Wave 1C built a real-archive memory measurement but left it as a command somebody had to
 * remember to run. That is not a gate — it is a suggestion. This module turns the measurement into
 * enforceable release state: a bulk release is *operationally trusted* only while a valid
 * qualification exists for the exact bytes and parser it will actually be decoded with.
 *
 * ## What invalidates a qualification
 *
 * Qualification answers "does decoding THIS archive with THIS parser fit the worker?", so it stops
 * being evidence the moment either half changes:
 *
 *  - **Parser version changed.** The NZ incident was a parser-shaped defect at unchanged input;
 *    the same archive with a different reader is an unmeasured subject.
 *  - **Archive checksum changed.** Different bytes are a different subject, full stop. This also
 *    covers the "source grew" case without needing a size heuristic: a bigger release is
 *    necessarily a different checksum.
 *  - **Never qualified.** Absence of evidence is not a pass.
 *  - **Last result was `failed`.** A breach stays a breach until a passing run supersedes it.
 *
 * A `warned` result is trusted: it is within the ceiling, and the warning is about headroom.
 *
 * ## Where it is enforced
 *
 * Deliberately at authority-release activation, not in ordinary unit tests or development builds.
 * Requiring a real archive decode on every `npm test` would make the suite depend on government
 * web servers; requiring it before a release becomes the one a worker serves is the point where
 * the risk actually materialises.
 */
import { prisma } from '@/lib/prisma';

/**
 * How many bulk decodes one worker process may run at once.
 *
 * One — and this is a measurement, not a preference. The memory ceiling in
 * `bulk-operational-qualification.ts` is derived from a SINGLE decode's peak RSS, which is only a
 * sufficient budget while a second decode cannot overlap it.
 *
 * Two independent properties make that true today, and both were verified rather than assumed:
 *
 *  1. The worker claims exactly one job per tick and awaits it to completion before looping
 *     (`scripts/worker.ts`); there is no in-process job fan-out.
 *  2. The readers that dominate memory (NZ, Japan) are synchronous functions that never yield the
 *     event loop mid-decode, so even a deliberate `Promise.all` serialises them.
 *
 * Measured on staging against real archives: two overlapping NZ decodes peaked at 598MB against
 * 597MB for one — i.e. they did not overlap at all. Raising this number is therefore not a
 * throughput knob; it would invalidate every recorded per-adapter ceiling and require re-deriving
 * the budget for N simultaneous decodes. `tests/bulk-release-gate.test.ts` pins both properties so
 * that introducing worker concurrency has to confront this explicitly.
 */
export const MAX_BULK_DECODES_PER_WORKER = 1;

/** Source families whose releases must carry a real-archive qualification before activation. */
export const BULK_QUALIFICATION_REQUIRED: Readonly<Record<string, boolean>> = Object.freeze({
  CA_CBSA: true,
  NZ_CUSTOMS: true,
  // Japan and Australia publish one small page per chapter (largest observed ~2.25MB, ~9MB decoded)
  // rather than a bulk archive, so a per-release memory ceiling is not the live risk for them — the
  // risk is cache accumulation across chapters, which BoundedBundleCache bounds structurally.
  JP_CUSTOMS: false,
  AU_ABF: false,
  EU_TARIC: true,
  // Norway ships one whole-country bundle of four JSON datasets (~41MB of rates alone), so it is a
  // bulk archive by the same test as Canada and NZ.
  NO_TOLLETATEN: true,
  // Korea ships one ~22MB XLSX of ~380K rate rows across ~11K tariff items — a bulk archive by the
  // same test, not a per-request lookup API.
  KR_KCS: true,
});

export function requiresBulkQualification(sourceFamily: string): boolean {
  return BULK_QUALIFICATION_REQUIRED[sourceFamily] === true;
}

export interface RecordQualificationArgs {
  release_id: string;
  source_family: string;
  release_identifier: string;
  parser_version: string;
  archive_checksum: string;
  row_count: number;
  peak_rss_bytes: number;
  ceiling_bytes: number;
  status: string;
  concurrency?: number;
}

/** Appends a qualification result. Never updates: a prior verdict is retained as history. */
export async function recordReleaseQualification(args: RecordQualificationArgs) {
  return prisma.authorityReleaseQualification.create({
    data: {
      release_id: args.release_id,
      source_family: args.source_family,
      release_identifier: args.release_identifier,
      parser_version: args.parser_version,
      archive_checksum: args.archive_checksum,
      row_count: args.row_count,
      peak_rss_bytes: BigInt(Math.round(args.peak_rss_bytes)),
      ceiling_bytes: BigInt(Math.round(args.ceiling_bytes)),
      concurrency: args.concurrency ?? 1,
      status: args.status,
    },
  });
}

export type QualificationVerdict =
  | { trusted: true; reason: 'not_required' | 'qualified'; detail: string }
  | { trusted: false; reason: 'never_qualified' | 'parser_changed' | 'archive_changed' | 'last_run_failed'; detail: string };

/**
 * Whether a release may be treated as operationally trusted right now.
 *
 * Takes the release's *current* parser version and checksum rather than trusting what the
 * qualification row recorded, so a parser upgrade invalidates without anyone having to remember to
 * re-run anything.
 */
export async function releaseQualificationVerdict(release: {
  id: string;
  source_family: string;
  parser_version: string;
  checksum: string;
}): Promise<QualificationVerdict> {
  if (!requiresBulkQualification(release.source_family)) {
    return {
      trusted: true,
      reason: 'not_required',
      detail: `${release.source_family} is not a bulk-archive family; per-release memory qualification is not required for it.`,
    };
  }

  const latest = await prisma.authorityReleaseQualification.findFirst({
    where: { release_id: release.id },
    orderBy: { qualified_at: 'desc' },
  });

  if (!latest) {
    return {
      trusted: false,
      reason: 'never_qualified',
      detail: `No real-archive operational qualification exists for release ${release.id}. Run scripts/qualify-bulk-release.ts before activating it.`,
    };
  }
  if (latest.parser_version !== release.parser_version) {
    return {
      trusted: false,
      reason: 'parser_changed',
      detail: `Qualification was measured against parser ${latest.parser_version}, but the release now uses ${release.parser_version}. Memory behaviour is a property of the parser, so the earlier result no longer applies.`,
    };
  }
  if (latest.archive_checksum !== release.checksum) {
    return {
      trusted: false,
      reason: 'archive_changed',
      detail: 'Qualification was measured against different archive bytes than this release carries. Different bytes are a different subject, including the case where the source simply grew.',
    };
  }
  if (latest.status === 'failed') {
    return {
      trusted: false,
      reason: 'last_run_failed',
      detail: `The most recent qualification FAILED (peak ${latest.peak_rss_bytes} bytes against a ${latest.ceiling_bytes} byte ceiling). Fix the memory architecture and re-qualify; a breach is not cleared by time passing.`,
    };
  }
  return {
    trusted: true,
    reason: 'qualified',
    detail: `Qualified ${latest.qualified_at.toISOString()} at ${latest.peak_rss_bytes} bytes peak (status ${latest.status}, concurrency ${latest.concurrency}).`,
  };
}
