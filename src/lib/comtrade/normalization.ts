import { createHash } from 'node:crypto';
import { Prisma, type NormalizedTradeObservation, type SourceEvidence } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { toIso2, WORLD_PARTNER } from './areas';

export const COMTRADE_PARSER_VERSION = 'comtrade-parser-v2';
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
 * Materialize the current semantic normalization over immutable parsed provider facts.
 * Older normalized rows are retained as the parser's historical output; only derived
 * identity fields are recalculated. No provider request and no historical update occurs.
 */
export async function ensureCurrentComtradeNormalization(evidence: EvidenceWithObservations) {
  const current = evidence.observations.filter(row => row.normalization_version === COMTRADE_NORMALIZATION_VERSION);
  if (current.length || evidence.returned_row_count === 0) return current;

  const parsed = evidence.observations.filter(row => row.normalization_version !== COMTRADE_NORMALIZATION_VERSION);
  if (!parsed.length) throw new Error(`SourceEvidence ${evidence.id} has rows but no parsed observations to normalize.`);

  await prisma.normalizedTradeObservation.createMany({
    data: parsed.map(row => ({
      source_evidence_id: evidence.id,
      observation_key: normalizedObservationKey({
        source_evidence_id: evidence.id, reporter_code: row.reporter_code,
        partner_code: row.partner_code, partner2_code: row.partner2_code,
        hs_code: row.hs_code, ref_year: row.ref_year, flow_direction: row.flow_direction,
        frequency: row.frequency, customs_code: row.customs_code,
        mode_of_supply: row.mode_of_supply,
      }),
      reporter_code: row.reporter_code, reporter_iso2: toIso2(row.reporter_code),
      partner_code: row.partner_code, partner_iso2: toIso2(row.partner_code),
      partner_is_world: row.partner_code === WORLD_PARTNER, partner2_code: row.partner2_code,
      flow_direction: row.flow_direction, frequency: row.frequency, period: row.period,
      ref_year: row.ref_year, hs_code: row.hs_code, hs_level: row.hs_level,
      hs_revision: row.hs_revision, customs_code: row.customs_code,
      mode_of_supply: row.mode_of_supply, trade_value: row.trade_value,
      trade_value_status: row.trade_value_status, quantity: row.quantity,
      quantity_status: row.quantity_status, quantity_unit: row.quantity_unit,
      alternate_quantity: row.alternate_quantity,
      alternate_quantity_unit: row.alternate_quantity_unit, net_weight: row.net_weight,
      gross_weight: row.gross_weight, estimate_flag: row.estimate_flag,
      suppression_flag: row.suppression_flag, confidentiality_flag: row.confidentiality_flag,
      normalization_version: COMTRADE_NORMALIZATION_VERSION,
      retrieved_at: row.retrieved_at, source_origin: row.source_origin,
      incompatibility_reason: row.incompatibility_reason,
    })) as Prisma.NormalizedTradeObservationCreateManyInput[],
    skipDuplicates: true,
  });
  return prisma.normalizedTradeObservation.findMany({
    where: { source_evidence_id: evidence.id, normalization_version: COMTRADE_NORMALIZATION_VERSION },
    orderBy: { observation_key: 'asc' },
  });
}
