/**
 * Verification: the pre-membership estimate and the commitment-fee gate on full Demand
 * Discovery (docs/14 §3a).
 *
 * Per AGENTS.md ("seeded fixtures hand-place END states, so the transitions into them go
 * unexercised"): the paid-tier transition is built from scratch here — register a brand
 * new account through the real `/api/v1/register` route, pay the commitment fee through
 * the real `/api/v1/exporter-org/commitment-fee` route, and only then check that full
 * Demand Discovery opens up. Nothing is hand-inserted at `tier: 'paid'` or
 * `commitment_fee_status: 'paid'`.
 *
 *   npx tsx --env-file=.env scripts/verify-commitment-fee-gate.ts
 */

import {
  guestContext,
  launch,
  loggedInContext,
  loginAs,
  preflight,
  PreflightError,
  record,
  scenario,
  summarize,
  type Browser,
  type Page,
} from './verify-harness';
import { prisma } from '../src/lib/prisma';

async function fetchJson(
  page: Page,
  url: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; body: unknown }> {
  return page.evaluate(
    async ([u, method, bodyStr]) => {
      const r = await fetch(u, {
        method: method || 'GET',
        headers: bodyStr ? { 'Content-Type': 'application/json' } : undefined,
        body: bodyStr || undefined,
      });
      const text = await r.text();
      let body: unknown = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      return { status: r.status, body };
    },
    [url, init?.method ?? 'GET', init?.body ? JSON.stringify(init.body) : ''] as const,
  );
}

const FREE_FIXTURE = 'free@deccanspice.example';
const createdOrgIds: string[] = [];

async function cleanup() {
  for (const orgId of createdOrgIds) {
    await prisma.auditEvent.deleteMany({ where: { exporter_org_id: orgId } });
    await prisma.jobAttempt.deleteMany({ where: { job: { exporter_org_id: orgId } } });
    await prisma.job.deleteMany({ where: { exporter_org_id: orgId } });
    await prisma.discoveryRun.deleteMany({ where: { exporter_org_id: orgId } });
    await prisma.user.deleteMany({ where: { exporter_org_id: orgId } });
    await prisma.exporterOrg.deleteMany({ where: { id: orgId } });
  }
}

async function main() {
  await preflight();
  const browser: Browser = await launch();

  try {
    // -----------------------------------------------------------------
    // Scenario 1: an anonymous visitor gets the pre-membership estimate — observed
    // history only, never a ranking, never a projection — and it costs nothing to reach.
    // -----------------------------------------------------------------
    let orgCountBefore = 0;
    let runCountBefore = 0;

    await scenario('CFG-1', 'Anonymous estimate: observed history only, mints exactly one guest tenant, framing intact', async () => {
      orgCountBefore = await prisma.exporterOrg.count();
      runCountBefore = await prisma.discoveryRun.count();

      const ctx = await guestContext(browser, 'CFG-1');
      const page = await ctx.newPage();
      await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });

      const res = await fetchJson(page, '/api/v1/market-estimates', {
        method: 'POST',
        body: { product_description: 'Organic turmeric powder, food grade', hs_code: '091030', monthly_quantity: 500 },
      });
      const data = (res.body as { data?: { markets: { headline: string }[]; disclaimer: string } })?.data;

      const orgCountAfter = await prisma.exporterOrg.count();
      const runCountAfter = await prisma.discoveryRun.count();

      const hasResults = Boolean(data?.markets?.length);
      const hasDisclaimer = Boolean(data?.disclaimer?.toLowerCase().includes('not a forecast'));
      // The literal required framing: "buyers in ... imported ... at ... per unit."
      const headlinesFramedCorrectly = data?.markets.every((m) => /^Buyers in .+ imported .+ (worth|in) /.test(m.headline)) ?? false;
      // No projection/earnings language anywhere in the payload.
      const forbiddenWords = ['you could earn', 'projected', 'forecast revenue', 'potential earnings', 'you will make'];
      const payloadText = JSON.stringify(data ?? {}).toLowerCase();
      const noProjectionLanguage = !forbiddenWords.some((w) => payloadText.includes(w));
      // The estimate is now the "first search" that mints a guest tenant (docs/14 §3a/§5)
      // — full Demand Discovery no longer mints at all, so without this the guest
      // lifecycle (registration upgrade, purge job) becomes permanently unreachable.
      // What must stay true is that the ESTIMATE itself is never persisted as a row.
      const mintedExactlyOneTenant = orgCountAfter === orgCountBefore + 1;
      const noRunPersisted = runCountAfter === runCountBefore;

      if (mintedExactlyOneTenant) {
        const minted = await prisma.exporterOrg.findFirst({ where: { tier: 'guest' }, orderBy: { created_at: 'desc' }, select: { id: true } });
        if (minted) createdOrgIds.push(minted.id);
      }

      await ctx.close();

      const pass = res.status === 200 && hasResults && hasDisclaimer && headlinesFramedCorrectly && noProjectionLanguage && mintedExactlyOneTenant && noRunPersisted;
      record(
        'CFG-1',
        'Anonymous estimate: observed history only, mints exactly one guest tenant, framing intact',
        pass ? 'PASS' : 'FAIL',
        `status=${res.status}; markets=${data?.markets?.length}; disclaimer present=${hasDisclaimer}; headlines correctly framed=${headlinesFramedCorrectly}; no projection language=${noProjectionLanguage}; ExporterOrg count ${orgCountBefore}->${orgCountAfter} (expect +1); DiscoveryRun count unchanged=${noRunPersisted} (the estimate itself is never persisted)`,
      );
    });

    // -----------------------------------------------------------------
    // Scenario 2: monthly_quantity is captured and echoed, but never an operand — two
    // requests differing only in quantity must produce identical market data.
    // -----------------------------------------------------------------
    await scenario('CFG-2', 'monthly_quantity never enters the arithmetic', async () => {
      const ctx = await guestContext(browser, 'CFG-2');
      const page = await ctx.newPage();
      await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });

      const low = await fetchJson(page, '/api/v1/market-estimates', {
        method: 'POST',
        body: { product_description: 'Cotton bedsheets', hs_code: '630221', monthly_quantity: 10 },
      });
      const high = await fetchJson(page, '/api/v1/market-estimates', {
        method: 'POST',
        body: { product_description: 'Cotton bedsheets', hs_code: '630221', monthly_quantity: 500_000 },
      });

      const lowData = (low.body as { data?: { markets: unknown[] } })?.data;
      const highData = (high.body as { data?: { markets: unknown[] } })?.data;
      const identical = JSON.stringify(lowData?.markets) === JSON.stringify(highData?.markets);

      // Both calls share this context's session — only the first mints. Same session,
      // clean up once.
      const minted = await prisma.exporterOrg.findFirst({ where: { tier: 'guest' }, orderBy: { created_at: 'desc' }, select: { id: true } });
      if (minted) createdOrgIds.push(minted.id);

      await ctx.close();

      const pass = low.status === 200 && high.status === 200 && identical;
      record(
        'CFG-2',
        'monthly_quantity never enters the arithmetic',
        pass ? 'PASS' : 'FAIL',
        `quantity=10 markets vs quantity=500000 markets are byte-identical=${identical} (same hs_code, different cache-key band, same computed data)`,
      );
    });

    // -----------------------------------------------------------------
    // Scenario 3: full Demand Discovery rejects an anonymous caller WITHOUT minting a
    // guest tenant — the early tier check must fire before any write.
    // -----------------------------------------------------------------
    await scenario('CFG-3', 'Full Demand Discovery: anonymous caller gets 402, no tenant minted', async () => {
      const before = await prisma.exporterOrg.count();
      const ctx = await guestContext(browser, 'CFG-3');
      const page = await ctx.newPage();
      await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });

      const res = await fetchJson(page, '/api/v1/discovery-runs', {
        method: 'POST',
        body: { product_description: 'Organic turmeric powder', hs_code: '091030' },
      });
      const after = await prisma.exporterOrg.count();
      await ctx.close();

      const body = res.body as { error?: { code?: string }; required_tier?: string } | null;
      const pass = res.status === 402 && body?.error?.code === 'UPGRADE_REQUIRED' && body?.required_tier === 'paid' && after === before;
      record(
        'CFG-3',
        'Full Demand Discovery: anonymous caller gets 402, no tenant minted',
        pass ? 'PASS' : 'FAIL',
        `status=${res.status}; code=${body?.error?.code}; required_tier=${body?.required_tier}; ExporterOrg count unchanged=${after === before} (${before}->${after})`,
      );
    });

    // -----------------------------------------------------------------
    // Scenario 4: free tier (the shared seed fixture, read-only — never mutated) is
    // still blocked from full Demand Discovery and from save/select.
    // -----------------------------------------------------------------
    await scenario('CFG-4', 'Free tier: full Demand Discovery and save/select both 402', async () => {
      const { ctx, page } = await loggedInContext(browser, FREE_FIXTURE);

      const runRes = await fetchJson(page, '/api/v1/discovery-runs', {
        method: 'POST',
        body: { product_description: 'Organic turmeric powder', hs_code: '091030' },
      });

      const anyAssessment = await prisma.marketAssessment.findFirst({ select: { id: true } });
      const realSaveRes = anyAssessment
        ? await fetchJson(page, `/api/v1/market-assessments/${anyAssessment.id}/save`, { method: 'POST' })
        : null;

      await ctx.close();

      const runBody = runRes.body as { error?: { code?: string } } | null;
      const saveBody = realSaveRes?.body as { error?: { code?: string } } | null;
      const pass =
        runRes.status === 402 &&
        runBody?.error?.code === 'UPGRADE_REQUIRED' &&
        (!anyAssessment || (realSaveRes?.status === 402 && saveBody?.error?.code === 'UPGRADE_REQUIRED'));

      record(
        'CFG-4',
        'Free tier: full Demand Discovery and save/select both 402',
        pass ? 'PASS' : 'FAIL',
        `discovery-runs status=${runRes.status} code=${runBody?.error?.code}; save status=${realSaveRes?.status ?? 'n/a (no assessment fixture)'} code=${saveBody?.error?.code ?? 'n/a'}`,
      );
    });

    // -----------------------------------------------------------------
    // Scenario 5: full funnel from scratch — register, fee is due, pay it, tier flips to
    // paid, full Demand Discovery then succeeds. Built via the REAL routes end to end.
    // -----------------------------------------------------------------
    await scenario('CFG-5', 'From-scratch funnel: register -> fee due -> pay -> paid tier -> full Discovery unlocked', async () => {
      const ctx = await guestContext(browser, 'CFG-5');
      const page = await ctx.newPage();
      await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });

      const email = `verify-cfg5-${Date.now()}@example.com`;
      const registerRes = await fetchJson(page, '/api/v1/register', {
        method: 'POST',
        body: { email, password: 'Password123!', name: 'CFG5 Test', organization_name: 'CFG5 Test Exports' },
      });
      const registerBody = registerRes.body as { data?: { exporter_org_id: string; tier: string } } | null;
      const orgId = registerBody?.data?.exporter_org_id;
      if (orgId) createdOrgIds.push(orgId);

      const orgAfterRegister = orgId
        ? await prisma.exporterOrg.findUnique({
            where: { id: orgId },
            select: { tier: true, commitment_fee_status: true, commitment_fee_amount: true },
          })
        : null;

      // A FRESH signup (no prior guest session) is not auto-signed-in by the register
      // route — only the guest-upgrade branch inherits an existing session cookie. This
      // is a pre-existing behavior of the app, not something this feature changes; the
      // real RegisterForm has the same gap for a directly-navigated /register visit.
      await loginAs(page, email);

      // Registration alone must NOT unlock full Discovery — the fee is due, not paid.
      const blockedBeforePay = await fetchJson(page, '/api/v1/discovery-runs', {
        method: 'POST',
        body: { product_description: 'Organic turmeric powder', hs_code: '091030' },
      });

      const payRes = await fetchJson(page, '/api/v1/exporter-org/commitment-fee', {
        method: 'PATCH',
        body: { action: 'pay', source: 'exporter_update' },
      });
      const payBody = payRes.body as { data?: { commitment_fee_status: string; tier: string } } | null;

      const orgAfterPay = orgId
        ? await prisma.exporterOrg.findUnique({
            where: { id: orgId },
            select: { tier: true, commitment_fee_status: true, commitment_fee_paid_at: true, commitment_fee_source: true },
          })
        : null;

      const unlockedAfterPay = await fetchJson(page, '/api/v1/discovery-runs', {
        method: 'POST',
        body: { product_description: 'Organic turmeric powder', hs_code: '091030' },
      });

      await ctx.close();

      const pass =
        registerRes.status === 201 &&
        orgAfterRegister?.tier === 'free' &&
        orgAfterRegister?.commitment_fee_status === 'due' &&
        orgAfterRegister?.commitment_fee_amount != null &&
        blockedBeforePay.status === 402 &&
        payRes.status === 200 &&
        payBody?.data?.commitment_fee_status === 'paid' &&
        payBody?.data?.tier === 'paid' &&
        orgAfterPay?.tier === 'paid' &&
        orgAfterPay?.commitment_fee_status === 'paid' &&
        orgAfterPay?.commitment_fee_source === 'exporter_update' &&
        Boolean(orgAfterPay?.commitment_fee_paid_at) &&
        (unlockedAfterPay.status === 200 || unlockedAfterPay.status === 202);

      record(
        'CFG-5',
        'From-scratch funnel: register -> fee due -> pay -> paid tier -> full Discovery unlocked',
        pass ? 'PASS' : 'FAIL',
        `register=${registerRes.status} (tier=${orgAfterRegister?.tier}, fee=${orgAfterRegister?.commitment_fee_status}, amount=${orgAfterRegister?.commitment_fee_amount}); blocked pre-pay=${blockedBeforePay.status}; pay=${payRes.status} (fee=${payBody?.data?.commitment_fee_status}, tier=${payBody?.data?.tier}); DB after pay: tier=${orgAfterPay?.tier} fee=${orgAfterPay?.commitment_fee_status} source=${orgAfterPay?.commitment_fee_source}; unlocked after pay=${unlockedAfterPay.status}`,
      );
    });

    // -----------------------------------------------------------------
    // Scenario 6: paying twice is rejected by the state machine (paid -> paid is not a
    // legal transition — `from === to` guard) rather than silently succeeding again.
    // -----------------------------------------------------------------
    await scenario('CFG-6', 'Paying an already-paid fee is rejected, not silently repeated', async () => {
      const orgId = createdOrgIds[createdOrgIds.length - 1];
      if (!orgId) throw new Error('CFG-5 must run first and create an org.');

      const user = await prisma.user.findFirst({ where: { exporter_org_id: orgId }, select: { email: true } });
      if (!user) throw new Error('CFG-5 user not found for CFG-6.');

      const { ctx: ctx2, page: page2 } = await loggedInContext(browser, user.email);
      const res = await fetchJson(page2, '/api/v1/exporter-org/commitment-fee', {
        method: 'PATCH',
        body: { action: 'pay', source: 'exporter_update' },
      });
      await ctx2.close();

      const body = res.body as { error?: { code?: string } } | null;
      const pass = res.status === 422 && body?.error?.code === 'INVALID_TRANSITION';
      record(
        'CFG-6',
        'Paying an already-paid fee is rejected, not silently repeated',
        pass ? 'PASS' : 'FAIL',
        `status=${res.status}; code=${body?.error?.code}`,
      );
    });
  } finally {
    await cleanup();
    await browser.close();
  }

  summarize('COMMITMENT FEE GATE VERIFICATION');
}

main()
  .catch((e) => {
    if (e instanceof PreflightError) console.error(`\n✗ PREFLIGHT FAILED\n\n  ${e.message}\n`);
    else console.error('SUITE CRASHED:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
