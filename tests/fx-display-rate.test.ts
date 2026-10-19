import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { EvidenceCompletenessStatus, EvidenceOrigin, Prisma } from '@prisma/client';
import { expectedNewestEcbDay, resetDisplayRateForTesting, todayInrPerUsd } from '../src/lib/fx/display-rate';
import { ecbSeriesKey } from '../src/lib/fx/ecb';
import { prisma } from '../src/lib/prisma';

/** D-023: today's rupee rate for display. Each test uses its own dates; rates are invented. */
async function store(currency: string, day: string, rate: string) {
  const snapshot = await prisma.authoritativeFxSnapshot.create({
    data: {
      provider: 'ecb_sdmx', source_authority: 'European Central Bank', source_dataset: 'EXR', series_key: ecbSeriesKey(currency), request_reference: `test-${randomUUID()}`,
      requested_at: new Date(), retrieved_at: new Date(), http_status: 200, raw_response_checksum: randomUUID(), raw_response_text: 'fixture', parser_version: 'ecb-sdmx-exr-v1',
      normalization_version: 'ecb-fx-normalization-v1', environment: 'test', evidence_origin: EvidenceOrigin.fixture, completeness: EvidenceCompletenessStatus.COMPLETE, status: 'accepted',
    },
  });
  await prisma.authoritativeFxObservation.create({
    data: {
      snapshot_id: snapshot.id, provider: 'ecb_sdmx', series_key: ecbSeriesKey(currency), base_currency: 'EUR', quote_currency: currency, rate: new Prisma.Decimal(rate),
      observation_date: new Date(`${day}T00:00:00Z`), observation_status: 'A', normalization_version: 'ecb-fx-normalization-v1', parser_version: 'ecb-sdmx-exr-v1',
      environment: 'test', evidence_origin: EvidenceOrigin.fixture, retrieved_at: new Date(),
    },
  });
}

beforeEach(() => resetDisplayRateForTesting());

describe("today's rupee rate", () => {
  test('the newest day the ECB could have published: the previous weekday before 15:00 UTC', () => {
    expect(expectedNewestEcbDay(new Date('2040-03-07T16:00:00Z'))).toBe('2040-03-07'); // Wednesday afternoon
    expect(expectedNewestEcbDay(new Date('2040-03-07T09:00:00Z'))).toBe('2040-03-06'); // Wednesday morning
    expect(expectedNewestEcbDay(new Date('2040-03-05T09:00:00Z'))).toBe('2040-03-02'); // Monday morning: Friday
    expect(expectedNewestEcbDay(new Date('2040-03-04T18:00:00Z'))).toBe('2040-03-02'); // Sunday: Friday
  });

  test('a current stored rate is used without fetching; INR per USD is the cross of the two ECB series', async () => {
    await store('INR', '2041-05-08', '96.8');
    await store('USD', '2041-05-08', '1.10');
    const ingest = vi.fn();
    const rate = await todayInrPerUsd(new Date('2041-05-08T16:00:00Z'), { ingest });
    expect(rate).toEqual({ inr_per_usd: expect.closeTo(88, 10), observation_date: '2041-05-08', source: 'ECB' });
    expect(ingest).not.toHaveBeenCalled();
  });

  test('a stale or missing rate is fetched once, then served from cache; a failed fetch shows no rate rather than an error', async () => {
    const ingest = vi.fn(async (currency: string, _window: { start_date: string; end_date: string }) => {
      await store(currency, '2042-07-10', currency === 'INR' ? '90.0' : '1.125');
      return { status: 'available' } as never;
    });
    const now = new Date('2042-07-10T16:30:00Z');
    expect(await todayInrPerUsd(now, { ingest })).toEqual({ inr_per_usd: expect.closeTo(80, 10), observation_date: '2042-07-10', source: 'ECB' });
    expect(ingest.mock.calls.map((call) => call[0]).sort()).toEqual(['INR', 'USD']);
    expect(ingest.mock.calls[0]![1]).toEqual({ start_date: '2042-07-03', end_date: '2042-07-10' });
    await todayInrPerUsd(new Date('2042-07-10T16:35:00Z'), { ingest });
    expect(ingest).toHaveBeenCalledTimes(2);

    resetDisplayRateForTesting();
    const failing = vi.fn(async () => { throw new Error('ECB unreachable'); });
    expect(await todayInrPerUsd(new Date('2043-01-14T16:30:00Z'), { ingest: failing })).toBeNull();
  });
});
