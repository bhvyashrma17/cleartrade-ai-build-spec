/**
 * Retention for unconverted guest tenants.
 *
 * This is the other half of "guests save nothing". The write path is normal — docs/09 §3
 * requires durable job state that survives a refresh, and that applies to a guest's
 * discovery run exactly as it does to a paying tenant's. What makes a guest run "not
 * saved" is that it is never surfaced as history and it is deleted here once the
 * retention window lapses.
 *
 * Without this the ExporterOrg and User tables grow monotonically with anonymous
 * traffic: every cleared cookie mints a new tenant, and the IP quota bounds AI spend but
 * not row count.
 *
 * Safety properties:
 *   - Only ever touches tier = guest. An upgrade sets tier = free AND clears
 *     guest_expires_at, so a converted tenant can never be selected here even if its old
 *     expiry timestamp had lingered.
 *   - Never deletes a guest that has converted, by definition of the above.
 *   - Cascades handle the children (DiscoveryRun, MarketAssessment, Product...) via the
 *     onDelete: Cascade already declared on those relations.
 */

import { OrgTier } from '@prisma/client';
import { getConfig } from '@/lib/config';
import { prisma } from '@/lib/prisma';

export interface PurgeResult {
  orgs_deleted: number;
  quota_rows_deleted: number;
  cutoff: Date;
}

/**
 * Delete expired guest tenants and stale quota buckets.
 *
 * `dryRun` reports what would be removed without removing it — worth using the first
 * time this runs against a real dataset.
 */
export async function purgeExpiredGuests(options: { dryRun?: boolean; now?: Date } = {}): Promise<PurgeResult> {
  const now = options.now ?? new Date();
  const policy = await getConfig('guest.policy');

  // Belt and braces: expiry is stamped at mint time, but an org created before the field
  // existed (or by a fixture) may have none — fall back to age from created_at.
  const ageCutoff = new Date(now.getTime() - policy.run_retention_days * 86_400_000);

  const expired = await prisma.exporterOrg.findMany({
    where: {
      tier: OrgTier.guest,
      OR: [{ guest_expires_at: { lte: now } }, { guest_expires_at: null, created_at: { lte: ageCutoff } }],
    },
    select: { id: true },
  });
  const expiredIds = expired.map((o) => o.id);

  // Quota buckets are keyed on a hashed IP, not on an org, so they outlive the tenants
  // and need their own sweep. Two windows of history is plenty for debugging.
  const quotaCutoff = new Date(now.getTime() - policy.quota_window_hours * 2 * 3_600_000);

  if (options.dryRun) {
    const quotaRows = await prisma.guestRunQuota.count({ where: { window_start: { lt: quotaCutoff } } });
    return { orgs_deleted: expiredIds.length, quota_rows_deleted: quotaRows, cutoff: quotaCutoff };
  }

  let orgsDeleted = 0;
  if (expiredIds.length > 0) {
    // Users are not cascaded from ExporterOrg (the relation is optional, so deleting the
    // org would orphan them rather than remove them). Delete them explicitly first.
    await prisma.$transaction(async (tx) => {
      await tx.auditEvent.deleteMany({ where: { exporter_org_id: { in: expiredIds } } });
      await tx.user.deleteMany({ where: { exporter_org_id: { in: expiredIds } } });
      const result = await tx.exporterOrg.deleteMany({
        // Re-assert the tier filter inside the transaction: the id list was read outside
        // it, and this delete must never be able to touch a tenant that upgraded in the
        // meantime.
        where: { id: { in: expiredIds }, tier: OrgTier.guest },
      });
      orgsDeleted = result.count;
    });
  }

  const quota = await prisma.guestRunQuota.deleteMany({ where: { window_start: { lt: quotaCutoff } } });

  return { orgs_deleted: orgsDeleted, quota_rows_deleted: quota.count, cutoff: quotaCutoff };
}
