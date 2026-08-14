/**
 * GET /api/v1/audit — OPS-07 audit search. Read-only by construction: this file has no
 * PATCH/PUT/DELETE export, and `writeAuditEvent()` (src/lib/audit.ts) is the only
 * function in the codebase that touches this table — there is no route anywhere that
 * could mutate a row even if one tried (AC01).
 *
 * "Large audit range → require date/filter limits" (docs/06 required UI state): a
 * request that names neither a `correlation_id` nor an `object_id` — the two genuinely
 * narrow keys — must supply a `date_from`/`date_to` window of 90 days or less. Full
 * async export for an unbounded range is out of scope here; this is the "require
 * date/filter limits" half of that requirement, not the "or async export" half.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { resolvePagination } from '@/lib/config';
import { errorResponse, list, newCorrelationId, pageMeta, validationError } from '@/lib/errors';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';

const MAX_RANGE_DAYS = 90;

export async function GET(request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    assertCan(principal, 'audit.search');

    const params = request.nextUrl.searchParams;
    const actorUserId = params.get('actor_user_id');
    const action = params.get('action');
    const objectType = params.get('object_type');
    const objectId = params.get('object_id');
    const exporterOrgId = params.get('exporter_org_id');
    const targetCorrelationId = params.get('correlation_id');
    const dateFromRaw = params.get('date_from');
    const dateToRaw = params.get('date_to');

    const hasNarrowKey = Boolean(targetCorrelationId) || Boolean(objectId);

    let dateFrom: Date | null = null;
    let dateTo: Date | null = null;
    if (dateFromRaw || dateToRaw || !hasNarrowKey) {
      if (!dateFromRaw || !dateToRaw) {
        throw validationError(
          [{ field: 'date_from', code: 'required', message: 'A date range is required unless searching by correlation ID or object ID.' }],
          'Narrow this search with a date range, a correlation ID, or an object ID.',
        );
      }
      dateFrom = new Date(dateFromRaw);
      dateTo = new Date(dateToRaw);
      if (Number.isNaN(dateFrom.getTime()) || Number.isNaN(dateTo.getTime())) {
        throw validationError([{ field: 'date_from', code: 'invalid', message: 'Dates must be valid (YYYY-MM-DD).' }]);
      }
      const rangeDays = (dateTo.getTime() - dateFrom.getTime()) / 86_400_000;
      if (rangeDays > MAX_RANGE_DAYS) {
        throw validationError(
          [{ field: 'date_to', code: 'range_too_large', message: `Date range cannot exceed ${MAX_RANGE_DAYS} days. Narrow the range or add a correlation/object ID filter.` }],
          `Audit search is limited to ${MAX_RANGE_DAYS} days at a time. Narrow the range, or search by correlation ID / object ID instead.`,
        );
      }
    }

    const { page, per_page, skip, take } = await resolvePagination({
      page: params.get('page'),
      per_page: params.get('per_page'),
    });

    const where = {
      ...(actorUserId ? { actor_user_id: actorUserId } : {}),
      ...(action ? { action } : {}),
      ...(objectType ? { object_type: objectType } : {}),
      ...(objectId ? { object_id: objectId } : {}),
      ...(exporterOrgId ? { exporter_org_id: exporterOrgId } : {}),
      ...(targetCorrelationId ? { correlation_id: targetCorrelationId } : {}),
      ...(dateFrom && dateTo ? { timestamp: { gte: dateFrom, lte: dateTo } } : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.auditEvent.findMany({
        where,
        include: { actor: { select: { name: true, role: true } } },
        orderBy: { timestamp: 'desc' },
        skip,
        take,
      }),
      prisma.auditEvent.count({ where }),
    ]);

    const data = rows.map((e) => ({
      id: e.id,
      actor_name: e.actor?.name ?? null,
      role: e.role,
      action: e.action,
      object_type: e.object_type,
      object_id: e.object_id,
      exporter_org_id: e.exporter_org_id,
      timestamp: e.timestamp,
      before_summary: e.before_summary,
      after_summary: e.after_summary,
      correlation_id: e.correlation_id,
      source: e.source,
    }));

    return NextResponse.json(list(data, { ...pageMeta({ page, per_page, total }) }), {
      headers: { 'x-correlation-id': correlationId },
    });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
