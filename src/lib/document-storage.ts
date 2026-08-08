/**
 * Local-disk object storage for EXPORTER-UPLOADED documents.
 *
 * A generated document never needs this: it is deterministic (same doc_type + snapshot +
 * version always renders the same content), so the download route just re-renders it —
 * see `src/lib/document-generation/mock-engine.ts`. An uploaded file is arbitrary bytes
 * the exporter supplied, which cannot be re-derived, so it has to actually be stored.
 *
 * This writes to `.data/uploads/` on local disk, which is exactly what "local dev
 * environment" should mean for object storage — Postgres itself is local-only the same
 * way. A real deployment swaps this module for an S3/GCS adapter behind the same two
 * functions; nothing that calls `file_ref` needs to know which one is in use, matching
 * the design-system precedent set by `getDiscoveryEngine()` — the storage backend is a
 * seam, not a route-level decision.
 *
 * `file_ref` is a relative path under the storage root, never an absolute path or a
 * public URL — `readStoredFile` is the only way back to bytes, and every caller of it
 * goes through an authorization check first (docs/10 §1: file download is one of the two
 * most commonly missed checks).
 */

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve } from 'node:path';

const STORAGE_ROOT = resolve(process.cwd(), '.data', 'uploads');

export interface StoredFile {
  file_ref: string;
  checksum: string;
  size_bytes: number;
}

/** Writes an uploaded file's bytes and returns the reference + checksum to persist on Document. */
export async function saveUploadedFile(bytes: Buffer, originalName: string): Promise<StoredFile> {
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  const fileRef = join(randomBytes(12).toString('hex'), safeName || 'upload');
  const absolutePath = resolveWithinStorageRoot(fileRef);

  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);

  return { file_ref: fileRef, checksum, size_bytes: bytes.byteLength };
}

/** Reads back a previously stored file's bytes. Caller must have already authorized the request. */
export async function readStoredFile(fileRef: string): Promise<Buffer> {
  return readFile(resolveWithinStorageRoot(fileRef));
}

/**
 * `file_ref` is stored in the database and could in principle be tampered with before
 * reaching here — resolve it and refuse anything that would escape the storage root
 * (`../../etc/passwd`-style traversal), same discipline as validating any other
 * user-influenced path.
 */
function resolveWithinStorageRoot(fileRef: string): string {
  const absolutePath = resolve(STORAGE_ROOT, normalize(fileRef));
  if (!absolutePath.startsWith(STORAGE_ROOT + '/') && absolutePath !== STORAGE_ROOT) {
    throw new Error(`Refusing to resolve a file_ref outside the storage root: ${fileRef}`);
  }
  return absolutePath;
}
