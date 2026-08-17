import { describe, expect, test } from 'vitest';
import { extractOAuthCallbackError } from '../src/lib/oauth-callback-diagnostics';

describe('OAuth callback error diagnostic extraction', () => {
  test('extracts error and error_description from a denied Google callback', () => {
    const result = extractOAuthCallbackError(
      '/api/auth/callback/google',
      new URLSearchParams({ error: 'access_denied', error_description: 'The user did not consent.' }),
    );
    expect(result).toMatchObject({
      provider: 'google',
      error: 'access_denied',
      errorKnown: true,
      errorDescription: 'The user did not consent.',
    });
  });

  test('flags a documented admin_policy_enforced error as known', () => {
    expect(extractOAuthCallbackError('/api/auth/callback/google', new URLSearchParams({ error: 'admin_policy_enforced' })))
      .toMatchObject({ error: 'admin_policy_enforced', errorKnown: true });
  });

  test('flags org_internal as known', () => {
    expect(extractOAuthCallbackError('/api/auth/callback/google', new URLSearchParams({ error: 'org_internal' })))
      .toMatchObject({ error: 'org_internal', errorKnown: true });
  });

  test('an undocumented error code is still captured, just marked unknown', () => {
    expect(extractOAuthCallbackError('/api/auth/callback/google', new URLSearchParams({ error: 'something_new' })))
      .toMatchObject({ error: 'something_new', errorKnown: false });
  });

  test('error_description is null, not undefined, when absent', () => {
    const result = extractOAuthCallbackError('/api/auth/callback/google', new URLSearchParams({ error: 'access_denied' }));
    expect(result?.errorDescription).toBeNull();
  });

  test('a successful callback (no error param) yields null', () => {
    const result = extractOAuthCallbackError(
      '/api/auth/callback/google',
      new URLSearchParams({ code: 'auth-code-value', state: 'csrf-state-value', scope: 'openid email profile' }),
    );
    expect(result).toBeNull();
  });

  test('non-callback paths yield null even with an error param present', () => {
    expect(extractOAuthCallbackError('/api/auth/session', new URLSearchParams({ error: 'access_denied' }))).toBeNull();
    expect(extractOAuthCallbackError('/login', new URLSearchParams({ error: 'AccessDenied' }))).toBeNull();
  });

  test('the provider segment is read from the callback path', () => {
    expect(extractOAuthCallbackError('/api/auth/callback/apple', new URLSearchParams({ error: 'invalid_client' })))
      .toMatchObject({ provider: 'apple' });
  });

  test('never reads any param beyond the error/error_description allowlist', () => {
    // A callback carrying a real authorization code and CSRF state alongside an error must
    // still surface only the two diagnostic fields — nothing else is ever inspected, so there
    // is no path by which a code, state or token could end up in the returned object.
    const result = extractOAuthCallbackError(
      '/api/auth/callback/google',
      new URLSearchParams({
        error: 'access_denied',
        code: 'should-never-appear',
        state: 'should-never-appear',
        session_state: 'should-never-appear',
      }),
    );
    expect(Object.keys(result!).sort()).toEqual(['error', 'errorDescription', 'errorKnown', 'provider']);
    expect(JSON.stringify(result)).not.toContain('should-never-appear');
  });
});
