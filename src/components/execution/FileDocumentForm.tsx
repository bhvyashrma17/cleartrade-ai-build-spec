'use client';

/** AGT-06 filing control — touches the Document's filing dimension only. */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

const NEXT_FILING: Record<string, { value: string; label: string; needsRef: boolean }[]> = {
  not_applicable: [{ value: 'ready', label: 'Mark ready to file', needsRef: false }],
  draft: [{ value: 'ready', label: 'Mark ready to file', needsRef: false }],
  ready: [{ value: 'filed', label: 'Mark filed', needsRef: true }],
  filed: [
    { value: 'accepted', label: 'Authority accepted', needsRef: true },
    { value: 'rejected', label: 'Authority rejected', needsRef: false },
  ],
  accepted: [],
  rejected: [{ value: 'ready', label: 'Ready to re-file', needsRef: false }],
};

export function FileDocumentForm({
  dealId,
  documentId,
  filingStatus,
  filingReference,
}: {
  dealId: string;
  documentId: string;
  filingStatus: string;
  filingReference: string | null;
}) {
  const router = useRouter();
  const [ref, setRef] = useState(filingReference ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = NEXT_FILING[filingStatus] ?? [];

  if (options.length === 0) {
    return <p className="text-xs text-[var(--color-text-secondary)]">Filing complete.</p>;
  }

  const submit = async (to: string) => {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/v1/deals/${dealId}/documents/${documentId}/file`, {
        action: 'mark_filed',
        filing_status: to,
        filing_reference: ref.trim() || null,
      });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not update the filing. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  const needsRef = options.some((o) => o.needsRef);

  return (
    <div>
      {needsRef ? (
        <input
          type="text"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          placeholder="Authority reference"
          aria-label="Filing reference"
          className="record mb-1.5 block w-full max-w-[180px] rounded-md border border-[var(--color-border)] bg-surface px-2 py-1 text-primary focus-visible-ring"
        />
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <Button
            key={o.value}
            variant="secondary"
            disabled={busy}
            onClick={() => void submit(o.value)}
            className="min-h-8 px-2.5 text-xs"
          >
            {busy ? '…' : o.label}
          </Button>
        ))}
      </div>
      {error ? <p className="mt-1 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
    </div>
  );
}
