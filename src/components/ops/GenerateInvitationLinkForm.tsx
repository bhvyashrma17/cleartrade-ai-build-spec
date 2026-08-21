"use client";

/**
 * Generate a bearer Agent invitation link.
 *
 * No email field. This is the deliberate design: possession of the link is the entire
 * authorization, so there is nothing to bind it to in advance — see the `StaffInvitation`
 * model doc and `generateAgentInvitation` for the full reasoning. The counterpart flow that
 * DOES take an email — converting or pre-authorizing a specific person directly — is
 * `AddAgentForm`, a deliberately separate control so the two security models never blur.
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
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';
import { buildInvitationUrl } from '@/lib/invitation-link';

export function GenerateInvitationLinkForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await apiPost<{ data: { token: string } }>('/api/v1/ops/staff-invitations', {});
      // Converted to a full URL immediately and the bare token dropped, so the raw credential
      // is never held in state on its own.
      setIssued({ url: buildInvitationUrl(window.location.origin, result.data.token) });
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
        <p className="text-sm font-semibold text-primary">Invitation created</p>
        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
          Shown once. Store or send this link now — it cannot be recovered. Anyone who opens it
          can claim it, so share it only with the intended person. If it is lost or sent to the
          wrong person, revoke it and generate a new one.
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
            Generate another
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Button type="button" onClick={submit} disabled={busy}>
        {busy ? 'Generating…' : 'Generate invitation link'}
      </Button>
      {error ? <p role="alert" className="mt-2 text-xs text-critical">{error}</p> : null}
    </div>
  );
}
