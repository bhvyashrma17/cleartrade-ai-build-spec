'use client';

/**
 * EXP-15 "Request insurance quote". A no-op response (case already in flight) and a
 * `partner_available: false` response both render as informational text, not errors —
 * the route treats both as success cases.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

export function InsuranceQuoteButton({ dealId }: { dealId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiPost<{ data: { partner_available: boolean } }>(`/api/v1/deals/${dealId}/insurance`, {});
      setNotice(res.data.partner_available ? 'Quote requested — an agent will follow up.' : 'Quote requested. No insurance partner is currently active, so this will need manual follow-up.');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not request a quote. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Button disabled={busy} onClick={() => void submit()} className="min-h-8 px-3 text-xs">
        {busy ? 'Requesting…' : 'Request insurance quote'}
      </Button>
      {notice ? <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{notice}</p> : null}
      {error ? <p className="mt-1 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
    </div>
  );
}
