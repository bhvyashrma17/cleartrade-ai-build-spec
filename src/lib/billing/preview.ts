/**
 * The SAMPLE shown to visitors and free accounts — what a membership produces, without running it.
 *
 * THE RULE, and the reason this file has no imports from Prisma, the engine, the warehouse or any
 * provider client: a visitor or a free account must be able to SEE the product without any part
 * of the real pipeline running on their behalf (D-039, docs/14 §3c). No request, no token, no run
 * row, no job, no warehouse query. Every value below is a constant.
 *
 * WHAT THE CONSTANTS ARE (owner, 9 Nov 2026: "make that accurate"). Not invented figures any more:
 * one real result, frozen. The owner's QA member ran it on production on the date in `SAMPLE_RUN`,
 * and the values were copied here from that run's own answers (ledger E-055). They are a
 * snapshot: they never update, and every surface says what they are and when they were produced.
 *
 * WHAT IS WITHHELD. Importer names are replaced by letters: a real company named beside a fit
 * score on a public page is a defamation and data-protection problem. No contact detail of any
 * kind is included. The product is one the reader probably does not make, stated everywhere, so
 * the sample reads as an example and not as advice about their own goods.
 *
 * Every row is still tagged `EvidenceOrigin.preview`, so `evidence-environment.ts` keeps these
 * values out of real-workflow queries, and `SAMPLE_DISCLAIMER` goes with them everywhere.
 */

import { EvidenceOrigin } from '@prisma/client';

/** Named so a grep for the tag finds the rule, not just the value. */
export const PREVIEW_EVIDENCE_ORIGIN = EvidenceOrigin.preview;

/** The run the sample was taken from. */
export const SAMPLE_RUN = {
  product: '__FILL__',
  hs_code: '__FILL__',
  hs_description: '__FILL__',
  run_on: '__FILL__',
} as const;

export const SAMPLE_DISCLAIMER = `__FILL__`;

export interface SampleLabel { key: string; text: string; tone: 'positive' | 'caution' | 'info'; estimated?: boolean }
export interface SampleReason { metric: string | null; effect: 'adds' | 'costs' | 'status'; text: string }

export interface SampleMarket {
  rank: number;
  country_code: string;
  score: number;
  confidence: number;
  data_year: number | null;
  labels: readonly SampleLabel[];
  reasons: readonly SampleReason[];
  evidence_origin: EvidenceOrigin;
}

/** The run's top markets, as the member saw them. */
export const SAMPLE_MARKETS: readonly SampleMarket[] = [];

/** How many markets the run ranked in all. */
export const SAMPLE_RANKED_TOTAL = 0;

export interface SampleRegions {
  country_code: string;
  basis: string;
  rows: readonly { name: string; value: string }[];
  more: number;
}

/** Regional demand for one of the run's markets, or null when the run had none to show. */
export const SAMPLE_REGIONS: SampleRegions | null = null;

export interface SampleBuyer {
  /** "Importer A", "Importer B"… — never the company's name. */
  label: string;
  detail: string;
  fit_score: number;
  evidence_origin: EvidenceOrigin;
}

export interface SampleBuyers {
  country_name: string;
  basis: string;
  total: number;
  rows: readonly SampleBuyer[];
}

/** Buyers the run found in one market, names withheld, or null when there were none. */
export const SAMPLE_BUYERS: SampleBuyers | null = null;

export interface SampleDocument {
  label: string;
  technical_label: string;
  /** What happens to it, in a few words — a description, never a status of a real shipment. */
  how: string;
}

/**
 * The documents the document engine renders from one set of deal facts (`DocType`,
 * `src/lib/document-generation/legacy/capabilities.ts`: PDF, Word and HTML for each). The bill of
 * lading is not here because the carrier issues it.
 */
export const SAMPLE_DOCUMENTS: readonly SampleDocument[] = [
  { label: 'Commercial invoice', technical_label: 'Commercial Invoice (or Proforma)', how: 'Generated from the deal facts' },
  { label: 'Packing list', technical_label: 'Packing List', how: 'Generated from the deal facts' },
  { label: 'Shipping bill', technical_label: 'Shipping Bill (draft for ICEGATE)', how: 'Drafted for your customs broker to file' },
  { label: 'Certificate of origin', technical_label: 'Certificate of Origin (draft)', how: 'Drafted for the issuing body' },
  { label: 'Shipping instructions and VGM', technical_label: 'Shipping Instructions, VGM Declaration', how: 'Generated for the carrier' },
  { label: 'Bill of exchange and bank letter', technical_label: 'Bill of Exchange, Bank Collection Letter', how: 'For documentary-collection terms' },
];
