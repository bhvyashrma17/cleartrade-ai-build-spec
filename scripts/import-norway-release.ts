/**
 * Imports one Tolletaten release from data.toll.no.
 *
 * Norway is a bulk-archive family, so this deliberately imports WITHOUT activating: the operational
 * gate requires the retained artifact to exist before it can be measured. The order is
 * import → `scripts/qualify-bulk-release.ts --family=NO_TOLLETATEN` → activate.
 *
 *   railway run npx tsx scripts/import-norway-release.ts --actor-email=ops@example.com --release=2026-09-03
 *   railway run npx tsx scripts/import-norway-release.ts --actor-email=... --release=... --activate
 *
 * Resource URLs are resolved from the authority's own CKAN API rather than hardcoded, so a
 * republished resource is followed instead of silently 404ing.
 */
import { randomUUID } from 'node:crypto';
import { OrgTier } from '@prisma/client';
import { acquireAndImportNorwayRelease } from '@/lib/market-access/providers/norway-service';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';

const arg = (name: string) => process.argv.find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string) => process.argv.includes(`--${name}`);

const UA = { 'user-agent': 'Mozilla/5.0 (compatible; ClearTrade-Customs-Atlas/1.0)', accept: 'application/json' };

function required(name: string) {
  const value = arg(name)?.trim();
  if (!value) throw new Error(`Missing --${name}=...`);
  return value;
}

/** Resolve a dataset's JSON download URL from Tolletaten's CKAN metadata. */
async function resolveJsonResource(dataset: string): Promise<string> {
  const response = await fetch(`https://data.toll.no/api/3/action/package_show?id=${dataset}`, { headers: UA });
  if (!response.ok) throw new Error(`data.toll.no returned HTTP ${response.status} for dataset ${dataset}`);
  const body = await response.json() as { result?: { license_id?: string; resources?: Array<{ format?: string; url?: string }> } };
  const licence = body.result?.license_id;
  // The licence is re-checked per dataset at import time, not assumed from a previous run: an
  // authority can relicense, and this pack's whole basis is that CC-BY-4.0 is attached per dataset.
  if (licence !== 'CC-BY-4.0') {
    throw new Error(`Dataset ${dataset} reports licence "${licence ?? 'none'}", not CC-BY-4.0. Refusing to import under an unverified licence.`);
  }
  const url = body.result?.resources?.find((r) => r.format === 'JSON')?.url;
  if (!url) throw new Error(`Dataset ${dataset} publishes no JSON resource.`);
  return url;
}

async function main() {
  const actorEmail = required('actor-email').toLowerCase();
  const releaseIdentifier = required('release');
  const referenceDate = new Date(`${arg('reference-date') ?? releaseIdentifier}T00:00:00.000Z`);
  if (Number.isNaN(referenceDate.getTime())) throw new Error('--reference-date must be YYYY-MM-DD.');

  const user = await prisma.user.findUnique({ where: { email: actorEmail } });
  if (!user) throw new Error(`No ClearTrade user exists for ${actorEmail}.`);
  const actor: Principal = {
    id: user.id, email: user.email, name: user.name ?? '', role: user.role,
    exporter_org_id: user.exporter_org_id, tier: OrgTier.paid,
  };

  const [rates, goods, groups, agreements] = await Promise.all([
    resolveJsonResource('tollavgiftssats'),
    resolveJsonResource('varenummer'),
    resolveJsonResource('landgruppe'),
    resolveJsonResource('ratetradeagreements'),
  ]);
  console.log('All four datasets confirmed CC-BY-4.0.');

  const imported = await acquireAndImportNorwayRelease({
    actor,
    release_identifier: releaseIdentifier,
    reference_date: referenceDate,
    activate: flag('activate'),
    correlation_id: randomUUID(),
    acquisition: {
      release_identifier: releaseIdentifier,
      rates_url: rates,
      goods_url: goods,
      country_groups_url: groups,
      trade_agreements_url: agreements,
    },
  });

  console.log(JSON.stringify({
    release_id: imported.release.id,
    release_identifier: imported.release.release_identifier,
    checksum: imported.release.checksum,
    size_bytes: imported.release.size_bytes,
    status: imported.release.status,
    created: imported.created,
    change: imported.change,
    validation: imported.release.validation,
  }, null, 2));
}

main().finally(() => prisma.$disconnect());
