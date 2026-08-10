/**
 * GET /api/v1/notifications — EXP-17 notification list.
 *
 * Always `where: { user_id: principal.id }`. There is no role/tier check beyond being a
 * signed-in principal, on purpose: a notification is scoped to the PERSON, not the
 * tenant or role — the same reasoning `/api/v1/messages` already applies. Any
 * authenticated user (exporter, agent, ops) can list their own notifications through
 * this same route; only the exporter Notifications page currently calls it.
 */

import { NotificationSeverity } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { resolvePagination } from '@/lib/config';
import { errorResponse, list, newCorrelationId, pageMeta, validationError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const params = request.nextUrl.searchParams;

    const unreadOnly = params.get('unread') === 'true';
    const severity = params.get('severity');
    if (severity && !Object.values(NotificationSeverity).includes(severity as NotificationSeverity)) {
      throw validationError([{ field: 'severity', code: 'invalid', message: `Must be one of: ${Object.values(NotificationSeverity).join(', ')}.` }]);
    }

    const { page, per_page, skip, take } = await resolvePagination({
      page: params.get('page'),
      per_page: params.get('per_page'),
    });

    const where = {
      user_id: principal.id,
      ...(unreadOnly ? { read_at: null } : {}),
      ...(severity ? { severity: severity as NotificationSeverity } : {}),
    };

    const [rows, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: [{ read_at: { sort: 'asc', nulls: 'first' } }, { created_at: 'desc' }],
        skip,
        take,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { user_id: principal.id, read_at: null } }),
    ]);

    return NextResponse.json(list(rows, { ...pageMeta({ page, per_page, total }), unread_count: unreadCount }), {
      headers: { 'x-correlation-id': correlationId },
    });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
