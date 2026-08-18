'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';
import type { SingleResponse } from '@/types';

/**
 * No role field and no organisation field. Staff hold no tenant, and the role came from Ops —
 * offering either here would be offering the caller a say in their own privileges.
 */
export function AcceptStaffInvitationForm({ token }: { token: string }) {
  const router = useRouter();
  const [fields, setFields] = useState({ name: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const set = (key: keyof typeof fields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFields((f) => ({ ...f, [key]: e.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setErrors({});
    setFormError(null);
    try {
      const result = await apiPost<SingleResponse<{ role: string }>>(
        '/api/v1/staff-invitations/accept', { ...fields, token },
      );
      setDone(result.data.role);
    } catch (error) {
      if (error instanceof ApiClientError) {
        if (error.fields?.length) {
          setErrors(Object.fromEntries(error.fields.map((f) => [f.field, f.message])));
        }
        setFormError(error.fields?.length ? null : error.message);
      } else {
        setFormError('Could not set up the account. Try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded border border-[var(--color-border-strong)] bg-surface-muted p-4">
        <p className="text-sm font-semibold text-primary">Account created — role: {done}</p>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Sign in with your email and the password you just chose.
        </p>
        {/* The invitation is spent; the new password gets exercised immediately at /login. */}
        <Button type="button" className="mt-3" onClick={() => router.push('/login')}>
          Go to sign in
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Input id="staff-name" label="Your name" value={fields.name} onChange={set('name')}
        error={errors.name} autoComplete="name" required />
      <Input id="staff-password" label="Password" type="password" value={fields.password}
        onChange={set('password')} error={errors.password ?? errors.token}
        autoComplete="new-password" minLength={8} required />
      <p className="-mt-2 text-xs text-[var(--color-text-muted)]">At least 8 characters.</p>
      {formError ? (
        <p role="alert" className="rounded border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 px-3 py-2 text-sm text-[var(--color-danger)]">
          {formError}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? 'Setting up…' : 'Create account'}
      </Button>
    </form>
  );
}
