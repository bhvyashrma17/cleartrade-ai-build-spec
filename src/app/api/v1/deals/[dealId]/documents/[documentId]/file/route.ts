/**
 * POST /api/v1/deals/:dealId/documents/:documentId/file — AGT-06 "hand to CHA" / filing.
 *
 * Filing is the fourth, independent Document dimension (docs/07 §7.3, AGENTS.md "never
 * collapse the four"). This route touches `filing_status`, `filing_reference`, `filed_at`
 * and `filed_by_id` and NOTHING else — it cannot change generation, review or approval
 * status, so filing a document can never be mistaken for approving it.
 *
 * AC02 ("every external filing has owner, status, timestamp and reference") is why
 * `filed_by_id` and `filed_at` are written here rather than left to the audit log: the
 * audit trail records that an action happened, but the filing itself has to carry its own
 * accountable owner on the record an agent reads.
 */

import { FilingStatus, GenerationStatus } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { loadDocumentScoped } from '@/lib/documents';
import { errorResponse, forbidden, newCorrelationId, prerequisitesNotMet, single, validationError } from '@/lib/errors';
import { assertActionAllowed } from '@/lib/execution-plan';
import { loadChecklistForEnforcement } from '@/lib/execution-view';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { fileDocumentSchema, zodFieldErrors } from '@/lib/validators';

/**
 * Filing has its own small state machine. A document that was rejected by the authority
 * must go back through `ready` before it can be filed again — you cannot mark a rejected
 * filing "accepted" without re-filing it.
 */
const FILING_TRANSITIONS: Record<FilingStatus, FilingStatus[]> = {
  not_applicable: [FilingStatus.draft, FilingStatus.ready],
  draft: [FilingStatus.ready],
  ready: [FilingStatus.filed],
  filed: [FilingStatus.accepted, FilingStatus.rejected],
  accepted: [],
  rejected: [FilingStatus.ready],
};

export async function POST(request: NextRequest, ctx: { params: Promise<{ dealId: string; documentId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { dealId, documentId } = await ctx.params;
    const { deal, document } = await loadDocumentScoped(principal, dealId, documentId);
    assertCan(principal, 'document.mark_filed');
    if (principal.role.startsWith('exporter')) {
      throw forbidden('Filing with customs is handled by your ClearTrade agent and CHA.');
    }

    const body = await request.json().catch(() => null);
    const parsed = fileDocumentSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const input = parsed.data;

    const checklist = await loadChecklistForEnforcement(dealId);
    assertActionAllowed(checklist, 'document.file');

    if (!document.is_current_version) {
      throw forbidden('This version has been superseded. File the current version instead.');
    }
    // The checklist gate above is deal-wide ("is the CHA lane open?"). It cannot know
    // whether THIS document exists yet — and a document that never generated has no
    // content to file. Without this, a deal whose CHA gate is satisfied would happily
    // accept "mark ready to file" on a failed generation.
    if (document.generation_status !== GenerationStatus.generated) {
      throw prerequisitesNotMet(
        [
          {
            object_type: 'document',
            object_id: document.id,
            reason:
              document.generation_status === GenerationStatus.failed
                ? 'This document failed to generate. Retry generation before filing it.'
                : 'This document has not been generated yet, so there is nothing to file.',
            deep_link: `/agent/deals/${dealId}#documents`,
          },
        ],
        'This document cannot be filed until it has been generated.',
      );
    }
    const target = input.filing_status as FilingStatus;
    if (!FILING_TRANSITIONS[document.filing_status].includes(target)) {
      throw validationError(
        [
          {
            field: 'filing_status',
            code: 'invalid',
            message: `A document at "${document.filing_status}" cannot move to "${target}".`,
          },
        ],
        'That filing transition is not allowed.',
      );
    }
    // A filed/accepted document must carry the authority's reference — that is the
    // "reference/evidence where available" half of AC02, and for a real filing it is
    // always available.
    if ((target === FilingStatus.filed || target === FilingStatus.accepted) && !input.filing_reference && !document.filing_reference) {
      throw validationError(
        [{ field: 'filing_reference', code: 'required', message: 'Enter the reference the authority issued.' }],
        'A filing needs its authority reference recorded.',
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.document.update({
        where: { id: document.id },
        data: {
          filing_status: target,
          ...(input.filing_reference ? { filing_reference: input.filing_reference } : {}),
          ...(target === FilingStatus.filed ? { filed_at: new Date(), filed_by_id: principal.id } : {}),
          ...(target === FilingStatus.rejected ? { rejection_reason: input.note ?? 'Rejected by the filing authority.' } : {}),
        },
      });

      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.file,
        object_type: 'document',
        object_id: document.id,
        exporter_org_id: deal.exporter_org_id,
        before_summary: { filing_status: document.filing_status, filing_reference: document.filing_reference },
        after_summary: { filing_status: row.filing_status, filing_reference: row.filing_reference, filed_by: principal.id },
        correlation_id: correlationId,
      });

      return row;
    });

    return NextResponse.json(single(updated), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
