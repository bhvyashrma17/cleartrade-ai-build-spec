import { createHash } from 'node:crypto';
import type { MarketAccessIngestResult, MarketAccessLineRecord } from '@/lib/market-access/contract';
import { resolveNationalTariffLine, type CandidateTariffLine, type ClassificationResolutionResult, type ParsedDuty } from '@/lib/market-access/tariff-semantics';

export const GEORGIA_BUNDLE_READER_VERSION = 'ge-matsne-article-197-reader-v1' as const;
export const GEORGIA_PARSER_VERSION = 'ge-tax-code-article-197-parser-v1' as const;
export const GEORGIA_PROVIDER = 'ge_matsne_tax_code_article_197' as const;
export const GEORGIA_SOURCE_AUTHORITY = 'Legislative Herald of Georgia (Matsne)' as const;
export const GEORGIA_SOURCE_DATASET = 'Tax Code of Georgia — Article 197, Import duty rates' as const;

export class GeorgiaBundleError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'GeorgiaBundleError'; }
}

export interface GeorgiaTariffRule { code: string; description: string; duty_expression: string; paragraph: '1' | '2' | '3' | '6' }
export interface GeorgiaAuthorityTextBundle {
  checksum: string; size_bytes: number; files: Array<{ name: string; sha256: string; size_bytes: number; role: string }>;
  release_identifier: string; source_url: string; rules: GeorgiaTariffRule[];
  residual_duty_expression: '0%'; article_amendments: string[]; reader_version: typeof GEORGIA_BUNDLE_READER_VERSION;
}

function decodeHtml(value: string) {
  return value.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ').replace(/&ndash;|&mdash;/gi, '-')
    .replace(/&rsquo;|&#39;/gi, "'").replace(/&ldquo;|&rdquo;|&quot;/gi, '"')
    .replace(/&amp;/gi, '&').replace(/&eacute;/gi, 'é').replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}

function cells(row: string): string[] {
  return [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => decodeHtml(match[1] ?? ''));
}

function tableRules(table: string, paragraph: '1' | '2' | '3', fixedDuty?: string): GeorgiaTariffRule[] {
  const rules: GeorgiaTariffRule[] = [];
  for (const match of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const values = cells(match[1] ?? '');
    if (!/^\d+$/.test(values[0] ?? '')) continue;
    const code = (values[1] ?? '').replace(/\D/g, '');
    if (!/^\d{2,11}$/.test(code)) throw new GeorgiaBundleError('invalid_code', `Article 197 contains an invalid legal code scope: "${values[1] ?? ''}".`);
    const duty = fixedDuty ?? values[3] ?? '';
    if (!duty) throw new GeorgiaBundleError('missing_duty', `Article 197 paragraph ${paragraph} code ${code} has no published duty expression.`);
    rules.push({ code, description: values[2] ?? '', duty_expression: duty, paragraph });
  }
  return rules;
}

export function readGeorgiaAuthorityText(args: { bytes: Buffer; release_identifier: string; source_url: string }): GeorgiaAuthorityTextBundle {
  const html = args.bytes.toString('utf8');
  const articleStart = html.search(/Article\s*197\s*(?:&ndash;|-)/i);
  const articleEnd = html.search(/Article\s*198\s*(?:&ndash;|-)/i);
  if (articleStart < 0 || articleEnd <= articleStart) throw new GeorgiaBundleError('missing_article', 'The Matsne document does not contain a bounded Article 197 followed by Article 198.');
  const article = html.slice(articleStart, articleEnd);
  if (!/A\s*12%\s*rate of import duty/i.test(decodeHtml(article)) || !/A\s*5%\s*rate of import duty/i.test(decodeHtml(article))) {
    throw new GeorgiaBundleError('unexpected_article', 'Article 197 no longer contains the documented 12% and 5% schedules.');
  }
  const tables = [...article.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map((match) => match[1] ?? '');
  if (tables.length !== 3) throw new GeorgiaBundleError('unexpected_tables', `Article 197 contains ${tables.length} tables; the documented consolidated structure has exactly 3.`);
  const rules = [
    ...tableRules(tables[0]!, '1', '12%'),
    ...tableRules(tables[1]!, '2', '5%'),
    ...tableRules(tables[2]!, '3'),
    { code: '8703', description: 'Motor cars under heading 8703', duty_expression: 'GEL 0.05 per cm³ of engine displacement + 5% of the import duty amount for each year of the motor car’s operation', paragraph: '6' as const },
  ];
  if (rules.filter((rule) => rule.paragraph === '1').length < 150 || rules.filter((rule) => rule.paragraph === '2').length < 30 || rules.filter((rule) => rule.paragraph === '3').length !== 17) {
    throw new GeorgiaBundleError('incomplete_article', 'Article 197 tables are incomplete relative to the documented consolidated legal structure.');
  }
  const articleText = decodeHtml(article);
  const amendments = [...articleText.matchAll(/Law of Georgia No\s+[^-]+-\s*website,\s*\d{1,2}\.\d{1,2}\.\d{4}/gi)].map((match) => match[0]);
  const checksum = createHash('sha256').update(args.bytes).digest('hex');
  return {
    checksum, size_bytes: args.bytes.length,
    files: [{ name: `georgia-tax-code-${args.release_identifier}.html`, sha256: checksum, size_bytes: args.bytes.length, role: 'official_consolidated_legal_text' }],
    release_identifier: args.release_identifier, source_url: args.source_url, rules,
    residual_duty_expression: '0%', article_amendments: amendments, reader_version: GEORGIA_BUNDLE_READER_VERSION,
  };
}

const empty = (kind: ParsedDuty['kind'], expression: string, note: string | null): ParsedDuty => ({ kind, ad_valorem_rate_percent: null, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null, expression, note });

export function parseGeorgiaDuty(raw: string | null | undefined): ParsedDuty {
  const expression = (raw ?? '').trim();
  if (!expression) return empty('none', expression, 'The source published no duty expression.');
  const percent = /^(\d+(?:\.\d+)?)%$/.exec(expression);
  if (percent) return { ...empty('ad_valorem', expression, null), ad_valorem_rate_percent: Number(percent[1]) };
  const perLitre = /^(\d+(?:\.\d+)?)\s*euro\s*\/\s*l$/i.exec(expression);
  if (perLitre) return { ...empty('specific', expression, null), specific_amount: Number(perLitre[1]), specific_currency: 'EUR', specific_unit: 'L', specific_unit_quantity: 1 };
  const alcohol = /^(\d+(?:\.\d+)?)\s*euro\s*\/\s*l\s*\/\s*HL$/i.exec(expression);
  if (alcohol) return { ...empty('specific', expression, 'The statutory formula multiplies this EUR amount by alcohol percentage per hectolitre; it is not converted to an ad-valorem rate.'), specific_amount: Number(alcohol[1]), specific_currency: 'EUR', specific_unit: '%VOL/HL', specific_unit_quantity: 1 };
  if (/^euro\s*\/\s*l$/i.test(expression)) return empty('unparsed', expression, 'The official English consolidated table omits the numeric amount for this row; absence is not interpreted as zero.');
  if (/GEL/i.test(expression) && /\+/.test(expression)) return empty('compound', expression, 'Vehicle formula: both engine-displacement and vehicle-age components are retained; transaction inputs are required to calculate it.');
  return empty('unparsed', expression, 'Duty expression is not in a recognised Article 197 form and is retained verbatim.');
}

function candidate(rule: GeorgiaTariffRule, code: string, effective: Date): CandidateTariffLine {
  return { national_tariff_code: code, description: rule.description, declarable: true, effective_from: effective, effective_to: null, general_duty: parseGeorgiaDuty(rule.duty_expression), control_codes: [], preference_area_ids: [] };
}

export function buildGeorgiaMarketAccess(args: { bundle: GeorgiaAuthorityTextBundle; release_id: string; release_reference_date: Date; retrieved_at: Date; hs6: string; at: Date; origin_country?: string; parser_version?: string }): MarketAccessIngestResult {
  const origin = (args.origin_country ?? 'IN').trim().toUpperCase();
  const covering = args.bundle.rules.filter((rule) => args.hs6.startsWith(rule.code));
  const descendants = args.bundle.rules.filter((rule) => rule.code.length > 6 && rule.code.startsWith(args.hs6));
  const longest = covering.sort((a, b) => b.code.length - a.code.length)[0];
  let candidates: CandidateTariffLine[];
  let resolution: ClassificationResolutionResult;
  if (descendants.length) {
    candidates = descendants.map((rule) => candidate(rule, rule.code, args.release_reference_date));
    resolution = {
      resolution: 'classification_refinement_required', resolved_line: null, candidates,
      candidate_count: candidates.length,
      differences: ['Article 197 lists one or more national sub-lines below this HS6 while unlisted classifications retain the statutory residual 0% treatment.'],
      reason: 'The exact Georgian national classification must be established before choosing an enumerated exception or the residual rate.',
    };
  } else if (longest) {
    candidates = [candidate(longest, args.hs6, args.release_reference_date)];
    resolution = resolveNationalTariffLine(candidates);
  } else {
    const residual: GeorgiaTariffRule = { code: args.hs6, description: 'Goods not enumerated in Article 197 paragraphs 1, 2, 3 or 6', duty_expression: args.bundle.residual_duty_expression, paragraph: '1' };
    candidates = [candidate(residual, args.hs6, args.release_reference_date)];
    resolution = resolveNationalTariffLine(candidates);
  }
  const relevant = descendants.length ? descendants : longest ? [longest] : [];
  const lines: MarketAccessLineRecord[] = (relevant.length ? relevant : [{ code: args.hs6, description: 'Residual Article 197 treatment', duty_expression: '0%', paragraph: '1' as const }]).map((rule) => ({
    national_tariff_code: rule.code.length <= 6 ? args.hs6 : rule.code, description: rule.description, declarable: true,
    measure_kind: 'third_country_duty', origin_geographic_area_id: 'ARTICLE_197', origin_scope: 'erga_omnes', applies_to_origin_country: origin,
    duty: parseGeorgiaDuty(rule.duty_expression), conditions: { article: 197, paragraph: rule.paragraph, legal_code_scope: rule.code, residual: relevant.length === 0 },
    effective_from: args.release_reference_date, effective_to: null,
    source_reference: `${args.bundle.source_url} · Article 197(${rule.paragraph}) · code ${rule.code}`,
    raw_measure: rule,
  }));
  const parserVersion = args.parser_version ?? GEORGIA_PARSER_VERSION;
  return {
    jurisdiction: 'GE', country_code: 'GE', hs6: args.hs6,
    hs_revision: `Georgia National Commodity Nomenclature scopes in consolidated Tax Code release ${args.bundle.release_identifier}`,
    provider: GEORGIA_PROVIDER, source_authority: GEORGIA_SOURCE_AUTHORITY, source_dataset: GEORGIA_SOURCE_DATASET,
    source_dataset_version: args.bundle.release_identifier, source_reference: `${args.bundle.source_url} (sha256 ${args.bundle.checksum})`,
    national_code_system: 'GE_TAX_CODE', parser_version: parserVersion, source_release_id: args.release_id,
    request_identity: `origin=${origin};as_of=${args.at.toISOString().slice(0, 10)}`, retrieved_at: args.retrieved_at,
    evidence_class: 'authoritative_public', recorded_by_id: null, resolution,
    general_duty: resolution.resolved_line?.general_duty ?? null,
    india_preference: origin !== 'IN'
      ? { applicability: 'not_applicable', duty: null, geographic_area_id: null, basis: `The requested origin is ${origin}, not India.` }
      : { applicability: 'unknown', duty: null, geographic_area_id: null, basis: 'Article 197 is the general import-duty schedule and does not enumerate preference beneficiaries; it does not establish a Georgia–India preference or prove that none exists.' },
    lines, requirements: [], regulatory_coverage_complete: false,
    raw_evidence: { authority_release_id: args.release_id, release_identifier: args.bundle.release_identifier, release_reference_date: args.release_reference_date.toISOString(), bundle_sha256: args.bundle.checksum, reader_version: args.bundle.reader_version, parser_version: parserVersion, origin_country: origin, matched_rules: relevant, article_amendments: args.bundle.article_amendments },
  };
}
