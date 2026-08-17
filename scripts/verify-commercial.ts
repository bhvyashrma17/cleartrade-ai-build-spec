/**
 * EXP-10 / AGT-05 commercial negotiation + deal lock, end to end in a real browser and
 * against the real API.
 *
 * The lock is verified in BOTH directions, which is the point of the exercise:
 *   1. with prerequisites unmet -> DEAL_LOCK_PREREQUISITES_NOT_MET carrying a blockers[]
 *      array whose deep links actually resolve;
 *   2. with the same prerequisites satisfied -> the snapshot freezes, execution tasks are
 *      created and the document checklist appears.
 *
 * A test that only checked (2) would pass against a lock that never enforced anything.
 *
 *   npx tsx --env-file=.env scripts/verify-commercial.ts
 */

import {
  BASE,
  launch,
  loggedInContext,
  preflight,
  PreflightError,
  record,
  scenario,
  sleep,
  summarize,
  type Browser,
} from './verify-harness';
import { prisma } from '../src/lib/prisma';

const NEG_DEAL = 'seed-deal-negotiating';

/** Reset the negotiating deal to a clean pre-approval state so reruns are deterministic. */
async function resetNegotiatingDeal() {
  await prisma.document.deleteMany({ where: { deal_id: NEG_DEAL } });
  await prisma.dealSnapshot.deleteMany({ where: { deal_id: NEG_DEAL } });
  await prisma.task.deleteMany({
    where: { deal_id: NEG_DEAL, task_type: { in: ['exporter_approve_commercial_terms', 'agent_revise_commercial_terms'] } },
  });
  await prisma.task.deleteMany({ where: { deal_id: NEG_DEAL, task_type: { startsWith: 'prepare_' } } });
  await prisma.task.deleteMany({
    where: { deal_id: NEG_DEAL, task_type: { in: ['exporter_confirm_ship_window', 'plan_shipment', 'insurance_applicability_check'] } },
  });
  await prisma.dealProposal.deleteMany({ where: { deal_id: NEG_DEAL, version: { gt: 2 } } });
  await prisma.dealProposal.updateMany({
    where: { deal_id: NEG_DEAL, version: 2 },
    data: { status: 'awaiting_exporter', approved_at: null, approved_by_id: null, changes_requested_at: null, changes_requested_by_id: null, changes_requested_note: null },
  });
  await prisma.dealProposal.updateMany({ where: { deal_id: NEG_DEAL, version: 1 }, data: { status: 'superseded' } });
  await prisma.deal.update({
    where: { id: NEG_DEAL },
    data: { stage: 'negotiating', locked_at: null, quoted_fee_policy: undefined },
  });
}

async function main() {
  await preflight();
  await resetNegotiatingDeal();

  const browser: Browser = await launch();

  try {
    // ---------------------------------------------------------------- C1
    await scenario('C1', 'EXP-10 shows the current proposal with changed fields highlighted', async () => {
      const { ctx, page } = await loggedInContext(browser, 'owner@sunriseagro.example');
      await page.goto(`${BASE}/app/deals/${NEG_DEAL}/commercial`, { waitUntil: 'networkidle' });
      await sleep(800);
      const body = (await page.locator('body').textContent()) ?? '';
      const changedChips = await page.getByText('Changed', { exact: true }).count();
      await ctx.close();

      const hasCurrent = /Current proposal/.test(body) && /Version 2/.test(body);
      const hasCompare = /Compared against version 1/.test(body);
      const hasHistory = /Version history/.test(body) && /Version 1/.test(body);
      record('C1', 'EXP-10 shows the current proposal with changed fields highlighted',
        hasCurrent && hasCompare && changedChips > 0 && hasHistory ? 'PASS' : 'FAIL',
        `current v2 shown=${hasCurrent}, diff vs v1=${hasCompare}, changed-field chips=${changedChips}, history=${hasHistory}`);
    });

    // ---------------------------------------------------------------- C2
    await scenario('C2', 'AGT-05-AC02: the agent cannot approve the exporter’s terms', async () => {
      const { ctx, page } = await loggedInContext(browser, 'agent@cleartrade.example');
      await page.goto(`${BASE}/agent/deals/${NEG_DEAL}/commercial`, { waitUntil: 'networkidle' });
      await sleep(800);
      // No approve affordance anywhere on the agent screen.
      const approveButtons = await page.getByRole('button', { name: /^Approve/i }).count();

      // And the API refuses it outright, which is the check that actually matters.
      const deal = await prisma.deal.findUniqueOrThrow({ where: { id: NEG_DEAL }, select: { version: true } });
      const apiResult = await page.evaluate(
        async ([dealId, dealVersion]) => {
          const res = await fetch(`/api/v1/deals/${dealId}/proposals`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'approve', version: 2, deal_version: dealVersion }),
          });
          return { status: res.status, body: await res.json().catch(() => null) };
        },
        [NEG_DEAL, deal.version] as const,
      );
      await ctx.close();

      const stillNotApproved = await prisma.dealProposal.findFirst({
        where: { deal_id: NEG_DEAL, version: 2 },
        select: { status: true, approved_by_id: true },
      });
      const forbidden = apiResult.status === 403;
      const notApproved = stillNotApproved?.status !== 'approved' && !stillNotApproved?.approved_by_id;

      record('C2', 'AGT-05-AC02: the agent cannot approve the exporter’s terms',
        approveButtons === 0 && forbidden && notApproved ? 'PASS' : 'FAIL',
        `agent screen approve buttons=${approveButtons} (expect 0), API status=${apiResult.status} (expect 403), proposal still unapproved=${notApproved}; message="${apiResult.body?.error?.message ?? ''}"`);
    });

    // ---------------------------------------------------------------- C3
    await scenario('C3', 'Stale approval returns 409 VERSION_CONFLICT, never a silent overwrite', async () => {
      const { ctx, page } = await loggedInContext(browser, 'owner@sunriseagro.example');
      await page.goto(`${BASE}/app/deals/${NEG_DEAL}/commercial`, { waitUntil: 'networkidle' });

      const deal = await prisma.deal.findUniqueOrThrow({ where: { id: NEG_DEAL }, select: { version: true } });
      // Deliberately behind — but never 0: `deal_version` is validated as a positive int,
      // so version-1 on a v1 deal would be rejected as a malformed payload (422) before
      // the concurrency check ever runs, and the test would "fail" for the wrong reason.
      const staleVersion = deal.version > 1 ? deal.version - 1 : deal.version + 1;
      const result = await page.evaluate(
        async ([dealId, dv]) => {
          const res = await fetch(`/api/v1/deals/${dealId}/proposals`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'approve', version: 2, deal_version: dv }),
          });
          return { status: res.status, body: await res.json().catch(() => null) };
        },
        [NEG_DEAL, staleVersion] as const,
      );
      await ctx.close();

      const after = await prisma.dealProposal.findFirst({ where: { deal_id: NEG_DEAL, version: 2 }, select: { status: true } });
      const is409 = result.status === 409;
      const code = result.body?.error?.code;
      const untouched = after?.status === 'awaiting_exporter';
      record('C3', 'Stale approval returns 409 VERSION_CONFLICT, never a silent overwrite',
        is409 && code === 'VERSION_CONFLICT' && untouched ? 'PASS' : 'FAIL',
        `status=${result.status} (expect 409), code=${code}, proposal untouched=${untouched}`);
    });

    // ---------------------------------------------------------------- C4
    // Run the "prerequisites unmet" case from `terms_agreed`, which is the ONLY stage
    // that may transition to deal_locked. From `negotiating` the machine (correctly)
    // rejects the transition itself with INVALID_TRANSITION and never gets as far as
    // collecting blockers — a real guard, but not the one this scenario is about. Terms
    // are approved here; the missing Proforma Invoice is what must block the lock.
    await scenario('C4', 'Lock with unmet prerequisites returns blockers[] with resolvable deep links', async () => {
      await prisma.dealProposal.updateMany({
        where: { deal_id: NEG_DEAL, version: 2 },
        data: { status: 'approved', approved_by_id: 'seed-user-owner', approved_at: new Date() },
      });
      await prisma.deal.update({ where: { id: NEG_DEAL }, data: { stage: 'terms_agreed' } });

      const { ctx, page } = await loggedInContext(browser, 'agent@cleartrade.example');
      await page.goto(`${BASE}/agent/deals/${NEG_DEAL}/commercial`, { waitUntil: 'networkidle' });

      const result = await page.evaluate(async (dealId) => {
        const res = await fetch(`/api/v1/deals/${dealId}/lock`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        return { status: res.status, body: await res.json().catch(() => null) };
      }, NEG_DEAL);

      const blockers = (result.body?.error?.blockers ?? []) as { reason: string; deep_link?: string }[];
      await ctx.close();

      // Every deep link must actually resolve — a blocker pointing at a 404 is a dead end.
      //
      // Checked as the EXPORTER, not the agent: `dealDeepLink()` deliberately emits
      // `/app/deals/...` (the exporter's canonical route) because the blockers are
      // ultimately things the exporter must resolve. Following them in an agent session
      // renders the correct "Access denied" for a cross-portal route, which is right
      // behaviour but tells us nothing about whether the link is dead.
      const exporter = await loggedInContext(browser, 'owner@sunriseagro.example');
      const linkStatuses: string[] = [];
      for (const link of [...new Set(blockers.map((b) => b.deep_link).filter(Boolean))] as string[]) {
        const resp = await exporter.page.goto(BASE + link, { waitUntil: 'domcontentloaded' });
        const body = (await exporter.page.locator('body').textContent()) ?? '';
        const dead = /This page could not be found/i.test(body) || /Access denied/i.test(body) || resp?.status() === 404;
        linkStatuses.push(`${link}:${resp?.status()}${dead ? '/DEAD' : '/ok'}`);
      }
      await exporter.ctx.close();

      const stillNotLocked = await prisma.deal.findUniqueOrThrow({ where: { id: NEG_DEAL }, select: { stage: true, locked_at: true } });
      const snapshots = await prisma.dealSnapshot.count({ where: { deal_id: NEG_DEAL } });

      const correctCode = result.body?.error?.code === 'DEAL_LOCK_PREREQUISITES_NOT_MET';
      const hasBlockers = blockers.length > 0;
      const linksOk = linkStatuses.length > 0 && linkStatuses.every((s) => s.endsWith('/ok'));
      // A rejected lock must write NOTHING: no snapshot, no locked_at, and the stage left
      // exactly where it was (terms_agreed, which this scenario set up).
      const noSideEffects = stillNotLocked.locked_at === null && stillNotLocked.stage === 'terms_agreed' && snapshots === 0;

      record('C4', 'Lock with unmet prerequisites returns blockers[] with resolvable deep links',
        correctCode && hasBlockers && linksOk && noSideEffects ? 'PASS' : 'FAIL',
        `status=${result.status}, code=${result.body?.error?.code}, blockers=${blockers.length}, deep links=[${linkStatuses.join(', ')}], no partial write=${noSideEffects} (stage=${stillNotLocked.stage}, snapshots=${snapshots})\n        reasons: ${blockers.map((b) => b.reason).join(' | ')}`);

      // Put the deal back to "awaiting exporter" so C5 exercises the real approval flow
      // through the UI rather than inheriting the state this scenario forced. Done AFTER
      // record() so the assertions above see the state the lock actually left behind.
      await prisma.dealProposal.updateMany({
        where: { deal_id: NEG_DEAL, version: 2 },
        data: { status: 'awaiting_exporter', approved_by_id: null, approved_at: null },
      });
      await prisma.deal.update({ where: { id: NEG_DEAL }, data: { stage: 'negotiating' } });
    });

    // ---------------------------------------------------------------- C5
    await scenario('C5', 'Exporter approves v2: version-specific, advances to terms_agreed, notifies agent', async () => {
      const { ctx, page } = await loggedInContext(browser, 'owner@sunriseagro.example');
      await page.goto(`${BASE}/app/deals/${NEG_DEAL}/commercial`, { waitUntil: 'networkidle' });
      await sleep(600);
      await page.getByRole('button', { name: /^Approve version 2$/i }).click();
      // Wait on durable state, not the toast.
      const deadline = Date.now() + 15_000;
      let approved = null;
      while (Date.now() < deadline) {
        approved = await prisma.dealProposal.findFirst({ where: { deal_id: NEG_DEAL, version: 2 }, select: { status: true, approved_by_id: true, approved_at: true } });
        if (approved?.status === 'approved') break;
        await sleep(300);
      }
      await ctx.close();

      const deal = await prisma.deal.findUniqueOrThrow({ where: { id: NEG_DEAL }, select: { stage: true, total_amount: true } });
      const agentNotif = await prisma.notification.count({ where: { type: 'commercial_terms_approved', object_id: NEG_DEAL } });
      // AC02: the approver must be the EXPORTER, not the agent.
      const approvedByExporter = approved?.approved_by_id === 'seed-user-owner';

      record('C5', 'Exporter approves v2: version-specific, advances to terms_agreed, notifies agent',
        approved?.status === 'approved' && approvedByExporter && deal.stage === 'terms_agreed' && agentNotif > 0 ? 'PASS' : 'FAIL',
        `proposal v2 status=${approved?.status}, approved_by=${approved?.approved_by_id} (expect seed-user-owner), deal stage=${deal.stage}, agent notified=${agentNotif > 0}, deal total=${deal.total_amount}`);
    });

    // ---------------------------------------------------------------- C6
    // Satisfy the remaining prerequisite the state machine demands: an exporter-approved
    // Proforma Invoice bound to the current version + checksum.
    await scenario('C6', 'Lock succeeds once prerequisites are met: snapshot frozen, tasks + checklist created', async () => {
      await prisma.document.deleteMany({ where: { deal_id: NEG_DEAL } });
      await prisma.document.create({
        data: {
          deal_id: NEG_DEAL,
          doc_type: 'PI',
          version: 1,
          is_current_version: true,
          source: 'generated',
          generation_status: 'generated',
          review_status: 'agent_reviewed',
          approval_status: 'exporter_approved',
          approved_version: 1,
          approved_checksum: null,
          checksum: null,
          approved_by_id: 'seed-user-owner',
          approved_at: new Date(),
        },
      });

      const { ctx, page } = await loggedInContext(browser, 'agent@cleartrade.example');
      await page.goto(`${BASE}/agent/deals/${NEG_DEAL}/commercial`, { waitUntil: 'networkidle' });
      await sleep(800);
      const preBody = (await page.locator('body').textContent()) ?? '';
      const readyChipShown = /Ready to lock/.test(preBody);

      await page.getByRole('button', { name: /^Lock deal$/i }).click();
      const deadline = Date.now() + 20_000;
      let locked = null;
      while (Date.now() < deadline) {
        locked = await prisma.deal.findUniqueOrThrow({ where: { id: NEG_DEAL }, select: { stage: true, locked_at: true, quoted_fee_policy: true } });
        if (locked.locked_at) break;
        await sleep(400);
      }
      await ctx.close();

      const snapshot = await prisma.dealSnapshot.findFirst({ where: { deal_id: NEG_DEAL }, orderBy: { version: 'desc' } });
      const allDocs = await prisma.document.findMany({ where: { deal_id: NEG_DEAL }, select: { doc_type: true, generated_from_snapshot_id: true } });
      const execTasks = await prisma.task.findMany({
        where: { deal_id: NEG_DEAL, task_type: { in: ['exporter_confirm_ship_window', 'plan_shipment', 'insurance_applicability_check'] } },
        select: { task_type: true, owner_role: true },
      });
      const docTasks = await prisma.task.count({ where: { deal_id: NEG_DEAL, task_type: { startsWith: 'prepare_' } } });

      // The PI was created ABOVE as a lock prerequisite, so it predates the snapshot and
      // legitimately isn't linked to it. Only the documents the lock itself created are
      // expected to point at the frozen snapshot — counting the prerequisite as lock
      // output would assert something the state machine never promised.
      const lockCreatedDocs = allDocs.filter((d) => d.doc_type !== 'PI');
      const checklistLinked = lockCreatedDocs.length > 0 && lockCreatedDocs.every((d) => d.generated_from_snapshot_id === snapshot?.id);

      // The snapshot must carry the APPROVED terms, not whatever was on the deal row.
      const snapshotMatchesApproved = snapshot?.total_amount?.toString() === '14400' && snapshot?.incoterm === 'CIF';
      const feeFrozen = Boolean(locked?.quoted_fee_policy);

      record('C6', 'Lock succeeds once prerequisites are met: snapshot frozen, tasks + checklist created',
        locked?.stage === 'deal_locked' && Boolean(snapshot) && snapshotMatchesApproved && feeFrozen && checklistLinked && lockCreatedDocs.length === 6 && execTasks.length === 3 && docTasks >= 6 ? 'PASS' : 'FAIL',
        `"Ready to lock" shown before=${readyChipShown}; stage=${locked?.stage}, snapshot v${snapshot?.version} matches approved terms=${snapshotMatchesApproved}, fee policy frozen=${feeFrozen}, lock-created checklist docs=${lockCreatedDocs.length} of ${allDocs.length} total (all linked to snapshot=${checklistLinked}), execution tasks=${execTasks.length}, document tasks=${docTasks}`);
    });

    // ---------------------------------------------------------------- C7
    await scenario('C7', 'Locked terms are read-only; the exporter screen says so', async () => {
      const { ctx, page } = await loggedInContext(browser, 'owner@sunriseagro.example');
      await page.goto(`${BASE}/app/deals/${NEG_DEAL}/commercial`, { waitUntil: 'networkidle' });
      await sleep(600);
      const body = (await page.locator('body').textContent()) ?? '';
      const approveButtons = await page.getByRole('button', { name: /^Approve version/i }).count();
      await ctx.close();

      // The server must refuse a new proposal on a locked deal regardless of the UI.
      const agent = await loggedInContext(browser, 'agent@cleartrade.example');
      await agent.page.goto(`${BASE}/agent/deals/${NEG_DEAL}/commercial`, { waitUntil: 'networkidle' });
      const postResult = await agent.page.evaluate(async (dealId) => {
        const res = await fetch(`/api/v1/deals/${dealId}/proposals`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'propose', quantity: 999, unit: 'sets' }),
        });
        return { status: res.status, code: (await res.json().catch(() => null))?.error?.code };
      }, NEG_DEAL);
      await agent.ctx.close();

      const lockedCopyShown = /These terms are locked/.test(body);
      const serverRefused = postResult.status === 403;
      record('C7', 'Locked terms are read-only; the exporter screen says so',
        lockedCopyShown && approveButtons === 0 && serverRefused ? 'PASS' : 'FAIL',
        `locked notice shown=${lockedCopyShown}, approve buttons=${approveButtons} (expect 0), new proposal on locked deal refused=${serverRefused} (status=${postResult.status})`);
    });
  } finally {
    await browser.close();
  }

  summarize('COMMERCIAL NEGOTIATION + DEAL LOCK');
}

main()
  .catch((e) => {
    if (e instanceof PreflightError) console.error(`\n✗ PREFLIGHT FAILED\n\n  ${e.message}\n`);
    else console.error('SUITE CRASHED:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
