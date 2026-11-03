/**
 * POST /api/v1/password-reset — ask for a link to choose a new password (R-39).
 *
 * Always answers 202 with the same message, whether or not the address has an account, so the
 * route cannot be used to find out who is registered (`src/lib/password-reset.ts`).
 */
import { NextResponse } from 'next/server';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { passwordResetRequestSchema, requestPasswordReset, RESET_REQUEST_ACCEPTED } from '@/lib/password-reset';
import { zodFieldErrors } from '@/lib/validators';

export async function POST(request: Request) {
  const correlationId = newCorrelationId();
  try {
    const parsed = passwordResetRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    try {
      await requestPasswordReset(parsed.data.email);
    } catch (error) {
      // A provider failure must not reveal that the address exists: log it, answer as usual.
      console.error(`[password-reset] ${correlationId}: ${error instanceof Error ? error.message : 'request failed'}`);
    }
    return NextResponse.json(single({ message: RESET_REQUEST_ACCEPTED }), { status: 202, headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
