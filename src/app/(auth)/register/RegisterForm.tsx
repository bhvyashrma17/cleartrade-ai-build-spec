'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, Input } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';
import type { SingleResponse } from '@/types';

interface RegisterResult {
  exporter_org_id: string;
  tier: string;
  upgraded_in_place: boolean;
  retained_discovery_runs: number;
  saved_product_id: string | null;
}

export function RegisterForm({
  adHocProductLabel,
  callbackUrl,
}: {
  adHocProductLabel: string | null;
  /** Already passed through `normalizeCallbackUrl` server-side — safe to use as-is. */
  callbackUrl?: string | null;
}) {
  const router = useRouter();
  const [fields, setFields] = useState({ name: '', email: '', password: '', organization_name: '' });
  const [saveProduct, setSaveProduct] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (key: keyof typeof fields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFields((f) => ({ ...f, [key]: e.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setErrors({});
    setFormError(null);
    try {
      await apiPost<SingleResponse<RegisterResult>>('/api/v1/register', {
        ...fields,
        ...(adHocProductLabel ? { save_discovery_input_as_product: saveProduct } : {}),
      });
      // Straight into Markets by default, not /login.
      //
      // Registration upgrades the guest's User row in place, so the session cookie they
      // already hold now resolves to the new free-tier account — they are signed in the
      // moment this returns. Routing to /login would bounce off its "already signed in"
      // redirect anyway, and land them on a route that doesn't exist yet. Markets is also
      // where the searches we just promised to keep actually become visible.
      //
      // A caller can override that destination (e.g. the staff-invitation flow, which needs
      // the new account to land back on the invitation it came from) via `callbackUrl` — already
      // passed through `normalizeCallbackUrl` server-side, so it is safe to use here as-is.
      router.push(callbackUrl || '/app/markets');
      router.refresh();
    } catch (error) {
      if (error instanceof ApiClientError) {
        if (error.fields?.length) {
          setErrors(Object.fromEntries(error.fields.map((f) => [f.field, f.message])));
        } else {
          setFormError(error.message);
        }
      } else {
        setFormError('Could not create your account. Please retry.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form noValidate onSubmit={submit} className="space-y-5">
      {formError ? (
        <div role="alert" className="rounded border border-[color-mix(in_srgb,var(--color-critical)_30%,transparent)] bg-red-50 px-3 py-2 text-sm text-critical">
          {formError}
          {/* An email collision is the common case here, and "sign in instead" is the fix. */}
          <Link href="/login" className="ml-1 font-semibold underline underline-offset-2">
            Sign in
          </Link>
        </div>
      ) : null}

      <div>
        <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-primary">Your name</label>
        <Input id="name" value={fields.name} onChange={set('name')} error={errors.name} autoComplete="name" />
      </div>
      <div>
        <label htmlFor="organization_name" className="mb-1.5 block text-sm font-medium text-primary">Company name</label>
        <Input
          id="organization_name"
          value={fields.organization_name}
          onChange={set('organization_name')}
          error={errors.organization_name}
          autoComplete="organization"
        />
      </div>
      <div>
        <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-primary">Email address</label>
        <Input id="email" type="email" value={fields.email} onChange={set('email')} error={errors.email} autoComplete="email" />
      </div>
      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-primary">Password</label>
        <Input
          id="password"
          type="password"
          value={fields.password}
          onChange={set('password')}
          error={errors.password}
          autoComplete="new-password"
        />
        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">At least 8 characters.</p>
      </div>

      {/* Opt-in, never automatic — saving a Product is a choice the user makes, not a
          side effect of signing up. */}
      {adHocProductLabel ? (
        <label className="flex items-start gap-2 rounded border border-[var(--color-border)] bg-surface-muted p-3 text-sm">
          <input
            type="checkbox"
            checked={saveProduct}
            onChange={(e) => setSaveProduct(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium text-primary">Save &ldquo;{adHocProductLabel}&rdquo; as a product</span>
            <span className="block text-xs text-[var(--color-text-secondary)]">
              Reuse it for future searches and deals. You can edit it later.
            </span>
          </span>
        </label>
      ) : null}

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? 'Creating account…' : 'Create free account'}
      </Button>

      <p className="text-center text-sm text-[var(--color-text-secondary)]">
        Already have an account?{' '}
        <Link href="/login" className="font-semibold text-primary underline underline-offset-2">Sign in</Link>
      </p>
    </form>
  );
}
