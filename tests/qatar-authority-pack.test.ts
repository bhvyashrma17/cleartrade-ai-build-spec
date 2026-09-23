import { describe, expect, test } from 'vitest';
import { DESTINATION_ADAPTERS } from '../src/lib/job-handlers/market-access';
import { unconfiguredSourceForCountry } from '../src/lib/market-access/unconfigured-sources';
import { qatarOfficialUrl } from '../src/lib/market-access/providers/qatar-acquisition';
import {
  parseQatarDecree63Tables,
  parseQatarDuty,
  readQatarAuthorityBundle,
  QATAR_BUNDLE_READER_VERSION,
  QATAR_PARSER_VERSION,
  type QatarAuthorityBundle,
  type QatarOverlayOperation,
  type QatarPdfPage,
  type QatarTariffLine,
} from '../src/lib/market-access/providers/qatar-bundle';
import { buildQatarMarketAccess, replayQatarTariff } from '../src/lib/market-access/providers/qatar-parser';
import {
  QATAR_ACTIVE_TRADE_REMEDY_MANIFEST,
  selectQatarTradeRemedies,
} from '../src/lib/market-access/providers/qatar-remedies';

const adValorem = (rate: number) => parseQatarDuty(`${rate}%`);

/**
 * A synthetic three-table Decree 63/2025 fixture pinned to the real, verified operation counts
 * (32 modifications, 21 additions, 4 deletions), laid out with the real PDF's x/y columns so the
 * parser's exact-count gate is exercised the same way it is against the live document.
 */
function synthetic63Pages(): QatarPdfPage[] {
  const table1Items: QatarPdfPage['items'][number][] = [];
  for (let index = 0; index < 32; index += 1) {
    const y = 700 - index * 20, isProhibited = index === 1;
    table1Items.push(
      { str: `99 99 ${String(index + 1).padStart(2, '0')} 00 00 00`, x: 186, y },
      { str: `Modified item ${index}`, x: 293, y },
      { str: isProhibited ? 'PROHIBITED' : '7%', x: 402, y },
    );
  }
  const table1: QatarPdfPage = { page_number: 1, width: 600, height: 800, items: table1Items };

  const table2Items: QatarPdfPage['items'][number][] = [{ str: 'Table No', x: 265, y: 759 }, { str: '.', x: 310, y: 759 }, { str: '(2)', x: 316, y: 759 }];
  for (let index = 0; index < 21; index += 1) {
    const y = 700 - index * 20;
    table2Items.push(
      { str: `98 98 ${String(index + 1).padStart(2, '0')} 00 00 00`, x: 78, y },
      { str: `Added item ${index}`, x: 222, y },
      { str: '5%', x: 365, y },
    );
  }
  const table2: QatarPdfPage = { page_number: 2, width: 600, height: 800, items: table2Items };

  const table3Items: QatarPdfPage['items'][number][] = [{ str: 'Table No', x: 265, y: 759 }, { str: '.', x: 310, y: 759 }, { str: '(3)', x: 316, y: 759 }];
  for (let index = 0; index < 4; index += 1) {
    const y = 700 - index * 20;
    table3Items.push(
      { str: `97 97 ${String(index + 1).padStart(2, '0')} 00 00 00`, x: 78, y },
      { str: `Deleted item ${index}`, x: 222, y },
      { str: '5%', x: 365, y },
    );
  }
  const table3: QatarPdfPage = { page_number: 3, width: 600, height: 800, items: table3Items };

  return [table1, table2, table3];
}

function line(code: string, rate = 5): QatarTariffLine {
  return { code, description: `line ${code}`, declarable: true, duty: adValorem(rate), source: 'Qatar Customs Integrated Customs Tariff schedule', source_pages: [1], effective_from: '2025-01-01', effective_to: null };
}

function bundle(overrides: Partial<QatarAuthorityBundle> = {}): QatarAuthorityBundle {
  const scheduleLines = [line('120110000000', 0), line('850710000000', 5), line('853650000000', 5)];
  return {
    checksum: 'fixture-sha256', size_bytes: 1, release_identifier: '2026-09-23',
    source_url: 'https://www.customs.gov.qa/Arabic/Tariff/Pages/default.aspx', files: [],
    schedule_lines: new Map(scheduleLines.map((item) => [item.code, item])),
    operations_2025: [], decree_31_2026: { instrument: 'Decree No. (31) of 2026', effective_from: '2026-01-01', tables_machine_available: false, note: 'fixture' },
    remedies: QATAR_ACTIVE_TRADE_REMEDY_MANIFEST, reader_version: QATAR_BUNDLE_READER_VERSION, parser_version: QATAR_PARSER_VERSION,
    ...overrides,
  };
}

function operation(operationKind: QatarOverlayOperation['operation'], code: string, duty = 5): QatarOverlayOperation {
  return { instrument: 'Decree No. (63) of 2025', effective_from: '2025-06-01', operation: operationKind, code, description: `operation ${code}`, declarable: operationKind !== 'DELETE_CODE', duty: operationKind === 'DELETE_CODE' ? null : adValorem(duty), source_page: 1 };
}

describe('Qatar authority pack', () => {
  test('parses ordinary ad-valorem, explicit zero, import-prohibited and special-goods semantics without inventing rates', () => {
    expect(parseQatarDuty('')).toMatchObject({ kind: 'none', ad_valorem_rate_percent: null });
    expect(parseQatarDuty('0%')).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0 });
    expect(parseQatarDuty('5%')).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 5 });
    expect(parseQatarDuty('PROHIBITED')).toMatchObject({ kind: 'unparsed', ad_valorem_rate_percent: null, expression: 'PROHIBITED' });
    expect(parseQatarDuty('Import prohibited')).toMatchObject({ kind: 'unparsed', expression: 'PROHIBITED' });
    expect(parseQatarDuty('Special Goods')).toMatchObject({ kind: 'unparsed', ad_valorem_rate_percent: null });
  });

  test('parses the three real Decree 63/2025 table layouts by their distinct x/y columns', () => {
    const ops = parseQatarDecree63Tables(synthetic63Pages());
    expect(ops.filter((o) => o.operation === 'RATE_REPLACE')).toHaveLength(32);
    expect(ops.filter((o) => o.operation === 'ADD_CODE')).toHaveLength(21);
    expect(ops.filter((o) => o.operation === 'DELETE_CODE')).toHaveLength(4);
    const prohibited = ops.find((o) => o.code === '999902000000');
    expect(prohibited?.duty).toMatchObject({ kind: 'unparsed', expression: 'PROHIBITED' });
    expect(prohibited?.declarable).toBe(false);
  });

  test('rejects a non-official host and refuses a decree with the wrong table count', () => {
    expect(() => qatarOfficialUrl('https://example.com/not-official')).toThrow(/rejects example\.com/);
    expect(() => parseQatarDecree63Tables([synthetic63Pages()[0]!])).toThrow(/Table \(3\)/);
  });

  test('replays the Decree 98 baseline by reversing Decree 63/2025’s known operations, and never invents a pre-amendment rate', () => {
    // '999999999999' represents a code Decree 63/2025 added: it is present in the CURRENT schedule
    // (the authoritative source from 2025-06-01 onward) but must be absent before that date.
    const added = operation('ADD_CODE', '999999999999', 9);
    const deleted = operation('DELETE_CODE', '850710000000');
    const rateReplaced = operation('RATE_REPLACE', '853650000000', 11);
    const fixture = bundle({
      schedule_lines: new Map([...bundle().schedule_lines, ['999999999999', line('999999999999', 9)]]),
      operations_2025: [added, deleted, rateReplaced],
    });

    const base = replayQatarTariff(fixture, new Date('2025-03-01T00:00:00Z'));
    expect(base.has('999999999999')).toBe(false);
    expect(base.get('850710000000')).toMatchObject({ declarable: false, duty: { kind: 'none' } });
    expect(base.get('853650000000')?.duty).toMatchObject({ kind: 'none', ad_valorem_rate_percent: null });

    const current = replayQatarTariff(fixture, new Date('2026-09-23T00:00:00Z'));
    expect(current.get('999999999999')?.duty.ad_valorem_rate_percent).toBe(9);
    expect(current.get('850710000000')?.duty.ad_valorem_rate_percent).toBe(5);
    expect(current.get('853650000000')?.duty.ad_valorem_rate_percent).toBe(5);
  });

  test('keeps India preference not applicable and fails closed on both rate-confirmed and scope-only anti-dumping remedies', () => {
    const confirmed = buildQatarMarketAccess({ bundle: bundle(), release_id: 'release-qa', release_reference_date: new Date('2026-09-23T00:00:00Z'), retrieved_at: new Date('2026-09-23T01:00:00Z'), hs6: '853650', at: new Date('2026-09-23T00:00:00Z'), origin_country: 'CN' });
    expect(confirmed.india_preference.applicability).toBe('not_applicable');
    expect(confirmed.lines.some((item) => item.measure_kind === 'additional_duty' && item.duty.ad_valorem_rate_percent === null)).toBe(true);
    expect(confirmed.requirements).toEqual([expect.objectContaining({ requirement_code: 'QA_ANTIDUMPING_IDENTITY_EVIDENCE' })]);

    const scopeOnly = buildQatarMarketAccess({ bundle: bundle(), release_id: 'release-qa', release_reference_date: new Date('2026-09-23T00:00:00Z'), retrieved_at: new Date('2026-09-23T01:00:00Z'), hs6: '850710', at: new Date('2026-09-23T00:00:00Z'), origin_country: 'IN' });
    const additional = scopeOnly.lines.find((item) => item.measure_kind === 'additional_duty');
    expect(additional?.duty.ad_valorem_rate_percent).toBeNull();
    expect(additional?.duty.expression).not.toBe('');
  });

  test('remedy manifest is bounded, non-invented, complete and applies product/origin/exclusion gates', () => {
    expect(QATAR_ACTIVE_TRADE_REMEDY_MANIFEST.measures).toHaveLength(4);
    expect(QATAR_ACTIVE_TRADE_REMEDY_MANIFEST.register_enumeration_complete).toBe(true);
    expect(QATAR_ACTIVE_TRADE_REMEDY_MANIFEST.historical_measures).toHaveLength(1);
    expect(selectQatarTradeRemedies({ manifest: QATAR_ACTIVE_TRADE_REMEDY_MANIFEST, code: '853650000000', origin_country: 'CN', at: new Date('2026-09-23') }).status).toBe('producer_refinement_required');
    expect(selectQatarTradeRemedies({ manifest: QATAR_ACTIVE_TRADE_REMEDY_MANIFEST, code: '850710000000', origin_country: 'KR', at: new Date('2026-09-23') }).status).toBe('producer_refinement_required');
    expect(selectQatarTradeRemedies({ manifest: QATAR_ACTIVE_TRADE_REMEDY_MANIFEST, code: '850710000000', origin_country: 'FR', at: new Date('2026-09-23') }).status).toBe('not_applicable');

    // Decision 22/2024 (India batteries): named producers plus the legally specified all-other rate.
    const indiaBatteries = selectQatarTradeRemedies({ manifest: QATAR_ACTIVE_TRADE_REMEDY_MANIFEST, code: '850710000000', origin_country: 'IN', at: new Date('2026-09-23') });
    expect(indiaBatteries.status).toBe('producer_refinement_required');
    if (indiaBatteries.status === 'producer_refinement_required') {
      const india = indiaBatteries.candidates.find((m) => m.id === 'qa-batteries-in')!;
      expect(india.producers.map((p) => p.rate_percent).sort((a, b) => a - b)).toEqual([8, 22.4, 28.5]);
      expect(india.other_producers_rate_percent).toBe(41);
      expect(india.excluded_battery_types).toEqual(['AGM', 'EFB']);
    }

    // Decision 21/2024 (Korea batteries): all four named producers plus the all-other rate.
    const koreaBatteries = selectQatarTradeRemedies({ manifest: QATAR_ACTIVE_TRADE_REMEDY_MANIFEST, code: '850710000000', origin_country: 'KR', at: new Date('2026-09-23') });
    if (koreaBatteries.status === 'producer_refinement_required') {
      const korea = koreaBatteries.candidates.find((m) => m.id === 'qa-batteries-kr')!;
      expect(korea.producers).toEqual(expect.arrayContaining([
        { name: 'HANKOOK & COMPANY CO., LTD', rate_percent: 21 },
        { name: 'DN AUTOMOTIVE CORPORATION', rate_percent: 25 },
      ]));
      expect(korea.other_producers_rate_percent).toBe(25);
    }

    // Decision 107/2024 (ceramic tiles) expired 2025-06-05: it must never surface as an active
    // measure on the 2026-09-23 qualification date, but is retained as historical evidence.
    expect(QATAR_ACTIVE_TRADE_REMEDY_MANIFEST.measures.some((m) => m.id.includes('ceramic'))).toBe(false);
    expect(selectQatarTradeRemedies({ manifest: QATAR_ACTIVE_TRADE_REMEDY_MANIFEST, code: '690710000000', origin_country: 'CN', at: new Date('2026-09-23') }).status).toBe('not_applicable');
    const historicalCeramic = QATAR_ACTIVE_TRADE_REMEDY_MANIFEST.historical_measures.find((m) => m.id.includes('ceramic'))!;
    expect(historicalCeramic.status).toBe('EXPIRED');
    expect(historicalCeramic.effective_until).toBe('2025-06-05');
  });

  test('is deterministic, corruption-intolerant and registered as an active adapter', async () => {
    const args = { bundle: bundle(), release_id: 'release-qa', release_reference_date: new Date('2026-09-23T00:00:00Z'), retrieved_at: new Date('2026-09-23T01:00:00Z'), hs6: '120110', at: new Date('2026-09-23T00:00:00Z'), origin_country: 'IN' };
    expect(buildQatarMarketAccess(args)).toEqual(buildQatarMarketAccess(args));
    await expect(readQatarAuthorityBundle({ bytes: Buffer.from('not a zip'), release_identifier: '2026-09-23' })).rejects.toMatchObject({ code: 'corrupt_archive' });
    expect(unconfiguredSourceForCountry('QA')).toBeNull();
    expect(DESTINATION_ADAPTERS.QA?.provider_key).toBe('qa_customs_integrated_tariff');
  });
});
