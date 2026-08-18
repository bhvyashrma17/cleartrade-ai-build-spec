/**
 * Document data readiness.
 *
 * Answers, per document type: can this be generated, and if not, exactly which canonical
 * facts are absent and where each one is fixed.
 *
 * Two rules shape the whole file.
 *
 * First, a missing required field is a MISSING field, never an empty string. The legacy
 * renderers did the opposite — `Number(carton.netWeightKg || 0)` printed an unknown weight as
 * `0.00 kg`, and `(invoice.poReference || "").trim()` printed an unknown PO reference as a
 * blank box on a customs document. Both look like assertions of fact. Here nothing renders
 * until readiness says so, and readiness reports the gap as data.
 *
 * Second, every issue names the canonical OWNER of the fact, not the document. Fixing
 * "exporter.ad_code" edits the exporter record; it never writes into a document payload.
 * That is what stops documents from becoming the database.
 */

import { DocType } from '@prisma/client';
import { checkConsistency } from './consistency';
import type { DocumentGenerationContext } from './types';

export type ReadinessStatusValue = 'ready' | 'missing_data' | 'blocked';
export type ReadinessIssueKind = 'required_for_this_document' | 'conditionally_required' | 'invalid_value';

/** Where a fact is actually corrected. The UI turns this into a deep link. */
export type CanonicalOwner =
  | 'exporter_org'
  | 'buyer_commercial_profile'
  | 'deal'
  | 'shipment'
  | 'shipment_packages'
  | 'insurance_case'
  | 'exchange_rate_quote'
  | 'invoice_number';

export interface ReadinessIssue {
  /** Dotted path into the generation context, so a caller can point at the exact value. */
  field: string;
  label: string;
  reason: ReadinessIssueKind;
  owner: CanonicalOwner;
  /** Present for `conditionally_required` — why this document needs it in THIS case. */
  condition?: string;
  /** Present for `invalid_value` — what is wrong with the value that IS there. */
  detail?: string;
}

export interface DocumentReadiness {
  documentType: DocType;
  status: ReadinessStatusValue;
  missing: ReadinessIssue[];
  /** Values that are present but unusable. These block. */
  invalid: ReadinessIssue[];
  /**
   * Findings worth a human look that do NOT block.
   *
   * Separated from `invalid` after Phase 8's pilot found the alternative: consistency rules
   * whose own wording says "confirm this" were being treated as blockers, so an ordinary FOB
   * shipment that had recorded its booked freight could not produce a single document. Advice
   * belongs in front of the agent, not in the gate.
   */
  advisory: ReadinessIssue[];
}

type Ctx = DocumentGenerationContext;
type Requirement = {
  field: string;
  label: string;
  owner: CanonicalOwner;
  present: (c: Ctx) => boolean;
  /** When set, the requirement applies only if this returns a reason string. */
  when?: (c: Ctx) => string | null;
};

const has = (v: unknown) => v !== null && v !== undefined && v !== '';
const hasMoney = (m: { amount: string; currency: string } | null) => m !== null && has(m.amount) && has(m.currency);
const hasAddress = (a: Ctx['buyer']['address']) => has(a.line1) && has(a.city) && has(a.country_code);

/** Shared by every document: who is shipping, to whom, under what terms. */
const CORE: Requirement[] = [
  { field: 'exporter.legal_name', label: 'Exporter legal name', owner: 'exporter_org', present: (c) => has(c.exporter.legal_name) },
  { field: 'exporter.address', label: 'Exporter address', owner: 'exporter_org', present: (c) => hasAddress(c.exporter.address) },
  { field: 'buyer.document_name', label: 'Buyer name', owner: 'buyer_commercial_profile', present: (c) => has(c.buyer.document_name) },
  { field: 'buyer.address', label: 'Buyer address', owner: 'buyer_commercial_profile', present: (c) => hasAddress(c.buyer.address) },
];

const GOODS: Requirement[] = [
  { field: 'deal.items', label: 'Product line', owner: 'deal', present: (c) => c.deal.items.length > 0 },
  { field: 'deal.items[].description', label: 'Product description', owner: 'deal', present: (c) => c.deal.items.every((i) => has(i.description)) },
  { field: 'deal.items[].quantity', label: 'Quantity and unit', owner: 'deal', present: (c) => c.deal.items.every((i) => has(i.quantity?.value) && has(i.quantity?.unit)) },
];

const PRICED: Requirement[] = [
  { field: 'deal.items[].unit_price', label: 'Unit price', owner: 'deal', present: (c) => c.deal.items.every((i) => hasMoney(i.unit_price)) },
  { field: 'deal.goods_total', label: 'Total value', owner: 'deal', present: (c) => hasMoney(c.deal.goods_total) },
  { field: 'deal.incoterm', label: 'Incoterm', owner: 'deal', present: (c) => has(c.deal.incoterm) },
  { field: 'deal.incoterm_place', label: 'Incoterm place', owner: 'deal', present: (c) => has(c.deal.incoterm_place) },
];

const HS_CODE: Requirement = {
  field: 'deal.items[].hs_code', label: 'HS code', owner: 'deal',
  present: (c) => c.deal.items.every((i) => has(i.hs_code)),
};

const PACKAGES: Requirement[] = [
  { field: 'shipment.packages', label: 'Package lines', owner: 'shipment_packages', present: (c) => c.shipment.packages.length > 0 },
  { field: 'shipment.package_totals.gross_weight_kg', label: 'Gross weight', owner: 'shipment_packages', present: (c) => has(c.shipment.package_totals.gross_weight_kg) },
  { field: 'shipment.package_totals.net_weight_kg', label: 'Net weight', owner: 'shipment_packages', present: (c) => has(c.shipment.package_totals.net_weight_kg) },
];

const PORTS: Requirement[] = [
  { field: 'shipment.port_of_loading.name', label: 'Port of loading', owner: 'shipment', present: (c) => has(c.shipment.port_of_loading.name) },
  { field: 'shipment.port_of_discharge.name', label: 'Port of discharge', owner: 'shipment', present: (c) => has(c.shipment.port_of_discharge.name) },
];

/**
 * Per-document requirements.
 *
 * Derived from what the target renderers actually read, not from what international trade
 * could theoretically require — a field nobody consumes is not a blocker (Part 18).
 */
const REQUIREMENTS: Record<DocType, Requirement[]> = {
  // A quotation. Deliberately does NOT require an invoice number, ports, or packing detail:
  // a proforma is issued before any of that exists, and demanding them would make the one
  // document an exporter needs early the hardest one to produce.
  [DocType.PI]: [...CORE, ...GOODS, ...PRICED],

  [DocType.CI]: [
    ...CORE, ...GOODS, ...PRICED, HS_CODE,
    { field: 'exporter.iec_number', label: 'IEC number', owner: 'exporter_org', present: (c) => has(c.exporter.iec_number) },
    { field: 'references.invoice_number', label: 'Issued invoice number', owner: 'invoice_number', present: (c) => has(c.references.invoice_number) },
    // Only when the deal is not already in rupees. An INR contract needs no conversion, and
    // demanding a rate would be a blocker invented by the checker rather than by the document.
    {
      field: 'financial.exchange_rate', label: 'Exchange rate to INR', owner: 'exchange_rate_quote',
      when: (c) => (c.deal.currency && c.deal.currency !== 'INR'
        ? `The deal is priced in ${c.deal.currency}, so the invoice must state the INR conversion.` : null),
      present: (c) => c.financial.exchange_rate !== null,
    },
  ],

  [DocType.packing_list]: [
    ...CORE, ...GOODS, ...PACKAGES,
    { field: 'shipment.marks_and_numbers', label: 'Marks and numbers', owner: 'shipment', present: (c) => has(c.shipment.marks_and_numbers) },
  ],

  [DocType.shipping_bill_draft]: [
    ...CORE, ...GOODS, ...PRICED, HS_CODE, ...PORTS,
    // The blocker the phase spec names by example. A shipping bill cannot be filed without
    // the exporter's Authorised Dealer code, and no other document needs it.
    { field: 'exporter.ad_code', label: 'AD code', owner: 'exporter_org', present: (c) => has(c.exporter.ad_code) },
    { field: 'exporter.iec_number', label: 'IEC number', owner: 'exporter_org', present: (c) => has(c.exporter.iec_number) },
    { field: 'shipment.mode', label: 'Mode of transport', owner: 'shipment', present: (c) => has(c.shipment.mode) },
    {
      field: 'financial.fob_value', label: 'FOB value', owner: 'shipment',
      // FOB is derived. It comes out null when the Incoterm bundles in a cost we do not have,
      // so the actionable gap is the missing freight or insurance figure, named here.
      present: (c) => hasMoney(c.financial.fob_value),
    },
  ],

  [DocType.COO_draft]: [
    ...CORE, ...GOODS, HS_CODE,
    { field: 'exporter.country_of_origin', label: 'Country of origin', owner: 'exporter_org', present: (c) => has(c.exporter.country_of_origin) },
    { field: 'shipment.port_of_discharge.name', label: 'Port of discharge', owner: 'shipment', present: (c) => has(c.shipment.port_of_discharge.name) },
  ],

  [DocType.declaration]: [
    ...CORE,
    { field: 'deal.goods_total', label: 'Total value', owner: 'deal', present: (c) => hasMoney(c.deal.goods_total) },
    { field: 'deal.incoterm', label: 'Incoterm', owner: 'deal', present: (c) => has(c.deal.incoterm) },
    { field: 'deal.payment_terms', label: 'Payment terms', owner: 'deal', present: (c) => has(c.deal.payment_terms) },
    { field: 'exporter.iec_number', label: 'IEC number', owner: 'exporter_org', present: (c) => has(c.exporter.iec_number) },
  ],

  [DocType.insurance_declaration]: [
    ...CORE, ...GOODS,
    { field: 'deal.goods_total', label: 'Total value', owner: 'deal', present: (c) => hasMoney(c.deal.goods_total) },
    { field: 'financial.insurance', label: 'Insurance premium', owner: 'insurance_case', present: (c) => hasMoney(c.financial.insurance) },
    // The declaration states a sum insured and a policy reference. Rendering it without them
    // would produce a form that looks like cover and names none.
    { field: 'financial.insurance_policy.policy_ref', label: 'Policy reference', owner: 'insurance_case', present: (c) => has(c.financial.insurance_policy?.policy_ref) },
    { field: 'financial.insurance_policy.covered_amount', label: 'Sum insured', owner: 'insurance_case', present: (c) => hasMoney(c.financial.insurance_policy?.covered_amount ?? null) },
    ...PORTS,
  ],

  // No renderer and no requirements — `other` is the uploaded-document escape hatch, and
  // asserting requirements for a document ClearTrade did not generate would be fiction.
  [DocType.other]: [],
};

/**
 * Checks on values that ARE present but cannot be used.
 *
 * Separate from `missing` because they need a different action: a missing AD code is entered,
 * an invalid one is corrected. Collapsing them would tell an agent to "add" something already
 * on screen.
 */
function invalidValues(c: Ctx): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];

  if (c.deal.incoterm && c.financial.fob_value === null && hasMoney(c.deal.goods_total)) {
    const term = c.deal.incoterm.toUpperCase();
    const needsFreight = ['CFR', 'CPT', 'CIF', 'CIP', 'DAP', 'DPU', 'DDP'].includes(term);
    if (needsFreight && !hasMoney(c.financial.freight)) {
      issues.push({
        field: 'financial.freight', label: 'Freight amount', reason: 'invalid_value', owner: 'shipment',
        detail: `${term} includes freight in the price, so FOB cannot be derived until the freight amount is recorded.`,
      });
    }
    if (['CIF', 'CIP', 'DAP', 'DPU', 'DDP'].includes(term) && !hasMoney(c.financial.insurance)) {
      issues.push({
        field: 'financial.insurance', label: 'Insurance premium', reason: 'invalid_value', owner: 'insurance_case',
        detail: `${term} includes insurance in the price, so FOB cannot be derived until the premium is recorded.`,
      });
    }
    if (!needsFreight && !['EXW', 'FCA', 'FAS', 'FOB'].includes(term)) {
      issues.push({
        field: 'deal.incoterm', label: 'Incoterm', reason: 'invalid_value', owner: 'deal',
        detail: `"${c.deal.incoterm}" is not a recognised Incoterms 2020 rule, so which costs it includes cannot be determined.`,
      });
    }
  }

  // A port name with no UN/LOCODE is usable; a code of the wrong shape is not. The database
  // refuses malformed codes, so reaching this means data arrived by some other route.
  for (const [field, port] of [
    ['shipment.port_of_loading', c.shipment.port_of_loading],
    ['shipment.port_of_discharge', c.shipment.port_of_discharge],
  ] as const) {
    if (port.unlocode && !/^[A-Z]{2}[A-Z2-9]{3}$/.test(port.unlocode)) {
      issues.push({
        field: `${field}.unlocode`, label: 'Port UN/LOCODE', reason: 'invalid_value', owner: 'shipment',
        detail: `"${port.unlocode}" is not a valid UN/LOCODE. Leave it blank rather than guessing.`,
      });
    }
  }

  // A rate claiming a regulatory source must cite it. The database enforces this on write;
  // repeating it here means a snapshot taken before the constraint existed still reports.
  const rate = c.financial.exchange_rate;
  if (rate && ['rbi_reference', 'customs_notified'].includes(rate.source) && !has(rate.source_reference)) {
    issues.push({
      field: 'financial.exchange_rate.source_reference', label: 'Exchange rate citation',
      reason: 'invalid_value', owner: 'exchange_rate_quote',
      detail: `A rate recorded as "${rate.source}" must cite the notification it came from.`,
    });
  }

  return issues;
}

/**
 * Readiness for one document type.
 *
 * Pure: it takes a built context and returns a verdict, touching no database. That keeps it
 * usable in three places that must agree — the agent's readiness panel, the generate route's
 * pre-flight check, and a test — without any of them being able to drift.
 */
export function documentReadiness(context: DocumentGenerationContext, docType: DocType): DocumentReadiness {
  const requirements = REQUIREMENTS[docType] ?? [];
  const missing: ReadinessIssue[] = [];

  for (const req of requirements) {
    const condition = req.when ? req.when(context) : null;
    if (req.when && condition === null) continue;
    if (req.present(context)) continue;
    missing.push({
      field: req.field,
      label: req.label,
      reason: req.when ? 'conditionally_required' : 'required_for_this_document',
      owner: req.owner,
      ...(condition ? { condition } : {}),
    });
  }

  // Consistency findings split by severity. A blocking one joins `invalid`; an advisory one
  // is surfaced separately so the agent still sees it, and the gate does not stop on it.
  const consistency = checkConsistency(context);
  const blockingConsistency = consistency.filter((f) => f.severity === 'blocking');
  const advisoryConsistency = consistency.filter((f) => f.severity === 'advisory');
  const strip = ({ rule: _rule, severity: _severity, ...issue }: (typeof consistency)[number]) => issue;

  const seen = new Set<string>();
  const invalid = [...invalidValues(context), ...blockingConsistency.map(strip)]
    .filter((i) => (seen.has(i.field) ? false : (seen.add(i.field), true)));

  const advisorySeen = new Set<string>();
  const advisory = advisoryConsistency.map(strip)
    .filter((i) => (advisorySeen.has(i.field) ? false : (advisorySeen.add(i.field), true)));

  // `blocked` vs `missing_data` is not severity theatre: an invalid value means somebody has
  // to reconsider a decision already made, while missing data just needs typing in. The UI
  // routes them differently, so the distinction has to survive to the caller.
  const status: ReadinessStatusValue =
    invalid.length > 0 ? 'blocked' : missing.length > 0 ? 'missing_data' : 'ready';

  return { documentType: docType, status, missing, invalid, advisory };
}

/** The document types ClearTrade can assess. `other` is excluded: it is never generated. */
export const READINESS_DOC_TYPES: DocType[] = [
  DocType.PI, DocType.CI, DocType.packing_list, DocType.shipping_bill_draft,
  DocType.COO_draft, DocType.declaration, DocType.insurance_declaration,
];

export function allDocumentReadiness(context: DocumentGenerationContext): DocumentReadiness[] {
  return READINESS_DOC_TYPES.map((t) => documentReadiness({ ...context, doc_type: t }, t));
}
