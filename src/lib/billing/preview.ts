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
  product: 'Basmati rice, 1121 sella, semi-milled',
  hs_code: '100630',
  hs_description: 'Rice, semi-milled or wholly milled, whether or not polished or glazed',
  run_on: '10 Nov 2026',
} as const;

export const SAMPLE_DISCLAIMER = `A real result for basmati rice (HS ${SAMPLE_RUN.hs_code}), run on ${SAMPLE_RUN.run_on} and frozen here. It is not your data and not live: members get this for their own products, with current figures.`;

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

/** The run's top markets, as the member saw them (labels and reasons in the engine's own words). */
export const SAMPLE_MARKETS: readonly SampleMarket[] = [
  {
    rank: 1, country_code: 'US', score: 85, confidence: 82, data_year: 2025,
    labels: [
      { key: 'big_and_growing', text: 'Big and growing', tone: 'positive' },
      { key: 'india_already_sells', text: 'India already sells here', tone: 'positive' },
      { key: 'pays_above_india_price', text: "Pays above India's price", tone: 'positive' },
      { key: 'low_duty_for_india', text: 'Low duty for India (estimated)', tone: 'positive', estimated: true },
      { key: 'trading_hub', text: 'Trading hub', tone: 'info' },
      { key: 'newer_data_used', text: 'Newer data used', tone: 'info' },
    ],
    reasons: [
      { metric: 'market_size', effect: 'adds', text: 'Imports averaged $1.4 billion a year over the last three years.' },
      { metric: 'country_risk', effect: 'adds', text: 'Low payment risk: ECGC rates the country A1.' },
      { metric: 'growth', effect: 'costs', text: 'Imports grew a modest 5.5% a year over 5 years.' },
    ],
    evidence_origin: EvidenceOrigin.preview,
  },
  {
    rank: 2, country_code: 'SA', score: 84, confidence: 87, data_year: 2025,
    labels: [
      { key: 'india_already_sells', text: 'India already sells here', tone: 'positive' },
      { key: 'pays_above_india_price', text: "Pays above India's price", tone: 'positive' },
      { key: 'low_duty_for_india', text: 'Low duty for India', tone: 'positive' },
      { key: 'newer_data_used', text: 'Newer data used', tone: 'info' },
    ],
    reasons: [
      { metric: 'market_size', effect: 'adds', text: 'Imports averaged $1.7 billion a year over the last three years.' },
      { metric: 'duty', effect: 'adds', text: 'Indian goods enter duty-free.' },
      { metric: 'growth', effect: 'costs', text: 'Imports grew a modest 3.2% a year over 5 years.' },
    ],
    evidence_origin: EvidenceOrigin.preview,
  },
  {
    rank: 3, country_code: 'GB', score: 81, confidence: 82, data_year: 2025,
    labels: [
      { key: 'india_already_sells', text: 'India already sells here', tone: 'positive' },
      { key: 'pays_above_india_price', text: "Pays above India's price", tone: 'positive' },
      { key: 'low_duty_for_india', text: 'Low duty for India (estimated)', tone: 'positive', estimated: true },
      { key: 'newer_data_used', text: 'Newer data used', tone: 'info' },
    ],
    reasons: [
      { metric: 'market_size', effect: 'adds', text: 'Imports averaged $353.3 million a year over the last three years.' },
      { metric: 'country_risk', effect: 'adds', text: 'Low payment risk: ECGC rates the country A1.' },
      { metric: 'growth', effect: 'costs', text: 'Imports grew a modest 4.3% a year over 5 years.' },
    ],
    evidence_origin: EvidenceOrigin.preview,
  },
  {
    rank: 4, country_code: 'QA', score: 81, confidence: 72, data_year: 2024,
    labels: [
      { key: 'big_and_growing', text: 'Big and growing', tone: 'positive' },
      { key: 'india_already_sells', text: 'India already sells here', tone: 'positive' },
      { key: 'pays_above_india_price', text: "Pays above India's price", tone: 'positive' },
      { key: 'low_duty_for_india', text: 'Low duty for India', tone: 'positive' },
    ],
    reasons: [
      { metric: 'market_size', effect: 'adds', text: 'Imports averaged $172.7 million a year over the last three years.' },
      { metric: 'duty', effect: 'adds', text: 'Indian goods enter duty-free.' },
      { metric: 'growth', effect: 'costs', text: 'Imports grew a modest 5.7% a year over 5 years.' },
    ],
    evidence_origin: EvidenceOrigin.preview,
  },
  {
    rank: 5, country_code: 'KW', score: 80, confidence: 87, data_year: 2025,
    labels: [
      { key: 'india_already_sells', text: 'India already sells here', tone: 'positive' },
      { key: 'pays_above_india_price', text: "Pays above India's price", tone: 'positive' },
      { key: 'low_duty_for_india', text: 'Low duty for India', tone: 'positive' },
      { key: 'newer_data_used', text: 'Newer data used', tone: 'info' },
    ],
    reasons: [
      { metric: 'market_size', effect: 'adds', text: 'Imports averaged $273.1 million a year over the last three years.' },
      { metric: 'duty', effect: 'adds', text: 'Indian goods enter duty-free.' },
      { metric: 'growth', effect: 'costs', text: 'Imports fell 0.7% a year over 5 years.' },
    ],
    evidence_origin: EvidenceOrigin.preview,
  },
];

/** How many markets the run ranked in all (of 218 compared). */
export const SAMPLE_RANKED_TOTAL = 214;

export interface SampleRegions {
  country_code: string;
  basis: string;
  rows: readonly { name: string; value: string }[];
  more: number;
}

/** Regional demand for one of the run's markets, from the official source the run read. */
export const SAMPLE_REGIONS: SampleRegions | null = {
  country_code: 'US',
  basis: 'U.S. Census Bureau imports by destination state, HS 100630, Oct 2025 – Sep 2026: $314.2 million came from India, 23.4% of all imports, 99.5% of it in containers by sea.',
  rows: [
    { name: 'New Jersey', value: '$112.6 million from India · 53.0% of the state’s imports' },
    { name: 'California', value: '$50.7 million · 12.8%' },
    { name: 'Georgia', value: '$45.0 million · 36.5%' },
    { name: 'Texas', value: '$38.0 million · 32.9%' },
    { name: 'New York', value: '$37.6 million · 30.3%' },
  ],
  more: 42,
};

export interface SampleImporterArea {
  /** A region, never a business: the sample names no importer. */
  label: string;
  importers: number;
  evidence_origin: EvidenceOrigin;
}

export interface SampleBuyers {
  country_name: string;
  basis: string;
  total: number;
  rows: readonly SampleImporterArea[];
}

/**
 * Importers the run found in one market, counted by region from the official list — the same
 * counts a member sees (buyer discovery is agent-curated, docs/11 §7: the agent reviews the list
 * and contacts the right ones). No business is named.
 */
export const SAMPLE_BUYERS: SampleBuyers | null = {
  country_name: 'United Kingdom',
  basis: '184 importers of HS 100630 in HMRC’s importer details (UK Trade Info), August 2026 list, placed by the postcode HMRC publishes.',
  total: 184,
  rows: [
    { label: 'London', importers: 85, evidence_origin: EvidenceOrigin.preview },
    { label: 'South East', importers: 21, evidence_origin: EvidenceOrigin.preview },
    { label: 'East of England', importers: 15, evidence_origin: EvidenceOrigin.preview },
    { label: 'North West', importers: 14, evidence_origin: EvidenceOrigin.preview },
    { label: 'West Midlands', importers: 14, evidence_origin: EvidenceOrigin.preview },
  ],
};

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
