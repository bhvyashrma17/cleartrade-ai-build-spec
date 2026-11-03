# P1-CC4 Wave 1 authority packs — implementation record

Date: 02 Sep 2026
Starting commit: `ed9ab86`
Scope: Canada, Japan, UAE, Brazil canaries; no regional packs and no Phase 2 discovery.

This is an implementation record, not a rewrite of the source research. Where the build found
something different from the registry prediction, both are recorded.

## Outcome

| Pack | Outcome | Why |
|---|---|---|
| Canada / CBSA | **Implemented and locally qualified** | OGL-Canada 2.0 covers commercial use, automated access, retention, customer display and redistribution with attribution. The official T2026-2 bytes and India treatment table parsed successfully. |
| Japan Customs | **Stopped before acquisition** | The registry records commercial use, automated access, raw caching, customer display and redistribution as unresolved. No permission was invented. |
| UAE / Dubai Pulse | **Stopped before acquisition** | The UAE platform licence is permissive, but the registry explicitly says the specific customs-tariff dataset licence was not verified. Platform permission was not treated as dataset permission. |
| Brazil / Portal Único Siscomex | **Stopped before acquisition** | API scope/auth and reuse rights are unresolved, and no authority-backed source joining TEC to Brazil's LETEC/national execution was confirmed. A TEC-only adapter would be unsafe. |

The three stopped destinations now return the existing structured
`provider_unconfigured_or_license_pending` outcome. They create no Market Access evidence.

## Prediction versus actual — Canada

The registry predicted an annual CBSA XLSX/PDF file. The current official complete machine release
is instead a ZIP containing one Microsoft Access `.accdb` database. On 02 Sep 2026 the current
release was:

- release: `T2026-2`
- effective date: `2026-09-01`
- official tariff URL: `https://www.cbsa-asfc.gc.ca/trade-commerce/tariff-tarif/2026/01-99/01-99-2026-2-eng.zip`
- official origin-treatment URL: `https://www.cbsa-asfc.gc.ca/trade-commerce/tariff-tarif/2026/html/countries-pays-eng.html`
- inner database: `01-99-2026-2-eng.accdb`
- tariff table: `TPHS`, 22,461 rows at validation time
- official upstream ZIP SHA-256 observed locally: `9fc0ecf239374ee57577c06cef6f94a12e5be544239a60a463a1a2ac6a20cf81`

The implementation uses `mdb-reader` 3.2.0, a read-only JavaScript Access reader supporting the
Node 22 runtime. It checks the complete TPHS column order before parsing. A schema change rejects
the release instead of shifting columns silently.

The source requires two official inputs. TPHS supplies tariff-line rates, while CBSA's separate
List of Countries and Applicable Tariff Treatments proves origin eligibility. Acquisition retains
the exact bytes of both in one immutable composite bundle:

1. the original CBSA tariff ZIP;
2. the exact CBSA country-treatment HTML;
3. a small acquisition manifest containing the two URLs, acquisition reader version and release
   identifier.

The wrapper is a storage container, not a data rewrite. Its manifest records a fingerprint and
size for the original ZIP, inner Access database, HTML and acquisition manifest.

## One authority-release architecture

The physical `TaricRelease` table and database enum remain in place so historical TARIC rows are
not moved or rewritten. Prisma now maps the widened table as `AuthorityRelease`. The new generic
identity records:

- source family, authority and exact destination scope;
- source URL/distribution, release identifier and reference date;
- retrieval time and source format;
- retained object key, checksum, size and per-file manifest;
- reader/parser versions and validation result;
- imported/active/superseded/rejected lifecycle;
- previous-release relationship and `NEW_RELEASE`/`CHANGED` classification.

TARIC and Canada both use this path. The partial active index is now one active release per source,
not one active customs release globally.

Change detection is intentionally small:

- the same authority + release identifier + checksum is `UNCHANGED`, returns the existing release,
  and writes an audit event explaining the comparison;
- the same release identifier with different bytes is `CHANGED` and retains a new immutable row;
- a different release identifier is `NEW_RELEASE` and links to the previous release.

A checksum is no longer a global unique key. Identical bytes under a different authority or
release context remain representable.

Canonical snapshot idempotency uses release id + provider + destination + HS6 + parser version +
request identity. Repeating the same logical parse returns the existing immutable snapshot. A new
parser version creates a new snapshot linked to the same retained release; old evidence is not
updated. `reparseCanadaAuthorityRelease` is the explicit retained-bytes reparse path.

## Canada tariff semantics

`CA_CUSTOMS_TARIFF` was added only because a real pack requires it. The parser distinguishes the
8-digit tariff item (where the duty is normally stated) from 10-digit statistical children. It
inherits a duty only from the matching tariff item and retains that relationship in conditions and
raw evidence. It never selects an arbitrary child when material rates, footnotes, preferences or
quota conditions differ.

- `Free` is an observed ad-valorem zero whose source expression remains `Free`.
- blank MFN is `none`, never zero.
- Canadian `¢` and `$` specific duties are parsed as CAD, never USD.
- compound and mixed expressions retain the exact CBSA text and have no fabricated scalar/AVE.
- `Within access commitment` is a tariff-quota condition, never an unconditional general rate.
- named preference columns are retained as programmes; they are not treated as origin countries.
- India's current state comes from the complete country table: MFN `yes`, GPT `no`, LDCT `no`, and
  no `Other` treatment. Preferences published for other origins therefore do not become an India
  rate.
- tariff coverage remains separate from regulatory coverage. CBSA tariff data does not prove
  absence of SPS, TBT, licensing or other import controls.

## Qualification and observed cases

The existing provider-neutral qualification harness passed real T2026-2 reads for:

| HS6 | Archetype | Resolution | Observed duty |
|---|---|---|---|
| `100630` | rice | all children equivalent (6 statistical children) | `Free` |
| `854449` | electrical cable | all children equivalent (3 children) | `Free` |
| `291590` | industrial chemical | all children equivalent (2 children) | `Free` |
| `847989` | machinery | classification refinement required (10 children) | no arbitrary rate published |

Adversarial TPHS rows actually observed in T2026-2 and pinned as source-shaped fixtures include:

- `1905.10.29` — `13.51 ¢/kg` (specific);
- `1904.10.29` — `11.64 ¢/kg plus 8.5 %` (compound);
- `0709.52.90` — `8.43 ¢/kg but not less than 8.5 %` (mixed/threshold);
- `2106.90.51` — `6.68 ¢/kg`, explicitly `Within access commitment` (quota-conditioned);
- `2106.90.52` — `$1.45/kg`, explicitly `Over access commitment`.

The direct-authority precedence policy was not changed. Existing qualification tests confirm a
direct authority remains ahead of a later commercial intermediary; Canada wins by its existing
`authoritative_public` assertion class, not by a new weight.

## Engineering effort and lessons

Observed effort was medium for Canada and zero parser effort for the stopped packs. The main work
was the reusable release migration, Access schema validation, two-source origin join, and
idempotent reparse lineage. This validates the existing Market Access convergence boundary: bulk
sources need different acquisition mechanics, but still normalize to `MarketAccessIngestResult`
and use canonical persistence, classification refinement, preference determination, qualification,
precedence and job routing unchanged.

The canary set does **not** yet validate lookup/API authorities, Japan's dated-HTML mechanics,
12-digit UAE execution, or Brazil's national override layer. Those are rights/source-contract
gaps, not parser TODOs to paper over.

## Remaining gates

1. Obtain and record Japan Customs permission for automated retrieval, raw retention, derived
   customer display and redistribution.
2. Verify the specific Dubai Pulse tariff dataset licence, including attribution language and raw
   retention.
3. Confirm Portal Único's tariff API contract, authentication and reuse rights, then identify an
   official effective-dated Brazil national execution/LETEC source before parsing TEC.
4. New Zealand and South Korea remain licence-gated exactly as the registry states.
