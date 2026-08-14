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
import { assertCan, assertPermitted, can, canSearchBuyers } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const params = request.nextUrl.searchParams;

    const exporterOrgId = params.get('exporter_org_id');
    const productId = params.get('product_id');

    if (!exporterOrgId) {
      throw validationError(
        [{ field: 'exporter_org_id', code: 'required', message: 'exporter_org_id is required.' }],
        'Tell us which exporter this buyer search is for.',
      );
    }
    if (!productId) throw validationError([{ field: 'product_id', code: 'required', message: 'product_id is required because fit is contextual.' }]);

    // Capability + tier first (so a tier denial reads as UPGRADE_REQUIRED), then scope.
    assertCan(principal, 'buyer_discovery.run');
    await assertPermitted(canSearchBuyers(principal, { exporter_org_id: exporterOrgId }));

    // Contacts are the paid asset. `buyer_contact.view` is guest:none / free+:allowed,
    // and this is the ONLY place that decides whether they are projected.
    const canSeeContacts = can(principal, 'buyer_contact.view');

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
    const buyerWhere: Prisma.BuyerWhereInput = { sanctions_blocked: false, deprioritized: false,
      ...(country ? { country_code: country.toUpperCase() } : {}),
      ...(verificationStatus ? { verification_status: verificationStatus as VerificationStatus } : {}) };

    const { page, per_page, skip, take } = await resolvePagination({
      page: params.get('page'),
      per_page: params.get('per_page'),
    });

    const [rows, total] = await Promise.all([
      prisma.buyerFitAssessment.findMany({
        where: { exporter_org_id: exporterOrgId, product_id: productId, score: { not: null }, buyer: buyerWhere },
        orderBy: { score: 'desc' },
        skip,
        take,
        select: {
          score: true, confidence_score: true, components: true, model_version: true, computed_at: true,
          buyer: { select: { id:true,legal_name:true,display_name:true,country_code:true,website:true,buyer_type:true,import_activity_summary:true,verification_status:true,risk_flags:true,last_activity_at:true,created_at:true,updated_at:true,
            _count:{select:{contacts:true}}, ...(canSeeContacts ? { contacts:{select:{id:true,name:true,role_title:true,email:true,phone:true,verification_status:true,provenance:true}} } : {}) } },
        },
      }),
      prisma.buyerFitAssessment.count({ where: { exporter_org_id: exporterOrgId, product_id: productId, score: { not: null }, buyer: buyerWhere } }),
    ]);

    // Tell the client WHAT is withheld and why, so the UI can render a labelled locked
    // state rather than a blank space (docs/03 §5: an empty state explains the reason
    // and the next action). `_count.contacts` is a count, never the contacts themselves.
    const data = rows.map(({ buyer: { _count, ...buyer }, ...fit }) => ({
      ...buyer,
      fit,
      contacts_total: _count.contacts,
      contacts_locked: !canSeeContacts,
    }));

    return NextResponse.json(
      list(data, {
        ...pageMeta({ page, per_page, total }),
        contacts_locked: !canSeeContacts,
      }),
      { headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
