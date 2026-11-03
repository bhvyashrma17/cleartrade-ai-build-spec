/**
 * Authoritative-manual tariff capture.
 *
 * For a destination whose authority publishes no machine interface we may rely on (TARIC, ZATCA),
 * the answer is a named reviewer recording the exact published line — not a scraper, and not a
 * guess. This path enforces what makes such a record trustworthy: an exact national tariff code,
 * a citable source reference, a retrieval date, an effective date, a verbatim duty expression,
 * and the identity of the person who read it.
 *
 * It is deliberately impossible to file one of these as `authoritative_public`. A person's
 * reading of a government publication is `agent_verified` evidence: high quality, attributable,
 * and materially different from a response the government itself returned to us. Blurring those
 * two is how an unverifiable claim eventually acquires the authority of a primary source.
 */
import { UserRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { validationError } from '@/lib/errors';
import {
  determineIndiaPreference,
  parseDutyExpression,
  resolveNationalTariffLine,
  type CandidateTariffLine,
} from './tariff-semantics';
import type { MarketAccessIngestResult, MarketAccessLineRecord, NationalCodeSystem } from './contract';

export const MANUAL_AUTHORITATIVE_PARSER_VERSION = 'manual-authoritative-v1';

export interface ManualTariffLineInput {
  national_tariff_code: string;
  description: string;
  /** Verbatim, as published. Never a computed or rounded value. */
  duty_expression: string;
  effective_from: string;
  effective_to?: string | null;
  /** Preferential measure for India-origin goods on this line, if the source publishes one. */
  india_preference_duty_expression?: string | null;
  india_preference_is_quota?: boolean;
}

export interface ManualMarketAccessInput {
  country_code: string;
  jurisdiction: string;
  hs6: string;
  hs_revision: string;
  source_authority: string;
  /** A citable location: the published tariff page, notice or gazette reference. */
  source_reference: string;
  source_dataset: string;
  source_dataset_version?: string | null;
  national_code_system: NationalCodeSystem;
  retrieved_at: Date;
  reviewer_user_id: string;
  lines: readonly ManualTariffLineInput[];
  /** True only when the reviewer confirms the source enumerates ALL preferential beneficiaries. */
  beneficiary_enumeration_is_complete: boolean;
  /** True only when the reviewer confirms the source publishes the complete control set. */
  regulatory_coverage_complete: boolean;
  notes?: string | null;
}

const REVIEWER_ROLES: readonly UserRole[] = [UserRole.agent, UserRole.ops_supervisor, UserRole.admin];

export async function buildManualAuthoritativeMarketAccess(input: ManualMarketAccessInput): Promise<MarketAccessIngestResult> {
  const fields: Array<{ field: string; code: string; message: string }> = [];
  if (!/^\d{6}$/.test(input.hs6)) fields.push({ field: 'hs6', code: 'invalid', message: 'An exact HS6 is required.' });
  if (!/^[A-Z]{2}$/.test(input.country_code)) fields.push({ field: 'country_code', code: 'invalid', message: 'An ISO alpha-2 destination is required.' });
  if (!input.source_reference.trim()) fields.push({ field: 'source_reference', code: 'required', message: 'A citable source reference is required for authoritative manual evidence.' });
  if (!input.source_authority.trim()) fields.push({ field: 'source_authority', code: 'required', message: 'The publishing authority must be named.' });
  if (Number.isNaN(input.retrieved_at.getTime())) fields.push({ field: 'retrieved_at', code: 'invalid', message: 'A retrieval date is required.' });
  if (!input.lines.length) fields.push({ field: 'lines', code: 'required', message: 'At least one exact national tariff line is required; an HS6 alone is not a declarable line.' });
  input.lines.forEach((line, index) => {
    // An HS6 echoed back as the "national line" is the exact failure this path exists to prevent.
    if (!/^\d{7,14}$/.test(line.national_tariff_code)) fields.push({ field: `lines[${index}].national_tariff_code`, code: 'invalid', message: 'A national tariff line must be at least 7 digits; an HS6 is not a declarable code.' });
    if (!line.national_tariff_code.startsWith(input.hs6)) fields.push({ field: `lines[${index}].national_tariff_code`, code: 'invalid', message: 'A national tariff line must sit beneath the requested HS6.' });
    if (!line.duty_expression.trim()) fields.push({ field: `lines[${index}].duty_expression`, code: 'required', message: 'The duty expression must be recorded verbatim.' });
    if (Number.isNaN(new Date(line.effective_from).getTime())) fields.push({ field: `lines[${index}].effective_from`, code: 'invalid', message: 'An effective date is required.' });
  });
  if (fields.length) throw validationError(fields);

  const reviewer = await prisma.user.findUnique({ where: { id: input.reviewer_user_id }, select: { id: true, role: true } });
  if (!reviewer || !REVIEWER_ROLES.includes(reviewer.role)) {
    throw validationError([{ field: 'reviewer_user_id', code: 'forbidden', message: 'Authoritative manual tariff evidence must be recorded by an agent or operations reviewer.' }]);
  }

  const candidates: CandidateTariffLine[] = [];
  const lines: MarketAccessLineRecord[] = [];
  const directIndia: Array<{ geographic_area_id: string; duty: ReturnType<typeof parseDutyExpression>; is_quota: boolean }> = [];

  for (const line of input.lines) {
    const duty = parseDutyExpression(line.duty_expression);
    const preferenceDuty = line.india_preference_duty_expression ? parseDutyExpression(line.india_preference_duty_expression) : null;
    const base = {
      national_tariff_code: line.national_tariff_code, description: line.description, declarable: true,
      effective_from: new Date(line.effective_from), effective_to: line.effective_to ? new Date(line.effective_to) : null,
      source_reference: input.source_reference, conditions: { recorded_by: reviewer.id, notes: input.notes ?? null }, applies_to_origin_country: null,
    };
    lines.push({ ...base, measure_kind: 'third_country_duty', origin_geographic_area_id: 'ERGA_OMNES', origin_scope: 'erga_omnes', duty, raw_measure: line as unknown });
    if (preferenceDuty) {
      lines.push({ ...base, measure_kind: line.india_preference_is_quota ? 'tariff_quota' : 'tariff_preference', origin_geographic_area_id: 'IN', origin_scope: 'country', applies_to_origin_country: 'IN', duty: preferenceDuty, raw_measure: line as unknown });
      directIndia.push({ geographic_area_id: 'IN', duty: preferenceDuty, is_quota: Boolean(line.india_preference_is_quota) });
    }
    candidates.push({ national_tariff_code: line.national_tariff_code, description: line.description, declarable: true, general_duty: duty, control_codes: [], preference_area_ids: preferenceDuty ? ['IN'] : [] });
  }

  const resolution = resolveNationalTariffLine(candidates);
  const preference = determineIndiaPreference({
    direct_india_measures: directIndia,
    proven_group_measures: [],
    beneficiary_enumeration_is_complete: input.beneficiary_enumeration_is_complete,
    unresolved_program_symbols: [],
  });

  return {
    jurisdiction: input.jurisdiction, country_code: input.country_code, hs6: input.hs6, hs_revision: input.hs_revision,
    provider: 'authoritative_manual', source_authority: input.source_authority,
    source_dataset: input.source_dataset, source_dataset_version: input.source_dataset_version ?? null,
    source_reference: input.source_reference, national_code_system: input.national_code_system,
    parser_version: MANUAL_AUTHORITATIVE_PARSER_VERSION, retrieved_at: input.retrieved_at,
    // Never `authoritative_public`: this is a reviewer's reading, attributable to that reviewer.
    evidence_class: 'agent_verified', recorded_by_id: reviewer.id,
    resolution, general_duty: resolution.resolved_line?.general_duty ?? null, india_preference: preference,
    lines, requirements: [], regulatory_coverage_complete: input.regulatory_coverage_complete,
    raw_evidence: { schema_version: 'manual-authoritative-market-access-v1', recorded_by_id: reviewer.id, source_reference: input.source_reference, source_authority: input.source_authority, retrieved_at: input.retrieved_at.toISOString(), notes: input.notes ?? null, lines: input.lines },
  };
}
