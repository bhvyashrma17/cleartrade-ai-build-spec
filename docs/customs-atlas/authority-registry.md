# Customs Atlas — authority research registry

Research artifact only. Nothing here is wired into the running application, no schema was added,
and no source is registered for production use. This is the evidence base for deciding which
authority integrations to build, in what order — see `implementation-waves.md` for the actual
recommendation.

Companion files in this directory:

- `authority-registry.json` — the detailed record for every authority/source family actually
  researched in this pass (~30 entries), in the schema below.
- `destination-universe.json` — every one of the 120+ destinations in scope, each mapped to a
  source family or marked explicitly unresolved. Deliberately lighter-weight than the registry:
  a destination inherits its family's registry entry, or stands alone with `research_status:
  "unresolved"` when nothing has been verified about it yet.
- `source-families.md` — the regional-bloc research (EU, MERCOSUR, GCC, ECOWAS, EAC, SACU, EAEU,
  and ASEAN, discovered along the way).
- `coverage-optimizer.md` — the build-priority scoring model and its outputs.
- `implementation-waves.md` — authority packs, waves, and the canary recommendation.
- `licensing-risks.md` — the licensing findings collected across every source, in one place.

## How this was researched

Every claim in `authority-registry.json` was obtained from a search against the authority's own
site or a source directly quoting it — never a GitHub mirror, never a paid aggregator's marketing
page treated as if it were the primary authority. Where a search could not settle a question
(most often: the exact licence text, or whether an API exists versus a downloadable file), the
field is `"unresolved"`, not a guess. Absence of a documented interface is recorded as
`acquisition_tier: "D_blocked"` or `"C_manual_authoritative"` — never silently upgraded to
`"A_machine"` because a country is important.

This pass covers the authorities that matter for the Wave 1–2 decision in
`implementation-waves.md` deeply, and records everything else in `destination-universe.json` at
whatever depth the search actually reached — most of the long tail is `research_status:
"unresolved"` by design. Reaching "confirmed" for a destination not covered here is exactly the
kind of task a future pass — or the first engineer opening that specific authority pack — should
do before writing a connector, not something to fabricate now.

## Registry schema

Documentation only — this block is markdown, not a `.ts` file, so it is not picked up by
`tsc`/ESLint. `authority-registry.json` and `destination-universe.json` conform to it structurally.

```typescript
type AcquisitionTier = 'A_machine' | 'B_structured_web' | 'C_manual_authoritative' | 'D_blocked';

type TariffSourceType =
  | 'api' | 'json' | 'xml' | 'csv' | 'xlsx' | 'zip' | 'database'
  | 'structured_html' | 'pdf' | 'manual_release';

/** Never boolean. An unverified permission is not the same fact as a denied one. */
type RightsStatus = 'permitted' | 'permitted_with_attribution' | 'unresolved' | 'restricted' | 'not_applicable';

type ResearchStatus = 'confirmed' | 'partial' | 'unresolved' | 'blocked';

/** unknown must never collapse to false. */
type ModuleCoverage = 'strong' | 'partial' | 'none_found' | 'unknown';

interface AuthorityRecord {
  destination_country: string;          // display name
  destination_iso2: string | null;      // null for a source-family record covering many
  destination_iso3: string | null;

  source_family: string;                // e.g. "EU_TARIC", "GCC", "national"
  customs_union_or_regional_family: string | null;

  authority_name: string;
  authority_type: 'national_customs' | 'national_revenue_tax_authority' | 'regional_body' | 'ministry_of_trade';

  official_tariff_url: string | null;
  official_nomenclature_url: string | null;
  official_preference_url: string | null;
  official_roo_url: string | null;
  official_quota_url: string | null;
  official_trade_remedy_url: string | null;
  official_regulatory_urls: string[];

  tariff_source_type: TariffSourceType;
  acquisition_tier: AcquisitionTier;

  national_tariff_line_depth: string | null;  // e.g. "8-digit NCM", "12-digit HS"
  hs_revision: string | null;

  mfn_coverage: ModuleCoverage;
  india_preference_coverage: ModuleCoverage;
  roo_coverage: ModuleCoverage;
  quota_remedy_coverage: ModuleCoverage;
  import_control_coverage: ModuleCoverage;
  certification_coverage: ModuleCoverage;

  supports_ad_valorem: boolean | 'unknown';
  supports_specific: boolean | 'unknown';
  supports_compound: boolean | 'unknown';
  supports_mixed: boolean | 'unknown';
  supports_zero: boolean | 'unknown';
  supports_quota_conditioned: boolean | 'unknown';

  effective_date_support: ModuleCoverage;
  historical_version_support: ModuleCoverage;
  source_fingerprint_support: ModuleCoverage;

  update_cadence: string | null;         // e.g. "annual", "as-needed", "daily"
  automation_feasibility: 'high' | 'medium' | 'low';

  commercial_use_status: RightsStatus;
  automated_access_status: RightsStatus;
  raw_cache_status: RightsStatus;
  customer_display_status: RightsStatus;
  redistribution_status: RightsStatus;
  licence_name: string | null;
  licence_url_or_reference: string | null;
  licensing_notes: string;

  authority_quality: 'high' | 'medium' | 'low';
  machine_readability: 'high' | 'medium' | 'low';
  licensing_certainty: 'high' | 'medium' | 'low' | 'blocked';
  maintenance_risk: 'high' | 'medium' | 'low';
  estimated_engineering_effort: 'high' | 'medium' | 'low';

  destinations_unlocked: number;

  research_status: ResearchStatus;
  notes: string;
  evidence_references: string[];
}
```
