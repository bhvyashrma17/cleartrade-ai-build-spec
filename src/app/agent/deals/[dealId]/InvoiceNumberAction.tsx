'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

export function InvoiceNumberAction({ dealId, nextInvoiceNumberPreview }: {
  dealId: string;
  nextInvoiceNumberPreview: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const issue = async () => {
    setIssuing(true);
    setError(null);
    try {
      await apiPost(`/api/v1/deals/${dealId}/invoice-number`, {});
      setConfirming(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : 'Could not issue the invoice number.');
    } finally {
      setIssuing(false);
    }
  };

  if (!confirming) {
    return (
      <div className="flex flex-col items-start gap-1">
        <p className="text-xs text-[var(--color-text-secondary)]">
          Next estimated number: <span className="font-mono">{nextInvoiceNumberPreview}</span>
        </p>
        <Button type="button" onClick={() => setConfirming(true)}>Issue invoice number</Button>
      </div>
    );
  }

  return (
    <div role="alertdialog" aria-labelledby="issue-invoice-title" aria-describedby="issue-invoice-description"
      className="max-w-md rounded-lg border border-[var(--color-border-strong)] bg-surface-muted p-3 text-left">
      <h3 id="issue-invoice-title" className="text-sm font-semibold text-primary">Issue official invoice number?</h3>
      <p id="issue-invoice-description" className="mt-1 text-xs text-[var(--color-text-secondary)]">
        The next number in this exporter’s invoice series will be permanently allocated to this Commercial Invoice.
      </p>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
        Current estimate: <span className="font-mono">{nextInvoiceNumberPreview}</span>. The final number is assigned atomically when you confirm.
      </p>
      {error ? <p role="alert" className="mt-2 text-xs text-[var(--color-danger)]">{error}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => setConfirming(false)} disabled={issuing}>Cancel</Button>
        <Button type="button" onClick={issue} disabled={issuing}>{issuing ? 'Issuing…' : 'Issue number'}</Button>
      </div>
    </div>
  );
}
