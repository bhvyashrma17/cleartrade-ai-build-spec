/**
 * `/agent/deals/:dealId/documents/:documentId` — review one version closely.
 *
 * This is where an agent decides whether a generated document is fit to put in front of the
 * exporter. It shows identity (version, snapshot hash, artifact checksums, renderer), what the
 * frozen input said, what has changed in canonical data since, what is blocking approval, and
 * the full version history.
 *
 * It does NOT offer approval. ClearTrade separates duties — `document.approve` is
 * `agent: 'none'` — so the agent's decision is "reviewed" or "changes needed", and approval
 * stays with the exporter. That split is stated on the page rather than left to be inferred
 * from a missing button.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StatusChip } from '@/components/ui';
import { documentDetail } from '@/lib/document-lifecycle';
import { prisma } from '@/lib/prisma';
import { requirePortalAccess } from '@/lib/auth';
import { canReadDeal } from '@/lib/permissions';
import { ReviewPanel } from './ReviewPanel';

const fmt = (d: Date | null) =>
  d ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(d) : '—';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-0.5 text-sm text-primary">{children}</dd>
    </div>
  );
}

export default async function AgentDocumentDetailPage({
  params,
}: {
  params: Promise<{ dealId: string; documentId: string }>;
}) {
  const { dealId, documentId } = await params;
  const principal = await requirePortalAccess('/agent');

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { id: true, exporter_org_id: true, owner_agent_id: true, stage: true },
  });
  if (!deal || !(await canReadDeal(principal, deal))) notFound();

  const detail = await documentDetail(principal, dealId, documentId);
  const d = detail.document;
  const approvable = detail.approvalBlockers.length === 0;

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <header className="mb-4">
        <p className="text-sm font-medium text-primary">
          <Link href={`/agent/deals/${dealId}/documents`} className="focus-visible-ring rounded underline underline-offset-2">
            Documents
          </Link>{' '}
          · {detail.exporter_name}
        </p>
        <h1 className="text-2xl font-semibold text-primary">
          {detail.label} <span className="text-[var(--color-text-secondary)]">v{d.version}</span>
        </h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <StatusChip label={d.is_current_version ? 'Current version' : 'Superseded'} tone={d.is_current_version ? 'info' : 'neutral'} icon="dot" size="sm" />
          <StatusChip label={`gen: ${d.generation_status}`} tone="neutral" icon="dot" size="sm" />
          <StatusChip label={`review: ${d.review_status}`} tone="neutral" icon="dot" size="sm" />
          <StatusChip label={`approval: ${d.approval_status}`} tone={d.approval_status === 'exporter_approved' ? 'positive' : 'neutral'} icon="dot" size="sm" />
        </div>
        {detail.authority ? (
          <p className="mt-2 max-w-3xl rounded border border-[var(--color-border)] bg-surface-muted px-3 py-2 text-xs text-[var(--color-text-secondary)]">
            <span className="font-medium text-primary">What approval means here:</span> {detail.authority.approvalMeans}{' '}
            <span className="font-medium">{detail.authority.notThis}</span>
          </p>
        ) : null}
      </header>

      <section className="mb-4 rounded-lg border border-[var(--color-border)] bg-surface p-4 shadow-card">
        <h2 className="mb-3 text-sm font-semibold text-primary">Identity</h2>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Version">v{d.version}{d.amended_from_version ? ` (amended from v${d.amended_from_version})` : ''}</Field>
          <Field label="Generated">{fmt(d.created_at)}</Field>
          <Field label="Snapshot hash">
            <span className="font-mono text-xs">{d.content_hash ?? '—'}</span>
          </Field>
          <Field label="Recorded checksum">
            <span className="font-mono text-xs">{d.checksum ?? '—'}</span>
          </Field>
          <Field label="Reviewed by">{d.reviewed_by ?? '—'}{d.reviewed_at ? ` · ${fmt(d.reviewed_at)}` : ''}</Field>
          <Field label="Approved by">{d.approved_by ?? '—'}{d.approved_at ? ` · ${fmt(d.approved_at)}` : ''}</Field>
        </dl>
        {d.amendment_reason ? (
          <p className="mt-3 rounded border border-[var(--color-border)] bg-surface-muted px-3 py-2 text-sm text-primary">
            <span className="font-medium">Amendment reason:</span> {d.amendment_reason}
          </p>
        ) : null}
      </section>

      <section className="mb-4 rounded-lg border border-[var(--color-border)] bg-surface p-4 shadow-card">
        <h2 className="mb-2 text-sm font-semibold text-primary">Artifacts</h2>
        {d.artifacts.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">No file has been generated for this version.</p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)] text-sm">
            {d.artifacts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-primary">
                  <span className="font-medium uppercase">{a.format}</span>
                  <span className="text-xs text-[var(--color-text-muted)]">
                    {' '}· {(a.file_size_bytes / 1024).toFixed(1)} kB · {a.engine} · {fmt(a.generated_at)}
                  </span>
                  <div className="font-mono text-[11px] text-[var(--color-text-muted)]">
                    sha256 {a.checksum.slice(0, 16)}… · snap {a.content_hash.slice(0, 8)}
                  </div>
                </span>
                <a
                  href={`/api/v1/deals/${dealId}/documents/${documentId}/download?format=${a.format}`}
                  className="focus-visible-ring rounded font-medium text-primary underline underline-offset-2"
                >
                  Download
                </a>
              </li>
            ))}
          </ul>
        )}
        {detail.glyphIssues.length > 0 ? (
          <div role="alert" className="mt-3 rounded border border-[color-mix(in_srgb,var(--color-critical)_25%,transparent)] bg-[color-mix(in_srgb,var(--color-critical)_5%,transparent)] p-3 text-sm">
            <p className="font-medium text-primary">This PDF cannot be approved</p>
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
              The PDF font cannot represent every character in this document, so a PDF rendering
              would substitute them. Use the DOCX output, which represents them correctly, or
              transliterate the values in the canonical record.
            </p>
            <ul className="mt-1.5 space-y-0.5 text-xs text-[var(--color-text-secondary)]">
              {detail.glyphIssues.map((issue) => (
                <li key={issue.label}>
                  <span className="font-medium">{issue.label}</span>: {issue.sample}{' '}
                  <span className="font-mono text-[var(--color-text-muted)]">({issue.code_points.join(' ')})</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {detail.drift ? (
        <section className="mb-4 rounded-lg border border-[var(--color-border)] bg-surface p-4 shadow-card">
          <h2 className="mb-1 text-sm font-semibold text-primary">Canonical data since this version</h2>
          {detail.drift.clean ? (
            <p className="text-sm text-[var(--color-text-secondary)]">
              Nothing this document reads has changed since it was generated.
            </p>
          ) : (
            <>
              {/* The distinction that matters: changed data does not make a past version wrong. */}
              <p className="text-sm text-[var(--color-text-secondary)]">
                Current data has changed since v{d.version} was generated. That does not make this
                version incorrect — it was generated from what was true at the time. Create an
                amendment if the shipment needs a corrected document.
              </p>
              <ul className="mt-2 divide-y divide-[var(--color-border)] text-sm">
                {detail.drift.entries.map((entry) => (
                  <li key={entry.field} className="py-1.5">
                    <span className="font-medium text-primary">{entry.label}</span>
                    <span className="ml-2 text-xs uppercase text-[var(--color-text-muted)]">{entry.kind}</span>
                    <div className="text-xs text-[var(--color-text-secondary)]">
                      <span className="line-through">{entry.from ?? '—'}</span>{' → '}
                      <span className="font-medium text-primary">{entry.to ?? '—'}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      ) : null}

      <section className="mb-4 rounded-lg border border-[var(--color-border)] bg-surface p-4 shadow-card">
        <h2 className="mb-2 text-sm font-semibold text-primary">Approval readiness</h2>
        {approvable ? (
          <p className="text-sm text-primary">
            Nothing is blocking approval. The exporter can approve this version.
          </p>
        ) : (
          <ul className="space-y-1 text-sm text-[var(--color-text-secondary)]">
            {detail.approvalBlockers.map((b, i) => (
              <li key={i}>{b.reason}</li>
            ))}
          </ul>
        )}

        {detail.snapshotReadiness && detail.snapshotReadiness.advisory.length > 0 ? (
          <div className="mt-3 border-t border-[var(--color-border)] pt-2">
            <p className="text-xs font-medium text-[var(--color-text-secondary)]">
              Worth checking — none of these block approval
            </p>
            <ul className="mt-1 space-y-0.5 text-xs text-[var(--color-text-muted)]">
              {detail.snapshotReadiness.advisory.map((issue) => (
                <li key={issue.field}>{issue.label}{issue.detail ? ` — ${issue.detail}` : ''}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <ReviewPanel
        dealId={dealId}
        documentId={documentId}
        canReview={d.is_current_version && d.generation_status === 'generated' && d.approval_status !== 'exporter_approved'}
        canAmend={d.is_current_version && d.generation_status === 'generated'}
        reviewStatus={d.review_status}
        approvalStatus={d.approval_status}
      />

      <section className="mt-4 rounded-lg border border-[var(--color-border)] bg-surface p-4 shadow-card">
        <h2 className="mb-2 text-sm font-semibold text-primary">Version history</h2>
        <ul className="divide-y divide-[var(--color-border)] text-sm">
          {detail.history.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <Link
                  href={`/agent/deals/${dealId}/documents/${v.id}`}
                  className={`focus-visible-ring rounded font-medium underline underline-offset-2 ${v.id === documentId ? 'text-primary' : 'text-[var(--color-text-secondary)]'}`}
                >
                  v{v.version}
                </Link>
                <span className="ml-2 text-xs text-[var(--color-text-secondary)]">
                  {v.is_current_version ? 'Current' : 'Superseded'} ·{' '}
                  {v.approval_status === 'exporter_approved' ? 'Approved'
                    : v.approval_status === 'rejected' ? 'Changes requested'
                    : v.generation_status === 'generated' ? 'Generated' : v.generation_status}
                </span>
                {v.amendment_reason ? (
                  <div className="text-xs text-[var(--color-text-muted)]">{v.amendment_reason}</div>
                ) : null}
              </span>
              <span className="text-xs text-[var(--color-text-muted)]">
                {v.artifacts.map((a) => a.format.toUpperCase()).join(' / ') || 'no file'} · {fmt(v.created_at)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
