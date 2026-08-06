/**
 * GET /api/v1/buyers — EXP-06 Buyer Discovery search.
 *
 * Buyer is a global entity (no exporter_org_id column), so "tenant-scoped" here means
 * what docs/09 §5 actually asks for a search endpoint: the caller must be authorized
 * to search buyers *in the context of* a specific exporter org, not that Buyer rows
 * themselves are filtered by tenant (src/lib/permissions.ts `canSearchBuyers`).
 */

import { VerificationStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { resolvePagination } from '@/lib/config';
import { errorResponse, list, newCorrelationId, pageMeta, validationError } from '@/lib/errors';
import { assertPermitted, canSearchBuyers, isExporter } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const params = request.nextUrl.searchParams;

    // Never trust a client-supplied org id for an exporter principal — only the org
    // they're actually tenanted to. Agents/ops must name the org they're searching for.
    const exporterOrgId = isExporter(principal)
      ? (principal.exporter_org_id as string)
      : params.get('exporter_org_id');

    if (!exporterOrgId) {
      throw validationError(
        [{ field: 'exporter_org_id', code: 'required', message: 'exporter_org_id is required.' }],
        'Tell us which exporter this buyer search is for.',
      );
    }

    await assertPermitted(canSearchBuyers(principal, { exporter_org_id: exporterOrgId }));

    const verificationStatus = params.get('verification_status');
    if (verificationStatus && !Object.values(VerificationStatus).includes(verificationStatus as VerificationStatus)) {
      throw validationError([
        {
          field: 'verification_status',
          code: 'invalid',
          message: `Must be one of: ${Object.values(VerificationStatus).join(', ')}.`,
        },
      ]);
    }

    const country = params.get('country');
    const where: Prisma.BuyerWhereInput = {
      ...(country ? { country_code: country.toUpperCase() } : {}),
      ...(verificationStatus ? { verification_status: verificationStatus as VerificationStatus } : {}),
    };

    const { page, per_page, skip, take } = await resolvePagination({
      page: params.get('page'),
      per_page: params.get('per_page'),
    });

    const [rows, total] = await Promise.all([
      prisma.buyer.findMany({ where, orderBy: { last_activity_at: 'desc' }, skip, take }),
      prisma.buyer.count({ where }),
    ]);

    return NextResponse.json(list(rows, { ...pageMeta({ page, per_page, total }) }), {
      headers: { 'x-correlation-id': correlationId },
    });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
