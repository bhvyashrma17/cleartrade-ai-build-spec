'use client';

import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui';
import { startSocialSignIn } from './actions';
import type { SocialProviderState } from '@/lib/social-auth';

interface SocialSignInButtonsProps {
  callbackUrl: string;
  providers: SocialProviderState[];
}

function ProviderButton({
  provider,
}: {
  provider: SocialProviderState;
}) {
  const { pending } = useFormStatus();
  const label = provider.id === 'google' ? 'Continue with Google' : 'Continue with Apple';
  return (
    <Button
      type="submit"
      variant="secondary"
      className="w-full justify-start gap-3"
      disabled={!provider.enabled || pending}
      aria-disabled={!provider.enabled || pending}
    >
      {provider.id === 'google' ? <GoogleIcon /> : <AppleIcon />}
      <span>{pending ? 'Redirecting…' : label}</span>
    </Button>
  );
}

export function SocialSignInButtons({ callbackUrl, providers }: SocialSignInButtonsProps) {
  return (
    <div className="space-y-3">
      {providers.map((provider) => (
        <form key={provider.id} action={startSocialSignIn} className="space-y-1.5">
          <input type="hidden" name="provider" value={provider.id} />
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <ProviderButton provider={provider} />
          {!provider.enabled ? (
            <p className="text-xs text-[var(--color-text-secondary)]">
              {provider.label} sign-in is unavailable in this environment.
            </p>
          ) : null}
        </form>
      ))}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.26-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.72-1.58 2.68-3.92 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.46-.8 5.94-2.18l-2.92-2.26c-.8.54-1.82.86-3.02.86-2.32 0-4.3-1.56-5-3.66H1v2.32A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M4 10.76a5.4 5.4 0 0 1 0-3.52V4.92H1a9 9 0 0 0 0 8.16l3-2.32z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.34l2.58-2.58A8.96 8.96 0 0 0 9 0 9 9 0 0 0 1 4.92l3 2.32c.7-2.1 2.68-3.66 5-3.66z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16.37 1.43c0 1.14-.43 2.26-1.14 3.06-.78.87-2.05 1.55-3.2 1.46-.15-1.12.42-2.31 1.12-3.06.78-.86 2.12-1.5 3.22-1.46zm3.43 16.2c-.52 1.2-.78 1.73-1.45 2.77-.93 1.42-2.24 3.2-3.87 3.21-1.44.01-1.81-.95-3.77-.94-1.95.01-2.36.96-3.8.95-1.62-.01-2.86-1.61-3.8-3.03-2.62-4-2.9-8.69-1.28-11.19 1.14-1.75 2.94-2.77 4.64-2.77 1.72 0 2.8.95 4.22.95 1.38 0 2.22-.95 4.2-.95 1.52 0 3.13.83 4.27 2.28-3.75 2.05-3.14 7.42.64 8.72z" />
    </svg>
  );
}
