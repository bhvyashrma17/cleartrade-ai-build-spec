import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { OrgTier } from '@prisma/client';
import { acquireAndImportCanadaRelease } from '@/lib/market-access/providers/canada-service';
import { importGeorgiaRelease } from '@/lib/market-access/providers/geo-service';
import { importPhilippinesRelease } from '@/lib/market-access/providers/philippines-service';
import { importTaiwanRelease } from '@/lib/market-access/providers/taiwan-service';
import { acquireAndImportIsraelRelease } from '@/lib/market-access/providers/israel-service';
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
  if (!['CA', 'TW', 'GE', 'IL', 'PH'].includes(country)) {
    throw new Error('Supported authority-release imports are CA, TW, GE, IL and the controlled manual PH composite.');
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
  const correlationId = randomUUID();
  const common = { actor, release_identifier: releaseIdentifier, reference_date: effective, activate: flag('activate'), correlation_id: correlationId };
  const imported = country === 'CA'
    ? await acquireAndImportCanadaRelease({
      ...common,
      acquisition: {
        release_identifier: releaseIdentifier,
        tariff_url: required('tariff-url'),
        country_treatments_url: required('country-treatments-url'),
      },
    })
    : country === 'TW'
      ? await importTaiwanRelease({ ...common, bytes: readFileSync(required('file')), source_url: required('source-url') })
      : country === 'GE'
        ? await importGeorgiaRelease({ ...common, bytes: readFileSync(required('file')), source_url: required('source-url') })
        : country === 'IL'
          ? await acquireAndImportIsraelRelease({ ...common, acquisition: { release_identifier: releaseIdentifier } })
          : await importPhilippinesRelease({ ...common, bytes: readFileSync(required('file')), source_url: required('source-url') });
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
