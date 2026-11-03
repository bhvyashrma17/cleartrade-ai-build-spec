/**
 * Self-service password reset (R-39).
 *
 * - **Asking** never says whether an account exists: the route answers the same way for every
 *   address. A link goes only to an active account that has a password (Google or Apple accounts
 *   sign in there instead), at most three times an hour.
 * - **The link** carries a random 32-byte token. Only its SHA-256 is stored, so the database alone
 *   cannot be used to reset anyone's password. It works once, for 30 minutes, and asking again
 *   retires the earlier links.
 * - **Resetting** sets the new password, uses up every outstanding link for the account, and writes
 *   an audit event. The email goes through the configured provider directly, so the token is never
 *   stored in a notification; staging still redirects it like every other email.
 */
import { createHash, randomBytes } from 'node:crypto';
import { AuditSource } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getEmailProvider } from '@/lib/notification-delivery';
import { prisma } from '@/lib/prisma';

export const RESET_TOKEN_TTL_MINUTES = 30;
export const RESET_REQUESTS_PER_HOUR = 3;
export const RESET_REQUEST_ACCEPTED = 'If an account with a password uses that email, we have sent it a link to choose a new password. It works for 30 minutes.';

export const passwordResetRequestSchema = z.object({ email: z.string().trim().toLowerCase().email().max(320) });
export const passwordResetConfirmSchema = z.object({
  token: z.string().trim().min(20).max(200),
  password: z.string().min(8, 'Use at least 8 characters.').max(200),
});

export const hashResetToken = (token: string) => createHash('sha256').update(token).digest('hex');

export interface ResetDeps {
  db?: typeof prisma;
  now?: () => Date;
  send?: (message: { to: string; subject: string; text: string }) => Promise<unknown>;
  appUrl?: string;
}

/** Returns whether a link was sent; the caller must answer the same way either way. */
export async function requestPasswordReset(rawEmail: string, deps: ResetDeps = {}): Promise<{ sent: boolean }> {
  const db = deps.db ?? prisma;
  const now = (deps.now ?? (() => new Date()))();
  const email = rawEmail.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email }, select: { id: true, email: true, role: true, is_active: true, password_hash: true } });
  if (!user || !user.is_active || !user.password_hash) return { sent: false };
  const recent = await db.passwordResetToken.count({ where: { user_id: user.id, created_at: { gt: new Date(now.getTime() - 3_600_000) } } });
  if (recent >= RESET_REQUESTS_PER_HOUR) return { sent: false };

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + RESET_TOKEN_TTL_MINUTES * 60_000);
  await db.$transaction([
    db.passwordResetToken.updateMany({ where: { user_id: user.id, used_at: null }, data: { used_at: now } }),
    db.passwordResetToken.create({ data: { user_id: user.id, token_hash: hashResetToken(token), expires_at: expiresAt, created_at: now } }),
    db.auditEvent.create({ data: { actor_user_id: user.id, role: user.role, action: 'password_reset_requested', object_type: 'user', object_id: user.id, correlation_id: `password-reset:${hashResetToken(token).slice(0, 16)}`, source: AuditSource.api } }),
  ]);

  const base = (deps.appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const link = `${base}/reset-password?token=${encodeURIComponent(token)}`;
  const send = deps.send ?? ((message) => getEmailProvider().send(message));
  await send({
    to: user.email,
    subject: 'Choose a new ClearTrade password',
    text: [
      'Someone asked to reset the password for your ClearTrade account.',
      '',
      `Choose a new password here (the link works once, for ${RESET_TOKEN_TTL_MINUTES} minutes):`,
      link,
      '',
      'If it was not you, ignore this email: your password stays as it is.',
      '',
      'ClearTrade · Trade Flux AI Solutions LLP · hello@cleartrade.in',
    ].join('\n'),
  });
  return { sent: true };
}

export type ResetOutcome = { ok: true } | { ok: false; reason: 'invalid' | 'expired' };

export async function confirmPasswordReset(token: string, password: string, deps: ResetDeps = {}): Promise<ResetOutcome> {
  const db = deps.db ?? prisma;
  const now = (deps.now ?? (() => new Date()))();
  const row = await db.passwordResetToken.findUnique({
    where: { token_hash: hashResetToken(token.trim()) },
    select: { id: true, user_id: true, used_at: true, expires_at: true, user: { select: { is_active: true, role: true } } },
  });
  if (!row || row.used_at || !row.user.is_active) return { ok: false, reason: 'invalid' };
  if (row.expires_at.getTime() <= now.getTime()) return { ok: false, reason: 'expired' };

  // The same hashing as `hashPassword` in auth.ts, which this module cannot import (it loads next-auth).
  const passwordHash = await bcrypt.hash(password, 10);
  // The claim on this link is conditional on it still being unused, so two submissions of the same
  // link cannot both succeed.
  const claimed = await db.$transaction(async (tx) => {
    const claim = await tx.passwordResetToken.updateMany({ where: { id: row.id, used_at: null }, data: { used_at: now } });
    if (claim.count !== 1) return false;
    await tx.user.update({ where: { id: row.user_id }, data: { password_hash: passwordHash } });
    await tx.passwordResetToken.updateMany({ where: { user_id: row.user_id, used_at: null }, data: { used_at: now } });
    await tx.auditEvent.create({ data: { actor_user_id: row.user_id, role: row.user.role, action: 'password_reset', object_type: 'user', object_id: row.user_id, correlation_id: `password-reset:${row.id}`, source: AuditSource.api } });
    return true;
  });
  return claimed ? { ok: true } : { ok: false, reason: 'invalid' };
}
