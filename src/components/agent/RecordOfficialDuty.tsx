'use client';

/**
 * D-024: where a market's duty is only estimated, the agent reads the official tariff (the link the
 * tariff directory gives) and records the product's declarable line here. One line, as published,
 * with the date it applies from and where it was read. The server decides who may record and for
 * which market and HS code; the next analysis run uses the record and says an agent read it.
 */

import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

export function RecordOfficialDuty({ assessmentId, countryCode, sourceUrl, authority }: { assessmentId: string; countryCode: string; sourceUrl: string | null; authority: string }) {
  const [open, setOpen] = useState(false);
  const [line, setLine] = useState('');
  const [description, setDescription] = useState('');
  const [duty, setDuty] = useState('');
  const [from, setFrom] = useState('');
  const [source, setSource] = useState(sourceUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const id = (name: string) => `duty-${name}-${assessmentId}`;
  const field = 'focus-visible-ring mt-1 w-full rounded border border-[var(--color-border-strong)] bg-surface px-2 py-1.5 text-sm text-primary';

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const recorded = await apiPost<{ national_tariff_code: string | null; duty_expression: string }>('/api/v1/market-access/manual-captures', {
        market_assessment_id: assessmentId, national_tariff_code: line, description, duty_expression: duty, effective_from: from, source_reference: source, source_authority: authority,
      });
      setSaved(`Recorded ${recorded.duty_expression} on line ${recorded.national_tariff_code ?? line}. The next analysis run for this product uses it.`);
      setOpen(false);
    } catch (e) {
      // The server's own message says which field is wrong or why recording is not allowed.
      setError(e instanceof ApiClientError ? [e.message, ...(e.fields ?? []).map((item) => item.message)].join(' ') : 'Could not record the duty. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => { setOpen(true); setSaved(null); }}>Record the official duty</Button>
        {saved ? <p role="status" className="text-xs text-[var(--color-text-secondary)]">{saved}</p> : null}
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border border-[var(--color-border-strong)] bg-surface-muted p-2.5">
      <p className="text-xs font-semibold text-primary">Official duty — {countryCode}</p>
      <p className="text-xs text-[var(--color-text-secondary)]">Copy the product&apos;s line from the official tariff exactly as published. It is recorded against your name.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label htmlFor={id('line')} className="block text-xs font-medium text-primary">National tariff line</label>
          <input id={id('line')} value={line} onChange={(e) => setLine(e.target.value)} inputMode="numeric" placeholder="e.g. 74181000" className={field} />
        </div>
        <div>
          <label htmlFor={id('duty')} className="block text-xs font-medium text-primary">Duty as published</label>
          <input id={id('duty')} value={duty} onChange={(e) => setDuty(e.target.value)} placeholder="e.g. 10% or 5% + 2 USD/kg" className={field} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={id('description')} className="block text-xs font-medium text-primary">Description on that line</label>
          <input id={id('description')} value={description} onChange={(e) => setDescription(e.target.value)} className={field} />
        </div>
        <div>
          <label htmlFor={id('from')} className="block text-xs font-medium text-primary">Applies from</label>
          <input id={id('from')} type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={field} />
        </div>
        <div>
          <label htmlFor={id('source')} className="block text-xs font-medium text-primary">Where you read it</label>
          <input id={id('source')} type="url" value={source} onChange={(e) => setSource(e.target.value)} placeholder="https://" className={field} />
        </div>
      </div>
      {error ? (
        <p role="alert" className="rounded border border-[color-mix(in_srgb,var(--color-critical)_30%,transparent)] bg-[color-mix(in_srgb,var(--crit-fill)_8%,var(--card))] px-2 py-1 text-xs text-critical">{error}</p>
      ) : null}
      <div className="flex gap-2">
        <Button type="button" onClick={submit} disabled={busy} className="min-h-8 px-3 text-xs">{busy ? 'Recording…' : 'Record duty'}</Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={busy} className="min-h-8 px-3 text-xs">Cancel</Button>
      </div>
    </div>
  );
}
