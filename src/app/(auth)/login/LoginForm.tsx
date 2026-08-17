'use client';

import { useActionState, useState } from 'react';
import { Button, Input } from '@/components/ui';
import { authenticate, type LoginState } from './actions';
import { SocialSignInButtons } from './SocialSignInButtons';
import type { SocialProviderState } from '@/lib/social-auth';

type FieldErrors = { email?: string; password?: string };

interface LoginFormProps {
  callbackUrl: string;
  oauthErrorMessage: string | null;
  socialProviders: SocialProviderState[];
}

export function LoginForm({ callbackUrl, oauthErrorMessage, socialProviders }: LoginFormProps) {
  const [state, formAction, isSubmitting] = useActionState<LoginState, FormData>(authenticate, {});
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const errors = { ...state.fields, ...clientErrors };
  const formError = state.formError ?? oauthErrorMessage;

  return (
    <div className="space-y-5">
      {formError ? <div id="login-error" role="alert" className="rounded border border-[color-mix(in_srgb,var(--color-critical)_30%,transparent)] bg-red-50 px-3 py-2 text-sm text-critical">{formError}</div> : null}
      <SocialSignInButtons callbackUrl={callbackUrl} providers={socialProviders} />
      <div className="relative text-center text-xs uppercase tracking-wide text-[var(--color-text-secondary)]">
        <span className="relative z-10 bg-surface px-2">or</span>
        <span aria-hidden="true" className="absolute inset-x-0 top-1/2 -z-0 h-px bg-[var(--color-border)]" />
      </div>
      <form noValidate action={formAction} className="space-y-5" aria-describedby={formError ? 'login-error' : undefined}>
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-primary">Email address</label>
          {/* defaultValue, not value: React resets this uncontrolled form on every
              submit and restores from the committed defaultValue, so echoing the
              submitted email back is what keeps it on screen after a failed sign-in. */}
          <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@company.com" defaultValue={state.values?.email} error={errors.email} onBlur={(event) => {
            const value = event.currentTarget.value.trim();
            setClientErrors((current) => ({ ...current, email: !value ? 'Enter your email address.' : /^\S+@\S+\.\S+$/.test(value) ? undefined : 'Enter a valid email address.' }));
          }} />
        </div>
        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-primary">Password</label>
          <Input id="password" name="password" type="password" autoComplete="current-password" error={errors.password} onBlur={(event) => {
            // Read the value now, not inside the updater: React nulls `currentTarget`
            // once the handler returns, and the updater runs later (twice, under
            // StrictMode) — reading it there throws on the re-render after a failed
            // sign-in. Same synchronous-capture shape as the email handler above.
            const value = event.currentTarget.value;
            setClientErrors((current) => ({ ...current, password: value ? undefined : 'Enter your password.' }));
          }} />
        </div>
        <Button type="submit" className="w-full" disabled={isSubmitting}>{isSubmitting ? 'Signing in…' : 'Sign in'}</Button>
      </form>
    </div>
  );
}
