'use client';

/**
 * AGT-05 terms editor — draft vs. proposed (the "Required UI states" table).
 *
 * The editor is only ever offered for a DRAFT. Once a version is sent to the exporter it
 * is frozen: "Revise" creates a new version rather than editing the one the exporter is
 * looking at (AGT-05-AC04, "do not mutate an accepted historical version"). That rule is
 * enforced server-side too — this component just refuses to present an affordance the
 * server would reject.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, StatusChip } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

export interface TermsFormValues {
  quantity: string;
  unit: string;
  unit_price_amount: string;
  unit_price_currency: string;
  total_amount: string;
  total_currency: string;
  incoterm: string;
  incoterm_place: string;
  payment_type: string;
  payment_description: string;
  ship_window_start: string;
  ship_window_end: string;
  special_conditions: string;
  agent_note: string;
  buyer_status: string;
  buyer_status_note: string;
}

const BUYER_STATUS_OPTIONS = [
  { value: '', label: 'Not recorded' },
  { value: 'no_response', label: 'No response yet' },
  { value: 'verbal_interest', label: 'Verbal interest only' },
  { value: 'negotiating', label: 'Negotiating' },
  { value: 'accepted', label: 'Accepted in writing' },
  { value: 'declined', label: 'Declined' },
];

const PAYMENT_TYPES = ['TT', 'LC', 'DA', 'DP', 'open_account', 'advance'];

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-primary">{label}</span>
      {children}
      {hint ? <span className="mt-0.5 block text-xs text-[var(--color-text-secondary)]">{hint}</span> : null}
    </label>
  );
}

const inputClass =
  'mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-3 py-2 text-sm text-primary focus-visible-ring';

export function TermsEditor({
  dealId,
  initial,
  canEdit,
  isDraft,
}: {
  dealId: string;
  initial: TermsFormValues;
  canEdit: boolean;
  isDraft: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState<TermsFormValues>(initial);
  const [busy, setBusy] = useState<null | 'save_draft' | 'propose'>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);

  const set = <K extends keyof TermsFormValues>(key: K, value: TermsFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const submit = async (action: 'save_draft' | 'propose') => {
    setBusy(action);
    setError(null);
    setFieldErrors([]);
    try {
      await apiPost(`/api/v1/deals/${dealId}/proposals`, {
        action,
        quantity: values.quantity || null,
        unit: values.unit || null,
        unit_price_amount: values.unit_price_amount || null,
        unit_price_currency: values.unit_price_currency || null,
        total_amount: values.total_amount || null,
        total_currency: values.total_currency || null,
        incoterm: values.incoterm || null,
        incoterm_place: values.incoterm_place || null,
        payment_terms:
          values.payment_type && values.payment_description
            ? { type: values.payment_type, description: values.payment_description }
            : null,
        ship_window_start: values.ship_window_start || null,
        ship_window_end: values.ship_window_end || null,
        special_conditions: values.special_conditions || null,
        agent_note: values.agent_note || null,
        buyer_status: values.buyer_status || null,
        buyer_status_note: values.buyer_status_note || null,
      });
      router.refresh();
    } catch (e) {
      if (e instanceof ApiClientError) {
        setError(e.message);
        setFieldErrors((e.fields ?? []).map((f) => `${f.field}: ${f.message}`));
      } else {
        setError('Could not save. Please retry.');
      }
    } finally {
      setBusy(null);
    }
  };

  if (!canEdit) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Terms editor</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          These terms are locked by the deal snapshot. Changing them requires an amendment, which writes a
          new snapshot version rather than editing the frozen one.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-primary">Terms editor</h2>
        <StatusChip
          label={isDraft ? 'Editing draft' : 'Will create a new version'}
          tone={isDraft ? 'neutral' : 'info'}
          icon={isDraft ? 'dot' : 'spark'}
          size="sm"
          detail={
            isDraft
              ? 'This draft has not been sent to the exporter yet.'
              : 'The current version was already sent, so saving creates a new version instead of editing it.'
          }
        />
      </div>

      {error ? (
        <div
          role="alert"
          className="mt-3 rounded-md border border-[color-mix(in_srgb,var(--color-critical)_25%,transparent)] bg-[color-mix(in_srgb,var(--color-critical)_5%,transparent)] p-3 text-sm text-[var(--color-critical-text)]"
        >
          <p className="font-medium">{error}</p>
          {fieldErrors.length ? (
            <ul className="mt-1 list-inside list-disc">
              {fieldErrors.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Quantity">
          <input className={inputClass} value={values.quantity} onChange={(e) => set('quantity', e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Unit" hint="e.g. kg, sets, cartons">
          <input className={inputClass} value={values.unit} onChange={(e) => set('unit', e.target.value)} />
        </Field>
        <Field label="Unit price">
          <input className={inputClass} value={values.unit_price_amount} onChange={(e) => set('unit_price_amount', e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Unit price currency" hint="3-letter code — money always carries its currency">
          <input className={inputClass} maxLength={3} value={values.unit_price_currency} onChange={(e) => set('unit_price_currency', e.target.value.toUpperCase())} />
        </Field>
        <Field label="Total value">
          <input className={inputClass} value={values.total_amount} onChange={(e) => set('total_amount', e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Total currency">
          <input className={inputClass} maxLength={3} value={values.total_currency} onChange={(e) => set('total_currency', e.target.value.toUpperCase())} />
        </Field>
        <Field label="Incoterm">
          <input className={inputClass} value={values.incoterm} onChange={(e) => set('incoterm', e.target.value.toUpperCase())} />
        </Field>
        <Field label="Incoterm place" hint="Named port or place the Incoterm qualifies">
          <input className={inputClass} value={values.incoterm_place} onChange={(e) => set('incoterm_place', e.target.value)} />
        </Field>
        <Field label="Payment type">
          <select className={inputClass} value={values.payment_type} onChange={(e) => set('payment_type', e.target.value)}>
            <option value="">Choose…</option>
            {PAYMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Payment terms" hint="Advance %, balance trigger, LC/TT details">
          <input className={inputClass} value={values.payment_description} onChange={(e) => set('payment_description', e.target.value)} />
        </Field>
        <Field label="Ship window start">
          <input type="date" className={inputClass} value={values.ship_window_start} onChange={(e) => set('ship_window_start', e.target.value)} />
        </Field>
        <Field label="Ship window end">
          <input type="date" className={inputClass} value={values.ship_window_end} onChange={(e) => set('ship_window_end', e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Special conditions">
            <input className={inputClass} value={values.special_conditions} onChange={(e) => set('special_conditions', e.target.value)} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Note to the exporter" hint="Exporter-visible rationale. Internal reasoning belongs in an internal note.">
            <textarea rows={2} className={inputClass} value={values.agent_note} onChange={(e) => set('agent_note', e.target.value)} />
          </Field>
        </div>
      </div>

      <div className="mt-6 border-t border-[var(--color-border)] pt-4">
        <h3 className="text-sm font-semibold text-primary">Buyer status</h3>
        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
          What the buyer has actually committed to. Verbal interest is not acceptance — record it as what it
          is.
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field label="Buyer position">
            <select className={inputClass} value={values.buyer_status} onChange={(e) => set('buyer_status', e.target.value)}>
              {BUYER_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Evidence / note">
            <input className={inputClass} value={values.buyer_status_note} onChange={(e) => set('buyer_status_note', e.target.value)} />
          </Field>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy !== null} onClick={() => void submit('save_draft')}>
          {busy === 'save_draft' ? 'Saving…' : 'Save draft'}
        </Button>
        <Button disabled={busy !== null} onClick={() => void submit('propose')}>
          {busy === 'propose' ? 'Sending…' : 'Send to exporter for approval'}
        </Button>
      </div>
      <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
        Sending freezes this version and creates the exporter&apos;s approval task. You cannot approve it
        yourself.
      </p>
    </div>
  );
}
