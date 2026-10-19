/**
 * The reference datasets Demand Discovery v5 may import (docs/36 §2). A dataset key that is not
 * registered here cannot be imported: each one names its parser, its row schema, its licence and
 * what form its bytes take.
 */
import { z } from 'zod';
import { CAPITALS_SUPPLEMENT_KEY, CAPITALS_SUPPLEMENT_PARSER_VERSION, capitalSupplementRowSchema, parseCapitalsSupplement } from './capitals-supplement';
import { CURRENCY_PEGS_KEY, CURRENCY_PEGS_PARSER_VERSION, currencyPegRowSchema, parseCurrencyPegs } from './currency-pegs';
import { SANCTIONS_PROGRAMMES_KEY, SANCTIONS_PROGRAMMES_PARSER_VERSION, parseSanctionsProgrammes, sanctionsProgrammeRowSchema } from './sanctions-programmes';
import { ECGC_PARSER_VERSION, ecgcRatingRowSchema, parseEcgcCountryRiskText } from './ecgc';
import { GEO_CEPII_PARSER_VERSION, capitalRowSchema, parseGeoCepiiCsv } from './geodist';
import {
  COMTRADE_AVAILABILITY_PARSER_VERSION, INDIA_AGREEMENTS_PARSER_VERSION, WDI_PARSER_VERSION, comtradeAvailabilityRowSchema, indiaTradeAgreementRowSchema,
  parseComtradeAvailability, parseIndiaTradeAgreements, parseWdiIndicator, wdiRowSchema,
} from './parsers';

/**
 * The publisher's original file a derived text was made from (a PDF circular's text, a Stata
 * table's CSV export). Stored with the release so its rows trace back to the publisher's bytes.
 */
export const derivedSourceSchema = z.object({
  url: z.string().url().startsWith('https://'),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().positive(),
  retrieved_at: z.string().datetime(),
  method: z.string().min(10),
});
export type DerivedSource = z.infer<typeof derivedSourceSchema>;

export interface ParsedReferenceDataset {
  version: string;
  rows: unknown[];
  validation: Record<string, unknown>;
}

/**
 * What the imported bytes are: the publisher's own file; a text form of a publisher file that has
 * no machine-readable edition (a PDF's text, a Stata table's CSV export), which must name the
 * original it was derived from; or a list ClearTrade curates with a source per row.
 */
export type ReferenceSourceForm = 'publisher_file' | 'derived_from_publisher_file' | 'curated';

export interface ReferenceDatasetDefinition {
  key: string;
  description: string;
  licence: string;
  parser_version: string;
  source_form: ReferenceSourceForm;
  row_schema: z.ZodTypeAny;
  parse(bytes: Buffer): ParsedReferenceDataset;
}

/** WDI indicators docs/36 reads, all published by the World Bank under CC BY 4.0. */
export const WDI_INDICATORS = {
  'LP.LPI.OVRL.XQ': 'Logistics performance index, overall (1 = low to 5 = high)',
  'TM.TAX.MANF.SM.AR.ZS': 'Tariff rate, applied, simple mean, manufactured products (%)',
  'TM.TAX.TCOM.SM.AR.ZS': 'Tariff rate, applied, simple mean, primary products (%)',
  /** UNCTAD's liner shipping connectivity index as the World Bank republishes it; the v5 logistics estimate (D-025). */
  'IS.SHP.GCNW.XQ': 'Liner shipping connectivity index (maximum value in 2004 = 100)',
} as const;
export type WdiIndicatorId = keyof typeof WDI_INDICATORS;

function wdi(indicator: WdiIndicatorId): ReferenceDatasetDefinition {
  return {
    key: `wdi:${indicator}`,
    description: WDI_INDICATORS[indicator],
    licence: 'cc-by-4.0',
    parser_version: WDI_PARSER_VERSION,
    source_form: 'publisher_file',
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
    source_form: 'publisher_file',
    row_schema: comtradeAvailabilityRowSchema,
    parse(bytes) {
      const rows = parseComtradeAvailability(bytes, period);
      return { version: `getDa ${period}`, rows, validation: { reporter_count: new Set(rows.map((row) => row.reporter_code)).size } };
    },
  };
}

/** India's trade agreements, curated in the repository with a source per row (docs/36 §2). */
const INDIA_TRADE_AGREEMENTS: ReferenceDatasetDefinition = {
  key: 'india:trade-agreements',
  description: "India's trade agreements in force, by partner, for the labelled duty estimate",
  licence: 'curated-from-public-sources',
  parser_version: INDIA_AGREEMENTS_PARSER_VERSION,
  source_form: 'curated',
  row_schema: indiaTradeAgreementRowSchema,
  parse(bytes) {
    const parsed = parseIndiaTradeAgreements(bytes);
    return {
      version: `india-trade-agreements-v1 compiled ${parsed.compiled_on}`,
      rows: parsed.rows,
      validation: { partners: new Set(parsed.rows.map((row) => row.partner_iso2)).size, agreements: new Set(parsed.rows.map((row) => row.agreement)).size, excluded: parsed.excluded },
    };
  },
};

/** ECGC's short-term country risk list, read from the circular's text (docs/36 §4 metric 10). */
export const ECGC_COUNTRY_RISK_KEY = 'ecgc:country-risk:short-term';
const ECGC_COUNTRY_RISK: ReferenceDatasetDefinition = {
  key: ECGC_COUNTRY_RISK_KEY,
  description: 'ECGC Country Risk Classification List, short term: grade and cover status by country',
  // A public circular; ECGC states no reuse terms. Recorded as unconfirmed (docs/36 §9).
  licence: 'ecgc-public-circular-terms-unconfirmed',
  parser_version: ECGC_PARSER_VERSION,
  source_form: 'derived_from_publisher_file',
  row_schema: ecgcRatingRowSchema,
  parse(bytes) {
    const parsed = parseEcgcCountryRiskText(bytes);
    return {
      version: `ECGC short-term list w.e.f. ${parsed.effective_from}`,
      rows: parsed.rows,
      validation: {
        effective_from: parsed.effective_from, pages: parsed.pages, published_rows: parsed.published_rows, iso_rows: parsed.rows.length,
        sections: parsed.sections, excluded: parsed.excluded, several_territories: parsed.several, named_by_table: parsed.named_by_table,
      },
    };
  },
};

/** CEPII GeoDist capitals, for the distance fit (docs/36 §4 metric 8). */
export const GEO_CEPII_KEY = 'cepii:geo_cepii';
const GEO_CEPII: ReferenceDatasetDefinition = {
  key: GEO_CEPII_KEY,
  description: 'CEPII GeoDist geo_cepii: capital city coordinates by country (2011)',
  licence: 'etalab-2.0',
  parser_version: GEO_CEPII_PARSER_VERSION,
  source_form: 'derived_from_publisher_file',
  row_schema: capitalRowSchema,
  parse(bytes) {
    const parsed = parseGeoCepiiCsv(bytes);
    return {
      version: 'CEPII geo_cepii (Mayer & Zignago 2011)',
      rows: parsed.rows,
      validation: { rows_read: parsed.rows_read, countries: parsed.rows.length, successors: parsed.successors },
    };
  },
};

/** Capitals GeoDist does not list, curated with a source per row (docs/36 §9). */
const CAPITALS_SUPPLEMENT: ReferenceDatasetDefinition = {
  key: CAPITALS_SUPPLEMENT_KEY,
  description: 'Capital coordinates for screening markets CEPII GeoDist (2011) does not list',
  licence: 'curated-from-public-sources',
  parser_version: CAPITALS_SUPPLEMENT_PARSER_VERSION,
  source_form: 'curated',
  row_schema: capitalSupplementRowSchema,
  parse(bytes) {
    const parsed = parseCapitalsSupplement(bytes);
    return { version: `capitals-supplement-v1 compiled ${parsed.compiled_on}`, rows: parsed.rows, validation: { markets: parsed.rows.map((row) => row.iso2) } };
  },
};

/** Official fixed exchange rates against a currency the ECB publishes, a source per row (D-025). */
const CURRENCY_PEGS: ReferenceDatasetDefinition = {
  key: CURRENCY_PEGS_KEY,
  description: 'Official fixed exchange rates of currencies the ECB does not publish',
  licence: 'curated-from-public-sources',
  parser_version: CURRENCY_PEGS_PARSER_VERSION,
  source_form: 'curated',
  row_schema: currencyPegRowSchema,
  parse(bytes) {
    const parsed = parseCurrencyPegs(bytes);
    return { version: `currency-pegs-v1 compiled ${parsed.compiled_on}`, rows: parsed.rows, validation: { currencies: parsed.rows.map((row) => row.currency) } };
  },
};

/** Country-level sanctions programmes (UN, US, EU), a legal basis and source per row (D-025). */
const SANCTIONS_PROGRAMMES: ReferenceDatasetDefinition = {
  key: SANCTIONS_PROGRAMMES_KEY,
  description: 'Country-level sanctions programmes of the UN Security Council, the US and the EU',
  licence: 'curated-from-public-sources',
  parser_version: SANCTIONS_PROGRAMMES_PARSER_VERSION,
  source_form: 'curated',
  row_schema: sanctionsProgrammeRowSchema,
  parse(bytes) {
    const parsed = parseSanctionsProgrammes(bytes);
    return { version: `sanctions-programmes-v1 checked ${parsed.checked_on}`, rows: parsed.rows, validation: { markets: [...new Set(parsed.rows.map((row) => row.country_code))], programmes: parsed.rows.length } };
  },
};

const FIXED: readonly ReferenceDatasetDefinition[] = [INDIA_TRADE_AGREEMENTS, ECGC_COUNTRY_RISK, GEO_CEPII, CAPITALS_SUPPLEMENT, CURRENCY_PEGS, SANCTIONS_PROGRAMMES];

export function referenceDatasetDefinition(key: string): ReferenceDatasetDefinition {
  const fixed = FIXED.find((definition) => definition.key === key);
  if (fixed) return fixed;
  const wdiMatch = /^wdi:(.+)$/.exec(key);
  if (wdiMatch && wdiMatch[1] in WDI_INDICATORS) return wdi(wdiMatch[1] as WdiIndicatorId);
  const availability = /^comtrade:availability:(\d{4})$/.exec(key);
  if (availability) return comtradeAvailability(Number(availability[1]));
  throw new Error(`Unknown reference dataset ${key}. Registered: ${[...Object.keys(WDI_INDICATORS).map((id) => `wdi:${id}`), 'comtrade:availability:<year>', ...FIXED.map((definition) => definition.key)].join(', ')}.`);
}
