/**
 * EXP-17 Notifications & Account, EXP-03 Enablement Center, EXP-07 Buyer Detail —
 * acceptance verification.
 *
 * Run with the dev server and worker up:
 *   npx tsx --env-file=.env scripts/verify-notifications-enablement-buyer.ts
 */

import {
  launch,
  loggedInContext,
  loginAs,
  preflight,
  PreflightError,
  record,
  scenario,
  sleep,
  summarize,
  BASE,
  type Browser,
  type Page,
} from './verify-harness';
import { prisma } from '../src/lib/prisma';

const OWNER = 'owner@sunriseagro.example';
const MEMBER = 'member@sunriseagro.example';
const AGENT = 'agent@cleartrade.example';
const ORG_ID = 'seed-org-1';

async function fetchJson(page: Page, url: string, init?: { method?: string; body?: unknown }): Promise<{ status: number; body: unknown }> {
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

async function resetFixtures() {
  await prisma.notification.updateMany({
    where: { user_id: 'seed-user-owner', dedupe_key: { startsWith: 'seed-notif' } },
    data: {},
  });
  await prisma.notification.updateMany({ where: { dedupe_key: 'seed-notif-1' }, data: { read_at: null } });
  await prisma.invitation.deleteMany({ where: { exporter_org_id: ORG_ID, id: { not: 'seed-invitation-1' } } });
  await prisma.invitation.updateMany({ where: { id: 'seed-invitation-1' }, data: { status: 'pending', revoked_at: null } });
  await prisma.taskEvidence.deleteMany({ where: { id: { notIn: ['seed-evidence-iec-1', 'seed-evidence-gst-1', 'seed-evidence-ad-code-1'] } } });
  await prisma.task.updateMany({
    where: { id: 'seed-task-readiness-packaging-qc' },
    data: { state: 'not_started', completed_at: null },
  });
  await prisma.buyerLead.deleteMany({
    where: { exporter_org_id: ORG_ID, buyer_id: 'seed-buyer-4', product_id: 'seed-product-turmeric' },
  });
}

async function main() {
  await preflight();
  await resetFixtures();
  const browser: Browser = await launch();

  try {
    // =====================================================================
    // EXP-17 Notifications & Account
    // =====================================================================
    await scenario('EXP17-AC01', 'AC01: notification deep-link resolves and marks read', async () => {
      // Arrange the precondition explicitly instead of relying on ambient list volume.
      // `/app/notifications` paginates and sorts unread-first, newest-first, so as other
      // suites accumulate notifications for this user the seeded row drifts off page 1
      // and the link genuinely is not rendered — which failed this scenario for a reason
      // that has nothing to do with what AC01 asserts (does a deep link mark read and
      // navigate?). Pinning it unread and newest makes it row 1 deterministically.
      await prisma.notification.updateMany({
        where: { user_id: 'seed-user-owner', dedupe_key: 'seed-notif-1' },
        data: { read_at: null, created_at: new Date() },
      });
      const before = await prisma.notification.findUniqueOrThrow({
        where: { user_id_dedupe_key: { user_id: 'seed-user-owner', dedupe_key: 'seed-notif-1' } },
      });

      const { ctx, page } = await loggedInContext(browser, OWNER);
      await page.goto(`${BASE}/app/notifications`, { waitUntil: 'networkidle' });
      await sleep(600);
      const link = page.locator(`a[href="${before.deep_link}"]`).first();
      const linkExists = (await link.count()) > 0;
      if (linkExists) await link.click();
      // The click handler awaits the mark-read PATCH before calling `router.push()` — a
      // client-side transition, not a hard navigation, so `waitForLoadState('networkidle')`
      // called immediately after `.click()` can resolve before that async chain even
      // starts (Playwright's `click()` returns once the event fires, not once async
      // handlers finish). Wait for the URL itself to settle instead.
      await page.waitForURL((url) => url.pathname === before.deep_link, { timeout: 10_000 }).catch(() => undefined);
      const landedPath = new URL(page.url()).pathname;
      await ctx.close();

      const after = await prisma.notification.findUniqueOrThrow({ where: { id: before.id } });
      record(
        'EXP17-AC01',
        'AC01: notification deep-link resolves and marks read',
        linkExists && landedPath === before.deep_link && Boolean(after.read_at) ? 'PASS' : 'FAIL',
        `deep_link=${before.deep_link}, link rendered=${linkExists}, landed=${landedPath}, read_at set after click=${Boolean(after.read_at)}`,
      );
    });

    await scenario('EXP17-AC02', 'AC02: read status syncs across sessions', async () => {
      await prisma.notification.updateMany({ where: { dedupe_key: 'seed-notif-2' }, data: { read_at: null } });
      const notif = await prisma.notification.findUniqueOrThrow({
        where: { user_id_dedupe_key: { user_id: 'seed-user-owner', dedupe_key: 'seed-notif-2' } },
      });

      // Session A marks it read via the API directly (not the UI click path — this
      // isolates the AC from AC01's link-rendering concern).
      const { ctx: ctxA, page: pageA } = await loggedInContext(browser, OWNER);
      const markRes = await fetchJson(pageA, `/api/v1/notifications/${notif.id}`, { method: 'PATCH', body: {} });
      await ctxA.close();

      // Session B must be a genuinely independent login, and that has to be PROVEN, not
      // asserted in a comment. Comparing session-cookie values does NOT prove it: auth
      // here is NextAuth's JWT strategy, which signs {sub, role, iat} — two logins for
      // the same user in the same second yield byte-identical tokens, so equality would
      // be a property of the signing scheme, not evidence of a shared session.
      //
      // What does prove it: a fresh context whose cookie jar is verifiably EMPTY and
      // which is verifiably UNAUTHENTICATED before logging in, then authenticates itself
      // through the real /login form. That rules out any carried-over session.
      const ctxB = await browser.newContext();
      const pageB = await ctxB.newPage();
      const cookiesBeforeLogin = await ctxB.cookies();
      await pageB.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
      const preLoginProbe = await fetchJson(pageB, '/api/v1/notifications?per_page=1');
      const startedUnauthenticated = cookiesBeforeLogin.length === 0 && preLoginProbe.status === 401;

      await loginAs(pageB, OWNER);
      // Page until the row is found rather than searching a single page. The list sorts
      // unread-first, so marking this row READ deliberately pushes it behind every
      // unread row — the very act under test moves it out of a fixed first page. A
      // single-page read therefore fails for a reason unrelated to the assertion once
      // this user has more unread notifications than fit in one page.
      type NotifRow = { id: string; read_at: string | null };
      let sameRow: NotifRow | undefined;
      let pagesScanned = 0;
      let readBack: { status: number; body: unknown } = { status: 0, body: null };
      for (let page = 1; page <= 20 && !sameRow; page++) {
        readBack = await fetchJson(pageB, `/api/v1/notifications?per_page=50&page=${page}`);
        const pageRows = (readBack.body as { data?: NotifRow[] } | null)?.data ?? [];
        pagesScanned = page;
        sameRow = pageRows.find((r) => r.id === notif.id);
        if (pageRows.length === 0) break;
      }
      await ctxB.close();

      record(
        'EXP17-AC02',
        'AC02: read status syncs across sessions',
        markRes.status === 200 && startedUnauthenticated && Boolean(sameRow?.read_at) ? 'PASS' : 'FAIL',
        `session A mark-read=${markRes.status}; session B started with an empty cookie jar (${cookiesBeforeLogin.length} cookies) and was unauthenticated (pre-login API probe=${preLoginProbe.status}, expect 401) before logging in independently=${startedUnauthenticated}; session B paged ${pagesScanned} page(s) and sees read_at=${Boolean(sameRow?.read_at)} on the same row (${notif.id}) — server-side state, not a client cache`,
      );
    });

    await scenario('EXP17-AC01b', 'AC01: a deep link to an inaccessible target fails safe — the link is not an authorization grant', async () => {
      // A notification's deep_link is stored at write time. By the time it is clicked the
      // target may be gone, or may never have belonged to this user at all. Both must
      // render the app's normal not-found surface, never a crash and never the object.
      const otherOrg = await prisma.exporterOrg.findUniqueOrThrow({ where: { id: 'seed-org-free' } });
      const foreignDeal = await prisma.deal.create({
        data: {
          exporter_org_id: otherOrg.id,
          buyer_id: 'seed-buyer-2',
          stage: 'negotiating',
          value_amount: 9999,
          value_currency: 'USD',
          risk_state: 'normal',
        },
      });

      // Two poisoned notifications for the PAID owner: one pointing at a deleted/never
      // -existed object, one pointing at another tenant's real deal.
      const probes = [
        { key: 'probe-deadlink', link: '/app/deals/definitely-not-a-real-deal-id', label: 'nonexistent object' },
        { key: 'probe-crosstenant', link: `/app/deals/${foreignDeal.id}`, label: "another tenant's real deal" },
      ];
      for (const p of probes) {
        await prisma.notification.upsert({
          where: { user_id_dedupe_key: { user_id: 'seed-user-owner', dedupe_key: p.key } },
          update: { read_at: null, deep_link: p.link },
          create: {
            user_id: 'seed-user-owner',
            type: 'deal_message',
            title: `Probe: ${p.label}`,
            body: 'Verification probe for deep-link fail-safe handling.',
            severity: 'info',
            object_type: 'deal',
            deep_link: p.link,
            dedupe_key: p.key,
          },
        });
      }

      const { ctx, page } = await loggedInContext(browser, OWNER);
      const pageErrors: string[] = [];
      page.on('pageerror', (e) => pageErrors.push(e.message));

      const results: string[] = [];
      let allSafe = true;
      for (const p of probes) {
        const resp = await page.goto(BASE + p.link, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        const body = (await page.locator('body').textContent()) ?? '';
        const status = resp?.status() ?? 0;
        const isNotFound = /This page could not be found/i.test(body) || status === 404;
        const isDenied = /Access denied/i.test(body) || status === 403;
        const crashed = /Application error|Unhandled|stack trace|Internal Server Error/i.test(body) || status >= 500;
        // The cross-tenant probe must additionally NOT reveal the foreign deal.
        const leaked = p.key === 'probe-crosstenant' && /Global Textiles/i.test(body);
        const safe = (isNotFound || isDenied) && !crashed && !leaked;
        if (!safe) allSafe = false;
        results.push(`${p.label}: http=${status} ${isNotFound ? '404-rendered' : isDenied ? '403-rendered' : 'NEITHER'}${crashed ? '/CRASHED' : ''}${leaked ? '/LEAKED-FOREIGN-OBJECT' : ''}`);
      }
      await ctx.close();

      await prisma.notification.deleteMany({ where: { dedupe_key: { in: probes.map((p) => p.key) } } });
      await prisma.deal.delete({ where: { id: foreignDeal.id } }).catch(() => undefined);

      record(
        'EXP17-AC01b',
        'AC01: a deep link to an inaccessible target fails safe — the link is not an authorization grant',
        allSafe && pageErrors.length === 0 ? 'PASS' : 'FAIL',
        `${results.join(' | ')}; uncaught client errors=${pageErrors.length}${pageErrors.length ? ` (${pageErrors[0]})` : ''}`,
      );
    });

    await scenario('EXP17-AC03', 'AC03: org member role is enforced server-side', async () => {
      const { ctx: memberCtx, page: memberPage } = await loggedInContext(browser, MEMBER);
      const inviteAsMember = await fetchJson(memberPage, '/api/v1/invitations', {
        method: 'POST',
        body: { email: 'someone-else@sunriseagro.example', role: 'exporter_member' },
      });
      const removeAsMember = await fetchJson(memberPage, '/api/v1/exporter-org/members/seed-user-owner', { method: 'PATCH', body: {} });
      await memberCtx.close();

      const { ctx: ownerCtx, page: ownerPage } = await loggedInContext(browser, OWNER);
      const inviteAsOwner = await fetchJson(ownerPage, '/api/v1/invitations', {
        method: 'POST',
        body: { email: 'verify-exp17-ac03@sunriseagro.example', role: 'exporter_member' },
      });
      await ownerCtx.close();

      const invitesFromMember = await prisma.invitation.count({ where: { email: 'someone-else@sunriseagro.example' } });
      if (inviteAsOwner.status === 201) {
        const created = (inviteAsOwner.body as { data?: { id: string } } | null)?.data;
        if (created) await prisma.invitation.delete({ where: { id: created.id } }).catch(() => undefined);
      }

      record(
        'EXP17-AC03',
        'AC03: org member role is enforced server-side',
        inviteAsMember.status === 403 && removeAsMember.status === 403 && invitesFromMember === 0 && inviteAsOwner.status === 201
          ? 'PASS'
          : 'FAIL',
        `member invite attempt=${inviteAsMember.status} (expect 403), member remove attempt=${removeAsMember.status} (expect 403), invite rows created by member=${invitesFromMember} (expect 0), owner invite=${inviteAsOwner.status} (expect 201)`,
      );
    });

    await scenario('EXP17-PREFS', 'A non-disableable category is refused even via a direct API call', async () => {
      const { ctx, page } = await loggedInContext(browser, OWNER);
      const attempt = await fetchJson(page, '/api/v1/notification-preferences', {
        method: 'PATCH',
        body: { category: 'account_security', channel: 'email', enabled: false },
      });
      await ctx.close();
      const row = await prisma.notificationPreference.findUnique({
        where: { user_id_category: { user_id: 'seed-user-owner', category: 'account_security' } },
      });
      record(
        'EXP17-PREFS',
        'A non-disableable category is refused even via a direct API call',
        attempt.status === 403 && row === null ? 'PASS' : 'FAIL',
        `PATCH account_security=${attempt.status} (expect 403), no preference row was written=${row === null}`,
      );
    });

    await scenario('EXP17-INVITE-DEDUP', 'Duplicate pending invite to the same email links the existing one', async () => {
      const { ctx, page } = await loggedInContext(browser, OWNER);
      const first = await fetchJson(page, '/api/v1/invitations', { method: 'POST', body: { email: 'dedup-check@sunriseagro.example', role: 'exporter_member' } });
      const second = await fetchJson(page, '/api/v1/invitations', { method: 'POST', body: { email: 'dedup-check@sunriseagro.example', role: 'exporter_member' } });
      await ctx.close();
      const count = await prisma.invitation.count({ where: { email: 'dedup-check@sunriseagro.example' } });
      await prisma.invitation.deleteMany({ where: { email: 'dedup-check@sunriseagro.example' } });
      const firstId = (first.body as { data?: { id: string } } | null)?.data?.id;
      const secondId = (second.body as { data?: { id: string } } | null)?.data?.id;
      record(
        'EXP17-INVITE-DEDUP',
        'Duplicate pending invite to the same email links the existing one',
        firstId && firstId === secondId && count === 1 ? 'PASS' : 'FAIL',
        `first=${first.status} id=${firstId}, second=${second.status} id=${secondId} (same=${firstId === secondId}), invitation rows for this email=${count}`,
      );
    });

    // =====================================================================
    // EXP-03 Enablement Center
    // =====================================================================
    await scenario('EXP03-AC01', 'AC01: required vs recommended distinction is visible', async () => {
      await prisma.task.update({ where: { id: 'seed-task-readiness-gst' }, data: { state: 'in_progress', completed_at: null } });
      await prisma.task.update({ where: { id: 'seed-task-readiness-packaging-qc' }, data: { state: 'not_started', completed_at: null } });
      const { ctx, page } = await loggedInContext(browser, OWNER);
      await page.goto(`${BASE}/app/readiness/tasks`, { waitUntil: 'networkidle' });
      await sleep(500);
      const body = (await page.locator('body').textContent()) ?? '';
      await ctx.close();
      const hasRequired = /Required before outreach/.test(body) && /Verify your GSTIN/.test(body);
      const hasRecommended = /Recommended/.test(body) && /Confirm packaging and QC process/.test(body);
      record(
        'EXP03-AC01',
        'AC01: required vs recommended distinction is visible',
        hasRequired && hasRecommended ? 'PASS' : 'FAIL',
        `"Required before outreach" section with a required task=${hasRequired}, "Recommended" section with a recommended task=${hasRecommended}`,
      );
    });

    await scenario('EXP03-AC02', 'AC02: every readiness task has one accountable owner', async () => {
      const tasks = await prisma.task.findMany({ where: { exporter_org_id: ORG_ID, task_type: { startsWith: 'readiness_' } } });
      const ownerless = tasks.filter((t) => !t.owner_user_id || !t.owner_role);
      record(
        'EXP03-AC02',
        'AC02: every readiness task has one accountable owner',
        tasks.length > 0 && ownerless.length === 0 ? 'PASS' : 'FAIL',
        `readiness tasks=${tasks.length}, missing owner_user_id or owner_role=${ownerless.length}`,
      );
    });

    await scenario('EXP03-AC03', 'AC03: evidence review outcome is auditable and linked to the task', async () => {
      // Upload real evidence through the real route, then have the agent approve it.
      await prisma.taskEvidence.deleteMany({ where: { task_id: 'seed-task-readiness-gst' } });
      await prisma.task.update({ where: { id: 'seed-task-readiness-gst' }, data: { state: 'in_progress', completed_at: null } });
      const { ctx: expCtx, page: expPage } = await loggedInContext(browser, OWNER);
      const upload = await expPage.evaluate(async () => {
        const form = new FormData();
        form.append('file', new Blob(['fake certificate bytes'], { type: 'application/pdf' }), 'gstin-v2.pdf');
        const r = await fetch('/api/v1/tasks/seed-task-readiness-gst/evidence', { method: 'POST', body: form });
        const b = await r.json().catch(() => null);
        return { status: r.status, id: b?.data?.id as string | undefined };
      });
      await expCtx.close();

      const { ctx: agentCtx, page: agentPage } = await loggedInContext(browser, AGENT);
      const approve = await fetchJson(agentPage, `/api/v1/tasks/seed-task-readiness-gst/evidence/${upload.id}`, {
        method: 'PATCH',
        body: { action: 'approve' },
      });
      await agentCtx.close();

      const task = await prisma.task.findUniqueOrThrow({ where: { id: 'seed-task-readiness-gst' } });
      const auditRow = upload.id ? await prisma.auditEvent.findFirst({ where: { object_type: 'task_evidence', object_id: upload.id, action: 'approve' } }) : null;

      record(
        'EXP03-AC03',
        'AC03: evidence review outcome is auditable and linked to the task',
        upload.status === 201 && approve.status === 200 && task.state === 'done' && Boolean(auditRow) ? 'PASS' : 'FAIL',
        `upload=${upload.status}, agent approve=${approve.status}, task flipped to done=${task.state === 'done'}, audit event linking the outcome to the task exists=${Boolean(auditRow)}`,
      );

      // Reset for the next scenario / a re-run.
      await prisma.task.update({ where: { id: 'seed-task-readiness-gst' }, data: { state: 'in_progress', completed_at: null } });
      if (upload.id) await prisma.taskEvidence.delete({ where: { id: upload.id } }).catch(() => undefined);
    });

    await scenario('EXP03-AC03b', 'Server rejects protected tasks — evidence-required task cannot be self-completed or force-completed', async () => {
      const { ctx, page } = await loggedInContext(browser, OWNER);
      const selfComplete = await fetchJson(page, '/api/v1/tasks/seed-task-readiness-gst/self-complete', { method: 'POST', body: {} });
      const directDone = await fetchJson(page, '/api/v1/tasks/seed-task-readiness-gst', { method: 'PATCH', body: { to: 'done' } });
      await ctx.close();
      const task = await prisma.task.findUniqueOrThrow({ where: { id: 'seed-task-readiness-gst' } });
      record(
        'EXP03-AC03b',
        'Server rejects protected tasks — evidence-required task cannot be self-completed or force-completed',
        selfComplete.status === 403 && directDone.status === 422 && task.state !== 'done' ? 'PASS' : 'FAIL',
        `self-complete on evidence-required task=${selfComplete.status} (expect 403), direct PATCH to done (no approved evidence)=${directDone.status} (expect 422), task state unchanged=${task.state !== 'done'} (still "${task.state}")`,
      );
    });

    await scenario('EXP03-AC04', 'AC04: self-completing a task is immediately reflected — no separate recompute step', async () => {
      const { ctx, page } = await loggedInContext(browser, OWNER);
      const before = await fetchJson(page, '/api/v1/tasks?state=not_started');
      const complete = await fetchJson(page, '/api/v1/tasks/seed-task-readiness-packaging-qc/self-complete', { method: 'POST', body: {} });
      // Read back in the SAME request cycle style — no job, no polling, no delay.
      const task = await prisma.task.findUniqueOrThrow({ where: { id: 'seed-task-readiness-packaging-qc' } });
      await ctx.close();
      record(
        'EXP03-AC04',
        'AC04: self-completing a task is immediately reflected — no separate recompute step',
        complete.status === 200 && task.state === 'done' && Boolean(task.completed_at) ? 'PASS' : 'FAIL',
        `self-complete=${complete.status}, task state immediately after=${task.state}, completed_at set=${Boolean(task.completed_at)} (before-count endpoint reachable=${before.status === 200})`,
      );
      await prisma.task.update({ where: { id: 'seed-task-readiness-packaging-qc' }, data: { state: 'not_started', completed_at: null } });
    });

    // =====================================================================
    // EXP-07 Buyer Detail
    // =====================================================================
    await scenario('EXP07-AC01', 'AC01: global buyer facts and exporter-specific pipeline state are visually distinct', async () => {
      const { ctx, page } = await loggedInContext(browser, OWNER);
      await page.goto(`${BASE}/app/buyers/seed-buyer-1`, { waitUntil: 'networkidle' });
      await sleep(400);
      const body = (await page.locator('body').textContent()) ?? '';
      // Structural: two separately-headed sections, not one merged block.
      const globalFactsHeaded = /Spice Trading Co\./.test(body) && /Risk/.test(body) && /Fit/.test(body);
      const relationshipHeaded = /Your relationship with this buyer/.test(body) && /Converted to a deal/.test(body);
      await ctx.close();
      record(
        'EXP07-AC01',
        'AC01: global buyer facts and exporter-specific pipeline state are visually distinct',
        globalFactsHeaded && relationshipHeaded ? 'PASS' : 'FAIL',
        `global facts section (name/risk/fit) present=${globalFactsHeaded}, separately-headed relationship section present=${relationshipHeaded}`,
      );
    });

    await scenario('EXP07-AC02', 'AC02: duplicate BuyerLead is prevented server-side', async () => {
      const { ctx, page } = await loggedInContext(browser, AGENT);
      const body = { exporter_org_id: ORG_ID, buyer_id: 'seed-buyer-4', product_id: 'seed-product-turmeric' };
      const first = await fetchJson(page, '/api/v1/buyer-leads', { method: 'POST', body });
      const second = await fetchJson(page, '/api/v1/buyer-leads', { method: 'POST', body });
      await ctx.close();
      const count = await prisma.buyerLead.count({ where: { exporter_org_id: ORG_ID, buyer_id: 'seed-buyer-4', product_id: 'seed-product-turmeric' } });
      record(
        'EXP07-AC02',
        'AC02: duplicate BuyerLead is prevented server-side',
        first.status === 201 && second.status === 409 && count === 1 ? 'PASS' : 'FAIL',
        `assigned-agent first create=${first.status} (expect 201), second duplicate=${second.status} (expect 409 DUPLICATE_LEAD), rows for this (org,buyer,product)=${count} (expect 1)`,
      );
      await prisma.buyerLead.deleteMany({ where: { exporter_org_id: ORG_ID, buyer_id: 'seed-buyer-4', product_id: 'seed-product-turmeric' } });
    });

    await scenario('EXP07-AC03', 'AC03: risk is never behind an optional tab — present in the server-rendered HTML, no JS required', async () => {
      // Fetch the raw HTML directly — no JS execution at all — so this proves the risk
      // text is server-rendered, not revealed by a client-side tab/accordion open.
      const { ctx, page } = await loggedInContext(browser, OWNER);
      const cookies = await page.context().cookies();
      await ctx.close();
      const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
      const res = await fetch(`${BASE}/app/buyers/seed-buyer-5`, { headers: { Cookie: cookieHeader } });
      const html = await res.text();
      const riskTextPresent = html.includes('A prior exporter reported a payment dispute');
      // No tab/accordion/details wrapper around the risk section.
      const noHiddenWrapper = !/<details[^>]*>[\s\S]{0,400}Risk/i.test(html);
      record(
        'EXP07-AC03',
        'AC03: risk is never behind an optional tab — present in the server-rendered HTML, no JS required',
        res.status === 200 && riskTextPresent && noHiddenWrapper ? 'PASS' : 'FAIL',
        `raw HTML fetch (no JS)=${res.status}, risk summary text present in the initial HTML=${riskTextPresent}, no <details>/accordion wrapper around Risk=${noHiddenWrapper}`,
      );
    });

    await scenario('EXP07-GUEST', 'Guest: contacts absent from the PAYLOAD, not merely un-rendered', async () => {
      // A DOM-text check is not sufficient evidence here: CSS can hide text the server
      // still shipped. This asserts absence in what the server actually SENT, on both
      // paths a guest can reach buyer contact data:
      //   1. the JSON list endpoint (`/api/v1/buyers`), parsed and walked recursively
      //   2. the detail page's raw HTML *including* the RSC flight payload, which is
      //      where a server component's props land — a component can decline to render
      //      a field and still have serialized it into the stream.
      const contact = await prisma.buyerContact.findFirstOrThrow({ where: { buyer_id: 'seed-buyer-3' } });
      const needles = [contact.name, contact.email ?? '', contact.phone ?? '', contact.provenance ?? ''].filter(
        (s) => s.length > 0,
      );

      const guestCtx = await browser.newContext();
      const gp = await guestCtx.newPage();

      // (1) The detail page under test. EXP-07 is a server component with no JSON
      // endpoint of its own, so ITS payload is the response body: the HTML plus the
      // embedded RSC flight stream, which is where a server component's props are
      // serialized. A component can decline to RENDER a field and still have shipped it
      // in that stream — scanning `page.content()` (full document, script tags included)
      // is what distinguishes "withheld" from "hidden with CSS".
      const resp = await gp.goto(`${BASE}/app/buyers/seed-buyer-3`, { waitUntil: 'networkidle' });
      const rawHtml = await gp.content();
      const domText = (await gp.locator('body').textContent()) ?? '';

      // (2) The JSON list endpoint that governs the same tier projection. An anonymous
      // visitor has no principal at all, so the correct outcome is 401 — no payload to
      // leak from. Now that the page above has been navigated, a relative fetch has a
      // base URL to resolve against.
      const listRes = await fetchJson(gp, '/api/v1/buyers?per_page=20');
      const hitsInJson: string[] = [];
      const walk = (node: unknown, path: string) => {
        if (typeof node === 'string') {
          for (const n of needles) if (node.includes(n)) hitsInJson.push(`${path} contains "${n}"`);
          return;
        }
        if (node && typeof node === 'object') {
          if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${path}[${i}]`));
          else
            for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
              if (k === 'contacts') hitsInJson.push(`${path}.contacts key present in a guest-tier payload`);
              walk(v, `${path}.${k}`);
            }
        }
      };
      walk(listRes.body, '$');
      await guestCtx.close();

      const hitsInPayload = needles.filter((n) => rawHtml.includes(n));
      const buyerFactsShown = /Gulf Foods General Trading/.test(domText);
      const contactsLockedMessage = /Verified contacts need a free account/.test(domText);
      const jsonGaveNothing = listRes.status === 401 || hitsInJson.length === 0;

      record(
        'EXP07-GUEST',
        'Guest: contacts absent from the PAYLOAD, not merely un-rendered',
        resp?.status() === 200 && hitsInPayload.length === 0 && jsonGaveNothing && buyerFactsShown && contactsLockedMessage
          ? 'PASS'
          : 'FAIL',
        `probed ${needles.length} PII values (${needles.map((n) => n.slice(0, 20)).join(' / ')}) against the FULL response body (HTML + RSC flight, ${rawHtml.length} bytes), not the DOM: detail page=${resp?.status()}, payload leaks=[${hitsInPayload.join(', ') || 'none'}]; /api/v1/buyers as anonymous=${listRes.status}, JSON leaks=[${hitsInJson.join(' | ') || 'none'}]; buyer facts still visible=${buyerFactsShown}, locked-contacts notice shown=${contactsLockedMessage}`,
      );
    });
  } finally {
    await browser.close();
    await resetFixtures();
  }

  summarize('EXP-17 / EXP-03 / EXP-07 ACCEPTANCE');
}

main()
  .catch((e) => {
    if (e instanceof PreflightError) console.error(`\n✗ PREFLIGHT FAILED\n\n  ${e.message}\n`);
    else console.error('SUITE CRASHED:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
