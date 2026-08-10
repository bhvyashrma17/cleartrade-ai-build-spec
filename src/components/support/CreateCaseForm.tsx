'use client';

/**
 * EXP-16 "Create case" — prefilled with deal/shipment context. Choosing a shipment or
 * payment from the dropdown is the "prefill" the docs table asks for; the server still
 * re-validates that whatever id gets submitted actually belongs to this deal
 * (openDisputeSchema + the route's own lookup), so this dropdown is a convenience, not a
 * trust boundary.
 *
 * AC01 lives here as much as anywhere: this form posts to `/disputes`, never `/messages`
 * — there is no "escalate this message" button, because a message and a case are
 * different objects from the moment either one is created.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

const TYPE_OPTIONS = [
  { value: 'payment', label: 'Payment' },
  { value: 'quality', label: 'Quality' },
  { value: 'logistics', label: 'Logistics' },
  { value: 'document', label: 'Document' },
  { value: 'LC', label: 'Letter of credit' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'other', label: 'Other' },
] as const;

export function CreateCaseForm({
  dealId,
  shipmentId,
  payments,
}: {
  dealId: string;
  shipmentId: string | null;
  payments: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<(typeof TYPE_OPTIONS)[number]['value']>('other');
  const [severity, setSeverity] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  const [context, setContext] = useState<'none' | 'shipment' | string>('none');
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: boolean } | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ data: { dispute_created: boolean } }>(`/api/v1/deals/${dealId}/disputes`, {
        type,
        severity,
        summary: summary.trim(),
        shipment_id: context === 'shipment' ? shipmentId : null,
        payment_id: context !== 'none' && context !== 'shipment' ? context : null,
      });
      setResult({ created: res.data.dispute_created });
      setOpen(false);
      setSummary('');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not open a case. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div>
        <Button onClick={() => { setOpen(true); setResult(null); }}>Open a case</Button>
        {result ? (
          <p className="mt-1.5 text-xs text-[var(--color-text-secondary)]">
            {result.created ? 'A new case was opened.' : 'This looked like a case you already have open — linked to it instead of opening a duplicate.'}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="max-w-md rounded-md border border-[var(--color-border)] bg-surface-muted p-3">
      <label className="block text-xs font-medium text-primary">
        Type
        <select
          value={type}
          onChange={(e) => setType(e.target.value as typeof type)}
          className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring"
        >
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>

      <label className="mt-2 block text-xs font-medium text-primary">
        Severity
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value as typeof severity)}
          className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring"
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
      </label>

      {shipmentId || payments.length > 0 ? (
        <label className="mt-2 block text-xs font-medium text-primary">
          Relates to
          <select
            value={context}
            onChange={(e) => setContext(e.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring"
          >
            <option value="none">This deal generally</option>
            {shipmentId ? <option value="shipment">The shipment</option> : null}
            {payments.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="mt-2 block text-xs font-medium text-primary">
        What is the issue?
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring"
        />
      </label>

      {error ? <p className="mt-2 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
      <div className="mt-3 flex gap-2">
        <Button disabled={busy || summary.trim().length === 0} onClick={() => void submit()} className="min-h-9 px-4 text-sm">
          {busy ? 'Sending…' : 'Submit'}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)} className="min-h-9 px-4 text-sm">
          Cancel
        </Button>
      </div>
    </div>
  );
}
