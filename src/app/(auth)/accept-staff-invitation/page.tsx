/**
 * `/accept-staff-invitation` — where a bearer invitation becomes an agent account.
 *
 * SECURITY MODEL: this is a bearer credential. There is no invited address on the link — Ops
 * generates it with no email, and possession of the raw token plus an explicit, authenticated
 * confirmation is the entire authorization. Whoever holds the link, signs in (or creates an
 * account) and presses "Confirm" is the accepted recipient. This is deliberately different from
 * `StaffAccessGrant` (see `/lib/staff-provisioning`), which authorizes by verified email match
 * at sign-in and has no link at all — the two are never blurred into one flow.
 *
 * The role is never shown as a choice, because it is not one — a bearer invitation always
 * grants `agent`, enforced by a database CHECK.
 *
 * Opening this page never mutates anything. `inspectStaffInvitation` is read-only, and
 * conversion happens only when the signed-in user explicitly confirms it. A link that changed a
 * role merely by being fetched would be changed by every link preview and mail scanner that
 * ever touched it.
 */

import Link from 'next/link';
import { getPrincipal } from '@/lib/auth';
import { invitationPath } from '@/lib/invitation-link';
import { inspectStaffInvitation } from '@/lib/staff-provisioning';
import { ConvertToAgentPanel } from './ConvertToAgentPanel';
import { SignOutAndReturn } from './SignOutAndReturn';

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-card p-6 sm:p-8">
      <h1 className="masthead text-title-page text-ink-900">{title}</h1>
      {children}
    </section>
  );
}

/** One neutral message for a link that is not usable, whatever the reason. */
function Unusable({ title, detail }: { title: string; detail: string }) {
  return (
    <Shell title={title}>
      <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{detail}</p>
      <p className="mt-6 text-sm text-[var(--color-text-secondary)]">
        <Link href="/login" className="focus-visible-ring rounded font-medium text-primary underline underline-offset-2">
          Go to sign in
        </Link>
      </p>
    </Shell>
  );
}

export default async function AcceptStaffInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const principal = await getPrincipal();
  const view = await inspectStaffInvitation(token, principal);

  switch (view.state) {
    case 'unknown':
      return (
        <Unusable
          title="This invitation is not valid"
          detail="This link is missing or no longer recognised. Ask Ops to send a new invitation."
        />
      );

    // The holder demonstrably has a real token, so naming the reason tells them something
    // actionable without telling an attacker anything they could have used.
    case 'expired':
      return (
        <Unusable
          title="This invitation has expired"
          detail="Invitations are valid for a limited time. Ask Ops to send a new one."
        />
      );

    case 'consumed':
      return (
        <Unusable
          title="This invitation has already been used"
          detail="It has already been accepted or was withdrawn. If you still need access, ask Ops to send a new invitation."
        />
      );

    // Bearer semantics: nobody is signed in, and there is no invited address to name. Sending
    // them to sign in OR create an account, both carrying this exact link as the return
    // destination, is what lets "no account yet" and "already have one" converge on the same
    // explicit confirmation screen below instead of forking into a separate creation flow.
    case 'unauthenticated': {
      const destination = invitationPath(token!);
      return (
        <Shell title="Agent invitation">
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
            You&apos;ve received a single-use invitation to join ClearTrade as an Agent. Sign in
            with an existing account, or create a new one — either way, you&apos;ll come straight
            back here to confirm.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link
              href={`/login?callbackUrl=${encodeURIComponent(destination)}`}
              className="focus-visible-ring inline-flex min-h-10 items-center rounded bg-primary px-4 text-sm font-medium text-[var(--color-text-inverse)]"
            >
              Sign in
            </Link>
            <Link
              href={`/register?callbackUrl=${encodeURIComponent(destination)}`}
              className="focus-visible-ring inline-flex min-h-10 items-center rounded border border-primary px-4 text-sm font-medium text-primary"
            >
              Create an account
            </Link>
          </div>
        </Shell>
      );
    }

    case 'ready_convert':
      return (
        <Shell title="Accept agent invitation">
          <ConvertToAgentPanel token={token!} currentEmail={view.current_email} />
        </Shell>
      );

    case 'blocked_convert':
      return (
        <Shell title="This account cannot become an Agent">
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
            You are signed in as <span className="font-medium text-primary">{view.current_email}</span>.
          </p>
          <p role="alert" className="mt-3 rounded border border-[color-mix(in_srgb,var(--color-critical)_25%,transparent)] bg-[color-mix(in_srgb,var(--color-critical)_5%,transparent)] px-3 py-2 text-sm text-primary">
            {view.reason}
          </p>
          <SignOutAndReturn token={token!} label="Sign out and use a different account" signOutFirst />
        </Shell>
      );

    case 'already_agent':
      return (
        <Shell title="You are already an Agent">
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
            This account already has the Agent role. There is nothing to accept.
          </p>
          <p className="mt-6 text-sm text-[var(--color-text-secondary)]">
            <Link href="/agent" className="focus-visible-ring rounded font-medium text-primary underline underline-offset-2">
              Open the Agent workspace
            </Link>
          </p>
        </Shell>
      );

    // Fail closed. An Ops or admin role is never rewritten by following a link.
    case 'already_staff':
      return (
        <Shell title="This account cannot be converted">
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
            You are signed in as <span className="font-medium text-primary">{view.current_email}</span>,
            which is an internal ClearTrade account. Staff roles are changed through Ops, not by
            accepting an invitation.
          </p>
          <SignOutAndReturn token={token!} label="Sign out and use a different account" signOutFirst />
        </Shell>
      );
  }
}
