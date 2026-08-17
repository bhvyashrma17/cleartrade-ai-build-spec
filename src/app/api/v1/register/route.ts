/**
 * Registration. `POST /api/v1/register`.
 *
 * Two paths, and the first is the important one:
 *
 *   - **A guest is upgrading.** The existing ExporterOrg and User are filled in and the
 *     tier flips guest -> free **in place**. Nothing is copied, moved or recreated, so
 *     the org id never changes and every row already pointing at it — discovery runs
 *     above all — stays attached and simply becomes visible history. Losing someone's
 *     search at the exact moment they sign up is the worst possible time to lose it.
 *   - **No guest session.** A fresh free tenant is created.
 *
 * On an email collision we reject and leave the guest session intact rather than merging
 * into the existing account: moving rows between tenants is precisely what tenantScope()
 * exists to prevent, so it is not something to do implicitly during a signup.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { CommitmentFeeStatus, EvidenceOrigin, OrgTier, UserRole, type Prisma } from '@prisma/client';
import { getPrincipal, hashPassword } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { getFeePolicy } from '@/lib/config';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { registerSchema, zodFieldErrors } from '@/lib/validators';

const EMAIL_TAKEN = validationError(
  [{ field: 'email', code: 'taken', message: 'An account with this email already exists. Sign in instead.' }],
  'An account with this email already exists.',
);

/** Shape of the ad-hoc snapshot written by POST /api/v1/discovery-runs. */
interface AdHocSnapshot {
  source?: string;
  description?: string | null;
  hs_code?: string | null;
}

export async function POST(request: NextRequest) {
  const correlationId = newCorrelationId();

  try {
    const body = await request.json().catch(() => ({}));
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) return errorResponse(validationError(zodFieldErrors(parsed.error)), correlationId);
    const input = parsed.data;
    const email = input.email.toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw EMAIL_TAKEN;

    const principal = await getPrincipal();
    const isGuestUpgrade = principal?.tier === OrgTier.guest && Boolean(principal.exporter_org_id);
    const passwordHash = await hashPassword(input.password);

    // The commitment fee becomes due the moment registration completes — "CTA into
    // registration, then the commitment fee" (docs/14 §5 guest lifecycle). Snapshotted
    // once here, outside the transaction (a config read, not a write), and reused by
    // both branches below so a guest-upgrade and a fresh signup owe an identically-priced
    // fee. Same "rule of record" as a deal's quoted terms — never re-read live once due.
    const feePolicy = await getFeePolicy();
    const commitmentFeeDue = {
      commitment_fee_status: CommitmentFeeStatus.due,
      commitment_fee_amount: feePolicy.commitment_fee.amount,
      commitment_fee_currency: feePolicy.commitment_fee.currency,
      commitment_fee_policy_version: feePolicy.version,
      commitment_fee_due_at: new Date(),
    };

    const result = await prisma.$transaction(async (tx) => {
      if (isGuestUpgrade) {
        const orgId = principal!.exporter_org_id!;

        // Upgrade in place. Same org id, same user id — every DiscoveryRun, AuditEvent
        // and any other row already referencing this tenant survives untouched.
        const org = await tx.exporterOrg.update({
          where: { id: orgId },
          data: {
            display_name: input.organization_name,
            tier: OrgTier.free,
            upgraded_at: new Date(),
            // No longer a purge candidate.
            guest_expires_at: null,
            ...commitmentFeeDue,
          },
          select: { id: true, display_name: true, tier: true },
        });

        await tx.user.update({
          where: { id: principal!.id },
          data: { email, name: input.name, password_hash: passwordHash },
        });

        // Opt-in only: turn the ad-hoc search context into a real Product. This is a
        // registration incentive, never an automatic side effect of signing up.
        let savedProductId: string | null = null;
        if (input.save_discovery_input_as_product) {
          const lastAdHocRun = await tx.discoveryRun.findFirst({
            where: { exporter_org_id: orgId, product_id: null },
            orderBy: { created_at: 'desc' },
            select: { id: true, input_snapshot: true },
          });
          const snapshot = lastAdHocRun?.input_snapshot as AdHocSnapshot | null;
          if (snapshot?.description) {
            const product = await tx.product.create({
              data: {
                exporter_org_id: orgId,
                name: snapshot.description.slice(0, 120),
                description: snapshot.description,
                hs_code: snapshot.hs_code ?? null,
                hs_code_source: snapshot.hs_code ? 'unverified_registration_input' : 'unknown',
                hs_classification_status: snapshot.hs_code ? 'needs_review' : null,
                evidence_origin:EvidenceOrigin.manually_entered_real,
              },
              select: { id: true },
            });
            savedProductId = product.id;
            // Backfill the run so the saved history points at the product it became.
            await tx.discoveryRun.update({
              where: { id: lastAdHocRun!.id },
              data: { product_id: product.id },
            });
          }
        }

        const retainedRuns = await tx.discoveryRun.count({ where: { exporter_org_id: orgId } });

        await writeAuditEvent({
          db: tx,
          actor: principal,
          action: AUDIT_ACTIONS.update,
          object_type: 'exporter_org',
          object_id: orgId,
          exporter_org_id: orgId,
          before_summary: { tier: OrgTier.guest },
          after_summary: {
            tier: OrgTier.free,
            upgraded_in_place: true,
            retained_discovery_runs: retainedRuns,
            saved_product_id: savedProductId,
          } as Prisma.InputJsonValue,
          correlation_id: correlationId,
        });

        return {
          exporter_org_id: org.id,
          tier: org.tier,
          upgraded_in_place: true,
          retained_discovery_runs: retainedRuns,
          saved_product_id: savedProductId,
        };
      }

      // No guest session — a plain new free tenant.
      const org = await tx.exporterOrg.create({
        data: { display_name: input.organization_name, tier: OrgTier.free, ...commitmentFeeDue },
        select: { id: true, tier: true },
      });
      const user = await tx.user.create({
        data: {
          email,
          name: input.name,
          password_hash: passwordHash,
          role: UserRole.exporter_owner,
          exporter_org_id: org.id,
        },
        select: { id: true, role: true },
      });

      await writeAuditEvent({
        db: tx,
        actor: { id: user.id, email, name: input.name, role: user.role, exporter_org_id: org.id, tier: org.tier },
        action: AUDIT_ACTIONS.create,
        object_type: 'exporter_org',
        object_id: org.id,
        exporter_org_id: org.id,
        after_summary: { tier: OrgTier.free, upgraded_in_place: false },
        correlation_id: correlationId,
      });

      return {
        exporter_org_id: org.id,
        tier: org.tier,
        upgraded_in_place: false,
        retained_discovery_runs: 0,
        saved_product_id: null,
      };
    });

    // The caller signs in normally afterwards: a guest session is not a credentialed one,
    // and the new password should be exercised immediately.
    return NextResponse.json(single(result), {
      status: 201,
      headers: { 'x-correlation-id': correlationId },
    });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
