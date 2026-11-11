/**
 * E-071 — why a market's duty in a v5 run is an estimate instead of the official rate. Read-only.
 *
 *   npx tsx scripts/explain-official-duty.ts --product-id=<id> --markets=US,GB [--run-id=<id>]
 *
 * For the product's newest finished v5 run (or the run given), per market:
 *   - the run's official tariff look-up outcome (`frozen_inputs.tariff_acquisition`);
 *   - the official duty the run froze, with its reason when there was none (`frozen_inputs.official_duty`);
 *   - the evidence snapshots and tariff rows stored for the market and the product's HS6, with the
 *     fields the run filters on (origin, retrieval time, scope, status, confidence);
 *   - what a tariff-fact selection at the run's tariff clock admits, and what it rejects and why.
 *
 * Checks the database identity first. Writes nothing; prints no secrets.
 */
import { MarketAccessRuleType } from '@prisma/client';
import { selectTariffFactsOnly } from '@/lib/country-truth/fact-selection';
import { DEMAND_DISCOVERY_V5_MODEL } from '@/lib/demand-discovery-v5/model';
import { allowedEvidenceOrigins } from '@/lib/evidence-environment';
import { prisma } from '@/lib/prisma';
import { validateDatabaseEnvironment } from '@/lib/runtime-config';

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)?.trim();
const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);

async function main() {
  const identity = validateDatabaseEnvironment('worker');
  const productId = arg('product-id');
  const runId = arg('run-id');
  const markets = [...new Set((arg('markets') ?? '').split(',').map((code) => code.trim().toUpperCase()).filter((code) => /^[A-Z]{2}$/.test(code)))];
  if (!productId && !runId) throw new Error('Pass --product-id=<id> or --run-id=<id>.');
  if (!markets.length) throw new Error('Pass --markets=US,GB (ISO alpha-2 codes).');

  const run = await prisma.discoveryRun.findFirst({
    where: { ...(runId ? { id: runId } : { product_id: productId }), model_version: DEMAND_DISCOVERY_V5_MODEL, completed_at: { not: null } },
    orderBy: { completed_at: 'desc' },
    select: { id: true, product_id: true, exporter_org_id: true, status: true, created_at: true, completed_at: true, frozen_inputs: true, input_snapshot: true },
  });
  if (!run) throw new Error(`No finished v5 run for ${runId ? `run ${runId}` : `product ${productId}`}.`);
  const frozen = record(run.frozen_inputs);
  const acquisition = record(frozen.tariff_acquisition);
  const official = record(frozen.official_duty);
  const hs6 = String(record(run.input_snapshot).hs_code ?? '');
  if (!/^\d{6}$/.test(hs6)) throw new Error(`Run ${run.id} has no HS6 in its input snapshot.`);
  const tariffClock = new Date(typeof acquisition.tariff_clock === 'string' ? acquisition.tariff_clock : run.created_at.toISOString());
  const origins = allowedEvidenceOrigins();
  const outcomes = Array.isArray(acquisition.outcomes) ? (acquisition.outcomes as Record<string, unknown>[]) : [];

  const report = [];
  for (const market of markets) {
    const snapshots = await prisma.marketAccessEvidenceSnapshot.findMany({
      where: { country_code: market, OR: [{ hs_code_scope: hs6 }, { hs6_code: hs6 }] },
      orderBy: { id: 'asc' },
    });
    const evidence = snapshots.length
      ? await prisma.marketAccessEvidence.findMany({
          where: { snapshot_id: { in: snapshots.map((snapshot) => snapshot.id) }, rule_type: { in: [MarketAccessRuleType.destination_tariff, MarketAccessRuleType.preferential_tariff_india] } },
          orderBy: { id: 'asc' },
        })
      : [];
    // The run reads only snapshots and rows of an allowed origin retrieved by its tariff clock.
    const readable = snapshots.filter((snapshot) => origins.includes(snapshot.evidence_origin) && snapshot.retrieved_at <= tariffClock);
    const readableRows = evidence.filter((row) => readable.some((snapshot) => snapshot.id === row.snapshot_id) && origins.includes(row.evidence_origin) && row.retrieved_at <= tariffClock);
    const selection = selectTariffFactsOnly({
      scope: { exporter_org_id: run.exporter_org_id, country_code: market, hs6, hs_revision: String(official.hs_revision ?? 'HS22'), as_of_date: tariffClock.toISOString(), origin_country_code: 'IN' },
      snapshots: readable,
      evidence: readableRows,
    });
    report.push({
      market,
      lookup: outcomes.find((outcome) => outcome.country_code === market) ?? null,
      frozen_official_duty: record(official.markets)[market] ?? null,
      snapshots: snapshots.map((snapshot) => ({
        id: snapshot.id, provider: snapshot.provider, source_dataset: snapshot.source_dataset, evidence_origin: snapshot.evidence_origin,
        retrieved_at: iso(snapshot.retrieved_at), hs_code_scope: snapshot.hs_code_scope, hs6_code: snapshot.hs6_code,
        classification_resolution: snapshot.classification_resolution, read_by_run: readable.includes(snapshot),
      })),
      tariff_rows: evidence.map((row) => ({
        id: row.id, snapshot_id: row.snapshot_id, rule_type: row.rule_type, status: row.status, evidence_origin: row.evidence_origin,
        hs_code_scope: row.hs_code_scope, national_tariff_code: row.national_tariff_code, duty_expression: row.duty_expression,
        tariff_rate_percent: row.tariff_rate_percent?.toString() ?? null, confidence: row.confidence?.toString() ?? null,
        preference_applicability: row.preference_applicability, retrieved_at: iso(row.retrieved_at), effective_at: iso(row.effective_at),
        expires_at: iso(row.expires_at), superseded_at: iso(row.superseded_at), read_by_run: readableRows.includes(row),
      })),
      admitted: selection.tariffs.map((fact) => ({ id: fact.id, ...(fact.state === 'present' ? { value: fact.value, confidence: fact.confidence, assertion_class: fact.provenance.assertion_class } : { state: fact.state }) })),
      rejected: selection.rejected,
    });
  }
  console.log(JSON.stringify({
    environment: identity.environment,
    run: { id: run.id, status: run.status, hs6, created_at: iso(run.created_at), completed_at: iso(run.completed_at), tariff_clock: tariffClock.toISOString(), official_minimum_confidence: official.minimum_confidence ?? null },
    allowed_evidence_origins: origins,
    markets: report,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
