"use client";

/**
 * Invite an agent.
 *
 * The one-time token is shown once, on success, and never fetched again — it is not stored in
 * readable form, so there is nothing to re-display. Making that explicit in the UI matters: an
 * operator who assumes they can come back for it will strand the invitee.
 *
 * The link is built from `window.location.origin` — the origin the operator is already looking
 * at, which the browser guarantees. It is deliberately NOT built server-side from a request
 * Host header, which is attacker-controlled and would let a poisoned Host turn this into a
 * token-exfiltration link. `buildInvitationUrl` is exported so the rule is testable rather than
 * merely intended.
 *
 * The raw token lives in component state for the lifetime of this success panel and nowhere
 * else: not localStorage, not sessionStorage, not a log line.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Input } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';
import { buildInvitationUrl } from '@/lib/invitation-link';

export function InviteAgentForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ email: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await apiPost<{ data: { email: string; token: string } }>(
        '/api/v1/ops/staff-invitations', { email: email.trim() },
      );
      // Converted to a full URL immediately and the bare token dropped, so the raw credential
      // is never held in state on its own.
      setIssued({
        email: result.data.email,
        url: buildInvitationUrl(window.location.origin, result.data.token),
      });
      setEmail('');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not create the invitation.');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied outright. The link is visible and selectable either
      // way, so this fails quietly rather than raising an error the operator cannot act on.
      setCopied(false);
    }
  };

  if (issued) {
    return (
      <div className="rounded-md border border-[var(--color-border-strong)] bg-surface-muted p-3">
        <p className="text-sm font-semibold text-primary">Invitation created for {issued.email}</p>
        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
          Shown once. Store or send this link now — it cannot be recovered. If it is lost, revoke
          the invitation and issue a new one.
        </p>

        <a
          href={issued.url}
          className="focus-visible-ring mt-2 block break-all rounded bg-surface px-2 py-1.5 text-xs text-primary underline underline-offset-2"
        >
          {issued.url}
        </a>

        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" className="min-h-8 px-3 text-xs" onClick={copy}>
            {copied ? 'Copied' : 'Copy link'}
          </Button>
          <Button type="button" variant="secondary" className="min-h-8 px-3 text-xs" onClick={() => setIssued(null)}>
            Invite another
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-[16rem] flex-1">
        <Input
          id="invite-agent-email"
          label="Agent email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="agent@cleartrade.example"
          error={error ?? undefined}
        />
      </div>
      <Button type="button" onClick={submit} disabled={busy || !email.trim()}>
        {busy ? 'Creating…' : 'Send invitation'}
      </Button>
    </div>
  );
}
