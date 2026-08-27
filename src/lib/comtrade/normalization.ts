import { createHash } from 'node:crypto';
import { Prisma, type NormalizedTradeObservation, type SourceEvidence } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { toIso2, WORLD_PARTNER } from './areas';
import { COMTRADE_PARSER_VERSION, isComtradeResponseBody, parseComtradeResponseBody } from './parser';
import type { CanonicalComtradeRequest } from './request';

export { COMTRADE_PARSER_VERSION };
export const COMTRADE_NORMALIZATION_VERSION = 'comtrade-normalization-v2';

type EvidenceWithObservations = SourceEvidence & { observations: NormalizedTradeObservation[] };

export function normalizedObservationKey(input: {
  source_evidence_id: string; reporter_code: string; partner_code: string;
  partner2_code: string | null; hs_code: string; ref_year: number; flow_direction: string;
  frequency: string; customs_code: string | null; mode_of_supply: string | null;
  normalization_version?: string;
}) {
  return createHash('sha256').update(JSON.stringify({
    sourceEvidenceId: input.source_evidence_id,
    normalizationVersion: input.normalization_version ?? COMTRADE_NORMALIZATION_VERSION,
    reporter: input.reporter_code, partner: input.partner_code, partner2: input.partner2_code,
    hs: input.hs_code, year: input.ref_year, flow: input.flow_direction,
    frequency: input.frequency, customs: input.customs_code, mos: input.mode_of_supply,
  })).digest('hex');
}

/**
 * Materialize the current semantic normalization by RE-PARSING the immutable raw response.
 *
 * This deliberately does not copy semantic fields forward from the previous version's rows.
 * Copying is what made an earlier version of this function a latent corruption path: it
 * relabelled old semantics with a new version string, so every downstream version assertion
 * would pass while the values underneath were computed by the old parser. Re-parsing
 * `raw_response_text` through the same parser the acquisition path uses means the version
 * label is a genuine statement about how the numbers were derived.
 *
 * It fails closed. Evidence whose raw body is not a recognisable provider envelope — a
 * synthetic body written by a non-provider client, say — cannot be re-derived, so it throws
 * rather than silently falling back to a copy. No provider request and no historical update
 * ever occurs here; older rows are retained as the previous parser's own output.
 */
export async function ensureCurrentComtradeNormalization(evidence: EvidenceWithObservations) {
  const current = evidence.observations.filter(row => row.normalization_version === COMTRADE_NORMALIZATION_VERSION);
  if (current.length || evidence.returned_row_count === 0) return current;
  if (!evidence.observations.length) throw new Error(`SourceEvidence ${evidence.id} has rows but no parsed observations to normalize.`);

  const request = evidence.request_parameters as unknown as CanonicalComtradeRequest | null;
  if (!request?.reporter_code || !request.period) throw new Error(`SourceEvidence ${evidence.id} has no canonical request contract to re-parse against.`);
  let body: unknown;
  try { body = JSON.parse(evidence.raw_response_text); }
  catch (error) { throw new Error(`SourceEvidence ${evidence.id} raw response is not valid JSON; refusing to relabel stale semantics.`, { cause: error }); }
  if (!isComtradeResponseBody(body)) throw new Error(`SourceEvidence ${evidence.id} raw response is not a provider envelope; refusing to relabel stale semantics.`);

  const parsed = parseComtradeResponseBody(body, {
    reporter: String(request.reporter_code), partner: String(request.partner_code), partner2: String(request.partner2_code ?? '0'),
    year: Number(request.period), flow_direction: request.flow_direction, frequency: request.frequency,
    customs_code: request.customs_code, mode_of_supply: request.mode_of_supply, hs_revision: request.hs_revision, hs_codes: request.hs_codes,
  });

  await prisma.normalizedTradeObservation.createMany({
    data: parsed.rows.map(row => ({
      source_evidence_id: evidence.id,
      observation_key: normalizedObservationKey({
        source_evidence_id: evidence.id, reporter_code: row.reporter,
        partner_code: row.partner, partner2_code: row.partner2 ?? String(request.partner2_code ?? '0'),
        hs_code: row.hs_code, ref_year: row.year, flow_direction: request.flow_direction,
        frequency: request.frequency, customs_code: row.customs_code ?? request.customs_code,
        mode_of_supply: row.mode_of_supply ?? request.mode_of_supply,
      }),
      reporter_code: row.reporter, reporter_iso2: toIso2(row.reporter),
      partner_code: row.partner, partner_iso2: toIso2(row.partner),
      partner_is_world: row.partner === WORLD_PARTNER, partner2_code: row.partner2 ?? String(request.partner2_code ?? '0'),
      flow_direction: request.flow_direction, frequency: request.frequency, period: row.period,
      ref_year: row.year, hs_code: row.hs_code, hs_level: 6,
      hs_revision: request.hs_revision, customs_code: row.customs_code ?? request.customs_code,
      mode_of_supply: row.mode_of_supply ?? request.mode_of_supply,
      trade_value: row.value == null ? null : new Prisma.Decimal(row.value),
      trade_value_status: row.value_status ?? (row.value == null ? 'missing' : row.value === 0 ? 'observed_zero' : 'observed'),
      quantity: row.quantity == null ? null : new Prisma.Decimal(row.quantity),
      quantity_status: row.quantity_status ?? (row.quantity == null ? 'missing' : 'observed'),
      quantity_unit: row.unit,
      alternate_quantity: row.alternate_quantity == null ? null : new Prisma.Decimal(row.alternate_quantity),
      alternate_quantity_unit: row.alternate_quantity_unit,
      net_weight: row.net_weight == null ? null : new Prisma.Decimal(row.net_weight),
      gross_weight: row.gross_weight == null ? null : new Prisma.Decimal(row.gross_weight),
      estimate_flag: row.estimate_flag ?? null,
      suppression_flag: row.suppression_flag ?? null, confidentiality_flag: row.confidentiality_flag ?? null,
      normalization_version: COMTRADE_NORMALIZATION_VERSION,
      retrieved_at: evidence.retrieved_at, source_origin: evidence.source_origin,
    })) as Prisma.NormalizedTradeObservationCreateManyInput[],
    skipDuplicates: true,
  });
  return prisma.normalizedTradeObservation.findMany({
    where: { source_evidence_id: evidence.id, normalization_version: COMTRADE_NORMALIZATION_VERSION },
    orderBy: { observation_key: 'asc' },
  });
}
