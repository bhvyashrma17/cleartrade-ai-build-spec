import { describe, expect, test } from 'vitest';
import { TARIFF_SCHEDULE_SOURCES, UAE_CEPA_ANNEX_2B_URL } from '@/lib/market-access/providers/tariff-schedule-sources';

/**
 * R-50 (11 Nov 2026): the UAE's CEPA schedule was recorded from the Council for Leather Exports'
 * website. India's Department of Commerce publishes the same file (byte for byte), so the release
 * now names the Department's copy, and every schedule file is fetched from a government website.
 */
describe('where the tariff-schedule files come from', () => {
  test('every file of every release is fetched from a government website', () => {
    const hosts = Object.values(TARIFF_SCHEDULE_SOURCES).flatMap((source) =>
      [source.release.source_url, ...source.release.files.map((file) => file.url)].map((url) => new URL(url).hostname));
    expect(hosts.filter((host) => !/(^|\.)gov\.[a-z]{2}$/.test(host))).toEqual([]);
  });

  test("the UAE's CEPA schedule is the Department of Commerce's Annex 2B, pinned as before so the active release stays readable", () => {
    const gcc = TARIFF_SCHEDULE_SOURCES.GCC.release;
    expect(new URL(UAE_CEPA_ANNEX_2B_URL).hostname).toBe('www.commerce.gov.in');
    expect(gcc.identifier).toBe('gcc-ict-dubai-2025-07-23-uae-cepa-annex2b');
    expect(gcc.files.find((file) => file.role === 'official_preference_schedule')).toEqual({
      name: 'Schedule-of-UAE.pdf', role: 'official_preference_schedule', url: UAE_CEPA_ANNEX_2B_URL,
      sha256: 'b9cd37fdca216f5aa6864815b2fdd6a8193c19f85eb95c7dcd557dfbbb5cd475', size_bytes: 1_445_387,
    });
    expect(gcc.provenance).not.toMatch(/no longer resolves/);
  });
});
