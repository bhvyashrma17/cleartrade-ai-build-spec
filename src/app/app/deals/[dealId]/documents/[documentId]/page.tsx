/**
 * EXP-13 Document Detail / Review. Header with provenance, preview (or a fallback that
 * offers download), a data summary of the snapshot fields used, the approval panel, and
 * version history.
 */

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { StatusChip } from '@/components/ui';
import { DocumentApprovalPanel } from '@/components/documents/DocumentApprovalPanel';
import { GenerateButton } from '@/components/documents/GenerateButton';
import {
  APPROVAL_STATUS_DISPLAY,
  docChip,
  FILING_STATUS_DISPLAY,
  GENERATION_STATUS_DISPLAY,
  REVIEW_STATUS_DISPLAY,
} from '@/components/documents/statusDisplay';
import { UploadReplacement } from '@/components/documents/UploadReplacement';
import { getConfig } from '@/lib/config';
import { documentArtifacts } from '@/lib/document-rendering';
import { loadDocumentHistory, loadDocumentScoped } from '@/lib/documents';
import { canApproveDocument, canDownloadDocument } from '@/lib/permissions';
import { loadDealForWorkspace } from '../../loadDeal';

function formatWhen(date: Date | null) {
  return date ? date.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
}

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ dealId: string; documentId: string }>;
}) {
  const { dealId, documentId } = await params;
  const { deal, principal } = await loadDealForWorkspace(dealId);
  if (!deal) return null;

  let document;
  try {
    ({ document } = await loadDocumentScoped(principal, dealId, documentId));
  } catch {
    notFound();
  }

  const [registry, history, mayApprove, mayDownload] = await Promise.all([
    getConfig('documents.registry'),
    loadDocumentHistory(dealId, document.doc_type),
    canApproveDocument(principal, { deal }, { member_can_approve: false, ops_override_allowed: false }),
    canDownloadDocument(principal, { deal }),
  ]);
  const label = registry.find((r) => r.doc_type === document.doc_type)?.label ?? document.doc_type;

  // Preview: a generated document is re-rendered on demand (deterministic — see
  // src/lib/document-generation/mock-engine.ts); an uploaded one only previews inline
  // when it's actually text, otherwise "Preview unavailable" + download (EXP-13 required
  // state) is the honest answer rather than pretending to render a PDF/image inline.
  let previewText: string | null = null;
  let previewUnavailableReason: string | null = null;
  if (document.generation_status !== 'generated') {
    previewUnavailableReason = 'This document has not been generated yet.';
  } else if (document.source === 'uploaded') {
    if (document.mime_type?.startsWith('text/')) {
      try {
        const { readStoredFile } = await import('@/lib/document-storage');
        previewText = (await readStoredFile(document.file_ref!)).toString('utf8');
      } catch {
        previewUnavailableReason = 'Could not load the uploaded file for preview.';
      }
    } else {
      previewUnavailableReason = 'Preview is not available for this file type.';
    }
  } else {
    // Preview reads the STORED artifact rather than re-rendering. Re-rendering would produce
    // bytes whose checksum could differ from the one an approval was bound to — safe while the
    // renderer was deterministic plain text, not safe for a PDF.
    const artifacts = await documentArtifacts(documentId);
    const previewable = artifacts.find((a) => a.format === 'html')
      ?? artifacts.find((a) => a.mime_type.startsWith('text/'));
    if (previewable) {
      try {
        const { readStoredFile } = await import('@/lib/document-storage');
        previewText = (await readStoredFile(previewable.file_ref)).toString('utf8');
      } catch {
        previewUnavailableReason = 'Could not load the generated file for preview.';
      }
    } else if (artifacts.length > 0) {
      previewUnavailableReason = `Preview is not available for ${artifacts.map((a) => a.format.toUpperCase()).join(' / ')}. Download the file instead.`;
    } else {
      previewUnavailableReason = 'No generated file is stored for this version.';
    }
  }

  const isSuperseded = !document.is_current_version;

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <p className="text-sm font-normal text-primary">
        <Link href={`/app/deals/${dealId}/documents`} className="underline underline-offset-2">
          Document checklist
        </Link>
      </p>

      <header className="mt-2 rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-serif text-title-page text-primary">{label}</h1>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              Version {document.version} · {document.source === 'uploaded' ? 'Uploaded' : 'Generated'}
            </p>
          </div>
          {isSuperseded ? <StatusChip label="Superseded" tone="neutral" icon="pause" detail="Read-only historical version." /> : null}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <StatusChip {...docChip(GENERATION_STATUS_DISPLAY, document.generation_status)} size="sm" />
          <StatusChip {...docChip(REVIEW_STATUS_DISPLAY, document.review_status)} size="sm" />
          <StatusChip {...docChip(APPROVAL_STATUS_DISPLAY, document.approval_status)} size="sm" />
          <StatusChip {...docChip(FILING_STATUS_DISPLAY, document.filing_status)} size="sm" />
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-[var(--color-text-secondary)]">Generated</dt>
            <dd className="mt-0.5 text-primary">{formatWhen(document.updated_at) ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-text-secondary)]">Reviewed</dt>
            <dd className="mt-0.5 text-primary">{document.reviewer?.name ? `${document.reviewer.name} · ` : ''}{formatWhen(document.reviewed_at) ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-text-secondary)]">Approved</dt>
            <dd className="mt-0.5 text-primary">{document.approver?.name ? `${document.approver.name} · ` : ''}{formatWhen(document.approved_at) ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-text-secondary)]">Filed</dt>
            <dd className="mt-0.5 text-primary">
              {document.filing_reference ? <>Ref <span className="record">{document.filing_reference}</span> · </> : ''}
              {formatWhen(document.filed_at) ?? '—'}
            </dd>
          </div>
        </dl>
      </header>

      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <div className="space-y-6 xl:col-span-3">
          <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-primary">Preview</h2>
              {mayDownload && document.generation_status === 'generated' ? (
                <a
                  href={`/api/v1/deals/${dealId}/documents/${documentId}/download`}
                  className="text-sm font-medium text-primary underline underline-offset-2"
                >
                  Download
                </a>
              ) : null}
            </div>
            {previewText ? (
              <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--color-border)] bg-surface-muted p-4 text-xs text-primary">
                {previewText}
              </pre>
            ) : (
              <div className="mt-3 rounded-md border border-dashed border-[var(--color-border-strong)] p-6 text-center">
                <p className="text-sm text-primary">{previewUnavailableReason ?? 'Preview unavailable.'}</p>
                {document.generation_status !== 'generated' && !isSuperseded ? (
                  <div className="mt-3 flex justify-center">
                    <GenerateButton dealId={dealId} documentId={document.id} label={document.generation_status === 'failed' ? 'Retry generation' : 'Generate'} />
                  </div>
                ) : null}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
            <h2 className="text-lg font-semibold text-primary">Version history</h2>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Prior versions are read-only.</p>
            <ul className="mt-4 space-y-3">
              {history.map((row) => (
                <li key={row.id} className="border-b border-[var(--color-border)] pb-3 last:border-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {row.id === document.id ? (
                      <span className="font-medium text-primary">Version {row.version} (viewing)</span>
                    ) : (
                      <Link href={`/app/deals/${dealId}/documents/${row.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                        Version {row.version}
                      </Link>
                    )}
                    <StatusChip {...docChip(APPROVAL_STATUS_DISPLAY, row.approval_status)} size="sm" />
                  </div>
                  <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                    {row.source === 'uploaded' ? 'Uploaded' : 'Generated'} · {formatWhen(row.created_at)}
                    {!row.is_current_version ? ' · Superseded' : ''}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="space-y-6 xl:col-span-2">
          {isSuperseded ? (
            <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
              <h2 className="text-lg font-semibold text-primary">Superseded version</h2>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                This is a historical version and cannot be approved (EXP-13-AC01). Open the current version
                to act on it.
              </p>
            </section>
          ) : document.filing_status === 'filed' || document.filing_status === 'accepted' ? (
            <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
              <h2 className="text-lg font-semibold text-primary">Filed</h2>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                This version was filed and is read-only. Reference: <span className="record">{document.filing_reference ?? 'not recorded'}</span>.
              </p>
            </section>
          ) : document.approval_status === 'pending' && mayApprove ? (
            <DocumentApprovalPanel dealId={dealId} documentId={document.id} version={document.version} checksum={document.checksum ?? ''} />
          ) : document.approval_status === 'pending' ? (
            <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
              <h2 className="text-lg font-semibold text-primary">Awaiting an authorized approver</h2>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                This document is ready for approval, but your account isn&apos;t authorized to approve it.
              </p>
            </section>
          ) : document.approval_status === 'exporter_approved' ? (
            <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
              <h2 className="text-lg font-semibold text-primary">Approved</h2>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                Approved by {document.approver?.name ?? 'the exporter'}
                {formatWhen(document.approved_at) ? ` on ${formatWhen(document.approved_at)}` : ''} — an immutable record bound to
                this checksum.
              </p>
            </section>
          ) : null}

          {!isSuperseded && document.generation_status === 'generated' && document.filing_status !== 'filed' && document.filing_status !== 'accepted' ? (
            <UploadReplacement dealId={dealId} documentId={document.id} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
