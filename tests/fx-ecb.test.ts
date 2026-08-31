import { describe, expect, test } from 'vitest';
import { deriveFxRate, ecbSeriesKey, parseEcbCsv, type FxObservationRow } from '../src/lib/fx/ecb';

const HEADER = 'KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,OBS_STATUS,TITLE';
const row = (currency: string, date: string, value: string, status = 'A') =>
  `EXR.D.${currency}.EUR.SP00.A,D,${currency},EUR,SP00,A,${date},${value},${status},"ECB reference exchange rate, ${currency}/Euro, 2.15 pm (C.E.T.)"`;

const observation = (over: { quote_currency: string; rate: string; observation_date: string; retrieved_at?: Date }): FxObservationRow => ({
  id: `obs-${over.quote_currency}-${over.observation_date}`,
  provider: 'ecb_sdmx',
  series_key: ecbSeriesKey(over.quote_currency),
  base_currency: 'EUR',
  quote_currency: over.quote_currency,
  rate: over.rate,
  retrieved_at: over.retrieved_at ?? new Date('2026-08-31T06:00:00.000Z'),
  observation_date: new Date(`${over.observation_date}T00:00:00.000Z`),
});

describe('ECB SDMX parsing', () => {
  test('reads the observation date and value from published CSV', () => {
    const parsed = parseEcbCsv([HEADER, row('INR', '2026-08-26', '111.3475'), row('INR', '2026-08-28', '111.0585')].join('\n'));
    expect(parsed).toHaveLength(2);
    expect(parsed[1]).toMatchObject({ base_currency: 'EUR', quote_currency: 'INR', rate: '111.0585', observation_date: '2026-08-28' });
    // Ascending by date, so the newest is always last regardless of the response order.
    expect(parsed.map((entry) => entry.observation_date)).toEqual(['2026-08-26', '2026-08-28']);
  });

  test('a dated row with no value is not a rate', () => {
    const parsed = parseEcbCsv([HEADER, row('INR', '2026-08-27', ''), row('INR', '2026-08-28', '111.0585')].join('\n'));
    expect(parsed.map((entry) => entry.observation_date)).toEqual(['2026-08-28']);
  });

  test('the series key names the currency against the euro', () => {
    expect(ecbSeriesKey('inr')).toBe('D.INR.EUR.SP00.A');
    expect(ecbSeriesKey('USD')).toBe('D.USD.EUR.SP00.A');
  });
});

describe('FX derivation', () => {
  const day = '2026-08-28';
  const observations = [
    observation({ quote_currency: 'INR', rate: '111.0585', observation_date: day }),
    observation({ quote_currency: 'USD', rate: '1.1650', observation_date: day }),
    observation({ quote_currency: 'GBP', rate: '0.8600', observation_date: day }),
  ];

  test('EUR to a published currency is used directly, not derived', () => {
    const result = deriveFxRate({ base_currency: 'EUR', quote_currency: 'INR', as_of_date: day, max_lookback_days: 7, observations });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.rate.rate).toBeCloseTo(111.0585, 6);
    expect(result.rate.derivation).toBe('published');
    expect(result.rate.sources).toHaveLength(1);
    expect(result.rate.observation_date).toBe(day);
  });

  test('a cross rate divides in the right direction and keeps both legs', () => {
    const result = deriveFxRate({ base_currency: 'USD', quote_currency: 'INR', as_of_date: day, max_lookback_days: 7, observations });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    // INR per USD = (INR per EUR) / (USD per EUR) = 111.0585 / 1.1650 ≈ 95.33
    expect(result.rate.rate).toBeCloseTo(111.0585 / 1.165, 8);
    expect(result.rate.rate).toBeGreaterThan(1);
    expect(result.rate.derivation).toBe('cross_via_eur');
    expect(result.rate.sources.map((source) => source.role)).toEqual(['numerator', 'denominator']);
    expect(result.rate.sources.map((source) => source.quote_currency)).toEqual(['INR', 'USD']);

    // The inverse must be the reciprocal, not the same number with the labels swapped.
    const inverse = deriveFxRate({ base_currency: 'INR', quote_currency: 'USD', as_of_date: day, max_lookback_days: 7, observations });
    if (inverse.status !== 'available') throw new Error('expected an inverse rate');
    expect(inverse.rate.rate).toBeCloseTo(1 / result.rate.rate, 10);
    expect(inverse.rate.rate).toBeLessThan(1);
  });

  test('GBP to INR crosses through the euro with both legs on the same day', () => {
    const result = deriveFxRate({ base_currency: 'GBP', quote_currency: 'INR', as_of_date: day, max_lookback_days: 7, observations });
    if (result.status !== 'available') throw new Error('expected a rate');
    expect(result.rate.rate).toBeCloseTo(111.0585 / 0.86, 8);
    expect(new Set(result.rate.sources.map((source) => source.observation_date))).toEqual(new Set([day]));
  });

  test('never uses an observation dated after the assessment clock', () => {
    const withFuture = [...observations, observation({ quote_currency: 'INR', rate: '999', observation_date: '2026-09-01' })];
    const result = deriveFxRate({ base_currency: 'EUR', quote_currency: 'INR', as_of_date: day, max_lookback_days: 7, observations: withFuture });
    if (result.status !== 'available') throw new Error('expected a rate');
    expect(result.rate.rate).toBeCloseTo(111.0585, 6);
    expect(result.rate.observation_date).toBe(day);
  });

  test('walks back to the latest published day, within the configured horizon', () => {
    const friday = '2026-08-28';
    const older = [observation({ quote_currency: 'INR', rate: '110.5', observation_date: friday }), observation({ quote_currency: 'USD', rate: '1.16', observation_date: friday })];
    // Sunday: the ECB publishes nothing, so Friday's observation is the latest valid one.
    const result = deriveFxRate({ base_currency: 'USD', quote_currency: 'INR', as_of_date: '2026-08-30', max_lookback_days: 7, observations: older });
    if (result.status !== 'available') throw new Error('expected a rate');
    expect(result.rate.observation_date).toBe(friday);

    const tooOld = deriveFxRate({ base_currency: 'USD', quote_currency: 'INR', as_of_date: '2026-09-30', max_lookback_days: 7, observations: older });
    expect(tooOld.status).toBe('unavailable');
  });

  test('refuses to mix observation dates across the two legs', () => {
    const mixed = [
      observation({ quote_currency: 'INR', rate: '111.0585', observation_date: '2026-08-28' }),
      observation({ quote_currency: 'USD', rate: '1.1650', observation_date: '2026-08-26' }),
    ];
    // 28 August has an INR leg but no USD leg; 26 August has USD but no INR. Neither day is
    // complete, so no rate is produced rather than one blended across two days.
    const result = deriveFxRate({ base_currency: 'USD', quote_currency: 'INR', as_of_date: '2026-08-28', max_lookback_days: 7, observations: mixed });
    expect(result.status).toBe('unavailable');
    if (result.status !== 'unavailable') return;
    expect(result.reason).toMatch(/No single published day/);
  });

  test('an unpublished currency stays unavailable rather than being inferred from a peg', () => {
    // The ECB publishes no SAR series. A USD peg is a monetary-policy fact, not an ECB
    // observation, so SAR/INR has no derivable rate here.
    const result = deriveFxRate({ base_currency: 'SAR', quote_currency: 'INR', as_of_date: day, max_lookback_days: 7, observations });
    expect(result.status).toBe('unavailable');
  });

  test('rejects a same-currency pair and an empty observation set', () => {
    expect(deriveFxRate({ base_currency: 'INR', quote_currency: 'INR', as_of_date: day, max_lookback_days: 7, observations }).status).toBe('unavailable');
    expect(deriveFxRate({ base_currency: 'EUR', quote_currency: 'INR', as_of_date: day, max_lookback_days: 7, observations: [] }).status).toBe('unavailable');
  });
});
