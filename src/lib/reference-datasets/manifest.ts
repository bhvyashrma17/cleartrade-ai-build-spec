/**
 * `data/reference/manifest.json`: the reference files checked into the repository, each with its
 * sha256, and — for a text form of a publisher's file — the original it was made from (docs/36
 * §3.2). The import script reads a derived file's provenance from here, so the record of where a
 * release came from is reviewed with the file itself rather than typed on a command line.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { derivedSourceSchema, type DerivedSource } from './registry';

export const REFERENCE_FILES_DIR = 'data/reference';
export const REFERENCE_MANIFEST_PATH = `${REFERENCE_FILES_DIR}/manifest.json`;

export const referenceFileSchema = z.object({
  file: z.string().regex(/^[A-Za-z0-9._-]+$/),
  dataset_key: z.string().min(3),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().positive(),
  derived_from: derivedSourceSchema.nullable(),
  note: z.string().nullable(),
});
export type ReferenceFile = z.infer<typeof referenceFileSchema>;

export const referenceManifestSchema = z.object({
  schema_version: z.literal('reference-files-v1'),
  files: z.array(referenceFileSchema).min(1),
}).superRefine((manifest, context) => {
  const seen = new Set<string>();
  for (const [index, entry] of manifest.files.entries()) {
    if (seen.has(entry.file)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['files', index, 'file'], message: `${entry.file} is listed twice.` });
    seen.add(entry.file);
  }
});
export type ReferenceManifest = z.infer<typeof referenceManifestSchema>;

export function readReferenceManifest(root = process.cwd()): ReferenceManifest {
  const path = resolve(root, REFERENCE_MANIFEST_PATH);
  let body: unknown;
  try { body = JSON.parse(readFileSync(path, 'utf8')); } catch (error) { throw new Error(`Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`); }
  const parsed = referenceManifestSchema.safeParse(body);
  if (!parsed.success) throw new Error(`${path} is not a reference-files-v1 manifest: ${parsed.error.issues[0]?.path.join('.') ?? ''} ${parsed.error.issues[0]?.message ?? 'invalid'}.`);
  return parsed.data;
}

/** The manifest entry for these bytes, or null when the manifest does not list them. */
export function manifestEntryFor(manifest: ReferenceManifest, bytes: Buffer): ReferenceFile | null {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return manifest.files.find((entry) => entry.sha256 === sha256) ?? null;
}

/** Every listed file exists with the listed size and sha256. Returns the problems found. */
export function verifyReferenceFiles(manifest: ReferenceManifest, root = process.cwd()): string[] {
  const problems: string[] = [];
  for (const entry of manifest.files) {
    let bytes: Buffer;
    try { bytes = readFileSync(join(resolve(root, REFERENCE_FILES_DIR), entry.file)); } catch { problems.push(`${entry.file} is listed but missing.`); continue; }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== entry.bytes) problems.push(`${entry.file} is ${bytes.length} bytes, not ${entry.bytes}.`);
    if (sha256 !== entry.sha256) problems.push(`${entry.file} has sha256 ${sha256}, not ${entry.sha256}.`);
  }
  return problems;
}

export type { DerivedSource };
