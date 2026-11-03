'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button, Input } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token) {
    return (
      <p className="text-sm text-muted">
        This page needs the link from your email. <Link href="/forgot-password" className="text-action underline underline-offset-2">Ask for a new link</Link>.
      </p>
    );
  }
  if (done) {
    return (
      <div role="status" className="space-y-4 text-sm text-muted">
        <p>Your password has been changed.</p>
        <Link href="/login" className="text-action underline underline-offset-2">Sign in</Link>
      </div>
    );
  }
  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setError(null);
        if (password.length < 8) return setError('Use at least 8 characters.');
        if (password !== confirm) return setError('The two passwords are different.');
        setBusy(true);
        try {
          await apiPost('/api/v1/password-reset/confirm', { token, password });
          setDone(true);
        } catch (e) {
          setError(e instanceof ApiClientError ? e.message : 'Could not change the password. Please retry.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-primary">New password</label>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} />
      </div>
      <div>
        <label htmlFor="confirm" className="mb-1.5 block text-sm font-medium text-primary">New password again</label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} value={confirm} onChange={(event) => setConfirm(event.target.value)} />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-[var(--color-critical-text)]">
          {error} {/link/i.test(error) ? <Link href="/forgot-password" className="underline underline-offset-2">Ask for a new link</Link> : null}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Saving…' : 'Save the new password'}</Button>
    </form>
  );
}
