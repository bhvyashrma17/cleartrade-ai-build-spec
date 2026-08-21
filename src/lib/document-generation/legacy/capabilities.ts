/**
 * Which document types render to which formats.
 *
 * Verified against what actually exists, not assumed. The legacy project appeared to support
 * more than it did: `lib/docx/packing.ts` and `lib/docx/shipping-bill.ts` were 50-byte
 * re-export stubs, and the "PDF" path for several documents was a Chromium render that fell
 * back to a single-page pdf-lib routine which lost content past the fold.
 *
 * Here all three formats render the same `DocumentModel`, so support is uniform across the
 * twelve ClearTrade `DocType` values that have an adapter — and `other` supports nothing,
 * because it is the uploaded-document escape hatch and ClearTrade never generates one.
 */

import { DocType } from '@prisma/client';
import type { DocumentOutputFormat } from '../engine';

export const ALL_FORMATS: DocumentOutputFormat[] = ['pdf', 'docx', 'html'];

export const DOCUMENT_FORMAT_SUPPORT: Record<DocType, DocumentOutputFormat[]> = {
  [DocType.PI]: ALL_FORMATS,
  [DocType.CI]: ALL_FORMATS,
  [DocType.packing_list]: ALL_FORMATS,
  [DocType.shipping_bill_draft]: ALL_FORMATS,
  [DocType.COO_draft]: ALL_FORMATS,
  [DocType.declaration]: ALL_FORMATS,
  [DocType.insurance_declaration]: ALL_FORMATS,
  [DocType.shipping_instructions]: ALL_FORMATS,
  [DocType.vgm_declaration]: ALL_FORMATS,
  [DocType.bill_of_exchange]: ALL_FORMATS,
  [DocType.carrier_instructions]: ALL_FORMATS,
  [DocType.bank_collection_letter]: ALL_FORMATS,
  /// Uploaded documents are stored, never rendered. An empty list is the honest answer.
  [DocType.other]: [],
};

export const MIME_TYPES: Record<DocumentOutputFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  html: 'text/html; charset=utf-8',
};

export const FILE_EXTENSIONS: Record<DocumentOutputFormat, string> = {
  pdf: 'pdf', docx: 'docx', html: 'html',
};

export function supportsFormat(docType: string, format: DocumentOutputFormat): boolean {
  const formats = DOCUMENT_FORMAT_SUPPORT[docType as DocType];
  return Array.isArray(formats) && formats.includes(format);
}
