/**
 * Document generation engine selection — the single place that decides which
 * implementation runs, mirroring `src/lib/discovery/index.ts`.
 *
 * Swapping in a real renderer means adding an implementation of
 * `DocumentGenerationEngine` and a case here. Nothing in the job handler, the routes, the
 * schema, or the UI names an engine, so none of them change.
 */

import type { DocumentGenerationEngine } from './engine';
import { MockDocumentEngine } from './mock-engine';

export type { DocumentGenerationEngine, DocumentGenerationInput, DocumentGenerationResult } from './engine';
export { MockDocumentEngine, renderDocumentText } from './mock-engine';
export { collectMissingSnapshotFields } from './requirements';

let cached: DocumentGenerationEngine | null = null;

export function getDocumentGenerationEngine(): DocumentGenerationEngine {
  if (cached) return cached;

  switch (process.env.DOCUMENT_ENGINE ?? 'mock') {
    case 'mock':
    default:
      cached = new MockDocumentEngine();
      return cached;
  }
}

/** Test seam — lets a suite inject a fake without going through the environment. */
export function setDocumentGenerationEngine(engine: DocumentGenerationEngine | null) {
  cached = engine;
}
