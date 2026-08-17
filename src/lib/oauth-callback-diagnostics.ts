/**
 * Diagnostic extraction for a failed OAuth callback — nothing else.
 *
 * When a provider denies a request (`access_denied`, `admin_policy_enforced`,
 * `org_internal`, `disallowed_useragent`, ...), it redirects to our callback URL with the
 * error encoded in the query string, and Auth.js's own generic error handler swallows it
 * before redirecting to `/login?error=AccessDenied` — with no way to recover which of those
 * reasons it actually was (see loginErrorMessage's comment on the same limitation for the
 * provider name). This captures the two query params that answer "which reason, exactly"
 * before Auth.js discards them, so the log line — not the browser — carries the diagnosis.
 *
 * ALLOWLIST, not a redaction pass: only `error` and `error_description` are ever read from
 * the URL. Every other Google/Apple callback param — `code` (the authorization code itself),
 * `state` (CSRF value), `session_state`, `authuser`, `prompt`, and the surrounding cookies —
 * is never touched by this module, so there is nothing here that could leak a code, a token,
 * or a session. `error`/`error_description` are OAuth2's own standard names for "why did this
 * fail", defined by RFC 6749 §4.1.2.1, and contain no user identity or secret material by
 * construction — the spec bans identity/PII in a query param an attacker's browser can see.
 */

const KNOWN_GOOGLE_ERRORS = new Set([
  'access_denied',
  'admin_policy_enforced',
  'org_internal',
  'disallowed_useragent',
  'invalid_client',
  'invalid_request',
  'invalid_scope',
  'unauthorized_client',
  'unsupported_response_type',
  'server_error',
  'temporarily_unavailable',
]);

export interface OAuthCallbackErrorDiagnostic {
  provider: string;
  error: string;
  /** true when the value matches a documented Google OAuth2 error code. */
  errorKnown: boolean;
  /** Present only when the provider supplied one; still just OAuth2 standard text, never PII. */
  errorDescription: string | null;
}

/**
 * @param pathname  the request path, e.g. "/api/auth/callback/google"
 * @param search    the request's query string params
 * @returns null when this isn't a callback path, or the callback carries no `error` param
 *   (the ordinary success path) — so a caller can log unconditionally without an extra guard.
 */
export function extractOAuthCallbackError(
  pathname: string,
  search: URLSearchParams,
): OAuthCallbackErrorDiagnostic | null {
  const match = pathname.match(/\/api\/auth\/callback\/([^/]+)\/?$/);
  if (!match) return null;

  const error = search.get('error');
  if (!error) return null;

  return {
    provider: match[1],
    error,
    errorKnown: KNOWN_GOOGLE_ERRORS.has(error),
    errorDescription: search.get('error_description'),
  };
}
