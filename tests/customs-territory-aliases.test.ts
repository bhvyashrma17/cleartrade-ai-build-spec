import { describe, expect, test } from 'vitest';
import { EU_TARIC_ASSOCIATED_DESTINATIONS, EU_TARIC_MEMBER_DESTINATIONS, EU_TARIC_DESTINATIONS } from '@/lib/market-access/taric/service';
import { fetchUkMarketAccess, UK_TARIFF_DESTINATIONS } from '@/lib/market-access/uk-tariff';
import { fetchUsMarketAccess, US_HTS_DESTINATIONS } from '@/lib/market-access/us-hts';

describe('customs-territory authority scopes', () => {
  test('EU member scope remains 27 and associated destinations are additive', () => {
    expect(EU_TARIC_MEMBER_DESTINATIONS).toHaveLength(27);
    expect(EU_TARIC_ASSOCIATED_DESTINATIONS).toEqual(['AX', 'MC']);
    expect(EU_TARIC_DESTINATIONS).toHaveLength(29);
  });

  test('UK and US authority scope lists name only destinations proved by their customs instruments', () => {
    expect(UK_TARIFF_DESTINATIONS).toEqual(['GB', 'GG', 'IM', 'JE']);
    expect(US_HTS_DESTINATIONS).toEqual(['US', 'PR']);
  });

  test('authority fetchers reject a destination outside their legal scope before network access', async () => {
    await expect(fetchUkMarketAccess('090111', { destination_country: 'GI' })).rejects.toThrow(/outside the UK/);
    await expect(fetchUsMarketAccess('090111', { destination_country: 'GU' })).rejects.toThrow(/outside the customs territory/);
  });
});
