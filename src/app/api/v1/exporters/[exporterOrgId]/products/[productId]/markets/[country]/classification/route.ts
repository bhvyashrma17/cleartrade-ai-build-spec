import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePrincipal } from '@/lib/auth';
import { answerClassificationQuestions, classificationQuestions } from '@/lib/country-discovery/service';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { zodFieldErrors } from '@/lib/validators';

/**
 * The exporter-facing classification surface.
 *
 * The request body carries ANSWERS ABOUT THE GOODS and nothing else — `{ basmati: 'yes' }`. It
 * has no field for a tariff code, a candidate list, a source snapshot or a selection state, so
 * the code-injection attacks the underlying service defends against cannot even be expressed
 * here. The candidate set is loaded server-side from the immutable authority snapshot.
 */
const schema = z.object({
  answers: z.record(z.string().min(1), z.enum(['yes', 'no'])),
});

export async function GET(_request: NextRequest, ctx: { params: Promise<{ exporterOrgId: string; productId: string; country: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const actor = await requirePrincipal();
    const { exporterOrgId, productId, country } = await ctx.params;
    const view = await classificationQuestions(actor, exporterOrgId, productId, country);
    return NextResponse.json(single(view), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ exporterOrgId: string; productId: string; country: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const actor = await requirePrincipal();
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const { exporterOrgId, productId, country } = await ctx.params;
    await answerClassificationQuestions({
      actor, exporter_org_id: exporterOrgId, product_id: productId,
      country_code: country, answers: parsed.data.answers, correlation_id: correlationId,
    });
    // The refinement row is an audit record, not the answer. What the caller gets back is the
    // recomputed question state, so the browser never has to derive narrowing for itself.
    const view = await classificationQuestions(actor, exporterOrgId, productId, country);
    return NextResponse.json(single(view), { status: 201, headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
