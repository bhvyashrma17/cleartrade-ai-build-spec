/**
 * Document monetary presentation policy.
 *
 * One module, one set of rules, consumed identically by the PDF, DOCX and HTML renderers.
 * Scattering `.toFixed(2)` through three templates is how they drift, and a commercial invoice
 * whose PDF and DOCX disagree about the payable amount is worse than one that is merely ugly.
 *
 * The separation this exists to protect:
 *
 *     canonical commercial data   full Decimal precision, never touched
 *     derivation                  full Decimal precision, never truncated mid-calculation
 *     document presentation       rounded to the currency's minor units, here and nowhere else
 *
 * Phase 8 found the symptom: 1250 x USD 1.2345 is exactly 1543.125, and the renderer printed
 * `USD 1,543.125`. Mathematically honest, but not what a commercial invoice states. The fix is
 * to round at the presentation boundary — NOT to round the unit price, which really is 1.2345
 * and must stay that way in `Deal.unit_price_amount`.
 */

import { Prisma } from '@prisma/client';

const D = Prisma.Decimal;

/**
 * Bumped whenever a change would alter a rendered monetary value.
 *
 * Frozen into every `DocumentGenerationContext`, so a document generated today keeps rendering
 * under the rules that applied when it was generated even after a later version ships.
 */
export const DOCUMENT_MONEY_POLICY_VERSION = 'v1' as const;
export type MoneyPolicyVersion = 'v1';

/**
 * Rounding mode, stated explicitly rather than inherited.
 *
 * `ROUND_HALF_UP` in decimal.js rounds half AWAY FROM ZERO, which is the ordinary commercial
 * convention: 1543.125 -> 1543.13, and -1543.125 -> -1543.13. It is passed on every call
 * instead of relying on `Decimal.rounding`, whose default is process-global and could be
 * changed by any other module — silently turning every invoice total into banker's rounding,
 * which would round 1543.125 DOWN to 1543.12 and be very hard to notice.
 */
export const DOCUMENT_MONEY_ROUNDING = Prisma.Decimal.ROUND_HALF_UP;
export const DOCUMENT_MONEY_ROUNDING_NAME = 'ROUND_HALF_UP' as const;

/**
 * Minor units per currency, per ISO 4217.
 *
 * Deliberately short: it covers the currencies ClearTrade actually transacts in, and nothing
 * else. A long speculative table would imply a confidence about exotic currencies that nothing
 * in the product has earned.
 *
 * Not every currency has two decimal places — JPY and KRW have none, which is exactly why this
 * is a map and not a constant 2.
 */
const MINOR_UNITS: Record<string, number> = {
  INR: 2, USD: 2, EUR: 2, GBP: 2, AED: 2, SGD: 2, AUD: 2, CAD: 2, CHF: 2, CNY: 2,
  HKD: 2, NZD: 2, ZAR: 2, SAR: 2, QAR: 2, MYR: 2, THB: 2, PHP: 2, BDT: 2, LKR: 2,
  JPY: 0, KRW: 0,
};

/**
 * The fallback for a currency we do not have an entry for: 2 decimal places.
 *
 * Stated as a policy rather than left implicit, because the alternatives are worse. Refusing to
 * render would block a document over a presentation detail; guessing 0 would drop real minor
 * units from the total. Two places is right for roughly every currency in commercial use, and
 * `isKnownCurrency()` lets a caller surface the assumption where that matters.
 */
export const UNKNOWN_CURRENCY_MINOR_UNITS = 2;

export function isKnownCurrency(currency: string): boolean {
  return currency.trim().toUpperCase() in MINOR_UNITS;
}

export function currencyMinorUnits(currency: string): number {
  return MINOR_UNITS[currency.trim().toUpperCase()] ?? UNKNOWN_CURRENCY_MINOR_UNITS;
}

/** Everything a later reader needs to know how a rendered amount was produced. */
export interface MoneyPolicySnapshot {
  version: MoneyPolicyVersion;
  rounding_mode: typeof DOCUMENT_MONEY_ROUNDING_NAME;
  /** The minor-unit map as applied, so a future map change cannot rewrite an old document. */
  minor_units: Record<string, number>;
  unknown_currency_minor_units: number;
}

export function moneyPolicySnapshot(): MoneyPolicySnapshot {
  return {
    version: DOCUMENT_MONEY_POLICY_VERSION,
    rounding_mode: DOCUMENT_MONEY_ROUNDING_NAME,
    minor_units: { ...MINOR_UNITS },
    unknown_currency_minor_units: UNKNOWN_CURRENCY_MINOR_UNITS,
  };
}

/**
 * Resolve the rules to apply for a given frozen policy version.
 *
 * A snapshot taken before this field existed reports `undefined`, which resolves to v1 — the
 * policy that was in force when it was frozen. Guessing "whatever is current" is precisely the
 * failure this versioning exists to prevent.
 */
export function resolveMoneyPolicy(version: MoneyPolicyVersion | string | null | undefined) {
  switch (version) {
    case 'v1':
    case undefined:
    case null:
      return { version: 'v1' as const, rounding: DOCUMENT_MONEY_ROUNDING, minorUnits: currencyMinorUnits };
    default:
      throw new Error(
        `Unknown document money policy "${version}". A document frozen under an unknown policy cannot be re-rendered faithfully.`,
      );
  }
}

/**
 * Round an amount to its currency's minor units.
 *
 * The ONLY place rounding happens. Intermediate arithmetic in `document-data/derive.ts` keeps
 * full precision, so a chain of derivations is never rounded twice.
 */
export function roundDocumentMoney(
  amount: string,
  currency: string,
  version: MoneyPolicyVersion | string | null = DOCUMENT_MONEY_POLICY_VERSION,
): string {
  const policy = resolveMoneyPolicy(version);
  return new D(amount).toDecimalPlaces(policy.minorUnits(currency), policy.rounding).toString();
}

/** Thousands separators, applied to an already-rounded number. Presentation only. */
function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * A monetary amount as it appears on a document: `USD 1,543.13`.
 *
 * Always shows exactly the currency's minor units — padded up when the value has fewer, rounded
 * down to them when it has more. A total that prints `1,543.1` reads like a typo, and one that
 * prints `1,543.125` reads like a different number than the one that will be paid.
 */
export function formatDocumentMoney(
  amount: string,
  currency: string,
  version: MoneyPolicyVersion | string | null = DOCUMENT_MONEY_POLICY_VERSION,
): string {
  const policy = resolveMoneyPolicy(version);
  const places = policy.minorUnits(currency);
  const rounded = new D(amount).toDecimalPlaces(places, policy.rounding);
  const negative = rounded.isNegative();
  const [whole, fraction = ''] = rounded.abs().toFixed(places).split('.');
  const body = places === 0 ? group(whole!) : `${group(whole!)}.${fraction}`;
  return `${currency} ${negative ? '-' : ''}${body}`;
}

/**
 * A unit price as it appears on a document: `USD 1.2345`, `USD 0.0125`.
 *
 * Deliberately NOT rounded to minor units. A price agreed at four decimal places is the
 * commercial agreement, and printing `USD 1.23` next to a quantity of 1250 would produce an
 * invoice whose own arithmetic does not work. Padded up to the currency's minor units so a
 * whole-number price still reads as money.
 */
export function formatDocumentUnitPrice(
  amount: string,
  currency: string,
  version: MoneyPolicyVersion | string | null = DOCUMENT_MONEY_POLICY_VERSION,
): string {
  const policy = resolveMoneyPolicy(version);
  const minimum = policy.minorUnits(currency);
  const value = new D(amount);
  const places = Math.max(minimum, value.decimalPlaces());
  const negative = value.isNegative();
  const [whole, fraction = ''] = value.abs().toFixed(places).split('.');
  const body = places === 0 ? group(whole!) : `${group(whole!)}.${fraction}`;
  return `${currency} ${negative ? '-' : ''}${body}`;
}

/**
 * An exchange rate as it appears on a document: `83.7425`, not `83.74`.
 *
 * A rate is not a monetary amount. It carries a currency pair, but rounding it to the quote
 * currency's minor units would destroy the precision the rate was actually quoted at and make
 * the stated conversion fail to reproduce. Kept whole, with grouping only.
 */
export function formatExchangeRate(rate: string): string {
  const value = new D(rate);
  const negative = value.isNegative();
  const text = value.abs().toString();
  const [whole, fraction] = text.split('.');
  const body = fraction ? `${group(whole!)}.${fraction}` : group(whole!);
  return `${negative ? '-' : ''}${body}`;
}
