/**
 * The free-tier DEMO — a labelled sample of what a membership buys.
 *
 * THE RULE, and the reason this file has no imports from Prisma, the discovery engine, the
 * warehouse, or any provider client:
 *
 *   A free tenant must be able to SEE the premium product without any part of the real
 *   pipeline running on their behalf. Not a trial, not a reduced-quality real run, not a
 *   cached real result belonging to somebody else — a fixture. No Comtrade request, no
 *   Anthropic token, no `DiscoveryRun` row, no job enqueued, no warehouse query.
 *
 * That is a cost control and a correctness control at once. Cost, because a free signup
 * that spends provider credits is an unbounded liability at the exact moment acquisition
 * works. Correctness, because a sample computed from real data is indistinguishable from
 * the member's OWN data on screen, and someone will eventually act on it commercially.
 *
 * WHICH IS WHY EVERY ROW IS TAGGED `EvidenceOrigin.preview` and every surface renders the
 * sample banner. `evidence-environment.ts` already classifies `preview` as non-real, so
 * these values are excluded from real-workflow queries by machinery that predates this
 * feature — the labelling is not decorative, it is the same guard the fixture data uses.
 *
 * The numbers below are plausible but invented, and are deliberately for a product
 * (handmade cotton textiles, HS 630260) that is generic enough to read as an illustration
 * rather than as advice about the reader's own goods. `SAMPLE_DISCLAIMER` must accompany
 * them everywhere and must never be dropped for space.
 */

import { EvidenceOrigin } from '@prisma/client';

export const SAMPLE_DISCLAIMER =
  'This is a sample built from illustrative figures, not your data and not live trade data. Upgrade to run this on your own product.';

/** Named so a grep for the tag finds the rule, not just the value. */
export const PREVIEW_EVIDENCE_ORIGIN = EvidenceOrigin.preview;

export interface PreviewMarket {
  rank: number;
  country_code: string;
  country_name: string;
  /** 0–100, matching the shape `MarketAssessment.score` uses. Invented. */
  score: number;
  /** The qualitative line the real rationale writer produces. No figures, same as live. */
  rationale: string;
  /** Component bands, in the same vocabulary the real scoring engine reports. */
  components: { label: string; band: 'strong' | 'moderate' | 'weak' | 'unknown' }[];
  evidence_origin: EvidenceOrigin;
}

/**
 * Four ranked markets — enough to show that ranking, scoring and reasoning are what the
 * member is buying, and short enough that nobody mistakes it for a full result set. The
 * real surface returns far more, which the CTA says explicitly.
 */
export const PREVIEW_MARKETS: readonly PreviewMarket[] = [
  {
    rank: 1,
    country_code: 'DE',
    country_name: 'Germany',
    score: 87,
    rationale:
      'Import demand here is large and has been growing steadily, and the incumbent supplier base is spread across many countries rather than dominated by one. That combination usually means a new supplier can win a first order on merit rather than on price alone.',
    components: [
      { label: 'Import demand', band: 'strong' },
      { label: 'Demand trend', band: 'strong' },
      { label: 'Supplier concentration', band: 'moderate' },
      { label: 'India-origin presence', band: 'moderate' },
    ],
    evidence_origin: EvidenceOrigin.preview,
  },
  {
    rank: 2,
    country_code: 'AE',
    country_name: 'United Arab Emirates',
    score: 81,
    rationale:
      'A strong existing India-origin trade lane makes logistics and payment terms easier to arrange than the raw demand figure alone would suggest. Demand is moderate but stable, so this reads as a lower-friction first market rather than the biggest one.',
    components: [
      { label: 'Import demand', band: 'moderate' },
      { label: 'Demand trend', band: 'moderate' },
      { label: 'Supplier concentration', band: 'strong' },
      { label: 'India-origin presence', band: 'strong' },
    ],
    evidence_origin: EvidenceOrigin.preview,
  },
  {
    rank: 3,
    country_code: 'GB',
    country_name: 'United Kingdom',
    score: 74,
    rationale:
      'Demand is substantial but has been flat, and a small number of established suppliers hold most of it. Expect a longer qualification process here, with buyers asking for certification and a sample before they move.',
    components: [
      { label: 'Import demand', band: 'strong' },
      { label: 'Demand trend', band: 'weak' },
      { label: 'Supplier concentration', band: 'weak' },
      { label: 'India-origin presence', band: 'moderate' },
    ],
    evidence_origin: EvidenceOrigin.preview,
  },
  {
    rank: 4,
    country_code: 'NL',
    country_name: 'Netherlands',
    score: 69,
    rationale:
      'Much of what arrives here is re-exported onward into the rest of Europe, so buyers tend to be distributors rather than end users. That means larger orders but tighter margins, and the data on final destination is not available.',
    components: [
      { label: 'Import demand', band: 'moderate' },
      { label: 'Demand trend', band: 'moderate' },
      { label: 'Supplier concentration', band: 'moderate' },
      { label: 'India-origin presence', band: 'unknown' },
    ],
    evidence_origin: EvidenceOrigin.preview,
  },
];

/** How many further ranked markets the real run returns — shown as locked rows. */
export const PREVIEW_LOCKED_MARKET_COUNT = 38;

export interface PreviewBuyer {
  display_name: string;
  country_code: string;
  buyer_type: string;
  fit_score: number;
  /** Contacts are the paid asset (docs/14 §4) — the sample shows a count, never a person. */
  contacts_total: number;
  evidence_origin: EvidenceOrigin;
}

/**
 * Sample buyers use invented company names.
 *
 * Naming a real importer here would put an unverified fit score against an identifiable
 * business — a defamation and data-protection problem, and exactly the kind of thing the
 * `preview` evidence tag exists to keep out of real-workflow surfaces. Contact details are
 * never sampled at all, not even fake ones, because a fake email that someone tries to
 * mail is worse than a locked state.
 */
export const PREVIEW_BUYERS: readonly PreviewBuyer[] = [
  { display_name: 'Sample Importer GmbH', country_code: 'DE', buyer_type: 'Distributor', fit_score: 91, contacts_total: 3, evidence_origin: EvidenceOrigin.preview },
  { display_name: 'Sample Trading LLC', country_code: 'AE', buyer_type: 'Wholesaler', fit_score: 85, contacts_total: 2, evidence_origin: EvidenceOrigin.preview },
  { display_name: 'Sample Retail Group Ltd', country_code: 'GB', buyer_type: 'Retail chain', fit_score: 78, contacts_total: 4, evidence_origin: EvidenceOrigin.preview },
];

export const PREVIEW_LOCKED_BUYER_COUNT = 126;

/** The product the sample is computed for, stated so it is never read as the member's own. */
export const PREVIEW_PRODUCT_LABEL = 'Handmade cotton textiles · HS 630260';

export interface PreviewDocument {
  label: string;
  technical_label: string;
  status: string;
}

/** What the document engine produces for one shipment — shown as a list, never generated. */
export const PREVIEW_DOCUMENTS: readonly PreviewDocument[] = [
  { label: 'Commercial invoice', technical_label: 'Commercial Invoice', status: 'Approved' },
  { label: 'Packing list', technical_label: 'Packing List', status: 'Approved' },
  { label: 'Certificate of origin', technical_label: 'Certificate of Origin (Form A)', status: 'Awaiting chamber' },
  { label: 'Bill of lading', technical_label: 'Bill of Lading', status: 'Draft' },
  { label: 'Shipping bill', technical_label: 'Shipping Bill (ICEGATE)', status: 'Filed' },
];
