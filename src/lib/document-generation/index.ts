/**
 * Document generation engine selection — the single place that decides which implementation
 * runs, mirroring `src/lib/discovery/index.ts`.
 *
 * `mock` remains the default. Selecting `legacy` is explicit and per-environment: nothing here
 * infers it from NODE_ENV or from the presence of a dependency, so a deployment cannot acquire
 * a real renderer by accident. An unrecognised value fails loudly rather than falling back —
 * a typo in `DOCUMENT_ENGINE` should not silently produce plain-text "documents".
 */

import type { DocumentGenerationEngine } from './engine';
import { LegacyDocumentEngine } from './legacy';
import { MockDocumentEngine } from './mock-engine';

export type {
  DocumentGenerationEngine, DocumentOutputFormat,
  DocumentRenderMetadata, DocumentRenderRequest, DocumentRenderResult,
} from './engine';
export { UnsupportedDocumentError } from './engine';
export { MockDocumentEngine, renderDocumentText } from './mock-engine';
export { LegacyDocumentEngine } from './legacy';
export {
  UnrenderableTextError, buildDocumentModel, isPdfRenderable, preflightPdfGlyphs,
  unrenderableCharacters, type GlyphIssue,
} from './legacy';
export {
  ALL_FORMATS, DOCUMENT_FORMAT_SUPPORT, FILE_EXTENSIONS, MIME_TYPES, supportsFormat,
} from './legacy/capabilities';

export const DOCUMENT_ENGINE_NAMES = ['mock', 'legacy'] as const;
export type DocumentEngineName = (typeof DOCUMENT_ENGINE_NAMES)[number];

let cached: DocumentGenerationEngine | null = null;

export function getDocumentGenerationEngine(
  env: NodeJS.ProcessEnv = process.env,
): DocumentGenerationEngine {
  if (cached) return cached;

  const selected = env.DOCUMENT_ENGINE ?? 'mock';
  switch (selected) {
    case 'legacy':
      cached = new LegacyDocumentEngine();
      return cached;
    case 'mock':
      cached = new MockDocumentEngine();
      return cached;
    default:
      throw new Error(
        `Unknown DOCUMENT_ENGINE "${selected}". Valid values: ${DOCUMENT_ENGINE_NAMES.join(', ')}.`,
      );
  }
}

/** Test seam — lets a suite inject a fake without going through the environment. */
export function setDocumentGenerationEngine(engine: DocumentGenerationEngine | null) {
  cached = engine;
}
