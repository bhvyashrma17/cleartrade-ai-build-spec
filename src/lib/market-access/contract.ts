/**
 * The shared shape every Market Access source produces, and how it is persisted.
 *
 * One contract for automated providers and for authoritative manual capture, because the
 * difference between them is a provenance fact, not a different kind of evidence. What must
 * never blur is which one a row came from: `evidence_class` and `recorded_by_id` are carried
 * separately so an operator's reading of a government publication can never be presented as a
 * machine-read government response.
 */
import { createHash } from 'node:crypto';
import { EvidenceCompletenessStatus, EvidenceOrigin, MarketAccessEvidenceStatus, MarketAccessRuleType, Prisma } from '@prisma/client';
import { appEnvironment } from '@/lib/evidence-environment';
import { prisma } from '@/lib/prisma';
import {
  type ClassificationResolutionResult,
  type IndiaPreferenceDetermination,
  type ParsedDuty,
} from './tariff-semantics';

export type NationalCodeSystem =
  | 'UK_COMMODITY'
  | 'EU_TARIC'
  | 'US_HTS'
  | 'GCC_INTEGRATED'
  | 'CA_CUSTOMS_TARIFF'
  | 'NZ_TARIFF_ITEM'
  | 'JP_STATISTICAL_CODE'
  | 'AU_TARIFF_ITEM'
  | 'NO_VARENUMMER'
  | 'KR_TARIFF_ITEM'
  | 'TW_CUSTOMS_TARIFF'
  | 'GE_TAX_CODE'
  | 'IL_CUSTOMS_BOOK'
  | 'PE_NATIONAL_SUBPARTIDA'
  | 'IS_TOLLSKRARLYKILL'
  | 'OM_CUSTOMS_TARIFF'
  | 'NP_CUSTOMS_TARIFF'
  | 'BT_TRADE_CLASSIFICATION'
  | 'AL_COMBINED_NOMENCLATURE'
  | 'MU_INTEGRATED_TARIFF'
  | 'LK_CUSTOMS_TARIFF'
  | 'SG_CUSTOMS_DUTIES_ORDER'
  | 'MY_CUSTOMS_DUTIES_ORDER'
  | 'ID_BTKI_2022'
  | 'UZ_TN_VED'
  | 'VN_AHTN_2022'
  | 'MA_TDI_2022'
  | 'TN_NDP_2022';

/**
 * Discovery-grade evidence compares markets while exposing what is still unresolved.
 * Execution-grade means the declarable line, origin treatment, effective date and conditions
 * have all been established. Only a resolved line can ever be execution-grade, and even then a
 * preference that still needs origin proof keeps the row at discovery grade.
 */
export type VerificationGrade = 'discovery_grade' | 'execution_grade';

export interface MarketAccessLineRecord {
  national_tariff_code: string;
  description: string;
  declarable: boolean;
  measure_kind: 'third_country_duty' | 'tariff_preference' | 'tariff_quota' | 'additional_duty' | 'vat' | 'other';
  origin_geographic_area_id: string | null;
  origin_scope: 'erga_omnes' | 'country' | 'group' | 'programme' | 'unknown';
  applies_to_origin_country: string | null;
  duty: ParsedDuty;
  conditions: Record<string, unknown>;
  effective_from: Date | null;
  effective_to: Date | null;
  source_reference: string;
  raw_measure: unknown;
}

export interface MarketAccessRequirementRecord {
  rule_type: MarketAccessRuleType;
  requirement_code: string | null;
  requirement_description: string;
  requirement_obtainable: boolean | null;
  national_tariff_code: string | null;
  effective_from: Date | null;
  effective_to: Date | null;
  source_reference: string;
  raw: unknown;
}

export interface MarketAccessIngestResult {
  jurisdiction: string;
  country_code: string;
  hs6: string;
  hs_revision: string;
  provider: string;
  source_authority: string;
  source_dataset: string;
  source_dataset_version: string | null;
  source_reference: string;
  national_code_system: NationalCodeSystem;
  parser_version: string;
  /** Retained bulk/file release supplying the bytes. Lookup/API providers omit it. */
  source_release_id?: string | null;
  /** Origin and any other request context that distinguishes legitimate reads of one release. */
  request_identity?: string | null;
  retrieved_at: Date;
  evidence_class: 'authoritative_public' | 'agent_verified';
  recorded_by_id: string | null;
  resolution: ClassificationResolutionResult;
  /** The general/third-country duty, only when a single line was actually established. */
  general_duty: ParsedDuty | null;
  india_preference: IndiaPreferenceDetermination;
  lines: readonly MarketAccessLineRecord[];
  requirements: readonly MarketAccessRequirementRecord[];
  /**
   * True only when the source proves it published the complete set of controls for this line.
   * False means "we did not see any" — which is never the same as "there are none".
   */
  regulatory_coverage_complete: boolean;
  raw_evidence: unknown;
}

const decimal = (value: number | null) => (value == null ? null : new Prisma.Decimal(value));

function gradeFor(result: MarketAccessIngestResult): VerificationGrade {
  if (result.resolution.resolution !== 'exact' && result.resolution.resolution !== 'all_children_equivalent') return 'discovery_grade';
  if (!result.regulatory_coverage_complete) return 'discovery_grade';
  if (result.india_preference.applicability === 'unknown' || result.india_preference.applicability === 'potentially_applicable_requires_origin_proof') return 'discovery_grade';
  return 'execution_grade';
}

/**
 * Map our explicit applicability onto the Phase 1H calculator's existing fail-closed vocabulary.
 *
 * `potentially_applicable_requires_origin_proof` deliberately becomes `unknown`: the calculator
 * treats `applicable` as "this is the rate to use", and a preference still awaiting rules-of-
 * origin qualification is not that. Widening the calculator to accept it would be exactly the
 * "change scoring semantics to make a tariff available" this work forbids.
 */
export function calculatorPreferenceStatus(applicability: IndiaPreferenceDetermination['applicability']): MarketAccessEvidenceStatus {
  if (applicability === 'confirmed_applicable') return MarketAccessEvidenceStatus.verified;
  if (applicability === 'not_applicable') return MarketAccessEvidenceStatus.not_applicable;
  return MarketAccessEvidenceStatus.needs_review;
}

export async function persistMarketAccessIngest(result: MarketAccessIngestResult, options: { source_run_id?: string | null; evidence_origin?: EvidenceOrigin } = {}) {
  const raw = JSON.stringify(result.raw_evidence);
  const checksum = createHash('sha256').update(raw).digest('hex');
  const origin = options.evidence_origin ?? (result.evidence_class === 'authoritative_public' ? EvidenceOrigin.public_real : EvidenceOrigin.manually_entered_real);
  const resolved = result.resolution.resolved_line;
  const grade = gradeFor(result);
  const complete = result.regulatory_coverage_complete && (result.resolution.resolution === 'exact' || result.resolution.resolution === 'all_children_equivalent');
  const ingestIdentity = result.source_release_id
    ? createHash('sha256').update(JSON.stringify({
      source_release_id: result.source_release_id,
      provider: result.provider,
      country_code: result.country_code,
      hs6: result.hs6,
      parser_version: result.parser_version,
      request_identity: result.request_identity ?? null,
    })).digest('hex')
    : null;

  if (ingestIdentity) {
    const existing = await prisma.marketAccessEvidenceSnapshot.findUnique({
      where: { ingest_identity: ingestIdentity },
      include: { evidence: true, tariff_lines: true },
    });
    if (existing) return existing;
  }

  const evidence: Array<Omit<Prisma.MarketAccessEvidenceCreateManyInput, 'snapshot_id'>> = [];

  // A tariff determination is only published when a single declarable line was actually
  // established. Under refinement-required there is no line to state a duty for, so no tariff
  // evidence row is written and the pillar stays honestly unavailable.
  if (resolved && result.general_duty) {
    evidence.push({
      jurisdiction: result.jurisdiction, country_code: result.country_code, hs_code_scope: result.hs6,
      rule_type: MarketAccessRuleType.destination_tariff,
      source_authority: result.source_authority, source_reference: result.source_reference,
      retrieved_at: result.retrieved_at, status: MarketAccessEvidenceStatus.verified, confidence: new Prisma.Decimal(1),
      effective_at: resolved.effective_from ?? null, expires_at: resolved.effective_to ?? null,
      evidence_origin: origin,
      // Only a purely ad-valorem duty has a percentage. A specific or compound duty leaves this
      // null and travels as its verbatim expression instead.
      tariff_rate_percent: decimal(result.general_duty.kind === 'ad_valorem' ? result.general_duty.ad_valorem_rate_percent : null),
      national_tariff_code: resolved.national_tariff_code, national_code_system: result.national_code_system,
      duty_expression: result.general_duty.expression, duty_kind: result.general_duty.kind,
      verification_grade: grade,
      raw_evidence: { resolution: result.resolution.resolution, duty: result.general_duty as unknown } as Prisma.InputJsonValue,
    });
  }

  const preference = result.india_preference;
  evidence.push({
    jurisdiction: result.jurisdiction, country_code: result.country_code, hs_code_scope: result.hs6,
    rule_type: MarketAccessRuleType.preferential_tariff_india,
    source_authority: preference.source_authority ?? result.source_authority,
    source_reference: preference.source_reference ?? result.source_reference,
    retrieved_at: result.retrieved_at,
    effective_at: resolved?.effective_from ?? null, expires_at: resolved?.effective_to ?? null,
    status: calculatorPreferenceStatus(preference.applicability),
    confidence: new Prisma.Decimal(preference.applicability === 'confirmed_applicable' ? 1 : 0.5),
    evidence_origin: origin,
    tariff_rate_percent: decimal(preference.applicability === 'confirmed_applicable' && preference.duty?.kind === 'ad_valorem' ? preference.duty.ad_valorem_rate_percent : null),
    national_tariff_code: resolved?.national_tariff_code ?? null, national_code_system: result.national_code_system,
    duty_expression: preference.duty?.expression ?? null, duty_kind: preference.duty?.kind ?? null,
    preference_applicability: preference.applicability, preference_basis: preference.basis,
    verification_grade: grade,
    raw_evidence: {
      geographic_area_id: preference.geographic_area_id,
      applicability: preference.applicability,
      basis: preference.basis,
      ...(preference.raw_evidence ?? {}),
    } as Prisma.InputJsonValue,
  });

  for (const requirement of result.requirements) {
    evidence.push({
      jurisdiction: result.jurisdiction, country_code: result.country_code,
      // A requirement is published against a national line. Fact selection matches evidence
      // scopes at HS6, heading or chapter, so a 10-digit scope never matches the product — which
      // is correct while the declarable line is unknown, and wrong once it IS known: the
      // snapshot would then claim complete regulatory coverage with no admissible requirement
      // beneath it, and "we found none" would read as "there are none". So the requirement is
      // published at the product's HS6 only once a single line has actually been established;
      // otherwise it stays at national scope, where coverage is PARTIAL and absence stays
      // unknown. The originating line is retained either way.
      hs_code_scope: resolved ? result.hs6 : requirement.national_tariff_code ?? result.hs6,
      rule_type: requirement.rule_type,
      source_authority: result.source_authority, source_reference: requirement.source_reference,
      retrieved_at: result.retrieved_at,
      effective_at: requirement.effective_from, expires_at: requirement.effective_to,
      status: MarketAccessEvidenceStatus.verified, confidence: new Prisma.Decimal(0.95),
      evidence_origin: origin,
      requirement_code: requirement.requirement_code, requirement_description: requirement.requirement_description,
      requirement_obtainable: requirement.requirement_obtainable,
      national_tariff_code: requirement.national_tariff_code, national_code_system: result.national_code_system,
      verification_grade: grade,
      raw_evidence: requirement.raw as Prisma.InputJsonValue,
    });
  }

  // Only the writes need atomicity, and Prisma's interactive-transaction timeout is a budget
  // for the whole callback, so the callback must contain nothing but the writes. A live UK HS6
  // (108 declarable candidates) produces ~7,221 tariff-line rows and ~326 evidence rows; reading
  // that full nested relation set back INSIDE the same transaction — which the previous version
  // did, purely to shape the return value — added a second full pass over the same data volume
  // for no caller: the job handler only ever reads `.tariff_lines.length`/`.evidence.length`
  // (equal to `result.lines.length`/`evidence.length`, already known before any DB call), and no
  // test inspects `.tariff_lines` row data at all. So the read now happens AFTER the transaction
  // returns, via the top-level client rather than `tx`. This changes nothing about atomicity or
  // visibility: the read can only ever see the fully-committed snapshot (Postgres MVCC guarantees
  // no session observes a transaction's writes before it commits), so a caller can never observe
  // a partial snapshot either way — the write path is exactly as atomic as before, just no longer
  // paying for an unread bulk fetch inside the timed window.
  //
  // `timeout` is bounded, not removed: the writes themselves (1 snapshot row + up to ~150
  // candidates' worth of tariff-line/evidence rows — `fetchUkMarketAccess`'s own
  // `max_commodity_requests` ceiling — chunked across Postgres's per-statement parameter limit by
  // Prisma's `createMany`) are legitimately large and pay real network round-trips beyond
  // Prisma's 5s default. 30s leaves ample margin above the ~6.3-6.6s this took in production
  // reproduction while still failing closed well short of a stuck/deadlocked transaction.
  let snapshotId: string;
  try {
    snapshotId = await prisma.$transaction(async (tx) => {
      const snapshot = await tx.marketAccessEvidenceSnapshot.create({
        data: {
        jurisdiction: result.jurisdiction, country_code: result.country_code, hs_code_scope: result.hs6, hs6_code: result.hs6,
        national_code_system: result.national_code_system,
        classification_resolution: result.resolution.resolution,
        candidate_line_count: result.resolution.candidate_count,
        resolution_detail: {
          reason: result.resolution.reason,
          differences: result.resolution.differences,
          resolved_line: resolved?.national_tariff_code ?? null,
          verification_grade: grade,
          india_preference: { applicability: preference.applicability, basis: preference.basis },
          declarable_candidates: result.resolution.candidates.filter((line) => line.declarable).map((line) => ({
            code: line.national_tariff_code,
            description: line.description,
            description_path: [...(line.description_path ?? [])],
            duty: line.general_duty.expression,
            duty_kind: line.general_duty.kind,
            effective_from: line.effective_from?.toISOString() ?? null,
            effective_to: line.effective_to?.toISOString() ?? null,
          })),
        } as unknown as Prisma.InputJsonValue,
        source_authority: result.source_authority, source_reference: result.source_reference,
        source_version: result.source_dataset_version, retrieved_at: result.retrieved_at,
        effective_at: resolved?.effective_from ?? null, expires_at: resolved?.effective_to ?? null,
        completeness_status: complete ? EvidenceCompletenessStatus.COMPLETE : EvidenceCompletenessStatus.PARTIAL,
        tariff_coverage: Boolean(resolved && result.general_duty),
        regulatory_coverage: result.regulatory_coverage_complete,
        parser_version: result.parser_version, evidence_origin: origin, provider: result.provider,
        source_dataset: result.source_dataset, source_run_id: options.source_run_id ?? null,
        ingest_identity: ingestIdentity, authority_release_id: result.source_release_id ?? null,
        raw_response_checksum: checksum, raw_evidence: result.raw_evidence as Prisma.InputJsonValue,
        },
      });
      if (result.lines.length) {
        await tx.marketAccessTariffLine.createMany({
          data: result.lines.map((line) => ({
          snapshot_id: snapshot.id, jurisdiction: result.jurisdiction, country_code: result.country_code,
          hs6_code: result.hs6, hs_revision: result.hs_revision,
          national_tariff_code: line.national_tariff_code, national_code_system: result.national_code_system,
          description: line.description, declarable: line.declarable, measure_kind: line.measure_kind,
          origin_geographic_area_id: line.origin_geographic_area_id, origin_scope: line.origin_scope,
          applies_to_origin_country: line.applies_to_origin_country,
          duty_expression: line.duty.expression, duty_kind: line.duty.kind,
          ad_valorem_rate_percent: decimal(line.duty.kind === 'ad_valorem' ? line.duty.ad_valorem_rate_percent : null),
          specific_amount: decimal(line.duty.specific_amount), specific_currency: line.duty.specific_currency,
          specific_unit: line.duty.specific_unit, specific_unit_quantity: decimal(line.duty.specific_unit_quantity),
          conditions: line.conditions as Prisma.InputJsonValue,
          effective_from: line.effective_from, effective_to: line.effective_to,
          source_reference: line.source_reference, raw_measure: line.raw_measure as Prisma.InputJsonValue,
          })),
        });
      }
      if (evidence.length) await tx.marketAccessEvidence.createMany({ data: evidence.map((row) => ({ ...row, snapshot_id: snapshot.id })) });
      return snapshot.id;
    }, { timeout: 30_000, maxWait: 10_000 });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002' || !ingestIdentity) throw error;
    const raced = await prisma.marketAccessEvidenceSnapshot.findUnique({
      where: { ingest_identity: ingestIdentity },
      include: { evidence: true, tariff_lines: true },
    });
    if (!raced) throw error;
    return raced;
  }

  // Reached only once every write above has durably committed (a thrown/rolled-back transaction
  // never returns, so this line never runs against a partial snapshot).
  return prisma.marketAccessEvidenceSnapshot.findUniqueOrThrow({ where: { id: snapshotId }, include: { evidence: true, tariff_lines: true } });
}

export function marketAccessEnvironment() {
  return appEnvironment();
}
