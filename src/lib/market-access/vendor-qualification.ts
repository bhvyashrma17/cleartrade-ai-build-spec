/**
 * Provider-neutral vendor qualification harness (Confidence Closure Step 2C).
 *
 * Every future connector — e2open, Descartes, Avalara, or anyone else — must normalize its raw
 * response into the exact `MarketAccessIngestResult` shape `contract.ts` already defines for
 * authoritative and manual-authoritative providers. This module asks nothing vendor-specific: it
 * takes whatever came out of that normalization, from a captured fixture or a live sandbox call,
 * and grades it against the same defects that disqualified UNCTAD TRAINS in Step 2
 * (docs/33-global-tariff-source-contract.md) — a specific duty collapsed into a percentage, a
 * missing tariff reported as zero, a preference inferred merely because a scheme exists, a row
 * with no traceable source or effective date.
 *
 * Passing every technical check proves the DATA is representable, not that ClearTrade is
 * permitted to use it. Licensing, redistribution rights and a regulatory-completeness warranty
 * are legal and commercial facts no fixture can establish, so this module never approves a
 * vendor and never writes to `licensed-providers.ts`'s registry. It produces a report a human
 * completes and signs off.
 */
import type { MarketAccessIngestResult, MarketAccessLineRecord } from './contract';
import type { ParsedDuty } from './tariff-semantics';

export const VENDOR_QUALIFICATION_HARNESS_VERSION = 'vendor-qualification-harness-v1' as const;

export interface VendorQualificationCheck {
  code: string;
  label: string;
  passed: boolean;
  detail: string;
}

/**
 * What a candidate looks like before qualification: either an already-normalized ingest result
 * (a captured fixture, or the output of a completed adapter call), or a function that produces
 * one — the connection point for a real sandbox call once a vendor adapter exists. The harness
 * itself never knows which it received.
 */
export type VendorCandidateSource = MarketAccessIngestResult | (() => Promise<MarketAccessIngestResult>);

export async function resolveVendorCandidate(source: VendorCandidateSource): Promise<MarketAccessIngestResult> {
  return typeof source === 'function' ? await source() : source;
}

const ISO2 = /^[A-Z]{2}$/;
const HS6 = /^\d{6}$/;

function looksStatistical(text: string | null | undefined): boolean {
  if (!text) return false;
  return /simple[\s_-]*average|mean[\s_-]*rate|statistical[\s_-]*average|avg\.?[\s_-]*rate/i.test(text);
}

// ---------------------------------------------------------------------------
// One check per required dimension. Each is a pure function of the candidate, so a check can be
// exercised in isolation without constructing a full ingest result for every scenario.
// ---------------------------------------------------------------------------

function checkSpecificDuty(duty: ParsedDuty | null): VendorQualificationCheck {
  const code = 'specific_duty_representation';
  const label = 'Specific duty carries its own amount, currency and unit';
  if (!duty || duty.kind !== 'specific') return { code, label, passed: true, detail: 'Not a specific duty in this candidate.' };
  const complete = duty.specific_amount != null && duty.specific_currency != null && duty.specific_unit != null;
  // The exact TRAINS defect: a specific duty that also carries a percentage is one that has been
  // collapsed into an ad-valorem figure somewhere upstream.
  const notSubstituted = duty.ad_valorem_rate_percent == null;
  const passed = complete && notSubstituted;
  return {
    code, label, passed,
    detail: passed
      ? `${duty.specific_amount} ${duty.specific_currency} / ${duty.specific_unit_quantity ?? 1} ${duty.specific_unit}`
      : !complete
        ? 'A specific duty is missing amount, currency or unit.'
        : 'A specific duty also carries an ad-valorem percentage — it has been substituted, not represented.',
  };
}

function checkAdValoremDuty(duty: ParsedDuty | null): VendorQualificationCheck {
  const code = 'ad_valorem_duty_representation';
  const label = 'Ad-valorem duty carries a percentage and nothing else';
  if (!duty || duty.kind !== 'ad_valorem') return { code, label, passed: true, detail: 'Not an ad-valorem duty in this candidate.' };
  const passed = duty.ad_valorem_rate_percent != null && duty.specific_amount == null;
  return { code, label, passed, detail: passed ? `${duty.ad_valorem_rate_percent}%` : 'An ad-valorem duty is missing its percentage or carries a specific amount too.' };
}

function checkDutyFreeVsMissing(candidate: MarketAccessIngestResult): VendorQualificationCheck {
  const code = 'duty_free_vs_missing';
  const label = 'An explicit zero duty is distinguishable from no duty found';
  const duty = candidate.general_duty;
  const resolved = candidate.resolution.resolved_line != null;
  // Missing is honest: a line resolved, but no duty was published for it, and the candidate says
  // so by leaving general_duty null rather than inventing a zero.
  if (resolved && duty == null) return { code, label, passed: true, detail: 'A resolved line with no duty is reported as missing, not zero.' };
  if (duty == null) return { code, label, passed: true, detail: 'No line resolved; no duty asserted either.' };
  // An explicit zero must be traceable to a real duty-free expression, not a fallback default —
  // this is what a note-free, unparsed-adjacent zero would look like.
  if (duty.kind === 'ad_valorem' && duty.ad_valorem_rate_percent === 0) {
    const passed = duty.expression.trim().length > 0;
    return { code, label, passed, detail: passed ? `Explicit duty-free: "${duty.expression}"` : 'A zero duty carries no verbatim expression to trace it to.' };
  }
  return { code, label, passed: true, detail: `Non-zero duty of kind ${duty.kind}.` };
}

function checkCompoundMixedDuty(duty: ParsedDuty | null): VendorQualificationCheck {
  const code = 'compound_mixed_duty_representation';
  const label = 'Compound/mixed duty keeps its verbatim expression instead of a fabricated scalar';
  if (!duty || (duty.kind !== 'compound' && duty.kind !== 'mixed')) return { code, label, passed: true, detail: 'Not a compound or mixed duty in this candidate.' };
  // A compound duty has no single number that means the whole thing. Reducing it to one — either
  // component — is the same substitution defect as the specific-duty case.
  const noFabricatedScalar = duty.ad_valorem_rate_percent == null && duty.specific_amount == null;
  const hasExpression = duty.expression.trim().length > 0;
  const passed = noFabricatedScalar && hasExpression;
  return {
    code, label, passed,
    detail: passed ? `Kept verbatim: "${duty.expression}"` : noFabricatedScalar ? 'A compound/mixed duty carries no verbatim expression.' : 'A compound/mixed duty has been reduced to a single fabricated number.',
  };
}

function checkNationalTariffLineIdentity(candidate: MarketAccessIngestResult): VendorQualificationCheck {
  const code = 'national_tariff_line_identity';
  const label = 'Resolved evidence names a real declarable national line, not only HS6';
  const resolved = candidate.resolution.resolved_line;
  if (candidate.resolution.resolution === 'unavailable' || candidate.resolution.resolution === 'classification_refinement_required') {
    return { code, label, passed: true, detail: `Resolution is ${candidate.resolution.resolution}; no line is asserted, which is correct.` };
  }
  const passed = resolved != null && resolved.national_tariff_code.trim().length > 0 && resolved.declarable === true;
  return { code, label, passed, detail: passed ? resolved!.national_tariff_code : 'Resolution claims a line without a declarable national tariff code.' };
}

function checkHsRevision(candidate: MarketAccessIngestResult): VendorQualificationCheck {
  const code = 'hs_revision';
  const label = 'HS revision is stated and the HS6 matches it';
  const passed = candidate.hs_revision.trim().length > 0 && HS6.test(candidate.hs6);
  return { code, label, passed, detail: passed ? `${candidate.hs6} under ${candidate.hs_revision}` : 'HS revision is blank or HS6 is not a bare six-digit code.' };
}

function checkOriginCountry(candidate: MarketAccessIngestResult): VendorQualificationCheck {
  const code = 'origin_country_identity';
  const label = 'A country-scoped preference line names a real ISO origin, never a vague one';
  const countryScoped = candidate.lines.filter((line) => line.origin_scope === 'country');
  if (!countryScoped.length) return { code, label, passed: true, detail: 'No country-scoped line in this candidate.' };
  const passed = countryScoped.every((line) => line.applies_to_origin_country != null && ISO2.test(line.applies_to_origin_country));
  return { code, label, passed, detail: passed ? countryScoped.map((line) => line.applies_to_origin_country).join(', ') : 'A country-scoped line is missing a valid ISO alpha-2 origin.' };
}

function checkPreferenceRegime(candidate: MarketAccessIngestResult): VendorQualificationCheck {
  const code = 'preference_regime_identity';
  const label = 'A preferential line names the regime it comes from, with a citable reference';
  const preferential = candidate.lines.filter((line) => line.measure_kind === 'tariff_preference');
  if (!preferential.length) return { code, label, passed: true, detail: 'No preferential line in this candidate.' };
  const passed = preferential.every((line) => line.description.trim().length > 0 && line.source_reference.trim().length > 0);
  return { code, label, passed, detail: passed ? `${preferential.length} preferential line(s), each named and cited.` : 'A preferential line has no regime description or source reference.' };
}

function checkOriginEligibilityStates(candidate: MarketAccessIngestResult): VendorQualificationCheck {
  const code = 'origin_eligibility_determination';
  const label = 'Preference eligibility is proved, disproved, unresolved, or absent — never assumed';
  const preference = candidate.india_preference;
  if (preference.applicability === 'confirmed_applicable') {
    // The one case this task exists to guard: a scheme existing is not eligibility. Confirmed
    // applicability must be backed by an actual duty and a stated basis, not merely asserted.
    const passed = preference.duty != null && preference.basis.trim().length > 0;
    return { code, label, passed, detail: passed ? `Confirmed applicable on: ${preference.basis}` : 'Applicability is confirmed_applicable with no duty or basis to back it — inferred, not proved.' };
  }
  if (preference.applicability === 'not_applicable' || preference.applicability === 'potentially_applicable_requires_origin_proof') {
    const passed = preference.basis.trim().length > 0;
    return { code, label, passed, detail: passed ? preference.basis : `Applicability is ${preference.applicability} with no stated basis.` };
  }
  return { code, label, passed: true, detail: 'Applicability is unknown, which is the honest reading absent evidence.' };
}

function checkEffectiveDates(candidate: MarketAccessIngestResult): VendorQualificationCheck {
  const code = 'effective_dates';
  const label = 'A resolved duty carries a real start date, and no line is dated in the future';
  const resolved = candidate.resolution.resolved_line;
  if (candidate.general_duty && (!resolved || resolved.effective_from == null)) {
    return { code, label, passed: false, detail: 'A duty is asserted without an effective_from date on the resolved line.' };
  }
  const future = candidate.lines.filter((line) => line.effective_from != null && line.effective_from.getTime() > candidate.retrieved_at.getTime());
  const passed = future.length === 0;
  return { code, label, passed, detail: passed ? 'No line is effective after its own retrieval.' : `${future.length} line(s) claim to take effect after they were retrieved.` };
}

function checkSourceAuthorityAttribution(candidate: MarketAccessIngestResult): VendorQualificationCheck {
  const code = 'source_authority_attribution';
  const label = 'Every line cites the authority it reproduces and a specific reference, not just the vendor';
  const topLevel = candidate.source_authority.trim().length > 0 && candidate.source_reference.trim().length > 0;
  const perLine = candidate.lines.every((line) => line.source_reference.trim().length > 0);
  const passed = topLevel && perLine;
  return {
    code, label, passed,
    detail: passed ? `${candidate.source_authority}, ${candidate.lines.length} line(s) each cited.` : !topLevel ? 'Missing top-level source authority or reference.' : 'At least one line has no source reference of its own.',
  };
}

function checkStableSourceVersion(candidate: MarketAccessIngestResult): VendorQualificationCheck {
  const code = 'stable_source_version_identifier';
  const label = 'A stable dataset/version identifier exists to re-derive this exact row later';
  const passed = candidate.source_dataset.trim().length > 0 && candidate.source_dataset_version != null && candidate.source_dataset_version.trim().length > 0 && candidate.parser_version.trim().length > 0;
  return { code, label, passed, detail: passed ? `${candidate.source_dataset}@${candidate.source_dataset_version} via ${candidate.parser_version}` : 'Dataset, dataset version or parser version is missing — this row could not be traced back to a specific release.' };
}

function checkRegulatoryCompletenessMetadata(candidate: MarketAccessIngestResult): VendorQualificationCheck {
  const code = 'regulatory_completeness_metadata';
  const label = 'Regulatory completeness is an explicit claim, never assumed from silence';
  // The field must exist and be a real boolean; `undefined`/non-boolean would mean the adapter
  // never actually asked the question, which is worse than answering it false.
  const passed = typeof candidate.regulatory_coverage_complete === 'boolean';
  return {
    code, label, passed,
    detail: passed
      ? candidate.regulatory_coverage_complete
        ? 'Vendor claims complete regulatory coverage for this scope.'
        : 'Vendor does not claim complete regulatory coverage — absence of a requirement here proves nothing.'
      : 'regulatory_coverage_complete is not an explicit boolean.',
  };
}

function checkTariffQuotaRepresentation(candidate: MarketAccessIngestResult): VendorQualificationCheck {
  const code = 'tariff_quota_representation';
  const label = 'A quota-linked measure is flagged as a quota, never presented as an unconditional rate';
  const quotaLines = candidate.lines.filter((line) => line.measure_kind === 'tariff_quota');
  if (!quotaLines.length) return { code, label, passed: true, detail: 'No quota-linked measure in this candidate.' };
  // A quota is a volume entitlement, not a rate anyone is guaranteed. If any quota line is the
  // one backing a confirmed_applicable determination, the entitlement has been read as certain.
  const quotaCodes = new Set(quotaLines.map((line) => line.national_tariff_code));
  const wronglyConfirmed = candidate.india_preference.applicability === 'confirmed_applicable'
    && candidate.resolution.resolved_line != null
    && quotaCodes.has(candidate.resolution.resolved_line.national_tariff_code);
  return { code, label, passed: !wronglyConfirmed, detail: wronglyConfirmed ? 'A quota-linked line backs a confirmed_applicable determination — a quota is never unconditional.' : `${quotaLines.length} quota line(s), correctly not treated as confirmed.` };
}

function checkNotStatisticalAverage(candidate: MarketAccessIngestResult): VendorQualificationCheck {
  const code = 'not_a_statistical_average';
  const label = 'Evidence is a duty of record, never a simple-average tariff statistic';
  const duty = candidate.general_duty;
  const suspect = looksStatistical(duty?.note ?? null) || looksStatistical(duty?.expression ?? null) || looksStatistical(candidate.source_dataset);
  return { code, label, passed: !suspect, detail: suspect ? 'The duty or dataset self-describes as an average/statistical measure — this is TRAINS’s defect, not a duty of record.' : 'No statistical-average marker found.' };
}

export interface VendorTechnicalQualification {
  provider: string;
  scenario: string;
  checks: readonly VendorQualificationCheck[];
  passed: boolean;
}

/** Run every structural/anti-pattern check against one normalized candidate. */
export function runTechnicalQualification(candidate: MarketAccessIngestResult, scenario = 'unlabelled'): VendorTechnicalQualification {
  const checks: VendorQualificationCheck[] = [
    checkSpecificDuty(candidate.general_duty),
    checkAdValoremDuty(candidate.general_duty),
    checkDutyFreeVsMissing(candidate),
    checkCompoundMixedDuty(candidate.general_duty),
    checkNationalTariffLineIdentity(candidate),
    checkHsRevision(candidate),
    checkOriginCountry(candidate),
    checkPreferenceRegime(candidate),
    checkOriginEligibilityStates(candidate),
    checkEffectiveDates(candidate),
    checkSourceAuthorityAttribution(candidate),
    checkStableSourceVersion(candidate),
    checkRegulatoryCompletenessMetadata(candidate),
    checkTariffQuotaRepresentation(candidate),
    checkNotStatisticalAverage(candidate),
  ];
  return { provider: candidate.provider, scenario, checks, passed: checks.every((check) => check.passed) };
}

export async function qualifyVendorCandidate(source: VendorCandidateSource, scenario = 'unlabelled'): Promise<VendorTechnicalQualification> {
  return runTechnicalQualification(await resolveVendorCandidate(source), scenario);
}

// ---------------------------------------------------------------------------
// The qualification report. Only `technical_pass` is ever computed by this harness. Every other
// dimension is a legal, commercial or operational fact that must be supplied by a human who has
// actually done that work — a fixture cannot prove a licence exists.
// ---------------------------------------------------------------------------

export interface VendorQualificationReport {
  provider: string;
  contract_version: typeof VENDOR_QUALIFICATION_HARNESS_VERSION;
  /** Computed: every technical scenario run against this provider passed every check. */
  technical_pass: boolean;
  technical_results: readonly VendorTechnicalQualification[];
  /** Supplied: written commercial-use and redistribution permission is recorded and verifiable. */
  licensing_pass: boolean | null;
  /** Supplied: the licence explicitly permits surfacing derived results to ClearTrade's customers. */
  redistribution_pass: boolean | null;
  /** Supplied: the vendor contractually warrants complete regulatory coverage for the intended scope. */
  regulatory_completeness_pass: boolean | null;
  /** Supplied: destinations the vendor actually covers at the resolution ClearTrade needs. */
  coverage: { destinations_covered: number; national_line_resolution: boolean } | null;
  /** Supplied: whether pricing is public or requires sales engagement, and the outcome if known. */
  pricing: { requires_sales_contact: boolean; note: string } | null;
  /** Supplied: whether a sandbox or trial environment was actually used to produce technical_results. */
  sandbox: { available: boolean; used_for_technical_results: boolean } | null;
  /**
   * Never 'approved' from this module alone. Approval additionally requires a human to add an
   * entry to `licensed-providers.ts`'s registry — this field only says whether the evidence
   * assembled so far supports that decision.
   */
  final_status: 'not_qualified' | 'technically_qualified_pending_commercial_review' | 'disqualified';
  notes: string;
}

export function buildQualificationReport(input: {
  provider: string;
  technical_results: readonly VendorTechnicalQualification[];
  licensing_pass?: boolean | null;
  redistribution_pass?: boolean | null;
  regulatory_completeness_pass?: boolean | null;
  coverage?: VendorQualificationReport['coverage'];
  pricing?: VendorQualificationReport['pricing'];
  sandbox?: VendorQualificationReport['sandbox'];
  notes?: string;
}): VendorQualificationReport {
  const attempted = input.technical_results.length > 0;
  const technicalPass = attempted && input.technical_results.every((result) => result.passed);
  // Licensing and redistribution rights are absolute: without them nothing else matters, however
  // clean the data is. Regulatory completeness is not absolute in the same way — a vendor with no
  // completeness warranty is simply unusable for the regulatory 40%, not disqualified outright,
  // so it is carried as information rather than folded into the pass/fail gate.
  const legallyBlocked = input.licensing_pass === false || input.redistribution_pass === false;
  const finalStatus: VendorQualificationReport['final_status'] = legallyBlocked || (attempted && !technicalPass)
    ? 'disqualified'
    : technicalPass && input.licensing_pass === true && input.redistribution_pass === true
      ? 'technically_qualified_pending_commercial_review'
      : 'not_qualified';

  return {
    provider: input.provider,
    contract_version: VENDOR_QUALIFICATION_HARNESS_VERSION,
    technical_pass: technicalPass,
    technical_results: input.technical_results,
    licensing_pass: input.licensing_pass ?? null,
    redistribution_pass: input.redistribution_pass ?? null,
    regulatory_completeness_pass: input.regulatory_completeness_pass ?? null,
    coverage: input.coverage ?? null,
    pricing: input.pricing ?? null,
    sandbox: input.sandbox ?? null,
    final_status: finalStatus,
    notes: input.notes ?? '',
  };
}

/**
 * A blank report for a provider nobody has evaluated yet — the shape a qualification effort
 * starts from. `final_status` is 'not_qualified' because every field is unknown, not because
 * anything failed.
 */
export function blankQualificationReport(provider: string): VendorQualificationReport {
  return buildQualificationReport({ provider, technical_results: [], notes: 'No qualification attempt recorded yet.' });
}

// Exported for MarketAccessLineRecord typing convenience in fixtures/tests.
export type { MarketAccessIngestResult, MarketAccessLineRecord };
