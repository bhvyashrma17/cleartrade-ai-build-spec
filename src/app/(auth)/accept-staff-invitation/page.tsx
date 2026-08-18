/**
 * `/accept-staff-invitation` — where an invited staff member creates their account.
 *
 * The counterpart to Ops issuing an invitation, and the only way a staff account comes into
 * existence: there is no public "sign up as an agent". The role is never shown as a choice
 * because it is not one — it was decided by Ops and lives on the invitation row.
 *
 * The token is deliberately NOT validated on this render. Doing so would turn the page into an
 * oracle that reports which tokens exist, and would gain the invitee nothing: acceptance is a
 * single atomic attempt either way.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getPrincipal, homeRouteForRole } from '@/lib/auth';
import { AcceptStaffInvitationForm } from './AcceptStaffInvitationForm';

export default async function AcceptStaffInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const principal = await getPrincipal();
  // Someone already signed in cannot accept an invitation into a second identity from here.
  if (principal) redirect(homeRouteForRole(principal.role));

  const { token } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-muted px-4 py-10">
      <section className="w-full max-w-md rounded-lg bg-surface p-6 shadow-card sm:p-8">
        <p className="text-sm font-semibold text-primary">ClearTrade AI</p>
        <h1 className="mt-2 text-2xl font-bold text-primary">Set up your staff account</h1>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          You were invited by ClearTrade Ops. Your role and access were set when the invitation
          was issued — choose a name and password to finish.
        </p>

        {token ? (
          <div className="mt-6">
            <AcceptStaffInvitationForm token={token} />
          </div>
        ) : (
          <p className="mt-6 rounded border border-[var(--color-border)] bg-surface-muted px-3 py-2 text-sm text-[var(--color-text-secondary)]">
            This link is missing its invitation token. Use the full link Ops sent you, or ask them
            to issue a new invitation.
          </p>
        )}

        <p className="mt-6 text-sm text-[var(--color-text-secondary)]">
          Already set up?{' '}
          <Link href="/login" className="focus-visible-ring rounded font-medium text-primary underline underline-offset-2">
            Sign in
          </Link>
        </p>
      </section>
    </main>
  );
}
