/**
 * EXP-12 Document Center. All seven document types from the configurable registry
 * (AC01), each with its own generation/review/approval/filing chip (AC02 — never one
 * combined status), current version, an inline exception reason, and one primary CTA per
 * row by state and permission.
 */

import Link from 'next/link';
import { StatusChip, Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui';
import { GenerateButton } from '@/components/documents/GenerateButton';
import {
  APPROVAL_STATUS_DISPLAY,
  docChip,
  FILING_STATUS_DISPLAY,
  GENERATION_STATUS_DISPLAY,
  REVIEW_STATUS_DISPLAY,
} from '@/components/documents/statusDisplay';
import { getConfig } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { loadDealForWorkspace } from '../loadDeal';

function exceptionReason(doc: {
  generation_status: string;
  generation_error: string | null;
  approval_status: string;
  rejection_reason: string | null;
  changes_requested_reason: string | null;
  filing_status: string;
}): string | null {
  if (doc.generation_status === 'failed') return doc.generation_error ?? 'Generation failed.';
  if (doc.approval_status === 'rejected') return doc.changes_requested_reason ?? doc.rejection_reason ?? 'Changes requested.';
  if (doc.filing_status === 'rejected') return doc.rejection_reason ?? 'Rejected by the filing authority.';
  return null;
}

export default async function DealDocumentsPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const { deal } = await loadDealForWorkspace(dealId);
  if (!deal) return null;

  const [registry, snapshot, documents] = await Promise.all([
    getConfig('documents.registry'),
    prisma.dealSnapshot.findFirst({ where: { deal_id: dealId }, orderBy: { version: 'desc' }, select: { id: true } }),
    prisma.document.findMany({
      where: { deal_id: dealId, is_current_version: true },
      orderBy: { doc_type: 'asc' },
    }),
  ]);

  if (!snapshot) {
    return (
      <section className="rounded-lg border border-dashed border-[var(--color-border-strong)] bg-surface p-8 text-center">
        <p className="text-sm font-normal text-primary">No documents yet</p>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Documents generate from the deal snapshot, which is created when the deal is locked. There is
          nothing to show until then.
        </p>
      </section>
    );
  }

  const byType = new Map(documents.map((d) => [d.doc_type, d]));
  // The registry is the source of truth for "which document types this deal needs"
  // (AC01) — every entry renders a row, even the rare case where the lock somehow didn't
  // produce one, rather than the checklist silently being incomplete.
  const versionCounts = await prisma.document.groupBy({
    by: ['doc_type'],
    where: { deal_id: dealId },
    _count: { _all: true },
  });
  const versionCountByType = new Map(versionCounts.map((v) => [v.doc_type, v._count._all]));

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Document checklist</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Generation, review, approval and filing are tracked independently for every document.
        </p>

        <div className="mt-4 overflow-x-auto">
          <Table className="min-w-[860px]">
            <Thead className="text-xs uppercase text-[var(--color-text-muted)]">
              <Tr>
                <Th>Document</Th>
                <Th>Version</Th>
                <Th>Generation</Th>
                <Th>Review</Th>
                <Th>Approval</Th>
                <Th>Filing</Th>
                <Th>Exception</Th>
                <Th>Action</Th>
              </Tr>
            </Thead>
            <Tbody>
              {registry.map((entry) => {
                const doc = byType.get(entry.doc_type as never);
                const versionCount = versionCountByType.get(entry.doc_type as never) ?? 0;
                const exception = doc ? exceptionReason(doc) : null;
                // Missing entirely: the lock didn't produce this row (shouldn't happen,
                // but the checklist must never silently omit a registry document either).
                if (!doc) {
                  return (
                    <Tr key={entry.doc_type}>
                      <Td className="font-medium text-primary">{entry.label}</Td>
                      <Td colSpan={6} className="text-[var(--color-text-secondary)]">
                        Not yet created for this deal.
                      </Td>
                    </Tr>
                  );
                }

                const needsGenerate = doc.generation_status !== 'generated' || doc.approval_status === 'rejected';
                const isProcessing = doc.generation_status === 'processing';

                return (
                  <Tr key={doc.id} className="align-top">
                    <Td>
                      <Link href={`/app/deals/${dealId}/documents/${doc.id}`} className="focus-visible-ring font-medium text-primary underline-offset-2 hover:underline">
                        {entry.label}
                      </Link>
                    </Td>
                    <Td className="text-[var(--color-text-secondary)]">
                      v{doc.version}
                      {versionCount > 1 ? <span className="ml-1 text-xs">({versionCount} versions)</span> : null}
                    </Td>
                    <Td>
                      <StatusChip {...docChip(GENERATION_STATUS_DISPLAY, doc.generation_status)} size="sm" />
                    </Td>
                    <Td>
                      <StatusChip {...docChip(REVIEW_STATUS_DISPLAY, doc.review_status)} size="sm" />
                    </Td>
                    <Td>
                      <StatusChip {...docChip(APPROVAL_STATUS_DISPLAY, doc.approval_status)} size="sm" />
                    </Td>
                    <Td>
                      <StatusChip {...docChip(FILING_STATUS_DISPLAY, doc.filing_status)} size="sm" />
                    </Td>
                    <Td className="max-w-[220px] text-[var(--color-text-secondary)]">{exception ?? '—'}</Td>
                    <Td>
                      {needsGenerate && !isProcessing ? (
                        <GenerateButton dealId={dealId} documentId={doc.id} label={doc.generation_status === 'failed' ? 'Retry' : 'Generate'} compact />
                      ) : (
                        <Link href={`/app/deals/${dealId}/documents/${doc.id}`} className="text-sm font-medium text-primary underline underline-offset-2">
                          {doc.approval_status === 'pending' ? 'Review & approve' : 'Open'}
                        </Link>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        </div>
      </section>
    </div>
  );
}
