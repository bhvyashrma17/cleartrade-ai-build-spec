'use client';

/**
 * The exporter's operational facts, in four disclosed groups.
 *
 * Each group explains in plain language why ClearTrade is asking, because "monthly capacity"
 * with no explanation reads as data collection, and "we compare this against what buyers in
 * each market actually order, so we can tell you which markets you can realistically serve"
 * reads as the product doing its job.
 *
 * Everything goes through the Phase 1H `operational-facts` service endpoint, which decides
 * provenance from who is asking — this form never asserts an assertion class, and never writes
 * through Prisma directly.
 */

import { useState } from 'react';
import Link from 'next/link';
import { Button, buttonClass, Card, Input, SectionHeading, StatusChip } from '@/components/ui';
import { ApiClientError, apiPatch } from '@/lib/api-client';

type Facts = Record<string, string>;

interface Field {
  name: string;
  label: string;
  placeholder?: string;
  /** Sent as a number rather than a decimal string. */
  numeric?: boolean;
}

interface Group {
  key: string;
  title: string;
  why: string;
  fields: Field[];
}

const GROUPS: Group[] = [
  {
    key: 'price',
    title: 'Your price',
    why: 'ClearTrade builds a landed cost from your asking price. Without it we cannot tell you what you would actually earn in a market — only what the market imports.',
    fields: [
      { name: 'price_target_amount', label: 'Target price' },
      { name: 'price_target_currency', label: 'Currency', placeholder: 'USD' },
      { name: 'price_target_quantity_unit', label: 'Per unit of', placeholder: 'kg' },
      { name: 'price_target_incoterm', label: 'Incoterm', placeholder: 'FOB' },
    ],
  },
  {
    key: 'capacity',
    title: 'What you can supply',
    why: 'Compared against what buyers in each market typically order, so ClearTrade can tell you which markets you can realistically serve and which would over-stretch you.',
    fields: [
      { name: 'capacity_value', label: 'Production capacity' },
      { name: 'capacity_unit', label: 'Capacity unit', placeholder: 'kg' },
      { name: 'capacity_period', label: 'Per period', placeholder: 'month' },
      { name: 'available_capacity_value', label: 'Capacity free for new orders' },
      { name: 'moq_value', label: 'Minimum order quantity' },
      { name: 'moq_unit', label: 'MOQ unit', placeholder: 'kg' },
      { name: 'lead_time_days', label: 'Production lead time (days)', numeric: true },
      { name: 'delivery_commitment_days', label: 'Delivery commitment (days)', numeric: true },
    ],
  },
  {
    key: 'packaging',
    title: 'Packaging',
    why: 'Some destinations set packaging rules, and pack size can decide which tariff line — and therefore which duty — applies to your goods.',
    fields: [
      { name: 'packaging_format', label: 'Packaging format', placeholder: 'Jute bags' },
      { name: 'pack_size_value', label: 'Pack size' },
      { name: 'pack_size_unit', label: 'Pack size unit', placeholder: 'kg' },
    ],
  },
  {
    key: 'shipping',
    title: 'How you ship',
    why: 'Freight and handling are quoted per shipment or per container. A shipment size turns those quotes into a per-unit cost, and the departure point decides which routes apply.',
    fields: [
      { name: 'shipment_quantity_value', label: 'Typical shipment quantity' },
      { name: 'shipment_quantity_unit', label: 'Shipment unit', placeholder: 'kg' },
      { name: 'shipment_container_type', label: 'Container type', placeholder: '20FT_DRY' },
      { name: 'origin_city', label: 'Origin city' },
      { name: 'origin_state', label: 'Origin state' },
      { name: 'origin_country', label: 'Origin country', placeholder: 'IN' },
      { name: 'origin_gateway_code', label: 'Departure port / airport', placeholder: 'INNSA' },
    ],
  },
];

const NUMERIC_FIELDS = new Set(GROUPS.flatMap((group) => group.fields.filter((field) => field.numeric).map((field) => field.name)));

export function ProductFactsForm({
  exporterOrgId,
  productId,
  initial,
  basePath = '/app/products',
  provenanceNote,
}: {
  exporterOrgId: string;
  productId: string;
  initial: Facts;
  /** Lets the agent surface reuse this component under its own route tree. */
  basePath?: string;
  /** Agent-facing only: who last recorded these facts and when. */
  provenanceNote?: React.ReactNode;
}) {
  const [facts, setFacts] = useState<Facts>(initial);
  const [open, setOpen] = useState<string | null>(GROUPS[0]!.key);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function save(group: Group) {
    setBusy(true);
    setError(null);
    setSaved(false);
    setFieldErrors({});
    try {
      // Only this group's fields are sent, and an empty box is sent as null — an explicit
      // "I do not have this" rather than a silent skip that would leave a stale value in place.
      const body: Record<string, string | number | null> = {};
      for (const field of group.fields) {
        const value = facts[field.name]?.trim() ?? '';
        body[field.name] = value === '' ? null : field.numeric ? Number(value) : value;
      }
      await apiPatch(`/api/v1/exporters/${exporterOrgId}/products/${productId}/operational-facts`, body);
      setSaved(true);
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.fields?.length) {
        setFieldErrors(Object.fromEntries(caught.fields.map((field) => [field.field, field.message])));
      }
      setError(caught instanceof ApiClientError ? caught.message : 'Could not save these details.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {provenanceNote}
      {saved ? <StatusChip label="Saved" tone="positive" icon="check" /> : null}
      {GROUPS.map((group) => {
        const expanded = open === group.key;
        const filled = group.fields.filter((field) => (facts[field.name] ?? '').trim() !== '').length;
        return (
          <Card key={group.key} as="section">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 text-left"
              aria-expanded={expanded}
              aria-controls={`group-${group.key}`}
              onClick={() => setOpen(expanded ? null : group.key)}
            >
              <span>
                <span className="block text-sm font-medium text-bone">{group.title}</span>
                <span className="block text-xs text-muted">
                  {filled} of {group.fields.length} filled in
                </span>
              </span>
              <span aria-hidden="true" className="text-slate">{expanded ? '−' : '+'}</span>
            </button>

            {expanded ? (
              <div id={`group-${group.key}`} className="mt-4">
                <SectionHeading title="Why this is needed" />
                <p className="mt-1 text-sm text-slate">{group.why}</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {group.fields.map((field) => {
                    const errorId = fieldErrors[field.name] ? `err-${field.name}` : undefined;
                    return (
                      <div key={field.name}>
                        <label htmlFor={field.name} className="block text-xs text-muted">{field.label}</label>
                        <Input
                          id={field.name}
                          name={field.name}
                          value={facts[field.name] ?? ''}
                          placeholder={field.placeholder}
                          inputMode={NUMERIC_FIELDS.has(field.name) ? 'numeric' : undefined}
                          aria-invalid={errorId ? true : undefined}
                          aria-describedby={errorId}
                          onChange={(event) => setFacts((current) => ({ ...current, [field.name]: event.target.value }))}
                        />
                        {errorId ? (
                          <p id={errorId} className="mt-1 text-xs text-[var(--crit)]">{fieldErrors[field.name]}</p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                {error ? <p className="mt-3 text-sm text-[var(--crit)]" role="alert">{error}</p> : null}
                <div className="mt-4">
                  <Button onClick={() => save(group)} disabled={busy}>
                    {busy ? 'Saving…' : `Save ${group.title.toLowerCase()}`}
                  </Button>
                </div>
              </div>
            ) : null}
          </Card>
        );
      })}
      <p className="text-xs text-muted">
        ClearTrade handles exchange rates, customs valuation, duty rates, freight quotes and its own fee.
        You are never asked to supply those.
      </p>
      <Link href={`${basePath}/${productId}`} className={buttonClass('secondary', 'md')}>
        Back to product
      </Link>
    </div>
  );
}
