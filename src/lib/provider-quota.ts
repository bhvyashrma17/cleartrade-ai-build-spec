import { randomUUID } from 'node:crypto';
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
