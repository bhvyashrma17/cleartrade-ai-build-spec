/**
 * `/accept-staff-invitation` — where an invitation becomes an agent account.
 *
 * Two ways in, both driven by the same link. Somebody with no ClearTrade account creates one;
 * somebody who is already a ClearTrade user converts the account they already have, which is
 * what keeps their Google/password sign-in working instead of colliding with the unique-email
 * constraint.
 *
 * The role is never shown as a choice, in either path, because it is not one — it was decided
 * by Ops and lives on the invitation row.
 *
 * Opening this page never mutates anything. `inspectStaffInvitation` is read-only, and the
 * conversion happens only when the signed-in user explicitly confirms it. A link that changed a
 * role merely by being fetched would be changed by every link preview and mail scanner that
 * ever touched it.
 */

import Link from 'next/link';
import { getPrincipal } from '@/lib/auth';
import { inspectStaffInvitation } from '@/lib/staff-provisioning';
import { ConvertToAgentPanel } from './ConvertToAgentPanel';
import { AcceptStaffInvitationForm } from './AcceptStaffInvitationForm';
import { SignOutAndReturn } from './SignOutAndReturn';

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-muted px-4 py-10">
      <section className="w-full max-w-md rounded-lg bg-surface p-6 shadow-card sm:p-8">
        <p className="text-sm font-semibold text-primary">ClearTrade AI</p>
        <h1 className="mt-2 text-2xl font-bold text-primary">{title}</h1>
        {children}
      </section>
    </main>
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

    case 'ready_new_account':
      return (
        <Shell title="Set up your staff account">
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
            You were invited by ClearTrade Ops as{' '}
            <span className="font-medium text-primary">{view.invitation_email}</span>. Your role
            and access were set when the invitation was issued — choose a name and password to
            finish.
          </p>
          <div className="mt-6">
            <AcceptStaffInvitationForm token={token!} />
          </div>
          <p className="mt-6 text-sm text-[var(--color-text-secondary)]">
            Already set up?{' '}
            <Link href="/login" className="focus-visible-ring rounded font-medium text-primary underline underline-offset-2">
              Sign in
            </Link>
          </p>
        </Shell>
      );

    // An account already exists for the invited address, so creating a second User would hit
    // the unique-email constraint. Signing in first turns this into the conversion path.
    case 'ready_needs_signin':
      return (
        <Shell title="Sign in to accept">
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
            <span className="font-medium text-primary">{view.invitation_email}</span> already has a
            ClearTrade account. Sign in with it and open this link again to accept the invitation.
          </p>
          <SignOutAndReturn token={token!} label="Go to sign in" signOutFirst={false} />
        </Shell>
      );

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

    case 'mismatch':
      return (
        <Shell title="Signed in as a different account">
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
            This invitation was sent to{' '}
            <span className="font-medium text-primary">{view.invitation_email}</span>, but you are
            signed in as <span className="font-medium text-primary">{view.current_email}</span>.
          </p>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
            Sign out and sign in as the invited address to continue. You will come straight back
            here.
          </p>
          <SignOutAndReturn token={token!} label="Sign out and continue" signOutFirst />
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
