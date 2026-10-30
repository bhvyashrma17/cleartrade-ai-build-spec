/**
 * EXP-04 Demand Discovery — run creation. `POST /api/v1/discovery-runs`.
 *
 * This is the guest entry point into the product: **the guest tenant is minted here, on
 * the first search, not on a page view.** Browsing costs nothing and creates nothing;
 * only an actual run does.
 *
 * Ordering in this handler is a security control, not a style choice:
 *
 *   1. resolve + hash the client IP
 *   2. consume IP quota          <- throws 429 before ANY row is written
 *   3. mint the guest tenant
 *   4. issue the guest session
 *   5. authorize (role + tier), validate, then create the run
 *
 * If 2 and 3 were swapped, a script that clears its cookie between requests would grow
 * ExporterOrg without bound even while every search was correctly rejected — the quota
 * would limit AI spend but not database growth. *
 * Runs go to Demand Discovery v5 only (D-036). The earlier engines are retired, so where v5 is
 * not available (no BACI release, or switched off in config) the request is refused with the
 * reason instead of falling back.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { OrgTier } from '@prisma/client';
import { getPrincipal, signIn } from '@/lib/auth';
import { errorResponse, newCorrelationId, notFound, prerequisitesNotMet, upgradeRequired, validationError } from '@/lib/errors';
import { assertCan, minTierFor, tenantScope, tierMeets } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { allowedEvidenceOrigins, isRealWorkflowEnvironment } from '@/lib/evidence-environment';
import {
  consumeGuestRunQuota,
  guestMintProof,
  hashClientIp,
  mintGuest,
  resolveClientIp,
} from '@/lib/guest';
import { createDiscoveryRunSchema, zodFieldErrors } from '@/lib/validators';
import { demandDiscoveryV5Availability, startDemandDiscoveryV5 } from '@/lib/demand-discovery-v5/service';
import type { Principal } from '@/types';

/**
 * The IP is required for anonymous callers — without it the quota is unenforceable and
 * we would be handing out unmetered AI spend. Authenticated callers are already
 * accountable via their tenant, so a missing header only blocks the anonymous path.
 */
function requireClientIpHash(request: NextRequest): string {
  const ip = resolveClientIp(request.headers);
  if (!ip) {
    throw validationError([
      { field: 'ip', code: 'unavailable', message: 'Could not identify the request source.' },
    ]);
  }
  return hashClientIp(ip);
}

export async function POST(request: NextRequest) {
  const correlationId = newCorrelationId();

  try {
    const body = await request.json().catch(() => ({}));
    const parsed = createDiscoveryRunSchema.safeParse(body);
    if (!parsed.success) return errorResponse(validationError(zodFieldErrors(parsed.error)), correlationId);
    const input = parsed.data;

    let principal = await getPrincipal();
    let mintedGuest = false;

    // Full Demand Discovery moved to `paid` tier (docs/14 §3 tier change — the pre-
    // membership estimate at guest/free is now `POST /api/v1/market-estimates`). An
    // anonymous caller can therefore NEVER satisfy this capability — guest is the tier
    // ceiling for a session that doesn't exist yet. Reject before minting a tenant or
    // spending IP quota on a request that was always going to fail: `tierMeets` is exactly
    // the "no principal, check the anonymous floor" seam it exists for.
    if (!principal && !tierMeets(OrgTier.guest, 'demand_discovery.run')) {
      throw upgradeRequired(minTierFor('demand_discovery.run'));
    }

    // --- Anonymous caller: quota first, then mint. Never the other way round. ---
    // A brand-new guest has no prior jobs, so there is nothing to deduplicate against and
    // this ordering stands: quota before any write.
    if (!principal) {
      const ipHash = requireClientIpHash(request);
      await consumeGuestRunQuota(ipHash); // throws RATE_LIMITED — nothing written yet

      const guest = await mintGuest();
      await signIn('guest', {
        userId: guest.user_id,
        proof: guestMintProof(guest.user_id),
        redirect: false,
      });

      principal = {
        id: guest.user_id,
        email: guest.email,
        name: 'Guest',
        role: 'exporter_owner',
        exporter_org_id: guest.org_id,
        tier: OrgTier.guest,
      } satisfies Principal;
      mintedGuest = true;
    }

    // Capability + tier before scope, so a tier denial reads as UPGRADE_REQUIRED rather
    // than a bare FORBIDDEN (see the convention in src/lib/permissions.ts).
    assertCan(principal, 'demand_discovery.run');

    const orgId = principal.exporter_org_id;
    if (!orgId) {
      // Staff have no tenant of their own to run discovery against.
      throw validationError([
        { field: 'exporter_org_id', code: 'required', message: 'Select an exporter to run discovery for.' },
      ]);
    }

    // --- Product context: a saved, classified Product only ---
    if (!input.product_id) {
      throw validationError([{ field: 'product_id', code: 'classification_required', message: 'Save the product and confirm its tariff classification before running Demand Discovery.' }]);
    }
    // Saved products are tenant-scoped — never trust a product id from the client.
    const scope = await tenantScope(principal);
    const product = await prisma.product.findFirst({
      where: { id: input.product_id, ...scope, ...(isRealWorkflowEnvironment() ? { evidence_origin: { in: allowedEvidenceOrigins() } } : {}) },
      select: { id: true, hs_code: true, hs_nomenclature: true, hs_nomenclature_version: true, hs_classification_status: true },
    });
    if (!product) throw notFound('That product is not available.');
    if (product.hs_classification_status !== 'confirmed' || !product.hs_code || !/^\d{6}$/.test(product.hs_code) || !product.hs_nomenclature || !product.hs_nomenclature_version) {
      throw validationError([{ field: 'product_id', code: 'classification_unconfirmed', message: 'Confirm an exact HS6/ITC-HS classification before running Demand Discovery.' }]);
    }
    const confirmedClassification = await prisma.productClassification.findFirst({ where: { product_id: product.id, status: 'confirmed' }, orderBy: { confirmed_at: 'desc' }, select: { id: true } });
    if (!confirmedClassification) throw validationError([{ field: 'product_id', code: 'classification_history_missing', message: 'The confirmed code has no classification history and must be reviewed again.' }]);

    // Demand Discovery v5 is the only engine (D-036, docs/36): the earlier engines are retired, so
    // where v5 is not available nothing runs and the reason is returned.
    const availability = await demandDiscoveryV5Availability();
    if (!availability.available) {
      throw prerequisitesNotMet(
        [{ object_type: 'demand_discovery_v5', object_id: 'availability', reason: availability.reason }],
        `${availability.reason} No run was started: the earlier discovery engines are retired.`,
      );
    }
    const started = await startDemandDiscoveryV5({ product_id: product.id, actor: principal, trigger: 'manual', correlation_id: correlationId, target_countries: input.target_countries });
    // 202: discovery is an async job, never a held request (docs/09 §3).
    return NextResponse.json(
      { job_id: started.job_id, status: started.status, target: { type: 'discovery_run', id: started.run_id }, meta: { tier: principal.tier, guest_session_started: mintedGuest, model_version: 'market-opportunity-v5' } },
      { status: 202, headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
