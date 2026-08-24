/**
 * The agent-assisted workflow demo, shown to guest and free tiers under buyer search.
 *
 * Buyer search itself already works on Free — what Premium adds is the part a free member
 * has no way to picture: a real person running outreach, and a document set generated from
 * one set of deal facts. Those are the two features the comparison table marks as
 * `free_preview`, and this is where the preview lives.
 *
 * As with every sample: constants only, no fetch, no provider call, no Prisma. Buyer names
 * are invented (see the note in `preview.ts` on why naming a real importer here would be a
 * defamation and data-protection problem), and no contact detail is sampled at all — a
 * plausible-looking fake email that someone tries to mail is worse than a locked state.
 */

import { SamplePanel } from '@/components/ui';
import {
  PREVIEW_BUYERS,
  PREVIEW_DOCUMENTS,
  PREVIEW_LOCKED_BUYER_COUNT,
  PREVIEW_PRODUCT_LABEL,
  SAMPLE_DISCLAIMER,
} from '@/lib/billing/preview';

export function AgentWorkflowSample() {
  return (
    <div className="space-y-6">
      <SamplePanel
        title="Buyer fit scoring and contacts"
        subject={PREVIEW_PRODUCT_LABEL}
        disclaimer={SAMPLE_DISCLAIMER}
        lockedSummary={`${PREVIEW_LOCKED_BUYER_COUNT} more scored buyers in the full result`}
        cta="Upgrade to score your own buyers"
      >
        <ul className="divide-y divide-line">
          {PREVIEW_BUYERS.map((buyer) => (
            <li key={buyer.display_name} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-bone">{buyer.display_name}</p>
                <p className="text-xs text-muted">
                  {buyer.country_code} · {buyer.buyer_type} · {buyer.contacts_total} contacts
                </p>
              </div>
              <p className="shrink-0 text-sm text-bone">
                <span className="font-mono">{buyer.fit_score}</span>
                <span className="ml-1 text-xs text-muted">fit</span>
              </p>
            </li>
          ))}
        </ul>
      </SamplePanel>

      <SamplePanel
        title="Documents generated for one shipment"
        subject={PREVIEW_PRODUCT_LABEL}
        disclaimer={SAMPLE_DISCLAIMER}
        lockedSummary="Generated from one set of deal facts, so they cannot disagree with each other"
        cta="Upgrade to generate your documents"
      >
        <ul className="divide-y divide-line">
          {PREVIEW_DOCUMENTS.map((document) => (
            <li key={document.label} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-bone">{document.label}</p>
                {/* Plain-language label first, technical term as helper text — docs/10 §5. */}
                <p className="text-xs text-muted">{document.technical_label}</p>
              </div>
              <p className="shrink-0 text-xs text-muted">{document.status}</p>
            </li>
          ))}
        </ul>
      </SamplePanel>
    </div>
  );
}
