/**
 * Warehouse discovery engine — ranks markets from ingested Comtrade trade flows.
 *
 * Replaces `MockDiscoveryEngine` as the default. The `DiscoveryEngine` interface is
 * unchanged, so no route, job handler, or component knows this happened: docs/02's "don't
 * bind the frontend to an assumed AI provider or algorithm" is what made the swap a
 * one-line change in `getDiscoveryEngine()`.
 *
 * Division of labour, and it is strict:
 *
 *   - **This file does IO.** It queries `TradeFlow`, assembles candidates, calls the pure
 *     scorer, and calls the rationale writer. It computes no scores of its own.
 *   - **`scoring.ts` does arithmetic.** Pure functions, no IO, no model.
 *   - **`rationale/` does prose.** Handed qualitative bands, never magnitudes.
 *
 * That split is what makes the two hard rules checkable rather than aspirational: the model
 * is never given a number to restate, and every number is produced by a function whose only
 * inputs are warehouse rows.
 *
 * ARCHITECTURAL BOUNDARY: this module reads `TradeFlow` and never returns a row of it.
 * What crosses back to the caller — and from there, through the job handler, to an API
 * response — is scores, bands, and aggregates derived from those rows. Raw flows are
 * Internal Use only under Comtrade's terms (see the model comment in prisma/schema.prisma).
 * Do not add a field to `MarketAssessmentDraft` that carries a row through.
 */

import { Prisma, TradeDataSource, TradeFlowDirection } from '@prisma/client';
import { INDIA_REPORTER, toIso2, WORLD_PARTNER } from '@/lib/comtrade/areas';
import { getConfigWithVersion } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import type { DiscoveryEngine, DiscoveryInput, DiscoveryResult, MarketAssessmentDraft } from './engine';
import { composeRationale } from './rationale';
import {
  scoreCandidate,
  type CandidateInput,
  type ExporterContext,
  type ScoredMarket,
  type ScoringRow,
} from './scoring';

/** Prisma returns Decimal; scoring works in numbers. Converted once, here, at the boundary. */
function toScoringRow(row: {
  reporter: string;
  partner: string;
  hs_code: string;
  year: number;
  value: Prisma.Decimal;
  quantity: Prisma.Decimal | null;
  unit_value: Prisma.Decimal | null;
  ingested_at: Date;
}): ScoringRow {
  return {
    reporter: row.reporter,
    partner: row.partner,
    hs_code: row.hs_code,
    year: row.year,
    value: row.value.toNumber(),
    quantity: row.quantity?.toNumber() ?? null,
    unit_value: row.unit_value?.toNumber() ?? null,
    ingested_at: row.ingested_at,
  };
}

export class WarehouseDiscoveryEngine implements DiscoveryEngine {
  readonly name = 'warehouse-v1';

  async rank(
    input: DiscoveryInput,
    signal?: { onProgress?: (pct: number) => void },
  ): Promise<DiscoveryResult> {
    const configured = await getConfigWithVersion('discovery.scoring');
    const policy = configured.value;
    const missing: string[] = [];

    // An HS code is what indexes the warehouse. Without one there is nothing to look up —
    // and inferring a code from free-text product description is a classification decision
    // with customs consequences, not a convenience this engine gets to make silently.
    // Truncate to six digits before querying. Indian exporters state ITC-HS codes, which
    // are 8-digit national extensions (e.g. 09103030 for turmeric powder); international
    // trade statistics are only published to the 6-digit HS subheading their first six
    // digits belong to (091030). Matching the raw 8-digit code against the warehouse finds
    // nothing — not "no demand", but a granularity mismatch that would silently return an
    // empty ranking for a perfectly well-specified product.
    const hsCode = (input.hs_code?.replace(/\D/g, '') ?? '').slice(0, 6);
    if (!hsCode) {
      return {
        assessments: [],
        partial: true,
        missing: ['No HS code was supplied, so trade data could not be looked up. Add an HS code and run again.'],
        provenance: { engine: this.name, source: 'comtrade', reason: 'no_hs_code' },
      };
    }

    signal?.onProgress?.(10);

    const rowSelect = {
      reporter: true, partner: true, hs_code: true, year: true,
      value: true, quantity: true, unit_value: true, ingested_at: true,
    } as const;

    type WarehouseRow = Prisma.TradeFlowGetPayload<{ select: typeof rowSelect }>;
    let effectiveScope = hsCode;
    const worldRows: WarehouseRow[] = await prisma.tradeFlow.findMany({
        where: {
          hs_code: hsCode,
          source: TradeDataSource.comtrade,
          flow_direction: TradeFlowDirection.import,
          partner: WORLD_PARTNER,
        },
        select: rowSelect,
      });

    if (worldRows.length === 0) {
      return {
        assessments: [],
        partial: true,
        missing: [`The trade warehouse holds no import data for HS ${hsCode} yet.`],
        provenance: { engine: this.name, source: 'comtrade', hs_scope: hsCode, reason: 'no_warehouse_data' },
      };
    }

    const scopeFilter = {
      hs_code: effectiveScope,
      source: TradeDataSource.comtrade,
      flow_direction: TradeFlowDirection.import,
    };

    signal?.onProgress?.(35);

    const byReporter = new Map<string, ScoringRow[]>();
    for (const row of worldRows) {
      const scoringRow = toScoringRow(row);
      const existing = byReporter.get(scoringRow.reporter);
      if (existing) existing.push(scoringRow);
      else byReporter.set(scoringRow.reporter, [scoringRow]);
    }

    // A caller-supplied country list restricts the search; countries with no warehouse data
    // are reported as gaps rather than silently dropped (docs/09 §3 partial semantics).
    const requested = (input.target_countries ?? []).map((c) => c.toUpperCase());
    const newestYearInRun = Math.max(...worldRows.map((r) => r.year));

    const candidates: CandidateInput[] = [];
    const eligibleReporters: string[] = [];

    for (const [reporter, rows] of byReporter) {
      const iso2 = toIso2(reporter);
      if (!iso2) {
        // Never guessed — see the note on `areas.ts`. An unmappable reporter is a declared
        // gap, not an invented country.
        missing.push(`Comtrade reporter ${reporter} has no verified ISO country mapping and was skipped.`);
        continue;
      }
      if (requested.length > 0 && !requested.includes(iso2)) continue;

      const latestYear = Math.max(...rows.map((r) => r.year));
      const latestTotal = rows.filter((r) => r.year === latestYear).reduce((sum, r) => sum + r.value, 0);
      if (latestTotal < policy.volume_floor_usd) continue;

      eligibleReporters.push(reporter);
      candidates.push({ reporter, country_code: iso2, totalRows: rows, indiaRows: [], supplierRowsLatestYear: [] });
    }

    for (const wanted of requested) {
      if (!candidates.some((c) => c.country_code === wanted)) {
        missing.push(`No trade data above the volume threshold for ${wanted}.`);
      }
    }

    if (candidates.length === 0) {
      return {
        assessments: [],
        partial: true,
        missing: missing.length ? missing : [`No market imports HS ${effectiveScope} above the ${policy.volume_floor_usd} USD threshold.`],
        provenance: { engine: this.name, source: 'comtrade', hs_scope: effectiveScope, reason: 'no_candidates_above_floor' },
      };
    }

    // --- Supporting facts: India's share, and the supplier base for HHI ---------
    const partnerRows = await prisma.tradeFlow.findMany({
      where: { ...scopeFilter, reporter: { in: eligibleReporters }, partner: { not: WORLD_PARTNER } },
      select: rowSelect,
    });

    for (const raw of partnerRows) {
      const row = toScoringRow(raw);
      const candidate = candidates.find((c) => c.reporter === row.reporter);
      if (!candidate) continue;

      if (row.partner === INDIA_REPORTER) candidate.indiaRows.push(row);

      const candidateLatestYear = Math.max(...candidate.totalRows.map((r) => r.year));
      // HHI is a snapshot of who supplies this market NOW; mixing years would blend a
      // supplier that exited with one that just arrived into a single meaningless share.
      if (row.year === candidateLatestYear) candidate.supplierRowsLatestYear.push(row);
    }

    signal?.onProgress?.(60);

    // --- Score -----------------------------------------------------------------
    // `input_snapshot` carries no price_target or capacity today (the EXP-04 input bar has
    // no such field, and adding one is outside this change's no-route-no-UI boundary).
    // Read them optionally so price fit begins contributing the moment they exist, and
    // reports itself unavailable — with a reason — until then.
    const context: ExporterContext = {
      price_target: (input as DiscoveryInput & { price_target?: number | null }).price_target ?? null,
      capacity: (input as DiscoveryInput & { capacity?: number | null }).capacity ?? null,
      lead_time_days: input.lead_time_days ?? null,
      desired_order_size_amount: input.desired_order_size_amount ?? null,
      desired_order_size_currency: input.desired_order_size_currency ?? null,
      customization_capability: input.customization_capability ?? null,
      packaging_capability: input.packaging_capability ?? null,
      moq_value: input.moq_value ?? null,
      moq_unit: input.moq_unit ?? null,
      certifications: input.certifications ?? [],
    };
    const exporterFitInputs = {
      order_size: context.desired_order_size_amount != null && context.desired_order_size_currency != null,
      certification: Boolean(context.certifications?.some((certification) => certification.status === 'held')),
      lead_time: context.lead_time_days != null,
      moq: context.moq_value != null && context.moq_unit != null,
    };
    const missingExporterFitInputs = Object.entries(exporterFitInputs).filter(([, present]) => !present).map(([name]) => name);
    const exporterFitInputConfidence = Math.round(((4 - missingExporterFitInputs.length) / 4) * 100);

    const allLatestTotals = candidates.map((c) => {
      const latestYear = Math.max(...c.totalRows.map((r) => r.year));
      return c.totalRows.filter((r) => r.year === latestYear).reduce((sum, r) => sum + r.value, 0);
    });

    const chapter = hsCode.slice(0, 2);
    const profileEntry = Object.entries(policy.archetype_profiles).find(([key, profile]) => key !== 'general' && profile.hs_chapters.includes(chapter)) ?? ['general', policy.archetype_profiles.general] as const;
    const [weightProfileKey, weightProfile] = profileEntry;
    const rules = await prisma.marketEligibilityRule.findMany({ where: { country_code: { in: candidates.map(c => c.country_code) }, is_active: true, OR: [{ effective_from: null }, { effective_from: { lte: new Date() } }], AND: [{ OR: [{ effective_to: null }, { effective_to: { gt: new Date() } }] }] } });
    const scored: ScoredMarket[] = [];
    const ineligible = new Map<string, typeof rules>();
    for (const candidate of candidates) {
      const applicable = rules.filter(rule => rule.country_code === candidate.country_code && (!rule.hs_code_prefix || hsCode.startsWith(rule.hs_code_prefix)));
      const held = new Set((context.certifications ?? []).filter(c => c.status === 'held').map(c => c.code.toUpperCase()));
      const blockers = applicable.filter(rule => rule.rule_type === 'sanctions_restricted' || rule.rule_type === 'import_prohibited' || (rule.rule_type === 'mandatory_certification' && rule.certification_obtainable === false && (!rule.required_certification || !held.has(rule.required_certification.toUpperCase()))));
      if (blockers.length) { ineligible.set(candidate.country_code, blockers); continue; }
      const result = scoreCandidate(candidate, allLatestTotals, newestYearInRun, context, policy, weightProfile.weights);
      if (result) scored.push(result);
      else missing.push(`${candidate.country_code} had no scoreable criteria and was excluded.`);
    }

    scored.sort((a, b) => b.overall_score - a.overall_score || a.country_code.localeCompare(b.country_code));
    signal?.onProgress?.(75);

    // --- Rationales ------------------------------------------------------------
    const productContext = input.description?.trim() || `HS ${effectiveScope}`;
    const assessments: MarketAssessmentDraft[] = [];
    let modelWriterUsed: string | null = null;
    let anyFellBack = false;

    for (const [index, market] of scored.entries()) {
      const rationale = await composeRationale(market, productContext, index < policy.rationale_top_n);
      if (index < policy.rationale_top_n) modelWriterUsed = rationale.writer;
      if (rationale.fell_back) anyFellBack = true;

      assessments.push({
        country_code: market.country_code,
        overall_score: market.overall_score,
        demand_score: market.demand.score,
        growth_score: market.growth.score,
        competition_score: market.competition.score,
        market_access_score: market.market_access.score,
        export_economics_score: market.export_economics.score,
        exporter_market_fit_score: market.exporter_market_fit.score,
        logistics_feasibility_score: market.logistics_feasibility.score,
        risk_resilience_score: market.risk_resilience.score,
        confidence_score: market.confidence_score,
        eligibility_status: 'eligible',
        eligibility_reasons: [],
        model_version: policy.model_version,
        weight_profile_key: weightProfileKey,
        weight_profile_version: weightProfile.version,
        india_share: market.india_share_pct,
        price_band_min: market.price_band?.min ?? null,
        price_band_max: market.price_band?.max ?? null,
        price_band_currency: market.price_band?.currency ?? null,
        // Tariffs, certification requirements, and logistics have no data source in this
        // system yet — MacMap and freight feeds come later. Returned as explicitly
        // unavailable rather than invented: EXP-05 already renders per-section "Data
        // unavailable" states, and a plausible guess here is worse than a blank, because an
        // exporter cannot tell a guess from a fact once it is on the page.
        tariff_summary: {
          status: 'unavailable',
          reason: 'Tariff data is not yet connected. Check the destination market’s current duty schedule before quoting.',
        },
        certification_requirements: [],
        logistics_summary: {
          status: 'unavailable',
          reason: 'Route, transit-time and freight-cost data is not yet connected.',
        },
        rationale: rationale.text,
        field_provenance: {
          overall_score: {
            source: 'comtrade',
            basis: `Weighted sum of the criteria below; weights applied: ${JSON.stringify(market.weights_applied)}.`,
          },
          demand_score: market.demand.provenance,
          growth_score: market.growth.provenance,
          competition_score: market.competition.provenance,
          india_share: market.india_share.provenance,
          price_band: market.price_band_provenance,
          market_access: market.market_access.provenance,
          export_economics: market.export_economics.provenance,
          exporter_market_fit: market.exporter_market_fit.provenance,
          logistics_feasibility: market.logistics_feasibility.provenance,
          risk_resilience: market.risk_resilience.provenance,
          confidence_score: { basis: 'Separate evidence-quality score from recency, reporting completeness, buyer coverage and component missingness.' },
          tariff_summary: { status: 'unavailable', reason: 'No tariff data source connected yet.' },
          certification_requirements: { status: 'unavailable', reason: 'No certification data source connected yet.' },
          logistics_summary: { status: 'unavailable', reason: 'No logistics data source connected yet.' },
          rationale: {
            source: 'generated',
            writer: rationale.writer,
            note: 'Prose is generated and carries no figures; every number in the rationale is computed from trade data.',
            ...(rationale.fell_back ? { fell_back_from_model: true, reason: rationale.fallback_reason } : {}),
          },
        },
      });
    }
    for (const [countryCode, blockers] of ineligible) assessments.push({ country_code: countryCode, overall_score: null, demand_score: null, growth_score: null, competition_score: null, market_access_score: null, export_economics_score: null, exporter_market_fit_score: null, logistics_feasibility_score: null, risk_resilience_score: null, confidence_score: 0, eligibility_status: 'ineligible', eligibility_reasons: blockers.map(rule => ({ type: rule.rule_type, source: rule.source, source_ref: rule.source_ref })), model_version: policy.model_version, weight_profile_key: weightProfileKey, weight_profile_version: weightProfile.version, tariff_summary: { status: 'unavailable', reason: 'Not evaluated after hard eligibility filter.' }, certification_requirements: [], logistics_summary: { status: 'unavailable', reason: 'Not evaluated after hard eligibility filter.' }, rationale: 'This destination is ineligible under a hard market-entry rule.', field_provenance: { eligibility: { source: 'eligibility_rules', rules: blockers.map(r => r.id) } } });

    signal?.onProgress?.(100);

    return {
      assessments,
      // Partial whenever anything was skipped — an exporter deciding on a shortlist needs
      // to know a country was dropped for lack of data rather than for lack of merit.
      partial: missing.length > 0,
      missing: missing.length ? missing : undefined,
      provenance: {
        engine: this.name,
        source: 'comtrade',
        generated: 'computed',
        hs_scope: effectiveScope,
        data_years: [...new Set(worldRows.map((r) => r.year))].sort(),
        newest_data_year: newestYearInRun,
        candidates_considered: byReporter.size,
        candidates_scored: assessments.length,
        volume_floor_usd: policy.volume_floor_usd,
        scoring_weights: weightProfile.weights,
        model_version: policy.model_version,
        config_version: configured.version,
        weight_profile_key: weightProfileKey,
        weight_profile_version: weightProfile.version,
        exporter_market_fit_input_confidence: exporterFitInputConfidence,
        exporter_market_fit_missing_inputs: missingExporterFitInputs,
        rationale_writer: modelWriterUsed ?? 'template-v1',
        ...(anyFellBack ? { rationale_fallback_used: true } : {}),
        note: 'Scores are computed from UN Comtrade trade flows held server-side. Tariff, certification and logistics data are not yet connected.',
      },
    };
  }
}
