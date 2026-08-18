/**
 * Formatting for rendered documents.
 *
 * Every function here is presentational and non-mutating: it turns a canonical value into the
 * string that appears on the page and never changes what the value IS. There is no `|| 0`, no
 * default currency, no guessed date and no clamp anywhere in this file — a missing value comes
 * back as `null` and each renderer prints an em dash for it.
 *
 * That is the direct replacement for the legacy behaviour this integration exists to remove:
 * `Number(carton.netWeightKg || 0)` printed an unknown weight as `0.00`, and
 * `grossWeightRaw < netWeight ? netWeight : grossWeightRaw` silently rewrote a data-entry error
 * into a plausible number at print time.
 *
 * Monetary formatting is the one exception to "presentational and non-mutating": rounding to a
 * currency's minor units genuinely changes the digits shown. That is why it lives in its own
 * versioned policy module rather than here, and why the version is frozen into the snapshot.
 */

import {
  formatDocumentMoney, formatDocumentUnitPrice, formatExchangeRate,
} from '@/lib/document-money';
import type { ContextMoney, ContextQuantity } from '@/lib/document-data';
import type { Cell } from './model';

/** The one place "we do not have this" becomes visible text. */
export const ABSENT = '—';

export const cell = (value: string | null | undefined): Cell => {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/** Renders whatever a cell holds, including its absence. Never returns an empty string. */
export const show = (value: Cell): string => value ?? ABSENT;

/**
 * Money as it appears on a document: `USD 1,543.13`.
 *
 * Delegates entirely to `src/lib/document-money.ts`. There is no rounding, padding or grouping
 * logic here, and none in the PDF, DOCX or HTML renderers either — one implementation, so the
 * three formats cannot disagree about a payable amount.
 *
 * `policy` is the version frozen into the context this value came from, NOT whatever is current.
 */
export function money(
  value: ContextMoney | null | undefined,
  policy?: string | null,
): Cell {
  if (!value) return null;
  return formatDocumentMoney(value.amount, value.currency, policy ?? null);
}

/**
 * A unit price, at the precision it was agreed.
 *
 * Separate from `money()` on purpose: a price of USD 1.2345 is the commercial agreement, and
 * rounding it to USD 1.23 would print an invoice whose own arithmetic does not work.
 */
export function unitPrice(
  value: ContextMoney | null | undefined,
  policy?: string | null,
): Cell {
  if (!value) return null;
  return formatDocumentUnitPrice(value.amount, value.currency, policy ?? null);
}

/**
 * An exchange rate. Not money — see `formatExchangeRate` for why rounding one to the quote
 * currency's minor units would break the conversion it states.
 */
export function exchangeRate(value: string | null | undefined): Cell {
  if (value === null || value === undefined || value === '') return null;
  return formatExchangeRate(value);
}

/** Quantity as "1,000 kg". A quantity without its unit prints the number alone, never a guess. */
export function quantity(value: ContextQuantity | null | undefined): Cell {
  if (!value) return null;
  const [whole, fraction] = value.value.split('.');
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const number = fraction ? `${grouped}.${fraction}` : grouped;
  return value.unit ? `${number} ${value.unit}` : number;
}

/** A decimal string with grouping, for weights and volumes. Unit is supplied by the caller. */
export function decimal(value: string | null | undefined, unit?: string): Cell {
  if (value === null || value === undefined || value === '') return null;
  const [whole, fraction] = value.split('.');
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const number = fraction ? `${grouped}.${fraction}` : grouped;
  return unit ? `${number} ${unit}` : number;
}

/**
 * Dates as "18 Aug 2026", in UTC.
 *
 * UTC deliberately: rendering the same snapshot in two timezones must not print two different
 * dates on a customs document, which is what a locale-local formatter would do.
 */
export function date(value: string | Date | null | undefined): Cell {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(d);
}

/**
 * A postal address as display lines.
 *
 * Absent parts are skipped rather than rendered as blank lines, so an incomplete address looks
 * incomplete instead of looking like a formatting bug. Readiness has already refused to render
 * any document whose required address is missing.
 */
export function addressLines(address: {
  line1: string | null; line2: string | null; city: string | null;
  region: string | null; postal_code: string | null; country_code: string | null;
}): string[] {
  const cityLine = [address.city, address.region, address.postal_code].filter(Boolean).join(', ');
  return [address.line1, address.line2, cityLine || null, address.country_code]
    .filter((l): l is string => Boolean(l && l.trim()));
}

/** A port as "Nhava Sheva (INNSA)". An unknown code is simply absent — never invented. */
export function port(value: { name: string | null; unlocode: string | null }): Cell {
  if (!value.name) return value.unlocode ? value.unlocode : null;
  return value.unlocode ? `${value.name} (${value.unlocode})` : value.name;
}

/**
 * Payment terms, which are canonically JSON.
 *
 * Rendered from whatever shape is actually stored, with an explicit fallback to compact JSON
 * rather than an empty box — the terms are on the document because they are contractual, so
 * showing nothing would be worse than showing an unpolished string.
 */
export function paymentTerms(value: unknown): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return cell(value);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const label = record.label ?? record.kind ?? record.type;
    if (typeof label === 'string' && label.trim()) {
      const days = typeof record.days === 'number' ? ` (${record.days} days)` : '';
      return `${label.replace(/_/g, ' ')}${days}`;
    }
    return cell(JSON.stringify(value));
  }
  return cell(String(value));
}
