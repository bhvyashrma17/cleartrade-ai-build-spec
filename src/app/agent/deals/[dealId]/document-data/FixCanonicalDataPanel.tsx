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
import { InvoiceNumberAction } from '../InvoiceNumberAction';

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
  id, title, note, usedBy, fields, original, onSave,
}: {
  id?: string;
  title: string;
  note: string;
  usedBy?: string;
  fields: { key: string; label: string; placeholder?: string; mono?: boolean }[];
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
    <section id={id} className="scroll-mt-4 rounded-lg border border-[var(--color-border)] bg-surface p-4 shadow-card">
      <h2 className="text-sm font-semibold text-primary">{title}</h2>
      <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{note}</p>
      {usedBy ? <p className="mt-1 text-xs font-normal text-[var(--color-text-muted)]">Used by: {usedBy}</p> : null}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <Input
            key={f.key}
            id={`fix-${f.key}`}
            label={f.label}
            placeholder={f.placeholder}
            value={values[f.key] ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            className={f.mono ? 'record' : undefined}
          />
        ))}
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-[var(--crit-text)]">{error}</p> : null}
      {saved && !dirty ? <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Saved.</p> : null}
      <Button type="button" className="mt-3" onClick={submit} disabled={busy || !dirty}>
        {busy ? 'Saving…' : 'Save'}
      </Button>
    </section>
  );
}

function SummarySection({
  id, title, note, usedBy, rows,
}: {
  id: string;
  title: string;
  note: string;
  usedBy: string;
  rows: { label: string; value: string | null }[];
}) {
  return (
    <section id={id} className="scroll-mt-4 rounded-lg border border-[var(--color-border)] bg-surface p-4 shadow-card">
      <h2 className="text-sm font-semibold text-primary">{title}</h2>
      <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{note}</p>
      <p className="mt-1 text-xs font-normal text-[var(--color-text-muted)]">Used by: {usedBy}</p>
      <dl className="mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="rounded border border-[var(--color-border)] bg-surface-muted px-3 py-2">
            <dt className="text-xs text-[var(--color-text-muted)]">{row.label}</dt>
            <dd className="mt-0.5 font-medium text-primary">{row.value || 'Not recorded'}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function FixCanonicalDataPanel(props: {
  dealId: string;
  exporterOrgId: string;
  hasShipment: boolean;
  issuedInvoiceNumber: string | null;
  issuedAt: string | null;
  issuedBy: string | null;
  nextInvoiceNumberPreview: string;
  dealCurrency: string | null;
  exporter: Fields;
  buyer: Fields;
  shipment: Fields;
  containers: { container_number: string; verified_gross_mass_kg: string | null; vgm_method: string | null; verifier_name: string | null }[];
  tradeFinance: {
    payment_mechanism: string | null;
    bill_type: string | null;
    tenor_days: string | null;
    place_of_drawing: string | null;
    bank_presentation_type: string | null;
    bank_name: string | null;
    bank_branch: string | null;
    collection_instructions: string | null;
  };
}) {
  const router = useRouter();
  const [rate, setRate] = useState({ rate: '', source_reference: '', rate_date: '' });
  const [rateSource, setRateSource] = useState('bank_quoted');
  const [rateError, setRateError] = useState<string | null>(null);

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

  return (
    <div id="canonical-data" className="space-y-8">
      <section id="party-data" aria-labelledby="party-data-heading" className="scroll-mt-4 space-y-4">
        <div>
          <h2 id="party-data-heading" className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">Parties</h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">Exporter and tenant-scoped buyer facts shared across document families.</p>
        </div>
      <Section
        title="Exporter record"
        note="Corrects the exporter organisation itself, so every document and every deal sees the fix."
        usedBy="commercial, shipping, certificates and banking documents"
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
        usedBy="invoices, packing list, shipping and carrier instructions, bill of exchange"
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
      </section>

      <section id="shipment-instructions" aria-labelledby="shipment-instructions-heading" className="scroll-mt-4 space-y-4">
        <div>
          <h2 id="shipment-instructions-heading" className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">Shipment instructions</h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">Routing, booking, cargo marks and freight facts; not a second document payload.</p>
        </div>
      {props.hasShipment ? (
        <Section
          title="Shipment"
          note="Ports, transport references and freight. Leave a UN/LOCODE blank rather than guessing it."
          usedBy="packing list, shipping bill draft, shipping instructions, carrier instructions and VGM declaration"
          original={props.shipment}
          fields={[
            { key: 'port_of_loading_name', label: 'Port of loading' },
            { key: 'port_of_loading_unlocode', label: 'Loading UN/LOCODE', placeholder: 'INNSA', mono: true },
            { key: 'port_of_discharge_name', label: 'Port of discharge' },
            { key: 'port_of_discharge_unlocode', label: 'Discharge UN/LOCODE', placeholder: 'AEDXB', mono: true },
            { key: 'marks_and_numbers', label: 'Marks and numbers' },
            { key: 'vessel_or_flight_no', label: 'Vessel / flight' },
            { key: 'container_no', label: 'Container number', mono: true },
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
      </section>

      <SummarySection
        id="container-vgm"
        title="Container / VGM"
        note="Verified mass remains a per-container canonical fact. Package weights are never substituted for VGM."
        usedBy="VGM Declaration, Shipping Instructions and Bill of Lading Instructions"
        rows={props.containers.length > 0
          ? props.containers.flatMap((container) => [
              { label: `${container.container_number} · verified gross mass`, value: container.verified_gross_mass_kg ? `${container.verified_gross_mass_kg} kg` : null },
              { label: `${container.container_number} · verification`, value: [container.vgm_method, container.verifier_name].filter(Boolean).join(' · ') || null },
            ])
          : [{ label: 'Containers', value: null }]}
      />

      <section id="payment-draft" aria-labelledby="payment-draft-heading" className="scroll-mt-4 space-y-4">
        <div>
          <h2 id="payment-draft-heading" className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">Payment / draft</h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">Applicability and payable wording come from the deal&apos;s canonical payment workflow.</p>
        </div>
        <SummarySection
          id="payment-draft-details"
          title="Bill of Exchange instructions"
          note="These facts describe the draft. Exporter approval does not mean drawee acceptance."
          usedBy="Bill of Exchange"
          rows={[
            { label: 'Payment mechanism', value: props.tradeFinance.payment_mechanism },
            { label: 'Sight / usance', value: props.tradeFinance.bill_type },
            { label: 'Tenor', value: props.tradeFinance.tenor_days ? `${props.tradeFinance.tenor_days} days` : null },
            { label: 'Place of drawing', value: props.tradeFinance.place_of_drawing },
          ]}
        />
      </section>

      <SummarySection
        id="bank-presentation"
        title="Bank presentation"
        note="Bank, collection and enclosure facts stay on the tenant-scoped bank and trade-finance records."
        usedBy="Bank Document Presentation / Collection Cover Letter"
        rows={[
          { label: 'Presentation type', value: props.tradeFinance.bank_presentation_type },
          { label: 'Bank', value: props.tradeFinance.bank_name },
          { label: 'Branch', value: props.tradeFinance.bank_branch },
          { label: 'Collection instructions', value: props.tradeFinance.collection_instructions },
        ]}
      />

      <section id="commercial-data" aria-labelledby="commercial-data-heading" className="scroll-mt-4 space-y-4">
        <div>
          <h2 id="commercial-data-heading" className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">Commercial data</h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">Invoice numbering and defensible currency conversion.</p>
        </div>
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
              value={rate.source_reference} className="record"
              onChange={(e) => setRate((r) => ({ ...r, source_reference: e.target.value }))} />
            <Input id="fx-date" label="Rate date" type="date" value={rate.rate_date}
              onChange={(e) => setRate((r) => ({ ...r, rate_date: e.target.value }))} />
          </div>
          {rateError ? <p role="alert" className="mt-2 text-sm text-[var(--crit-text)]">{rateError}</p> : null}
          <Button type="button" className="mt-3" onClick={recordRate} disabled={!rate.rate.trim()}>
            Record rate
          </Button>
        </section>
      ) : null}

      <section id="invoice-numbering" className="scroll-mt-4 rounded-lg border border-[var(--color-border)] bg-surface p-4 shadow-card">
        <h2 className="text-sm font-semibold text-primary">Commercial Invoice</h2>
        {props.issuedInvoiceNumber ? (
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[12rem_1fr]">
            <dt className="text-[var(--color-text-secondary)]">Status</dt>
            <dd className="font-medium text-primary">Official invoice number issued</dd>
            <dt className="text-[var(--color-text-secondary)]">Official invoice number</dt>
            <dd className="record text-primary">{props.issuedInvoiceNumber}</dd>
            <dt className="text-[var(--color-text-secondary)]">Issued at</dt>
            <dd className="text-primary">{props.issuedAt ?? 'Not recorded'}</dd>
            <dt className="text-[var(--color-text-secondary)]">Issued by</dt>
            <dd className="text-primary">{props.issuedBy ?? 'System'}</dd>
          </dl>
        ) : (
          <>
            <p className="mt-1 text-sm font-normal text-primary">No official invoice number issued</p>
            <p className="mt-1 max-w-2xl text-xs text-[var(--color-text-secondary)]">
              Commercial Invoice cannot be finalized until a number is issued. Previewing or
              rendering a draft never consumes a number.
            </p>
            <div className="mt-3">
              <InvoiceNumberAction dealId={props.dealId} nextInvoiceNumberPreview={props.nextInvoiceNumberPreview} />
            </div>
          </>
        )}
      </section>
      </section>

      <section id="certificates-data" className="scroll-mt-4 rounded-lg border border-dashed border-[var(--color-border)] bg-surface-muted p-4">
        <h2 className="text-sm font-semibold text-primary">Certificates & declarations</h2>
        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
          Certificate and insurance blockers continue to be corrected on the exporter, shipment,
          insurance and commercial records above; no certificate-only copy is created here.
        </p>
      </section>
    </div>
  );
}
