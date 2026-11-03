import { randomUUID } from 'node:crypto';
import { TradeSourceMode } from '@prisma/client';
import { getComtradeClient } from '@/lib/comtrade';
import { getConfig } from '@/lib/config';
import { prisma } from '@/lib/prisma';

export interface QuotaReservation {
  allowed: boolean;
  window_start: Date;
  window_end: Date;
  requests_reserved: number;
  configured_limit: number;
}

/** UTC calendar-day window. Kept explicit so provider-specific windows can replace it later. */
export function providerDailyWindow(at = new Date()) {
  const window_start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const window_end = new Date(window_start.getTime() + 86_400_000);
  return { window_start, window_end };
}

/**
 * Atomically reserve provider requests in PostgreSQL. `updateMany` carries the limit predicate
 * into the write itself, so concurrent workers cannot both spend the final slot.
 */
export async function reserveProviderQuota(input: {
  provider: string;
  credential_fingerprint: string;
  configured_limit: number;
  request_count?: number;
  at?: Date;
}): Promise<QuotaReservation> {
  const requestCount = input.request_count ?? 1;
  if (!Number.isInteger(requestCount) || requestCount <= 0) throw new Error('Quota reservation must be a positive integer.');
  if (!Number.isInteger(input.configured_limit) || input.configured_limit <= 0) throw new Error('Provider quota limit must be a positive integer.');
  const { window_start, window_end } = providerDailyWindow(input.at);

  await prisma.providerQuotaWindow.createMany({data:[{id:randomUUID(),provider:input.provider,credential_fingerprint:input.credential_fingerprint,window_start,window_end,configured_limit:input.configured_limit}],skipDuplicates:true});
  const reserved=await prisma.providerQuotaWindow.updateMany({
    where:{provider:input.provider,credential_fingerprint:input.credential_fingerprint,window_start,requests_reserved:{lte:input.configured_limit-requestCount}},
    data:{requests_reserved:{increment:requestCount},configured_limit:input.configured_limit,window_end},
  });
  const current=await prisma.providerQuotaWindow.findUniqueOrThrow({where:{provider_credential_fingerprint_window_start:{provider:input.provider,credential_fingerprint:input.credential_fingerprint,window_start}}});
  return {allowed:reserved.count===1,window_start,window_end,requests_reserved:current.requests_reserved,configured_limit:current.configured_limit};
}

/** Store provider headers without treating them as authority over already-reserved requests. */
export async function reconcileProviderQuota(input: {
  provider: string;
  credential_fingerprint: string;
  at?: Date;
  limit?: number | null;
  remaining?: number | null;
  reset_at?: Date | null;
}) {
  const { window_start } = providerDailyWindow(input.at);
  return prisma.providerQuotaWindow.updateMany({
    where: { provider: input.provider, credential_fingerprint: input.credential_fingerprint, window_start },
    data: {
      provider_reported_limit: input.limit ?? undefined,
      provider_reported_remaining: input.remaining ?? undefined,
      provider_reported_reset_at: input.reset_at ?? undefined,
    },
  });
}

/**
 * How many further physical provider requests this credential may still make today.
 *
 * The single answer to "can this plan run?", shared by deep Country Evidence acquisition and
 * Stage A global screening so neither invents its own accounting. It reads the same ledger the
 * reservation path writes, takes the stricter of the local budget and whatever the provider's
 * own headers last reported, and fails closed: a source mode the current client cannot serve
 * has an allowance of zero rather than an optimistic guess.
 */
export async function availableProviderRequestAllowance(sourceMode: TradeSourceMode): Promise<number> {
  if (sourceMode === TradeSourceMode.fixture || sourceMode === TradeSourceMode.mock) return Number.MAX_SAFE_INTEGER;
  const comtrade = await getConfig('comtrade.policy'), identity = getComtradeClient(comtrade).identity;
  if (sourceMode !== TradeSourceMode.authenticated || identity.mode !== 'authenticated') return 0;
  const { window_start } = providerDailyWindow();
  const row = await prisma.providerQuotaWindow.findUnique({ where: { provider_credential_fingerprint_window_start: { provider: identity.provider, credential_fingerprint: identity.credential_fingerprint, window_start } } });
  const local = (comtrade.daily_request_budget ?? 450) - (row?.requests_reserved ?? 0);
  const provider = row?.provider_reported_remaining ?? Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.min(local, provider));
}
