/**
 * POST /api/v1/config — OPS-07 "Change config | Admin | Create new version/effective
 * state | High-risk confirm + audit".
 *
 * Never updates a row in place. A new `ConfigSetting` version is inserted, is_active,
 * and the previously-active version for that key is deactivated in the same
 * transaction — `getConfig()` always reads the highest active version, so this is the
 * one place "current config" can change, and every prior version stays in the table
 * forever (AC03: historical deals reference an old version, not a live one that moved
 * under them).
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { assertCan } from '@/lib/permissions';
import { marketAccessOrchestrationPolicyProblems } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { updateConfigSchema, zodFieldErrors } from '@/lib/validators';

export async function POST(request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    assertCan(principal, 'config.edit');

    const body = await request.json().catch(() => null);
    const parsed = updateConfigSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const { key, value, description } = parsed.data;

    if (value === undefined || value === null || (typeof value === 'object' && Object.keys(value).length === 0)) {
      throw validationError([{ field: 'value', code: 'required', message: 'Provide the new config value.' }]);
    }
    if (key === 'agent.capacity') {
      const target = (value as { target_exporters_per_agent?: unknown }).target_exporters_per_agent;
      if (!Number.isInteger(target) || Number(target) < 1 || Number(target) > 500) {
        throw validationError([{ field: 'target_exporters_per_agent', code: 'invalid', message: 'Enter a whole-number target from 1 to 500.' }]);
      }
    }

    if (key === 'country_truth.market_access_orchestration') {
      const problems = marketAccessOrchestrationPolicyProblems(value);
      if (problems.length) throw validationError(problems.map((message) => ({ field: 'value', code: 'invalid', message })));
    }

    const created = await prisma.$transaction(async (tx) => {
      const current = await tx.configSetting.findFirst({ where: { key, is_active: true }, orderBy: { version: 'desc' } });
      const nextVersion = (current?.version ?? 0) + 1;

      if (current) {
        await tx.configSetting.update({ where: { id: current.id }, data: { is_active: false } });
      }

      const row = await tx.configSetting.create({
        data: {
          key,
          version: nextVersion,
          value: value as object,
          description: description ?? current?.description ?? null,
          is_active: true,
        },
      });

      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.config_change,
        object_type: 'config_setting',
        object_id: row.id,
        before_summary: current ? { key, version: current.version } : null,
        after_summary: { key, version: row.version, change_reason: description ?? null },
        correlation_id: correlationId,
      });

      return row;
    });

    return NextResponse.json(single(created), { status: 201, headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
