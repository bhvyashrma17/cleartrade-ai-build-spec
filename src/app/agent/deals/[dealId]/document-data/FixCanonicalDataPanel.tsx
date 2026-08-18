'use client';

/**
 * The correction surface.
 *
 * Each section posts to the route that owns the fact — exporter master data to the exporter,
 * buyer address to the tenant-scoped buyer profile, ports and freight to the shipment, the FX
 * rate to the exchange-rate log. There is no endpoint here that writes into a document, and no
 * combined "document data" payload: that shape is what turns a document system into a second
 * database.
 *
 * Saving calls `router.refresh()` so readiness is recomputed on the server. The panel never
 * decides for itself whether a document became ready.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Input } from '@/components/ui';
import { ApiClientError, apiPatch, apiPost } from '@/lib/api-client';

type Fields = Record<string, string | null>;

/** Only fields the agent actually changed are sent, so a save never blanks a sibling field. */
function changedOnly(next: Fields, original: Fields): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(next)) {
    const before = original[key] ?? '';
    const after = value ?? '';
    if (before !== after) out[key] = after === '' ? null : after;
  }
  return out;
}

function Section({
  title, note, fields, original, onSave,
}: {
  title: string;
  note: string;
  fields: { key: string; label: string; placeholder?: string }[];
  original: Fields;
  onSave: (changed: Record<string, string | null>) => Promise<unknown>;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Fields>(original);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const changed = changedOnly(values, original);
  const dirty = Object.keys(changed).length > 0;

  const submit = async () => {
    setBusy(true); setError(null); setSaved(false);
    try {
      await onSave(changed);
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-surface p-4 shadow-card">
      <h2 className="text-sm font-semibold text-primary">{title}</h2>
      <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{note}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <Input
            key={f.key}
            id={`fix-${f.key}`}
            label={f.label}
            placeholder={f.placeholder}
            value={values[f.key] ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
          />
        ))}
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-[var(--color-danger)]">{error}</p> : null}
      {saved && !dirty ? <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Saved.</p> : null}
      <Button type="button" className="mt-3" onClick={submit} disabled={busy || !dirty}>
        {busy ? 'Saving…' : 'Save'}
      </Button>
    </section>
  );
}

export function FixCanonicalDataPanel(props: {
  dealId: string;
  exporterOrgId: string;
  hasShipment: boolean;
  issuedInvoiceNumber: string | null;
  nextInvoiceNumberPreview: string;
  dealCurrency: string | null;
  exporter: Fields;
  buyer: Fields;
  shipment: Fields;
}) {
  const router = useRouter();
  const [rate, setRate] = useState({ rate: '', source_reference: '', rate_date: '' });
  const [rateSource, setRateSource] = useState('bank_quoted');
  const [rateError, setRateError] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);

  const recordRate = async () => {
    setRateError(null);
    try {
      await apiPost(`/api/v1/deals/${props.dealId}/exchange-rates`, {
        base_currency: props.dealCurrency,
        quote_currency: 'INR',
        rate: rate.rate.trim(),
        source: rateSource,
        source_reference: rate.source_reference.trim() || null,
        rate_date: new Date(rate.rate_date || Date.now()).toISOString(),
      });
      setRate({ rate: '', source_reference: '', rate_date: '' });
      router.refresh();
    } catch (e) {
      setRateError(e instanceof ApiClientError ? e.message : 'Could not record the rate.');
    }
  };

  const issueNumber = async () => {
    setIssuing(true); setIssueError(null);
    try {
      await apiPost(`/api/v1/deals/${props.dealId}/invoice-number`, {});
      router.refresh();
    } catch (e) {
      setIssueError(e instanceof ApiClientError ? e.message : 'Could not issue the number.');
    } finally {
      setIssuing(false);
    }
  };

  return (
    <div className="space-y-4">
      <Section
        title="Exporter record"
        note="Corrects the exporter organisation itself, so every document and every deal sees the fix."
        original={props.exporter}
        fields={[
          { key: 'address_line1', label: 'Address line 1' },
          { key: 'address_line2', label: 'Address line 2' },
          { key: 'city', label: 'City' },
          { key: 'state', label: 'State' },
          { key: 'postal_code', label: 'Postal code' },
          { key: 'ad_code', label: 'AD code', placeholder: 'Bank-assigned Authorised Dealer code' },
        ]}
        onSave={(changed) => apiPatch(`/api/v1/exporters/${props.exporterOrgId}/master-data`, changed)}
      />

      <Section
        title="Buyer record"
        note="Held against this exporter and this buyer. The shared buyer profile other tenants see is not touched."
        original={props.buyer}
        fields={[
          { key: 'document_name', label: 'Name on documents', placeholder: 'Only if it differs from the legal name' },
          { key: 'address_line1', label: 'Address line 1' },
          { key: 'address_line2', label: 'Address line 2' },
          { key: 'city', label: 'City' },
          { key: 'region', label: 'State / region' },
          { key: 'postal_code', label: 'Postal code' },
          { key: 'country_code', label: 'Country code', placeholder: 'DE' },
          { key: 'tax_identifier', label: 'Tax identifier' },
          { key: 'tax_identifier_type', label: 'Identifier type', placeholder: 'VAT, EORI, GST…' },
        ]}
        onSave={(changed) => apiPatch(`/api/v1/deals/${props.dealId}/buyer-profile`, changed)}
      />

      {props.hasShipment ? (
        <Section
          title="Shipment"
          note="Ports, transport references and freight. Leave a UN/LOCODE blank rather than guessing it."
          original={props.shipment}
          fields={[
            { key: 'port_of_loading_name', label: 'Port of loading' },
            { key: 'port_of_loading_unlocode', label: 'Loading UN/LOCODE', placeholder: 'INNSA' },
            { key: 'port_of_discharge_name', label: 'Port of discharge' },
            { key: 'port_of_discharge_unlocode', label: 'Discharge UN/LOCODE', placeholder: 'AEDXB' },
            { key: 'marks_and_numbers', label: 'Marks and numbers' },
            { key: 'vessel_or_flight_no', label: 'Vessel / flight' },
            { key: 'container_no', label: 'Container number' },
            { key: 'freight_amount', label: 'Freight amount' },
            { key: 'freight_currency', label: 'Freight currency', placeholder: 'USD' },
          ]}
          onSave={(changed) => apiPatch(`/api/v1/deals/${props.dealId}/shipment/execution`, changed)}
        />
      ) : (
        <section className="rounded-lg border border-dashed border-[var(--color-border)] bg-surface-muted p-4 text-sm text-[var(--color-text-secondary)]">
          Shipment fields become editable once this deal has a shipment. Ports and transport
          references belong to the shipment, so there is nowhere correct to put them yet.
        </section>
      )}

      {props.dealCurrency && props.dealCurrency !== 'INR' ? (
        <section className="rounded-lg border border-[var(--color-border)] bg-surface p-4 shadow-card">
          <h2 className="text-sm font-semibold text-primary">Exchange rate ({props.dealCurrency} → INR)</h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
            Recorded, never edited — a later correction supersedes this one and leaves documents
            already issued against it explainable. A rate attributed to RBI or customs must cite
            the notification.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Input id="fx-rate" label="Rate" value={rate.rate} placeholder="88.4250"
              onChange={(e) => setRate((r) => ({ ...r, rate: e.target.value }))} />
            <label className="block text-sm font-medium text-primary">
              <span className="mb-1 block">Source</span>
              <select
                value={rateSource}
                onChange={(e) => setRateSource(e.target.value)}
                className="focus-visible-ring min-h-10 w-full rounded border border-[var(--color-border-strong)] bg-surface px-2 text-sm text-primary"
              >
                <option value="bank_quoted">Bank quoted</option>
                <option value="rbi_reference">RBI reference</option>
                <option value="customs_notified">Customs notified</option>
                <option value="manual_entry">Manual entry</option>
              </select>
            </label>
            <Input id="fx-ref" label="Citation" placeholder="Notification / quote reference"
              value={rate.source_reference}
              onChange={(e) => setRate((r) => ({ ...r, source_reference: e.target.value }))} />
            <Input id="fx-date" label="Rate date" type="date" value={rate.rate_date}
              onChange={(e) => setRate((r) => ({ ...r, rate_date: e.target.value }))} />
          </div>
          {rateError ? <p role="alert" className="mt-2 text-sm text-[var(--color-danger)]">{rateError}</p> : null}
          <Button type="button" className="mt-3" onClick={recordRate} disabled={!rate.rate.trim()}>
            Record rate
          </Button>
        </section>
      ) : null}

      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-4 shadow-card">
        <h2 className="text-sm font-semibold text-primary">Invoice number</h2>
        {props.issuedInvoiceNumber ? (
          <p className="mt-1 text-sm text-primary">
            Issued: <span className="font-mono">{props.issuedInvoiceNumber}</span>
          </p>
        ) : (
          <>
            <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
              Nothing has been allocated yet. Previewing or rendering a document never consumes a
              number — issuing is this button and nothing else. Next in the series would be{' '}
              <span className="font-mono">{props.nextInvoiceNumberPreview}</span>, which is an
              estimate until it is actually issued.
            </p>
            {issueError ? <p role="alert" className="mt-2 text-sm text-[var(--color-danger)]">{issueError}</p> : null}
            <Button type="button" className="mt-3" onClick={issueNumber} disabled={issuing}>
              {issuing ? 'Issuing…' : 'Issue invoice number'}
            </Button>
          </>
        )}
      </section>
    </div>
  );
}
