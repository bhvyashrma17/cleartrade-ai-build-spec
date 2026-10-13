/**
 * The reference datasets Demand Discovery v5 may import (docs/36 §2). A dataset key that is not
 * registered here cannot be imported: each one names its parser, its row schema and its licence.
 */
import type { z } from 'zod';
import {
  COMTRADE_AVAILABILITY_PARSER_VERSION, WDI_PARSER_VERSION, comtradeAvailabilityRowSchema, parseComtradeAvailability, parseWdiIndicator, wdiRowSchema,
} from './parsers';

export interface ParsedReferenceDataset {
  version: string;
  rows: unknown[];
  validation: Record<string, unknown>;
}

export interface ReferenceDatasetDefinition {
  key: string;
  description: string;
  licence: string;
  parser_version: string;
  row_schema: z.ZodTypeAny;
  parse(bytes: Buffer): ParsedReferenceDataset;
}

/** WDI indicators docs/36 reads, all published by the World Bank under CC BY 4.0. */
export const WDI_INDICATORS = {
  'LP.LPI.OVRL.XQ': 'Logistics performance index, overall (1 = low to 5 = high)',
  'TM.TAX.MANF.SM.AR.ZS': 'Tariff rate, applied, simple mean, manufactured products (%)',
  'TM.TAX.TCOM.SM.AR.ZS': 'Tariff rate, applied, simple mean, primary products (%)',
} as const;
export type WdiIndicatorId = keyof typeof WDI_INDICATORS;

function wdi(indicator: WdiIndicatorId): ReferenceDatasetDefinition {
  return {
    key: `wdi:${indicator}`,
    description: WDI_INDICATORS[indicator],
    licence: 'cc-by-4.0',
    parser_version: WDI_PARSER_VERSION,
    row_schema: wdiRowSchema,
    parse(bytes) {
      const parsed = parseWdiIndicator(bytes, indicator);
      const years = parsed.rows.map((row) => row.year);
      return {
        version: `WDI ${indicator}${parsed.last_updated ? ` updated ${parsed.last_updated}` : ''}`,
        rows: parsed.rows,
        validation: { indicator_name: parsed.indicator_name, country_count: parsed.rows.length, latest_year: Math.max(...years), earliest_year: Math.min(...years) },
      };
    },
  };
}

function comtradeAvailability(period: number): ReferenceDatasetDefinition {
  return {
    key: `comtrade:availability:${period}`,
    description: `UN Comtrade reporters with annual HS goods data for ${period}`,
    licence: 'un-comtrade-terms',
    parser_version: COMTRADE_AVAILABILITY_PARSER_VERSION,
    row_schema: comtradeAvailabilityRowSchema,
    parse(bytes) {
      const rows = parseComtradeAvailability(bytes, period);
      return { version: `getDa ${period}`, rows, validation: { reporter_count: new Set(rows.map((row) => row.reporter_code)).size } };
    },
  };
}

export function referenceDatasetDefinition(key: string): ReferenceDatasetDefinition {
  const wdiMatch = /^wdi:(.+)$/.exec(key);
  if (wdiMatch && wdiMatch[1] in WDI_INDICATORS) return wdi(wdiMatch[1] as WdiIndicatorId);
  const availability = /^comtrade:availability:(\d{4})$/.exec(key);
  if (availability) return comtradeAvailability(Number(availability[1]));
  throw new Error(`Unknown reference dataset ${key}. Registered: ${[...Object.keys(WDI_INDICATORS).map((id) => `wdi:${id}`), 'comtrade:availability:<year>'].join(', ')}.`);
}
