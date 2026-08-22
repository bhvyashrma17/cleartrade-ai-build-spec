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
  hs_revision?: string;
  frequency?: 'A' | 'M';
  partner2?: string;
  customs_code?: string;
  mode_of_supply?: string;
  purpose?: 'country_truth' | 'general_ingest';
  before_physical_request?: () => Promise<void>;
  after_physical_response?: (metadata: { status: number; headers: Headers; retrieved_at: Date }) => Promise<void>;
}

export interface ComtradeChapterResolution {
  chapter: string;
  hs_codes: string[];
  raw_response_text?: string;
  response_checksum?: string;
  retrieved_at?: Date;
  dataset_version?: string | null;
}

/** One HS-code-level row within the requested chapter, for the requested reporter/partner/year. */
export interface ComtradeFlowRow {
  reporter: string;
  partner: string;
  hs_code: string;
  year: number;
  period: string;
  value: number | null;
  value_status?: 'observed' | 'observed_zero' | 'missing' | 'suppressed' | 'invalid' | 'unavailable';
  quantity: number | null;
  unit: string | null;
  partner2?: string | null;
  flow_code?: string | null;
  frequency?: string | null;
  customs_code?: string | null;
  mode_of_supply?: string | null;
  alternate_quantity?: number | null;
  alternate_quantity_unit?: string | null;
  net_weight?: number | null;
  gross_weight?: number | null;
  estimate_flag?: boolean | null;
  suppression_flag?: boolean | null;
  confidentiality_flag?: boolean | null;
}

export interface ComtradeFetchResult {
  rows: ComtradeFlowRow[];
  request_count: number;
  retrieved_at?: Date;
  source_dataset_version?: string | null;
  evidence_pages?: Array<{
    http_status: number;
    raw_response_text: string;
    response_checksum: string;
    redacted_request: string;
    provider_row_count: number | null;
    returned_row_count: number;
    completeness: 'COMPLETE' | 'PARTIAL' | 'FAILED' | 'STALE';
    completeness_metadata: Record<string, unknown>;
    quota_metadata: Record<string, unknown> | null;
    retrieved_at: Date;
  }>;
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
  constructor(message = 'Comtrade rate limit exceeded.', readonly retryAfterMs: number | null = null, readonly physicalRequestCount = 1) {
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
