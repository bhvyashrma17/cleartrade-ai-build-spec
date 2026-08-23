/**
 * EXP-03 Enablement Center.
 *
 * AC01 "required vs recommended visible": two groups, `Required before outreach` and
 * `Recommended`, driven by `isRequiredReadinessTask()` — the SAME `priority` field
 * `src/lib/job-handlers/readiness.ts` already writes, so this page's grouping can never
 * drift from what actually gated the readiness score. There is no "required before
 * shipment" group rendered even though docs/04 names one: nothing the current
 * assessment produces is required-before-shipment (packaging/samples are
 * `recommended`), and rendering an always-empty group would be exactly the fake content
 * AGENTS.md rules out — the group appears the moment a finding actually needs it.
 *
 * AC02 "one accountable owner per task" is already true of `Task.owner_user_id` /
 * `owner_role`; this page just has to show it, not invent it.
 */

import { OrgTier } from '@prisma/client';
import { AskAgentButton } from '@/components/enablement/AskAgentButton';
import { enablementChip, TASK_STATE_DISPLAY } from '@/components/enablement/statusDisplay';
import { EvidenceUploadForm } from '@/components/enablement/EvidenceUploadForm';
import { SelfCompleteButton } from '@/components/enablement/SelfCompleteButton';
import { StatusChip, UpgradeNotice } from '@/components/ui';
import { getPrincipal } from '@/lib/auth';
import {
  isEvidenceRequiredReadinessTask,
  isRequiredReadinessTask,
  isSelfAttestableReadinessTask,
  whyItMatters,
} from '@/lib/enablement';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';

function fmt(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(d);
}

export default async function EnablementCenterPage() {
  const principal = await getPrincipal();
  if (!principal || principal.tier === OrgTier.guest) {
    return (
      <div className="mx-auto max-w-3xl py-4 md:py-6">
        <UpgradeNotice
          title="The Enablement Center needs a free account"
          requiredTier="free"
          description="Create a free account to run your readiness assessment and track the tasks that come out of it."
        />
      </div>
    );
  }
  assertCan(principal, 'readiness.run');
  const orgId = principal.exporter_org_id as string;

  const [assessment, tasks] = await Promise.all([
    prisma.readinessAssessment.findFirst({ where: { exporter_org_id: orgId, is_current: true }, orderBy: { updated_at: 'desc' } }),
    prisma.task.findMany({
      where: { exporter_org_id: orgId, task_type: { startsWith: 'readiness_' }, state: { not: 'cancelled' } },
      include: {
        owner: { select: { name: true } },
        evidence: { orderBy: { created_at: 'desc' }, take: 1 },
      },
      orderBy: [{ priority: 'desc' }, { due_at: 'asc' }],
    }),
  ]);

  const required = tasks.filter((t) => isRequiredReadinessTask(t.priority));
  const recommended = tasks.filter((t) => !isRequiredReadinessTask(t.priority));
  const noBlockers = required.filter((t) => t.state !== 'done').length === 0;

  function TaskRow({ task }: { task: (typeof tasks)[number] }) {
    const stateChip = enablementChip(TASK_STATE_DISPLAY, task.state);
    const latestEvidence = task.evidence[0]
      ? {
          id: task.evidence[0].id,
          file_name: task.evidence[0].file_name,
          review_status: task.evidence[0].review_status,
          review_note: task.evidence[0].review_note,
          uploaded_at: task.evidence[0].uploaded_at.toISOString(),
        }
      : null;
    const evidenceRequired = isEvidenceRequiredReadinessTask(task.task_type);
    const selfAttestable = isSelfAttestableReadinessTask(task.task_type);
    const done = task.state === 'done';

    return (
      <li className="rounded-md border border-[var(--color-border)] p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-normal text-primary">{task.title}</p>
            {task.description ? <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">{task.description}</p> : null}
          </div>
          <StatusChip {...stateChip} size="sm" />
        </div>

        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-text-secondary)]">
          <span>Owner: {task.owner?.name ?? 'You'}</span>
          {task.due_at ? <span>Due {fmt(task.due_at)}</span> : null}
          {task.blocked_reason ? <span className="text-[var(--color-critical-text)]">Waiting on you: {task.blocked_reason}</span> : null}
        </div>

        {whyItMatters(task.task_type) ? (
          <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
            <span className="font-medium text-primary">Why it matters: </span>
            {whyItMatters(task.task_type)}
          </p>
        ) : null}

        {!done ? (
          <div className="mt-2 space-y-2">
            {evidenceRequired ? <EvidenceUploadForm taskId={task.id} latestEvidence={latestEvidence} /> : null}
            {selfAttestable ? <SelfCompleteButton taskId={task.id} /> : null}
            <AskAgentButton taskId={task.id} />
          </div>
        ) : latestEvidence?.review_status === 'approved' ? (
          <p className="mt-2 text-xs text-[var(--color-text-secondary)]">Verified from {latestEvidence.file_name}.</p>
        ) : null}
      </li>
    );
  }

  return (
    <div className="space-y-4 py-4 md:py-6">
      <header>
        <h1 className="font-serif text-title-page text-primary">Enablement Center</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          One checklist for becoming export-ready — requirements ClearTrade can guide, evidence you
          upload, and items your agent owns.
        </p>
        {assessment?.score !== null && assessment?.score !== undefined ? (
          <p className="mt-2 text-sm text-primary">
            Readiness score: <span className="font-semibold">{assessment.score}</span>
          </p>
        ) : null}
      </header>

      {noBlockers ? (
        <section className="rounded-lg border border-[color-mix(in_srgb,var(--color-action)_25%,transparent)] bg-[color-mix(in_srgb,var(--color-action)_5%,transparent)] p-4">
          <p className="text-sm font-semibold text-primary">Readiness achieved</p>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Nothing is blocking you from buyer outreach. The items below are recommended improvements,
            not requirements.
          </p>
        </section>
      ) : null}

      {required.length > 0 ? (
        <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
          <h2 className="text-lg font-semibold text-primary">Required before outreach</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            These block your readiness score until resolved.
          </p>
          <ul className="mt-4 space-y-3">
            {required.map((task) => <TaskRow key={task.id} task={task} />)}
          </ul>
        </section>
      ) : null}

      {recommended.length > 0 ? (
        <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
          <h2 className="text-lg font-semibold text-primary">Recommended</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Not required, but strengthens your position with buyers.
          </p>
          <ul className="mt-4 space-y-3">
            {recommended.map((task) => <TaskRow key={task.id} task={task} />)}
          </ul>
        </section>
      ) : null}

      {tasks.length === 0 ? (
        <section className="rounded-lg border border-dashed border-[var(--color-border-strong)] bg-surface p-8 text-center">
          <p className="text-sm font-normal text-primary">No enablement tasks yet</p>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Complete your readiness assessment to generate a checklist.
          </p>
        </section>
      ) : null}

      <section className="rounded-lg border border-dashed border-[var(--color-border)] bg-surface-muted p-4">
        <h2 className="text-sm font-semibold text-primary">Help</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          ClearTrade assists with these steps and reviews what you upload — we do not file or
          register anything on your behalf. For regulated items like IEC, GST or AD code, the
          filing itself happens with the relevant authority or your bank; upload the evidence once
          you have it and your agent will confirm it.
        </p>
      </section>
    </div>
  );
}
