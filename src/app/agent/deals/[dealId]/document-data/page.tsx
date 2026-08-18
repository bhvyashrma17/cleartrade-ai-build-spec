/**
 * `/agent/deals/:dealId/document-data` — document readiness, and the place to fix it.
 *
 * Inside the existing deal workspace rather than in a separate "document database" screen,
 * because there is no such database: every field on this page edits the model that owns the
 * fact. The panel groups gaps BY OWNER for exactly that reason — an agent sees "the exporter
 * record is missing an AD code", not "the shipping bill is missing a field".
 *
 * Read-only for the readiness itself. Nothing here allocates an invoice number; issuing one
 * is a deliberate button, and the readiness check reports its absence as a gap instead of
 * quietly filling it.
 */

import Link from 'next/link';
import { DocType } from '@prisma/client';
import { StatusChip } from '@/components/ui';
import { allDocumentReadiness, buildDocumentContext, type CanonicalOwner } from '@/lib/document-data';
import { previewNextInvoiceNumber } from '@/lib/invoice-numbering';
import { prisma } from '@/lib/prisma';
import { loadAgentDeal } from '../loadAgentDeal';
import { FixCanonicalDataPanel } from './FixCanonicalDataPanel';

const DOC_LABELS: Record<string, string> = {
  PI: 'Proforma Invoice',
  CI: 'Commercial Invoice',
  packing_list: 'Packing List',
  shipping_bill_draft: 'Shipping Bill (draft)',
  COO_draft: 'Certificate of Origin (draft)',
  declaration: 'Declaration',
  insurance_declaration: 'Insurance declaration',
};

const OWNER_LABELS: Record<CanonicalOwner, string> = {
  exporter_org: 'Exporter record',
  buyer_commercial_profile: 'Buyer record',
  deal: 'Deal & commercial terms',
  shipment: 'Shipment',
  shipment_packages: 'Packages',
  insurance_case: 'Insurance',
  exchange_rate_quote: 'Exchange rate',
  invoice_number: 'Invoice number',
};

export default async function AgentDocumentDataPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const { principal, deal } = await loadAgentDeal(dealId);

  const context = await buildDocumentContext(principal, dealId, DocType.CI);
  const readiness = allDocumentReadiness(context);
  const preview = await previewNextInvoiceNumber(principal, deal.exporter_org_id);
  const shipment = await prisma.shipment.findFirst({
    where: { deal_id: dealId },
    orderBy: { created_at: 'asc' },
    select: { id: true },
  });

  // One gap can block several documents. Deduplicated by field so the agent sees each thing
  // to fix once, with the documents it unblocks — not the same missing AD code listed twice.
  const byField = new Map<string, { label: string; owner: CanonicalOwner; detail?: string; docs: string[] }>();
  for (const r of readiness) {
    for (const issue of [...r.missing, ...r.invalid]) {
      const entry = byField.get(issue.field) ?? {
        label: issue.label, owner: issue.owner, detail: issue.detail ?? issue.condition, docs: [],
      };
      entry.docs.push(DOC_LABELS[r.documentType] ?? r.documentType);
      byField.set(issue.field, entry);
    }
  }
  const gaps = [...byField.entries()];

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <header className="mb-4">
        <p className="text-sm font-medium text-primary">
          <Link href={`/agent/deals/${dealId}`} className="focus-visible-ring rounded underline underline-offset-2">
            {deal.exporter_org.display_name}
          </Link>{' '}
          · {deal.buyer.display_name}
        </p>
        <h1 className="text-2xl font-semibold text-primary">Document readiness</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Every field below is corrected on the record that owns it. Nothing is stored against a
          document, so fixing it once fixes it for every document that needs it.
        </p>
      </header>

      <section className="mb-6 overflow-x-auto rounded-lg border border-[var(--color-border)] bg-surface shadow-card">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <thead>
            <tr className="bg-primary text-[var(--color-text-inverse)]">
              <th scope="col" className="px-3 py-2 text-left font-medium">Document</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Status</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">What is missing</th>
            </tr>
          </thead>
          <tbody>
            {readiness.map((r) => (
              <tr key={r.documentType} className="border-t border-[var(--color-border)] align-top">
                <td className="px-3 py-3 font-medium text-primary">{DOC_LABELS[r.documentType] ?? r.documentType}</td>
                <td className="px-3 py-3">
                  <StatusChip
                    label={r.status === 'ready' ? 'Ready' : r.status === 'blocked' ? 'Blocked' : `Missing ${r.missing.length}`}
                    tone={r.status === 'ready' ? 'positive' : r.status === 'blocked' ? 'critical' : 'warning'}
                    icon={r.status === 'ready' ? 'check' : 'alert'}
                    size="sm"
                  />
                </td>
                <td className="px-3 py-3 text-[var(--color-text-secondary)]">
                  {r.status === 'ready' ? (
                    <span className="text-[var(--color-text-muted)]">Nothing outstanding.</span>
                  ) : (
                    <ul className="space-y-0.5">
                      {[...r.invalid, ...r.missing].map((issue) => (
                        <li key={issue.field}>
                          {issue.label}
                          <span className="text-xs text-[var(--color-text-muted)]">
                            {' '}· {OWNER_LABELS[issue.owner]}
                          </span>
                          {issue.detail || issue.condition ? (
                            <div className="text-xs text-[var(--color-text-muted)]">{issue.detail ?? issue.condition}</div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {gaps.length > 0 ? (
        <p className="mb-3 text-sm text-[var(--color-text-secondary)]">
          {gaps.length} distinct {gaps.length === 1 ? 'fact is' : 'facts are'} outstanding across these
          documents.
        </p>
      ) : (
        <p className="mb-3 rounded border border-[var(--color-border)] bg-surface-muted px-3 py-2 text-sm text-primary">
          Every supported document has the canonical data it needs.
        </p>
      )}

      <FixCanonicalDataPanel
        dealId={dealId}
        exporterOrgId={deal.exporter_org_id}
        hasShipment={Boolean(shipment)}
        issuedInvoiceNumber={context.references.invoice_number}
        nextInvoiceNumberPreview={preview.preview_number}
        dealCurrency={context.deal.currency}
        exporter={{
          address_line1: context.exporter.address.line1,
          address_line2: context.exporter.address.line2,
          city: context.exporter.address.city,
          state: context.exporter.address.region,
          postal_code: context.exporter.address.postal_code,
          ad_code: context.exporter.ad_code,
        }}
        buyer={{
          document_name: context.buyer.document_name,
          address_line1: context.buyer.address.line1,
          address_line2: context.buyer.address.line2,
          city: context.buyer.address.city,
          region: context.buyer.address.region,
          postal_code: context.buyer.address.postal_code,
          country_code: context.buyer.address.country_code,
          tax_identifier: context.buyer.tax_identifier,
          tax_identifier_type: context.buyer.tax_identifier_type,
        }}
        shipment={{
          port_of_loading_name: context.shipment.port_of_loading.name,
          port_of_loading_unlocode: context.shipment.port_of_loading.unlocode,
          port_of_discharge_name: context.shipment.port_of_discharge.name,
          port_of_discharge_unlocode: context.shipment.port_of_discharge.unlocode,
          marks_and_numbers: context.shipment.marks_and_numbers,
          vessel_or_flight_no: context.shipment.vessel_or_flight_no,
          container_no: context.shipment.container_no,
          freight_amount: context.financial.freight?.amount ?? null,
          freight_currency: context.financial.freight?.currency ?? null,
        }}
      />
    </div>
  );
}
