/**
 * Activates one already-imported, already-qualified AuthorityRelease.
 *
 * Import and qualification each have their own per-family script (e.g.
 * import-korea-release.ts, import-norway-release.ts, qualify-bulk-release.ts). Activation is
 * generic across every source family — it is the same `activateAuthorityRelease` call regardless
 * of which authority the release belongs to — so it has one script rather than one per family.
 *
 * A bulk-archive family cannot be activated without a passing qualification already recorded
 * against these exact bytes and this exact parser version (`releaseQualificationVerdict`,
 * enforced inside `activateAuthorityRelease` itself); this script does not bypass that.
 *
 *   railway run npx tsx scripts/activate-authority-release.ts \
 *     --actor-email=ops@example.com --release-id=<id>
 */
import { randomUUID } from 'node:crypto';
import { OrgTier } from '@prisma/client';
import { activateAuthorityRelease } from '@/lib/market-access/authority-releases';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';

const arg = (name: string) => process.argv.find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string) => process.argv.includes(`--${name}`);

function required(name: string) {
  const value = arg(name)?.trim();
  if (!value) throw new Error(`Missing --${name}=...`);
  return value;
}

async function main() {
  const actorEmail = required('actor-email').toLowerCase();
  const releaseId = required('release-id');

  const user = await prisma.user.findUnique({ where: { email: actorEmail } });
  if (!user) throw new Error(`No ClearTrade user exists for ${actorEmail}.`);
  const actor: Principal = {
    id: user.id, email: user.email, name: user.name ?? '', role: user.role,
    exporter_org_id: user.exporter_org_id, tier: OrgTier.paid,
  };

  const updated = await activateAuthorityRelease({
    actor,
    release_id: releaseId,
    correlation_id: randomUUID(),
    acknowledge_unqualified: flag('acknowledge-unqualified'),
  });

  console.log(JSON.stringify({
    release_id: updated.id,
    source_family: updated.source_family,
    release_identifier: updated.release_identifier,
    status: updated.status,
    activated_at: updated.activated_at,
  }, null, 2));
}

main().finally(() => prisma.$disconnect());
