import type { NextRequest } from 'next/server';
import { handlers } from '@/lib/auth';
import { extractOAuthCallbackError } from '@/lib/oauth-callback-diagnostics';
import { log } from '@/lib/observability';

/**
 * Wraps Auth.js's own GET handler to log the OAuth2 `error`/`error_description` query params
 * on a failed provider callback, before Auth.js's generic error handler discards them and
 * redirects to `/login?error=AccessDenied` with no way to tell which reason it was.
 *
 * Purely observational: the request object is forwarded to `handlers.GET` completely
 * unmodified, so this changes no auth, CSRF, PKCE or session behavior. See
 * oauth-callback-diagnostics.ts for exactly which two params are read and why that is safe.
 */
async function GET(request: NextRequest) {
  const diagnostic = extractOAuthCallbackError(request.nextUrl.pathname, request.nextUrl.searchParams);
  if (diagnostic) {
    log('warn', 'oauth_callback_denied', {
      provider: diagnostic.provider,
      error: diagnostic.error,
      error_known: diagnostic.errorKnown,
      error_description: diagnostic.errorDescription,
    });
  }
  return handlers.GET(request);
}

export { GET };
export const { POST } = handlers;
