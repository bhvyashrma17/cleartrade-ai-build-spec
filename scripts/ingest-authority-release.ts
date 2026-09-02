import { randomUUID } from 'node:crypto';
import { OrgTier } from '@prisma/client';
import { acquireAndImportCanadaRelease } from '@/lib/market-access/providers/canada-service';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string) => process.argv.includes(`--${name}`);

function required(name: string) {
  const value = arg(name)?.trim();
  if (!value) throw new Error(`Missing --${name}=...`);
  return value;
}

async function main() {
  const country = required('country').toUpperCase();
  if (country !== 'CA') {
    throw new Error('Only CA is implemented. JP, AE and BR remain licence/source-contract gated.');
  }
  const actorEmail = required('actor-email').toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: actorEmail } });
  if (!user) throw new Error(`No ClearTrade user exists for ${actorEmail}.`);
  const actor: Principal = {
    id: user.id,
    email: user.email,
    name: user.name ?? '',
    role: user.role,
    exporter_org_id: user.exporter_org_id,
    tier: OrgTier.paid,
  };
  const effective = new Date(`${required('effective-date')}T00:00:00.000Z`);
  if (Number.isNaN(effective.getTime())) throw new Error('--effective-date must be YYYY-MM-DD.');
  const releaseIdentifier = required('release');
  const tariffUrl = required('tariff-url');
  const countryTreatmentsUrl = required('country-treatments-url');
  const imported = await acquireAndImportCanadaRelease({
    actor,
    release_identifier: releaseIdentifier,
    reference_date: effective,
    activate: flag('activate'),
    correlation_id: randomUUID(),
    acquisition: {
      release_identifier: releaseIdentifier,
      tariff_url: tariffUrl,
      country_treatments_url: countryTreatmentsUrl,
    },
  });
  console.log(JSON.stringify({
    release_id: imported.release.id,
    release_identifier: imported.release.release_identifier,
    checksum: imported.release.checksum,
    status: imported.release.status,
    created: imported.created,
    change: imported.change,
  }));
}

main().finally(() => prisma.$disconnect());
