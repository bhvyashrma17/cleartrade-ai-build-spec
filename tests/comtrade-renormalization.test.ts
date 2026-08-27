/**
 * Re-normalization must RE-PARSE, not relabel.
 *
 * The failure this guards against is silent by construction: copying semantic fields forward
 * and stamping a new normalization version produces rows that satisfy every downstream version
 * assertion while carrying the previous parser's semantics. These tests assert the observable
 * consequence — a value that the OLD row got wrong is corrected by re-parsing, and evidence
 * that cannot be re-parsed is refused rather than relabelled.
 */
import { createHash, randomUUID } from 'node:crypto';
import { EvidenceOrigin, Prisma } from '@prisma/client';
import { afterAll, describe, expect, test } from 'vitest';
import { canonicalComtradeRequest, comtradeRequestFingerprint } from '../src/lib/comtrade/request';
import { COMTRADE_NORMALIZATION_VERSION, COMTRADE_PARSER_VERSION, ensureCurrentComtradeNormalization } from '../src/lib/comtrade/normalization';
import { parseComtradeResponseBody, parseOptionalProviderNumber } from '../src/lib/comtrade/parser';
import { prisma } from '../src/lib/prisma';

const HS6 = '100630', PERIOD = 2025;

function request(reporter: string) {
  return canonicalComtradeRequest({ provider: 'un_comtrade', dataset: 'goods-trade', source_mode: 'authenticated', purpose: 'country_truth', reporter_code: reporter, partner_code: '0', partner2_code: '0', flow_direction: 'import', frequency: 'A', period: String(PERIOD), hs_codes: [HS6], hs_revision: '2022', customs_code: 'C00', mode_of_supply: '0' });
}

/** Evidence whose stored v1 observation deliberately DISAGREES with its own raw response. */
async function seedDivergentEvidence(reporter: string, rawValue: unknown, staleStatus: string, staleValue: number | null) {
  const canonical = request(reporter);
  const raw = JSON.stringify({ count: 1, data: [{ reporterCode: Number(reporter), partnerCode: 0, partner2Code: 0, cmdCode: HS6, refYear: PERIOD, period: String(PERIOD), flowCode: 'M', freqCode: 'A', primaryValue: rawValue, customsCode: 'C00', mosCode: '0', clCode: 'H6' }] });
  return prisma.sourceEvidence.create({
    data: {
      provider: 'un_comtrade', dataset: 'un-comtrade-api', dataset_version: 'v1', source_origin: EvidenceOrigin.authenticated_real, environment: 'test',
      request_fingerprint: comtradeRequestFingerprint(canonical), request_parameters: canonical as unknown as Prisma.InputJsonValue,
      redacted_request: 'comtrade://renormalization', http_status: 200, response_checksum: createHash('sha256').update(raw).digest('hex'),
      raw_response_text: raw, retrieved_at: new Date(), provider_row_count: 1, returned_row_count: 1, completeness: 'COMPLETE',
      parser_version: COMTRADE_PARSER_VERSION, status: 'accepted',
      observations: { create: [{ observation_key: `stale-${randomUUID()}`, reporter_code: reporter, partner_code: '0', partner_is_world: true, partner2_code: '0', flow_direction: 'import', frequency: 'A', period: String(PERIOD), ref_year: PERIOD, hs_code: HS6, hs_level: 6, hs_revision: '2022', customs_code: 'C00', mode_of_supply: '0', trade_value: staleValue == null ? null : new Prisma.Decimal(staleValue), trade_value_status: staleStatus, quantity_status: 'missing', normalization_version: 'comtrade-normalization-v1', retrieved_at: new Date(), source_origin: EvidenceOrigin.authenticated_real }] },
    },
    include: { observations: true },
  });
}

afterAll(() => prisma.$disconnect());

describe('re-normalization re-derives semantics from the immutable raw response', () => {
  test('corrects a stale status the previous version got wrong instead of copying it', async () => {
    // The raw body says the provider suppressed this cell; the v1 row wrongly claims a zero.
    const evidence = await seedDivergentEvidence('999', 'suppressed', 'observed_zero', 0);
    const rows = await ensureCurrentComtradeNormalization(evidence);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ trade_value_status: 'suppressed', normalization_version: COMTRADE_NORMALIZATION_VERSION, suppression_flag: true });
    expect(rows[0]!.trade_value).toBeNull();
    // A copy would have produced observed_zero / 0 — the exact confusion Phase 1G must not inherit.
    const stale = await prisma.normalizedTradeObservation.findFirst({ where: { source_evidence_id: evidence.id, normalization_version: 'comtrade-normalization-v1' } });
    expect(stale).toMatchObject({ trade_value_status: 'observed_zero' });
    expect(stale!.trade_value?.toString()).toBe('0');
  });

  test('re-derives an observed value from raw rather than trusting the stored number', async () => {
    const evidence = await seedDivergentEvidence('998', 4242.5, 'observed', 1);
    const rows = await ensureCurrentComtradeNormalization(evidence);
    expect(rows[0]).toMatchObject({ trade_value_status: 'observed' });
    expect(Number(rows[0]!.trade_value)).toBe(4242.5);
  });

  test('refuses to relabel evidence it cannot re-parse', async () => {
    const canonical = request('997');
    const raw = JSON.stringify({ rows: [{ reporter: '997', partner: '0', value: 5 }] }); // synthetic, not a provider envelope
    const evidence = await prisma.sourceEvidence.create({
      data: { provider: 'un_comtrade', dataset: 'synthetic', source_origin: EvidenceOrigin.authenticated_real, environment: 'test', request_fingerprint: comtradeRequestFingerprint(canonical), request_parameters: canonical as unknown as Prisma.InputJsonValue, redacted_request: 'comtrade://synthetic', http_status: 200, response_checksum: createHash('sha256').update(raw).digest('hex'), raw_response_text: raw, retrieved_at: new Date(), returned_row_count: 1, completeness: 'COMPLETE', parser_version: COMTRADE_PARSER_VERSION, status: 'accepted', observations: { create: [{ observation_key: `synthetic-${randomUUID()}`, reporter_code: '997', partner_code: '0', partner_is_world: true, partner2_code: '0', flow_direction: 'import', frequency: 'A', period: String(PERIOD), ref_year: PERIOD, hs_code: HS6, hs_level: 6, hs_revision: '2022', trade_value: new Prisma.Decimal(5), trade_value_status: 'observed', quantity_status: 'missing', normalization_version: 'comtrade-normalization-v1', retrieved_at: new Date(), source_origin: EvidenceOrigin.authenticated_real }] } },
      include: { observations: true },
    });
    await expect(ensureCurrentComtradeNormalization(evidence)).rejects.toThrow(/not a provider envelope; refusing to relabel/);
  });

  test('a complete zero-row response still short-circuits without re-parsing', async () => {
    const canonical = request('996');
    const raw = JSON.stringify({ count: 0, data: [] });
    const evidence = await prisma.sourceEvidence.create({ data: { provider: 'un_comtrade', dataset: 'un-comtrade-api', source_origin: EvidenceOrigin.authenticated_real, environment: 'test', request_fingerprint: comtradeRequestFingerprint(canonical), request_parameters: canonical as unknown as Prisma.InputJsonValue, redacted_request: 'comtrade://empty', http_status: 200, response_checksum: createHash('sha256').update(raw).digest('hex'), raw_response_text: raw, retrieved_at: new Date(), provider_row_count: 0, returned_row_count: 0, completeness: 'COMPLETE', parser_version: COMTRADE_PARSER_VERSION, status: 'accepted' }, include: { observations: true } });
    expect(await ensureCurrentComtradeNormalization(evidence)).toEqual([]);
  });
});

describe('the extracted parser preserves provider semantics exactly', () => {
  test('never collapses absence, suppression or invalidity into zero', () => {
    for (const [input, status] of [[null, 'missing'], [undefined, 'missing'], ['', 'missing'], ['suppressed', 'suppressed'], ['Confidential', 'suppressed'], ['..', 'suppressed'], ['unavailable', 'unavailable'], ['N/A', 'unavailable'], ['x', 'invalid'], [-1, 'invalid'], [0, 'observed_zero'], ['0', 'observed_zero'], [2.5, 'observed']] as const) {
      expect(parseOptionalProviderNumber(input), String(input)).toMatchObject({ status });
    }
  });

  test('rejects rows that answer a different question than the one asked', () => {
    const contract = { reporter: '276', partner: '0', partner2: '0', year: PERIOD, flow_direction: 'import' as const, frequency: 'A', customs_code: 'C00', mode_of_supply: '0', hs_revision: '2022', hs_codes: [HS6] };
    const row = (over: Record<string, unknown>) => ({ reporterCode: 276, partnerCode: 0, partner2Code: 0, cmdCode: HS6, refYear: PERIOD, period: String(PERIOD), flowCode: 'M', freqCode: 'A', primaryValue: 10, customsCode: 'C00', mosCode: '0', clCode: 'H6', ...over });
    expect(parseComtradeResponseBody({ count: 1, data: [row({})] }, contract)).toMatchObject({ accepted_rows: 1, rejected_rows: 0, complete: true });
    for (const bad of [{ reporterCode: 380 }, { refYear: 2024 }, { cmdCode: '100610' }, { flowCode: 'X' }, { clCode: 'H5' }]) {
      const parsed = parseComtradeResponseBody({ count: 1, data: [row(bad)] }, contract);
      expect(parsed, JSON.stringify(bad)).toMatchObject({ accepted_rows: 0, rejected_rows: 1, complete: false });
    }
  });

  test('a truncated page is never complete', () => {
    const contract = { reporter: '276', partner: '0', partner2: '0', year: PERIOD, flow_direction: 'import' as const, frequency: 'A', customs_code: 'C00', mode_of_supply: '0', hs_revision: '2022', hs_codes: [HS6] };
    expect(parseComtradeResponseBody({ count: 5, data: [] }, contract)).toMatchObject({ truncated: true, complete: false });
    expect(parseComtradeResponseBody({ data: [] }, contract)).toMatchObject({ provider_row_count: null, complete: false });
  });
});
