/**
 * Versioned sanctions source contracts (Phase 2).
 *
 * Each entry is the explicit, auditable statement of *what we believe the authority
 * publishes and how*. It is versioned because a source contract changing is a compliance
 * event: a snapshot records which contract version produced it, so a schema change at the
 * provider shows up as "contract v1 no longer validates" rather than as an unexplained
 * drop in record count.
 *
 * PROVENANCE — every URL below was verified live against the authority's own domain
 * (see `scripts/verify-sanctions-live.ts`). No mirrors, no third-party redistributions,
 * no scraped search results.
 *
 * CREDENTIALS ARE NEVER STORED HERE. `auth` names an environment variable at most; the
 * value is read from the environment at request time and never persisted to the database
 * (Phase 2 explicitly forbids storing tokens in source metadata).
 */

export type SanctionsSource =
  | 'ofac_sdn'
  | 'ofac_non_sdn_consolidated'
  | 'un_security_council'
  | 'eu_financial_sanctions';

/**
 * Authority grouping. OFAC publishes TWO separate sanctions artifacts, and "OFAC coverage"
 * is only meaningful as the aggregate of both — see the Non-SDN contract note.
 */
export const SANCTIONS_AUTHORITY_DATASETS = {
  ofac: ['ofac_sdn', 'ofac_non_sdn_consolidated'],
  un: ['un_security_council'],
  eu: ['eu_financial_sanctions'],
} as const satisfies Record<string, readonly SanctionsSource[]>;

export type SanctionsAuth =
  /** No credential of any kind. */
  | { kind: 'none' }
  /**
   * A token the authority itself publishes as part of the public download URL. This is a
   * documented public access mechanism, not a credential and not a bypass — see the EU
   * contract note below.
   */
  | { kind: 'published_public_token'; env_var: string; default_token: string; documented_at: string; provenance_proof: string };

export interface SanctionsSourceContract {
  source: SanctionsSource;
  /** Base download URL, before any published-token query parameter is appended. */
  base_url: string;
  /** Bumped whenever the retrieval URL, media type, or expected schema changes. */
  contract_version: string;
  authority: string;
  dataset_name: string;
  /** Human-readable official page documenting this distribution. */
  official_reference: string;
  transport: 'https_get';
  /** Media types the authority actually returns. Anything else fails artifact validation. */
  expected_media_types: string[];
  /** Root element the artifact must contain, proving it is the dataset and not an error page. */
  expected_root_element: string;
  /** Adapter that understands this schema; bumped when the parser changes shape. */
  adapter_version: string;
  auth: SanctionsAuth;
  /** Redirects are required for OFAC (SLS issues a signed S3 URL); allowed only to these hosts. */
  allow_redirects: boolean;
  allowed_redirect_hosts?: string[];
  /** Reject anything larger — a runaway response must not exhaust memory. */
  max_bytes: number;
  /**
   * Smallest artifact we would believe. Well below the real size, so it catches truncation
   * and stub error bodies without hardcoding a record count as absolute truth (Phase 6).
   */
  min_bytes: number;
  /** Fields the completeness gate requires the parser to have populated. */
  required_fields: readonly string[];
  /** Documented/observed provider update cadence, for freshness expectations. */
  documented_update_cadence: string;
  notes: string;
}

/** Retained as an alias so call sites reading the resolved contract stay explicit. */
export type SanctionsSourceContractWithUrl = SanctionsSourceContract;

/**
 * Resolve a source's URL, appending a published public token when the contract declares
 * one. The token is read from the environment first so an organisation with its own
 * issued token can override without a code change; it is never persisted.
 */
export function resolveSourceUrl(contract: SanctionsSourceContract, env: NodeJS.ProcessEnv = process.env): string {
  if (contract.auth.kind === 'published_public_token') {
    const token = env[contract.auth.env_var]?.trim() || contract.auth.default_token;
    return `${contract.base_url}?token=${encodeURIComponent(token)}`;
  }
  return contract.base_url;
}

const REQUIRED_CORE = ['source_record_id', 'primary_name'] as const;

export const SANCTIONS_SOURCE_CONTRACTS: Record<SanctionsSource, SanctionsSourceContract> = {
  /**
   * OFAC Specially Designated Nationals and Blocked Persons (SDN) list.
   *
   * Distribution is the Treasury **Sanctions List Service (SLS)**. The SLS endpoint issues
   * a 302 to a pre-signed AWS GovCloud S3 URL — following that redirect is REQUIRED and is
   * the documented mechanism, not a workaround. The signed URL is short-lived, so the
   * redirect must be followed per-request rather than cached.
   *
   * Verified live: 302 -> wc2h-sls-prod-public-published.s3.us-gov-west-1.amazonaws.com,
   * 200 text/xml, 28.8 MB, `<sdnList>` root carrying `<publshInformation>` with
   * `Publish_Date` and an authoritative `Record_Count` (19,199 at time of validation).
   * (`publshInformation` is OFAC's own spelling — not a typo here.)
   */
  ofac_sdn: {
    source: 'ofac_sdn',
    contract_version: 'ofac-sls-sdn-xml-v1',
    authority: 'U.S. Department of the Treasury, Office of Foreign Assets Control (OFAC)',
    dataset_name: 'Specially Designated Nationals and Blocked Persons List (SDN)',
    official_reference: 'https://sanctionslist.ofac.treas.gov/Home/SdnList',
    base_url: 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML',
    transport: 'https_get',
    expected_media_types: ['text/xml', 'application/xml'],
    expected_root_element: 'sdnList',
    adapter_version: 'ofac-sdn-adapter-v2',
    auth: { kind: 'none' },
    allow_redirects: true,
    // The SLS redirect target. Restricting the host means a hijacked redirect cannot make
    // us fetch an artifact from somewhere that is not Treasury-controlled storage.
    allowed_redirect_hosts: ['sanctionslistservice.ofac.treas.gov', 's3.us-gov-west-1.amazonaws.com'],
    max_bytes: 250 * 1024 * 1024,
    min_bytes: 1 * 1024 * 1024,
    required_fields: REQUIRED_CORE,
    documented_update_cadence: 'Republished on each OFAC action; typically several times per month.',
    notes: 'Artifact carries its own authoritative Record_Count, which the completeness gate reconciles against parsed output.',
  },

  /**
   * OFAC Consolidated Sanctions List (NON-SDN).
   *
   * OFAC publishes its non-SDN programmes — SSI (UKRAINE-EO13662), CMIC (EO13959),
   * CAATSA-RUSSIA, HKAA, NS-PLC, FSE and others — as a SEPARATE artifact from the SDN
   * list. Screening the SDN list alone therefore does NOT constitute OFAC coverage.
   *
   * MEASURED, not assumed: at validation time this artifact carried 481 records of which
   * only 93 also appear in the SDN list — **388 active OFAC designations were invisible to
   * buyer screening** while `ofac_sdn` was the only required OFAC dataset. That is a
   * dataset-coverage defect, established by comparing the two live artifacts, not a legal
   * interpretation.
   *
   * Served by the same Sanctions List Service and — importantly — in the SAME `<sdnList>`
   * schema as SDN, so the SDN adapter applies unchanged. The two remain separate snapshots
   * with their own checksum, publication date, counts and freshness: merging them would
   * destroy source identity and make it impossible to say which artifact a designation came
   * from.
   *
   * Verified live: 200 text/xml, 1.06 MB, Publish_Date 07/27/2026, Record_Count 481.
   */
  ofac_non_sdn_consolidated: {
    source: 'ofac_non_sdn_consolidated',
    contract_version: 'ofac-sls-consolidated-xml-v1',
    authority: 'U.S. Department of the Treasury, Office of Foreign Assets Control (OFAC)',
    dataset_name: 'Consolidated Sanctions List (non-SDN: SSI, CMIC, NS-PLC, FSE and related programmes)',
    official_reference: 'https://sanctionslist.ofac.treas.gov/Home/ConsolidatedList',
    base_url: 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/CONSOLIDATED.XML',
    transport: 'https_get',
    expected_media_types: ['text/xml', 'application/xml'],
    expected_root_element: 'sdnList',
    adapter_version: 'ofac-sdn-adapter-v2',
    auth: { kind: 'none' },
    allow_redirects: true,
    allowed_redirect_hosts: ['sanctionslistservice.ofac.treas.gov', 's3.us-gov-west-1.amazonaws.com'],
    max_bytes: 250 * 1024 * 1024,
    // Two orders of magnitude smaller than SDN — its own floor, not SDN's.
    min_bytes: 64 * 1024,
    required_fields: REQUIRED_CORE,
    documented_update_cadence: 'Republished on each OFAC non-SDN action.',
    notes: 'Same schema and adapter as SDN; kept as a distinct dataset so source identity, checksum and freshness are per-artifact.',
  },

  /**
   * UN Security Council Consolidated List.
   *
   * Served from `scsanctions.un.org`, the Security Council's sanctions distribution host.
   * The previously configured `main.un.org/securitycouncil/sites/default/files/...` path
   * returns HTTP 403 — that was an obsolete URL, not an intentional access control, and the
   * supported host serves the same artifact anonymously.
   *
   * Verified live: 200 application/xml, 2.17 MB, `<CONSOLIDATED_LIST>` root with a
   * `dateGenerated` ATTRIBUTE (not the `CONSOLIDATED_LIST_DATE` element the old adapter
   * looked for — that element does not exist in the live schema).
   */
  un_security_council: {
    source: 'un_security_council',
    contract_version: 'un-scsanctions-consolidated-xml-v1',
    authority: 'United Nations Security Council',
    dataset_name: 'UN Security Council Consolidated List',
    official_reference: 'https://www.un.org/securitycouncil/content/un-sc-consolidated-list',
    base_url: 'https://scsanctions.un.org/resources/xml/en/consolidated.xml',
    transport: 'https_get',
    expected_media_types: ['application/xml', 'text/xml'],
    expected_root_element: 'CONSOLIDATED_LIST',
    adapter_version: 'un-consolidated-adapter-v2',
    auth: { kind: 'none' },
    allow_redirects: true,
    // scsanctions.un.org issues a 302 to a UN-operated Azure blob container with a
    // short-lived SAS signature (verified live). This is the same trust model as OFAC ->
    // AWS GovCloud S3, and the reasoning is worth stating plainly: provenance rests on the
    // TLS-authenticated redirect FROM the authority's own domain, NOT on the storage host's
    // certificate — that cert is Microsoft's wildcard `*.blob.core.windows.net` and proves
    // nothing about UN control on its own. The allow-list is what stops a hijacked redirect
    // from silently sourcing "UN sanctions data" from an arbitrary bucket.
    allowed_redirect_hosts: ['scsanctions.un.org', 'unsolprodfiles.blob.core.windows.net'],
    max_bytes: 100 * 1024 * 1024,
    min_bytes: 256 * 1024,
    required_fields: REQUIRED_CORE,
    documented_update_cadence: 'Regenerated on Committee action; artifact carries dateGenerated.',
    notes: 'No authoritative record count is published in the artifact; completeness relies on parse yield plus anomaly detection against the previous snapshot.',
  },

  /**
   * EU Consolidated Financial Sanctions List (FSF).
   *
   * Distributed by the European Commission's Financial Sanctions Database (FSD/FSF) via
   * webgate. The download requires a `token` query parameter.
   *
   * ON THE TOKEN — this is NOT circumventing an access control. `dG9rZW4tMjAxNw`
   * (base64 "token-2017") is the token the Commission itself publishes in the download
   * URLs listed on its own FSF page and mirrored on data.europa.eu, the EU's official open
   * data portal. It is a public distribution parameter, not a secret and not a per-user
   * credential. It is still read from the environment first (`EU_FSF_TOKEN`) so an
   * organisation issued its own token can supply it without a code change, and it is never
   * written to the database.
   *
   * Verified live: without a token -> HTTP 403 JSON; with the published token -> 200
   * application/xml, 7.24 MB, `<export>` root with `generationDate` and `globalFileId`.
   * The `_1_1` schema is used deliberately: it is materially richer than the unversioned
   * path (7.24 MB vs 4.54 MB).
   */
  eu_financial_sanctions: {
    source: 'eu_financial_sanctions',
    contract_version: 'eu-fsf-xml-1_1-v1',
    authority: 'European Commission, Service for Foreign Policy Instruments (FPI)',
    dataset_name: 'EU Consolidated Financial Sanctions List (FSF)',
    official_reference: 'https://data.europa.eu/data/datasets/consolidated-list-of-persons-groups-and-entities-subject-to-eu-financial-sanctions',
    base_url: 'https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content',
    transport: 'https_get',
    expected_media_types: ['application/xml', 'text/xml'],
    expected_root_element: 'export',
    adapter_version: 'eu-fsf-adapter-v2',
    auth: {
      kind: 'published_public_token',
      env_var: 'EU_FSF_TOKEN',
      default_token: 'dG9rZW4tMjAxNw',
      // PROVENANCE PROVEN (Part C), not inferred from "the URL works":
      // the token appears as the published `downloadURL`/`accessURL` in the EU's OWN
      // machine-readable DCAT catalogue record on data.europa.eu — the official EU open
      // data portal — for this exact dataset, across all five distributions (xml,
      // xml_1_1, csv, csv_1_1, pdf). Retrieved and grepped from:
      //   https://data.europa.eu/api/hub/repo/datasets/
      //     consolidated-list-of-persons-groups-and-entities-subject-to-eu-financial-sanctions.rdf
      // It is therefore a public distribution parameter, NOT a secret credential: it is
      // published by the authority for anonymous download and is not per-user. It is still
      // env-overridable (EU_FSF_TOKEN) and is never persisted to the database.
      documented_at: 'https://data.europa.eu/data/datasets/consolidated-list-of-persons-groups-and-entities-subject-to-eu-financial-sanctions',
      provenance_proof: 'Published as downloadURL in the data.europa.eu DCAT record for this dataset.',
    },
    allow_redirects: true,
    allowed_redirect_hosts: ['webgate.ec.europa.eu'],
    max_bytes: 100 * 1024 * 1024,
    min_bytes: 512 * 1024,
    required_fields: REQUIRED_CORE,
    documented_update_cadence: 'Regenerated on each amending regulation; artifact carries generationDate + globalFileId.',
    notes: 'globalFileId is the provider version identifier and is recorded as source_version.',
  },
};

export function sanctionsContract(source: SanctionsSource): SanctionsSourceContract {
  const contract = SANCTIONS_SOURCE_CONTRACTS[source];
  if (!contract) throw new Error(`No sanctions source contract for ${source}.`);
  return contract;
}

/** Database-safe contract metadata. Deliberately excludes anything credential-shaped. */
export function contractMetadataForSnapshot(contract: SanctionsSourceContract) {
  return {
    source_contract_version: contract.contract_version,
    authority: contract.authority,
    dataset_name: contract.dataset_name,
    adapter_version: contract.adapter_version,
  };
}
