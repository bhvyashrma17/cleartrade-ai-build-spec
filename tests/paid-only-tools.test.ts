import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { describe, expect, test, vi } from 'vitest';
import { OrgTier } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { minTierFor, type Capability } from '@/lib/permissions';

/**
 * Owner decision, 9 Nov 2026 (docs/14 §3c, ledger E-052): every tool runs for paid members only.
 * Visitors and free accounts see a static sample, and nothing runs or is read on their behalf.
 */

const auth = vi.hoisted(() => ({ caller: null as null | { id: string; email: string; name: string; role: 'exporter_owner'; exporter_org_id: string; tier: 'guest' | 'free' | 'paid' } }));
vi.mock('../src/lib/auth', async () => {
  const { unauthenticated } = await import('../src/lib/errors');
  return {
    getPrincipal: vi.fn(async () => auth.caller),
    requirePrincipal: vi.fn(async () => {
      if (!auth.caller) throw unauthenticated();
      return auth.caller;
    }),
  };
});
const estimate = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../src/lib/market-estimate', () => ({
  computeMarketEstimate: vi.fn(async () => {
    estimate.calls += 1;
    return { markets: [] };
  }),
}));
const { POST: postEstimate } = await import('../src/app/api/v1/market-estimates/route');

const member = (tier: 'guest' | 'free' | 'paid') => ({ id: randomUUID(), email: `t-${tier}@t.test`, name: 'T', role: 'exporter_owner' as const, exporter_org_id: randomUUID(), tier });

/** Below `paid` only what a person needs to become a member: account, team, company details, notices, paying. */
const OPEN_BELOW_PAID: Record<string, OrgTier> = {
  'exporter_profile.view': OrgTier.guest,
  'exporter_master_data.edit': OrgTier.free,
  'notification.manage': OrgTier.free,
  'team.manage': OrgTier.free,
  'commitment_fee.pay': OrgTier.free,
  'membership.manage': OrgTier.free,
};

function allCapabilities(): Capability[] {
  const source = readFileSync('src/lib/permissions.ts', 'utf8');
  // The union ends at the first member followed by `;` (its comments contain semicolons too).
  const start = source.indexOf('export type Capability =');
  const end = start + source.slice(start).search(/\|\s*'[a-z_]+\.[a-z_]+';/);
  const union = source.slice(start, source.indexOf(';', end) + 1);
  return [...union.matchAll(/^\s*\|\s*'([a-z_]+\.[a-z_]+)'/gm)].map((match) => match[1] as Capability);
}

describe('paid-only tools', () => {
  test('every capability is paid except the account and payment ones; a change here must be deliberate', () => {
    const capabilities = allCapabilities();
    expect(capabilities.length).toBeGreaterThan(30);
    const belowPaid = Object.fromEntries(capabilities.filter((c) => minTierFor(c) !== OrgTier.paid).map((c) => [c, minTierFor(c)]));
    expect(belowPaid).toEqual(OPEN_BELOW_PAID);
    for (const tool of ['market_estimate.run', 'demand_discovery.run', 'buyer_discovery.run', 'buyer_contact.view', 'readiness.run', 'buyer_lead.create', 'buyer_shortlist.create', 'task_evidence.upload'] as Capability[]) {
      expect(minTierFor(tool), tool).toBe(OrgTier.paid);
    }
  });

  test('the market estimate refuses a visitor (401) and a guest or free account (402) before computing, and mints nothing', async () => {
    const guestsBefore = await prisma.exporterOrg.count({ where: { tier: OrgTier.guest } });
    const ask = async () => {
      const response = await postEstimate(new Request('http://test/api/v1/market-estimates', { method: 'POST', body: JSON.stringify({ product_description: 'Basmati rice', hs_code: '100630' }) }) as never);
      return { status: response.status, body: await response.json() };
    };

    auth.caller = null;
    expect(await ask()).toMatchObject({ status: 401, body: { error: { code: 'UNAUTHENTICATED' } } });
    for (const tier of ['guest', 'free'] as const) {
      auth.caller = member(tier);
      expect(await ask(), tier).toMatchObject({ status: 402, body: { error: { code: 'UPGRADE_REQUIRED' } } });
    }
    expect(estimate.calls).toBe(0);
    expect(await prisma.exporterOrg.count({ where: { tier: OrgTier.guest } })).toBe(guestsBefore);

    auth.caller = member('paid');
    expect((await ask()).status).toBe(200);
    expect(estimate.calls).toBe(1);

    const route = readFileSync('src/app/api/v1/market-estimates/route.ts', 'utf8');
    expect(route).not.toMatch(/mintGuest|consumeGuestRunQuota|signIn\(/);
  });

  test('below paid, the markets and buyers pages return the notice and the sample before any database read', () => {
    for (const file of ['src/app/app/markets/page.tsx', 'src/app/app/buyers/page.tsx']) {
      const source = readFileSync(file, 'utf8');
      const gate = source.indexOf('if (tier !== OrgTier.paid) {');
      expect(gate, file).toBeGreaterThan(0);
      const gateEnd = source.indexOf('\n  }\n', gate);
      const branch = source.slice(gate, gateEnd);
      expect(branch, file).toMatch(/<UpgradeNotice/);
      expect(branch, file).toMatch(/Sample \/>/);
      expect(branch, file).not.toMatch(/prisma\.|getConfig\(|fetch\(/);
      expect(source.indexOf('prisma.'), file).toBeGreaterThan(gateEnd);
    }
    expect(existsSync('src/app/app/markets/MarketEstimate.tsx')).toBe(false);
    // E-055: buyer discovery is agent-curated (docs/11 §7) and the API refuses buyer search to
    // exporter roles, so members get the curated view, never a search screen.
    expect(existsSync('src/app/app/buyers/BuyersExplorer.tsx')).toBe(false);
    const buyersPage = readFileSync('src/app/app/buyers/page.tsx', 'utf8');
    expect(buyersPage).toContain('<AgentCuratedBuyers');
    expect(buyersPage).not.toMatch(/api\/v1\/buyers/);
    for (const file of ['src/app/app/buyers/[buyerId]/page.tsx', 'src/app/app/readiness/page.tsx', 'src/app/app/readiness/tasks/page.tsx']) {
      const source = readFileSync(file, 'utf8');
      expect(source.indexOf('upgradeTierFor('), file).toBeGreaterThan(0);
      expect(source.indexOf('upgradeTierFor('), file).toBeLessThan(source.indexOf('prisma.'));
    }
  });
});
