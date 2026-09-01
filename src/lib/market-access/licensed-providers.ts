/**
 * What ClearTrade is permitted to rely on from a licensed commercial trade-content provider.
 *
 * A vendor such as e2open, Descartes or Avalara can reproduce a customs authority's tariff and
 * regulatory content faithfully, but it is a secondary distributor, not the authority. Filing its
 * output as `authoritative_public` would erase the difference between "the authority published
 * this" and "a vendor says the authority published this", which is the same blurring
 * `manual-authoritative.ts` exists to prevent. Licensed content therefore has its own assertion
 * class, and this registry decides when a row in that class may be relied upon at all.
 *
 * This is metadata about permissions, not a credential store and not a copy of a contract. It
 * holds no secrets, no keys and no legal documents — only the machine-checkable shape of what a
 * signed agreement allows. Provider API credentials belong in environment configuration, exactly
 * as every other provider's do.
 *
 * The registry is deliberately EMPTY. No provider has passed a sandbox test or a licensing
 * review, so no licensed evidence is admissible anywhere today, and adding the vocabulary changes
 * no country's confidence. Approval is a server-side decision recorded here and versioned in git;
 * nothing a browser sends can grant it.
 */

/** Which kind of assertion an approval covers. A tariff warranty is not a regulatory warranty. */
export type LicensedAssertionType = 'tariff' | 'regulatory' | 'rules_of_origin';

/**
 * How specific the provider's content is for a destination. A vendor that returns only HS6
 * averages cannot answer a declarable-line question, and must not be treated as though it can.
 */
export type LicensedResolution = 'national_tariff_line' | 'hs6_only';

export interface LicensedProviderApproval {
  /** Matches `MarketAccessEvidenceSnapshot.provider` exactly. */
  provider: string;
  /** The commercial agreement this approval reflects. Versioned so history stays explainable. */
  contract_version: string;
  /** Matches `MarketAccessEvidenceSnapshot.source_dataset`. One contract may cover several. */
  approved_datasets: readonly string[];
  /** Assertion types the agreement actually covers. Absence is not permission. */
  allowed_assertion_types: readonly LicensedAssertionType[];
  /** ISO alpha-2 destinations the agreement covers. Empty means none, never "all". */
  covered_countries: readonly string[];
  resolution: LicensedResolution;
  /**
   * True only when the provider contractually warrants that, for the covered scope, it publishes
   * the COMPLETE set of regulatory controls. Without this an absent requirement means "the vendor
   * did not tell us", never "no requirement exists" — see `phase-1h-calculations.ts`, where
   * regulatory coverage is usable only when completeness is proven.
   */
  regulatory_completeness_warranted: boolean;
  /** Whether the agreement permits surfacing derived results to ClearTrade's own customers. */
  redistribution_permitted: boolean;
  effective_from: string;
  /** Null while the agreement is open-ended. */
  effective_until: string | null;
}

/**
 * Bumped whenever the approval SHAPE or evaluation rules change, so a historical assessment can
 * record which policy admitted its evidence. Changing an approval later never rewrites history.
 */
export const LICENSED_PROVIDER_POLICY_VERSION = 'licensed-provider-approval-v1' as const;

/**
 * Approved providers. Empty until a provider passes both a sandbox contract test and a licensing
 * review. See docs/33-global-tariff-source-contract.md for what each candidate must satisfy.
 */
export const LICENSED_PROVIDER_APPROVALS: readonly LicensedProviderApproval[] = Object.freeze([]);

/** Providers ClearTrade knows to be commercial distributors rather than customs authorities. */
export const KNOWN_LICENSED_PROVIDERS: ReadonlySet<string> = new Set([
  'e2open',
  'descartes_customsinfo',
  'avalara',
]);

/**
 * Whether a snapshot came from a commercial distributor rather than the authority itself.
 *
 * Deliberately a positive list. An unrecognised provider is NOT assumed to be licensed content —
 * it is assumed to be whatever the ingesting connector declared it to be — because silently
 * reclassifying existing authoritative rows would rewrite the meaning of evidence already frozen
 * into historical assessments.
 */
export function isLicensedProvider(provider: string | null | undefined): boolean {
  return provider != null && KNOWN_LICENSED_PROVIDERS.has(provider.trim().toLowerCase());
}

export interface LicensedApprovalQuery {
  provider: string;
  dataset: string | null;
  country_code: string;
  assertion_type: LicensedAssertionType;
  /** The frozen assessment clock. An approval that had not started yet cannot admit evidence. */
  as_of: Date;
}

/**
 * The approval permitting this exact use, or null.
 *
 * Every dimension must match. A provider approved for tariffs in Japan grants nothing about
 * regulatory controls in Japan, and nothing at all about Brazil.
 */
export function licensedApprovalFor(query: LicensedApprovalQuery): LicensedProviderApproval | null {
  const provider = query.provider.trim().toLowerCase();
  const country = query.country_code.trim().toUpperCase();
  const asOf = query.as_of.getTime();

  for (const approval of LICENSED_PROVIDER_APPROVALS) {
    if (approval.provider.trim().toLowerCase() !== provider) continue;
    if (!approval.allowed_assertion_types.includes(query.assertion_type)) continue;
    if (!approval.covered_countries.some((code) => code.trim().toUpperCase() === country)) continue;
    // A dataset the contract does not name is not covered by it.
    if (query.dataset == null || !approval.approved_datasets.includes(query.dataset)) continue;
    if (Date.parse(approval.effective_from) > asOf) continue;
    if (approval.effective_until != null && Date.parse(approval.effective_until) <= asOf) continue;
    return approval;
  }
  return null;
}

/**
 * Why a licensed row may not be used, or null when it may.
 *
 * Returned as a reason string so the rejection appears in the calculation's excluded-fact record
 * rather than vanishing — a fact dropped without explanation is indistinguishable from one that
 * never existed.
 */
export function licensedAdmissionRejection(query: LicensedApprovalQuery): string | null {
  return licensedApprovalFor(query) == null
    ? `licensed_provider_not_approved_${query.assertion_type}`
    : null;
}
