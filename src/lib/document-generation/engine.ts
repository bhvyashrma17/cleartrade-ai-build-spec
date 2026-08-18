/**
 * Document generation engine — the seam between the product and whatever renders a document.
 *
 * The contract is deliberately narrow, and what it EXCLUDES is the point. An engine receives a
 * frozen, already-validated input and returns bytes. It has no Prisma client, no deal id to
 * look up, no way to allocate an invoice number, and no way to change a lifecycle state. That
 * is the architectural difference from the legacy `documentPdfService.ts`, which took an
 * invoice id and queried its own aggregate — coupling that made the schema unchangeable and
 * let templates read fields that did not exist.
 *
 * Phase 6 widened this in three ways:
 *   - the input carries the frozen `DocumentGenerationContext` (Phase 5), not a handful of
 *     deal-snapshot columns, so a renderer can see the exporter, buyer, ports and packages it
 *     actually needs;
 *   - the result is BYTES, since a PDF is not a string;
 *   - `format` is explicit and `supports()` is declared, because not every document type
 *     renders to every format and pretending otherwise produces empty files.
 */

import type { DocumentGenerationContext } from '@/lib/document-data';

export type DocumentOutputFormat = 'pdf' | 'docx' | 'html';

/**
 * Render-time metadata — true of the ACT of rendering, not of the export transaction.
 *
 * Kept separate from the canonical context on purpose. The legacy templates read
 * `invoice.brandName`, `invoice.documentTimestamp` and `invoice.auditId` off the invoice
 * record, which is how presentation concerns end up as columns on a commercial model. None of
 * these belong to the deal.
 */
export interface DocumentRenderMetadata {
  /** Always ClearTrade. No legacy application branding survives integration. */
  brand_name: string;
  /** When this artifact was produced. Explicit, so it is visible metadata rather than hidden nondeterminism. */
  generated_at: Date;
  /** Stable identifier for the artifact, derived from the document version and snapshot hash. */
  audit_id: string;
  /**
   * Whether this rendering is a draft.
   *
   * A draft is watermarked and states that it is not an issued document. It exists so a
   * preview can never be mistaken for something legally issued — the failure mode the phase
   * spec calls out around invoice numbering.
   */
  draft: boolean;
}

/** Everything a document is rendered FROM. Frozen: the caller has already validated it. */
export interface DocumentRenderRequest {
  doc_type: string;
  format: DocumentOutputFormat;
  /** Identity of the frozen input, so an artifact can be traced back to it. */
  snapshot_id: string;
  content_hash: string;
  version: number;
  /** The frozen canonical input, read back from `DocumentInputSnapshot` — never rebuilt live. */
  context: DocumentGenerationContext;
  metadata: DocumentRenderMetadata;
}

export interface DocumentRenderResult {
  bytes: Buffer;
  mime_type: string;
  file_extension: string;
  /** Recorded against the artifact so a stored file says what produced it. */
  provenance: Record<string, unknown>;
}

/** Thrown when a document type or format the engine does not support is requested. */
export class UnsupportedDocumentError extends Error {
  constructor(docType: string, format: string, engine: string) {
    super(`${engine} cannot render ${docType} as ${format}.`);
    this.name = 'UnsupportedDocumentError';
  }
}

export interface DocumentGenerationEngine {
  /** Stable identifier recorded on every artifact this engine produces. */
  readonly name: string;
  /**
   * Bumped whenever a change would alter rendered output. An artifact records it, so a stored
   * file is never silently attributed to a renderer that would produce something different.
   */
  readonly version: string;
  supports(docType: string, format: DocumentOutputFormat): boolean;
  render(request: DocumentRenderRequest): Promise<DocumentRenderResult>;
}
