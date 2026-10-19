import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { OrgTier, UserRole } from '@prisma/client';
import { recordManualTariffCapture } from '@/lib/market-access/manual-capture-service';
import { __test__ as runInputs } from '@/lib/demand-discovery-v5/run-inputs';
import { dutyInputs } from '@/lib/demand-discovery-v5/duty-inputs';
import { scoreDuty } from '@/lib/demand-discovery-v5/metrics';
import { metricSentence } from '@/lib/demand-discovery-v5/explain';
import { DEMAND_DISCOVERY_V5_DEFAULT_POLICY as POLICY } from '@/lib/demand-discovery-v5/policy';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';

/** D-024: an agent records the official duty for a market whose duty is only estimated; v5 then uses it, saying an agent read it. */
async function fixture() {
  const s = randomUUID().slice(0, 8);
  const org = await prisma.exporterOrg.create({ data: { display_name: `Capture ${s}`, tier: OrgTier.paid }, select: { id: true } });
  const user = (role: UserRole, tag: string) => prisma.user.create({ data: { email: `${tag}-${s}@t.test`, name: role, role }, select: { id: true } });
  const [agent, stranger, ops, owner] = await Promise.all([user(UserRole.agent, 'agent'), user(UserRole.agent, 'stranger'), user(UserRole.ops_supervisor, 'ops'), user(UserRole.exporter_owner, 'owner')]);
  await prisma.agentAssignment.create({ data: { exporter_org_id: org.id, agent_user_id: agent.id, status: 'active' } });
  const run = await prisma.discoveryRun.create({ data: { exporter_org_id: org.id, model_version: 'market-opportunity-v5', input_snapshot: { hs_code: '741810', classification_version: 'HS2022' } }, select: { id: true } });
  const assessment = await prisma.marketAssessment.create({
    data: {
      run_id: run.id, country_code: 'MM', confidence_score: 60, model_version: 'market-opportunity-v5', weight_profile_key: 'demand-discovery-v5-policy-v5',
      weight_profile_version: 1, scoring_policy_hash: 'hash-v5', reproducibility_status: 'reproducible', classification_hs6_code: '741810',
      market_status: 'ranked', rank: 1, live_points: 80, overall_score: 70, data_year: 2024,
    },
    select: { id: true },
  });
  const principal = (id: string, role: UserRole): Principal => ({ id, email: `${role}@t.test`, name: role, role, exporter_org_id: role === UserRole.exporter_owner ? org.id : null, tier: OrgTier.paid });
  return { orgId: org.id, assessmentId: assessment.id, agent: principal(agent.id, UserRole.agent), stranger: principal(stranger.id, UserRole.agent), ops: principal(ops.id, UserRole.ops_supervisor), owner: principal(owner.id, UserRole.exporter_owner) };
}

const line = (assessmentId: string, overrides: Record<string, string> = {}) => ({
  market_assessment_id: assessmentId, national_tariff_code: '7418.10.00', description: 'Table, kitchen or other household articles of copper',
  duty_expression: '10%', effective_from: '2026-04-01', source_reference: 'https://www.mopf.gov.mm/sites/default/files/Customs%20Tariff%20of%20Myanmar%202022_0.pdf', ...overrides,
});

describe('recording an official duty by hand', () => {
  test('an assigned agent records the line; it is stored as manually entered evidence with an audit event', async () => {
    const f = await fixture();
    const correlation = randomUUID();
    const recorded = await recordManualTariffCapture({ actor: f.agent, input: line(f.assessmentId), correlation_id: correlation, now: new Date('2026-10-17T08:00:00Z') });
    expect(recorded).toMatchObject({ country_code: 'MM', hs6: '741810', national_tariff_code: '74181000', duty_expression: '10%', source_authority: expect.stringContaining('Myanmar') });
    const snapshot = await prisma.marketAccessEvidenceSnapshot.findUniqueOrThrow({ where: { id: recorded.snapshot_id } });
    expect(snapshot).toMatchObject({ country_code: 'MM', provider: 'authoritative_manual', evidence_origin: 'manually_entered_real' });
    expect(await prisma.auditEvent.count({ where: { object_type: 'market_access_manual_capture', object_id: recorded.snapshot_id, correlation_id: correlation } })).toBe(1);
  });

  test('only an assigned agent or Ops may record; the market and HS code come from the assessment', async () => {
    const f = await fixture();
    await expect(recordManualTariffCapture({ actor: f.stranger, input: line(f.assessmentId), correlation_id: randomUUID() })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(recordManualTariffCapture({ actor: f.owner, input: line(f.assessmentId), correlation_id: randomUUID() })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(recordManualTariffCapture({ actor: f.ops, input: line(f.assessmentId), correlation_id: randomUUID() })).resolves.toMatchObject({ country_code: 'MM' });
    // A line that is not beneath the analysis's HS6, a missing source or date: refused, nothing stored.
    await expect(recordManualTariffCapture({ actor: f.agent, input: line(f.assessmentId, { national_tariff_code: '85171300' }), correlation_id: randomUUID() })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(recordManualTariffCapture({ actor: f.agent, input: line(f.assessmentId, { source_reference: 'the PDF' }), correlation_id: randomUUID() })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(recordManualTariffCapture({ actor: f.agent, input: line(f.assessmentId, { effective_from: 'April' }), correlation_id: randomUUID() })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('the next run reads the recorded line as the official duty and says an agent read it', async () => {
    const f = await fixture();
    await recordManualTariffCapture({ actor: f.agent, input: line(f.assessmentId, { effective_from: '2025-01-01' }), correlation_id: randomUUID(), now: new Date('2026-10-17T08:00:00Z') });
    const official = await runInputs.officialDuties({
      markets: ['MM'], hs6: '741810', as_of: new Date('2026-10-18T00:00:00Z'), exporter_org_id: f.orgId, hs_revision: 'HS2022',
      minimum_confidence: POLICY.duty.official_minimum_confidence, usd: async () => ({ rate: 1, frozen: null }),
    });
    const resolution = official.resolutions.get('MM');
    expect(resolution).toMatchObject({ status: 'percent', duty_percent: 10, recorded_by_agent: true });
    const duty = dutyInputs({ markets: ['MM'], hs6: '741810', as_of: new Date('2026-10-18T00:00:00Z'), official: official.resolutions, primary_tariffs: new Map(), manufactured_tariffs: new Map(), agreements: [], policy: POLICY }).get('MM')!;
    const scored = scoreDuty(duty, POLICY, { official: 1, estimate: 0.5, agent_recorded: POLICY.quality.official_agent_recorded });
    expect(scored).toMatchObject({ quality: 0.9, inputs: { basis: 'official', recorded_by_agent: 'yes', duty_percent: 10 } });
    expect(metricSentence(scored)).toBe('Duty on Indian goods is 10% (read from the official tariff by a ClearTrade agent).');
  });
});
