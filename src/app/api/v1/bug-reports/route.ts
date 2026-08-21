import { NextResponse } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { createBugReport, bugReportSchema } from '@/lib/bug-reports';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { zodFieldErrors } from '@/lib/validators';

export async function POST(request: Request) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const parsed = bugReportSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const report = await createBugReport(principal, parsed.data, correlationId);
    return NextResponse.json(single(report), { status: 201, headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
