'use client';

/**
 * OPS-07 "Change config | Admin | Create new version/effective state | High-risk
 * confirm + audit". A raw JSON editor rather than a bespoke form per key — there are
 * eight config keys with unrelated shapes (SLA thresholds, the document type registry,
 * upload limits…), and a hand-built form for each would be five times the surface
 * area for the same one write path. The server still validates parseability and
 * non-emptiness; this is a deliberate scope choice, not a shortcut around validation.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

export function ConfigVersionForm({ configKey, currentValue }: { configKey: string; currentValue: unknown }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(() => JSON.stringify(currentValue, null, 2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setError('That is not valid JSON.');
      return;
    }
    setBusy(true);
    try {
      await apiPost('/api/v1/config', { key: configKey, value: parsed });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not save this config version. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="focus-visible-ring text-xs font-medium text-primary underline underline-offset-2">
        New version
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-md border border-[color-mix(in_srgb,var(--color-warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_6%,transparent)] p-3">
      <p className="text-xs font-semibold text-primary">High-risk: this creates a new active version immediately.</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        className="mt-1.5 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 font-mono text-xs text-primary focus-visible-ring"
      />
      {error ? <p className="mt-1 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
      <div className="mt-1.5 flex gap-1.5">
        <Button disabled={busy} onClick={() => void submit()} className="min-h-8 px-3 text-xs">
          {busy ? 'Saving…' : 'Save new version'}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)} className="min-h-8 px-3 text-xs">
          Cancel
        </Button>
      </div>
    </div>
  );
}
