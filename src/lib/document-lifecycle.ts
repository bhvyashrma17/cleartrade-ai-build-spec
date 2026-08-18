/**
 * Document lifecycle operations for Phase 7.
 *
 * Everything that moves a document through review, amendment and finalisation lives here, so
 * routes stay thin and no React component ever writes a lifecycle field.
 *
 * Three things this file deliberately does NOT do.
 *
 * **It does not let an agent approve.** ClearTrade already separates duties: the enums are
 * `agent_reviewed` and `exporter_approved`, and the permission matrix records
 * `document.approve: { agent: 'none' }` with the note "Cannot impersonate exporter — hard no,
 * not a policy toggle". Phase 7 fills in the agent half, which was declared and never
 * implemented; it does not collapse the two halves together.
 *
 * **It does not create a second lifecycle.** The four independent dimensions on `Document`
 * (generation / review / approval / filing) remain authoritative, and versioning stays on
 * `(deal_id, doc_type, version)` plus `is_current_version`. No parallel version table.
 *
 * **It does not claim external authority.** A ClearTrade approval is an internal approval. See
 * `documentAuthorityNote()` — a reviewed shipping bill draft is not filed, an approved
 * COO draft is not chamber-certified, and a generated insurance declaration is not a policy.
 */

import { ApprovalStatus, DocType, GenerationStatus, ReviewStatus, type Document } from '@prisma/client';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { getConfig } from '@/lib/config';
import {
  buildDocumentContext, documentReadiness,
  type DocumentGenerationContext, type DocumentReadiness,
} from '@/lib/document-data';
import { compareSnapshotToCurrent, driftFieldNames, type SnapshotDrift } from '@/lib/document-drift';
import {
  buildDocumentModel, preflightPdfGlyphs, type GlyphIssue,
} from '@/lib/document-generation';
import { BRAND_NAME, auditIdFor } from '@/lib/document-rendering';
import { freshVersionStatuses, loadDealScoped, loadDocumentScoped } from '@/lib/documents';
import { forbidden, notFound, prerequisitesNotMet, validationError } from '@/lib/errors';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import type { Blocker, Principal } from '@/types';

/**
 * The artifact an approval binds to.
 *
 * PDF where one exists: it is the fixed-layout rendering a reviewer actually reads and a bank
 * or CHA receives. DOCX is an editable convenience and must never become authoritative merely
 * by existing — an unreviewed DOCX generated after a PDF would otherwise silently inherit the
 * approval. HTML is preview only.
 *
 * The rule is enforced by binding approval to `Document.checksum`, which
 * `renderDocumentArtifact` only ever sets from a non-draft PDF (or, where PDF is impossible,
 * the first non-draft format rendered — recorded on the row so it is never ambiguous).
 */
export const AUTHORITATIVE_FORMAT_ORDER = ['pdf', 'docx'] as const;

/**
 * How a ClearTrade approval should be described for each document type.
 *
 * Wording is a safety feature here, not decoration. "Approved" next to a shipping bill draft
 * reads as "filed and accepted by customs" to anyone who has not read the schema, and
 * ClearTrade has no ICEGATE integration, no chamber relationship and no insurer API.
 */
export function documentAuthorityNote(docType: DocType): { approvalMeans: string; notThis: string } | null {
  switch (docType) {
    case DocType.shipping_bill_draft:
      return {
        approvalMeans: 'Internal approval of a draft, ready to hand to your CHA.',
        notThis: 'Not filed with ICEGATE, not customs-accepted, and carries no shipping bill acknowledgement.',
      };
    case DocType.COO_draft:
      return {
        approvalMeans: 'ClearTrade draft reviewed and approved internally.',
        notThis: 'Not certified by a Chamber of Commerce. No certification reference has been issued.',
      };
    case DocType.insurance_declaration:
      return {
        approvalMeans: 'A declaration of the cover recorded against this deal.',
        notThis: 'Not a policy or certificate issued by an insurer — the insurer\'s own document is the cover.',
      };
    case DocType.declaration:
      return {
        approvalMeans: 'Exporter declaration approved internally.',
        notThis: 'Not lodged with any authority.',
      };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export interface DocumentVersionView {
  id: string;
  version: number;
  is_current_version: boolean;
  generation_status: GenerationStatus;
  review_status: ReviewStatus;
  approval_status: ApprovalStatus;
  filing_status: string;
  generation_error: string | null;
  amendment_reason: string | null;
  amended_from_version: number | null;
  changes_requested_reason: string | null;
  rejection_reason: string | null;
  checksum: string | null;
  input_snapshot_id: string | null;
  content_hash: string | null;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  approved_by: string | null;
  approved_at: Date | null;
  approved_version: number | null;
  approved_checksum: string | null;
  created_at: Date;
  artifacts: {
    id: string; format: string; file_name: string; mime_type: string;
    file_size_bytes: number; checksum: string; content_hash: string;
    engine: string; generated_at: Date;
  }[];
}

function toVersionView(row: Awaited<ReturnType<typeof loadVersions>>[number]): DocumentVersionView {
  return {
    id: row.id,
    version: row.version,
    is_current_version: row.is_current_version,
    generation_status: row.generation_status,
    review_status: row.review_status,
    approval_status: row.approval_status,
    filing_status: row.filing_status,
    generation_error: row.generation_error,
    amendment_reason: row.amendment_reason,
    amended_from_version: row.amended_from_version,
    changes_requested_reason: row.changes_requested_reason,
    rejection_reason: row.rejection_reason,
    checksum: row.checksum,
    input_snapshot_id: row.input_snapshot_id,
    content_hash: row.input_snapshot?.content_hash ?? null,
    reviewed_by: row.reviewer?.name ?? null,
    reviewed_at: row.reviewed_at,
    approved_by: row.approver?.name ?? null,
    approved_at: row.approved_at,
    approved_version: row.approved_version,
    approved_checksum: row.approved_checksum,
    created_at: row.created_at,
    artifacts: row.artifacts.map((a) => ({
      id: a.id, format: a.format, file_name: a.file_name, mime_type: a.mime_type,
      file_size_bytes: a.file_size_bytes, checksum: a.checksum, content_hash: a.content_hash,
      engine: `${a.engine_name}@${a.engine_version}`, generated_at: a.generated_at,
    })),
  };
}

function loadVersions(dealId: string, docType?: DocType) {
  return prisma.document.findMany({
    where: { deal_id: dealId, ...(docType ? { doc_type: docType } : {}) },
    orderBy: [{ doc_type: 'asc' }, { version: 'desc' }],
    include: {
      artifacts: { orderBy: { format: 'asc' } },
      reviewer: { select: { name: true } },
      approver: { select: { name: true } },
      input_snapshot: { select: { content_hash: true } },
    },
  });
}

export interface DocumentWorkspaceRow {
  doc_type: DocType;
  label: string;
  approval_required: boolean;
  filing_applicable: boolean;
  readiness: DocumentReadiness;
  current: DocumentVersionView | null;
  history: DocumentVersionView[];
  authority: ReturnType<typeof documentAuthorityNote>;
}

/**
 * Everything the agent workspace shows, in one query pass.
 *
 * The readiness side is computed from the CURRENT canonical data, and the version side from
 * the stored rows. Both are shown together because "this is blocked" and "this needs review"
 * are the same decision for an agent working a queue.
 */
export async function documentWorkspace(
  principal: Principal,
  dealId: string,
): Promise<{ rows: DocumentWorkspaceRow[] }> {
  await loadDealScoped(principal, dealId);

  const [registry, context, versions] = await Promise.all([
    getConfig('documents.registry'),
    buildDocumentContext(principal, dealId, DocType.CI),
    loadVersions(dealId),
  ]);

  const byType = new Map<string, typeof versions>();
  for (const row of versions) {
    const list = byType.get(row.doc_type) ?? [];
    list.push(row);
    byType.set(row.doc_type, list);
  }

  const rows = registry.map((entry) => {
    const docType = entry.doc_type as DocType;
    const all = (byType.get(docType) ?? []).map(toVersionView);
    return {
      doc_type: docType,
      label: entry.label,
      approval_required: entry.approval_required,
      filing_applicable: entry.filing_applicable,
      readiness: documentReadiness({ ...context, doc_type: docType }, docType),
      current: all.find((v) => v.is_current_version) ?? null,
      history: all,
      authority: documentAuthorityNote(docType),
    };
  });

  return { rows };
}

export interface DocumentDetailView {
  document: DocumentVersionView;
  doc_type: DocType;
  label: string;
  deal_id: string;
  exporter_name: string;
  history: DocumentVersionView[];
  /** Readiness of the CURRENT canonical data, which may differ from the frozen snapshot. */
  currentReadiness: DocumentReadiness;
  /** Readiness as evaluated against the snapshot this version was built from. */
  snapshotReadiness: DocumentReadiness | null;
  drift: SnapshotDrift | null;
  glyphIssues: GlyphIssue[];
  authority: ReturnType<typeof documentAuthorityNote>;
  approvalBlockers: Blocker[];
}

/** One document version, with everything a reviewer needs to judge it. */
export async function documentDetail(
  principal: Principal,
  dealId: string,
  documentId: string,
): Promise<DocumentDetailView> {
  const { deal, document } = await loadDocumentScoped(principal, dealId, documentId);

  const [registry, versions, currentContext, dealRow] = await Promise.all([
    getConfig('documents.registry'),
    loadVersions(dealId, document.doc_type),
    buildDocumentContext(principal, dealId, document.doc_type),
    prisma.deal.findUniqueOrThrow({ where: { id: dealId }, select: { exporter_org: { select: { display_name: true } } } }),
  ]);

  const row = versions.find((v) => v.id === documentId);
  if (!row) throw notFound('That document is not available.');

  const frozen = row.input_snapshot_id
    ? ((await prisma.documentInputSnapshot.findUnique({ where: { id: row.input_snapshot_id } }))
        ?.context as unknown as DocumentGenerationContext | undefined) ?? null
    : null;

  const snapshotReadiness = frozen ? documentReadiness(frozen, document.doc_type) : null;
  const drift = frozen ? compareSnapshotToCurrent(frozen, currentContext, document.doc_type) : null;

  // Glyph issues are reported from the FROZEN input, because that is what the artifact was
  // drawn from — recomputing from live data would report a problem the stored PDF does not have.
  const glyphIssues = frozen
    ? preflightPdfGlyphs(buildDocumentModel(document.doc_type, frozen, {
        brand_name: BRAND_NAME, generated_at: row.created_at,
        audit_id: auditIdFor(document, row.input_snapshot?.content_hash ?? ''), draft: false,
      }, row.input_snapshot?.content_hash ?? ''))
    : [];

  const entry = registry.find((r) => r.doc_type === document.doc_type);

  return {
    document: toVersionView(row),
    doc_type: document.doc_type,
    label: entry?.label ?? document.doc_type,
    deal_id: dealId,
    exporter_name: dealRow.exporter_org.display_name,
    history: versions.map(toVersionView),
    currentReadiness: documentReadiness(currentContext, document.doc_type),
    snapshotReadiness,
    drift,
    glyphIssues,
    authority: documentAuthorityNote(document.doc_type),
    approvalBlockers: collectApprovalBlockers({
      dealId, document: row, snapshotReadiness, glyphIssues,
      exporterOrgId: deal.exporter_org_id,
    }),
  };
}

// ---------------------------------------------------------------------------
// The approval gate
// ---------------------------------------------------------------------------

type ApprovalCandidate = Awaited<ReturnType<typeof loadVersions>>[number];

/**
 * Everything standing between a document and a valid approval.
 *
 * Generation succeeding is not enough. An approval asserts that a specific artifact, built
 * from a specific frozen input, was checked — so each condition below is one way that claim
 * could be false.
 */
export function collectApprovalBlockers(args: {
  dealId: string;
  document: ApprovalCandidate;
  snapshotReadiness: DocumentReadiness | null;
  glyphIssues: GlyphIssue[];
  exporterOrgId: string;
}): Blocker[] {
  const { dealId, document, snapshotReadiness, glyphIssues } = args;
  const blockers: Blocker[] = [];
  const link = `/agent/deals/${dealId}/documents/${document.id}`;
  const add = (reason: string) => blockers.push({ object_type: 'document', object_id: document.id, reason, deep_link: link });

  if (!document.is_current_version) add('This version has been superseded. Only the current version can be approved.');
  if (document.generation_status !== GenerationStatus.generated) add('This version has not been generated yet.');
  if (!document.input_snapshot_id) add('This version has no frozen input snapshot, so what it was built from cannot be established.');

  const authoritative = AUTHORITATIVE_FORMAT_ORDER
    .map((format) => document.artifacts.find((a) => a.format === format))
    .find(Boolean);
  if (!authoritative) {
    add('No authoritative artifact exists for this version. Generate the PDF before approving.');
  } else {
    // The approval binds to `Document.checksum`. If the row and the artifact disagree, the
    // reviewer is not looking at the file the approval would record.
    if (document.checksum !== authoritative.checksum) {
      add('The stored file does not match the checksum recorded on this version. Regenerate before approving.');
    }
    if (document.input_snapshot_id && authoritative.input_snapshot_id !== document.input_snapshot_id) {
      add('The stored file was rendered from a different snapshot than this version records.');
    }
  }

  if (snapshotReadiness && snapshotReadiness.status !== 'ready') {
    for (const issue of [...snapshotReadiness.invalid, ...snapshotReadiness.missing]) {
      add(`${issue.label}: ${issue.detail ?? issue.condition ?? 'missing from the frozen input'}`);
    }
  }

  // Fail closed on a PDF whose text the font cannot represent. Approving it would put question
  // marks where a buyer's legal name should be.
  if (glyphIssues.length > 0 && authoritative?.format === 'pdf') {
    add(
      `The PDF cannot be approved: ${glyphIssues.map((i) => i.label).join(', ')} contain characters ` +
      'the PDF font cannot render faithfully. Use the DOCX output or transliterate the values.',
    );
  }

  return blockers;
}

/**
 * The gate the exporter approval route calls before recording an approval.
 *
 * Deliberately reusable rather than inlined: the agent workspace shows the same blockers, so
 * an exporter is never presented with an Approve button that the server would then refuse.
 */
export async function assertDocumentApprovable(
  principal: Principal,
  dealId: string,
  documentId: string,
): Promise<void> {
  const { deal, document } = await loadDocumentScoped(principal, dealId, documentId);
  const versions = await loadVersions(dealId, document.doc_type);
  const row = versions.find((v) => v.id === documentId);
  if (!row) throw notFound('That document is not available.');

  const frozen = row.input_snapshot_id
    ? ((await prisma.documentInputSnapshot.findUnique({ where: { id: row.input_snapshot_id } }))
        ?.context as unknown as DocumentGenerationContext | undefined) ?? null
    : null;

  const snapshotReadiness = frozen ? documentReadiness(frozen, document.doc_type) : null;
  const glyphIssues = frozen
    ? preflightPdfGlyphs(buildDocumentModel(document.doc_type, frozen, {
        brand_name: BRAND_NAME, generated_at: row.created_at,
        audit_id: auditIdFor(document, row.input_snapshot?.content_hash ?? ''), draft: false,
      }, row.input_snapshot?.content_hash ?? ''))
    : [];

  const blockers = collectApprovalBlockers({
    dealId, document: row, snapshotReadiness, glyphIssues, exporterOrgId: deal.exporter_org_id,
  });
  if (blockers.length > 0) {
    throw prerequisitesNotMet(blockers, 'This document cannot be approved yet.');
  }
}

// ---------------------------------------------------------------------------
// Agent review
// ---------------------------------------------------------------------------

/**
 * The agent's half of the review split.
 *
 * `agent_reviewed` says an agent has checked the generated document and considers it fit to
 * put in front of the exporter. It is NOT an approval and never sets `approval_status` — that
 * remains the exporter's act, which is the separation the permission matrix already encodes.
 */
export async function agentReviewDocument(input: {
  actor: Principal;
  dealId: string;
  documentId: string;
  outcome: 'reviewed' | 'changes_needed';
  note?: string;
  correlationId: string;
}): Promise<Document> {
  const { deal, document } = await loadDocumentScoped(input.actor, input.dealId, input.documentId);
  // Reviewing is part of producing the document, which is what `document.generate` grants.
  // Reusing it rather than inventing a `document.review` capability keeps one answer to
  // "who works on documents for this exporter".
  assertCan(input.actor, 'document.generate');

  if (!document.is_current_version) {
    throw forbidden('This version has been superseded. Only the current version can be reviewed.');
  }
  if (document.generation_status !== GenerationStatus.generated) {
    throw validationError(
      [{ field: 'document', code: 'not_generated', message: 'Generate this document before reviewing it.' }],
      'There is nothing to review yet.',
    );
  }
  if (document.approval_status === ApprovalStatus.exporter_approved) {
    throw validationError(
      [{ field: 'document', code: 'already_approved', message: 'This version is already approved. Create an amendment instead.' }],
      'This version is already approved.',
    );
  }

  const note = input.note?.trim();
  if (input.outcome === 'changes_needed' && !note) {
    throw validationError([{ field: 'note', code: 'required', message: 'Say what needs changing.' }]);
  }

  const reviewed = await prisma.$transaction(async (tx) => {
    const row = await tx.document.update({
      where: { id: document.id },
      data: {
        review_status: input.outcome === 'reviewed' ? ReviewStatus.agent_reviewed : ReviewStatus.changes_requested,
        reviewed_by_id: input.actor.id,
        reviewed_at: new Date(),
      },
    });

    // Internal, agent-only, and never printed on the document. Reuses the existing
    // InternalNote model — which already supports `scope_type: document` — rather than adding
    // a note architecture for one surface.
    if (note) {
      await tx.internalNote.create({
        data: {
          scope_type: 'document', scope_id: document.id, deal_id: input.dealId,
          author_user_id: input.actor.id, body: note,
        },
      });
    }

    await writeAuditEvent({
      db: tx,
      actor: input.actor,
      action: input.outcome === 'reviewed' ? AUDIT_ACTIONS.approve : AUDIT_ACTIONS.request_changes,
      object_type: 'document',
      object_id: row.id,
      exporter_org_id: deal.exporter_org_id,
      after_summary: {
        deal_id: input.dealId, doc_type: row.doc_type, version: row.version,
        review_status: row.review_status,
        // Identifiers and hashes, never document content or the note body.
        checksum: row.checksum, input_snapshot_id: row.input_snapshot_id,
        note_recorded: Boolean(note),
      },
      correlation_id: input.correlationId,
    });

    return row;
  });

  return reviewed;
}

// ---------------------------------------------------------------------------
// Amendments
// ---------------------------------------------------------------------------

/**
 * Create the next version of a document.
 *
 * The lifecycle rule made concrete: an approved or generated version is never mutated, so a
 * correction is a NEW row at `version + 1` with its own snapshot, its own artifacts and its
 * own review. The prior row keeps everything it had and simply stops being current.
 *
 * A reason is required once a prior version has been generated. A silent amendment leaves
 * nobody able to answer "why does this deal have three commercial invoices?" six months later.
 *
 * Concurrency: `is_current_version` is flipped and the new row inserted in one transaction,
 * and a partial unique index allows only one current row per (deal, doc_type) — so two
 * simultaneous amendments cannot both succeed, and the loser retries rather than producing a
 * second current version.
 */
export async function createDocumentAmendment(input: {
  actor: Principal;
  dealId: string;
  documentId: string;
  reason: string;
  correlationId: string;
}): Promise<Document> {
  const { deal, document } = await loadDocumentScoped(input.actor, input.dealId, input.documentId);
  assertCan(input.actor, 'document.generate');

  if (!document.is_current_version) {
    throw forbidden('Amend the current version, not a superseded one.');
  }

  const reason = input.reason?.trim();
  const priorWasGenerated = document.generation_status === GenerationStatus.generated;
  if (priorWasGenerated && !reason) {
    throw validationError(
      [{ field: 'reason', code: 'required', message: 'Say why a new version is needed — this is the audit trail for the correction.' }],
      'An amendment needs a reason.',
    );
  }
  if (!priorWasGenerated) {
    throw validationError(
      [{ field: 'document', code: 'not_generated', message: 'This version has not been generated, so regenerate it rather than amending.' }],
      'Nothing to amend yet.',
    );
  }

  const registry = await getConfig('documents.registry');
  const entry = registry.find((r) => r.doc_type === document.doc_type);

  const created = await prisma.$transaction(async (tx) => {
    // Highest version wins, read inside the transaction — `version + 1` off a stale read would
    // collide with the (deal, doc_type, version) unique index.
    const latest = await tx.document.findFirst({
      where: { deal_id: input.dealId, doc_type: document.doc_type },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = (latest?.version ?? document.version) + 1;

    await tx.document.update({
      where: { id: document.id },
      data: { is_current_version: false },
    });

    const row = await tx.document.create({
      data: {
        deal_id: input.dealId,
        doc_type: document.doc_type,
        version: nextVersion,
        is_current_version: true,
        source: 'generated',
        // A new version starts unapproved and unreviewed. Inheriting either would mean an
        // approval covering content nobody has seen.
        ...freshVersionStatuses(entry?.approval_required ?? true, entry?.filing_applicable ?? false),
        amendment_reason: reason,
        amended_from_version: document.version,
        // Snapshot and artifacts are NOT copied. The next generation freezes current canonical
        // data, which is the entire point of amending.
        generated_from_snapshot_id: document.generated_from_snapshot_id,
      },
    });

    await writeAuditEvent({
      db: tx,
      actor: input.actor,
      action: AUDIT_ACTIONS.create,
      object_type: 'document',
      object_id: row.id,
      exporter_org_id: deal.exporter_org_id,
      before_summary: {
        superseded_document_id: document.id, superseded_version: document.version,
        superseded_approval_status: document.approval_status, superseded_checksum: document.checksum,
      },
      after_summary: {
        deal_id: input.dealId, doc_type: row.doc_type, version: row.version,
        amended_from_version: document.version, reason,
      },
      correlation_id: input.correlationId,
    });

    return row;
  });

  return created;
}

/**
 * Drift for one document version, as a standalone read.
 *
 * Used by the workspace to answer "has anything changed since this was generated?" without
 * loading the whole detail view.
 */
export async function documentSnapshotDrift(
  principal: Principal,
  dealId: string,
  documentId: string,
): Promise<SnapshotDrift | null> {
  const { document } = await loadDocumentScoped(principal, dealId, documentId);
  if (!document.input_snapshot_id) return null;

  const snapshot = await prisma.documentInputSnapshot.findUnique({ where: { id: document.input_snapshot_id } });
  if (!snapshot) return null;

  const current = await buildDocumentContext(principal, dealId, document.doc_type);
  return compareSnapshotToCurrent(
    snapshot.context as unknown as DocumentGenerationContext, current, document.doc_type,
  );
}

export { driftFieldNames };
