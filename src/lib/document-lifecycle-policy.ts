import { DocType } from '@prisma/client';

/** Safety-critical lifecycle policy for exporter-authored instructions/declarations. */
export const NEW_DOCUMENT_LIFECYCLE_MATRIX = {
  [DocType.shipping_instructions]: { agent_review_required: true, exporter_approval_required: true, filing_applicable: false },
  [DocType.vgm_declaration]: { agent_review_required: true, exporter_approval_required: true, filing_applicable: false },
  [DocType.bill_of_exchange]: { agent_review_required: true, exporter_approval_required: true, filing_applicable: false },
  [DocType.carrier_instructions]: { agent_review_required: true, exporter_approval_required: true, filing_applicable: false },
  [DocType.bank_collection_letter]: { agent_review_required: true, exporter_approval_required: true, filing_applicable: false },
} as const;

export function resolvedDocumentLifecyclePolicy(
  docType: DocType,
  configured: { approval_required: boolean; filing_applicable: boolean } | undefined,
): { agent_review_required: boolean; exporter_approval_required: boolean; filing_applicable: boolean } {
  if (docType in NEW_DOCUMENT_LIFECYCLE_MATRIX) {
    return NEW_DOCUMENT_LIFECYCLE_MATRIX[docType as keyof typeof NEW_DOCUMENT_LIFECYCLE_MATRIX];
  }
  return {
    agent_review_required: false,
    exporter_approval_required: configured?.approval_required ?? true,
    filing_applicable: configured?.filing_applicable ?? false,
  };
}
