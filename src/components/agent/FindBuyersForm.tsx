'use client';

/**
 * "Find buyers from official lists" on the agent's Exporter 360 (D-033, docs/38 §2). Starts one
 * `buyer_discovery` job for a product and market, follows it, and refreshes the page when it ends so
 * the buyer control below shows what it found.
 */

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, StatusChip } from '@/components/ui';
import { useJobPoll } from '@/hooks';
import { ApiClientError, apiPost } from '@/lib/api-client';
import type { SingleResponse } from '@/types';

export interface FindBuyersMarket {
  code: string;
  name: string;
  /** Why the market cannot be searched yet, e.g. no list imported. Null when it can. */
  unavailable: string | null;
}

export function FindBuyersForm({
  exporterOrgId,
  products,
  markets,
}: {
  exporterOrgId: string;
  products: { id: string; name: string; hs6: string }[];
  markets: FindBuyersMarket[];
}) {
  const router = useRouter();
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const firstOpen = markets.find((market) => !market.unavailable)?.code ?? markets[0]?.code ?? '';
  const [country, setCountry] = useState(firstOpen);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { job } = useJobPoll(jobId);
  const finished = job && ['completed', 'partial', 'failed', 'cancelled'].includes(job.status);

  useEffect(() => {
    if (finished) router.refresh();
  }, [finished, router]);

  const market = markets.find((item) => item.code === country) ?? null;

  async function start() {
    setBusy(true);
    setError(null);
    setJobId(null);
    try {
      const res = await apiPost<SingleResponse<{ job_id: string }>>(`/api/v1/exporters/${exporterOrgId}/buyer-discovery`, { product_id: productId, country_code: country });
      setJobId(res.data.job_id);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not start buyer discovery.');
    } finally {
      setBusy(false);
    }
  }

  if (products.length === 0) {
    return <p className="text-sm text-[var(--color-text-secondary)]">No product has a confirmed HS code yet, so there is nothing to look up.</p>;
  }

  const result = (job?.result ?? null) as { importers_found?: number; outcome?: string; reason?: string; lists?: string[] } | null;
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-surface-muted p-4">
      <h3 className="text-sm font-semibold text-primary">Find buyers from official importer lists</h3>
      <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Businesses the government&rsquo;s own list shows importing the product&rsquo;s HS code. Nothing is sent to anyone.</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-xs text-[var(--color-text-secondary)]">
          Product
          <select value={productId} onChange={(e) => setProductId(e.target.value)} className="mt-1 block rounded-md border border-[var(--color-border)] bg-surface px-3 py-2 text-sm text-primary focus-visible-ring">
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} (HS {product.hs6})
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--color-text-secondary)]">
          Market
          <select value={country} onChange={(e) => setCountry(e.target.value)} className="mt-1 block rounded-md border border-[var(--color-border)] bg-surface px-3 py-2 text-sm text-primary focus-visible-ring">
            {markets.map((item) => (
              <option key={item.code} value={item.code}>
                {item.name}
                {item.unavailable ? ' (not available yet)' : ''}
              </option>
            ))}
          </select>
        </label>
        <Button onClick={start} disabled={busy || !productId || !market || Boolean(market.unavailable) || Boolean(jobId && !finished)}>
          {busy ? 'Starting…' : 'Find buyers'}
        </Button>
      </div>
      {market?.unavailable ? <p className="mt-2 text-xs text-[var(--color-text-secondary)]">{market.unavailable}</p> : null}
      {jobId && !finished ? <StatusChip className="mt-3" label="Reading the list and screening names…" tone="neutral" icon="clock" size="sm" /> : null}
      {finished && job?.status === 'completed' && result ? (
        <p className="mt-3 text-xs text-primary">
          {result.outcome === 'completed' ? `${result.importers_found ?? 0} importers found${result.lists?.length ? ` in the ${result.lists.join(', ')} list` : ''}. They are listed below.` : result.reason}
        </p>
      ) : null}
      {finished && job?.status !== 'completed' ? <p className="mt-3 text-xs text-critical">{job?.error?.message ?? 'Buyer discovery did not finish.'}</p> : null}
      {error ? <p className="mt-2 text-xs text-critical">{error}</p> : null}
    </div>
  );
}
