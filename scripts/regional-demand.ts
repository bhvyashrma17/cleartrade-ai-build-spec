/**
 * Regional demand for a v5 run's markets, from the operator's machine (D-033, docs/38).
 *
 *   npx tsx --env-file=<staging operator env> scripts/regional-demand.ts request --run=<discovery run id> --actor-email=<ops supervisor or assigned agent> [--countries=US]
 *   npx tsx --env-file=<staging operator env> scripts/regional-demand.ts status --run=<discovery run id> [--top=5]
 *
 * `request` asks for the regional view of every market in the run that has an official regional
 * source (or only `--countries`), exactly as the market page's button does; the worker reads the
 * figures. An unfinished request for a market is reused, not repeated. `status` shows each market's
 * newest run and, when it has finished, the period, India's total and the top states and ports.
 *
 * Refuses production. Prints no secrets (the Census key is never read here).
 */
import { randomUUID } from 'node:crypto';
import { OrgTier } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { RegionalDemandResultV1 } from '@/lib/regional-demand/census';
import { REGIONAL_SOURCES, requestRegionalDemand } from '@/lib/regional-demand/service';
import { validateDatabaseEnvironment } from '@/lib/runtime-config';
import type { Principal } from '@/types';

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)?.trim();
const USAGE = 'Usage: regional-demand.ts request --run=<id> --actor-email=<staff> [--countries=US] | status --run=<id> [--top=5]';

async function main() {
  const database = validateDatabaseEnvironment('worker');
  if (database.environment === 'production' || process.env.DATABASE_ENVIRONMENT === 'production') throw new Error('regional-demand refuses production.');
  const command = process.argv[2];
  const runId = arg('run');
  if (!runId) throw new Error(`Missing --run. ${USAGE}`);
  const run = await prisma.discoveryRun.findUnique({ where: { id: runId }, select: { id: true, status: true, model_version: true, exporter_org_id: true } });
  if (!run) throw new Error(`No discovery run ${runId}.`);
  const header = { environment: database.environment, database_fingerprint: database.database_fingerprint.slice(0, 12), run: run.id, run_status: run.status, model_version: run.model_version };
  const countries = (arg('countries') ?? Object.keys(REGIONAL_SOURCES).join(',')).split(',').map((code) => code.trim().toUpperCase()).filter(Boolean);
  const markets = await prisma.marketAssessment.findMany({
    where: { run_id: run.id, country_code: { in: countries.filter((code) => REGIONAL_SOURCES[code]) } },
    select: { id: true, country_code: true, rank: true, market_status: true, handed_off: true },
    orderBy: { country_code: 'asc' },
  });

  if (command === 'request') {
    const email = arg('actor-email')?.toLowerCase();
    if (!email) throw new Error(`Missing --actor-email. ${USAGE}`);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error(`No ClearTrade user exists for ${email}.`);
    const actor: Principal = { id: user.id, email: user.email, name: user.name ?? '', role: user.role, exporter_org_id: user.exporter_org_id, tier: OrgTier.paid };
    const correlationId = randomUUID();
    const results = [];
    for (const market of markets) {
      try {
        const { run: regional, created } = await requestRegionalDemand({ market_assessment_id: market.id, actor, trigger: 'operator', correlation_id: correlationId });
        results.push({ country_code: market.country_code, rank: market.rank, regional_demand_run_id: regional.id, job_id: regional.job_id, status: regional.status, reused: !created });
      } catch (error) {
        results.push({ country_code: market.country_code, rank: market.rank, refused: error instanceof Error ? error.message : String(error) });
      }
    }
    console.log(JSON.stringify({ ...header, requested: results, next: `Wait a minute, then: scripts/regional-demand.ts status --run=${run.id}` }, null, 2));
    return;
  }

  if (command === 'status') {
    const top = Number(arg('top') ?? 5);
    if (!Number.isInteger(top) || top < 1 || top > 15) throw new Error('--top must be an integer from 1 to 15.');
    const rows = [];
    for (const market of markets) {
      const latest = await prisma.regionalDemandRun.findFirst({ where: { market_assessment_id: market.id }, orderBy: { created_at: 'desc' } });
      const result = (latest?.result ?? null) as RegionalDemandResultV1 | null;
      rows.push({
        country_code: market.country_code, rank: market.rank, market_status: market.market_status, handed_off: market.handed_off,
        regional: latest ? {
          id: latest.id, status: latest.status, trigger: latest.trigger, reason: latest.reason, created_at: latest.created_at.toISOString(), completed_at: latest.completed_at?.toISOString() ?? null,
          ...(result ? {
            period: result.period.label, india_value_usd: result.totals.india_value_usd, world_value_usd: result.totals.world_value_usd, india_share_percent: result.totals.india_share_percent,
            container_share_percent: result.totals.container_share_percent,
            importer_count: result.totals.importer_count ?? null,
            top: Object.fromEntries(result.views.map((view) => [view.kind, view.measure === 'importers'
              ? view.areas.slice(0, top).map((area) => `${area.name}: ${area.importer_count} importers${area.towns.length ? ` (${area.towns.join(', ')})` : ''}`)
              : view.areas.slice(0, top).map((area) => `${area.name} (${area.code}): India $${Math.round(area.india_value_usd).toLocaleString('en-US')}`)])),
          } : {}),
        } : null,
      });
    }
    console.log(JSON.stringify({ ...header, markets: rows }, null, 2));
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
