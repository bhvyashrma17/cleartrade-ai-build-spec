import { createHash } from 'node:crypto';
import type { ComtradeSourceMode, FlowDirection } from './client';

export type ComtradeFrequency = 'A' | 'M';
export type ComtradeRequestPurpose = 'country_truth' | 'general_ingest';

export interface CanonicalComtradeRequest {
  provider: 'un_comtrade';
  dataset: 'goods-trade';
  source_mode: ComtradeSourceMode;
  purpose: ComtradeRequestPurpose;
  reporter_code: string;
  partner_code: string;
  partner2_code: string;
  flow_direction: FlowDirection;
  frequency: ComtradeFrequency;
  period: string;
  hs_codes: string[];
  hs_revision: string;
  customs_code: string;
  mode_of_supply: string;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

export function canonicalComtradeRequest(input: CanonicalComtradeRequest): CanonicalComtradeRequest {
  const hsCodes = [...new Set(input.hs_codes.map(String))].sort();
  if (!/^\d+$/.test(input.reporter_code) || !/^\d+$/.test(input.partner_code) || !/^\d+$/.test(input.partner2_code)) throw new Error('Comtrade area codes must be numeric strings.');
  if (!hsCodes.length || hsCodes.some((code) => !/^\d{6}$/.test(code))) throw new Error('Country Truth requests require explicit HS6 codes.');
  if (!/^\d{4}(\d{2})?$/.test(input.period)) throw new Error('Comtrade period must be YYYY or YYYYMM.');
  if (!input.hs_revision.trim()) throw new Error('Comtrade request requires an explicit HS revision.');
  if (input.purpose === 'country_truth' && input.flow_direction !== 'import') throw new Error('Country Truth demand requests must use candidate-market imports.');
  return { ...input, reporter_code: String(input.reporter_code), partner_code: String(input.partner_code), partner2_code: String(input.partner2_code), hs_codes: hsCodes, hs_revision: input.hs_revision.trim() };
}

export function serializeComtradeRequest(input: CanonicalComtradeRequest) {
  return JSON.stringify(canonical(canonicalComtradeRequest(input)));
}

export function comtradeRequestFingerprint(input: CanonicalComtradeRequest) {
  return createHash('sha256').update(serializeComtradeRequest(input)).digest('hex');
}

export function comtradeIngestDedupeKey(input: CanonicalComtradeRequest) {
  return `comtrade_ingest:${comtradeRequestFingerprint(input)}`;
}
