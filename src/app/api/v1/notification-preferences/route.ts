/**
 * GET/PATCH /api/v1/notification-preferences — EXP-17 Preferences.
 *
 * "Critical legal/security notifications may be non-disableable" is enforced here by
 * refusing to write a preference row for a non-disableable category at all — GET merges
 * the registry's disableable flag into every row (including categories with no stored
 * row yet, which default to enabled), so the non-disableable ones always render locked
 * regardless of what a client might try to send.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireExporterPrincipal } from '@/lib/auth';
import { errorResponse, forbidden, newCorrelationId, single, validationError } from '@/lib/errors';
import {
  DISABLEABLE_CATEGORIES,
  NOTIFICATION_CATEGORIES,
  isDisableableCategory,
  type NotificationCategory,
} from '@/lib/notifications';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { updateNotificationPreferenceSchema, zodFieldErrors } from '@/lib/validators';

export async function GET() {
  const correlationId = newCorrelationId();
  try {
    const principal = await requireExporterPrincipal();
    assertCan(principal, 'notification.manage');

    const rows = await prisma.notificationPreference.findMany({ where: { user_id: principal.id } });
    const byCategory = new Map(rows.map((r) => [r.category, r]));

    const data = (Object.keys(NOTIFICATION_CATEGORIES) as NotificationCategory[]).map((category) => {
      const def = NOTIFICATION_CATEGORIES[category];
      const stored = byCategory.get(category);
      return {
        category,
        label: def.label,
        description: def.description,
        disableable: def.disableable,
        // A non-disableable category is always on, regardless of any stored row —
        // there should never BE one, but this is the belt-and-braces read-side answer.
        email_enabled: def.disableable ? (stored?.email_enabled ?? true) : true,
        in_app_enabled: def.disableable ? (stored?.in_app_enabled ?? true) : true,
      };
    });

    return NextResponse.json(single(data), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}

export async function PATCH(request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requireExporterPrincipal();
    assertCan(principal, 'notification.manage');

    const body = await request.json().catch(() => null);
    const parsed = updateNotificationPreferenceSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const { category, channel, enabled } = parsed.data;

    if (!(category in NOTIFICATION_CATEGORIES)) {
      throw validationError([{ field: 'category', code: 'invalid', message: `Must be one of: ${DISABLEABLE_CATEGORIES.join(', ')}.` }]);
    }
    const typedCategory = category as NotificationCategory;
    if (!isDisableableCategory(typedCategory)) {
      // Not a validation error — the category is well-formed, the ACTION is refused.
      throw forbidden('This category covers account security and legal notices, and cannot be turned off.');
    }

    const updated = await prisma.notificationPreference.upsert({
      where: { user_id_category: { user_id: principal.id, category: typedCategory } },
      update: { [channel === 'email' ? 'email_enabled' : 'in_app_enabled']: enabled },
      create: {
        user_id: principal.id,
        category: typedCategory,
        email_enabled: channel === 'email' ? enabled : true,
        in_app_enabled: channel === 'in_app' ? enabled : true,
      },
    });

    return NextResponse.json(single(updated), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
