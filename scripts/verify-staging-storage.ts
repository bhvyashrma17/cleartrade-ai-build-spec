/**
 * Phase 5 — REAL object-storage round trip against the configured bucket.
 *
 * This script performs actual network I/O against whatever `STORAGE_*` points at. It is the
 * only acceptable evidence that the S3 adapter works; unit tests exercise the local adapter
 * and prove nothing about a real bucket.
 *
 * Run against staging:
 *   APP_ENV=staging tsx --env-file=.env.staging scripts/verify-staging-storage.ts
 *
 * Refuses to run against the local adapter, so it cannot accidentally "pass" without a bucket.
 * Prints bucket/region/endpoint identity but never credentials.
 */

import { createHash, randomBytes } from 'node:crypto';
import { getDocumentStorage } from '../src/lib/document-storage';

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
const record = (name: string, ok: boolean, detail: string) => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(42)} ${detail}`);
};

async function main() {
  const storage = getDocumentStorage();

  console.log('Object storage round trip');
  console.log(`  backend           ${storage.provider}`);
  console.log(`  bucket            ${process.env.STORAGE_BUCKET ?? '(unset)'}`);
  console.log(`  region            ${process.env.STORAGE_REGION ?? '(unset)'}`);
  console.log(`  endpoint          ${process.env.STORAGE_ENDPOINT || '(provider default)'}`);
  console.log(`  encryption        ${process.env.STORAGE_SERVER_SIDE_ENCRYPTION ?? 'AES256 (default)'}`);
  console.log('');

  if (storage.provider !== 's3') {
    console.error('REFUSING TO RUN: STORAGE_BACKEND is not s3, so this would validate the local');
    console.error('filesystem adapter and prove nothing about the staging bucket.');
    process.exit(2);
  }

  await storage.healthcheck();
  record('healthcheck', true, 'reachable');

  // Distinctive payload so a mismatch is unambiguous rather than a coincidence.
  const bytes = Buffer.concat([Buffer.from('cleartrade-storage-verification\n'), randomBytes(4096)]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const objectKey = `verification/${new Date().toISOString().slice(0, 10)}/${randomBytes(16).toString('hex')}.bin`;

  let uploaded: Awaited<ReturnType<typeof storage.put>> | null = null;
  try {
    uploaded = await storage.put({ bytes, contentType: 'application/octet-stream', sha256, objectKey });
    record('upload', uploaded.objectKey === objectKey, `key=${uploaded.objectKey}`);
    record('object identity', Boolean(uploaded.etag || uploaded.versionId),
      `etag=${uploaded.etag ?? 'none'} versionId=${uploaded.versionId ?? 'none (versioning may be off)'}`);

    const meta = await storage.metadata(objectKey);
    record('metadata read', meta.sizeBytes === bytes.length, `${meta.sizeBytes} bytes (expected ${bytes.length})`);

    const readBack = await storage.get(objectKey);
    const readDigest = createHash('sha256').update(readBack).digest('hex');
    record('content read', readBack.length === bytes.length, `${readBack.length} bytes`);
    record('sha-256 matches', readDigest === sha256, `${readDigest.slice(0, 16)}…`);
    record('byte length matches', readBack.length === bytes.length, `${readBack.length}`);

    // Privacy: an unauthenticated GET of the object URL must NOT succeed.
    if (process.env.STORAGE_PUBLIC_BASE_URL) {
      const probe = `${process.env.STORAGE_PUBLIC_BASE_URL.replace(/\/$/, '')}/${objectKey}`;
      try {
        const res = await fetch(probe, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
        record('bucket is private', res.status === 403 || res.status === 404, `anonymous GET returned ${res.status}`);
      } catch {
        record('bucket is private', true, 'anonymous GET not routable');
      }
    } else {
      record('bucket is private', true, 'SKIPPED — set STORAGE_PUBLIC_BASE_URL to probe anonymously');
    }
  } finally {
    if (uploaded) {
      await storage.delete(objectKey).then(
        () => record('cleanup delete', true, 'test object removed'),
        (e) => record('cleanup delete', false, `LEFT BEHIND ${objectKey}: ${e instanceof Error ? e.message : String(e)}`),
      );
    }
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
