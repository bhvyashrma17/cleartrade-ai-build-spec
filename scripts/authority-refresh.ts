/**
 * D-029 — the nightly Singapore tariff refresh (`src/lib/market-access/providers/singapore-refresh.ts`).
 *
 * Singapore Statutes Online allows automated extraction only from 03:00 to 07:00 Singapore Time. The
 * worker saves the tariff inside that window; this command switches that on or off, shows its state,
 * runs one attempt now (inside the window only), or acquires a bundle to a file without touching a
 * database — for a machine that can reach SSO when the worker cannot, followed by
 * `import-retained-authority-release.ts --family=SG`.
 *
 *   npx tsx --env-file=<env> scripts/authority-refresh.ts --status
 *   npx tsx --env-file=<env> scripts/authority-refresh.ts --enable --actor-email=<ops supervisor or admin> \
 *     --changed-by=<admin> --reason="Save Singapore's tariff nightly on staging (D-029)" [--activate-changed-tariff]
 *   npx tsx --env-file=<env> scripts/authority-refresh.ts --disable --changed-by=<admin> --reason="..."
 *   npx tsx --env-file=<env> scripts/authority-refresh.ts --run-now [--actor-email=<ops supervisor or admin>]
 *   npx tsx scripts/authority-refresh.ts --acquire-only --out=<file.zip>
 *
 * `--enable`/`--disable` write a new version of `market_access.authority_refresh` exactly as the
 * audited config API does (one active version, history kept, a `config_change` audit event by the
 * admin named in `--changed-by`). `--acquire-only` loads no database module at all. Prints no secrets.
 */
import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { acquireSingaporeAuthorityBundle, SINGAPORE_ORDER_URL, singaporeSsoAcquisitionWindow } from '@/lib/market-access/providers/singapore-acquisition';
import { readSingaporeAuthorityBundle } from '@/lib/market-access/providers/singapore-bundle';
import type { AuthorityRefreshConfig } from '@/lib/config';
import type { Principal } from '@/types';

const KEY = 'market_access.authority_refresh' as const;
const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)?.trim();
const flag = (name: string) => process.argv.includes(`--${name}`);
const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));

function required(name: string) {
  const value = arg(name);
  if (!value) throw new Error(`Missing --${name}=...`);
  return value;
}

/** Acquire in the window and write the bundle to a file; no database is read or written. */
async function acquireOnly() {
  const out = required('out');
  const now = new Date();
  const window = singaporeSsoAcquisitionWindow(now);
  const sgtDay = new Date(window.singapore_clock_epoch).toISOString().slice(0, 10);
  if (window.singapore_hour < 3 || window.singapore_hour >= 6) throw new Error(`Run this between 03:00 and 06:00 Singapore Time; it is ${String(window.singapore_hour).padStart(2, '0')}:xx there now.`);
  const release = `sso-window-${sgtDay}`;
  const bytes = await acquireSingaporeAuthorityBundle({ release_identifier: release, now });
  const bundle = await readSingaporeAuthorityBundle({ bytes, release_identifier: release });
  writeFileSync(out, bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  print({
    file: out, sha256, release_identifier: release, consolidated_as_at: bundle.consolidated_as_at, tariff_line_count: bundle.lines.size,
    canonical_tariff_checksum: bundle.canonical_tariff_checksum,
    import_with: `npx tsx --env-file=<env> scripts/import-retained-authority-release.ts --family=SG --file=${out} --expect-sha256=${sha256} --release=${release} --reference-date=${sgtDay} --retrieved-at=${now.toISOString().slice(0, 10)} --source-url=${SINGAPORE_ORDER_URL} --actor-email=<ops supervisor or admin> [--activate]`,
  });
}

async function main() {
  if (flag('acquire-only')) return acquireOnly();

  // Everything below reads or writes the database named by the environment.
  const [{ OrgTier }, { AUDIT_ACTIONS, writeAuditEvent }, { authorityRefreshConfigProblems, getConfig }, refresh, { can }, { prisma }, { validateDatabaseEnvironment }] = await Promise.all([
    import('@prisma/client'), import('@/lib/audit'), import('@/lib/config'), import('@/lib/market-access/providers/singapore-refresh'),
    import('@/lib/permissions'), import('@/lib/prisma'), import('@/lib/runtime-config'),
  ]);
  try {
    const database = validateDatabaseEnvironment('worker');
    const environment = { environment: database.environment, database_fingerprint: database.database_fingerprint.slice(0, 12) };
    const current = await getConfig(KEY);
    const principal = async (email: string): Promise<Principal> => {
      const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
      if (!user || !user.is_active) throw new Error(`No active ClearTrade user exists for ${email}.`);
      return { id: user.id, email: user.email, name: user.name ?? '', role: user.role, exporter_org_id: user.exporter_org_id, tier: OrgTier.paid };
    };

    if (flag('enable') || flag('disable')) {
      const singapore: AuthorityRefreshConfig['singapore'] = flag('enable')
        ? { ...current.singapore, enabled: true, actor_email: (arg('actor-email') ?? current.singapore.actor_email)?.toLowerCase() ?? null, activate_changed_tariff: flag('activate-changed-tariff') }
        : { ...current.singapore, enabled: false };
      if (singapore.enabled) {
        const actor = await principal(singapore.actor_email ?? required('actor-email'));
        if (!['ops_supervisor', 'admin'].includes(actor.role)) throw new Error(`${actor.email} is ${actor.role}; saved releases must be imported as an ops supervisor or admin.`);
      }
      const value: AuthorityRefreshConfig = { ...current, singapore };
      const problems = authorityRefreshConfigProblems(value);
      if (problems.length) throw new Error(problems.join(' '));
      const changedBy = await principal(required('changed-by'));
      if (!can(changedBy, 'config.edit')) throw new Error(`${changedBy.email} may not change configuration (config.edit is admin-only).`);
      const reason = required('reason');
      const row = await prisma.$transaction(async (tx) => {
        const active = await tx.configSetting.findFirst({ where: { key: KEY, is_active: true }, orderBy: { version: 'desc' } });
        if (active) await tx.configSetting.update({ where: { id: active.id }, data: { is_active: false } });
        const created = await tx.configSetting.create({ data: { key: KEY, version: (active?.version ?? 0) + 1, value: value as unknown as object, description: reason, is_active: true } });
        await writeAuditEvent({
          db: tx, actor: changedBy, action: AUDIT_ACTIONS.config_change, object_type: 'config_setting', object_id: created.id,
          before_summary: active ? { key: KEY, version: active.version } : null,
          after_summary: { key: KEY, version: created.version, change_reason: reason }, correlation_id: randomUUID(),
        });
        return created;
      });
      return print({ ...environment, key: KEY, version: row.version, value: await getConfig(KEY) });
    }

    if (flag('run-now')) {
      const settings = { ...current.singapore, actor_email: arg('actor-email')?.toLowerCase() ?? current.singapore.actor_email };
      const result = await refresh.refreshSingaporeTariff({ settings, operator: true, correlation_id: `authority-refresh-cli:${randomUUID()}` });
      print({ ...environment, result });
      if (result.status === 'failed' || result.status === 'not_due') process.exitCode = 1;
      return;
    }

    print({ ...environment, settings: current.singapore, status: await refresh.singaporeRefreshStatus() });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
