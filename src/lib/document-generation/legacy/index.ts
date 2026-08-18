/**
 * `LegacyDocumentEngine` — the real renderer, adapted from the legacy Export project.
 *
 * "Legacy" names its provenance, not its quality: the layout system, typography, section
 * ordering and DOCX table treatment come from that project. What did not come across is
 * everything that made it unusable as a library — `documentPdfService.ts` and its Prisma
 * queries, the `any`-typed template inputs, the Chromium dependency, the legacy tenant and
 * auth models, and the silent data repair at render time.
 *
 * The class is deliberately tiny. It takes a frozen request, builds a typed document model,
 * hands it to one of three renderers, and returns bytes. It cannot reach a database, cannot
 * allocate an invoice number, and cannot change a document's state — those are properties of
 * what it is not given, not rules it promises to follow.
 */

import { DocType } from '@prisma/client';
import {
  UnsupportedDocumentError,
  type DocumentGenerationEngine, type DocumentOutputFormat,
  type DocumentRenderRequest, type DocumentRenderResult,
} from '../engine';
import { buildDocumentModel, isSupportedDocType } from './adapters';
import { FILE_EXTENSIONS, MIME_TYPES, supportsFormat } from './capabilities';
import { renderDocx } from './docx';
import { renderHtml } from './html';
import { renderPdf } from './pdf';

export class LegacyDocumentEngine implements DocumentGenerationEngine {
  readonly name = 'legacy';
  /**
   * Bumped whenever a change would alter rendered output. Every artifact records it, so a
   * stored file is never silently attributed to a renderer that would produce something else.
   */
  readonly version = '1.0.0';

  supports(docType: string, format: DocumentOutputFormat): boolean {
    return isSupportedDocType(docType) && supportsFormat(docType, format);
  }

  async render(request: DocumentRenderRequest): Promise<DocumentRenderResult> {
    if (!this.supports(request.doc_type, request.format)) {
      throw new UnsupportedDocumentError(request.doc_type, request.format, this.name);
    }

    const model = buildDocumentModel(
      request.doc_type as DocType,
      request.context,
      request.metadata,
      request.content_hash,
    );

    const bytes =
      request.format === 'pdf' ? await renderPdf(model)
      : request.format === 'docx' ? await renderDocx(model)
      : renderHtml(model);

    return {
      bytes,
      mime_type: MIME_TYPES[request.format],
      file_extension: FILE_EXTENSIONS[request.format],
      provenance: {
        engine: this.name,
        engine_version: this.version,
        doc_type: request.doc_type,
        format: request.format,
        // The frozen input this came from — the artifact's whole claim to reproducibility.
        snapshot_id: request.snapshot_id,
        content_hash: request.content_hash,
        builder_version: request.context.builder_version,
        draft: request.metadata.draft,
      },
    };
  }
}

export { DOCUMENT_FORMAT_SUPPORT, ALL_FORMATS, MIME_TYPES, FILE_EXTENSIONS, supportsFormat } from './capabilities';
export { buildDocumentModel, isSupportedDocType } from './adapters';
