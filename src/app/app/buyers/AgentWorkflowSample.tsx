/**
 * The buyer and document sample, shown to visitors and free accounts on `/app/buyers`.
 *
 * Constants only (`src/lib/billing/preview.ts`): no fetch, no provider call, no Prisma, so a
 * visit spends nothing. The importers are a real run's result, frozen on the day it ran (D-039,
 * E-055), counted by region exactly as a member sees them — buyer discovery is agent-curated
 * (docs/11 §7) — and no business is named: a real company on a public page is a defamation and
 * data-protection problem, and no contact detail is ever shown. The documents are the set the
 * document engine produces for one shipment (`DocType`); nothing here is generated.
 */

import { SamplePanel } from '@/components/ui';
import { SAMPLE_BUYERS, SAMPLE_DISCLAIMER, SAMPLE_DOCUMENTS, SAMPLE_RUN } from '@/lib/billing/preview';

export function AgentWorkflowSample() {
  const more = SAMPLE_BUYERS ? SAMPLE_BUYERS.total - SAMPLE_BUYERS.rows.reduce((sum, area) => sum + area.importers, 0) : 0;
  return (
    <div className="space-y-6">
      {SAMPLE_BUYERS ? (
        <SamplePanel
          title={`Importers found in ${SAMPLE_BUYERS.country_name}`}
          subject={`${SAMPLE_RUN.product} · HS ${SAMPLE_RUN.hs_code} · run on ${SAMPLE_RUN.run_on}`}
          disclaimer={SAMPLE_DISCLAIMER}
          lockedSummary={more > 0 ? `${more} more importers in other regions; your agent reviews them all` : undefined}
          cta="Upgrade to have your agent find buyers for your product"
        >
          <p className="mb-3 text-xs text-muted">{SAMPLE_BUYERS.basis}</p>
          <ul className="divide-y divide-line">
            {SAMPLE_BUYERS.rows.map((area) => (
              <li key={area.label} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0">
                <p className="text-sm font-medium text-bone">{area.label}</p>
                <p className="shrink-0 text-sm text-bone">
                  <span className="font-mono">{area.importers}</span>
                  <span className="ml-1 text-xs text-muted">{area.importers === 1 ? 'importer' : 'importers'}</span>
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
