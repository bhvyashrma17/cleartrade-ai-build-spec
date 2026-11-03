import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePrincipal } from '@/lib/auth';
import { recordClassificationRefinement } from '@/lib/market-access/classification-refinement';
import { assertCan, assertOrgAccess } from '@/lib/permissions';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { zodFieldErrors } from '@/lib/validators';

/**
 * The caller echoes the candidate set it displayed, but the service reloads the cited immutable
 * authority snapshot and requires an exact match before it records any answer or selection.
 */
const schema = z.object({
  product_classification_id: z.string().min(1),
  destination_country: z.string().length(2),
  national_code_system: z.string().min(1),
  source_authority: z.string().min(1),
  source_reference: z.string().min(1),
  source_snapshot_id: z.string().min(1),
  state: z.enum(['unresolved', 'refinement_required', 'exporter_declared_selection', 'agent_verified_selection', 'authoritative_verified']),
  selected_national_code: z.string().min(1).nullish(),
  selection_rationale: z.string().min(1).nullish(),
  deciding_attributes: z.record(z.string(), z.string()).nullish(),
  candidates: z.array(z.object({
    national_tariff_code: z.string().min(1),
    description: z.string(),
    description_path: z.array(z.string()).optional(),
    duty_expression: z.string().nullable(),
    duty_kind: z.string().nullable(),
    effective_from: z.string().nullish(),
    effective_to: z.string().nullish(),
  })).min(1),
});

export async function POST(request: NextRequest, ctx: { params: Promise<{ exporterOrgId: string; productId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const actor = await requirePrincipal();
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const { exporterOrgId, productId } = await ctx.params;
    assertCan(actor, 'demand_discovery.run');
    await assertOrgAccess(actor, exporterOrgId);
    const record = await recordClassificationRefinement({
      actor, exporter_org_id: exporterOrgId, product_id: productId,
      product_classification_id: parsed.data.product_classification_id,
      destination_country: parsed.data.destination_country.toUpperCase(),
      national_code_system: parsed.data.national_code_system,
      source_authority: parsed.data.source_authority,
      source_reference: parsed.data.source_reference,
      source_snapshot_id: parsed.data.source_snapshot_id,
      candidates: parsed.data.candidates,
      state: parsed.data.state,
      selected_national_code: parsed.data.selected_national_code ?? null,
      selection_rationale: parsed.data.selection_rationale ?? null,
      deciding_attributes: parsed.data.deciding_attributes ?? null,
      correlation_id: correlationId,
    });
    return NextResponse.json(single({ id: record.id, state: record.state, selected_national_code: record.selected_national_code, candidate_count: record.candidate_count, outstanding_questions: record.outstanding_questions }), { status: 201, headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
