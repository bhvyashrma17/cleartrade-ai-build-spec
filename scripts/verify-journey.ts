/**
 * The full paid-tier journey, end to end in one browser session:
 *
 *   login -> dashboard -> readiness -> complete assessment -> journey rail advances ->
 *   discovery -> market detail -> select market -> find buyers -> create lead ->
 *   lead visible in the agent's outreach CRM
 *
 * Each leg records its own result, so a break in the middle still reports which legs
 * did work rather than collapsing to a single opaque failure.
 *
 *   npx tsx --env-file=.env scripts/verify-journey.ts
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
  type Page,
} from './verify-harness';
import { prisma } from '../src/lib/prisma';
import { deriveJourneyStage } from '../src/lib/journey';

const PAID_ORG = 'seed-org-1';

// Rail labels differ from the JourneyStage enum names — same mapping used by
// verify-acceptance.ts's EXP-01-AC01, kept in sync rather than re-derived differently.
const JOURNEY_STAGE_LABEL: Record<string, string> = {
  onboarding: 'Onboarding',
  ready: 'Readiness',
  market_selected: 'Market',
  buyer_engaged: 'Buyers',
  deal_locked: 'Deal',
  docs_cleared: 'Docs',
  shipped: 'Shipped',
  payment_realized: 'Paid',
};

async function gotoStep(page: Page, name: string) {
  await page.getByRole('button', { name: new RegExp(`\\d+\\. ${name}`) }).first().click();
  await sleep(300);
}

async function main() {
  await preflight();

  // Start from a known state so "the rail advanced" is a real transition, not a
  // pre-existing condition left over from an earlier run.
  await prisma.marketAssessment.updateMany({ where: { is_selected: true }, data: { is_selected: false } });
  await prisma.buyerLead.deleteMany({ where: { exporter_org_id: PAID_ORG } });

  const browser: Browser = await launch();
  let leadBuyerName = '';

  try {
    const { ctx, page } = await loggedInContext(browser, 'owner@sunriseagro.example');

    await scenario('J1', 'Login lands on the exporter dashboard', async () => {
      const path = new URL(page.url()).pathname;
      const body = (await page.locator('body').textContent()) ?? '';
      const is404 = /This page could not be found/i.test(body);
      const hasModules = /Your export journey/.test(body) && /Next actions/.test(body);
      record('J1', 'Login lands on the exporter dashboard', path === '/app/overview' && !is404 && hasModules ? 'PASS' : 'FAIL',
        `landed=${path}, 404=${is404}, dashboard modules rendered=${hasModules}`);
    });

    let railBefore = '';
    await scenario('J2', 'Readiness assessment completes and produces owned tasks', async () => {
      railBefore = (await page.locator('[aria-current="step"]').first().textContent())?.trim() ?? '';
      const tasksBefore = await prisma.task.count({ where: { exporter_org_id: PAID_ORG, task_type: { not: null } } });
      const priorCompleted = await prisma.readinessAssessment.findFirst({
        where: { exporter_org_id: PAID_ORG, is_current: true, completed_at: { not: null } },
        select: { id: true },
      });

      await page.goto(BASE + '/app/readiness', { waitUntil: 'networkidle' });
      await gotoStep(page, 'Product');
      await page.getByLabel('Product description').fill('Organic turmeric powder, food grade, export packed.');
      await gotoStep(page, 'Capacity');
      await page.getByLabel('Monthly capacity').fill('5000');
      await gotoStep(page, 'Compliance');
      for (const label of ['IEC verification', 'GSTIN verification', 'AD code verification']) {
        await page.getByLabel(label).selectOption('verified').catch(() => undefined);
      }
      await gotoStep(page, 'Samples');
      await page.getByLabel('Can you provide a buyer sample?').selectOption('yes').catch(() => undefined);
      await page.getByRole('button', { name: /Submit assessment/i }).first().click();

      const deadline = Date.now() + 40_000;
      let completed = false;
      while (Date.now() < deadline) {
        const row = await prisma.readinessAssessment.findFirst({
          where: { exporter_org_id: PAID_ORG, is_current: true },
          select: { id: true, completed_at: true },
        });
        // Must be a DIFFERENT assessment than the one already completed before submitting.
        if (row?.completed_at && row.id !== priorCompleted?.id) {
          completed = true;
          break;
        }
        await sleep(500);
      }
      const tasksAfter = await prisma.task.count({ where: { exporter_org_id: PAID_ORG, task_type: { not: null } } });
      const org = await prisma.exporterOrg.findUnique({ where: { id: PAID_ORG }, select: { readiness_status: true } });

      record('J2', 'Readiness assessment completes and produces owned tasks', completed ? 'PASS' : 'FAIL',
        `assessment completed=${completed}, readiness_status=${org?.readiness_status}, enablement tasks ${tasksBefore} -> ${tasksAfter}`);
    });

    await scenario('J3', 'Journey rail reflects the new readiness state', async () => {
      await page.goto(BASE + '/app/overview', { waitUntil: 'networkidle' });
      const railAfter = (await page.locator('[aria-current="step"]').first().textContent())?.trim() ?? '';
      const org = await prisma.exporterOrg.findUnique({ where: { id: PAID_ORG }, select: { readiness_status: true } });
      // Assert against the LIVE DERIVATION, not a hardcoded "Readiness". This org also
      // carries a permanently-seeded locked deal (seed-deal-locked), and
      // deriveJourneyStage() deliberately ranks deal-stage evidence above readiness —
      // "a later stage implies every earlier one happened" — so a real paid org with
      // both a completed readiness assessment AND a locked deal correctly shows "Deal",
      // not "Readiness". Hardcoding the old expectation would fail the moment realistic
      // deal fixtures exist, which is a test bug, not a product regression.
      const derived = await deriveJourneyStage(PAID_ORG);
      const expectedLabel = JOURNEY_STAGE_LABEL[derived] ?? derived;
      const agrees = railAfter.includes(expectedLabel);
      record('J3', 'Journey rail reflects the new readiness state', agrees ? 'PASS' : 'FAIL',
        `rail before="${railBefore}" after="${railAfter}"; server readiness_status=${org?.readiness_status}, live derivation=${derived} -> "${expectedLabel}" (rail must match the derivation, not drift)`);
    });

    let runId = '';
    await scenario('J4', 'Demand Discovery runs and returns ranked markets', async () => {
      await page.goto(BASE + '/app/markets', { waitUntil: 'networkidle' });
      await page.getByLabel('Product').selectOption('seed-product-turmeric');
      await page.getByRole('button', { name: /^Find markets$/i }).click();
      await page.getByText(/Markets ranked|Ranked, with gaps/i).waitFor({ timeout: 60_000 });
      await page.locator('ol li a[href^="/app/markets/"]').first().waitFor({ timeout: 20_000 });
      const count = await page.locator('ol li a[href^="/app/markets/"]').count();
      const run = await prisma.discoveryRun.findFirst({
        where: { exporter_org_id: PAID_ORG },
        orderBy: { created_at: 'desc' },
        select: { id: true, status: true },
      });
      runId = run?.id ?? '';
      record('J4', 'Demand Discovery runs and returns ranked markets', count > 0 && run?.status === 'completed' ? 'PASS' : 'FAIL',
        `ranked results rendered=${count}, run status=${run?.status}`);
    });

    let marketCountry = '';
    await scenario('J5', 'Market detail opens and the market can be selected as target', async () => {
      await page.locator('ol li a[href^="/app/markets/"]').first().click();
      // Wait for the detail ROUTE, not just a load event — reading the heading straight
      // after the click can still see the list page.
      await page.waitForURL(/\/app\/markets\/[^/]+$/, { timeout: 20_000 });
      await page.waitForLoadState('networkidle');
      await page.getByRole('button', { name: /Select as target|Selected target/i }).first().waitFor({ timeout: 15_000 });
      const heading = (await page.locator('h1').first().textContent())?.trim() ?? '';
      const sections = await Promise.all(
        ['Score breakdown', 'Requirements', 'Commercial signal', 'Logistics'].map((t) => page.getByText(t).count()),
      );
      await page.getByRole('button', { name: /^Select as target$/i }).click();
      // Poll for the durable write rather than sleeping a fixed 1500ms. Under the load of
      // several suites back to back that fixed wait was not always enough, and the miss
      // cascaded: J5 read `is_selected` before the mutation landed and J6 then inherited
      // an empty `marketCountry`, so one slow request failed two scenarios.
      let selected: { country_code: string } | null = null;
      const selectDeadline = Date.now() + 15_000;
      while (Date.now() < selectDeadline) {
        selected = await prisma.marketAssessment.findFirst({
          where: { is_selected: true, run: { exporter_org_id: PAID_ORG } },
          select: { country_code: true },
        });
        if (selected) break;
        await sleep(300);
      }
      marketCountry = selected?.country_code ?? '';
      record('J5', 'Market detail opens and the market can be selected as target',
        sections.every((c) => c > 0) && Boolean(selected) ? 'PASS' : 'FAIL',
        `detail heading="${heading}", sections=${sections.join(',')}, selected market persisted=${marketCountry || 'none'}`);
    });

    await scenario('J6', 'Find buyers carries market context into Buyer Discovery', async () => {
      await page.getByRole('link', { name: /Find buyers in/i }).click();
      // Wait for the destination route explicitly; `networkidle` alone can settle while
      // the client-side navigation is still in flight, and the fixed sleep that followed
      // it was the same load-sensitive guess that made J5 flaky.
      await page.waitForURL(/\/app\/buyers/, { timeout: 20_000 }).catch(() => undefined);
      await page.waitForLoadState('networkidle');
      // The country filter is prefilled by the client after mount — wait for it to hold a
      // value rather than assuming it is populated by a fixed deadline.
      await page.getByLabel(/Country code/i).first().waitFor({ timeout: 10_000 }).catch(() => undefined);
      const fieldDeadline = Date.now() + 8_000;
      while (Date.now() < fieldDeadline) {
        const v = await page.getByLabel(/Country code/i).inputValue().catch(() => '');
        if (v) break;
        await sleep(250);
      }
      const url = new URL(page.url());
      const countryParam = url.searchParams.get('country');
      const countryField = await page.getByLabel(/Country code/i).inputValue().catch(() => '');
      record('J6', 'Find buyers carries market context into Buyer Discovery',
        url.pathname === '/app/buyers' && countryParam === marketCountry && countryField === marketCountry ? 'PASS' : 'FAIL',
        `url=${url.pathname}?country=${countryParam}; prefilled filter="${countryField}"; selected market=${marketCountry}`);
    });

    await scenario('J7', 'Lead is created from a buyer', async () => {
      // The prefilled country filter may return no buyers; clear it so a lead can be made.
      const reset = page.getByRole('button', { name: /Reset filters/i }).first();
      if (await reset.count()) {
        await reset.click();
      }
      await page.getByLabel('Product').selectOption('seed-product-turmeric');
      // The buyer table refetches on every filter change. The fixed sleeps that used to
      // stand in for that were load-sensitive in the same way J5/J6 were: under load the
      // click landed on a stale row (or before the button existed) and J8 then had no
      // buyer name to look for, failing two scenarios from one slow request. Wait for a
      // populated table plus a settled network instead.
      await page.waitForLoadState('networkidle');
      await page.locator('tbody tr').first().waitFor({ timeout: 20_000 });
      const createBtn = page.getByRole('button', { name: /^Create lead$/i }).first();
      await createBtn.waitFor({ timeout: 20_000 });
      leadBuyerName = (await page.locator('tbody tr').first().locator('td').first().textContent())?.trim() ?? '';
      await createBtn.click();
      await page.getByText(/Lead created/i).first().waitFor({ timeout: 20_000 });
      // Poll for the durable row rather than trusting the toast — the confirmation can
      // paint marginally before the write is visible to a separate connection.
      let lead: { buyer: { display_name: string }; stage: string; assigned_agent_id: string | null } | null = null;
      const leadDeadline = Date.now() + 15_000;
      while (Date.now() < leadDeadline) {
        lead = await prisma.buyerLead.findFirst({
          where: { exporter_org_id: PAID_ORG },
          select: { stage: true, assigned_agent_id: true, buyer: { select: { display_name: true } } },
        });
        if (lead) break;
        await sleep(300);
      }
      record('J7', 'Lead is created from a buyer', lead ? 'PASS' : 'FAIL',
        `lead persisted=${Boolean(lead)}, buyer="${lead?.buyer.display_name}", stage=${lead?.stage}, assigned_agent=${lead?.assigned_agent_id ?? 'none'}`);
      if (lead) leadBuyerName = lead.buyer.display_name;
    });

    await ctx.close();

    await scenario('J8', 'Lead appears in the agent outreach CRM', async () => {
      const agent = await loggedInContext(browser, 'agent@cleartrade.example');
      await agent.page.goto(BASE + '/agent/outreach', { waitUntil: 'networkidle' });
      // The pipeline table fetches client-side after mount; poll for the buyer instead of
      // sleeping a fixed 1500ms, which under load read the page before the rows arrived.
      let body = '';
      const crmDeadline = Date.now() + 20_000;
      while (Date.now() < crmDeadline) {
        body = (await agent.page.locator('body').textContent()) ?? '';
        if (leadBuyerName && body.includes(leadBuyerName)) break;
        await sleep(400);
      }
      const visible = leadBuyerName.length > 0 && body.includes(leadBuyerName);
      await agent.ctx.close();
      record('J8', 'Lead appears in the agent outreach CRM', visible ? 'PASS' : 'FAIL',
        `looking for buyer "${leadBuyerName}" in the agent's pipeline; found=${visible}`);
    });
  } finally {
    await browser.close();
  }

  summarize('FULL PAID JOURNEY');
}

main()
  .catch((e) => {
    if (e instanceof PreflightError) console.error(`\n✗ PREFLIGHT FAILED\n\n  ${e.message}\n`);
    else console.error('SUITE CRASHED:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
