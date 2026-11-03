import { randomUUID } from 'node:crypto';
import { describe, expect, test, vi } from 'vitest';
import { EvidenceOrigin, OrgTier, UserRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { importReferenceDataset } from '@/lib/reference-datasets/service';

/** E-043: the finder endpoint needs no session, reads only the imported code list, and writes nothing. */
vi.mock('../src/lib/auth', () => ({ getPrincipal: vi.fn(async () => null) }));
const { POST } = await import('../src/app/api/v1/hs-finder/route');

const ask = async (body: unknown) => {
  const response = await POST(new Request('http://test/api/v1/hs-finder', { method: 'POST', body: JSON.stringify(body) }) as never);
  return { status: response.status, body: await response.json() };
};

describe('POST /api/v1/hs-finder', () => {
  test('before the list is imported it says so; afterwards it finds codes for a visitor without a session', async () => {
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
    expect((await ask({})).status).toBe(422);
    expect((await ask({ description: 'x'.repeat(301) })).status).toBe(422);
    expect((await ask({ description: 'rice', hs6: '100630' })).status).toBe(422);
  });
});
