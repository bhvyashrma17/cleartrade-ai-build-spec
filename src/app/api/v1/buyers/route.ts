/**
 * GET /api/v1/buyers — EXP-06 Buyer Discovery search.
 *
 * Buyer is a global entity (no exporter_org_id column), so "tenant-scoped" here means
 * what docs/09 §5 actually asks for a search endpoint: the caller must be authorized
 * to search buyers *in the context of* a specific exporter org, not that Buyer rows
 * themselves are filtered by tenant (src/lib/permissions.ts `canSearchBuyers`).
 */

import { OrgTier, VerificationStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { getConfig, resolvePagination } from '@/lib/config';
import { errorResponse, list, newCorrelationId, pageMeta, upgradeRequired, validationError } from '@/lib/errors';
import { assertCan, assertPermitted, can, canSearchBuyers, isExporter } from '@/lib/permissions';
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
    const where: Prisma.BuyerWhereInput = {
      ...(country ? { country_code: country.toUpperCase() } : {}),
      ...(verificationStatus ? { verification_status: verificationStatus as VerificationStatus } : {}),
    };

    const { page, per_page, skip, take } = await resolvePagination({
      page: params.get('page'),
      per_page: params.get('per_page'),
    });

    // Guests get a hard ceiling on how deep they can page. The run cap limits AI spend;
    // it does nothing to stop someone walking the whole buyer dataset a page at a time,
    // and the buyer list IS the proprietary asset even with contacts withheld.
    const guestPolicy = await getConfig('guest.policy');
    const isGuest = principal.tier === OrgTier.guest;
    if (isGuest && skip + take > guestPolicy.max_buyer_results) {
      throw upgradeRequired(
        OrgTier.free,
        `Free accounts can browse beyond the first ${guestPolicy.max_buyer_results} buyers.`,
      );
    }

    const [rows, total] = await Promise.all([
      prisma.buyer.findMany({
        where,
        orderBy: { last_activity_at: 'desc' },
        skip,
        take,
        // Explicit projection. Previously this was a bare findMany, which happened not to
        // return contacts only because they are a relation — one later `include` would
        // have leaked them silently. The tier decides this now, in one visible place.
        select: {
          id: true,
          legal_name: true,
          display_name: true,
          country_code: true,
          website: true,
          buyer_type: true,
          import_activity_summary: true,
          verification_status: true,
          risk_flags: true,
          last_activity_at: true,
          created_at: true,
          updated_at: true,
          _count: { select: { contacts: true } },
          ...(canSeeContacts
            ? {
                contacts: {
                  select: {
                    id: true,
                    name: true,
                    role_title: true,
                    email: true,
                    phone: true,
                    verification_status: true,
                    provenance: true,
                  },
                },
              }
            : {}),
        },
      }),
      prisma.buyer.count({ where }),
    ]);

    // Tell the client WHAT is withheld and why, so the UI can render a labelled locked
    // state rather than a blank space (docs/03 §5: an empty state explains the reason
    // and the next action). `_count.contacts` is a count, never the contacts themselves.
    const data = rows.map(({ _count, ...buyer }) => ({
      ...buyer,
      contacts_total: _count.contacts,
      contacts_locked: !canSeeContacts,
    }));

    return NextResponse.json(
      list(data, {
        ...pageMeta({ page, per_page, total }),
        contacts_locked: !canSeeContacts,
        ...(canSeeContacts ? {} : { contacts_unlock_tier: OrgTier.free }),
      }),
      { headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
