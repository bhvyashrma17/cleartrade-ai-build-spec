/**
 * The Comtrade response parser — the single place raw provider text becomes semantic facts.
 *
 * WHY THIS IS ITS OWN MODULE. It used to live inside `real-client.ts`, reachable only at
 * acquisition time. That made `ensureCurrentComtradeNormalization` unable to do what its name
 * promised: with no parser to call, re-materializing observations under a new normalization
 * version could only COPY the semantic fields from the previous version's rows and relabel
 * them. A future parser change would therefore mint rows stamped with the new version while
 * carrying the old version's semantics, and every downstream version assertion would pass.
 * That is the same class of defect as the normalization cache bug this codebase already hit
 * once. Extracting the parser makes re-normalization a real re-parse of the immutable raw
 * response, so semantics genuinely follow the version label.
 *
 * Everything here is pure: no database, no network, no clock. Given the same raw body and the
 * same request contract it always produces the same rows, which is what makes both the
 * acquisition path and the re-normalization path provably agree.
 */

import type { ComtradeFlowRow, FlowDirection } from './client';

/** Parser identity. Owned here; `normalization.ts` re-exports it for existing callers. */
export const COMTRADE_PARSER_VERSION = 'comtrade-parser-v2';

export type ProviderNumberStatus = 'observed' | 'observed_zero' | 'missing' | 'suppressed' | 'invalid' | 'unavailable';

/** Provider quantity-unit codes. Kept beside the parser because they are response semantics. */
const QUANTITY_UNITS: Record<number, string | null> = { 1: null, 2: 'm²', 3: '1000 kWh', 4: 'm', 5: 'u', 6: '2u', 7: 'l', 8: 'kg', 9: '1000u', 10: 'packages', 11: '12u', 12: 'm³', 13: 'carat' };

export interface ComtradeApiRow {
  reporterCode: number | string; partnerCode: number | string; partner2Code?: number | string | null;
  cmdCode: string; refYear: number; period: number | string; flowCode?: string | null; freqCode?: string | null;
  primaryValue: unknown; qty?: unknown; qtyUnitCode?: number | null; qtyUnitAbbr?: string | null;
  altQty?: unknown; altQtyUnitAbbr?: string | null; netWgt?: unknown; grossWgt?: unknown;
  customsCode?: string | null; mosCode?: string | null; clCode?: string | null;
  isQtyEstimated?: boolean | null; isNetWgtEstimated?: boolean | null;
}

/**
 * Read one provider number without ever collapsing absence into zero.
 *
 * Order is load-bearing: null/blank is missing before any string test; suppression is checked
 * before unavailability; a negative number is invalid rather than observed. Only a finite
 * non-negative number becomes an observation, and only exactly 0 becomes `observed_zero`.
 */
export function parseOptionalProviderNumber(value: unknown): { value: number | null; status: ProviderNumberStatus } {
  if (value === null || value === undefined) return { value: null, status: 'missing' };
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return { value: null, status: 'missing' };
    if (/suppressed|confidential|\.\./i.test(trimmed)) return { value: null, status: 'suppressed' };
    if (/unavailable|n\/a/i.test(trimmed)) return { value: null, status: 'unavailable' };
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return { value: null, status: 'invalid' };
  return { value: parsed, status: parsed === 0 ? 'observed_zero' : 'observed' };
}

/** HS revision label → the provider's classification code. */
export function revisionCode(revision: string) {
  const normalized = revision.replace(/[^0-9]/g, '');
  const map: Record<string, string> = { '1992': 'H0', '1996': 'H1', '2002': 'H2', '2007': 'H3', '2012': 'H4', '2017': 'H5', '2022': 'H6' };
  return map[normalized] ?? revision;
}

/** Exactly the request dimensions a response must agree with to be accepted. */
export interface ComtradeParseContract {
  reporter: string;
  /** `'all'` disables the partner check for an all-suppliers distribution. */
  partner: string;
  partner2: string;
  year: number;
  flow_direction: FlowDirection;
  frequency: string;
  customs_code: string;
  mode_of_supply: string;
  hs_revision: string;
  hs_codes: string[];
}

export interface ComtradeParseResult {
  rows: ComtradeFlowRow[];
  provider_row_count: number | null;
  returned_row_count: number;
  accepted_rows: number;
  rejected_rows: number;
  truncated: boolean;
  complete: boolean;
}

/** True when the body is a recognisable provider envelope, i.e. safe to parse. */
export function isComtradeResponseBody(body: unknown): body is { data: ComtradeApiRow[]; count?: number } {
  return Boolean(body) && typeof body === 'object' && Array.isArray((body as { data?: unknown }).data);
}

/**
 * Parse a provider body against the contract it was requested under.
 *
 * A row that disagrees with any requested dimension is rejected rather than reinterpreted, and
 * any rejection makes the page `PARTIAL` — the provider answered a question we did not ask, so
 * the page cannot be treated as a complete answer to ours.
 */
export function parseComtradeResponseBody(body: unknown, contract: ComtradeParseContract): ComtradeParseResult {
  if (!isComtradeResponseBody(body)) throw new Error('Comtrade response has no data array.');
  const data = body.data;
  const providerCount = Number.isFinite(Number(body.count)) ? Number(body.count) : null;
  const requested = new Set(contract.hs_codes), seen = new Set<string>(), rows: ComtradeFlowRow[] = [];
  let rejected = 0;
  const expectedFlow = contract.flow_direction === 'export' ? 'X' : 'M';
  for (const row of data) {
    const partnerMismatch = contract.partner === 'all' ? false : String(row.partnerCode) !== contract.partner;
    const mismatch = String(row.reporterCode) !== contract.reporter || partnerMismatch || String(row.partner2Code ?? '0') !== contract.partner2 || Number(row.refYear) !== contract.year || String(row.period) !== String(contract.year) || !requested.has(row.cmdCode) || (row.flowCode != null && row.flowCode !== expectedFlow) || (row.freqCode != null && row.freqCode !== contract.frequency) || (row.customsCode != null && row.customsCode !== contract.customs_code) || (row.mosCode != null && row.mosCode !== contract.mode_of_supply) || (row.clCode != null && row.clCode !== revisionCode(contract.hs_revision));
    if (mismatch) { rejected++; continue; }
    const key = `${row.reporterCode}:${row.partnerCode}:${row.partner2Code ?? 0}:${row.cmdCode}:${row.refYear}:${expectedFlow}:${contract.frequency}:${contract.customs_code}:${contract.mode_of_supply}`;
    if (seen.has(key)) { rejected++; continue; }
    seen.add(key);
    const trade = parseOptionalProviderNumber(row.primaryValue), qty = parseOptionalProviderNumber(row.qty), alt = parseOptionalProviderNumber(row.altQty), net = parseOptionalProviderNumber(row.netWgt), gross = parseOptionalProviderNumber(row.grossWgt);
    const quantity = qty.value;
    rows.push({ reporter: String(row.reporterCode), partner: String(row.partnerCode), partner2: String(row.partner2Code ?? '0'), hs_code: row.cmdCode, year: Number(row.refYear), period: String(row.period), flow_code: row.flowCode ?? expectedFlow, frequency: row.freqCode ?? contract.frequency, customs_code: row.customsCode ?? contract.customs_code, mode_of_supply: row.mosCode ?? contract.mode_of_supply, value: trade.value, value_status: trade.status, quantity, quantity_status: qty.status, unit: quantity == null ? null : (row.qtyUnitAbbr?.trim() || (row.qtyUnitCode ? QUANTITY_UNITS[row.qtyUnitCode] : null) || null), alternate_quantity: alt.value, alternate_quantity_unit: row.altQtyUnitAbbr ?? null, net_weight: net.value, gross_weight: gross.value, estimate_flag: Boolean(row.isQtyEstimated || row.isNetWgtEstimated), suppression_flag: trade.status === 'suppressed', confidentiality_flag: trade.status === 'suppressed' });
  }
  const truncated = providerCount != null && providerCount > data.length;
  return { rows, provider_row_count: providerCount, returned_row_count: data.length, accepted_rows: rows.length, rejected_rows: rejected, truncated, complete: providerCount != null && !truncated && rejected === 0 };
}
