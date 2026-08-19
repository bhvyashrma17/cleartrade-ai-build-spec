/**
 * "Sign out and continue", or just "go to sign in".
 *
 * The invitation URL is carried through as the post-login callback, so somebody who signed in
 * with the wrong account lands back on the invitation instead of on a dashboard, having to dig
 * the original link out of their email a second time.
 *
 * A plain form posting to a server action — no client component, no session context. The token
 * travels in the form body and the callback URL only: never into localStorage, never logged.
 */

import Link from 'next/link';
import { Button } from '@/components/ui';
import { invitationPath } from '@/lib/invitation-link';
import { signOutAndReturnToInvitation } from './actions';

export function SignOutAndReturn({
  token, label, signOutFirst,
}: {
  token: string;
  label: string;
  /** False when nobody is signed in and this is only a link to the sign-in page. */
  signOutFirst: boolean;
}) {
  const destination = invitationPath(token);

  if (!signOutFirst) {
    return (
      <Link
        href={`/login?callbackUrl=${encodeURIComponent(destination)}`}
        className="focus-visible-ring mt-4 inline-flex min-h-10 items-center rounded border border-primary px-3 text-sm font-medium text-primary"
      >
        {label}
      </Link>
    );
  }

  return (
    <form action={signOutAndReturnToInvitation} className="mt-4">
      <input type="hidden" name="token" value={token} />
      <Button type="submit" variant="secondary">{label}</Button>
    </form>
  );
}
