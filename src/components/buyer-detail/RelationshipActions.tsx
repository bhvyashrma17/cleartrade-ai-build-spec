'use client';

/**
 * EXP-07 "Shortlist / Create lead" — idempotent per docs/04, and AC02 (duplicate
 * BuyerLead prevented server-side) surfaces here as a graceful "already a lead" message
 * rather than a raw error, since the server's `DUPLICATE_LEAD` response is expected
 * traffic on this page, not a failure — the exporter may have leads for other products
 * on this same buyer already.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

export function RelationshipActions({
  buyerId,
  products,
  isShortlisted,
}: {
  buyerId: string;
  products: { id: string; name: string }[];
  isShortlisted: boolean;
}) {
  const router = useRouter();
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [busy, setBusy] = useState<'shortlist' | 'lead' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const shortlist = async () => {
    setBusy('shortlist');
    setError(null);
    setNotice(null);
    try {
      await apiPost('/api/v1/buyer-shortlists', { buyer_id: buyerId, product_id: productId || null });
      setNotice('Shortlisted.');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not shortlist this buyer.');
    } finally {
      setBusy(null);
    }
  };

  const createLead = async () => {
    if (!productId) return;
    setBusy('lead');
    setError(null);
    setNotice(null);
    try {
      await apiPost('/api/v1/buyer-leads', { buyer_id: buyerId, product_id: productId });
      setNotice('Lead created.');
      router.refresh();
    } catch (e) {
      if (e instanceof ApiClientError && e.code === 'DUPLICATE_LEAD') {
        setNotice('This buyer is already a lead for this product.');
        router.refresh();
        return;
      }
      setError(e instanceof ApiClientError ? e.message : 'Could not create the lead.');
    } finally {
      setBusy(null);
    }
  };

  if (products.length === 0) {
    return <p className="text-sm text-[var(--color-text-secondary)]">Add a product to your profile to shortlist or create a lead.</p>;
  }

  return (
    <div className="max-w-sm">
      {products.length > 1 ? (
        <label className="mb-2 block text-xs font-medium text-primary">
          Product
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring"
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
      ) : null}

      {error ? <p className="mb-2 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
      {notice ? <p className="mb-2 text-xs text-[var(--color-text-secondary)]">{notice}</p> : null}

      <div className="flex flex-wrap gap-2">
        {!isShortlisted ? (
          <Button variant="secondary" disabled={busy !== null} onClick={() => void shortlist()} className="min-h-9 px-4 text-sm">
            {busy === 'shortlist' ? 'Saving…' : 'Shortlist'}
          </Button>
        ) : null}
        <Button disabled={busy !== null} onClick={() => void createLead()} className="min-h-9 px-4 text-sm">
          {busy === 'lead' ? 'Creating…' : 'Create lead'}
        </Button>
      </div>
    </div>
  );
}
