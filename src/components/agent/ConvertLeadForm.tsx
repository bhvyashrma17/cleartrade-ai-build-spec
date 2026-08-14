'use client';

/**
 * AGT-04 "Conversion panel: proposed commercial terms and Create Deal | Only once the
 * interest threshold is reached by business policy". The page only renders this
 * component once the lead is at `negotiation` — the server independently re-enforces
 * that via `assertLeadTransition` (only `negotiation -> converted` is a legal move), so
 * a client bypass can't create a deal from an earlier-stage lead.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

export function ConvertLeadForm({ buyerLeadId }: { buyerLeadId: string }) {
  const router = useRouter();
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [unitPriceAmount, setUnitPriceAmount] = useState('');
  const [unitPriceCurrency, setUnitPriceCurrency] = useState('USD');
  const [incoterm, setIncoterm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dealId, setDealId] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ data: { deal: { id: string } } }>(`/api/v1/leads/${buyerLeadId}/convert`, {
        quantity: quantity ? Number(quantity) : undefined,
        unit: unit || undefined,
        unit_price_amount: unitPriceAmount ? Number(unitPriceAmount) : undefined,
        unit_price_currency: unitPriceAmount ? unitPriceCurrency : undefined,
        incoterm: incoterm || undefined,
      });
      setDealId(res.data.deal.id);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not create the deal. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  if (dealId) {
    return (
      <p className="text-sm text-primary">
        Deal created —{' '}
        <a href={`/agent/deals/${dealId}`} className="focus-visible-ring font-medium underline underline-offset-2">
          open the deal workspace
        </a>
      </p>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <label>
          Quantity
          <input value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="decimal" className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-primary focus-visible-ring" />
        </label>
        <label>
          Unit
          <input value={unit} onChange={(e) => setUnit(e.target.value)} className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-primary focus-visible-ring" />
        </label>
        <label>
          Unit price
          <input value={unitPriceAmount} onChange={(e) => setUnitPriceAmount(e.target.value)} inputMode="decimal" className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-primary focus-visible-ring" />
        </label>
        <label>
          Currency
          <input value={unitPriceCurrency} onChange={(e) => setUnitPriceCurrency(e.target.value)} className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-primary focus-visible-ring" />
        </label>
      </div>
      <label className="mt-2 block text-xs">
        Incoterm
        <input value={incoterm} onChange={(e) => setIncoterm(e.target.value)} placeholder="e.g. FOB" className="mt-0.5 w-full max-w-[10rem] rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-sm text-primary focus-visible-ring" />
      </label>
      {error ? <p className="mt-1.5 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
      <Button disabled={busy} onClick={() => void submit()} className="mt-2 min-h-8 px-3 text-xs">
        {busy ? 'Creating deal…' : 'Create deal'}
      </Button>
    </div>
  );
}
