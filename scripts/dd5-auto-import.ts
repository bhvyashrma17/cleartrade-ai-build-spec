/**
 * The daily automatic import of the keyless World Bank and Comtrade inputs (E-040, E-044;
 * `src/lib/demand-discovery-v5/reference-auto-import.ts`): show its state, switch it on or off, or run
 * one import now, as the worker would.
 *
 *   npx tsx --env-file=<env> scripts/dd5-auto-import.ts --status
 *   npx tsx --env-file=<env> scripts/dd5-auto-import.ts --enable --actor-email=<ops supervisor or admin> --changed-by=<admin> --reason="..."
 *   npx tsx --env-file=<env> scripts/dd5-auto-import.ts --disable --changed-by=<admin> --reason="..."
 *   npx tsx --env-file=<env> scripts/dd5-auto-import.ts --run-now
 *
 * `--enable`/`--disable` write a new version of `demand_discovery.v5` as the audited config API does,
 * changing only the two auto-import fields: no admin web session is needed. Refuses production.
 * Prints no secrets.
 */
import { OrgTier } from '@prisma/client';
import { getConfig } from '@/lib/config';
import { autoImportReferenceData, autoImportSource, writeAutoImportSwitch } from '@/lib/demand-discovery-v5/reference-auto-import';
import { loadInputFreshness } from '@/lib/demand-discovery-v5/input-freshness';
import { prisma } from '@/lib/prisma';
import { validateDatabaseEnvironment } from '@/lib/runtime-config';
import type { Principal } from '@/types';

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)?.trim();
const flag = (name: string) => process.argv.includes(`--${name}`);
const USAGE = 'Usage: dd5-auto-import.ts --status | --enable --actor-email=<ops supervisor or admin> --changed-by=<admin> --reason="..." | --disable --changed-by=<admin> --reason="..." | --run-now';

async function principal(email: string): Promise<Principal> {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || !user.is_active) throw new Error(`No active ClearTrade user exists for ${email}.`);
  return { id: user.id, email: user.email, name: user.name ?? '', role: user.role, exporter_org_id: user.exporter_org_id, tier: OrgTier.paid };
}

async function main() {
  const database = validateDatabaseEnvironment('worker');
  if (database.environment === 'production' || process.env.DATABASE_ENVIRONMENT === 'production') throw new Error('dd5-auto-import refuses production.');
  const header = { environment: database.environment, database_fingerprint: database.database_fingerprint.slice(0, 12) };

  if (flag('enable') || flag('disable')) {
    const changedBy = arg('changed-by');
    const reason = arg('reason');
    if (!changedBy || !reason) throw new Error(USAGE);
    const written = await writeAutoImportSwitch({ enabled: flag('enable'), actor_email: arg('actor-email') ?? null, changed_by: await principal(changedBy), reason });
    console.log(JSON.stringify({ ...header, ...written }, null, 2));
    return;
  }
  if (flag('run-now')) {
    console.log(JSON.stringify({ ...header, result: await autoImportReferenceData() }, null, 2));
    return;
  }
  if (flag('status')) {
    const config = await getConfig('demand_discovery.v5');
    const due = (await loadInputFreshness()).filter((row) => autoImportSource(row.key) != null).map((row) => ({ key: row.key, status: row.status, due_at: row.due_at }));
    console.log(JSON.stringify({ ...header, reference_auto_import: config.reference_auto_import, actor_email: config.reference_auto_import_actor_email, refresh_on_new_data: config.refresh_on_new_data, inputs: due }, null, 2));
    return;
  }
  throw new Error(USAGE);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
