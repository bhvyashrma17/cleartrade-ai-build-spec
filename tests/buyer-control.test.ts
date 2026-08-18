import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, test } from 'vitest';
import { BuyerLeadStage, DisqualificationReason, OrgTier, UserRole } from '@prisma/client';
import {
  buyerComponentViews,
  buyerControlRows,
  filterBuyerRows,
  isBuyerSortKey,
  sortBuyerRows,
} from '../src/lib/buyer-control';
import {
  disqualifyBuyerCommand,
  promoteBuyerCommand,
  qualifyBuyerCommand,
  restoreBuyerCommand,
  shortlistBuyerCommand,
} from '../src/lib/buyer-commands';
import { prisma } from '../src/lib/prisma';
import type { Principal } from '../src/types';

afterAll(async () => { await prisma.$disconnect(); });

const staff = (id: string, role: UserRole = UserRole.agent): Principal => ({
  id, email: `${id}@t.test`, name: 'Agent', role, exporter_org_id: null, tier: OrgTier.paid,
});

/** Two buyers with different scores, so model position is a real computation. */
async function scenario(opts: { withPolicy?: boolean } = {}) {
  const s = randomUUID().slice(0, 8);
  const org = await prisma.exporterOrg.create({
    data: { display_name: `BD Org ${s}`, tier: OrgTier.paid }, select: { id: true },
  });
  const otherOrg = await prisma.exporterOrg.create({
    data: { display_name: `Other ${s}`, tier: OrgTier.paid }, select: { id: true },
  });
  const [agentUser, strangerUser] = await Promise.all([
    prisma.user.create({ data: { email: `bd-${s}@t.test`, name: 'Agent', role: UserRole.agent }, select: { id: true } }),
    prisma.user.create({ data: { email: `bd2-${s}@t.test`, name: 'Stranger', role: UserRole.agent }, select: { id: true } }),
  ]);
  await prisma.agentAssignment.create({
    data: { exporter_org_id: org.id, agent_user_id: agentUser.id, status: 'active' },
  });
  const product = await prisma.product.create({
    data: { exporter_org_id: org.id, name: `P ${s}` }, select: { id: true },
  });

  const mkBuyer = async (name: string, country: string) =>
    prisma.buyer.create({
      data: { legal_name: name, display_name: name, country_code: country, buyer_type: 'importer' },
      select: { id: true },
    });
  const high = await mkBuyer(`High ${s}`, 'DE');
  const low = await mkBuyer(`Low ${s}`, 'FR');

  const mkFit = (buyerId: string, score: number, components: object) =>
    prisma.buyerFitAssessment.create({
      data: {
        buyer_id: buyerId, product_id: product.id, exporter_org_id: org.id,
        score, confidence_score: 70, components, input_snapshot: { rows: ['r1'] },
        model_version: 'buyerfit-v2', evidence_origins: ['imported_real'],
        ...(opts.withPolicy
          ? { scoring_policy_version: 1, scoring_policy_hash: 'a'.repeat(64), reproducibility_status: 'reproducible' }
          : {}),
      },
      select: { id: true },
    });

  const highFit = await mkFit(high.id, 90, {
    volume_fit: { score: 80, evidence: {} },
    price_fit: { score: 60, evidence: {} },
    // A genuine gap, with the engine's own reason.
    cert_fit: { score: null, reason: 'No mandatory certification evidence for this destination.', evidence: {} },
    outcome_prior: { score: 55, evidence: {} },
  });
  const lowFit = await mkFit(low.id, 40, {
    volume_fit: { score: 30, evidence: {} },
    price_fit: { score: 20, evidence: {} },
    cert_fit: { score: 10, evidence: {} },
    outcome_prior: { score: 15, evidence: {} },
  });

  return {
    orgId: org.id, otherOrgId: otherOrg.id, productId: product.id,
    highBuyerId: high.id, lowBuyerId: low.id, highFitId: highFit.id, lowFitId: lowFit.id,
    agent: staff(agentUser.id), stranger: staff(strangerUser.id), ops: staff(randomUUID(), UserRole.ops_supervisor),
  };
}

const base = (fitId: string, agent: Principal) => ({
  actor: agent, subjectId: fitId,
  reason: 'Reviewed on the weekly account call.', correlationId: randomUUID(),
});

describe('read surface: access control', () => {
  test('an assigned agent sees the exporter\'s buyers', async () => {
    const f = await scenario();
    const rows = await buyerControlRows(f.agent, f.orgId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.fitId).sort()).toEqual([f.highFitId, f.lowFitId].sort());
  });

  test('an unassigned agent cannot read another exporter\'s buyers', async () => {
    const f = await scenario();
    // NOT_FOUND, not an empty list: an empty list would let the surface probe which orgs exist.
    await expect(buyerControlRows(f.stranger, f.orgId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('Ops may read any exporter, by role', async () => {
    const f = await scenario();
    await expect(buyerControlRows(f.ops, f.orgId)).resolves.toHaveLength(2);
  });
});

describe('read surface: the three layers stay separate', () => {
  test('AI, canonical state and agent decision are distinct fields', async () => {
    const f = await scenario();
    await shortlistBuyerCommand({ ...base(f.highFitId, f.agent), agentPriority: 1 });
    const rows = await buyerControlRows(f.agent, f.orgId);
    const high = rows.find((r) => r.fitId === f.highFitId)!;

    // A: model truth, untouched by the decision.
    expect(high.fit.score).toBe(90);
    expect(high.provenance.modelVersion).toBe('buyerfit-v2');
    // B: what the system is doing.
    expect(high.canonical.onShortlist).toBe(true);
    expect(high.canonical.leadStage).toBe(BuyerLeadStage.shortlisted);
    // C: human intent.
    expect(high.current?.action).toBe('shortlist');
    expect(high.current?.agent_priority).toBe(1);
    // No blended value anywhere in the row shape.
    expect(high).not.toHaveProperty('effective_score');
    expect(high).not.toHaveProperty('status');
  });

  test('selection and pipeline are separate facts and can differ', async () => {
    const f = await scenario();
    await shortlistBuyerCommand({ ...base(f.highFitId, f.agent) });
    // Advance the pipeline past shortlisted, leaving membership in place.
    const lead = await prisma.buyerLead.findFirstOrThrow({ where: { buyer_id: f.highBuyerId } });
    await prisma.buyerLead.update({ where: { id: lead.id }, data: { stage: BuyerLeadStage.contacted } });

    const rows = await buyerControlRows(f.agent, f.orgId);
    const high = rows.find((r) => r.fitId === f.highFitId)!;
    // Both true at once — the surface must not reconcile them into one label.
    expect(high.canonical.onShortlist).toBe(true);
    expect(high.canonical.leadStage).toBe(BuyerLeadStage.contacted);
  });

  test('a buyer with no lead reports no outreach state rather than "not contacted"', async () => {
    const f = await scenario();
    const rows = await buyerControlRows(f.agent, f.orgId);
    const high = rows.find((r) => r.fitId === f.highFitId)!;
    expect(high.canonical.leadStage).toBeNull();
    // Null, not a fabricated "no attempts yet" — the buyer has never entered the pipeline.
    expect(high.canonical.outreach).toBeNull();
  });

  test('outreach state comes from canonical rows, never from an AgentDecision', async () => {
    const f = await scenario();
    // A pause decision must not manufacture outreach state.
    await shortlistBuyerCommand({ ...base(f.highFitId, f.agent) });
    const rows = await buyerControlRows(f.agent, f.orgId);
    const high = rows.find((r) => r.fitId === f.highFitId)!;
    expect(high.canonical.outreach?.attemptCount).toBe(0);
    expect(high.canonical.outreach?.lastAttemptStatus).toBeNull();
  });
});

describe('read surface: model output is reported as stored', () => {
  test('a missing component is null with its reason, never zero', () => {
    const views = buyerComponentViews({
      volume_fit: { score: 80, evidence: {} },
      cert_fit: { score: null, reason: 'No certification evidence.', evidence: {} },
    });
    const cert = views.find((v) => v.key === 'cert_fit')!;
    expect(cert.score).toBeNull();
    expect(cert.score).not.toBe(0);
    expect(cert.unavailableReason).toMatch(/certification/i);
    // All four are always represented, even when absent from the JSON entirely.
    expect(views).toHaveLength(4);
    expect(views.find((v) => v.key === 'outcome_prior')?.score).toBeNull();
  });

  test('the stored component keys are read, not renamed', () => {
    // `cert_fit` is what buyer-intelligence.ts writes. Reading `certification_fit` would make
    // every certification component silently unavailable.
    const views = buyerComponentViews({ cert_fit: { score: 42, evidence: {} } });
    expect(views.find((v) => v.key === 'cert_fit')?.score).toBe(42);
  });

  test('persisted policy provenance is surfaced when present', async () => {
    const f = await scenario({ withPolicy: true });
    const rows = await buyerControlRows(f.agent, f.orgId);
    const high = rows.find((r) => r.fitId === f.highFitId)!;
    expect(high.provenance.scoringPolicyVersion).toBe(1);
    expect(high.provenance.scoringPolicyHash).toMatch(/^a{64}$/);
    expect(high.provenance.reproducibilityStatus).toBe('reproducible');
  });

  test('legacy provenance stays explicitly unknown rather than invented', async () => {
    const f = await scenario({ withPolicy: false });
    const rows = await buyerControlRows(f.agent, f.orgId);
    const high = rows.find((r) => r.fitId === f.highFitId)!;
    // Never back-filled with today's policy — that would claim a provenance we cannot prove.
    expect(high.provenance.scoringPolicyVersion).toBeNull();
    expect(high.provenance.scoringPolicyHash).toBeNull();
    expect(high.provenance.reproducibilityStatus).toBe('legacy_non_recomputable');
  });
});

describe('operational ordering', () => {
  test('explicit agent priority beats the model position on a numeric tie', async () => {
    const f = await scenario();
    // Low buyer is model position 2; promoting to priority 1 ties with High's position 1.
    await promoteBuyerCommand({ ...base(f.lowFitId, f.agent), agentPriority: 1 });
    const rows = await buyerControlRows(f.agent, f.orgId);

    expect(rows[0]!.fitId).toBe(f.lowFitId);
    expect(rows[0]!.operationalOrder).toBe(1);
    expect(rows[1]!.operationalOrder).toBe(1);
    // And neither AI value moved.
    expect(rows.find((r) => r.fitId === f.lowFitId)!.fit.score).toBe(40);
    expect(rows.find((r) => r.fitId === f.lowFitId)!.modelRank).toBe(2);
  });

  test('equal explicit priorities resolve deterministically by model position', async () => {
    const f = await scenario();
    await promoteBuyerCommand({ ...base(f.lowFitId, f.agent), agentPriority: 1 });
    await promoteBuyerCommand({ ...base(f.highFitId, f.agent), agentPriority: 1 });
    const rows = await buyerControlRows(f.agent, f.orgId);
    // High is model position 1, so it leads; neither priority was rewritten.
    expect(rows.map((r) => r.fitId)).toEqual([f.highFitId, f.lowFitId]);
    expect(rows.every((r) => r.current?.agent_priority === 1)).toBe(true);
  });

  test('a disqualified buyer leaves the active order and shows no position', async () => {
    const f = await scenario();
    await shortlistBuyerCommand({ ...base(f.highFitId, f.agent) });
    await disqualifyBuyerCommand({
      ...base(f.highFitId, f.agent), disqualificationReason: DisqualificationReason.risk_flag,
    });
    const rows = await buyerControlRows(f.agent, f.orgId);
    const high = rows.find((r) => r.fitId === f.highFitId)!;

    expect(high.bucket).toBe('terminal');
    // A high AI score must not pull a disqualified buyer back into the working order.
    expect(high.operationalOrder).toBeNull();
    expect(high.fit.score).toBe(90);
    expect(rows.at(-1)!.fitId).toBe(f.highFitId);
  });

  test('a restored buyer returns to the active order', async () => {
    const f = await scenario();
    await shortlistBuyerCommand({ ...base(f.highFitId, f.agent) });
    await disqualifyBuyerCommand({
      ...base(f.highFitId, f.agent), disqualificationReason: DisqualificationReason.no_response,
    });
    await restoreBuyerCommand({ ...base(f.highFitId, f.agent), reason: 'Buyer replied.' });

    const rows = await buyerControlRows(f.agent, f.orgId);
    const high = rows.find((r) => r.fitId === f.highFitId)!;
    expect(high.bucket).toBe('active');
    expect(high.operationalOrder).toBe(1);
    expect(high.canonical.leadStage).toBe(BuyerLeadStage.shortlisted);
    expect(high.canonical.disqualificationReason).toBeNull();
  });
});

describe('sorting and filtering', () => {
  test('only allowlisted sort keys are accepted', () => {
    expect(isBuyerSortKey('operational_order')).toBe(true);
    expect(isBuyerSortKey('volume_fit')).toBe(true);
    expect(isBuyerSortKey('cert_fit')).toBe(true);
    expect(isBuyerSortKey('score; DROP TABLE')).toBe(false);
    expect(isBuyerSortKey('password_hash')).toBe(false);
  });

  test('sorting by a JSON-backed component works and puts nulls last', async () => {
    const f = await scenario();
    const rows = await buyerControlRows(f.agent, f.orgId);
    const byVolume = sortBuyerRows(rows, 'volume_fit', 'desc');
    expect(byVolume[0]!.fitId).toBe(f.highFitId);
    // High has a null cert_fit, so it sorts last on that column in BOTH directions.
    expect(sortBuyerRows(rows, 'cert_fit', 'desc').at(-1)!.fitId).toBe(f.highFitId);
    expect(sortBuyerRows(rows, 'cert_fit', 'asc').at(-1)!.fitId).toBe(f.highFitId);
  });

  test('filters use canonical state, not decisions', async () => {
    const f = await scenario();
    await shortlistBuyerCommand({ ...base(f.highFitId, f.agent) });
    const rows = await buyerControlRows(f.agent, f.orgId);

    expect(filterBuyerRows(rows, { shortlisted: 'yes' }).map((r) => r.fitId)).toEqual([f.highFitId]);
    expect(filterBuyerRows(rows, { shortlisted: 'no' }).map((r) => r.fitId)).toEqual([f.lowFitId]);
    expect(filterBuyerRows(rows, { stage: 'none' }).map((r) => r.fitId)).toEqual([f.lowFitId]);
    expect(filterBuyerRows(rows, { country: 'FR' }).map((r) => r.fitId)).toEqual([f.lowFitId]);
    expect(filterBuyerRows(rows, { minScore: 50 }).map((r) => r.fitId)).toEqual([f.highFitId]);
  });
});

describe('history and immutability through the read surface', () => {
  test('superseded and expired decisions stay visible with their frozen snapshot', async () => {
    const f = await scenario();
    await promoteBuyerCommand({ ...base(f.highFitId, f.agent), agentPriority: 1 });
    await qualifyBuyerCommand({ ...base(f.highFitId, f.agent), reason: 'Confirmed suitable.' });

    const rows = await buyerControlRows(f.agent, f.orgId);
    const high = rows.find((r) => r.fitId === f.highFitId)!;
    expect(high.history).toHaveLength(2);
    expect(high.history[0]!.state).toBe('active');
    expect(high.history[1]!.state).toBe('superseded');
    // Every entry carries what the model said at ITS decision time.
    expect(high.history.every((h) => h.original_score === 90)).toBe(true);
    expect(high.history.every((h) => h.original_components !== null)).toBe(true);
  });

  test('the frozen snapshot survives a BuyerFit recompute, and the read surface shows both', async () => {
    const f = await scenario();
    await promoteBuyerCommand({ ...base(f.highFitId, f.agent), agentPriority: 1 });
    // Exactly what the next buyer-intelligence run does: upsert over the same row.
    await prisma.buyerFitAssessment.update({
      where: { id: f.highFitId },
      data: { score: 12, components: { volume_fit: { score: 1, evidence: {} } } },
    });

    const rows = await buyerControlRows(f.agent, f.orgId);
    const high = rows.find((r) => r.fitId === f.highFitId)!;
    // Current AI truth is the new value...
    expect(high.fit.score).toBe(12);
    // ...while the decision still records what was actually overruled. Never reconstructed
    // from the live assessment, which no longer holds it.
    expect(high.history[0]!.original_score).toBe(90);
  });

  test('no action mutates the underlying BuyerFitAssessment', async () => {
    const f = await scenario();
    const before = await prisma.buyerFitAssessment.findMany({
      where: { exporter_org_id: f.orgId }, orderBy: { id: 'asc' },
    });

    await promoteBuyerCommand({ ...base(f.highFitId, f.agent), agentPriority: 1 });
    await qualifyBuyerCommand({ ...base(f.highFitId, f.agent) });
    await shortlistBuyerCommand({ ...base(f.lowFitId, f.agent) });
    await disqualifyBuyerCommand({
      ...base(f.lowFitId, f.agent), disqualificationReason: DisqualificationReason.price_mismatch,
    });

    // The agent controls operational decisions, never the model's output.
    expect(await prisma.buyerFitAssessment.findMany({
      where: { exporter_org_id: f.orgId }, orderBy: { id: 'asc' },
    })).toEqual(before);
  });
});

describe('UI truthfulness and architectural guards', () => {
  const read = async (path: string) => (await import('node:fs/promises')).readFile(path, 'utf8');
  /**
   * Source with comments removed.
   *
   * The negative assertions below look for wording the UI must never SHOW. The comments
   * explaining why it must never show it necessarily quote that same wording, so matching
   * against raw source would fail on the explanation rather than on a real regression.
   */
  const code = async (path: string) => (await read(path))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  test('automation controls are labelled advisory, not as stopping execution', async () => {
    const controls = await read('src/components/agent/BuyerDecisionControls.tsx');
    // Phase 2b established this wording, and AUTOMATION_IS_ADVISORY still pins the fact.
    expect(controls).toMatch(/No backend job reads it yet/i);
    expect(controls).toMatch(/do NOT stop on their own/i);
    // The forbidden claim: presenting a pause as though execution had actually halted.
    const rendered = await code('src/components/agent/BuyerDecisionControls.tsx');
    expect(rendered).not.toMatch(/Automation paused/i);
    expect(rendered).not.toMatch(/Outreach stopped/i);
  });

  test('actions are grouped by consequence so the effect is visible before clicking', async () => {
    const controls = await read('src/components/agent/BuyerDecisionControls.tsx');
    expect(controls).toContain('Decision only');
    expect(controls).toContain('Changes pipeline state');
    expect(controls).toContain('Records an instruction');
    // qualify/unqualify must not be presented as pipeline moves — no canonical stage exists.
    expect(controls).toMatch(/There is no canonical "qualified" pipeline stage/);
  });

  test('high-impact actions state their consequence before confirmation', async () => {
    const controls = await read('src/components/agent/BuyerDecisionControls.tsx');
    expect(controls).toContain('consequenceNote');
    expect(controls).toMatch(/Confirm \$\{spec\.label/);
    // Disqualify must collect the canonical reason the service requires.
    expect(controls).toContain('needsDisqualificationReason');
  });

  test('the decisions route performs no Prisma writes of its own', async () => {
    const route = await read('src/app/api/v1/buyer-fit-assessments/[assessmentId]/decisions/route.ts');
    expect(route).toContain('runBuyerCommand');
    // Any direct write here could move canonical state without the decision, or vice versa.
    expect(route).not.toMatch(/prisma\.\w+\.(create|update|delete|upsert)/);
    expect(route).not.toMatch(/export async function (PATCH|DELETE|PUT)/);
  });

  test('the read surface authorizes through the shared helper, not a local rule', async () => {
    const lib = await read('src/lib/buyer-control.ts');
    expect(lib).toContain('assertOrgAccess');
    // No bespoke role logic that could drift from tenantScope.
    expect(lib).not.toMatch(/role\s*===\s*['"]agent['"]/);
  });

  test('the UI never writes AI output or provenance', async () => {
    for (const file of [
      'src/components/agent/BuyerDiscoveryControl.tsx',
      'src/components/agent/BuyerDecisionControls.tsx',
      'src/lib/buyer-control.ts',
    ]) {
      const source = await read(file);
      expect(source).not.toMatch(/buyerFitAssessment\.(update|upsert|create|delete)/);
      expect(source).not.toMatch(/scoring_policy_hash\s*[:=]\s*['"`]/);
    }
  });

  test('the surface renders the three layers with distinct headings', async () => {
    const view = await read('src/components/agent/BuyerDiscoveryControl.tsx');
    expect(view).toContain('AI recommendation');
    expect(view).toContain('Canonical state');
    expect(view).toContain('Agent decision');
    expect(view).toContain('Supporting evidence');
    // Evidence must not be presented as if it were a model component.
    expect(view).toMatch(/not the model&rsquo;s components above/);
    // No synthetic combined status.
    const rendered = await code('src/components/agent/BuyerDiscoveryControl.tsx');
    expect(rendered).not.toMatch(/effective (score|rank)/i);
  });
});
