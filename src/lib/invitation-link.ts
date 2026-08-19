/**
 * Building the invitation link an operator hands to an invitee.
 *
 * Pure, and deliberately not inside the React component that renders it: the security rule
 * here — that the origin comes from the browser rather than from a request header — is worth
 * testing directly, and a test should not have to mount the UI to do it.
 *
 * The origin must be a TRUSTED one. In the browser that is `window.location.origin`, which the
 * user agent guarantees. It is never derived from a `Host` header: that header is
 * attacker-controlled, and a poisoned value would turn an invitation mail into a link that
 * delivers a live staff token to someone else's server. Where a server-side absolute URL is
 * genuinely needed, use the configured `NEXT_PUBLIC_APP_URL` instead.
 */

export const ACCEPT_INVITATION_PATH = '/accept-staff-invitation';

/** The relative destination, for callbacks and redirects that must stay same-origin. */
export function invitationPath(token: string): string {
  return `${ACCEPT_INVITATION_PATH}?token=${encodeURIComponent(token)}`;
}

/**
 * The full URL an invitee should open.
 *
 * The token is URL-encoded because it is base64url and, while that alphabet happens to be
 * query-safe, encoding it makes that a property of this function rather than a lucky property
 * of the token generator.
 */
export function buildInvitationUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, '')}${invitationPath(token)}`;
}
