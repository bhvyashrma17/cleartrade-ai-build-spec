'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button, Input } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (message) {
    return (
      <div role="status" className="space-y-4 text-sm text-muted">
        <p>{message}</p>
        <p>Signed up with Google or Apple? Sign in with that instead.</p>
        <Link href="/login" className="text-action underline underline-offset-2">Back to sign in</Link>
      </div>
    );
  }
  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const result = await apiPost<{ data: { message: string } }>('/api/v1/password-reset', { email });
          setMessage(result.data.message);
        } catch (e) {
          setError(e instanceof ApiClientError ? e.message : 'Could not send the link. Please retry.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <div>
        <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-primary">Email</label>
        <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@company.com" value={email} onChange={(event) => setEmail(event.target.value)} />
      </div>
      {error ? <p role="alert" className="text-sm text-[var(--color-critical-text)]">{error}</p> : null}
      <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Sending…' : 'Send the link'}</Button>
      <p className="text-center text-sm"><Link href="/login" className="text-muted underline underline-offset-2 hover:text-bone">Back to sign in</Link></p>
    </form>
  );
}
