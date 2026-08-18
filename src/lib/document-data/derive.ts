/**
 * Derivations over canonical inputs.
 *
 * Everything here is computed at read time and stored nowhere (Part 7). A derived value
 * kept beside its inputs is a second answer to the same question, and the two disagree the
 * first time one is edited alone — which is precisely how the legacy `Invoice.fobValue` and
 * `Invoice.cifValue` columns could contradict the line items they were supposedly derived
 * from.
 *
 * All arithmetic uses `Prisma.Decimal` (decimal.js). No `Number()` anywhere: 0.1 + 0.2 is
 * exactly 0.3 here, and a 12-digit invoice total does not lose its last cent.
 */

import { Prisma } from '@prisma/client';
import type { ContextMoney, ContextPackageLine, ContextPackageTotals } from './types';

type Decimal = Prisma.Decimal;
const D = Prisma.Decimal;

/** Money out of a nullable amount/currency pair. Both or neither — a bare number is not money. */
export function money(amount: Decimal | null | undefined, currency: string | null | undefined): ContextMoney | null {
  if (amount === null || amount === undefined) return null;
  if (!currency) return null;
  return { amount: amount.toString(), currency };
}

/**
 * Add money values that must all share a currency.
 *
 * Returns null if any input is null or if two currencies disagree, rather than silently
 * adding EUR to USD. A mixed-currency total is not a smaller number — it is a wrong one.
 */
export function sumMoney(values: (ContextMoney | null)[]): ContextMoney | null {
  const present = values.filter((v): v is ContextMoney => v !== null);
  if (present.length === 0) return null;
  const currency = present[0]!.currency;
  if (present.some((v) => v.currency !== currency)) return null;
  const total = present.reduce((acc, v) => acc.plus(new D(v.amount)), new D(0));
  return { amount: total.toString(), currency };
}

/** Subtract b from a. Null propagates; mismatched currencies produce null, never a wrong number. */
export function subtractMoney(a: ContextMoney | null, b: ContextMoney | null): ContextMoney | null {
  if (!a) return null;
  if (!b) return a;
  if (a.currency !== b.currency) return null;
  return { amount: new D(a.amount).minus(new D(b.amount)).toString(), currency: a.currency };
}

/** quantity x unit price, at full decimal precision. */
export function lineTotal(quantity: Decimal | null, unitPrice: Decimal | null, currency: string | null): ContextMoney | null {
  if (quantity === null || unitPrice === null || !currency) return null;
  return { amount: quantity.mul(unitPrice).toString(), currency };
}

/**
 * Which cost elements an Incoterm folds into the contract price.
 *
 * Only the 2020 terms are listed. An unrecognised term returns null rather than a guess,
 * because assuming "freight not included" for a term we do not know would understate the
 * declared FOB value on a customs document.
 */
const INCOTERM_INCLUDES: Record<string, { freight: boolean; insurance: boolean }> = {
  EXW: { freight: false, insurance: false },
  FCA: { freight: false, insurance: false },
  FAS: { freight: false, insurance: false },
  FOB: { freight: false, insurance: false },
  CFR: { freight: true, insurance: false },
  CPT: { freight: true, insurance: false },
  CIF: { freight: true, insurance: true },
  CIP: { freight: true, insurance: true },
  DAP: { freight: true, insurance: true },
  DPU: { freight: true, insurance: true },
  DDP: { freight: true, insurance: true },
};

export function incotermIncludes(incoterm: string | null): { freight: boolean; insurance: boolean } | null {
  if (!incoterm) return null;
  return INCOTERM_INCLUDES[incoterm.trim().toUpperCase()] ?? null;
}

/**
 * FOB value: the contract total with any freight and insurance the Incoterm bundled in
 * stripped back out.
 *
 * Returns null — not the contract total — when the Incoterm includes a cost whose amount we
 * do not have. A CIF contract whose freight is unrecorded has an unknown FOB, and printing
 * the CIF total in the FOB box would misdeclare the value.
 */
export function deriveFob(
  contractTotal: ContextMoney | null,
  incoterm: string | null,
  freight: ContextMoney | null,
  insurance: ContextMoney | null,
): ContextMoney | null {
  if (!contractTotal) return null;
  const includes = incotermIncludes(incoterm);
  if (!includes) return null;
  let fob: ContextMoney | null = contractTotal;
  if (includes.freight) {
    if (!freight) return null;
    fob = subtractMoney(fob, freight);
  }
  if (includes.insurance) {
    if (!insurance) return null;
    fob = subtractMoney(fob, insurance);
  }
  return fob;
}

/** CIF value: FOB plus freight plus insurance. Null if any of the three is unknown. */
export function deriveCif(
  fob: ContextMoney | null,
  freight: ContextMoney | null,
  insurance: ContextMoney | null,
): ContextMoney | null {
  if (!fob || !freight || !insurance) return null;
  return sumMoney([fob, freight, insurance]);
}

/** Convert money at a rate. Null in, null out — a conversion without a rate is not a value. */
export function convertMoney(
  value: ContextMoney | null,
  rate: string | null,
  quoteCurrency: string | null,
): ContextMoney | null {
  if (!value || !rate || !quoteCurrency) return null;
  return { amount: new D(value.amount).mul(new D(rate)).toString(), currency: quoteCurrency };
}

/**
 * Package totals, summed from the lines that are the only owner of the underlying facts.
 *
 * A line describes `package_count` identical packages, so weights multiply by the count.
 * A weight total is null when ANY line is missing that weight — a partial sum presented as
 * a total is the failure mode that makes a packing list disagree with the goods.
 */
export function shipmentPackageTotals(packages: ContextPackageLine[]): ContextPackageTotals {
  const count = packages.reduce((sum, p) => sum + p.package_count, 0);

  const totalOf = (pick: (p: ContextPackageLine) => string | null): string | null => {
    if (packages.length === 0) return null;
    let total = new D(0);
    for (const p of packages) {
      const raw = pick(p);
      if (raw === null) return null;
      total = total.plus(new D(raw).mul(p.package_count));
    }
    return total.toString();
  };

  return {
    package_count: count,
    net_weight_kg: totalOf((p) => p.net_weight_kg),
    gross_weight_kg: totalOf((p) => p.gross_weight_kg),
    volume_cbm: totalOf((p) => p.volume_cbm),
  };
}
