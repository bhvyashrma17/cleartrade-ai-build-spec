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
import { PageHeader, StatusChip } from '@/components/ui';
import { documentWorkspace } from '@/lib/document-lifecycle';
import { DOCUMENT_FORMAT_SUPPORT, getDocumentGenerationEngine } from '@/lib/document-generation';
import {
  DOCUMENT_UI_GROUPS,
  documentDataAnchor,
  documentDisplayName,
  notApplicableMessage,
} from '@/lib/document-ui';
import { issuedInvoiceNumberForDeal, previewNextInvoiceNumber } from '@/lib/invoice-numbering';
import { loadAgentDeal } from '../loadAgentDeal';
import { InvoiceNumberAction } from '../InvoiceNumberAction';
import { GenerateDocumentPanel } from './GenerateDocumentPanel';

const fmt = (d: Date | null) =>
  d ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(d) : null;

/** The single next action for a document, which is the only thing an agent scans for. */
function nextAction(row: Awaited<ReturnType<typeof documentWorkspace>>['rows'][number]) {
  const current = row.current;
  if (row.readiness.status === 'not_applicable') {
    return {
      label: 'Not applicable', tone: 'neutral' as const,
      why: notApplicableMessage(row.doc_type, row.readiness.applicability),
    };
  }
  if (invoiceNumberIsOnlyBlocker(row)) {
    return {
      label: 'Official invoice number required', tone: 'warning' as const,
      why: 'Commercial Invoice cannot be finalized until an invoice number is issued.',
    };
  }
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

const lifecycleLabel = (value: string) => value.replaceAll('_', ' ');

function invoiceNumberIsOnlyBlocker(row: Awaited<ReturnType<typeof documentWorkspace>>['rows'][number]) {
  const blockers = [...row.readiness.invalid, ...row.readiness.missing];
  return row.doc_type === 'CI' && row.readiness.status !== 'ready'
    && blockers.length === 1 && blockers[0]?.field === 'references.invoice_number';
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
    <div className="py-4 md:py-6">
      <PageHeader
        className="mb-4"
        eyebrow={
          <>
            <Link href={`/agent/deals/${dealId}`} className="focus-visible-ring rounded underline underline-offset-2">
              {deal.exporter_org.display_name}
            </Link>{' '}
            · {deal.buyer.display_name}
          </>
        }
        title="Documents"
        description={
          <>
            Every version renders from a frozen snapshot and stays reproducible. Correcting
            canonical data never changes a version that already exists — it becomes the basis for
            the next one. Renderer: <span className="record">{engine.name}@{engine.version}</span>.
          </>
        }
      />

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
              <span className="record">{preview.preview_number}</span>, which is an estimate
              until issued on the{' '}
              <Link href={`/agent/deals/${dealId}/document-data#invoice-numbering`} className="focus-visible-ring rounded underline underline-offset-2">
                document data
              </Link>{' '}
              page.
            </span>
          </p>
        )}
      </section>

      <div className="space-y-8">
        {DOCUMENT_UI_GROUPS.map((group) => {
          const groupRows = group.documentTypes
            .map((documentType) => rows.find((row) => row.doc_type === documentType))
            .filter((row): row is NonNullable<typeof row> => Boolean(row));

          return (
          <section key={group.id} aria-labelledby={`documents-${group.id}`}>
            <div className="mb-3 border-b border-[var(--color-border)] pb-2">
              <h2 id={`documents-${group.id}`} className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
                {group.label}
              </h2>
              <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                {groupRows.length} {groupRows.length === 1 ? 'document capability' : 'document capabilities'}
              </p>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
        {groupRows.map((row) => {
          const action = nextAction(row);
          const current = row.current;
          const needsInvoiceNumber = invoiceNumberIsOnlyBlocker(row);
          const firstBlocker = row.readiness.invalid[0] ?? row.readiness.missing[0];
          const fixDataHref = `/agent/deals/${dealId}/document-data#${documentDataAnchor(firstBlocker?.owner ?? 'deal')}`;
          const displayName = documentDisplayName(row.doc_type, row.readiness.applicability);
          const formats = (DOCUMENT_FORMAT_SUPPORT[row.doc_type] ?? [])
            .filter((f) => engine.supports(row.doc_type, f));

          return (
            <article key={row.doc_type} className="rounded-lg border border-[var(--color-border)] bg-surface p-4 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-primary">{displayName}</h3>
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

                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 rounded border border-[var(--color-border)] bg-surface-muted p-3 text-xs sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
                    <div>
                      <dt className="text-[var(--color-text-muted)]">Applicability</dt>
                      <dd className="mt-0.5 font-medium capitalize text-primary">{row.readiness.applicability.status.replaceAll('_', ' ')}</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--color-text-muted)]">Readiness</dt>
                      <dd className="mt-0.5 font-medium capitalize text-primary">{row.readiness.status === 'missing_data' ? 'Missing data' : lifecycleLabel(row.readiness.status)}</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--color-text-muted)]">Version</dt>
                      <dd className="mt-0.5 font-medium text-primary">{current ? `v${current.version}` : 'Not created'}</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--color-text-muted)]">Artifacts</dt>
                      <dd className="mt-0.5 font-medium text-primary">{current?.artifacts.length ? current.artifacts.map((artifact) => artifact.format === 'html' ? 'Preview' : artifact.format.toUpperCase()).join(' / ') : 'None yet'}</dd>
                    </div>
                  </dl>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Document lifecycle">
                      <StatusChip label={`Generation: ${current ? lifecycleLabel(current.generation_status) : 'not generated'}`} tone="neutral" icon="dot" size="sm" />
                      <StatusChip label={`Review: ${current ? lifecycleLabel(current.review_status) : 'not started'}`} tone="neutral" icon="dot" size="sm" />
                      <StatusChip label={`Approval: ${current ? lifecycleLabel(current.approval_status) : row.approval_required ? 'not started' : 'not required'}`} tone="neutral" icon="dot" size="sm" />
                      {row.filing_applicable ? (
                        <StatusChip label={`Filing: ${current ? lifecycleLabel(current.filing_status) : 'not started'}`} tone="neutral" icon="dot" size="sm" />
                      ) : null}
                      {current?.content_hash ? (
                        <span className="record text-[var(--color-text-muted)]" title="Frozen input hash">
                          snap {current.content_hash.slice(0, 8)}
                        </span>
                      ) : null}
                  </div>

                  {/* Wording safeguard — printed, not implied. */}
                  {row.authority ? (
                    <p className="mt-1.5 max-w-2xl text-xs text-[var(--color-text-muted)]">
                      {row.authority.approvalMeans} <span className="font-medium">{row.authority.notThis}</span>
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-col items-end gap-2">
                  {needsInvoiceNumber ? (
                    <InvoiceNumberAction dealId={dealId} nextInvoiceNumberPreview={preview.preview_number} />
                  ) : row.readiness.status !== 'ready' && row.readiness.status !== 'not_applicable' ? (
                    <Link
                      href={fixDataHref}
                      className="focus-visible-ring inline-flex min-h-9 items-center rounded border border-primary px-3 text-sm font-medium text-primary"
                    >
                      Fix data
                    </Link>
                  ) : null}
                  {row.readiness.status === 'ready' ? (
                    <GenerateDocumentPanel
                      dealId={dealId}
                      documentId={current?.id ?? null}
                      formats={formats}
                      disabled={current?.approval_status === 'exporter_approved'}
                    />
                  ) : null}
                </div>
              </div>

              {row.readiness.status !== 'ready' && row.readiness.status !== 'not_applicable' ? (
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

              {/* Advisories do not block. They are still shown, because the agent is the one
                  who can tell whether a flagged oddity is a mistake or simply how this shipment
                  works. */}
              {row.readiness.advisory.length > 0 ? (
                <ul className="mt-2 space-y-0.5 border-l-2 border-[var(--color-border-strong)] pl-2 text-xs text-[var(--color-text-muted)]">
                  {row.readiness.advisory.map((issue) => (
                    <li key={issue.field}>
                      <span className="font-medium">Worth checking:</span> {issue.label}
                      {issue.detail ? ` — ${issue.detail}` : ''}
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
            </article>
          );
        })}
            </div>
          </section>
          );
        })}
      </div>
    </div>
  );
}
