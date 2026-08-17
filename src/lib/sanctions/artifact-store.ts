/**
 * Durable raw sanctions artifact retention (Part D).
 *
 * Why a checksum is not enough: a SHA-256 proves two byte strings are identical, but it
 * does not retain the bytes. If an authority republishes a file, a checksum-only record
 * cannot demonstrate what we actually screened against — which is exactly the question an
 * audit asks. So the artifact itself is persisted to private object storage and referenced.
 *
 * Reuses the existing provider-neutral `DocumentStorage` (local | s3) rather than inventing
 * a second storage system. It does NOT go through `secureUpload()`, which is built for
 * user-supplied documents (MIME allow-list, extension check, malware scan) — none of which
 * apply to a 28 MB XML file fetched from a government endpoint, and whose allow-list would
 * reject it outright.
 */

import { createHash } from 'node:crypto';
import { randomBytes } from 'node:crypto';
import { SanctionsArtifactVerification } from '@prisma/client';
import { getDocumentStorage, type DocumentStorage, type StorageProvider } from '@/lib/document-storage';
import { isRealWorkflowEnvironment } from '@/lib/evidence-environment';

/** Loose env shape — see scheduler.ts. */
export type SanctionsEnv = Record<string, string | undefined>;

export interface ArtifactPersistInput {
  dataset: string;
  bytes: Buffer;
  sha256: string;
  media_type: string | null;
}

export interface PersistedArtifact {
  storage_provider: StorageProvider;
  object_key: string;
  object_version_id: string | null;
  byte_length: number;
  sha256: string;
  verification_status: SanctionsArtifactVerification;
  verification_detail: string;
  verified_at: Date | null;
}

/**
 * Object key (D2): dataset-scoped, year-partitioned, random suffix.
 *
 *   sanctions/<dataset>/<year>/<32 hex>.xml
 *
 * Carries no sanctions record names, no provider query credentials, and no secrets. The
 * random component is collision-resistant, and the layout suits immutable historical
 * retention (one prefix per dataset per year).
 */
export function sanctionsObjectKey(dataset: string, at: Date = new Date()): string {
  const safeDataset = dataset.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
  return `sanctions/${safeDataset}/${at.getUTCFullYear()}/${randomBytes(16).toString('hex')}.xml`;
}

/**
 * Whether durable retention is MANDATORY. In staging/production a failed persist must block
 * activation (D4); in development local storage is acceptable and is labelled honestly as
 * such rather than being presented as production-validated retention (D6).
 */
export function artifactRetentionRequired(env: SanctionsEnv = process.env): boolean {
  if (env.SANCTIONS_REQUIRE_ARTIFACT_RETENTION === 'true') return true;
  if (env.SANCTIONS_REQUIRE_ARTIFACT_RETENTION === 'false') return false;
  // Widening cast only: isRealWorkflowEnvironment reads string keys and never NODE_ENV
  // directly. Casting here keeps the verified evidence-isolation module's signature untouched.
  return isRealWorkflowEnvironment(env as NodeJS.ProcessEnv);
}

/**
 * Persist the artifact, then verify what was actually written (D5).
 *
 * Verification re-reads the object and recomputes the digest. Where an adapter cannot
 * support that, the status is `unsupported` — never `verified`. We do not claim an
 * integrity check that did not happen.
 */
export async function persistSanctionsArtifact(
  input: ArtifactPersistInput,
  storage: DocumentStorage = getDocumentStorage(),
): Promise<PersistedArtifact> {
  const objectKey = sanctionsObjectKey(input.dataset);

  const stored = await storage.put({
    bytes: input.bytes,
    contentType: input.media_type ?? 'application/xml',
    sha256: input.sha256,
    objectKey,
  });

  const base = {
    storage_provider: stored.provider,
    object_key: stored.objectKey,
    object_version_id: stored.versionId ?? null,
    byte_length: input.bytes.byteLength,
    sha256: input.sha256,
  };

  // --- Post-write integrity verification -----------------------------------
  try {
    const readBack = await storage.get(stored.objectKey);
    const digest = createHash('sha256').update(readBack).digest('hex');
    const lengthMatches = readBack.byteLength === input.bytes.byteLength;
    const digestMatches = digest === input.sha256;

    if (lengthMatches && digestMatches) {
      return {
        ...base,
        verification_status: SanctionsArtifactVerification.verified,
        verification_detail: `Re-read ${readBack.byteLength} bytes from ${stored.provider}; SHA-256 matched.`,
        verified_at: new Date(),
      };
    }
    return {
      ...base,
      verification_status: SanctionsArtifactVerification.mismatch,
      verification_detail: `Post-write mismatch — length ${readBack.byteLength} vs ${input.bytes.byteLength}, digest ${digest.slice(0, 12)}… vs ${input.sha256.slice(0, 12)}….`,
      verified_at: new Date(),
    };
  } catch (error) {
    // Read-back unsupported/unavailable. Reported honestly rather than assumed good.
    return {
      ...base,
      verification_status: SanctionsArtifactVerification.unsupported,
      verification_detail: `Post-write read-back unavailable: ${error instanceof Error ? error.message : String(error)}`,
      verified_at: null,
    };
  }
}

/** Verification outcomes that permit activation. A mismatch never does. */
export function verificationPermitsActivation(
  status: SanctionsArtifactVerification,
  required: boolean,
): { ok: boolean; reason: string } {
  if (status === SanctionsArtifactVerification.mismatch) {
    return { ok: false, reason: 'Retained artifact failed post-write integrity verification.' };
  }
  if (required && status !== SanctionsArtifactVerification.verified) {
    return {
      ok: false,
      reason: `Artifact retention is mandatory in this environment and verification returned "${status}" rather than "verified".`,
    };
  }
  return { ok: true, reason: '' };
}
