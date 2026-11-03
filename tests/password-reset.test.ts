import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { UserRole } from '@prisma/client';
import { describe, expect, test } from 'vitest';
import { confirmPasswordReset, hashResetToken, requestPasswordReset, RESET_REQUESTS_PER_HOUR } from '../src/lib/password-reset';
import { prisma } from '../src/lib/prisma';

/** Self-service password reset (R-39). */
describe('password reset', () => {
  const sent: { to: string; subject: string; text: string }[] = [];
  const send = async (message: { to: string; subject: string; text: string }) => { sent.push(message); };
  const tokenFrom = (text: string) => decodeURIComponent(/token=([^\s]+)/.exec(text)![1]!);
  const makeUser = async (overrides: { is_active?: boolean; password?: string | null } = {}) => {
    const password = overrides.password === undefined ? 'old-password-1' : overrides.password;
    return prisma.user.create({ data: { email: `reset-${randomUUID()}@test.local`, name: 'Reset', role: UserRole.exporter_owner, is_active: overrides.is_active ?? true, password_hash: password ? await bcrypt.hash(password, 4) : null } });
  };

  test('a link goes only to an active account with a password; the token itself is never stored', async () => {
    const user = await makeUser();
    expect(await requestPasswordReset(user.email.toUpperCase(), { send, appUrl: 'https://www.cleartrade.in' })).toEqual({ sent: true });
    const message = sent.at(-1)!;
    expect(message.to).toBe(user.email);
    expect(message.text).toContain('https://www.cleartrade.in/reset-password?token=');
    const token = tokenFrom(message.text);
    const stored = await prisma.passwordResetToken.findMany({ where: { user_id: user.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.token_hash).toBe(hashResetToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);
    for (const other of [await makeUser({ is_active: false }), await makeUser({ password: null })]) {
      expect(await requestPasswordReset(other.email, { send })).toEqual({ sent: false });
    }
    expect(await requestPasswordReset(`nobody-${randomUUID()}@test.local`, { send })).toEqual({ sent: false });
  });

  test('the link sets the new password once; asking again retires earlier links; expired links fail', async () => {
    const user = await makeUser();
    await requestPasswordReset(user.email, { send });
    const first = tokenFrom(sent.at(-1)!.text);
    await requestPasswordReset(user.email, { send });
    const second = tokenFrom(sent.at(-1)!.text);
    expect(await confirmPasswordReset(first, 'new-password-1')).toEqual({ ok: false, reason: 'invalid' });
    expect(await confirmPasswordReset(second, 'new-password-1')).toEqual({ ok: true });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await bcrypt.compare('new-password-1', after.password_hash!)).toBe(true);
    expect(await confirmPasswordReset(second, 'another-password')).toEqual({ ok: false, reason: 'invalid' });
    expect(await prisma.auditEvent.count({ where: { object_id: user.id, action: 'password_reset' } })).toBe(1);

    const late = await makeUser();
    await requestPasswordReset(late.email, { send });
    const lateToken = tokenFrom(sent.at(-1)!.text);
    expect(await confirmPasswordReset(lateToken, 'new-password-2', { now: () => new Date(Date.now() + 31 * 60_000) })).toEqual({ ok: false, reason: 'expired' });
  });

  test(`at most ${RESET_REQUESTS_PER_HOUR} links an hour per account`, async () => {
    const user = await makeUser();
    const results = [];
    for (let i = 0; i < RESET_REQUESTS_PER_HOUR + 1; i += 1) results.push((await requestPasswordReset(user.email, { send })).sent);
    expect(results).toEqual([...Array(RESET_REQUESTS_PER_HOUR).fill(true), false]);
  });

  test('the routes, pages and login link exist, and the request route answers the same way for everyone', async () => {
    const { readFile } = await import('node:fs/promises');
    const route = await readFile('src/app/api/v1/password-reset/route.ts', 'utf8');
    expect(route).toContain('RESET_REQUEST_ACCEPTED');
    expect(route).toContain('status: 202');
    expect(route).not.toMatch(/sent\s*\?/);
    for (const file of ['src/app/(auth)/forgot-password/page.tsx', 'src/app/(auth)/reset-password/page.tsx', 'src/app/api/v1/password-reset/confirm/route.ts']) {
      await expect(readFile(file, 'utf8')).resolves.toBeTruthy();
    }
    expect(await readFile('src/app/(auth)/login/LoginForm.tsx', 'utf8')).toContain('href="/forgot-password"');
  });
});
