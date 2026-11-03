/**
 * Real buyers for a product from an official importer list, from the operator's machine (D-033, docs/38 §2).
 *
 *   npx tsx --env-file=<staging operator env> scripts/buyer-discovery.ts request --product=<product id> --countries=GB,CA --actor-email=<ops supervisor or assigned agent>
 *   npx tsx --env-file=<staging operator env> scripts/buyer-discovery.ts status --product=<product id> [--top=10]
 *
 * `request` starts the same job as the agent's "Find buyers" button, one per market. `status` lists
 * the buyers found for the product per market: score, place and why, highest first.
 * Refuses production.
 */
import { randomUUID } from 'node:crypto';
import { OrgTier } from '@prisma/client';
import { BUYER_DISCOVERY_MODEL, requestBuyerDiscovery } from '@/lib/buyer-discovery/service';
import { prisma } from '@/lib/prisma';
import { validateDatabaseEnvironment } from '@/lib/runtime-config';
import type { Principal } from '@/types';

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)?.trim();
const USAGE = 'Usage: buyer-discovery.ts request --product=<id> --countries=GB,CA --actor-email=<staff> | status --product=<id> [--top=10]';

async function main() {
  const database = validateDatabaseEnvironment('worker');
  if (database.environment === 'production' || process.env.DATABASE_ENVIRONMENT === 'production') throw new Error('buyer-discovery refuses production.');
  const productId = arg('product');
  if (!productId) throw new Error(`Missing --product. ${USAGE}`);
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, name: true, exporter_org_id: true, hs_code: true, hs_classification_status: true } });
  if (!product) throw new Error(`No product ${productId}.`);
  const header = { environment: database.environment, database_fingerprint: database.database_fingerprint.slice(0, 12), product: { id: product.id, name: product.name, hs_code: product.hs_code, status: product.hs_classification_status } };

  if (process.argv[2] === 'request') {
    const email = arg('actor-email')?.toLowerCase();
    if (!email) throw new Error(`Missing --actor-email. ${USAGE}`);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error(`No ClearTrade user exists for ${email}.`);
    const actor: Principal = { id: user.id, email: user.email, name: user.name ?? '', role: user.role, exporter_org_id: user.exporter_org_id, tier: OrgTier.paid };
    const results = [];
    for (const country of (arg('countries') ?? 'GB,CA').split(',').map((code) => code.trim().toUpperCase()).filter(Boolean)) {
      try {
        const job = await requestBuyerDiscovery({ exporter_org_id: product.exporter_org_id, product_id: product.id, country_code: country, actor, trigger: 'operator', correlation_id: randomUUID() });
        results.push({ country_code: country, job_id: job.id, status: job.status });
      } catch (error) {
        results.push({ country_code: country, refused: error instanceof Error ? error.message : String(error) });
      }
    }
    console.log(JSON.stringify({ ...header, requested: results, next: `Wait a minute, then: scripts/buyer-discovery.ts status --product=${product.id}` }, null, 2));
    return;
  }
  if (process.argv[2] === 'status') {
    const top = Number(arg('top') ?? 10);
    const fits = await prisma.buyerFitAssessment.findMany({
      where: { product_id: product.id, exporter_org_id: product.exporter_org_id, model_version: BUYER_DISCOVERY_MODEL },
      include: { buyer: { select: { display_name: true, country_code: true, buyer_type: true, sanctions_blocked: true, risk_flags: true, import_activity_summary: true } } },
      orderBy: [{ score: 'desc' }, { buyer_id: 'asc' }],
    });
    const byCountry = new Map<string, typeof fits>();
    for (const fit of fits) byCountry.set(fit.buyer.country_code, [...(byCountry.get(fit.buyer.country_code) ?? []), fit]);
    const markets = [...byCountry].map(([country, rows]) => ({
      country_code: country, buyers: rows.length, blocked: rows.filter((row) => row.buyer.sanctions_blocked).length,
      not_screened: rows.filter((row) => JSON.stringify(row.buyer.risk_flags).includes('SCREENING_INCOMPLETE')).length,
      top: rows.slice(0, top).map((row) => {
        const summary = (row.buyer.import_activity_summary ?? {}) as { town?: string; postcode?: string; region_name?: string };
        const why = ((row.components as { summary_lines?: string[] }).summary_lines ?? [])[0] ?? null;
        return { name: row.buyer.display_name, score: row.score, type: row.buyer.buyer_type, place: [summary.town, summary.postcode, summary.region_name].filter(Boolean).join(' · '), why };
      }),
    }));
    console.log(JSON.stringify({ ...header, markets }, null, 2));
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
