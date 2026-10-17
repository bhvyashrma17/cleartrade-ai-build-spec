import { NextResponse } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { recordManualTariffCapture, type ManualTariffCaptureInput } from '@/lib/market-access/manual-capture-service';

/**
 * D-024: an agent records the official duty read from a market's own tariff for one market of an
 * exporter's analysis. Role, assignment and the market/HS6 are all decided server-side.
 */
export async function POST(request: Request) {
  const correlationId = newCorrelationId();
  try {
    const actor = await requirePrincipal();
    let body: Partial<Record<keyof ManualTariffCaptureInput, unknown>>;
    try { body = await request.json(); } catch { throw validationError([{ field: 'body', code: 'invalid', message: 'The request body must be JSON.' }]); }
    const text = (value: unknown) => (typeof value === 'string' ? value : '');
    if (!text(body.market_assessment_id)) throw validationError([{ field: 'market_assessment_id', code: 'required', message: 'Say which market this duty is for.' }]);
    const recorded = await recordManualTariffCapture({
      actor,
      correlation_id: correlationId,
      input: {
        market_assessment_id: text(body.market_assessment_id),
        national_tariff_code: text(body.national_tariff_code),
        description: text(body.description),
        duty_expression: text(body.duty_expression),
        effective_from: text(body.effective_from),
        source_reference: text(body.source_reference),
        source_authority: text(body.source_authority) || null,
        notes: text(body.notes) || null,
      },
    });
    return NextResponse.json(single(recorded), { status: 201, headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
