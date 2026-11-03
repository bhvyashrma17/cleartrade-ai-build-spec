/**
 * Batched UN Comtrade reads (docs/36 §3.3).
 *
 * The per-reporter client (`real-client.ts`) asks one reporter, one partner and one year per call;
 * covering 218 markets that way spends a day's free quota on one product. One batched call names
 * the product, the flow, several periods and either every reporter or a list of them, so the
 * newest-year link for a product costs about one call.
 *
 * A response that reaches `maxRecords` may be cut short, and a cut-short answer is never used as if
 * it were whole: the query splits — by period first, then into reporter halves — until no page
 * reaches the cap. A single reporter-year that still reaches it is refused rather than truncated.
 *
 * Every page is returned with its raw text and sha256 for `SourceEvidence`; rows are validated
 * against the query they answer, and a row answering a question we did not ask is rejected and
 * counted, never reinterpreted. Absence is kept distinct from zero (`parseOptionalProviderNumber`).
 */
import { createHash } from 'node:crypto';
import type { ComtradePolicy } from '@/lib/config';
import { ComtradeProviderRequestError, ComtradeRateLimitError } from './client';
import { parseOptionalProviderNumber, type ProviderNumberStatus } from './parser';

export const COMTRADE_BATCH_PARSER_VERSION = 'comtrade-batch-parser-v1';
const DEFAULT_BASE_URL = 'https://comtradeapi.un.org/data/v1/get/C/A/HS';

export interface BatchedComtradeQuery {
  hs6: string;
  flow: 'M' | 'X';
  periods: number[];
  /** Provider reporter codes, or every reporter (the parameter is then omitted). */
  reporters: 'all' | string[];
  /** Provider partner codes (`0` is World), or every partner. */
  partners: 'all' | string[];
  max_records: number;
}

export interface BatchedComtradeRow {
  reporter_code: string;
  partner_code: string;
  period: number;
  hs6: string;
  flow: 'M' | 'X';
  value_usd: number | null;
  value_status: ProviderNumberStatus;
  net_weight_kg: number | null;
  net_weight_status: ProviderNumberStatus;
  net_weight_estimated: boolean;
  /** The HS edition the reporter used (`H5`, `H6`…), when the provider says. */
  classification: string | null;
  original_classification: boolean | null;
}

export interface BatchedComtradePage {
  url: string;
  periods: number[];
  reporters: 'all' | string[];
  http_status: number;
  raw_response_text: string;
  response_sha256: string;
  provider_count: number | null;
  returned_rows: number;
  accepted_rows: number;
  rejected_rows: number;
  /** The page reached `maxRecords` (or the provider said more exist): it was split and its rows dropped. */
  reached_cap: boolean;
  retrieved_at: Date;
  quota: { limit: number | null; remaining: number | null; reset_at: string | null };
}

export interface BatchedComtradeResult {
  rows: BatchedComtradeRow[];
  /** Every physical page, split ones included, in request order. */
  pages: BatchedComtradePage[];
  physical_calls: number;
  /** True when no used page rejected a row. */
  complete: boolean;
}

export interface BatchedComtradeDeps {
  api_key: string | null;
  policy: Pick<ComtradePolicy, 'max_retries' | 'retry_backoff_ms' | 'request_timeout_ms' | 'request_delay_ms'>;
  /** The reporter codes to halve when a query over every reporter reaches the cap. */
  reporter_universe: readonly string[];
  base_url?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Reserve quota before each physical call (`reserveProviderQuota`); throw to stop. */
  before_physical_request?: () => Promise<void>;
  clock?: () => Date;
}

export class ComtradeBatchError extends Error {
  constructor(message: string, readonly physicalRequestCount: number) {
    super(message);
    this.name = 'ComtradeBatchError';
  }
}

interface ApiRow {
  reporterCode?: unknown; partnerCode?: unknown; partner2Code?: unknown; cmdCode?: unknown; period?: unknown; refYear?: unknown;
  flowCode?: unknown; freqCode?: unknown; customsCode?: unknown; motCode?: unknown; primaryValue?: unknown; netWgt?: unknown;
  isNetWgtEstimated?: unknown; classificationCode?: unknown; isOriginalClassification?: unknown;
}

export function assertBatchedQuery(query: BatchedComtradeQuery) {
  if (!/^\d{6}$/.test(query.hs6)) throw new Error('A batched Comtrade query needs one six-digit HS code.');
  if (!query.periods.length || query.periods.some((period) => !Number.isInteger(period) || period < 1988 || period > 2100)) throw new Error('A batched Comtrade query needs annual periods.');
  if (query.periods.length > 12) throw new Error('Comtrade accepts at most 12 periods a call.');
  const codes = (list: 'all' | string[]) => list === 'all' || (list.length > 0 && list.every((code) => /^\d+$/.test(code)));
  if (!codes(query.reporters) || !codes(query.partners)) throw new Error('Reporter and partner codes must be numeric provider codes, or all.');
  if (!(Number.isInteger(query.max_records) && query.max_records > 0)) throw new Error('maxRecords must be a positive integer.');
}

export function batchedQueryUrl(query: BatchedComtradeQuery, baseUrl = DEFAULT_BASE_URL): URL {
  assertBatchedQuery(query);
  const url = new URL(baseUrl);
  url.searchParams.set('cmdCode', query.hs6);
  url.searchParams.set('flowCode', query.flow);
  url.searchParams.set('period', [...query.periods].sort((a, b) => a - b).join(','));
  if (query.reporters !== 'all') url.searchParams.set('reporterCode', [...query.reporters].sort((a, b) => Number(a) - Number(b)).join(','));
  if (query.partners !== 'all') url.searchParams.set('partnerCode', [...query.partners].sort((a, b) => Number(a) - Number(b)).join(','));
  url.searchParams.set('partner2Code', '0');
  url.searchParams.set('customsCode', 'C00');
  url.searchParams.set('motCode', '0');
  url.searchParams.set('breakdownMode', 'classic');
  url.searchParams.set('maxRecords', String(query.max_records));
  url.searchParams.set('includeDesc', 'false');
  return url;
}

const text = (value: unknown) => (value == null ? null : String(value).trim());

/** Parses one page against the query it answers. Pure. */
export function parseBatchedPage(body: unknown, query: BatchedComtradeQuery): { rows: BatchedComtradeRow[]; provider_count: number | null; returned: number; rejected: number } {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { data?: unknown }).data)) {
    const error = body && typeof body === 'object' ? text((body as { error?: unknown }).error) : null;
    throw new Error(`Comtrade response has no data array${error ? `: ${error}` : ''}.`);
  }
  const envelope = body as { data: ApiRow[]; count?: unknown };
  const providerCount = Number.isFinite(Number(envelope.count)) && envelope.count != null ? Number(envelope.count) : null;
  const reporters = query.reporters === 'all' ? null : new Set(query.reporters);
  const partners = query.partners === 'all' ? null : new Set(query.partners);
  const periods = new Set(query.periods);
  const seen = new Set<string>();
  const rows: BatchedComtradeRow[] = [];
  let rejected = 0;
  for (const row of envelope.data) {
    const reporter = text(row.reporterCode);
    const partner = text(row.partnerCode);
    const period = Number(row.period ?? row.refYear);
    const valid = reporter != null && /^\d+$/.test(reporter) && (!reporters || reporters.has(reporter))
      && partner != null && /^\d+$/.test(partner) && (!partners || partners.has(partner))
      && periods.has(period) && (row.refYear == null || Number(row.refYear) === period)
      && text(row.cmdCode) === query.hs6
      && (row.flowCode == null || text(row.flowCode) === query.flow)
      && (row.freqCode == null || text(row.freqCode) === 'A')
      && (row.partner2Code == null || text(row.partner2Code) === '0')
      && (row.customsCode == null || text(row.customsCode) === 'C00')
      && (row.motCode == null || text(row.motCode) === '0');
    const key = `${reporter}:${partner}:${period}`;
    if (!valid || seen.has(key)) {
      rejected += 1;
      continue;
    }
    seen.add(key);
    const value = parseOptionalProviderNumber(row.primaryValue);
    const weight = parseOptionalProviderNumber(row.netWgt);
    rows.push({
      reporter_code: reporter!, partner_code: partner!, period, hs6: query.hs6, flow: query.flow,
      value_usd: value.value, value_status: value.status,
      net_weight_kg: weight.value, net_weight_status: weight.status, net_weight_estimated: row.isNetWgtEstimated === true,
      classification: text(row.classificationCode), original_classification: typeof row.isOriginalClassification === 'boolean' ? row.isOriginalClassification : null,
    });
  }
  return { rows, provider_count: providerCount, returned: envelope.data.length, rejected };
}

function quotaMetadata(headers: Headers) {
  const number = (...names: string[]) => {
    for (const name of names) {
      const raw = headers.get(name);
      if (raw != null && Number.isFinite(Number(raw))) return Number(raw);
    }
    return null;
  };
  const reset = headers.get('x-ratelimit-reset') ?? headers.get('ratelimit-reset');
  let resetAt: string | null = null;
  if (reset) {
    const epoch = Number(reset);
    const date = Number.isFinite(epoch) ? new Date(epoch * 1000) : new Date(reset);
    if (!Number.isNaN(date.getTime())) resetAt = date.toISOString();
  }
  return { limit: number('x-ratelimit-limit', 'ratelimit-limit'), remaining: number('x-ratelimit-remaining', 'ratelimit-remaining'), reset_at: resetAt };
}

function retryAfterMs(response: Response): number | null {
  const raw = response.headers.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

/** Runs a batched query, splitting any page that reaches the cap until none does. */
export async function fetchBatchedComtrade(query: BatchedComtradeQuery, deps: BatchedComtradeDeps): Promise<BatchedComtradeResult> {
  assertBatchedQuery(query);
  const fetchImpl = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const clock = deps.clock ?? (() => new Date());
  const pages: BatchedComtradePage[] = [];
  const rows: BatchedComtradeRow[] = [];
  let calls = 0;
  let complete = true;

  async function physical(url: URL): Promise<{ response: Response; raw: string; retrievedAt: Date }> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= deps.policy.max_retries; attempt += 1) {
      if (attempt) await sleep(deps.policy.retry_backoff_ms * 2 ** (attempt - 1));
      else if (calls > 0 && deps.policy.request_delay_ms > 0) await sleep(deps.policy.request_delay_ms);
      await deps.before_physical_request?.();
      calls += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), deps.policy.request_timeout_ms ?? 20_000);
      let response: Response;
      try {
        response = await fetchImpl(url, { headers: deps.api_key ? { 'Ocp-Apim-Subscription-Key': deps.api_key } : undefined, signal: controller.signal });
      } catch (error) {
        lastError = error;
        continue;
      } finally {
        clearTimeout(timer);
      }
      if (response.status === 429) {
        const wait = retryAfterMs(response);
        lastError = new ComtradeRateLimitError(`Comtrade rate limited batched request ${attempt + 1}.`, wait, calls);
        if (attempt < deps.policy.max_retries && wait != null && wait <= 60_000) await sleep(wait);
        continue;
      }
      const raw = await response.text();
      if (response.status >= 500) {
        lastError = new Error(`Comtrade request failed: ${response.status}`);
        continue;
      }
      if (!response.ok) throw new ComtradeProviderRequestError(`Comtrade request failed: ${response.status} ${raw.slice(0, 300)}`, calls);
      return { response, raw, retrievedAt: clock() };
    }
    if (lastError instanceof ComtradeRateLimitError) throw lastError;
    throw new ComtradeProviderRequestError(lastError instanceof Error ? lastError.message : 'Comtrade batched request failed after retries.', calls, { cause: lastError });
  }

  async function run(part: BatchedComtradeQuery): Promise<void> {
    const url = batchedQueryUrl(part, deps.base_url);
    const { response, raw, retrievedAt } = await physical(url);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch (error) {
      throw new ComtradeProviderRequestError('Comtrade response is not valid JSON.', calls, { cause: error });
    }
    const parsed = parseBatchedPage(body, part);
    const reachedCap = parsed.returned >= part.max_records || (parsed.provider_count != null && parsed.provider_count > parsed.returned);
    // The key never travels in the URL (it is a header), so the URL is safe to store as is.
    pages.push({
      url: url.toString(), periods: [...part.periods], reporters: part.reporters === 'all' ? 'all' : [...part.reporters], http_status: response.status,
      raw_response_text: raw, response_sha256: createHash('sha256').update(raw).digest('hex'), provider_count: parsed.provider_count,
      returned_rows: parsed.returned, accepted_rows: parsed.rows.length, rejected_rows: parsed.rejected, reached_cap: reachedCap,
      retrieved_at: retrievedAt, quota: quotaMetadata(response.headers),
    });
    if (!reachedCap) {
      rows.push(...parsed.rows);
      if (parsed.rejected > 0) complete = false;
      return;
    }
    if (part.periods.length > 1) {
      for (const period of [...part.periods].sort((a, b) => a - b)) await run({ ...part, periods: [period] });
      return;
    }
    const reporters = part.reporters === 'all' ? [...deps.reporter_universe] : part.reporters;
    if (reporters.length > 1) {
      const half = Math.ceil(reporters.length / 2);
      await run({ ...part, reporters: reporters.slice(0, half) });
      await run({ ...part, reporters: reporters.slice(half) });
      return;
    }
    throw new ComtradeBatchError(`Reporter ${reporters[0] ?? 'all'} for ${part.periods[0]} still reaches ${part.max_records} records; refusing a truncated answer.`, calls);
  }

  await run({ ...query, periods: [...query.periods] });
  return { rows, pages, physical_calls: calls, complete };
}
