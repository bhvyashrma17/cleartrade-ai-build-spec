'use server';

import { AuthError } from 'next-auth';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { signIn } from '@/lib/auth';
import { ApiError, toApiError, validationError } from '@/lib/errors';
import { isSocialProviderEnabled, isSocialProviderId, normalizeCallbackUrl } from '@/lib/social-auth';

export interface LoginState {
  fields?: Record<string, string>;
  formError?: string;
  /**
   * The submitted email, echoed back so the form can restore it after a failure.
   *
   * React 19 resets an uncontrolled `<form action={fn}>` on every submit —
   * `startHostTransition` calls `requestFormReset` before invoking the action, and the
   * reset restores inputs to their committed `defaultValue`. Without echoing this back,
   * a failed sign-in wipes what the user typed. The password is deliberately not
   * echoed: it would put the credential in the RSC payload for no UX gain.
   */
  values?: { email: string };
}

const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

function stateFromError(error: ApiError): LoginState {
  return {
    fields: Object.fromEntries((error.fields ?? []).map((field) => [field.field, field.message])),
    formError: error.fields?.length ? undefined : error.message,
  };
}

export async function authenticate(_previousState: LoginState, formData: FormData): Promise<LoginState> {
  const submitted = formData.get('email');
  const values = { email: typeof submitted === 'string' ? submitted : '' };
  const callbackUrl = normalizeCallbackUrl(
    typeof formData.get('callbackUrl') === 'string' ? String(formData.get('callbackUrl')) : null,
  );

  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return {
      ...stateFromError(validationError(parsed.error.issues.map((issue) => ({
        field: String(issue.path[0]),
        code: issue.code,
        message: issue.message,
      })))),
      values,
    };
  }

  try {
    // Auth.js establishes the session; the root route then uses the server-side
    // principal to select the correct exporter, agent, or ops home route.
    await signIn('credentials', {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: callbackUrl,
    });
  } catch (error) {
    // Next's redirect is the successful result of a credentials sign-in.
    if (isNextRedirectError(error)) {
      throw error;
    }
    // authorize() returns null identically for an unknown email, an inactive user and
    // a wrong password, so this one message covers all of them — the form must never
    // reveal whether the address is registered.
    if (error instanceof AuthError) {
      return {
        ...stateFromError(new ApiError('VALIDATION_ERROR', {
          message: 'The email or password you entered is incorrect.',
        })),
        values,
      };
    }
    return { ...stateFromError(toApiError(error)), values };
  }

  return { values };
}

function isNextRedirectError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'digest' in error && typeof error.digest === 'string' && error.digest.startsWith('NEXT_REDIRECT');
}

export async function startSocialSignIn(formData: FormData): Promise<void> {
  const providerRaw = formData.get('provider');
  const provider = typeof providerRaw === 'string' ? providerRaw : null;
  const callbackUrl = normalizeCallbackUrl(
    typeof formData.get('callbackUrl') === 'string' ? String(formData.get('callbackUrl')) : null,
  );

  if (!isSocialProviderId(provider) || !isSocialProviderEnabled(provider)) {
    redirect(`/login?error=OAuthProviderDisabled&provider=${provider ?? 'unknown'}&callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  try {
    await signIn(provider, { redirectTo: callbackUrl });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    if (error instanceof AuthError) {
      redirect(`/login?error=${encodeURIComponent(error.type)}&provider=${provider}&callbackUrl=${encodeURIComponent(callbackUrl)}`);
    }
    throw error;
  }
}
