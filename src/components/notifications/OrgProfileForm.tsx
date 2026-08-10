'use client';

/** EXP-17 Organization profile edit. IEC/GSTIN render read-only — see the route's own
 * comment for why those aren't editable from this form. */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Input } from '@/components/ui';
import { ApiClientError, apiPatch } from '@/lib/api-client';

export function OrgProfileForm({
  canEdit,
  initial,
}: {
  canEdit: boolean;
  initial: { legal_name: string | null; display_name: string; gstin: string | null; iec_label: string; state: string | null; city: string | null };
}) {
  const router = useRouter();
  const [legalName, setLegalName] = useState(initial.legal_name ?? '');
  const [state, setState] = useState(initial.state ?? '');
  const [city, setCity] = useState(initial.city ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await apiPatch('/api/v1/exporter-org', {
        legal_name: legalName.trim() || undefined,
        state: state.trim() || null,
        city: city.trim() || null,
      });
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not save. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
      <h2 className="text-lg font-semibold text-primary">Organization profile</h2>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{initial.display_name}</p>

      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase text-[var(--color-text-muted)]">GSTIN</dt>
          <dd className="mt-0.5 text-primary">{initial.gstin ?? 'Not set'}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-[var(--color-text-muted)]">IEC status</dt>
          <dd className="mt-0.5 text-primary">{initial.iec_label}</dd>
        </div>
      </dl>
      <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
        GSTIN and IEC are managed through your readiness assessment, not this form.
      </p>

      {canEdit ? (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label="Legal name" value={legalName} onChange={(e) => setLegalName(e.target.value)} />
          <div />
          <Input label="State" value={state} onChange={(e) => setState(e.target.value)} />
          <Input label="City" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
      ) : (
        <p className="mt-4 text-sm text-[var(--color-text-secondary)]">
          Only the account owner can edit these details.
        </p>
      )}

      {error ? <p className="mt-2 text-sm text-[var(--color-critical-text)]">{error}</p> : null}
      {saved ? <p className="mt-2 text-sm text-[var(--color-action-text)]">Saved.</p> : null}
      {canEdit ? (
        <Button disabled={busy} onClick={() => void submit()} className="mt-3 min-h-9 px-4 text-sm">
          {busy ? 'Saving…' : 'Save changes'}
        </Button>
      ) : null}
    </section>
  );
}
