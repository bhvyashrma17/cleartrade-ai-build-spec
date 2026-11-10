/**
 * The buyer and document sample, shown to visitors and free accounts on `/app/buyers`.
 *
 * Constants only (`src/lib/billing/preview.ts`): no fetch, no provider call, no Prisma, so a
 * visit spends nothing. The buyers are a real run's result, frozen on the day it ran (D-039,
 * E-055), with every importer's name withheld: a real company named on a public page beside a fit
 * score is a defamation and data-protection problem, and no contact detail is ever shown, not even
 * a count that could identify someone. The documents are the set the document engine produces for
 * one shipment (docs/30 §3); nothing here is generated.
 */

import { SamplePanel } from '@/components/ui';
import { SAMPLE_BUYERS, SAMPLE_DISCLAIMER, SAMPLE_DOCUMENTS, SAMPLE_RUN } from '@/lib/billing/preview';

export function AgentWorkflowSample() {
  const more = SAMPLE_BUYERS ? SAMPLE_BUYERS.total - SAMPLE_BUYERS.rows.length : 0;
  return (
    <div className="space-y-6">
      {SAMPLE_BUYERS ? (
        <SamplePanel
          title={`Buyers found in ${SAMPLE_BUYERS.country_name}`}
          subject={`${SAMPLE_RUN.product} · HS ${SAMPLE_RUN.hs_code} · run on ${SAMPLE_RUN.run_on}`}
          disclaimer={SAMPLE_DISCLAIMER}
          lockedSummary={more > 0 ? `${more} more scored buyers in this run's full result` : undefined}
          cta="Upgrade to find buyers for your own product"
        >
          <p className="mb-3 text-xs text-muted">{SAMPLE_BUYERS.basis}</p>
          <ul className="divide-y divide-line">
            {SAMPLE_BUYERS.rows.map((buyer) => (
              <li key={buyer.label} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-bone">{buyer.label}</p>
                  <p className="text-xs text-muted">{buyer.detail}</p>
                </div>
                <p className="shrink-0 text-sm text-bone">
                  <span className="font-mono">{buyer.fit_score}</span>
                  <span className="ml-1 text-xs text-muted">fit</span>
                </p>
              </li>
            ))}
          </ul>
        </SamplePanel>
      ) : null}

      <SamplePanel
        title="Documents your agent prepares for a shipment"
        subject="What the document engine produces from one set of deal facts"
        disclaimer="A description of the document set, not documents for your shipment. Nothing here was generated."
        lockedSummary="Generated from one set of deal facts, so they cannot disagree with each other"
        cta="Upgrade to generate your documents"
      >
        <ul className="divide-y divide-line">
          {SAMPLE_DOCUMENTS.map((document) => (
            <li key={document.label} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-bone">{document.label}</p>
                {/* Plain-language label first, technical term as helper text — docs/10 §5. */}
                <p className="text-xs text-muted">{document.technical_label}</p>
              </div>
              <p className="shrink-0 text-xs text-muted">{document.how}</p>
            </li>
          ))}
        </ul>
      </SamplePanel>
    </div>
  );
}
