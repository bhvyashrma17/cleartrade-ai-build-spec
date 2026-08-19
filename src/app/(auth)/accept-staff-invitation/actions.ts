"use server";

/**
 * Sign out while preserving the invitation the user was heading for.
 *
 * A server action rather than `next-auth/react`, matching how the rest of this app does auth:
 * there is no `SessionProvider` mounted anywhere, so the client helper would be the only thing
 * in the codebase depending on one.
 *
 * The return destination is passed through `normalizeCallbackUrl`, the same guard the login
 * form uses. Without it, a crafted `token` value could steer the post-logout redirect at an
 * external origin — the invitation link is attacker-supplied input as far as this action is
 * concerned, even though the token itself is opaque.
 */

import { signOut } from '@/lib/auth';
import { invitationPath } from '@/lib/invitation-link';
import { normalizeCallbackUrl } from '@/lib/social-auth';

export async function signOutAndReturnToInvitation(formData: FormData): Promise<void> {
  const token = formData.get('token');
  const destination = typeof token === 'string' && token.length > 0
    ? invitationPath(token)
    : '/login';

  const safe = normalizeCallbackUrl(destination);
  await signOut({ redirectTo: `/login?callbackUrl=${encodeURIComponent(safe)}` });
}
