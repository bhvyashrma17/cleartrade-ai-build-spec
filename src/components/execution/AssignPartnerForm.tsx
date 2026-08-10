'use client';

/**
 * AGT-06 CHA/freight assignment. The control is a `<select>` over the approved directory —
 * there is no text input, so a phantom partner cannot be typed. The server independently
 * re-checks the id against the directory; this component's shape is the first line, not
 * the only one.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

export interface DirectoryPartner {
  id: string;
  type: string;
  display_name: string;
  country_code: string;
}

export function AssignPartnerForm({
  dealId,
  lane,
  partners,
  currentPartnerName,
}: {
  dealId: string;
  lane: 'cha' | 'freight';
  partners: DirectoryPartner[];
  currentPartnerName: string | null;
}) {
  const router = useRouter();
  const options = partners.filter((p) => p.type === lane);
  const [partnerId, setPartnerId] = useState(options[0]?.id ?? '');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/v1/deals/${dealId}/partners`, { partner_id: partnerId, lane, notes: notes.trim() || null });
      setNotes('');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not assign that partner. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  if (options.length === 0) {
    return (
      <p className="text-xs text-[var(--color-text-secondary)]">
        No active {lane === 'cha' ? 'CHA' : 'freight'} partner is in the approved directory. Ops must onboard one before
        this can be assigned.
      </p>
    );
  }

  return (
    <div className="max-w-sm">
      <label className="block text-xs font-medium text-primary">
        {currentPartnerName ? `Reassign ${lane === 'cha' ? 'CHA' : 'freight'} partner` : `Assign ${lane === 'cha' ? 'CHA' : 'freight'} partner`}
        <select
          value={partnerId}
          onChange={(e) => setPartnerId(e.target.value)}
          className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring"
        >
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.display_name} ({p.country_code})
            </option>
          ))}
        </select>
      </label>
      <label className="mt-2 block text-xs font-medium text-primary">
        Handoff note (optional)
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What you sent them"
          className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring"
        />
      </label>
      {error ? <p className="mt-1.5 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
      <Button disabled={busy || !partnerId} onClick={() => void submit()} className="mt-2 min-h-8 px-3 text-xs">
        {busy ? 'Sending…' : 'Assign & record handoff'}
      </Button>
    </div>
  );
}
