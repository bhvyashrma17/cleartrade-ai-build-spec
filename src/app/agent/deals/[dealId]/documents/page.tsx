/**
 * `/agent/deals/:dealId/documents` — the agent document workspace.
 *
 * Dense on purpose. An agent working many shipments needs one screen that answers "what needs
 * me next?" per document, so readiness, generation, review, approval, artifacts and version
 * history sit in one row rather than behind six tabs. The detail route exists for reviewing
 * one version closely, not for finding out that it needs reviewing.
 *
 * Wording is load-bearing here. A shipping bill draft that ClearTrade has approved is not
 * filed, an approved COO draft is not chamber-certified, and an insurance declaration is not
 * an insurer's policy — `documentAuthorityNote()` supplies that text and the row prints it.
 */

import Link from 'next/link';
import { StatusChip } from '@/components/ui';
import { documentWorkspace } from '@/lib/document-lifecycle';
import { DOCUMENT_FORMAT_SUPPORT, getDocumentGenerationEngine } from '@/lib/document-generation';
import { issuedInvoiceNumberForDeal, previewNextInvoiceNumber } from '@/lib/invoice-numbering';
import { loadAgentDeal } from '../loadAgentDeal';
import { GenerateDocumentPanel } from './GenerateDocumentPanel';

const fmt = (d: Date | null) =>
  d ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(d) : null;

/** The single next action for a document, which is the only thing an agent scans for. */
function nextAction(row: Awaited<ReturnType<typeof documentWorkspace>>['rows'][number]) {
  const current = row.current;
  if (row.readiness.status !== 'ready' && !current?.checksum) {
    return { label: 'Fix data', tone: 'warning' as const, why: `${row.readiness.missing.length + row.readiness.invalid.length} canonical field(s) outstanding` };
  }
  if (!current) return { label: 'Awaiting deal lock', tone: 'neutral' as const, why: 'Created from the registry when the deal is locked' };
  if (current.generation_status === 'failed') return { label: 'Regenerate', tone: 'critical' as const, why: current.generation_error ?? 'Generation failed' };
  if (current.generation_status !== 'generated') return { label: 'Generate', tone: 'info' as const, why: 'Not generated yet' };
  if (current.approval_status === 'exporter_approved') {
    return { label: 'Approved', tone: 'positive' as const, why: `v${current.version} approved ${fmt(current.approved_at) ?? ''}`.trim() };
  }
  if (current.approval_status === 'rejected') {
    return { label: 'Amend', tone: 'critical' as const, why: current.changes_requested_reason ?? 'Changes requested by the exporter' };
  }
  if (current.review_status === 'not_reviewed') return { label: 'Review', tone: 'info' as const, why: 'Generated, not yet reviewed by an agent' };
  if (current.review_status === 'changes_requested') return { label: 'Amend', tone: 'warning' as const, why: 'You flagged changes on this version' };
  return { label: 'With exporter', tone: 'neutral' as const, why: 'Agent-reviewed, awaiting exporter approval' };
}

export default async function AgentDocumentsPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const { principal, deal } = await loadAgentDeal(dealId);

  const [{ rows }, engine, issuedNumber, preview] = await Promise.all([
    documentWorkspace(principal, dealId),
    Promise.resolve(getDocumentGenerationEngine()),
    issuedInvoiceNumberForDeal(dealId),
    previewNextInvoiceNumber(principal, deal.exporter_org_id),
  ]);

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <header className="mb-4">
        <p className="text-sm font-medium text-primary">
          <Link href={`/agent/deals/${dealId}`} className="focus-visible-ring rounded underline underline-offset-2">
            {deal.exporter_org.display_name}
          </Link>{' '}
          · {deal.buyer.display_name}
        </p>
        <h1 className="text-2xl font-semibold text-primary">Documents</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Every version renders from a frozen snapshot and stays reproducible. Correcting
          canonical data never changes a version that already exists — it becomes the basis for
          the next one. Renderer: <span className="font-mono text-xs">{engine.name}@{engine.version}</span>.
        </p>
      </header>

      {/* The invoice-number state, stated plainly. A preview is never presented as issued. */}
      <section className="mb-4 rounded-lg border border-[var(--color-border)] bg-surface p-3 text-sm shadow-card">
        {issuedNumber ? (
          <p className="text-primary">
            <span className="font-semibold">Invoice {issuedNumber.formatted_number}</span>
            <span className="ml-2 text-xs text-[var(--color-text-secondary)]">
              Issued {fmt(issuedNumber.issued_at)}
            </span>
          </p>
        ) : (
          <p className="text-primary">
            <span className="font-semibold">Draft invoice</span>
            <span className="ml-2 text-xs text-[var(--color-text-secondary)]">
              No official invoice number issued. Next in the series would be{' '}
              <span className="font-mono">{preview.preview_number}</span>, which is an estimate
              until issued on the{' '}
              <Link href={`/agent/deals/${dealId}/document-data`} className="focus-visible-ring rounded underline underline-offset-2">
                document data
              </Link>{' '}
              page.
            </span>
          </p>
        )}
      </section>

      <div className="space-y-3">
        {rows.map((row) => {
          const action = nextAction(row);
          const current = row.current;
          const formats = (DOCUMENT_FORMAT_SUPPORT[row.doc_type] ?? [])
            .filter((f) => engine.supports(row.doc_type, f));

          return (
            <section key={row.doc_type} className="rounded-lg border border-[var(--color-border)] bg-surface p-4 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold text-primary">{row.label}</h2>
                    {current ? (
                      <Link
                        href={`/agent/deals/${dealId}/documents/${current.id}`}
                        className="focus-visible-ring rounded text-xs font-medium text-primary underline underline-offset-2"
                      >
                        v{current.version} · open
                      </Link>
                    ) : null}
                    <StatusChip label={action.label} tone={action.tone} icon={action.tone === 'positive' ? 'check' : 'alert'} size="sm" />
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{action.why}</p>

                  {current ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <StatusChip label={`gen: ${current.generation_status}`} tone="neutral" icon="dot" size="sm" />
                      <StatusChip label={`review: ${current.review_status}`} tone="neutral" icon="dot" size="sm" />
                      <StatusChip label={`approval: ${current.approval_status}`} tone="neutral" icon="dot" size="sm" />
                      {row.filing_applicable ? (
                        <StatusChip label={`filing: ${current.filing_status}`} tone="neutral" icon="dot" size="sm" />
                      ) : null}
                      {current.content_hash ? (
                        <span className="font-mono text-[11px] text-[var(--color-text-muted)]" title="Frozen input hash">
                          snap {current.content_hash.slice(0, 8)}
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  {/* Wording safeguard — printed, not implied. */}
                  {row.authority ? (
                    <p className="mt-1.5 max-w-2xl text-xs text-[var(--color-text-muted)]">
                      {row.authority.approvalMeans} <span className="font-medium">{row.authority.notThis}</span>
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-col items-end gap-2">
                  {row.readiness.status !== 'ready' ? (
                    <Link
                      href={`/agent/deals/${dealId}/document-data`}
                      className="focus-visible-ring inline-flex min-h-9 items-center rounded border border-primary px-3 text-sm font-medium text-primary"
                    >
                      Fix data
                    </Link>
                  ) : null}
                  <GenerateDocumentPanel
                    dealId={dealId}
                    documentId={current?.id ?? null}
                    formats={formats}
                    disabled={current?.approval_status === 'exporter_approved'}
                  />
                </div>
              </div>

              {row.readiness.status !== 'ready' ? (
                <ul className="mt-2 space-y-0.5 text-xs text-[var(--color-text-secondary)]">
                  {[...row.readiness.invalid, ...row.readiness.missing].map((issue) => (
                    <li key={issue.field}>
                      {issue.label}
                      {issue.detail || issue.condition ? (
                        <span className="text-[var(--color-text-muted)]"> — {issue.detail ?? issue.condition}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}

              {row.history.length > 0 ? (
                <ul className="mt-3 divide-y divide-[var(--color-border)] border-t border-[var(--color-border)] text-xs">
                  {row.history.map((version) => (
                    <li key={version.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                      <span className="text-primary">
                        <Link
                          href={`/agent/deals/${dealId}/documents/${version.id}`}
                          className="focus-visible-ring rounded font-medium underline underline-offset-2"
                        >
                          v{version.version}
                        </Link>
                        {version.is_current_version ? (
                          <span className="ml-1 text-[var(--color-text-muted)]">· current</span>
                        ) : (
                          <span className="ml-1 text-[var(--color-text-muted)]">· superseded</span>
                        )}
                        <span className="ml-2 text-[var(--color-text-secondary)]">
                          {version.approval_status === 'exporter_approved' ? 'Approved'
                            : version.approval_status === 'rejected' ? 'Changes requested'
                            : version.generation_status === 'generated' ? 'Generated' : version.generation_status}
                        </span>
                        {version.amendment_reason ? (
                          <span className="ml-2 text-[var(--color-text-muted)]">
                            — amended from v{version.amended_from_version}: {version.amendment_reason}
                          </span>
                        ) : null}
                      </span>
                      <span className="flex items-center gap-2 text-[var(--color-text-muted)]">
                        {version.artifacts.map((a) => (
                          <a
                            key={a.id}
                            href={`/api/v1/deals/${dealId}/documents/${version.id}/download?format=${a.format}`}
                            className="focus-visible-ring rounded font-medium uppercase text-primary underline underline-offset-2"
                          >
                            {a.format}
                          </a>
                        ))}
                        {version.artifacts.length === 0 ? <span>no file</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
