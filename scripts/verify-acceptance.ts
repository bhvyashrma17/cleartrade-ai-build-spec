/**
 * Acceptance-criteria verification for EXP-01, AGT-01, OPS-01 and EXP-02.
 *
 * Checks the criteria themselves, not "the page rendered". Where a criterion is only
 * meaningful against real data (a queue item cannot lack an owner if there are no queue
 * items), this seeds that data first — an empty surface trivially satisfying an AC is a
 * false pass, and several of these ACs are exactly that shape.
 *
 *   npx tsx --env-file=.env scripts/verify-acceptance.ts
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
import { JourneyStage, SlaState, TaskPriority, TaskState, UserRole, Visibility } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { deriveJourneyStage } from '../src/lib/journey';

const PAID_ORG = 'seed-org-1';
const AGENT_ID = 'seed-user-agent';
const FIXTURE_PREFIX = 'ac-fixture-';

/**
 * The readiness form renders only the active step's controls, so a field is not in the
 * DOM until its section is selected. Steps are buttons labelled "N. Name".
 */
async function gotoReadinessStep(page: import('./verify-harness').Page, name: string) {
  await page.getByRole('button', { name: new RegExp(`\\d+\\. ${name}`) }).first().click();
  await sleep(300);
}

/** Data the ACs need in order to be testable at all. Removed again at the end. */
async function seedFixtures() {
  await cleanupFixtures();
  const now = Date.now();

  // AGT-01: agent-owned queue items spanning the cases AC01/AC03 care about —
  // exporter-visible vs internal, with and without a due date.
  await prisma.task.createMany({
    data: [
      {
        id: FIXTURE_PREFIX + 'agent-overdue',
        scope_type: 'exporter_org',
        scope_id: PAID_ORG,
        exporter_org_id: PAID_ORG,
        title: 'Chase buyer response on turmeric enquiry',
        owner_user_id: AGENT_ID,
        owner_role: UserRole.agent,
        state: TaskState.in_progress,
        priority: TaskPriority.high,
        due_at: new Date(now - 86_400_000),
        sla_state: SlaState.overdue,
        visibility: Visibility.exporter_visible,
      },
      {
        id: FIXTURE_PREFIX + 'agent-internal',
        scope_type: 'exporter_org',
        scope_id: PAID_ORG,
        exporter_org_id: PAID_ORG,
        title: 'Margin review before quoting',
        owner_user_id: AGENT_ID,
        owner_role: UserRole.agent,
        state: TaskState.not_started,
        priority: TaskPriority.urgent,
        due_at: new Date(now + 3_600_000),
        sla_state: SlaState.due_soon,
        visibility: Visibility.internal,
      },
      {
        id: FIXTURE_PREFIX + 'agent-nodue',
        scope_type: 'exporter_org',
        scope_id: PAID_ORG,
        exporter_org_id: PAID_ORG,
        title: 'Blocked pending exporter document upload',
        owner_user_id: AGENT_ID,
        owner_role: UserRole.agent,
        state: TaskState.waiting,
        priority: TaskPriority.normal,
        due_at: null, // deliberately absent — AC01 requires a due time on every item
        sla_state: SlaState.on_time,
        blocked_reason: 'Waiting on exporter to upload the packing list',
        visibility: Visibility.internal,
      },
      // EXP-01: an exporter-owned task so the dashboard's Next Actions has real content,
      // plus an internal one that AC03 says must never surface to the exporter.
      {
        id: FIXTURE_PREFIX + 'exp-visible',
        scope_type: 'exporter_org',
        scope_id: PAID_ORG,
        exporter_org_id: PAID_ORG,
        title: 'Upload your IEC certificate',
        owner_user_id: null,
        owner_role: UserRole.exporter_owner,
        state: TaskState.not_started,
        priority: TaskPriority.high,
        due_at: new Date(now + 172_800_000),
        sla_state: SlaState.due_soon,
        visibility: Visibility.exporter_visible,
      },
      {
        id: FIXTURE_PREFIX + 'exp-internal-leak-probe',
        scope_type: 'exporter_org',
        scope_id: PAID_ORG,
        exporter_org_id: PAID_ORG,
        title: 'Agent commission reconciliation record',
        owner_user_id: null,
        owner_role: UserRole.exporter_owner, // owner_role alone must not make it visible
        state: TaskState.not_started,
        priority: TaskPriority.urgent,
        due_at: new Date(now + 86_400_000),
        sla_state: SlaState.due_soon,
        visibility: Visibility.internal,
      },
    ],
    skipDuplicates: true,
  });
}

async function cleanupFixtures() {
  await prisma.task.deleteMany({ where: { id: { startsWith: FIXTURE_PREFIX } } });
}

async function main() {
  await preflight();
  await seedFixtures();
  const browser: Browser = await launch();

  try {
    // ================= EXP-01 =================
    await scenario('EXP-01-AC01', 'Journey stage derived server-side, not read from the stored column', async () => {
      const before = await prisma.exporterOrg.findUnique({
        where: { id: PAID_ORG },
        select: { journey_stage: true, readiness_status: true },
      });

      // Derive FIRST, then poison with a value guaranteed to differ from it. Poisoning
      // with a fixed constant (previously `payment_realized`) went inconclusive whenever
      // this org's real derived stage happened to already BE that value — which
      // verify-journey's own progression legitimately produces. Deriving before choosing
      // the poison value makes that coincidence structurally impossible: whichever stage
      // the org is really at, the poison is picked to be something else.
      const derived = await deriveJourneyStage(PAID_ORG);
      const poison = derived === JourneyStage.onboarding ? JourneyStage.payment_realized : JourneyStage.onboarding;

      await prisma.exporterOrg.update({
        where: { id: PAID_ORG },
        data: { journey_stage: poison },
      });

      const { ctx, page } = await loggedInContext(browser, 'owner@sunriseagro.example');
      await page.goto(BASE + '/app/overview', { waitUntil: 'networkidle' });
      // aria-current="step" marks the CURRENT rail segment.
      const currentSegment = (await page.locator('[aria-current="step"]').first().textContent())?.trim() ?? '';
      await ctx.close();

      await prisma.exporterOrg.update({
        where: { id: PAID_ORG },
        data: { journey_stage: before!.journey_stage },
      });

      // Rail labels differ from enum names, so map the derived enum to its label.
      const STAGE_LABEL: Record<string, string> = {
        onboarding: 'Onboarding',
        ready: 'Readiness',
        market_selected: 'Market',
        buyer_engaged: 'Buyers',
        deal_locked: 'Deal',
        docs_cleared: 'Docs',
        shipped: 'Shipped',
        payment_realized: 'Paid',
      };
      const expectedLabel = STAGE_LABEL[derived] ?? derived;
      const poisonLabel = STAGE_LABEL[poison] ?? poison;
      // Passing requires the rail to match the DERIVED stage — poison and derived are
      // now guaranteed distinct by construction, so this is always a real proof, never
      // an inconclusive coincidence.
      const matchesDerived = currentSegment.includes(expectedLabel);

      record(
        'EXP-01-AC01',
        'Journey stage derived server-side, not read from the stored column',
        matchesDerived ? 'PASS' : 'FAIL',
        `stored column poisoned to '${poison}' (chosen to differ from the live derivation); rail rendered "${currentSegment}" and the live derivation says '${derived}' -> "${expectedLabel}" (a stored read would have shown "${poisonLabel}")`,
      );
    });

    await scenario('EXP-01-AC03', 'No internal notes, payout data or ops-only exceptions on the exporter dashboard', async () => {
      const { ctx, page } = await loggedInContext(browser, 'owner@sunriseagro.example');
      await page.goto(BASE + '/app/overview', { waitUntil: 'networkidle' });
      await sleep(1000);
      const body = (await page.locator('body').textContent()) ?? '';
      await ctx.close();

      const leaks: string[] = [];
      // The seeded internal task must not appear.
      if (/Agent commission reconciliation record/i.test(body)) leaks.push('internal task title');
      if (/commission|payout|agent share/i.test(body)) leaks.push('payout/commission wording');
      // Ops-only exception vocabulary.
      if (/unassigned exporters|escalation queue|control tower/i.test(body)) leaks.push('ops-only exception module');
      if (/internal note/i.test(body)) leaks.push('internal note');

      record(
        'EXP-01-AC03',
        'No internal notes, payout data or ops-only exceptions on the exporter dashboard',
        leaks.length === 0 ? 'PASS' : 'FAIL',
        leaks.length === 0
          ? 'seeded internal task + payout/ops vocabulary all absent from rendered dashboard'
          : `leaked: ${leaks.join(', ')}`,
      );
    });

    // ================= AGT-01 =================
    await scenario('AGT-01-AC01', 'Every queue item shows an owner and a due time', async () => {
      const { ctx, page } = await loggedInContext(browser, 'agent@cleartrade.example');
      await page.goto(BASE + '/agent', { waitUntil: 'networkidle' });
      await sleep(800);

      // Each queue row is an <li> in the "Today queue" section.
      const rows = await page
        .locator('section:has(h2:text("Today queue")) li')
        .evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()));
      await ctx.close();

      const seededTitles = ['Chase buyer response', 'Margin review before quoting', 'Blocked pending exporter'];
      const rendered = rows.filter((r) => seededTitles.some((t) => r.includes(t)));
      // "Owner" and a due time must be present per item. Look for an explicit owner
      // attribution and a date/relative-time string.
      const missingOwner = rendered.filter((r) => !/owner|assigned to|you\b/i.test(r));
      const missingDue = rendered.filter(
        (r) => !/\d{1,2}\s\w{3}\s\d{4}|due|overdue|today|tomorrow|\d+\s?(h|d)\b/i.test(r),
      );

      const ok = rendered.length > 0 && missingOwner.length === 0 && missingDue.length === 0;
      record(
        'AGT-01-AC01',
        'Every queue item shows an owner and a due time',
        ok ? 'PASS' : 'FAIL',
        `queue rows matched=${rendered.length}; missing owner=${missingOwner.length}; missing due time=${missingDue.length}` +
          (missingOwner.length || missingDue.length
            ? `\n        e.g. "${(missingOwner[0] ?? missingDue[0] ?? '').slice(0, 110)}"`
            : ''),
      );
    });

    await scenario('AGT-01-AC03', 'Internal vs exporter-facing tasks are visibly differentiated', async () => {
      const { ctx, page } = await loggedInContext(browser, 'agent@cleartrade.example');
      await page.goto(BASE + '/agent', { waitUntil: 'networkidle' });
      await sleep(800);
      const rows = await page
        .locator('section:has(h2:text("Today queue")) li')
        .evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()));
      await ctx.close();

      const internalRow = rows.find((r) => r.includes('Margin review before quoting'));
      const visibleRow = rows.find((r) => r.includes('Chase buyer response'));
      // A marker present on the internal row and absent on the exporter-visible one.
      const internalMarked = Boolean(internalRow && /internal|not visible to exporter|private/i.test(internalRow));
      const visibleUnmarked = Boolean(visibleRow && !/internal|private/i.test(visibleRow));

      record(
        'AGT-01-AC03',
        'Internal vs exporter-facing tasks are visibly differentiated',
        internalMarked && visibleUnmarked ? 'PASS' : 'FAIL',
        `internal row found=${Boolean(internalRow)} marked=${internalMarked}; exporter-visible row found=${Boolean(visibleRow)} unmarked=${visibleUnmarked}` +
          (internalRow ? `\n        internal row text: "${internalRow.slice(0, 110)}"` : ''),
      );
    });

    // ================= OPS-01 =================
    await scenario('OPS-01-AC01', 'Every KPI traces to its underlying filtered records', async () => {
      const { ctx, page } = await loggedInContext(browser, 'ops@cleartrade.example');
      await page.goto(BASE + '/ops', { waitUntil: 'networkidle' });
      await sleep(800);

      // Full href (incl. query string) — a prior version of this test read only
      // `.pathname`, which silently dropped the `?type=...`/`?filter=...` that actually
      // does the filtering and would have let an unfiltered destination pass.
      const kpis = await page
        .locator('section[aria-label="Exception KPIs"] a')
        .evaluateAll((els) =>
          els.map((e) => {
            const a = e as HTMLAnchorElement;
            const text = (e.textContent ?? '').replace(/\s+/g, ' ').trim();
            // MetricCard renders "<label><value>Open filtered queue" — the KPI count is
            // the first run of digits, before the fixed "Open filtered queue" suffix.
            const match = text.match(/(\d[\d,]*)/);
            const numeric = match ? Number(match[1].replace(/,/g, '')) : null;
            return { href: a.pathname + a.search, label: text.slice(0, 60), kpiValue: numeric };
          }),
        );

      const broken: string[] = [];
      const mismatched: string[] = [];
      for (const kpi of kpis) {
        const resp = await page.goto(BASE + kpi.href, { waitUntil: 'networkidle' });
        const body = (await page.locator('body').textContent()) ?? '';
        const is404 = /This page could not be found/i.test(body) || resp?.status() === 404;
        if (is404) {
          broken.push(`${kpi.href} (${kpi.label})`);
          continue;
        }
        // Every destination surfaces its filtered row count as "... (N)" in its first
        // heading, or in the case of Assignments' unassigned-queue chip, "N awaiting an
        // owner" / "No ownership gaps". Read whichever is present and require it to
        // equal the KPI's own count — a link that lands on the right *page* but the
        // wrong *filter* would otherwise still pass.
        const headingCount = await page
          .locator('h2')
          .first()
          .textContent()
          .then((t) => {
            const m = (t ?? '').match(/\((\d+)\)/);
            return m ? Number(m[1]) : null;
          })
          .catch(() => null);
        let destValue = headingCount;
        if (destValue === null) {
          const chipText = (await page.getByText(/awaiting an owner|No ownership gaps/i).first().textContent().catch(() => null)) ?? '';
          if (/No ownership gaps/i.test(chipText)) destValue = 0;
          else {
            const m = chipText.match(/(\d+)\s*awaiting an owner/i);
            if (m) destValue = Number(m[1]);
          }
        }
        if (kpi.kpiValue !== null && destValue !== null && destValue !== kpi.kpiValue) {
          mismatched.push(`${kpi.href} (${kpi.label}): KPI=${kpi.kpiValue}, destination shows ${destValue}`);
        }
      }
      await ctx.close();

      record(
        'OPS-01-AC01',
        'Every KPI traces to its underlying filtered records',
        kpis.length > 0 && broken.length === 0 && mismatched.length === 0 ? 'PASS' : 'FAIL',
        `KPIs=${kpis.length}; dead destinations=${broken.length}; filter mismatches=${mismatched.length}` +
          (broken.length ? `\n        dead: ${broken.join('\n        ')}` : '') +
          (mismatched.length ? `\n        mismatched: ${mismatched.join('\n        ')}` : ''),
      );
    });

    await scenario('OPS-01-SCOPE', 'Role scoping: supervisor is not exposed finance or settings surfaces', async () => {
      const { ctx, page } = await loggedInContext(browser, 'ops@cleartrade.example');
      await page.goto(BASE + '/ops', { waitUntil: 'networkidle' });
      await sleep(600);
      const navLinks = await page
        .getByRole('navigation')
        .first()
        .locator('a')
        .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));
      const bodyText = (await page.locator('body').textContent()) ?? '';
      await ctx.close();

      // A supervisor is not ops_finance and not admin.
      const financeExposed = navLinks.some((l) => /finance/i.test(l));
      const settingsExposed = navLinks.some((l) => /settings/i.test(l));
      const payoutDataExposed = /payout|commission|agent share/i.test(bodyText);

      record(
        'OPS-01-SCOPE',
        'Role scoping: supervisor is not exposed finance or settings surfaces',
        !financeExposed && !settingsExposed && !payoutDataExposed ? 'PASS' : 'FAIL',
        `nav=[${navLinks.join(', ')}]; finance in nav=${financeExposed}; settings in nav=${settingsExposed}; payout wording on page=${payoutDataExposed}`,
      );
    });

    // ================= EXP-02 =================
    await scenario('EXP-02-AC01', 'Resume without re-entering completed answers', async () => {
      const { ctx, page } = await loggedInContext(browser, 'owner@sunriseagro.example');
      await page.goto(BASE + '/app/readiness', { waitUntil: 'networkidle' });
      await gotoReadinessStep(page, 'Product');
      const marker = `Resume probe ${Date.now()}`;
      await page.getByLabel('Product description').fill(marker);
      await page.getByRole('button', { name: /^Save draft$/i }).first().click();
      await sleep(1800);
      // Leave the app entirely and come back — a real resume, not a client-state re-render.
      await page.goto(BASE + '/app/overview', { waitUntil: 'networkidle' });
      await page.goto(BASE + '/app/readiness', { waitUntil: 'networkidle' });
      await gotoReadinessStep(page, 'Product');
      const restored = await page.getByLabel('Product description').inputValue();
      await ctx.close();

      record(
        'EXP-02-AC01',
        'Resume without re-entering completed answers',
        restored === marker ? 'PASS' : 'FAIL',
        `wrote "${marker}", after navigating away and back the field held "${restored}"`,
      );
    });

    await scenario('EXP-02-AC04', 'IEC/GST/AD verification state is independent of field presence', async () => {
      // Set an identifier string but leave verification unset, then confirm the UI does
      // not infer "verified" from a non-empty value.
      await prisma.exporterOrg.update({
        where: { id: PAID_ORG },
        data: { iec_number: 'IEC0912345678', iec: 'unknown' },
      });
      // The form seeds its controls from the CURRENT ASSESSMENT'S answers, not from the
      // org column — so resetting only the column left a stale `iec_status: 'verified'`
      // in the answers and the control legitimately read "verified". That made this an
      // order-dependent failure (verify-journey fills the form with verified statuses)
      // rather than a real inference bug. Reset the actual source the control reads.
      const currentForAc04 = await prisma.readinessAssessment.findFirst({
        where: { exporter_org_id: PAID_ORG, is_current: true },
        select: { id: true, answers: true },
      });
      const priorAnswers = (currentForAc04?.answers ?? {}) as Record<string, unknown>;
      if (currentForAc04) {
        await prisma.readinessAssessment.update({
          where: { id: currentForAc04.id },
          data: { answers: { ...priorAnswers, iec_status: 'unknown', iec_number: 'IEC0912345678' } },
        });
      }
      const { ctx, page } = await loggedInContext(browser, 'owner@sunriseagro.example');
      await page.goto(BASE + '/app/readiness', { waitUntil: 'networkidle' });
      await sleep(600);
      const body = (await page.locator('body').textContent()) ?? '';
      // The compliance step holds the verification selects.
      const complianceBtn = page.getByRole('button', { name: /Compliance/i }).first();
      if (await complianceBtn.count()) {
        await complianceBtn.click();
        await sleep(400);
      }
      const iecSelect = page.getByLabel(/IEC verification/i);
      const iecValue = (await iecSelect.count()) ? await iecSelect.inputValue() : '(control not found)';
      await ctx.close();
      await prisma.exporterOrg.update({ where: { id: PAID_ORG }, data: { iec: 'verified' } });
      // Put the answers back, so this scenario doesn't contaminate the ones after it the
      // same way it was contaminated.
      if (currentForAc04) {
        await prisma.readinessAssessment.update({
          where: { id: currentForAc04.id },
          data: { answers: priorAnswers as never },
        });
      }

      const inferredVerified = /IEC[^.]{0,40}verified/i.test(body) && iecValue === 'verified';
      record(
        'EXP-02-AC04',
        'IEC/GST/AD verification state is independent of field presence',
        !inferredVerified && iecValue !== 'verified' ? 'PASS' : 'FAIL',
        `iec_number populated with iec status 'unknown'; IEC verification control read "${iecValue}" (must not be 'verified')`,
      );
    });

    await scenario('EXP-02-AC05', 'Re-running readiness preserves prior assessment history', async () => {
      const submitOnce = async (marker: string) => {
        const { ctx, page } = await loggedInContext(browser, 'owner@sunriseagro.example');
        await page.goto(BASE + '/app/readiness', { waitUntil: 'networkidle' });
        await gotoReadinessStep(page, 'Product');
        await page.getByLabel('Product description').fill(marker);
        await gotoReadinessStep(page, 'Samples');
        await page.getByRole('button', { name: /Submit assessment/i }).first().click();
        // Wait on durable state, not on a UI string: the job finishes in ~90ms, so
        // "Assessment completed" can appear and be replaced between two client polls.
        const deadline = Date.now() + 30_000;
        let done = false;
        while (Date.now() < deadline) {
          const n = await prisma.readinessAssessment.count({
            where: { exporter_org_id: PAID_ORG, completed_at: { not: null } },
          });
          if (n > completedBefore) {
            done = true;
            break;
          }
          await sleep(500);
        }
        await ctx.close();
        return done;
      };

      // A first assessment must exist before "re-running preserves history" means anything.
      let completedBefore = await prisma.readinessAssessment.count({
        where: { exporter_org_id: PAID_ORG, completed_at: { not: null } },
      });
      if (completedBefore === 0) {
        const seeded = await submitOnce('Baseline assessment for history check.');
        if (!seeded) throw new Error('could not create the baseline assessment');
        completedBefore = await prisma.readinessAssessment.count({
          where: { exporter_org_id: PAID_ORG, completed_at: { not: null } },
        });
      }

      const firstRun = await prisma.readinessAssessment.findMany({
        where: { exporter_org_id: PAID_ORG },
        select: { id: true, score: true },
      });
      const firstIds = firstRun.map((r) => r.id);

      // Now the actual re-run.
      const rerun = await submitOnce('Re-run assessment to verify prior history survives.');
      if (!rerun) throw new Error('re-run assessment did not complete within 30s');

      const after = await prisma.readinessAssessment.findMany({
        where: { exporter_org_id: PAID_ORG },
        select: { id: true, is_current: true, completed_at: true },
      });
      const survivors = after.filter((a) => firstIds.includes(a.id)).length;
      const currentCount = after.filter((a) => a.is_current).length;
      const completedAfter = after.filter((a) => a.completed_at).length;

      // Row count is NOT the right signal. Submitting an existing in-progress draft
      // completes it in place; only a submit made when the current assessment is already
      // completed adds a row. What the AC actually requires is that no prior assessment
      // is destroyed, a further completed result now exists, and exactly one is current.
      const ok = survivors === firstIds.length && completedAfter > completedBefore && currentCount === 1;
      record(
        'EXP-02-AC05',
        'Re-running readiness preserves prior assessment history',
        ok ? 'PASS' : 'FAIL',
        `prior rows preserved ${survivors}/${firstIds.length}; completed assessments ${completedBefore} -> ${completedAfter}; exactly-one-current=${currentCount === 1}`,
      );
    });

    await scenario('EXP-02-AC02', 'Conditional questions never silently erase captured data', async () => {
      const { ctx, page } = await loggedInContext(browser, 'owner@sunriseagro.example');
      await page.goto(BASE + '/app/readiness', { waitUntil: 'networkidle' });
      // "Certification details" is revealed by answering yes to holding certifications.
      await gotoReadinessStep(page, 'Packaging');
      const toggle = page.getByLabel('Do you hold relevant certifications?');
      const detail = page.getByLabel('Certification details');
      let outcome = 'control not found';
      let preserved = false;
      if ((await toggle.count()) && (await detail.count().catch(() => 0)) >= 0) {
        await toggle.selectOption('yes').catch(() => undefined);
        await sleep(300);
        const marker = `Cert marker ${Date.now()}`;
        if (await detail.count()) {
          await detail.fill(marker);
          // Flip the parent answer away and back — the classic silent-erase path.
          await toggle.selectOption('no').catch(() => undefined);
          await sleep(300);
          await toggle.selectOption('yes').catch(() => undefined);
          await sleep(300);
          const after = (await detail.count()) ? await detail.inputValue() : '';
          preserved = after === marker;
          outcome = `wrote "${marker}", after toggling the parent answer away and back it held "${after}"`;
        } else {
          outcome = 'conditional field never rendered for yes answer';
        }
      }
      await ctx.close();
      record(
        'EXP-02-AC02',
        'Conditional questions never silently erase captured data',
        preserved ? 'PASS' : 'FAIL',
        outcome,
      );
    });

    await scenario('EXP-02-AC03', 'Assessment creates real owned Tasks', async () => {
      const tasks = await prisma.task.findMany({
        where: {
          exporter_org_id: PAID_ORG,
          id: { not: { startsWith: FIXTURE_PREFIX } },
          task_type: { not: null },
        },
        select: { id: true, title: true, owner_role: true, owner_user_id: true, state: true, task_type: true },
      });
      const withoutOwner = tasks.filter((t) => !t.owner_role);
      record(
        'EXP-02-AC03',
        'Assessment creates real owned Tasks',
        tasks.length > 0 && withoutOwner.length === 0 ? 'PASS' : 'FAIL',
        tasks.length === 0
          ? 'no Tasks were created by the readiness submission (blockers did not become tasks)'
          : `created ${tasks.length} task(s), all with an accountable owner_role; e.g. "${tasks[0]!.title}" owner=${tasks[0]!.owner_role} state=${tasks[0]!.state}`,
      );
    });
  } finally {
    await browser.close();
    await cleanupFixtures();
  }

  summarize('ACCEPTANCE CRITERIA');
}

main()
  .catch((e) => {
    if (e instanceof PreflightError) console.error(`\n✗ PREFLIGHT FAILED\n\n  ${e.message}\n`);
    else console.error('SUITE CRASHED:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
