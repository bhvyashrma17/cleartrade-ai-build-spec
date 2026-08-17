/**
 * Completeness contract + anomaly detection (Phase 6).
 *
 * The rule this file exists to enforce: **retrieval success is not coverage success.** A
 * snapshot reaches COMPLETE only when completeness is positively demonstrated — never by
 * default, and never merely because an HTTP request returned 200 and a parser did not
 * throw.
 *
 * Historical record counts are deliberately NOT hardcoded as absolute truth. Instead:
 *   - where the authority publishes its own count (OFAC's `Record_Count`), we reconcile
 *     against that;
 *   - where it does not (UN, EU), we compare against the last known-good snapshot for the
 *     same source and treat a large unexplained collapse as an anomaly.
 *
 * An anomaly must never let a new snapshot silently replace the last known-good one.
 */

import { SanctionsCompletenessStatus } from '@prisma/client';
import type { ParseResult } from './adapters';
import type { SanctionsSourceContract } from './sources';

export interface AnomalyFinding {
  code:
    | 'zero_records'
    | 'record_count_collapse'
    | 'authoritative_count_mismatch'
    | 'alias_coverage_collapse'
    | 'identifier_coverage_collapse'
    | 'high_rejection_rate'
    | 'parse_errors_present';
  severity: 'blocking' | 'degrading';
  detail: string;
}

/** Shape of the previous known-good snapshot used as the comparison baseline. */
export interface PreviousSnapshotBaseline {
  parsed_entity_count: number;
  alias_coverage_ratio: number | null;
  identifier_coverage_ratio: number | null;
}

export interface CompletenessInput {
  contract: SanctionsSourceContract;
  parse: ParseResult;
  /** Ratio of parsed entities carrying >=1 alias / >=1 identifier. */
  alias_coverage_ratio: number;
  identifier_coverage_ratio: number;
  previous: PreviousSnapshotBaseline | null;
}

export interface CompletenessResult {
  status: SanctionsCompletenessStatus;
  coverage_complete: boolean;
  anomalies: AnomalyFinding[];
  /** Plain-language explanation of the verdict, surfaced to Ops. */
  rationale: string;
}

/** Fraction of the previous count below which a drop is treated as catastrophic. */
const COLLAPSE_RATIO = 0.5;
/** Coverage ratios (alias/identifier) may not fall below this fraction of the previous run. */
const COVERAGE_COLLAPSE_RATIO = 0.5;
/** Above this share of rejected records the parse is not trustworthy. */
const MAX_REJECTION_RATE = 0.02;

export function evaluateCompleteness(input: CompletenessInput): CompletenessResult {
  const { parse, previous } = input;
  const anomalies: AnomalyFinding[] = [];
  const parsed = parse.entities.length;
  const retrieved = parse.retrieved_count;

  // --- Hard failures -------------------------------------------------------
  if (retrieved === 0 || parsed === 0) {
    anomalies.push({
      code: 'zero_records',
      severity: 'blocking',
      detail: `Parser produced ${parsed} entities from ${retrieved} record blocks. A sanctions list is never legitimately empty.`,
    });
    return {
      status: SanctionsCompletenessStatus.FAILED,
      coverage_complete: false,
      anomalies,
      rationale: 'Zero usable records; snapshot cannot be served.',
    };
  }

  // --- Reconcile against the authority's own declared count -----------------
  // This is the strongest available signal and is checked before any heuristic.
  if (parse.authoritative_record_count != null) {
    const declared = parse.authoritative_record_count;
    if (parsed !== declared) {
      const drift = Math.abs(parsed - declared) / declared;
      anomalies.push({
        code: 'authoritative_count_mismatch',
        severity: drift > 0.01 ? 'blocking' : 'degrading',
        detail: `Authority declares ${declared} records; parser produced ${parsed} (${(drift * 100).toFixed(2)}% drift).`,
      });
    }
  }

  // --- Rejection rate -------------------------------------------------------
  const rejectionRate = parse.rejected_records / Math.max(retrieved, 1);
  if (parse.rejected_records > 0) {
    anomalies.push({
      code: 'high_rejection_rate',
      severity: rejectionRate > MAX_REJECTION_RATE ? 'blocking' : 'degrading',
      detail: `${parse.rejected_records} of ${retrieved} records rejected (${(rejectionRate * 100).toFixed(2)}%).`,
    });
  }
  if (parse.parse_errors.length > 0) {
    anomalies.push({
      code: 'parse_errors_present',
      severity: 'degrading',
      detail: `${parse.parse_errors.length} parse error category/categories recorded.`,
    });
  }

  // --- Comparison with the last known-good snapshot -------------------------
  if (previous && previous.parsed_entity_count > 0) {
    if (parsed < previous.parsed_entity_count * COLLAPSE_RATIO) {
      anomalies.push({
        code: 'record_count_collapse',
        severity: 'blocking',
        detail: `Record count fell from ${previous.parsed_entity_count} to ${parsed} (${(((previous.parsed_entity_count - parsed) / previous.parsed_entity_count) * 100).toFixed(1)}% drop) with no authority-declared explanation.`,
      });
    }
    if (
      previous.alias_coverage_ratio != null &&
      previous.alias_coverage_ratio > 0.05 &&
      input.alias_coverage_ratio < previous.alias_coverage_ratio * COVERAGE_COLLAPSE_RATIO
    ) {
      anomalies.push({
        code: 'alias_coverage_collapse',
        severity: 'blocking',
        detail: `Alias coverage fell from ${(previous.alias_coverage_ratio * 100).toFixed(1)}% to ${(input.alias_coverage_ratio * 100).toFixed(1)}% of entities — aliases are a primary matching signal.`,
      });
    }
    if (
      previous.identifier_coverage_ratio != null &&
      previous.identifier_coverage_ratio > 0.05 &&
      input.identifier_coverage_ratio < previous.identifier_coverage_ratio * COVERAGE_COLLAPSE_RATIO
    ) {
      anomalies.push({
        code: 'identifier_coverage_collapse',
        severity: 'blocking',
        detail: `Identifier coverage fell from ${(previous.identifier_coverage_ratio * 100).toFixed(1)}% to ${(input.identifier_coverage_ratio * 100).toFixed(1)}% of entities.`,
      });
    }
  }

  // --- Verdict --------------------------------------------------------------
  const blocking = anomalies.filter((a) => a.severity === 'blocking');
  if (blocking.length > 0) {
    return {
      status: SanctionsCompletenessStatus.PARTIAL,
      coverage_complete: false,
      anomalies,
      rationale: `Blocking anomaly: ${blocking.map((a) => a.code).join(', ')}. Snapshot retained as PARTIAL and NOT activated; the previous known-good snapshot continues to serve.`,
    };
  }
  if (anomalies.length > 0) {
    return {
      status: SanctionsCompletenessStatus.PARTIAL,
      coverage_complete: false,
      anomalies,
      rationale: `Non-blocking anomalies present (${anomalies.map((a) => a.code).join(', ')}); coverage is not positively demonstrated.`,
    };
  }

  return {
    status: SanctionsCompletenessStatus.COMPLETE,
    coverage_complete: true,
    anomalies,
    rationale:
      parse.authoritative_record_count != null
        ? `All ${parsed} records parsed with zero rejections, reconciled against the authority's declared count of ${parse.authoritative_record_count}.`
        : `All ${retrieved} record blocks parsed into ${parsed} entities with zero rejections and no anomalies against the previous snapshot.`,
  };
}

/** Coverage ratios for a parsed set, used both for the gate and as the next baseline. */
export function coverageRatios(parse: ParseResult) {
  const total = Math.max(parse.entities.length, 1);
  return {
    alias_coverage_ratio: parse.entities.filter((e) => e.aliases.length > 0).length / total,
    identifier_coverage_ratio: parse.entities.filter((e) => e.identifiers.length > 0).length / total,
  };
}
