/**
 * An agent records the official duty for one market of an exporter's analysis (D-024).
 *
 * Where no official tariff can be read automatically, the agent opens the source the tariff
 * directory names (`tariff-source-directory.ts`), finds the product's declarable line and records
 * it here: the national line, its description, the duty exactly as published, the date it applies
 * from and where it was read. The record goes through the authoritative-manual path
 * (`manual-authoritative.ts`): a named reviewer's reading, stored as manually entered evidence, never
 * as a government response. Demand Discovery uses it from the next analysis run and says it was read
 * by an agent.
 *
 * The market and HS6 come from the stored assessment, never from the request, and an agent may record
 * only for an exporter assigned to them; Ops may record for any.
 */
import { UserRole } from '@prisma/client';
import { assertCanRecordAgentDecision } from '@/lib/agent-decisions';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { forbidden, notFound, validationError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';
import { persistMarketAccessIngest } from './contract';
import { buildManualAuthoritativeMarketAccess } from './manual-authoritative';
import { manualTariffCheckFor } from './tariff-source-directory';

export interface ManualTariffCaptureInput {
  market_assessment_id: string;
  /** The declarable national line, at least seven digits, beneath the product's HS6. */
  national_tariff_code: string;
  /** The line's description as the tariff gives it. */
  description: string;
  /** The duty exactly as published (e.g. "10%", "5% or 50 AED/kg"). */
  duty_expression: string;
  /** YYYY-MM-DD: the date the published rate applies from. */
  effective_from: string;
  /** Where it was read: the page, schedule or gazette address. */
  source_reference: string;
  /** The publishing authority; defaults to the directory's authority for the market. */
  source_authority?: string | null;
  notes?: string | null;
}

const RECORDING_ROLES: readonly UserRole[] = [UserRole.agent, UserRole.ops_supervisor, UserRole.admin];

export async function recordManualTariffCapture(args: { actor: Principal; input: ManualTariffCaptureInput; correlation_id: string; now?: Date }) {
  const { actor, input } = args;
  if (!RECORDING_ROLES.includes(actor.role)) throw forbidden('Only an assigned agent or Ops may record an official duty.');

  const assessment = await prisma.marketAssessment.findUnique({
    where: { id: input.market_assessment_id },
    select: { id: true, country_code: true, run: { select: { id: true, exporter_org_id: true, input_snapshot: true } } },
  });
  if (!assessment) throw notFound();
  await assertCanRecordAgentDecision(actor, assessment.run.exporter_org_id);

  const snapshot = (assessment.run.input_snapshot ?? {}) as { hs_code?: string; classification_version?: string | null };
  const hs6 = snapshot.hs_code ?? '';
  if (!/^\d{6}$/.test(hs6)) throw validationError([{ field: 'market_assessment_id', code: 'no_hs6', message: 'This analysis has no confirmed six-digit HS code to record a duty for.' }]);
  const fields: Array<{ field: string; code: string; message: string }> = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effective_from ?? '')) fields.push({ field: 'effective_from', code: 'invalid', message: 'Give the date the rate applies from (YYYY-MM-DD).' });
  if (!/^https?:\/\//.test((input.source_reference ?? '').trim())) fields.push({ field: 'source_reference', code: 'invalid', message: 'Give the address of the official page or document the rate was read from.' });
  if (!(input.description ?? '').trim()) fields.push({ field: 'description', code: 'required', message: "Give the line's description as the tariff shows it." });
  if (fields.length) throw validationError(fields);

  const country = assessment.country_code.toUpperCase();
  const authority = (input.source_authority ?? '').trim() || manualTariffCheckFor(country, hs6)?.authority || '';
  const now = args.now ?? new Date();
  const result = await buildManualAuthoritativeMarketAccess({
    country_code: country,
    jurisdiction: country,
    hs6,
    hs_revision: (snapshot.classification_version ?? 'UNKNOWN').trim().toUpperCase() || 'UNKNOWN',
    source_authority: authority,
    source_reference: input.source_reference.trim(),
    source_dataset: 'Official tariff, read by a ClearTrade agent',
    national_code_system: 'NATIONAL_TARIFF_LINE',
    retrieved_at: now,
    reviewer_user_id: actor.id,
    lines: [{ national_tariff_code: (input.national_tariff_code ?? '').replace(/[.\s]/g, ''), description: input.description.trim(), duty_expression: (input.duty_expression ?? '').trim(), effective_from: input.effective_from }],
    beneficiary_enumeration_is_complete: false,
    regulatory_coverage_complete: false,
    notes: input.notes?.trim() || null,
  });
  const stored = await persistMarketAccessIngest(result, { source_run_id: `manual-capture:${assessment.id}:${args.correlation_id}` });

  await writeAuditEvent({
    actor,
    action: AUDIT_ACTIONS.create,
    object_type: 'market_access_manual_capture',
    object_id: stored.id,
    exporter_org_id: assessment.run.exporter_org_id,
    after_summary: {
      market_assessment_id: assessment.id, run_id: assessment.run.id, country_code: country, hs6,
      national_tariff_code: result.lines[0]?.national_tariff_code ?? null, duty_expression: input.duty_expression.trim(),
      effective_from: input.effective_from, source_reference: input.source_reference.trim(), source_authority: authority,
    },
    correlation_id: args.correlation_id,
  });

  return {
    snapshot_id: stored.id, country_code: country, hs6,
    national_tariff_code: result.lines[0]?.national_tariff_code ?? null,
    duty_expression: input.duty_expression.trim(), effective_from: input.effective_from, source_authority: authority,
  };
}
