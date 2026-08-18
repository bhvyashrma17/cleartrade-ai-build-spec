/**
 * Cross-field consistency rules, mapped from the legacy engines.
 *
 * The important result of auditing `crossDocumentConsistencyEngine.ts` (33 KB, 19 rule codes)
 * is how FEW of its rules survive here — and why. It compared the port on the invoice against
 * the port on the shipping bill, the currency on the invoice against the currency on the
 * insurance certificate, the quantity on the invoice against the quantity on the packing list,
 * and so on. Every one of those comparisons exists because the legacy schema stored the same
 * fact separately on each document, so the two copies could disagree.
 *
 * In ClearTrade there is one owner per fact and documents read it, so PORT_MISMATCH,
 * CURRENCY_MISMATCH, INCOTERM_MISMATCH, ITEM_COUNT_MISMATCH, HS_CODE_MISMATCH and
 * VALUE_MISMATCH are not rules that pass — they are comparisons that cannot be expressed. The
 * architecture retired them.
 *
 * What remains are rules about facts that are genuinely independent of each other, where
 * disagreement is possible and meaningful. Those are implemented below, as pure functions over
 * the built context — no database, no document, no lifecycle.
 */

import type { DocumentGenerationContext } from './types';
import type { ReadinessIssue } from './readiness';
import { incotermIncludes } from './derive';

/**
 * A consistency finding. Shaped as a `ReadinessIssue` so callers have one list to render
 * rather than two vocabularies for "something is wrong with this data".
 */
export type ConsistencyFinding = ReadinessIssue & {
  rule: string;
  /**
   * Whether this finding makes the document impossible to produce correctly, or merely worth
   * a second look.
   *
   * The distinction is load-bearing. Phase 8's pilot exposed why: a perfectly ordinary FOB
   * shipment records its booked freight on the shipment, which fires FREIGHT_OUTSIDE_PRICE —
   * a rule whose own message says "confirm". Treating that as blocking meant a correct deal
   * could never produce any document at all. A rule that asks somebody to check something is
   * advice; only a rule that proves the data cannot be rendered honestly may block.
   */
  severity: 'blocking' | 'advisory';
};

const num = (v: string | null) => (v === null ? null : Number(v));

export function checkConsistency(c: DocumentGenerationContext): ConsistencyFinding[] {
  const findings: ConsistencyFinding[] = [];

  // FOB_HAS_FREIGHT (legacy). Kept, softened to what it can actually prove: an FOB/EXW price
  // does not include carriage, so a freight figure recorded against it is a cost the buyer
  // bears — it must not be added into the invoice value. Worth surfacing, because entering it
  // in the wrong place is a common and expensive mistake.
  const includes = incotermIncludes(c.deal.incoterm);
  if (includes && !includes.freight && c.financial.freight) {
    findings.push({
      rule: 'FREIGHT_OUTSIDE_PRICE', severity: 'advisory',
      field: 'financial.freight', label: 'Freight amount', reason: 'invalid_value', owner: 'shipment',
      detail: `${c.deal.incoterm} does not include carriage, so this freight is not part of the invoice value. Confirm it belongs on the shipment rather than in the price.`,
    });
  }

  // DATE_SEQUENCE_ERROR (legacy). Kept, and it is a real rule: goods cannot ship before the
  // invoice that covers them is issued, and both dates have independent owners here.
  const invoiceDate = c.references.invoice_date;
  const shippedOn = c.shipment.shipped_on_date;
  if (invoiceDate && shippedOn && new Date(shippedOn) < new Date(invoiceDate)) {
    findings.push({
      // Advisory, not blocking: raising the commercial invoice after the goods ship is normal
      // practice in several trades. It is worth surfacing because one of the two dates is
      // often simply mistyped, but it does not make the document wrong.
      rule: 'DATE_SEQUENCE_ERROR', severity: 'advisory',
      field: 'shipment.shipped_on_date', label: 'Shipment date', reason: 'invalid_value', owner: 'shipment',
      detail: 'The goods are recorded as shipped before the invoice date. One of the two dates is wrong.',
    });
  }

  // WEIGHT_VARIANCE (legacy), remapped. The legacy version compared an invoice weight against a
  // packing weight — two copies of one fact. Here the comparison is between genuinely different
  // facts: the goods quantity agreed on the deal, and the net weight of the packages. They are
  // only comparable when the deal is priced by weight, so the rule declines to fire otherwise
  // rather than converting between units it does not know.
  const quantity = c.deal.items[0]?.quantity ?? null;
  const netTotal = num(c.shipment.package_totals.net_weight_kg);
  if (quantity && netTotal !== null && ['kg', 'kgs', 'kilogram', 'kilograms'].includes((quantity.unit ?? '').toLowerCase())) {
    const declared = Number(quantity.value);
    // 2% tolerance: real packing weights vary, and flagging every gram would make the check
    // noise that people learn to ignore.
    if (declared > 0 && Math.abs(declared - netTotal) / declared > 0.02) {
      findings.push({
        rule: 'WEIGHT_VARIANCE', severity: 'advisory',
        field: 'shipment.package_totals.net_weight_kg', label: 'Net weight', reason: 'invalid_value',
        owner: 'shipment_packages',
        detail: `The packages total ${netTotal} kg but the deal is for ${declared} ${quantity.unit}. Check whether a package line is missing or a weight is wrong.`,
      });
    }
  }

  // GROSS_BELOW_NET. New here rather than mapped: the legacy renderer silently RAISED gross to
  // net at print time (`grossWeightRaw < netWeight ? netWeight : grossWeightRaw`), which hid a
  // data-entry error behind a plausible number. The database refuses such a row now; this
  // catches a snapshot taken before that constraint existed.
  for (const p of c.shipment.packages) {
    const net = num(p.net_weight_kg);
    const gross = num(p.gross_weight_kg);
    if (net !== null && gross !== null && gross < net) {
      findings.push({
        // Blocking: a package cannot weigh less gross than net. The database refuses such a
        // row outright, so reaching this means a snapshot frozen before that constraint
        // existed — and printing it would state an impossibility as fact.
        rule: 'GROSS_BELOW_NET', severity: 'blocking',
        field: `shipment.packages[${p.sequence}].gross_weight_kg`, label: 'Gross weight',
        reason: 'invalid_value', owner: 'shipment_packages',
        detail: `Package line ${p.sequence} has gross ${gross} kg below net ${net} kg.`,
      });
    }
  }

  // Not implemented, and deliberately: GST_MISMATCH needs a GST treatment model ClearTrade
  // does not have; LC_VALUE_MISMATCH, SHIPMENT_AFTER_LC_EXPIRY and
  // INSUFFICIENT_PRESENTATION_PERIOD need a Letter of Credit model that does not exist here.
  // Writing them against absent data would produce rules that never fire and read as coverage.

  return findings;
}
