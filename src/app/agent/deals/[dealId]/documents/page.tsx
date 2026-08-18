/**
 * `/agent/deals/:dealId/documents` — generation, from the agent's side.
 *
 * Phase 6 scope is deliberately generation only. Review, approval and amendment get their own
 * workspace in Phase 7, so this page shows lifecycle state as read-only context rather than
 * offering actions it would only half-implement.
 *
 * Readiness and generation are shown together on purpose: "Missing 2 fields · Fix data" and
 * "Ready · Generate PDF" are the same decision from the agent's point of view, and separating
 * them across two screens is what makes people generate documents with blanks in them.
 */

import Link from 'next/link';
import { DocType } from '@prisma/client';
import { StatusChip } from '@/components/ui';
import { allDocumentReadiness, buildDocumentContext } from '@/lib/document-data';
import { DOCUMENT_FORMAT_SUPPORT, getDocumentGenerationEngine } from '@/lib/document-generation';
import { prisma } from '@/lib/prisma';
import { loadAgentDeal } from '../loadAgentDeal';
import { GenerateDocumentPanel } from './GenerateDocumentPanel';

const DOC_LABELS: Record<string, string> = {
  PI: 'Proforma Invoice',
  CI: 'Commercial Invoice',
  packing_list: 'Packing List',
  shipping_bill_draft: 'Shipping Bill (draft)',
  COO_draft: 'Certificate of Origin (draft)',
  declaration: 'Declaration',
  insurance_declaration: 'Insurance declaration',
};

const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(d);

export default async function AgentDocumentsPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const { principal, deal } = await loadAgentDeal(dealId);

  const context = await buildDocumentContext(principal, dealId, DocType.CI);
  const readiness = allDocumentReadiness(context);
  const engine = getDocumentGenerationEngine();

  const documents = await prisma.document.findMany({
    where: { deal_id: dealId, is_current_version: true },
    include: { artifacts: { orderBy: { format: 'asc' } } },
  });
  const byType = new Map(documents.map((d) => [d.doc_type, d]));

  const rows = readiness.map((r) => {
    const document = byType.get(r.documentType) ?? null;
    // A format is offered only if BOTH the document type supports it and the configured engine
    // can produce it. The mock engine renders text, so on a mock environment this list is
    // honestly short rather than offering PDF buttons that would return a .txt.
    const formats = (DOCUMENT_FORMAT_SUPPORT[r.documentType] ?? [])
      .filter((f) => engine.supports(r.documentType, f));
    return { readiness: r, document, formats };
  });

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <header className="mb-4">
        <p className="text-sm font-medium text-primary">
          <Link href={`/agent/deals/${dealId}`} className="focus-visible-ring rounded underline underline-offset-2">
            {deal.exporter_org.display_name}
          </Link>{' '}
          · {deal.buyer.display_name}
        </p>
        <h1 className="text-2xl font-semibold text-primary">Documents</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Every document renders from a frozen snapshot of the canonical data, so a version keeps
          saying what it said when it was generated. Renderer:{' '}
          <span className="font-mono text-xs">{engine.name}@{engine.version}</span>.
        </p>
      </header>

      <div className="space-y-3">
        {rows.map(({ readiness: r, document, formats }) => (
          <section key={r.documentType} className="rounded-lg border border-[var(--color-border)] bg-surface p-4 shadow-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-primary">
                  {DOC_LABELS[r.documentType] ?? r.documentType}
                </h2>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <StatusChip
                    label={r.status === 'ready' ? 'Ready' : r.status === 'blocked' ? 'Blocked' : `Missing ${r.missing.length}`}
                    tone={r.status === 'ready' ? 'positive' : r.status === 'blocked' ? 'critical' : 'warning'}
                    icon={r.status === 'ready' ? 'check' : 'alert'}
                    size="sm"
                  />
                  {document ? (
                    <>
                      <span className="text-xs text-[var(--color-text-secondary)]">v{document.version}</span>
                      <StatusChip label={document.generation_status} tone="info" icon="dot" size="sm" />
                      <StatusChip label={document.approval_status} tone="neutral" icon="dot" size="sm" />
                    </>
                  ) : (
                    <span className="text-xs text-[var(--color-text-muted)]">Not generated</span>
                  )}
                </div>
              </div>

              {r.status === 'ready' ? (
                <GenerateDocumentPanel
                  dealId={dealId}
                  documentId={document?.id ?? null}
                  formats={formats}
                />
              ) : (
                <Link
                  href={`/agent/deals/${dealId}/document-data`}
                  className="focus-visible-ring inline-flex min-h-9 items-center rounded border border-primary px-3 text-sm font-medium text-primary"
                >
                  Fix data
                </Link>
              )}
            </div>

            {r.status !== 'ready' ? (
              <ul className="mt-2 space-y-0.5 text-xs text-[var(--color-text-secondary)]">
                {[...r.invalid, ...r.missing].map((issue) => (
                  <li key={issue.field}>
                    {issue.label}
                    {issue.detail || issue.condition ? (
                      <span className="text-[var(--color-text-muted)]"> — {issue.detail ?? issue.condition}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}

            {document && document.artifacts.length > 0 ? (
              <ul className="mt-3 divide-y divide-[var(--color-border)] border-t border-[var(--color-border)] text-xs">
                {document.artifacts.map((artifact) => (
                  <li key={artifact.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="text-primary">
                      <span className="font-medium uppercase">{artifact.format}</span>
                      <span className="text-[var(--color-text-muted)]">
                        {' '}· {(artifact.file_size_bytes / 1024).toFixed(1)} kB · {fmtDate(artifact.generated_at)}
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      {/* The frozen input this file came from, so two formats can be SEEN to
                          share one snapshot rather than merely assumed to. */}
                      <span className="font-mono text-[var(--color-text-muted)]">
                        {artifact.content_hash.slice(0, 8)}
                      </span>
                      <a
                        href={`/api/v1/deals/${dealId}/documents/${document.id}/download?format=${artifact.format}`}
                        className="focus-visible-ring rounded font-medium text-primary underline underline-offset-2"
                      >
                        Download
                      </a>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </div>

      <p className="mt-4 text-xs text-[var(--color-text-muted)]">
        Review, approval and amendments are handled in the document workspace — this page covers
        generation only.
      </p>
    </div>
  );
}
