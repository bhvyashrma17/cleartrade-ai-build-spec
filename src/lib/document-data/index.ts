/**
 * Canonical document data — the Phase 5 foundation Phase 6's renderers will consume.
 *
 * The one-way flow this package exists to enforce:
 *
 *     canonical data -> buildDocumentContext -> documentReadiness -> freezeDocumentInput
 *                    -> DocumentGenerationEngine -> artifact
 *
 * A renderer receives `DocumentGenerationContext` and nothing else. It has no Prisma client,
 * no deal id to look up, and no way to fill a gap by querying — which is the coupling that
 * made the legacy `documentPdfService.ts` impossible to change safely.
 */

export { buildDocumentContext, hashContext } from './context';
export { checkConsistency, type ConsistencyFinding } from './consistency';
export {
  allDocumentReadiness, documentReadiness, READINESS_DOC_TYPES,
  type CanonicalOwner, type DocumentReadiness, type ReadinessIssue, type ReadinessStatusValue,
} from './readiness';
export {
  DocumentNotReadyError, freezeDocumentInput, readDocumentSnapshot, verifySnapshotIntegrity,
} from './snapshot';
export {
  deriveCif, deriveFob, incotermIncludes, money, shipmentPackageTotals, sumMoney,
} from './derive';
export {
  DOCUMENT_CONTEXT_BUILDER_VERSION,
  type ContextAddress, type ContextLocation, type ContextMoney,
  type DocumentGenerationContext,
} from './types';
