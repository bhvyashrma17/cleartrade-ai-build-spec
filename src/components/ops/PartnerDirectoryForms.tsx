'use client';

/** OPS-07 partner directory (docs/06: "implement as part of the config registry, not a new object"). */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPatch, apiPost } from '@/lib/api-client';

export function CreatePartnerForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<'cha' | 'freight' | 'insurance' | 'inspection' | 'bank'>('cha');
  const [legalName, setLegalName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [country, setCountry] = useState('IN');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPost('/api/v1/partners', {
        type,
        legal_name: legalName.trim(),
        display_name: displayName.trim(),
        country_code: country.trim().toUpperCase(),
      });
      setLegalName('');
      setDisplayName('');
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not onboard that partner. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)} className="min-h-8 px-3 text-xs">
        Onboard partner
      </Button>
    );
  }

  return (
    <div className="rounded-md border border-[var(--color-border)] bg-surface-muted p-3">
      <div className="grid grid-cols-2 gap-2 text-xs">
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value as typeof type)} className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-primary focus-visible-ring">
            <option value="cha">CHA</option>
            <option value="freight">Freight</option>
            <option value="insurance">Insurance</option>
            <option value="inspection">Inspection</option>
            <option value="bank">Bank</option>
          </select>
        </label>
        <label>
          Country
          <input value={country} onChange={(e) => setCountry(e.target.value)} className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-primary focus-visible-ring" />
        </label>
        <label className="col-span-2">
          Legal name
          <input value={legalName} onChange={(e) => setLegalName(e.target.value)} className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-primary focus-visible-ring" />
        </label>
        <label className="col-span-2">
          Display name
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-primary focus-visible-ring" />
        </label>
      </div>
      {error ? <p className="mt-1.5 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
      <div className="mt-2 flex gap-1.5">
        <Button disabled={busy || !legalName.trim() || !displayName.trim()} onClick={() => void submit()} className="min-h-8 px-3 text-xs">
          {busy ? 'Saving…' : 'Onboard'}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)} className="min-h-8 px-3 text-xs">
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function PartnerStatusForm({ partnerId, currentStatus }: { partnerId: string; currentStatus: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<'active' | 'suspended' | 'offboarded'>(currentStatus === 'active' ? 'suspended' : 'active');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/api/v1/partners/${partnerId}`, { partner_status: status, reason: reason.trim() });
      setOpen(false);
      setReason('');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not change status. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="focus-visible-ring text-xs font-medium text-primary underline underline-offset-2">
        Change status
      </button>
    );
  }

  return (
    <div className="mt-1.5 max-w-xs rounded-md border border-[var(--color-border)] bg-surface-muted p-2.5">
      <label className="block text-xs text-primary">
        New status
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-xs text-primary focus-visible-ring">
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="offboarded">Offboarded</option>
        </select>
      </label>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" className="mt-1.5 w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-xs text-primary focus-visible-ring" />
      {error ? <p className="mt-1 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
      <div className="mt-1.5 flex gap-1.5">
        <Button disabled={busy || !reason.trim()} onClick={() => void submit()} className="min-h-7 px-2.5 text-xs">
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)} className="min-h-7 px-2.5 text-xs">
          Cancel
        </Button>
      </div>
    </div>
  );
}
