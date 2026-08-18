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

describe('UI truthfulness — asserted as rendered data, not source text', () => {
  /**
   * These read the exported action catalogue rather than the component source. The strings in
   * BUYER_ACTION_SPECS ARE the copy the agent sees, so asserting them is asserting behaviour;
   * grepping the .tsx would also match the comments that explain why a phrase is forbidden,
   * which is how a guard test passes while the bug it guards against is present.
   */
  test('automation controls tell the truth: they record an instruction and stop nothing', async () => {
    const { BUYER_ACTION_SPECS, BUYER_CONSEQUENCE_LABEL, BUYER_ADVISORY_NOTE } = await import('../src/lib/buyer-actions');
    const { AUTOMATION_IS_ADVISORY } = await import('../src/lib/buyer-commands');

    const automation = BUYER_ACTION_SPECS.filter((s) => s.consequence === 'automation');
    expect(automation.map((s) => s.action).sort()).toEqual(['pause_automation', 'resume_automation']);
    for (const spec of automation) {
      expect(spec.consequenceNote).toBe(BUYER_ADVISORY_NOTE);
      expect(spec.consequenceNote).toMatch(/No backend job reads it yet/i);
      // The claim that must never be made while nothing gates on the decision.
      expect(spec.consequenceNote).not.toMatch(/automation paused|outreach stopped|has been stopped/i);
    }
    expect(BUYER_CONSEQUENCE_LABEL.automation).toBe('Records an instruction');
    // If a real gate is ever built this flips, and the copy above must change with it.
    expect(AUTOMATION_IS_ADVISORY).toBe(true);
  });

  test('every action is grouped by consequence, and the grouping matches the service', async () => {
    const { BUYER_ACTION_SPECS } = await import('../src/lib/buyer-actions');
    const { BUYER_ACTION_CATEGORY } = await import('../src/lib/buyer-commands');

    // The UI grouping must agree with what the service actually does, or the label lies.
    for (const spec of BUYER_ACTION_SPECS) {
      expect(BUYER_ACTION_CATEGORY[spec.action]!.category, spec.action).toBe(spec.consequence);
    }
    // And every action the service accepts is offered by the UI — no silently missing control.
    expect(BUYER_ACTION_SPECS.map((s) => s.action).sort()).toEqual(Object.keys(BUYER_ACTION_CATEGORY).sort());
  });

  test('qualify and unqualify are presented as decision-only, not pipeline moves', async () => {
    const { BUYER_ACTION_SPECS } = await import('../src/lib/buyer-actions');
    for (const action of ['qualify', 'unqualify'] as const) {
      const spec = BUYER_ACTION_SPECS.find((s) => s.action === action)!;
      expect(spec.consequence).toBe('decision');
      expect(spec.consequenceNote).toMatch(/nothing moves|Nothing moves/);
    }
    // BuyerLeadStage genuinely has no `qualified` member — the copy is accurate, not cautious.
    const { BuyerLeadStage } = await import('@prisma/client');
    expect(Object.keys(BuyerLeadStage)).not.toContain('qualified');
  });

  test('canonical actions state their pipeline effect before confirmation', async () => {
    const { BUYER_ACTION_SPECS } = await import('../src/lib/buyer-actions');
    const canonical = BUYER_ACTION_SPECS.filter((s) => s.consequence === 'canonical');
    expect(canonical.map((s) => s.action).sort()).toEqual(['disqualify', 'restore', 'shortlist']);
    for (const spec of canonical) {
      expect(spec.consequenceNote.length, spec.action).toBeGreaterThan(40);
    }
    // Disqualify must collect the canonical reason the service requires, or the command fails.
    expect(BUYER_ACTION_SPECS.find((s) => s.action === 'disqualify')!.needsDisqualificationReason).toBe(true);
    // Priority is only offered where the service accepts one.
    const withPriority = BUYER_ACTION_SPECS.filter((s) => s.priority).map((s) => s.action).sort();
    expect(withPriority).toEqual(['demote', 'promote', 'shortlist']);
  });

  test('the disqualification options offered are exactly the canonical enum', async () => {
    const { DISQUALIFICATION_REASON_OPTIONS } = await import('../src/lib/buyer-actions');
    const { DisqualificationReason } = await import('@prisma/client');
    // Offering a value the enum lacks would fail at the database; omitting one hides a reason.
    expect([...DISQUALIFICATION_REASON_OPTIONS].sort()).toEqual(Object.keys(DisqualificationReason).sort());
  });
});

describe('architectural guards that behaviour cannot prove', () => {
  /**
   * Source-level ON PURPOSE. These are code-shape invariants about which layer may do what:
   * a behavioural test can show that today's route writes nothing extra, but not that a future
   * edit did not add a write alongside the correct one. Comments and import lines are stripped
   * before matching so explanatory prose can never satisfy or break the assertion.
   */
  const code = async (file: string) => {
    const raw = await (await import('node:fs/promises')).readFile(file, 'utf8');
    return raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
  };

  test('the buyer decisions route contains no Prisma mutation of its own', async () => {
    const route = await code('src/app/api/v1/buyer-fit-assessments/[assessmentId]/decisions/route.ts');
    // A direct write here could move canonical state without the decision, or the reverse —
    // the one failure mode the transactional command layer exists to make impossible.
    expect(route).not.toMatch(/\bprisma\.\w+\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\b/);
    expect(route).toMatch(/runBuyerCommand\(/);
  });

  test('the buyer UI layer never writes the assessment', async () => {
    for (const file of [
      'src/components/agent/BuyerDiscoveryControl.tsx',
      'src/components/agent/BuyerDecisionControls.tsx',
      'src/lib/buyer-control.ts',
    ]) {
      const source = await code(file);
      expect(source, file).not.toMatch(/\bbuyerFitAssessment\.(create|update|upsert|delete)\b/);
    }
  });
});
