/**
 * Comtrade client interface — the boundary between the ingest job handler and whatever
 * actually fetches trade data. Mirrors `src/lib/discovery`'s `DiscoveryEngine` split: the
 * handler, the job system, and the schema never name a client implementation, so swapping
 * one in costs exactly one case in `getComtradeClient()`.
 */

export type FlowDirection = 'import' | 'export';

export interface ComtradeFetchParams {
  /** Two-digit HS chapter, e.g. "09". Never hardcoded — always a job parameter. */
  hs_chapter: string;
  /** Comtrade reporter code, e.g. "699" for India. */
  reporter: string;
  /** Comtrade partner code, e.g. "0" for World. */
  partner: string;
  year: number;
  flow_direction: FlowDirection;
  /** Explicit HS6 leaf codes. Chapter aggregates are never requested or ingested. */
  hs_codes: string[];
}

export interface ComtradeChapterResolution {
  chapter: string;
  hs_codes: string[];
}

/** One HS-code-level row within the requested chapter, for the requested reporter/partner/year. */
export interface ComtradeFlowRow {
  reporter: string;
  partner: string;
  hs_code: string;
  year: number;
  period: string;
  value: number;
  quantity: number | null;
  unit: string | null;
}

export interface ComtradeFetchResult {
  rows: ComtradeFlowRow[];
  request_count: number;
  retrieved_at?: Date;
  source_dataset_version?: string | null;
}

export type ComtradeSourceMode = 'fixture' | 'mock' | 'preview' | 'authenticated';

export interface ComtradeClientIdentity {
  provider: 'un_comtrade';
  mode: ComtradeSourceMode;
  authenticated: boolean;
  /** Stable non-secret identity used for shared quota accounting. */
  credential_fingerprint: string;
  source_dataset: string;
  source_dataset_version: string | null;
}

/** Thrown by a client when the provider's rate limit is exhausted after its own retries. */
export class ComtradeRateLimitError extends Error {
  constructor(message = 'Comtrade rate limit exceeded.', readonly retryAfterMs: number | null = null) {
    super(message);
    this.name = 'ComtradeRateLimitError';
  }
}

export interface ComtradeClient {
  readonly name: string;
  readonly identity: ComtradeClientIdentity;
  resolveChapter(hsChapter: string): Promise<ComtradeChapterResolution>;
  fetchChapter(params: ComtradeFetchParams): Promise<ComtradeFetchResult>;
}
