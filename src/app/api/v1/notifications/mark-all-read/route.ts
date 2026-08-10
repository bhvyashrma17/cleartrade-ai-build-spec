/** POST /api/v1/notifications/mark-all-read — bulk convenience over the same AC02 guarantee. */

import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { errorResponse, newCorrelationId, single } from '@/lib/errors';
import { prisma } from '@/lib/prisma';

export async function POST(_request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const result = await prisma.notification.updateMany({
      where: { user_id: principal.id, read_at: null },
      data: { read_at: new Date() },
    });
    return NextResponse.json(single({ marked: result.count }), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
