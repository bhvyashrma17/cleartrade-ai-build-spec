/** POST /api/v1/password-reset/confirm — set a new password with a reset link's token (R-39). */
import { NextResponse } from 'next/server';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { confirmPasswordReset, passwordResetConfirmSchema } from '@/lib/password-reset';
import { zodFieldErrors } from '@/lib/validators';

export async function POST(request: Request) {
  const correlationId = newCorrelationId();
  try {
    const parsed = passwordResetConfirmSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const outcome = await confirmPasswordReset(parsed.data.token, parsed.data.password);
    if (!outcome.ok) {
      throw validationError(
        [{ field: 'token', code: outcome.reason, message: outcome.reason === 'expired' ? 'This link has expired.' : 'This link is not valid any more.' }],
        'Ask for a new link and use the newest email.',
      );
    }
    return NextResponse.json(single({ reset: true }), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
