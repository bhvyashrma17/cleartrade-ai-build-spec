/**
 * The Comtrade calls a v5 run makes (docs/36 §3.3), with the platform's quota and evidence rules.
 *
 * Only an authenticated client spends the shared key: preview has no batched endpoint, and mock
 * data is never a newest year. Every physical call is reserved against the daily budget first, so
 * a run cannot take the headroom other work needs; every page is stored whole as `SourceEvidence`.
 * A failed call does not fail the run — it scores on BACI alone and says why.
 */
import { createHash } from 'node:crypto';
import { EvidenceCompletenessStatus, EvidenceOrigin, type Prisma } from '@prisma/client';
import { getComtradeClient } from '@/lib/comtrade';
import { COMTRADE_BATCH_PARSER_VERSION, fetchBatchedComtrade, type BatchedComtradePage, type BatchedComtradeQuery, type BatchedComtradeRow } from '@/lib/comtrade/batch';
import type { ComtradePolicy } from '@/lib/config';
import { appEnvironment } from '@/lib/evidence-environment';
import { prisma } from '@/lib/prisma';
import { reconcileProviderQuota, reserveProviderQuota } from '@/lib/provider-quota';

export interface V5ComtradeAccess {
  mode: 'authenticated' | 'unavailable';
  api_key: string | null;
  credential_fingerprint: string | null;
  source_origin: EvidenceOrigin;
  reason: string | null;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

let accessOverride: V5ComtradeAccess | null = null;

/** Test seam: a fake fetch behind an "authenticated" identity, without a real key. */
export function setV5ComtradeAccessForTesting(access: V5ComtradeAccess | null) {
  accessOverride = access;
}

export function v5ComtradeAccess(policy: ComtradePolicy): V5ComtradeAccess {
  if (accessOverride) return accessOverride;
  const unavailable = (reason: string): V5ComtradeAccess => ({ mode: 'unavailable', api_key: null, credential_fingerprint: null, source_origin: EvidenceOrigin.mock, reason });
  let identity;
  try {
    identity = getComtradeClient(policy).identity;
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : 'The Comtrade client is not configured.');
  }
  const key = process.env.COMTRADE_API_KEY;
  if (identity.mode !== 'authenticated' || !key) return unavailable('No authenticated Comtrade client is configured in this environment.');
  return { mode: 'authenticated', api_key: key, credential_fingerprint: identity.credential_fingerprint, source_origin: EvidenceOrigin.authenticated_real, reason: null };
}

export interface ComtradeStepResult {
  status: 'used' | 'unavailable' | 'failed';
  reason: string | null;
  rows: BatchedComtradeRow[];
  evidence_ids: string[];
  physical_calls: number;
  complete: boolean;
}

function completeness(page: BatchedComtradePage): EvidenceCompletenessStatus {
  return page.reached_cap || page.rejected_rows > 0 ? EvidenceCompletenessStatus.PARTIAL : EvidenceCompletenessStatus.COMPLETE;
}

export async function runBatchedComtradeQuery(args: {
  query: BatchedComtradeQuery;
  access: V5ComtradeAccess;
  comtrade_policy: ComtradePolicy;
  reporter_universe: readonly string[];
}): Promise<ComtradeStepResult> {
  const { access } = args;
  if (access.mode !== 'authenticated' || !access.credential_fingerprint) {
    return { status: 'unavailable', reason: access.reason ?? 'No authenticated Comtrade client.', rows: [], evidence_ids: [], physical_calls: 0, complete: false };
  }
  const limit = Math.max(1, args.comtrade_policy.daily_request_budget - (args.comtrade_policy.minimum_request_reserve ?? 0));
  try {
    const result = await fetchBatchedComtrade(args.query, {
      api_key: access.api_key,
      policy: args.comtrade_policy,
      reporter_universe: args.reporter_universe,
      fetch: access.fetch,
      sleep: access.sleep,
      before_physical_request: async () => {
        const reservation = await reserveProviderQuota({ provider: 'un_comtrade', credential_fingerprint: access.credential_fingerprint!, configured_limit: limit });
        if (!reservation.allowed) throw new Error(`The daily Comtrade budget (${limit} calls after the reserve) is spent.`);
      },
    });
    const environment = appEnvironment();
    const evidence = await prisma.$transaction(result.pages.map((page) => prisma.sourceEvidence.create({
      data: {
        provider: 'un_comtrade',
        dataset: 'goods-trade-batched',
        source_origin: access.source_origin,
        environment,
        request_fingerprint: createHash('sha256').update(page.url).digest('hex'),
        request_parameters: { ...args.query, periods: page.periods, reporters: page.reporters } as unknown as Prisma.InputJsonValue,
        redacted_request: page.url,
        http_status: page.http_status,
        response_checksum: page.response_sha256,
        raw_response_text: page.raw_response_text,
        retrieved_at: page.retrieved_at,
        provider_row_count: page.provider_count,
        returned_row_count: page.returned_rows,
        completeness: completeness(page),
        completeness_metadata: { accepted_rows: page.accepted_rows, rejected_rows: page.rejected_rows, reached_cap: page.reached_cap, split: page.reached_cap, parser_version: COMTRADE_BATCH_PARSER_VERSION } as Prisma.InputJsonValue,
        quota_metadata: page.quota as unknown as Prisma.InputJsonValue,
        parser_version: COMTRADE_BATCH_PARSER_VERSION,
        status: page.reached_cap ? 'split' : page.rejected_rows ? 'partial' : 'accepted',
      },
      select: { id: true },
    })));
    const last = result.pages[result.pages.length - 1];
    if (last) {
      await reconcileProviderQuota({ provider: 'un_comtrade', credential_fingerprint: access.credential_fingerprint, limit: last.quota.limit, remaining: last.quota.remaining, reset_at: last.quota.reset_at ? new Date(last.quota.reset_at) : null });
    }
    return { status: 'used', reason: result.complete ? null : 'Some rows did not answer the query and were set aside.', rows: result.rows, evidence_ids: evidence.map((row) => row.id), physical_calls: result.physical_calls, complete: result.complete };
  } catch (error) {
    const calls = typeof (error as { physicalRequestCount?: unknown }).physicalRequestCount === 'number' ? (error as { physicalRequestCount: number }).physicalRequestCount : 0;
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error), rows: [], evidence_ids: [], physical_calls: calls, complete: false };
  }
}
