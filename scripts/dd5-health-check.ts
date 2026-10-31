/**
 * Owner-approved idea 3 (E-042): the scoring's health across India's export sectors, on staging.
 *
 *   npx tsx --env-file=tmp/rw/operator.env scripts/dd5-health-check.ts [--top=100] [--year=2024] [--codes=100630,741810] [--org=<exporter org id>] [--out=report.json]
 *
 * Takes India's top export products by value in the newest CEPII BACI HS22 year (every chapter
 * partition is read once), or the codes given, scores each as a v5 run would from stored data only,
 * without the exporter's own figures, and compares its top 10 with India's own top destinations.
 * No Comtrade calls, tariff look-ups or FX fetches are made. The rows it could write are counted
 * before and after, and the report says if any count moved. Refuses production. Prints no secrets.
 * `--org` is whose market-access evidence scope is read; by default the "[TEST] DD5 archetypes"
 * exporter's.
 */
import { writeFileSync } from 'node:fs';
import { getConfig } from '@/lib/config';
import { ARCHETYPE_EXPORTER_NAME } from '@/lib/demand-discovery-v5/archetype-runs';
import { indiaTopExports, scoreProductOffline, summarizeHealthCheck, type HealthCheckProduct } from '@/lib/demand-discovery-v5/health-check';
import { prisma } from '@/lib/prisma';
import { validateDatabaseEnvironment } from '@/lib/runtime-config';

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)?.trim() || undefined;

/** The rows a run's inputs could write if a provider switch were on; none may move. */
async function writableCounts() {
  const [evidence, snapshots, rates, audit, jobs, runs] = await Promise.all([
    prisma.sourceEvidence.count(), prisma.marketAccessEvidenceSnapshot.count(), prisma.exchangeRateQuote.count(),
    prisma.auditEvent.count(), prisma.job.count(), prisma.discoveryRun.count(),
  ]);
  return { source_evidence: evidence, market_access_snapshots: snapshots, exchange_rates: rates, audit_events: audit, jobs, discovery_runs: runs };
}

async function main() {
  const database = validateDatabaseEnvironment('worker');
  if (database.environment === 'production' || process.env.DATABASE_ENVIRONMENT === 'production') throw new Error('dd5-health-check refuses production.');
  const top = Number(arg('top') ?? 100);
  if (!Number.isInteger(top) || top < 1 || top > 500) throw new Error('--top must be an integer from 1 to 500.');
  const orgId = arg('org') ?? (await prisma.exporterOrg.findFirst({ where: { display_name: ARCHETYPE_EXPORTER_NAME }, select: { id: true } }))?.id;
  if (!orgId) throw new Error(`Name an exporter with --org=<id>; no "${ARCHETYPE_EXPORTER_NAME}" exporter exists here.`);

  const before = await writableCounts();
  const codes = arg('codes')?.split(',').map((code) => code.trim()).filter((code) => /^\d{6}$/.test(code));
  const selection = codes?.length
    ? { source: 'codes given', products: codes.map((hs6) => ({ hs6, india_usd: 0 })) }
    : await indiaTopExports({ top, year: arg('year') ? Number(arg('year')) : undefined }).then((ranked) => ({ source: `India's top ${top} exports in CEPII BACI ${ranked.dataset_version} (HS22), ${ranked.year}`, products: ranked.products }));

  const config = await getConfig('demand_discovery.v5');
  const asOf = new Date();
  const results: HealthCheckProduct[] = [];
  for (const [index, product] of selection.products.entries()) {
    const result = await scoreProductOffline(product, { as_of: asOf, exporter_org_id: orgId, config });
    results.push(result);
    console.error(`${index + 1}/${selection.products.length} ${product.hs6}: ${result.status === 'compared' ? `${result.verdict} (${result.overlap}/${result.india_top?.length ?? 0})` : `failed: ${result.error}`}`);
  }
  const after = await writableCounts();
  const moved = Object.entries(after).filter(([key, value]) => before[key as keyof typeof before] !== value).map(([key]) => key);

  const report = {
    environment: database.environment, database_fingerprint: database.database_fingerprint.slice(0, 12), generated_at: asOf.toISOString(),
    policy_version: config.policy.policy_version, selection: selection.source, org_scope: orgId,
    writes: moved.length ? { moved } : 'none: every counted table unchanged',
    summary: summarizeHealthCheck(results), products: results,
  };
  const out = arg('out');
  if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, products: out ? `${results.length} products in ${out}` : results }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
