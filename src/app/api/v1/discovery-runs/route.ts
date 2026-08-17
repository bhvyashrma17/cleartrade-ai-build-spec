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
 * would limit AI spend but not database growth.
 */

import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { JobType, OrgTier, type Prisma } from '@prisma/client';
import { getPrincipal, signIn } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { errorResponse, jobAlreadyRunning, newCorrelationId, notFound, upgradeRequired, validationError } from '@/lib/errors';
import { enqueueJob, findInFlightJob } from '@/lib/jobs';
import { assertCan, minTierFor, tenantScope, tierMeets } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { allowedEvidenceOrigins,isRealWorkflowEnvironment } from '@/lib/evidence-environment';
import {
  consumeGuestRunQuota,
  guestMintProof,
  hashClientIp,
  mintGuest,
  peekGuestRunQuota,
  resolveClientIp,
} from '@/lib/guest';
import { createDiscoveryRunSchema, zodFieldErrors } from '@/lib/validators';
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

    // --- Product context: saved Product, or ad-hoc snapshot ---
    let productId: string | null = null;
    let inputSnapshot: Prisma.InputJsonValue;

    if (input.product_id) {
      // Saved products are tenant-scoped — never trust a product id from the client.
      const scope = await tenantScope(principal);
      const product = await prisma.product.findFirst({
        where: { id: input.product_id, ...scope,...(isRealWorkflowEnvironment()?{evidence_origin:{in:allowedEvidenceOrigins()}}:{}) },
        select: { id: true, name: true, hs_code: true, itc_hs_code:true,hs_nomenclature:true,hs_nomenclature_version:true,hs_classification_status:true,hs_classification_method:true,hs_classification_confidence:true,hs_classification_revision:true,hs_confirmed_by_id:true,hs_confirmed_at:true,description: true,evidence_origin:true,capacity_value:true,capacity_unit:true, price_target_amount:true,price_target_currency:true,price_target_quantity_unit:true,price_target_incoterm:true,lead_time_days: true,delivery_commitment_days:true,logistics_constraint_codes:true,logistics_constraints_confirmed:true, desired_order_size_amount: true, desired_order_size_currency: true, customization_capability: true, packaging_capability: true, moq_value: true, moq_unit: true, certifications: { select: { code: true, name: true, status: true, evidence_ref: true,valid_until:true } },exporter_org:{select:{country:true,state:true,city:true,pickup_location_code:true,preferred_origin_gateway:true}} },
      });
      if (!product) throw notFound('That product is not available.');
      if(product.hs_classification_status!=='confirmed'||!product.hs_code||!/^\d{6}$/.test(product.hs_code)||!product.hs_nomenclature||!product.hs_nomenclature_version)throw validationError([{field:'product_id',code:'classification_unconfirmed',message:'Confirm an exact HS6/ITC-HS classification before running Demand Discovery.'}]);
      const confirmedClassification=await prisma.productClassification.findFirst({where:{product_id:product.id,status:'confirmed'},orderBy:{confirmed_at:'desc'},select:{id:true,revision:true}});if(!confirmedClassification)throw validationError([{field:'product_id',code:'classification_history_missing',message:'The confirmed code has no classification history and must be reviewed again.'}]);
      productId = product.id;
      inputSnapshot = {
        source: 'product',
        product_id: product.id,
        evidence_origin:product.evidence_origin,
        name: product.name,
        hs_code: product.hs_code,
        itc_hs_code:product.itc_hs_code,
        classification_nomenclature:product.hs_nomenclature,
        classification_version:product.hs_nomenclature_version,
        classification_method:product.hs_classification_method,
        classification_confidence:product.hs_classification_confidence?.toString()??null,
        classification_id:confirmedClassification.id,
        classification_revision:confirmedClassification.revision,
        classification_confirmed_by_id:product.hs_confirmed_by_id,
        classification_confirmed_at:product.hs_confirmed_at?.toISOString()??null,
        description: product.description,
        origin_country: product.exporter_org.country,
        origin_state: product.exporter_org.state,
        origin_city: product.exporter_org.city,
        origin_location_code: product.exporter_org.pickup_location_code,
        origin_gateway: product.exporter_org.preferred_origin_gateway,
        price_target_amount: product.price_target_amount?.toString() ?? null,
        price_target_currency: product.price_target_currency,
        price_target_quantity_unit: product.price_target_quantity_unit,
        price_target_incoterm: product.price_target_incoterm,
        capacity_value:product.capacity_value?.toString()??null,
        capacity_unit:product.capacity_unit,
        lead_time_days: product.lead_time_days,
        delivery_commitment_days: product.delivery_commitment_days,
        logistics_constraint_codes: product.logistics_constraint_codes,
        logistics_constraints_confirmed: product.logistics_constraints_confirmed,
        desired_order_size_amount: product.desired_order_size_amount?.toString() ?? null,
        desired_order_size_currency: product.desired_order_size_currency,
        customization_capability: product.customization_capability,
        packaging_capability: product.packaging_capability,
        moq_value: product.moq_value?.toString() ?? null,
        moq_unit: product.moq_unit,
        certifications: product.certifications.map(certification=>({...certification,valid_until:certification.valid_until?.toISOString()??null})),
        target_countries: input.target_countries ?? [],
      };
    } else {
      throw validationError([{field:'product_id',code:'classification_required',message:'Save the product and confirm its tariff classification before running Demand Discovery.'}]);
      // Ad-hoc. No Product row is created — for a guest this snapshot is the only record
      // of what was searched, and it is what registration offers to save as a Product.
      inputSnapshot = {
        source: 'ad_hoc',
        evidence_origin:isRealWorkflowEnvironment()?'manually_entered_real':'fixture',
        description: input.product_description ?? null,
        hs_code: input.hs_code ?? null,
        target_countries: input.target_countries ?? [],
      };
    }

    // "An equivalent job is already running" is scoped to this tenant + this exact input,
    // so a double-submitted search attaches to the running job (docs/09 §3: action buttons
    // are idempotent while an equivalent job is active) while a genuinely different search
    // proceeds. Hashed because the description is free text of unbounded length.
    const dedupeKey = `demand_discovery:${orgId}:${createHash('sha256')
      .update(JSON.stringify(inputSnapshot))
      .digest('hex')
      .slice(0, 32)}`;

    // Checked BEFORE creating the run and before charging a returning guest, so a
    // double-clicked search costs neither an orphaned DiscoveryRun row nor one of the
    // guest's two free searches. `enqueueJob` re-checks under the unique constraint,
    // which is what actually holds under a race; this is the cheap, friendly path.
    const inFlight = await findInFlightJob(dedupeKey);
    if (inFlight) throw jobAlreadyRunning(inFlight.id);

    // A returning guest spends against the IP budget — but only now that we know this is
    // genuinely new work. Metering the session instead of the IP would make the cap free
    // to bypass by clearing a cookie.
    if (!mintedGuest && principal.tier === OrgTier.guest) {
      await consumeGuestRunQuota(requireClientIpHash(request));
    }

    const asOfDate=new Date();
    inputSnapshot={...(inputSnapshot as Record<string,Prisma.JsonValue>),as_of_date:asOfDate.toISOString()} as Prisma.InputJsonValue;

    const run = await prisma.$transaction(async (tx) => {
      const created = await tx.discoveryRun.create({
        data: {
          exporter_org_id: orgId,
          product_id: productId,
          requested_by_id: principal.id,
          input_snapshot: inputSnapshot,
          as_of_date: asOfDate,
          filters: (input.target_countries?.length
            ? { target_countries: input.target_countries }
            : {}) as Prisma.InputJsonValue,
        },
      });

      // Guest runs are audited like any other mutation. Retention, not the write path, is
      // what makes them "not saved" (see docs/14).
      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.create,
        object_type: 'discovery_run',
        object_id: created.id,
        exporter_org_id: orgId,
        after_summary: { input_source: productId ? 'product' : 'ad_hoc', tier: principal.tier },
        correlation_id: correlationId,
      });

      return created;
    });

    // Enqueued AFTER the run row commits: a job whose target does not exist yet would be
    // claimable by a worker before the transaction lands. The quota was already consumed
    // above, so a guest cannot get extra AI work by racing this step.
    const job = await enqueueJob({
      type: JobType.demand_discovery,
      payload: { discovery_run_id: run.id },
      exporter_org_id: orgId,
      requested_by_id: principal.id,
      target_type: 'discovery_run',
      target_id: run.id,
      dedupe_key: dedupeKey,
      correlation_id: correlationId,
    });

    await prisma.discoveryRun.update({ where: { id: run.id }, data: { job_id: job.id } });

    const quota =
      principal.tier === OrgTier.guest ? await peekGuestRunQuota(requireClientIpHash(request)) : null;

    // 202: discovery is an async job, never a held request (docs/09 §3).
    return NextResponse.json(
      {
        job_id: job.id,
        status: job.status,
        target: { type: 'discovery_run', id: run.id },
        meta: {
          tier: principal.tier,
          guest_session_started: mintedGuest,
          ...(quota
            ? { runs_used: quota.used, runs_limit: quota.limit, resets_at: quota.resets_at.toISOString() }
            : {}),
        },
      },
      { status: 202, headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
