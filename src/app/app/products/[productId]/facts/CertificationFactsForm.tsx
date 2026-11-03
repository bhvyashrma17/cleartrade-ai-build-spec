'use client';

import { useState } from 'react';
import { Button, Card, Input, SectionHeading, StatusChip } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';
import { dependenciesForProductFact } from '@/lib/product-profile';

interface CertificationRow {
  code: string;
  name: string;
  status: string;
  declaration_state: string;
  verification_state: string;
  issuer: string | null;
  certificate_reference: string | null;
  issue_date: string | null;
  valid_until: string | null;
}

const empty = { code: '', name: '', declaration_state: 'declared_held', issuer: '', certificate_reference: '', issue_date: '', valid_until: '', evidence_ref: '' };

export function CertificationFactsForm({ exporterOrgId, productId, initial }: { exporterOrgId: string; productId: string; initial: CertificationRow[] }) {
  const [rows, setRows] = useState(initial);
  const [form, setForm] = useState(empty);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof empty) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const date = (value: string) => value ? new Date(`${value}T00:00:00.000Z`).toISOString() : null;

  async function save() {
    setBusy(true); setError(null);
    try {
      const response = await apiPost<{ data: { code: string; status: string; declaration_state: string; verification_state: string } }>(`/api/v1/exporters/${exporterOrgId}/products/${productId}/operational-facts/certifications`, {
        ...form,
        issuer: form.issuer || null,
        certificate_reference: form.certificate_reference || null,
        issue_date: date(form.issue_date),
        valid_until: date(form.valid_until),
        evidence_ref: form.evidence_ref || null,
      });
      const saved = { ...form, ...response.data, issue_date: date(form.issue_date), valid_until: date(form.valid_until) };
      setRows((current) => [...current.filter((row) => row.code !== saved.code), saved]);
      setForm(empty); setOpen(false);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Could not save this certification.');
    } finally { setBusy(false); }
  }

  return (
    <Card as="section">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionHeading title="Certifications" description="A declaration and a ClearTrade verification are separate states. Silence remains unknown." />
        <Button size="sm" variant="secondary" onClick={() => setOpen((value) => !value)}>{open ? 'Cancel' : 'Add certification'}</Button>
      </div>
      {rows.length ? (
        <ul className="mt-3 space-y-2">
          {rows.map((row) => {
            const expired = row.valid_until != null && new Date(row.valid_until).getTime() <= Date.now();
            return (
              <li key={row.code} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2 last:border-0">
                <div><p className="text-sm font-medium text-bone">{row.name}</p><p className="text-xs text-muted">{row.issuer ?? 'Issuer unknown'} · {row.certificate_reference ?? 'Reference unknown'}</p></div>
                <div className="flex gap-2">
                  <StatusChip label={expired ? 'Expired' : row.declaration_state === 'declared_absent' ? 'Exporter declared absent' : row.status.replaceAll('_', ' ')} tone={expired ? 'warning' : 'neutral'} icon={expired ? 'alert' : 'dot'} size="sm" />
                  <StatusChip label={row.verification_state.replaceAll('_', ' ')} tone={row.verification_state === 'agent_verified' && !expired ? 'positive' : 'neutral'} icon={row.verification_state === 'agent_verified' && !expired ? 'check' : 'dot'} size="sm" />
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-3 text-sm text-slate">
          <p>No certification has been declared. This means unknown, not absent.</p>
          <p className="mt-1 text-xs text-muted">Helps: {dependenciesForProductFact('certifications').join(', ')}</p>
        </div>
      )}
      {open ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Input label="Certification type / code" value={form.code} onChange={set('code')} />
          <Input label="Certification name" value={form.name} onChange={set('name')} />
          <label className="text-xs text-muted">Exporter declaration
            <select value={form.declaration_state} onChange={set('declaration_state')} className="mt-1 min-h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-bone">
              <option value="declared_held">Exporter says they hold it</option>
              <option value="declared_absent">Exporter explicitly says they do not hold it</option>
            </select>
          </label>
          <Input label="Issuer" value={form.issuer} onChange={set('issuer')} />
          <Input label="Certificate reference" value={form.certificate_reference} onChange={set('certificate_reference')} />
          <Input label="Issue date" type="date" value={form.issue_date} onChange={set('issue_date')} />
          <Input label="Expiry date" type="date" value={form.valid_until} onChange={set('valid_until')} />
          <Input label="Evidence reference" value={form.evidence_ref} onChange={set('evidence_ref')} />
          {error ? <p className="text-sm text-[var(--color-critical-text)] sm:col-span-2" role="alert">{error}</p> : null}
          <div className="sm:col-span-2"><Button onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save exporter declaration'}</Button></div>
        </div>
      ) : null}
    </Card>
  );
}
