import type { MarketAccessIngestResult, MarketAccessLineRecord } from '@/lib/market-access/contract';
import {
  determineIndiaPreference,
  resolveNationalTariffLine,
  type CandidateTariffLine,
  type ParsedDuty,
} from '@/lib/market-access/tariff-semantics';
import type { AustraliaAuthorityBundle, AustraliaTariffRow } from './australia-bundle';

export const AUSTRALIA_PARSER_VERSION = 'abf-parser-v1' as const;
export const AUSTRALIA_PROVIDER = 'au_abf_working_tariff' as const;
export const AUSTRALIA_SOURCE_AUTHORITY = 'Australian Border Force' as const;
export const AUSTRALIA_SOURCE_DATASET = 'Customs Tariff Act 1995 — Schedule 3 and Schedule 10A' as const;

const EMPTY_DUTY = (kind: ParsedDuty['kind'], expression: string, note: string | null = null): ParsedDuty => ({
  kind, ad_valorem_rate_percent: null, specific_amount: null, specific_currency: null,
  specific_unit: null, specific_unit_quantity: null, expression, note,
});

/**
 * A Schedule 3 "Rate#" cell is a composite, not a single rate. Real observed shapes:
 *
 *   Free
 *   5%
 *   5% CA:Free
 *   5% DCS:4% DCT:5%
 *   5%, and $110.15/L of alcohol NZ/PG/FI/DC/LDC/SG: $110.15/L of alcohol
 *   $0.537 /L NZ/PG/FI/DC/LDC: $0.537 /L
 *   5%From 1 July 2018:3.75%From 1 July 2019:Free
 *
 * Two things have to be separated out before the general rate can be read:
 *
 *  - Scheme rates, prefixed by the scheme's own abbreviation ("CA:", "DCS:", "NZ/PG/FI/DC/LDC/SG:").
 *    These are other countries' preferential rates and are never Australia's general rate. India is
 *    deliberately not among them: ECTA treatment lives in Schedule 10A, not in this column.
 *  - Phased rates, prefixed by "From <date>:". These are legislated future steps. Collapsing them
 *    into one scalar would be wrong in both directions — reporting 5% for a line that stepped to
 *    Free in 2019, or reporting a rate that has not commenced yet.
 */
const SCHEME_PREFIX = /([A-Z]{2,4}(?:\/[A-Z]{2,4})*)\s*:/g;
const PHASE_PREFIX = /From\s+(\d{1,2}\s+\w+\s+\d{4})\s*:/gi;

export interface AustraliaRateReading {
  /** The general (MFN) duty in force at the assessment date, phases applied. */
  general: ParsedDuty;
  /** Scheme code → verbatim rate text, retained but never treated as the general rate. */
  scheme_rates: Record<string, string>;
  /** Legislated steps, oldest first, each with the date it commences. */
  phases: Array<{ commences: Date; text: string }>;
}

function parseAustralianDate(text: string): Date | null {
  const months: Record<string, number> = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  };
  const match = /^(\d{1,2})\s+(\w+)\s+(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const month = months[match[2]!.toLowerCase()];
  if (month === undefined) return null;
  return new Date(Date.UTC(Number(match[3]), month, Number(match[1])));
}

/** Turns one rate expression (no scheme/phase prefixes left) into a ParsedDuty. */
export function parseAustraliaDutyExpression(raw: string): ParsedDuty {
  const text = raw.trim().replace(/^,\s*/, '').trim();
  if (!text) return EMPTY_DUTY('none', raw.trim(), 'No rate published in this cell.');
  if (/^free$/i.test(text)) {
    return { kind: 'ad_valorem', ad_valorem_rate_percent: 0, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null, expression: text, note: null };
  }

  const adValorem = /(\d+(?:\.\d+)?)\s*%/.exec(text);
  const specific = /\$\s*(\d+(?:\.\d+)?)\s*\/\s*([A-Za-z]+(?:\s+of\s+alcohol)?)/.exec(text);

  // Both present: a genuine compound duty. Every component is retained; the verbatim expression is
  // never reduced to whichever half happens to be easier to compute.
  if (adValorem && specific) {
    return {
      kind: 'compound',
      ad_valorem_rate_percent: Number(adValorem[1]),
      specific_amount: Number(specific[1]),
      specific_currency: 'AUD',
      specific_unit: specific[2]!.trim(),
      specific_unit_quantity: 1,
      expression: text,
      note: /calculated on|exceeds/i.test(text)
        ? 'The specific component carries a threshold/formula condition stated in the source; it is retained verbatim rather than reduced to a flat amount.'
        : null,
    };
  }
  if (specific) {
    return {
      kind: 'specific',
      ad_valorem_rate_percent: null,
      specific_amount: Number(specific[1]),
      specific_currency: 'AUD',
      specific_unit: specific[2]!.trim(),
      specific_unit_quantity: 1,
      expression: text,
      note: /calculated on|exceeds/i.test(text)
        ? 'A threshold/formula condition is stated in the source and is retained verbatim rather than reduced to a flat amount.'
        : null,
    };
  }
  if (adValorem) {
    return { kind: 'ad_valorem', ad_valorem_rate_percent: Number(adValorem[1]), specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null, expression: text, note: null };
  }
  return EMPTY_DUTY('unparsed', text, 'The rate expression did not match a recognised Australian ad valorem, specific or compound form; it is retained verbatim rather than guessed.');
}

/** Splits a composite Rate# cell and resolves the general rate in force at `at`. */
export function readAustraliaRateCell(rateText: string, at: Date): AustraliaRateReading {
  const text = rateText.trim();
  const markers: Array<{ index: number; length: number; kind: 'scheme' | 'phase'; label: string }> = [];

  SCHEME_PREFIX.lastIndex = 0;
  for (const match of text.matchAll(SCHEME_PREFIX)) {
    // "From" is matched by neither branch, but a phase label could look scheme-shaped; phases are
    // collected separately below and win on overlap because they are matched on the literal "From".
    markers.push({ index: match.index!, length: match[0].length, kind: 'scheme', label: match[1]! });
  }
  PHASE_PREFIX.lastIndex = 0;
  for (const match of text.matchAll(PHASE_PREFIX)) {
    markers.push({ index: match.index!, length: match[0].length, kind: 'phase', label: match[1]! });
  }
  markers.sort((a, b) => a.index - b.index);
  // Drop scheme markers that sit inside a phase marker's own span ("From 1 July 2018:" contains no
  // scheme code, but defensive de-overlapping keeps a future label change from double-counting).
  const deduped = markers.filter((marker, index) => index === 0 || marker.index >= markers[index - 1]!.index + markers[index - 1]!.length);

  const generalText = (deduped.length ? text.slice(0, deduped[0]!.index) : text).trim();
  const schemeRates: Record<string, string> = {};
  const phases: Array<{ commences: Date; text: string }> = [];

  for (const [index, marker] of deduped.entries()) {
    const start = marker.index + marker.length;
    const end = index + 1 < deduped.length ? deduped[index + 1]!.index : text.length;
    const segment = text.slice(start, end).trim();
    if (marker.kind === 'scheme') {
      schemeRates[marker.label] = segment;
    } else {
      const commences = parseAustralianDate(marker.label);
      if (commences) phases.push({ commences, text: segment });
    }
  }

  // Apply phases: the rate in force is the latest step that has already commenced; before the first
  // step, the base rate stands. A step that has not commenced is retained but never applied.
  phases.sort((a, b) => a.commences.getTime() - b.commences.getTime());
  const commenced = phases.filter((phase) => phase.commences.getTime() <= at.getTime());
  const effectiveText = commenced.length ? commenced[commenced.length - 1]!.text : generalText;

  const general = parseAustraliaDutyExpression(effectiveText);
  if (phases.length) {
    const applied = commenced.length ? `step commencing ${commenced[commenced.length - 1]!.commences.toISOString().slice(0, 10)}` : 'base rate (no step commenced)';
    general.note = `${general.note ? `${general.note} ` : ''}Legislated phased rate; ${applied} applied. Full published schedule: ${rateText.trim()}`;
  }
  return { general, scheme_rates: schemeRates, phases };
}

/**
 * Australia's India (ECTA) treatment, from the retained Schedule 10A.
 *
 * The schedule is an exception list: its own note says every subheading NOT listed is Free. So a
 * subheading's absence is positive evidence of duty-free ECTA treatment rather than missing data —
 * but only for goods that are Indian originating goods under sections 15/16 of the Customs Tariff
 * Act, which is a shipment-level rules-of-origin fact no schedule can establish. That is why this
 * always resolves through `determineIndiaPreference`, which can only ever return
 * `potentially_applicable_requires_origin_proof` for a published measure.
 */
function indiaMeasureFor(bundle: AustraliaAuthorityBundle, referenceNumber: string, at: Date): ParsedDuty {
  const exception = bundle.india_exceptions.find((row) => {
    const heading = row.heading;
    return referenceNumber === heading || referenceNumber.startsWith(`${heading}.`) || referenceNumber.replace(/\./g, '').startsWith(heading.replace(/\./g, ''));
  });
  if (!exception) {
    return {
      kind: 'ad_valorem', ad_valorem_rate_percent: 0, specific_amount: null, specific_currency: null,
      specific_unit: null, specific_unit_quantity: null, expression: 'Free',
      note: `Not listed among Schedule 10A's exceptions, which the schedule's own note makes duty-free: "${bundle.india_default_note}"`,
    };
  }
  const reading = readAustraliaRateCell(exception.rate_text, at);
  reading.general.note = `${reading.general.note ? `${reading.general.note} ` : ''}Schedule 10A exception item ${exception.item} for heading ${exception.heading}.`;
  return reading.general;
}

export function buildAustraliaMarketAccess(args: {
  bundle: AustraliaAuthorityBundle;
  release_id: string;
  release_reference_date: Date;
  retrieved_at: Date;
  hs6: string;
  at: Date;
  origin_country?: string;
  parser_version?: string;
}): MarketAccessIngestResult {
  const hs6 = args.hs6.trim();
  const origin = (args.origin_country ?? 'IN').trim().toUpperCase();
  const at = args.at;

  const matching = args.bundle.rows.filter((row) => row.reference_number.replace(/\./g, '').startsWith(hs6));
  const built: Array<{ candidate: CandidateTariffLine; row: AustraliaTariffRow; reading: AustraliaRateReading; india: ParsedDuty }> = [];

  for (const row of matching) {
    const reading = readAustraliaRateCell(row.rate_text, at);
    // Australia's declarable line is the reference number plus its statistical code.
    const nationalCode = `${row.reference_number.replace(/\./g, '')}${row.statistical_code}`;
    built.push({
      candidate: {
        national_tariff_code: nationalCode,
        description: row.description,
        declarable: true,
        effective_from: args.release_reference_date,
        effective_to: null,
        general_duty: reading.general,
        control_codes: [],
        preference_area_ids: Object.keys(reading.scheme_rates),
      },
      row,
      reading,
      india: indiaMeasureFor(args.bundle, row.reference_number, at),
    });
  }

  const resolution = resolveNationalTariffLine(built.map((entry) => entry.candidate));

  const lines: MarketAccessLineRecord[] = [];
  for (const entry of built) {
    lines.push({
      national_tariff_code: entry.candidate.national_tariff_code,
      description: entry.candidate.description,
      declarable: true,
      measure_kind: 'third_country_duty',
      origin_geographic_area_id: 'MFN',
      origin_scope: 'erga_omnes',
      applies_to_origin_country: null,
      duty: entry.candidate.general_duty,
      conditions: {
        statistical_unit: entry.row.unit || null,
        scheme_rates: entry.reading.scheme_rates,
        phased_steps: entry.reading.phases.map((phase) => ({ commences: phase.commences.toISOString(), rate: phase.text })),
      },
      effective_from: entry.candidate.effective_from ?? null,
      effective_to: null,
      source_reference: `ABF Schedule 3 ch${args.bundle.chapter} · ${entry.row.reference_number} ${entry.row.statistical_code}`,
      raw_measure: { reference_number: entry.row.reference_number, statistical_code: entry.row.statistical_code, rate_text: entry.row.rate_text },
    });
    // The ECTA line is always its own record: an India rate is never folded into the general duty.
    lines.push({
      national_tariff_code: entry.candidate.national_tariff_code,
      description: entry.candidate.description,
      declarable: true,
      measure_kind: 'tariff_preference',
      origin_geographic_area_id: 'AU_ECTA_INDIA',
      origin_scope: 'programme',
      applies_to_origin_country: 'IN',
      duty: entry.india,
      conditions: {
        agreement: 'Australia–India Economic Cooperation and Trade Agreement (ECTA)',
        legal_basis: 'Customs Tariff Act 1995, Schedule 10A (sections 15 and 16)',
        requires_indian_originating_goods: true,
      },
      effective_from: args.release_reference_date,
      effective_to: null,
      source_reference: `ABF Schedule 10A · ${entry.row.reference_number}`,
      raw_measure: { reference_number: entry.row.reference_number, schedule_10a_note: args.bundle.india_default_note },
    });
  }

  const resolvedEntry = resolution.resolved_line
    ? built.find((entry) => entry.candidate.national_tariff_code === resolution.resolved_line!.national_tariff_code)
    : null;

  const indiaPreference = resolvedEntry
    ? determineIndiaPreference({
      direct_india_measures: [{ geographic_area_id: 'AU_ECTA_INDIA', duty: resolvedEntry.india, is_quota: false }],
      proven_group_measures: [],
      beneficiary_enumeration_is_complete: true,
      unresolved_program_symbols: [],
    })
    : {
      applicability: 'unknown' as const,
      duty: null,
      geographic_area_id: null,
      basis: 'No single Australian tariff line resolved for this HS6, so no line-specific ECTA treatment can be stated.',
    };

  const parserVersion = args.parser_version ?? AUSTRALIA_PARSER_VERSION;
  return {
    jurisdiction: 'AU',
    country_code: 'AU',
    hs6,
    hs_revision: `HS / Australian Customs Tariff — ${args.bundle.release_identifier}`,
    provider: AUSTRALIA_PROVIDER,
    source_authority: AUSTRALIA_SOURCE_AUTHORITY,
    source_dataset: AUSTRALIA_SOURCE_DATASET,
    source_dataset_version: args.bundle.release_identifier,
    source_reference: `${args.bundle.chapter_url} + ${args.bundle.schedule_10a_url} (bundle sha256 ${args.bundle.checksum})`,
    national_code_system: 'AU_TARIFF_ITEM',
    parser_version: parserVersion,
    source_release_id: args.release_id,
    request_identity: `origin=${origin};as_of=${at.toISOString().slice(0, 10)}`,
    retrieved_at: args.retrieved_at,
    evidence_class: 'authoritative_public',
    recorded_by_id: null,
    resolution,
    general_duty: resolution.resolved_line ? resolution.resolved_line.general_duty : null,
    india_preference: indiaPreference,
    lines,
    requirements: [],
    // Schedule 3 and 10A prove duty only. They are not a permit/licence corpus, so nothing here
    // can establish that a good faces no regulatory requirement.
    regulatory_coverage_complete: false,
    raw_evidence: {
      authority_release_id: args.release_id,
      release_identifier: args.bundle.release_identifier,
      chapter: args.bundle.chapter,
      bundle_sha256: args.bundle.checksum,
      schedule_10a_note: args.bundle.india_default_note,
      india_exception_count: args.bundle.india_exceptions.length,
      reader_version: args.bundle.reader_version,
      parser_version: parserVersion,
      origin_country: origin,
      candidate_codes: built.map((entry) => entry.candidate.national_tariff_code),
    },
  };
}
