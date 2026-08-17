/**
 * Verification for OPS-04 (CHA, Compliance & Document Oversight) and OPS-07 (Audit Log
 * & Admin Configuration).
 *
 * Run with the dev server up (and DB seeded):
 *   npx tsx --env-file=.env scripts/verify-ops-execution-audit.ts
 */

import { FilingStatus, GenerationStatus } from '@prisma/client';
import {
  launch,
  loggedInContext,
  preflight,
  PreflightError,
  record,
  scenario,
  summarize,
  type Browser,
  type Page,
} from './verify-harness';
import { prisma } from '../src/lib/prisma';

const DEAL = 'seed-deal-locked';
const AGENT = 'agent@cleartrade.example';
const OPS = 'ops@cleartrade.example';
const OPS_FINANCE = 'finance@cleartrade.example';
const ADMIN = 'admin@cleartrade.example';

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

let cleanupDocumentIds: string[] = [];

/**
 * `@@unique([deal_id, doc_type, version])` — seed-deal-locked already has a v1 row for
 * every checklist doc_type from its own lock-time creation, so a fixed `version: 1`
 * probe collides. Always probe at the next free version for this (deal, doc_type).
 */
async function nextVersion(dealId: string, docType: string): Promise<number> {
  const existing = await prisma.document.findFirst({ where: { deal_id: dealId, doc_type: docType as never }, orderBy: { version: 'desc' } });
  return (existing?.version ?? 0) + 1;
}

async function resetFixtures() {
  if (cleanupDocumentIds.length) {
    await prisma.auditEvent.deleteMany({ where: { object_type: 'document', object_id: { in: cleanupDocumentIds } } });
    await prisma.document.deleteMany({ where: { id: { in: cleanupDocumentIds } } });
    cleanupDocumentIds = [];
  }
}

async function main() {
  await preflight();
  const browser: Browser = await launch();

  try {
    // -----------------------------------------------------------------
    // OPS-04-AC01: filing to filed/accepted requires a reference.
    // -----------------------------------------------------------------
    await scenario('OPS-04-AC01', 'AC01: external filing status carries evidence/reference where policy requires', async () => {
      const docType = 'other';
      const doc = await prisma.document.create({
        data: {
          deal_id: DEAL,
          doc_type: docType,
          version: await nextVersion(DEAL, docType),
          source: 'generated',
          generation_status: GenerationStatus.generated,
          filing_status: FilingStatus.ready,
        },
      });
      cleanupDocumentIds.push(doc.id);

      const { ctx, page } = await loggedInContext(browser, OPS);
      const withoutRef = await fetchJson(page, `/api/v1/deals/${DEAL}/documents/${doc.id}/file`, {
        method: 'POST',
        body: { action: 'mark_filed', filing_status: 'filed' },
      });
      const withRef = await fetchJson(page, `/api/v1/deals/${DEAL}/documents/${doc.id}/file`, {
        method: 'POST',
        body: { action: 'mark_filed', filing_status: 'filed', filing_reference: 'SB-VERIFY-001' },
      });
      await ctx.close();

      const row = await prisma.document.findUniqueOrThrow({ where: { id: doc.id } });

      record(
        'OPS-04-AC01',
        'AC01: external filing status carries evidence/reference where policy requires',
        withoutRef.status === 422 && withRef.status === 200 && row.filing_reference === 'SB-VERIFY-001' ? 'PASS' : 'FAIL',
        `filed without reference -> ${withoutRef.status} (expect 422); filed with reference -> ${withRef.status} (expect 200); stored reference=${row.filing_reference}`,
      );
    });

    // -----------------------------------------------------------------
    // OPS-04-AC02: rejected submissions preserve previous attempt history —
    // both the filing-attempt trail (AuditEvent) and the content-version trail
    // (Document.version / is_current_version) survive a reject-and-refile cycle.
    // -----------------------------------------------------------------
    await scenario('OPS-04-AC02', 'AC02: rejected submissions preserve previous attempt history', async () => {
      const docType = 'other';
      const doc = await prisma.document.create({
        data: {
          deal_id: DEAL,
          doc_type: docType,
          version: await nextVersion(DEAL, docType),
          source: 'generated',
          generation_status: GenerationStatus.generated,
          filing_status: FilingStatus.ready,
        },
      });
      cleanupDocumentIds.push(doc.id);

      const { ctx, page } = await loggedInContext(browser, OPS);
      const first = await fetchJson(page, `/api/v1/deals/${DEAL}/documents/${doc.id}/file`, {
        method: 'POST',
        body: { action: 'mark_filed', filing_status: 'filed', filing_reference: 'ATTEMPT-1-REF' },
      });
      const rejected = await fetchJson(page, `/api/v1/deals/${DEAL}/documents/${doc.id}/file`, {
        method: 'POST',
        body: { action: 'mark_filed', filing_status: 'rejected', note: 'Authority rejected attempt 1.' },
      });
      const backToReady = await fetchJson(page, `/api/v1/deals/${DEAL}/documents/${doc.id}/file`, {
        method: 'POST',
        body: { action: 'mark_filed', filing_status: 'ready' },
      });
      const second = await fetchJson(page, `/api/v1/deals/${DEAL}/documents/${doc.id}/file`, {
        method: 'POST',
        body: { action: 'mark_filed', filing_status: 'filed', filing_reference: 'ATTEMPT-2-REF' },
      });
      await ctx.close();

      const events = await prisma.auditEvent.findMany({
        where: { object_type: 'document', object_id: doc.id, action: 'file' },
        orderBy: { timestamp: 'asc' },
      });
      const serialized = JSON.stringify(events.map((e) => e.after_summary));
      const attempt1Preserved = serialized.includes('ATTEMPT-1-REF');
      const attempt2Present = serialized.includes('ATTEMPT-2-REF');
      const rejectionPreserved = serialized.includes('rejected');

      record(
        'OPS-04-AC02',
        'AC02: rejected submissions preserve previous attempt history',
        first.status === 200 && rejected.status === 200 && backToReady.status === 200 && second.status === 200 &&
          events.length >= 4 && attempt1Preserved && attempt2Present && rejectionPreserved
          ? 'PASS'
          : 'FAIL',
        `filed(1)=${first.status}, rejected=${rejected.status}, back-to-ready=${backToReady.status}, filed(2)=${second.status}; audit trail has ${events.length} 'file' events; attempt 1 reference still present=${attempt1Preserved}; rejection reason still present=${rejectionPreserved}; attempt 2 reference present=${attempt2Present} — nothing overwritten in place`,
      );
    });

    // -----------------------------------------------------------------
    // OPS-04-AC03: requirement override is restricted (ops_supervisor/admin
    // only, never agent or ops_finance) and audited.
    // -----------------------------------------------------------------
    await scenario('OPS-04-AC03', 'AC03: requirement override is restricted and audited', async () => {
      const docType = 'other';
      const doc = await prisma.document.create({
        data: {
          deal_id: DEAL,
          doc_type: docType,
          version: await nextVersion(DEAL, docType),
          source: 'generated',
          generation_status: GenerationStatus.generated,
          filing_status: FilingStatus.rejected,
          rejection_reason: 'Authority rejected — verify probe.',
        },
      });
      cleanupDocumentIds.push(doc.id);

      const { ctx: agentCtx, page: agentPage } = await loggedInContext(browser, AGENT);
      const agentAttempt = await fetchJson(agentPage, `/api/v1/deals/${DEAL}/documents/${doc.id}/override`, {
        method: 'POST',
        body: { reason: 'Agent should not be able to do this.', confirm: true },
      });
      await agentCtx.close();

      const { ctx: financeCtx, page: financePage } = await loggedInContext(browser, OPS_FINANCE);
      const financeAttempt = await fetchJson(financePage, `/api/v1/deals/${DEAL}/documents/${doc.id}/override`, {
        method: 'POST',
        body: { reason: 'Ops finance should not be able to do this.', confirm: true },
      });
      await financeCtx.close();

      const { ctx: opsCtx, page: opsPage } = await loggedInContext(browser, OPS);
      const missingReason = await fetchJson(opsPage, `/api/v1/deals/${DEAL}/documents/${doc.id}/override`, { method: 'POST', body: { confirm: true } });
      const allowed = await fetchJson(opsPage, `/api/v1/deals/${DEAL}/documents/${doc.id}/override`, {
        method: 'POST',
        body: { reason: 'Customs cleared informally per phone confirmation with the authority on 2026-08-11.', confirm: true },
      });
      await opsCtx.close();

      const row = await prisma.document.findUniqueOrThrow({ where: { id: doc.id } });
      const overrideAudit = await prisma.auditEvent.findFirst({ where: { object_type: 'document', object_id: doc.id, action: 'override' } });

      const pass =
        agentAttempt.status === 403 &&
        financeAttempt.status === 403 &&
        missingReason.status === 422 &&
        allowed.status === 200 &&
        row.filing_status === FilingStatus.not_applicable &&
        Boolean(overrideAudit);

      record(
        'OPS-04-AC03',
        'AC03: requirement override is restricted and audited',
        pass ? 'PASS' : 'FAIL',
        `agent attempt=${agentAttempt.status} (expect 403); ops_finance attempt=${financeAttempt.status} (expect 403); ops_supervisor without reason=${missingReason.status} (expect 422); ops_supervisor with reason=${allowed.status} (expect 200); filing_status after=${row.filing_status}; dedicated 'override' audit event written=${Boolean(overrideAudit)}`,
      );
    });

    // -----------------------------------------------------------------
    // OPS-07-AC01: the audit log cannot be edited through the UI — direct API
    // mutation attempts against the audit route are refused (no handler exists).
    // -----------------------------------------------------------------
    await scenario('OPS-07-AC01', 'AC01: the audit log cannot be edited through the UI', async () => {
      const someEvent = await prisma.auditEvent.findFirstOrThrow();

      const { ctx, page } = await loggedInContext(browser, ADMIN);
      const patchAttempt = await fetchJson(page, '/api/v1/audit', { method: 'PATCH', body: { id: someEvent.id, action: 'tampered' } });
      const putAttempt = await fetchJson(page, `/api/v1/audit/${someEvent.id}`, { method: 'PUT', body: { action: 'tampered' } });
      const deleteAttempt = await fetchJson(page, `/api/v1/audit/${someEvent.id}`, { method: 'DELETE' });
      await ctx.close();

      const reloaded = await prisma.auditEvent.findUniqueOrThrow({ where: { id: someEvent.id } });

      const pass =
        [404, 405].includes(patchAttempt.status) &&
        [404, 405].includes(putAttempt.status) &&
        [404, 405].includes(deleteAttempt.status) &&
        reloaded.action === someEvent.action;

      record(
        'OPS-07-AC01',
        'AC01: the audit log cannot be edited through the UI',
        pass ? 'PASS' : 'FAIL',
        `PATCH /api/v1/audit -> ${patchAttempt.status}, PUT .../:id -> ${putAttempt.status}, DELETE .../:id -> ${deleteAttempt.status} (all expect 404/405 — no such route exists); row unchanged=${reloaded.action === someEvent.action}`,
      );
    });

    // -----------------------------------------------------------------
    // OPS-07-AC02: config changes are versioned and audited; Admin-only.
    // -----------------------------------------------------------------
    await scenario('OPS-07-AC02', 'AC02: config changes are versioned and audited', async () => {
      // A real, shared config key — restored to its original active version at the end
      // of this scenario rather than deleted, since other suites may read it.
      const testKey = 'leads.outreach';

      const before = await prisma.configSetting.findFirst({ where: { key: testKey, is_active: true }, orderBy: { version: 'desc' } });
      const beforeVersion = before?.version ?? 0;

      const { ctx: agentCtx, page: agentPage } = await loggedInContext(browser, AGENT);
      const agentAttempt = await fetchJson(agentPage, '/api/v1/config', { method: 'POST', body: { key: testKey, value: { stale_after_days: 999, follow_up_due_in_hours: 1 } } });
      await agentCtx.close();

      const { ctx: opsCtx, page: opsPage } = await loggedInContext(browser, OPS);
      const opsAttempt = await fetchJson(opsPage, '/api/v1/config', { method: 'POST', body: { key: testKey, value: { stale_after_days: 999, follow_up_due_in_hours: 1 } } });
      await opsCtx.close();

      const { ctx: adminCtx, page: adminPage } = await loggedInContext(browser, ADMIN);
      const adminAttempt = await fetchJson(adminPage, '/api/v1/config', {
        method: 'POST',
        body: { key: testKey, value: { stale_after_days: 999, follow_up_due_in_hours: 1 } },
      });
      await adminCtx.close();

      const after = await prisma.configSetting.findFirst({ where: { key: testKey, is_active: true }, orderBy: { version: 'desc' } });
      const previousStillExists = before ? Boolean(await prisma.configSetting.findFirst({ where: { key: testKey, version: before.version } })) : true;
      const auditRow = await prisma.auditEvent.findFirst({
        where: { object_type: 'config_setting', action: 'config_change', object_id: after?.id },
        orderBy: { timestamp: 'desc' },
      });

      // Restore the prior active version and DELETE the probe row rather than just
      // deactivating it — `version` increments from "current active + 1", so a
      // deactivated-but-retained probe row would collide with the next run's insert
      // the moment the restored version becomes active again (a real reproducibility
      // bug this script hit on its second run: version 1 -> 2 succeeded, restore left
      // v2 sitting deactivated, and the NEXT run tried to insert v2 again and got a
      // unique-constraint error). A real admin's config version is never deleted this
      // way — only test-probe rows are.
      if (after && before) {
        await prisma.configSetting.update({ where: { id: before.id }, data: { is_active: true } });
        await prisma.configSetting.delete({ where: { id: after.id } });
      }

      const pass =
        agentAttempt.status === 403 &&
        opsAttempt.status === 403 &&
        adminAttempt.status === 201 &&
        (after?.version ?? 0) === beforeVersion + 1 &&
        previousStillExists &&
        Boolean(auditRow);

      record(
        'OPS-07-AC02',
        'AC02: config changes are versioned and audited',
        pass ? 'PASS' : 'FAIL',
        `agent attempt=${agentAttempt.status} (expect 403); ops_supervisor attempt=${opsAttempt.status} (expect 403); admin attempt=${adminAttempt.status} (expect 201); version ${beforeVersion} -> ${after?.version} (expect +1); prior version row still exists=${previousStillExists}; audit 'config_change' event written=${Boolean(auditRow)}`,
      );
    });

    // -----------------------------------------------------------------
    // OPS-07-AC03: historical deals retain their original policy version
    // reference even after a newer FeePolicy version is created.
    // -----------------------------------------------------------------
    await scenario('OPS-07-AC03', 'AC03: historical deals retain original policy/template version references', async () => {
      const dealBefore = await prisma.deal.findUniqueOrThrow({ where: { id: DEAL }, select: { quoted_fee_policy: true, locked_at: true } });
      const snapshotBefore = dealBefore.quoted_fee_policy as { version?: number } | null;

      const activePolicy = await prisma.feePolicy.findFirstOrThrow({ where: { is_active: true }, orderBy: { version: 'desc' } });

      const { ctx, page } = await loggedInContext(browser, ADMIN);
      const res = await fetchJson(page, '/api/v1/fee-policy', {
        method: 'POST',
        body: {
          commitment_fee_amount: Number(activePolicy.commitment_fee_amount),
          commitment_fee_currency: activePolicy.commitment_fee_currency,
          success_fee_rate: Number(activePolicy.success_fee_rate),
          small_shipment_threshold_amount: Number(activePolicy.small_shipment_threshold_amount),
          small_shipment_threshold_currency: activePolicy.small_shipment_threshold_currency,
          small_shipment_rate: Number(activePolicy.small_shipment_rate),
          small_shipment_flat_amount: Number(activePolicy.small_shipment_flat_amount),
          agent_share_rate: Number(activePolicy.agent_share_rate),
          minimum_shipment_amount: Number(activePolicy.minimum_shipment_amount),
          minimum_shipment_currency: activePolicy.minimum_shipment_currency,
        },
      });
      await ctx.close();

      const dealAfter = await prisma.deal.findUniqueOrThrow({ where: { id: DEAL }, select: { quoted_fee_policy: true } });
      const snapshotAfter = dealAfter.quoted_fee_policy as { version?: number } | null;
      const newActivePolicy = await prisma.feePolicy.findFirstOrThrow({ where: { is_active: true }, orderBy: { version: 'desc' } });

      // Clean up: restore the original and DELETE the probe version (`version` is
      // globally unique on this model, so leaving a deactivated probe row behind
      // collides with the next run's insert once the restored version is active again).
      await prisma.feePolicy.update({ where: { id: activePolicy.id }, data: { is_active: true } });
      await prisma.feePolicy.delete({ where: { id: newActivePolicy.id } });

      const pass =
        res.status === 201 &&
        newActivePolicy.version === activePolicy.version + 1 &&
        snapshotBefore?.version === snapshotAfter?.version &&
        snapshotAfter?.version !== newActivePolicy.version;

      record(
        'OPS-07-AC03',
        'AC03: historical deals retain original policy/template version references',
        pass ? 'PASS' : 'FAIL',
        `new active FeePolicy version created=${newActivePolicy.version} (was ${activePolicy.version}); locked deal's quoted_fee_policy.version before=${snapshotBefore?.version}, after=${snapshotAfter?.version} (must be unchanged and must NOT equal the new live version ${newActivePolicy.version})`,
      );
    });
  } finally {
    await resetFixtures();
    await browser.close();
  }

  summarize('OPS-04 / OPS-07 ACCEPTANCE');
}

main()
  .catch((e) => {
    if (e instanceof PreflightError) console.error(`\n✗ PREFLIGHT FAILED\n\n  ${e.message}\n`);
    else console.error('SUITE CRASHED:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
