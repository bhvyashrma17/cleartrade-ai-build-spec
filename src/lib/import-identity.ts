import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { UserRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';

const normalize = (value: string) => value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

function buyerRefSecrets(env: NodeJS.ProcessEnv = process.env) {
  const current = env.IMPORT_BUYER_REF_SECRET;
  if (!current || current.length < 32) throw new Error('IMPORT_BUYER_REF_SECRET must be at least 32 characters.');
  const version = env.IMPORT_BUYER_REF_KEY_VERSION?.trim() || 'v1';
  let previous: Record<string, string> = {};
  if (env.IMPORT_BUYER_REF_PREVIOUS_SECRETS) {
    try { previous = JSON.parse(env.IMPORT_BUYER_REF_PREVIOUS_SECRETS) as Record<string, string>; }
    catch { throw new Error('IMPORT_BUYER_REF_PREVIOUS_SECRETS must be a JSON object keyed by version.'); }
  }
  for (const [key, secret] of Object.entries(previous)) if (!key || secret.length < 32) throw new Error('Every previous buyer-ref secret must have a version and at least 32 characters.');
  return { current: { version, secret: current }, all: [{ version, secret: current }, ...Object.entries(previous).filter(([v]) => v !== version).map(([v, secret]) => ({ version: v, secret }))] };
}

export function buyerReferenceCandidates(rawIdentity: string, env: NodeJS.ProcessEnv = process.env) {
  const normalized = normalize(rawIdentity);
  const refs = buyerRefSecrets(env);
  return refs.all.map(({ version, secret }) => ({ version, value: `${version}:${createHmac('sha256', secret).update(normalized).digest('hex')}` }));
}

export function currentBuyerReference(rawIdentity: string, env: NodeJS.ProcessEnv = process.env) {
  return buyerReferenceCandidates(rawIdentity, env)[0];
}

function encryptionKeys(env: NodeJS.ProcessEnv = process.env) {
  const activeVersion = env.IMPORT_RAW_IDENTITY_KEY_VERSION?.trim() || 'v1';
  const encoded = env.IMPORT_RAW_IDENTITY_ENCRYPTION_KEY;
  if (!encoded) throw new Error('IMPORT_RAW_IDENTITY_ENCRYPTION_KEY is required.');
  const parse = (value: string) => {
    const decoded = Buffer.from(value, 'base64');
    return decoded.length === 32 ? decoded : createHash('sha256').update(value).digest();
  };
  let previous: Record<string, string> = {};
  if (env.IMPORT_RAW_IDENTITY_PREVIOUS_KEYS) {
    try { previous = JSON.parse(env.IMPORT_RAW_IDENTITY_PREVIOUS_KEYS) as Record<string, string>; }
    catch { throw new Error('IMPORT_RAW_IDENTITY_PREVIOUS_KEYS must be a JSON object keyed by version.'); }
  }
  return { activeVersion, keys: new Map([[activeVersion, parse(encoded)], ...Object.entries(previous).map(([v, key]) => [v, parse(key)] as const)]) };
}

export function encryptRawIdentity(value: string, env: NodeJS.ProcessEnv = process.env) {
  const { activeVersion, keys } = encryptionKeys(env);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keys.get(activeVersion)!, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { ciphertext, iv, auth_tag: cipher.getAuthTag(), key_version: activeVersion };
}

export function decryptRawIdentity(encrypted: { ciphertext: Uint8Array; iv: Uint8Array; auth_tag: Uint8Array; key_version: string }, env: NodeJS.ProcessEnv = process.env) {
  const key = encryptionKeys(env).keys.get(encrypted.key_version);
  if (!key) throw new Error(`No raw-identity decryption key configured for version ${encrypted.key_version}.`);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(encrypted.iv));
  decipher.setAuthTag(Buffer.from(encrypted.auth_tag));
  return Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext)), decipher.final()]).toString('utf8');
}

const PRIVILEGED_RAW_ROLES = new Set<UserRole>([UserRole.admin, UserRole.ops_supervisor]);

export async function readRawImportIdentity(args: { importRecordId: string; principal: Principal; reason: string }) {
  if (!PRIVILEGED_RAW_ROLES.has(args.principal.role)) throw new Error('Raw import identity access is restricted.');
  if (args.reason.trim().length < 10) throw new Error('A specific raw-data access reason is required.');
  return prisma.$transaction(async (tx) => {
    const row = await tx.rawImportIdentity.findUnique({ where: { import_record_id: args.importRecordId } });
    if (!row) return null;
    await tx.rawDataAccessEvent.create({ data: { import_record_id: args.importRecordId, actor_user_id: args.principal.id, action: 'privileged_read', reason: args.reason.trim() } });
    return decryptRawIdentity(row);
  });
}

export async function readRawImportIdentityForSystem(importRecordId: string, reason: string) {
  if (reason.trim().length < 10) throw new Error('A specific system raw-data access reason is required.');
  return prisma.$transaction(async (tx) => {
    const record = await tx.importRecord.findUnique({ where: { id: importRecordId }, select: { raw_consignee_string: true, raw_identity: true } });
    if (!record) return null;
    await tx.rawDataAccessEvent.create({ data: { import_record_id: importRecordId, action: 'system_read', reason: reason.trim() } });
    return record.raw_identity ? decryptRawIdentity(record.raw_identity) : record.raw_consignee_string;
  });
}
