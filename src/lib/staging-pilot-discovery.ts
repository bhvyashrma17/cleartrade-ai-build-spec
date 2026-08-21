import { createHash } from 'node:crypto';
import { EvidenceOrigin, JobStatus, Prisma, type PrismaClient } from '@prisma/client';
import { BUYER_FIT_MODEL_VERSION, BUYER_FIT_POLICY, BUYER_FIT_POLICY_HASH } from '@/lib/buyer-intelligence';
import { scoringPolicyHash } from '@/lib/discovery/policy';

export const PILOT_DISCOVERY_FIXTURE_KEY = 'phase9-alpha-discovery-v1';
const NOW = new Date('2026-08-20T09:00:00.000Z');
const DEMAND_POLICY = {
  version: 3, model_version: 'market-attractiveness-v3', profile: 'general',
  weights: { demand_strength: .2, growth_momentum: .1, competitive_opportunity: .1, market_access: .15, export_economics: .15, exporter_market_fit: .1, logistics_feasibility: .1, risk_resilience: .1 },
};
const DEMAND_HASH = scoringPolicyHash(DEMAND_POLICY);
const weights = DEMAND_POLICY.weights;

const MARKETS = [
  { country: 'DE', score: 88, confidence: 94, parts: [92, 86, 82, 90, 87, 91, 84, 88], rationale: 'Strong observed demand, practical market access, and a close exporter fit.' },
  { country: 'AE', score: 76, confidence: 89, parts: [81, 78, 70, 86, 79, 77, 82, 68], rationale: 'Good regional demand and logistics, with moderate competitive pressure.' },
  { country: 'US', score: 58, confidence: 82, parts: [74, 69, 55, 43, 61, 64, 52, 47], rationale: 'Large demand, offset by gate-sensitive access and logistics evidence.' },
] as const;

const BUYERS = [
  { key: 'A', name: '[PILOT] Synthetic Rhine Foods GmbH', country: 'DE', score: 91, confidence: 100, parts: [96, 89, 92, 87], recommendation: 'strong' },
  { key: 'B', name: '[PILOT] Synthetic Gulf Pantry LLC', country: 'AE', score: 72, confidence: 100, parts: [78, 73, 69, 68], recommendation: 'medium' },
  { key: 'C', name: '[PILOT] Synthetic Atlantic Staples Inc', country: 'US', score: 43, confidence: 75, parts: [62, 48, 22, 40], recommendation: 'weak_gate_sensitive' },
] as const;

function componentProvenance(score: number, key: keyof typeof weights, country: string) {
  return { source: 'staging_pilot_fixture', retrieved_at: NOW.toISOString(), basis: `Deterministic synthetic ${country} UAT evidence`, row_count: 12, component_weight: weights[key], effective_renormalized_weight: weights[key], score };
}

export async function seedAlphaDiscoveryFixture(db: PrismaClient) {
  const alphaOwner = await db.user.findUnique({ where: { email: 'exporter-a@pilot.invalid' }, select: { exporter_org_id: true, exporter_org: { select: { id: true, display_name: true } } } });
  const alpha = alphaOwner?.exporter_org?.display_name === '[PILOT] Alpha' ? alphaOwner.exporter_org : null;
  if (!alpha) throw new Error('Existing [PILOT] Alpha was not found. Run staging-pilot seed first.');
  const existing = await db.discoveryRun.findFirst({ where: { exporter_org_id: alpha.id, input_snapshot: { path: ['fixture_key'], equals: PILOT_DISCOVERY_FIXTURE_KEY } }, select: { id: true } });
  if (existing) return { created: false, exporterOrgId: alpha.id, runId: existing.id, marketCount: await db.marketAssessment.count({ where: { run_id: existing.id } }), buyerCount: await db.buyerFitAssessment.count({ where: { exporter_org_id: alpha.id, input_snapshot: { path: ['fixture_key'], equals: PILOT_DISCOVERY_FIXTURE_KEY } } }) };

  const product = await db.product.findFirstOrThrow({ where: { exporter_org_id: alpha.id }, orderBy: { created_at: 'asc' } });
  return db.$transaction(async (tx) => {
    const inputSnapshot = { fixture_key: PILOT_DISCOVERY_FIXTURE_KEY, product_id: product.id, product_name: product.name, hs_code: product.hs_code, generated_for: 'staging_agent_uat' };
    const run = await tx.discoveryRun.create({ data: { exporter_org_id: alpha.id, product_id: product.id, status: JobStatus.completed, filters: { countries: MARKETS.map((m) => m.country) }, input_snapshot: inputSnapshot, as_of_date: NOW, scoring_policy_version: DEMAND_POLICY.version, scoring_policy_hash: DEMAND_HASH, scoring_policy_snapshot: DEMAND_POLICY, reproducibility_status: 'deterministic_fixture', started_at: new Date(NOW.getTime() - 60_000), completed_at: NOW, created_at: NOW } });
    for (const market of MARKETS) {
      const [demand, growth, competition, access, economics, fit, logistics, risk] = market.parts;
      const provenance = {
        demand_score: componentProvenance(demand, 'demand_strength', market.country), growth_score: componentProvenance(growth, 'growth_momentum', market.country), competition_score: componentProvenance(competition, 'competitive_opportunity', market.country), market_access_score: componentProvenance(access, 'market_access', market.country), export_economics_score: componentProvenance(economics, 'export_economics', market.country), exporter_market_fit_score: componentProvenance(fit, 'exporter_market_fit', market.country), logistics_feasibility_score: componentProvenance(logistics, 'logistics_feasibility', market.country), risk_resilience_score: componentProvenance(risk, 'risk_resilience', market.country),
        overall_score: { source: 'staging_pilot_fixture', retrieved_at: NOW.toISOString(), basis: 'Deterministic weighted UAT score', row_count: 96, input_evidence: { base_weights: weights, effective_weights: weights } },
      };
      await tx.marketAssessment.create({ data: { run_id: run.id, product_id: product.id, country_code: market.country, overall_score: market.score, demand_score: demand, growth_score: growth, competition_score: competition, market_access_score: access, export_economics_score: economics, exporter_market_fit_score: fit, logistics_feasibility_score: logistics, risk_resilience_score: risk, confidence_score: market.confidence, eligibility_status: 'eligible', eligibility_reasons: [], model_version: DEMAND_POLICY.model_version, weight_profile_key: DEMAND_POLICY.profile, weight_profile_version: 1, as_of_date: NOW, scoring_policy_version: DEMAND_POLICY.version, scoring_policy_hash: DEMAND_HASH, scoring_policy_snapshot: DEMAND_POLICY, reproducibility_status: 'deterministic_fixture', evidence_origins: [EvidenceOrigin.fixture], classification_hs6_code: product.hs_code, classification_itc_hs_code: product.itc_hs_code, classification_nomenclature: 'ITC-HS', classification_version: '2022', rationale: market.rationale, field_provenance: provenance, generated_at: NOW } });
    }

    for (const buyerSpec of BUYERS) {
      const buyer = await tx.buyer.create({ data: { legal_name: buyerSpec.name, display_name: buyerSpec.name, country_code: buyerSpec.country, buyer_type: 'synthetic_importer', verification_status: 'partially_verified', import_activity_summary: { fixture_key: PILOT_DISCOVERY_FIXTURE_KEY, synthetic: true, shipment_count_12m: buyerSpec.key === 'A' ? 18 : buyerSpec.key === 'B' ? 9 : 3 } } });
      await tx.buyerSourceEvidence.create({ data: { buyer_id: buyer.id, source_type: 'staging_pilot_fixture', source_ref: `${PILOT_DISCOVERY_FIXTURE_KEY}-${buyerSpec.key}`, summary: 'Synthetic evidence created only for staging UI transition testing.', observed_at: NOW } });
      await tx.buyerFeatureSnapshot.create({ data: { buyer_id: buyer.id, import_frequency_per_year: buyerSpec.key === 'A' ? 18 : buyerSpec.key === 'B' ? 9 : 3, last_shipment_date: new Date('2026-08-15T00:00:00Z'), shipment_count_12m: buyerSpec.key === 'A' ? 18 : buyerSpec.key === 'B' ? 9 : 3, typical_shipment_size: buyerSpec.key === 'A' ? 1100 : buyerSpec.key === 'B' ? 750 : 250, quantity_unit: 'kg', origin_mix: { IN: buyerSpec.key === 'C' ? 1 : 8, synthetic: true }, india_sourcing_history: true, supplier_concentration: buyerSpec.key === 'A' ? .22 : .55, purchasing_trend: buyerSpec.key === 'A' ? .28 : buyerSpec.key === 'B' ? .08 : -.18, provenance: { fixture_key: PILOT_DISCOVERY_FIXTURE_KEY, source: 'synthetic_uat' }, computed_at: NOW } });
      const [volume, price, cert, outcome] = buyerSpec.parts;
      const rawSnapshot = { fixture_key: PILOT_DISCOVERY_FIXTURE_KEY, product_id: product.id, hs_code: product.hs_code, synthetic_buyer_key: buyerSpec.key, recommendation: buyerSpec.recommendation };
      const snapshotSha256 = createHash('sha256').update(JSON.stringify(rawSnapshot)).digest('hex');
      await tx.buyerFitAssessment.create({ data: { buyer_id: buyer.id, product_id: product.id, exporter_org_id: alpha.id, score: buyerSpec.score, confidence_score: buyerSpec.confidence, components: { volume_fit: { score: volume, evidence: { typical_quantity_kg: buyerSpec.key === 'A' ? 1100 : 500 } }, price_fit: { score: price, evidence: { currency: 'USD', synthetic: true } }, cert_fit: { score: cert, evidence: { gate_sensitive: buyerSpec.key === 'C' } }, outcome_prior: { score: outcome, evidence: { synthetic_observations: buyerSpec.key === 'A' ? 8 : 2 } }, recommendation: buyerSpec.recommendation }, input_snapshot: { ...rawSnapshot, snapshot_sha256: snapshotSha256 }, model_version: BUYER_FIT_MODEL_VERSION, evidence_origins: [EvidenceOrigin.fixture], computed_at: NOW, scoring_policy_version: BUYER_FIT_POLICY.version, scoring_policy_hash: BUYER_FIT_POLICY_HASH, scoring_policy_snapshot: BUYER_FIT_POLICY as unknown as Prisma.InputJsonValue, reproducibility_status: 'deterministic_fixture' } });
    }
    return { created: true, exporterOrgId: alpha.id, runId: run.id, marketCount: MARKETS.length, buyerCount: BUYERS.length };
  });
}
