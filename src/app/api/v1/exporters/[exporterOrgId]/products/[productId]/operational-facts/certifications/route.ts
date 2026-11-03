import { NextResponse, type NextRequest } from 'next/server';
import { CertificationStatus } from '@prisma/client';
import { z } from 'zod';
import { requirePrincipal } from '@/lib/auth';
import { declareProductCertification } from '@/lib/exporter-facts/service';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { zodFieldErrors } from '@/lib/validators';

const optionalDate = z.string().datetime().nullish().transform((value) => value == null ? null : new Date(value));
const schema = z.object({
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  declaration_state: z.enum(['declared_held', 'declared_absent']),
  status: z.nativeEnum(CertificationStatus).optional(),
  issuer: z.string().trim().min(1).nullish(),
  certificate_reference: z.string().trim().min(1).nullish(),
  issue_date: optionalDate,
  valid_until: optionalDate,
  evidence_ref: z.string().trim().min(1).nullish(),
  document_id: z.string().trim().min(1).nullish(),
});

export async function POST(request: NextRequest, ctx: { params: Promise<{ exporterOrgId: string; productId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const actor = await requirePrincipal();
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const { exporterOrgId, productId } = await ctx.params;
    const certification = await declareProductCertification({ actor, exporter_org_id: exporterOrgId, product_id: productId, certification: parsed.data, correlation_id: correlationId });
    return NextResponse.json(single({ id: certification.id, code: certification.code, status: certification.status, declaration_state: certification.declaration_state, verification_state: certification.verification_state }), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
