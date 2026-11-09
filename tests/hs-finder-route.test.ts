import { randomUUID } from 'node:crypto';
import { describe, expect, test, vi } from 'vitest';
import { EvidenceOrigin, OrgTier, UserRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { importReferenceDataset } from '@/lib/reference-datasets/service';

/**
 * E-043: the finder endpoint reads only the imported code list and writes nothing. Since E-052 (9 Nov
 * 2026) it runs for paid members only: no session is 401 and a free account is UPGRADE_REQUIRED, both
 * before the code list is read.
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
const { POST } = await import('../src/app/api/v1/hs-finder/route');
const member = (tier: 'guest' | 'free' | 'paid') => ({ id: randomUUID(), email: `m-${tier}@t.test`, name: 'Member', role: 'exporter_owner' as const, exporter_org_id: randomUUID(), tier });

const ask = async (body: unknown) => {
  const response = await POST(new Request('http://test/api/v1/hs-finder', { method: 'POST', body: JSON.stringify(body) }) as never);
  return { status: response.status, body: await response.json() };
};

describe('POST /api/v1/hs-finder', () => {
  test('only a paid member may use it: no session is 401, a guest or free account is UPGRADE_REQUIRED', async () => {
    auth.caller = null;
    const anonymous = await ask({ description: 'agarbatti' });
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe('UNAUTHENTICATED');
    for (const tier of ['guest', 'free'] as const) {
      auth.caller = member(tier);
      const refused = await ask({ description: 'agarbatti' });
      expect(refused.status, tier).toBe(402);
      expect(refused.body.error.code, tier).toBe('UPGRADE_REQUIRED');
    }
  });

  test('before the list is imported it says so; afterwards it finds codes for a paid member', async () => {
    auth.caller = member('paid');
    const before = await ask({ description: 'agarbatti' });
    if (before.body.data.available === false) expect(before.body.data.reason).toMatch(/not loaded/);

    const ops = await prisma.user.create({ data: { email: `hs-finder-${randomUUID().slice(0, 8)}@t.test`, name: 'Ops', role: UserRole.ops_supervisor }, select: { id: true, email: true, name: true } });
    const lines = ['code,description', '330741,"Agarbatti and other odoriferous preparations which operate by burning"', '091030,"Spices; turmeric (curcuma)"', ...Array.from({ length: 4_100 }, (_, i) => `${String(400000 + i)},"Filler product ${i} ${randomUUID().slice(0, 4)}"`)];
    await importReferenceDataset({
      actor: { id: ops.id, email: ops.email, name: ops.name ?? '', role: UserRole.ops_supervisor, exporter_org_id: null, tier: OrgTier.paid },
      dataset_key: 'cepii:product-codes:HS22', bytes: Buffer.from(lines.join('\n')), source_url: 'https://www.cepii.fr/DATA_DOWNLOAD/baci/data/BACI_HS22_V202601.zip',
      retrieved_at: new Date('2026-10-31T00:00:00Z'), correlation_id: randomUUID(), evidence_origin: EvidenceOrigin.fixture,
    });

    const found = await ask({ description: 'agarbatti for export' });
    expect(found.status).toBe(200);
    expect(found.body.data).toMatchObject({ available: true, source: expect.stringMatching(/^CEPII BACI product codes HS22/), question: null });
    expect(found.body.data.candidates[0]).toMatchObject({ hs6: '330741', description: 'Agarbatti and other odoriferous preparations which operate by burning' });
    expect((await ask({ description: 'haldi' })).body.data.candidates[0].hs6).toBe('091030');
  });

  test('a description that is missing, too long or carries unknown fields is refused', async () => {
    auth.caller = member('paid');
    expect((await ask({})).status).toBe(422);
    expect((await ask({ description: 'x'.repeat(301) })).status).toBe(422);
    expect((await ask({ description: 'rice', hs6: '100630' })).status).toBe(422);
  });
});
