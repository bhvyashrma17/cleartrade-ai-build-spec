'use client';

/**
 * "Add agent" without an invitation link.
 *
 * Entering an email and checking it classifies the address server-side (`lookupStaffCandidate`)
 * into exactly one of three cases, and the browser never gets to pick which mutation runs next —
 * it only gets to confirm the one the server already decided is available:
 *
 *   - the email has a ClearTrade account → Case A, convert it directly (`/agents/convert`)
 *   - the email has neither an account nor a pending grant → Case B, pre-authorize it
 *     (`/staff-access-grants`) so a later verified sign-in claims it automatically
 *   - the email already has a pending grant → nothing to do, say so
 *
 * The check step is read-only and can be re-run freely; only the confirm step mutates.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Input } from '@/components/ui';
import { ApiClientError, apiGet, apiPost } from '@/lib/api-client';

type Lookup =
  | { case: 'existing_user'; userId: string; role: string; isActive: boolean; alreadyAgent: boolean; blockedReason: string | null }
  | { case: 'pending_grant' }
  | { case: 'no_account' };

export function AddAgentForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [checked, setChecked] = useState<{ email: string; result: Lookup } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const check = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const result = await apiGet<{ data: Lookup }>(`/api/v1/ops/agents/lookup?email=${encodeURIComponent(trimmed)}`);
      setChecked({ email: trimmed, result: result.data });
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not check that email.');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setChecked(null);
    setEmail('');
    setError(null);
    setDone(null);
  };

  const convertExisting = async () => {
    if (!checked) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost('/api/v1/ops/agents/convert', { email: checked.email });
      setDone(`${checked.email} is now an Agent.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not convert this account.');
    } finally {
      setBusy(false);
    }
  };

  const grantPending = async () => {
    if (!checked) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost('/api/v1/ops/staff-access-grants', { email: checked.email });
      setDone(`${checked.email} is pre-authorized. They will become an Agent the moment they sign in with a verified account for that address.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not pre-authorize this email.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="rounded-md border border-[var(--color-border-strong)] bg-surface-muted p-3">
        <p className="text-sm text-primary">{done}</p>
        <Button type="button" variant="secondary" className="mt-2 min-h-8 px-3 text-xs" onClick={reset}>
          Add another
        </Button>
      </div>
    );
  }

  if (checked) {
    const { result } = checked;
    return (
      <div className="max-w-md rounded-md border border-[var(--color-border)] bg-surface-muted p-3">
        {result.case === 'existing_user' ? (
          result.alreadyAgent ? (
            <p className="text-sm text-primary">{checked.email} is already an Agent.</p>
          ) : result.blockedReason ? (
            <p className="text-sm text-critical">{result.blockedReason}</p>
          ) : (
            <>
              <p className="text-sm text-primary">
                {checked.email} already has a ClearTrade account, currently{' '}
                <strong>{result.role}</strong>{result.isActive ? '' : ' (deactivated)'}.
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                Convert existing account to Agent? Their password and any linked sign-in providers
                are preserved.
              </p>
              {error ? <p role="alert" className="mt-2 text-xs text-critical">{error}</p> : null}
              <div className="mt-2 flex gap-1.5">
                <Button type="button" disabled={busy || !result.isActive} className="min-h-8 px-3 text-xs" onClick={() => void convertExisting()}>
                  {busy ? 'Converting…' : 'Convert to Agent'}
                </Button>
                <Button type="button" variant="secondary" className="min-h-8 px-3 text-xs" disabled={busy} onClick={reset}>Cancel</Button>
              </div>
            </>
          )
        ) : result.case === 'pending_grant' ? (
          <>
            <p className="text-sm text-primary">
              {checked.email} already has a pending pre-authorization awaiting their sign-in.
            </p>
            <Button type="button" variant="secondary" className="mt-2 min-h-8 px-3 text-xs" onClick={reset}>Back</Button>
          </>
        ) : (
          <>
            <p className="text-sm text-primary">No ClearTrade account exists yet for {checked.email}.</p>
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
              Pre-authorize this email as Agent? No password is created and no email is sent —
              the moment this exact, verified email signs in, ClearTrade recognizes the grant and
              provisions the account as Agent instead of an ordinary exporter.
            </p>
            {error ? <p role="alert" className="mt-2 text-xs text-critical">{error}</p> : null}
            <div className="mt-2 flex gap-1.5">
              <Button type="button" disabled={busy} className="min-h-8 px-3 text-xs" onClick={() => void grantPending()}>
                {busy ? 'Saving…' : 'Pre-authorize as Agent'}
              </Button>
              <Button type="button" variant="secondary" className="min-h-8 px-3 text-xs" disabled={busy} onClick={reset}>Cancel</Button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-[16rem] flex-1">
        <Input
          id="add-agent-email"
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="person@example.com"
          error={error ?? undefined}
        />
      </div>
      <Button type="button" onClick={() => void check()} disabled={busy || !email.trim()}>
        {busy ? 'Checking…' : 'Check'}
      </Button>
    </div>
  );
}
