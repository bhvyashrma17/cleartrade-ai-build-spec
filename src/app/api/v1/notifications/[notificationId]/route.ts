/**
 * PATCH /api/v1/notifications/:notificationId — EXP-17 "Open notification" (AC01: mark
 * read + deep-link; AC02: read status syncs across sessions).
 *
 * AC02 is true by construction here, not by any extra mechanism: `read_at` is a column
 * on the one canonical `Notification` row, written server-side. A second browser tab or
 * device re-fetching `GET /api/v1/notifications` sees the same row, because there is
 * only ever the one row — there is no per-session read-state cache to fall out of sync.
 *
 * Idempotent: marking an already-read notification read again just returns it unchanged,
 * so a client re-firing the same request (double-click, retry) never errors.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { errorResponse, newCorrelationId, notFound, single } from '@/lib/errors';
import { prisma } from '@/lib/prisma';

export async function PATCH(_request: NextRequest, ctx: { params: Promise<{ notificationId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { notificationId } = await ctx.params;

    // Ownership is the whole authorization check — a notification belongs to exactly
    // one user, and `findFirst` scoped to that user_id is what makes an out-of-scope id
    // 404 rather than leak whether some OTHER user's notification exists at that id.
    const notification = await prisma.notification.findFirst({
      where: { id: notificationId, user_id: principal.id },
    });
    if (!notification) throw notFound('That notification is not available.');

    const updated = notification.read_at
      ? notification
      : await prisma.notification.update({ where: { id: notification.id }, data: { read_at: new Date() } });

    return NextResponse.json(single(updated), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
