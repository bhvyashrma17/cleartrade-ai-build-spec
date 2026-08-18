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
 */

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
 * Money as "USD 1,250.00".
 *
 * Grouping and the decimal separator are display only — the amount string is never reparsed
 * through a JS number, so a 12-digit total keeps its last cent. Currencies with other minor
 * unit counts keep whatever precision the canonical value carries rather than being forced
 * to two places.
 */
export function money(value: ContextMoney | null | undefined): Cell {
  if (!value) return null;
  const [whole, fraction = ''] = value.amount.split('.');
  const negative = whole.startsWith('-');
  const digits = negative ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  // Pad to two places when the value has fewer, because money reads wrong at one decimal.
  // Extra precision is preserved rather than rounded away.
  const minor = fraction.length === 0 ? '00' : fraction.length === 1 ? `${fraction}0` : fraction;
  return `${value.currency} ${negative ? '-' : ''}${grouped}.${minor}`;
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
