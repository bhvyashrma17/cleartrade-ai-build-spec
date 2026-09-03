# Wave 2 — multi-authority expansion

Prior Customs Atlas reports are left unchanged. This records what the ten Wave 2 candidates
actually turned out to be, including where the wave fell short of its 5–8 target and why.

## Outcome in one line

**One of ten implemented.** Norway is now operational, and it is the strongest single source in the
Atlas. The other nine did not reach implementation — one on a credential, three on determinations
made from primary evidence, and **five because this pass did not complete their primary rights
research**. That last group is a limit of the wave, not a finding about those countries, and is
recorded as such rather than dressed up as a blocker.

## Candidate results

| Country | Classification | Basis |
|---|---|---|
| **Norway** | **READY_TO_BUILD → implemented** | data.toll.no, CC BY 4.0 confirmed per dataset |
| South Korea | CREDENTIAL_REQUIRED | rights cleared (KOGL Type 1); `KCS_DATA_GO_KR_SERVICE_KEY` absent from both staging services |
| Switzerland | WRITTEN_PERMISSION_REQUIRED | no primary evidence overturning the prior Tares finding |
| Singapore | NO_DOCUMENTED_MACHINE_INTERFACE | portal licence does not attach to the tariff dataset |
| Thailand | NO_DOCUMENTED_MACHINE_INTERFACE | data.go.th refused automated access (HTTP 403) |
| Mexico | **not researched to conclusion** | SNICE reachable; no documented dataset/licence established |
| Türkiye | **not researched to conclusion** | portal reachable; no documented dataset/licence established |
| Vietnam | **not researched** | not reached in this pass |
| Indonesia | **not researched** | not reached in this pass |
| Malaysia | **not researched to conclusion** | data.gov.my redirected; prior restriction not re-verified |

Only Norway met all five gates. Korea's stop is operational, not legal. Switzerland, Singapore and
Thailand carry real determinations. The remaining five are honestly unresolved.

## Norway — the flagship

Tolletaten publishes 27 datasets on its own CKAN portal at `data.toll.no`, and the four this pack
needs are each **individually confirmed `CC-BY-4.0`** by dataset metadata rather than by a
site-wide policy:

| Dataset | Role |
|---|---|
| `tollavgiftssats` | duty rates per commodity per country group, each with its own validity window |
| `varenummer` | eight-digit commodity numbers with units and validity |
| `landgruppe` | country groups, with Tolletaten's own preference classification |
| `ratetradeagreements` | which agreements name which country, per commodity |

The dataset notes carry a **WCO copyright reservation**, so the same third-party carve-out that
applies to Japan and Australia applies here: the authority's own tariff data is in scope, WCO
nomenclature material is not.

### Why Norway is the best India source in the Atlas so far

Tolletaten publishes India-specific country groups directly:

- **`TIN` — "Toll fra India"**, preference code `P`, **in force from 2025-10-01**: the EFTA–India
  Trade and Economic Partnership Agreement. Present on **5,583 of 7,440 commodities**.
- `TGS3` — ordinary GSP for Indian agricultural goods.
- `TIST` — a shared India / Sri Lanka / Thailand group.

Observed on real data: apparel `61091000` carries a general rate of **10.70% ad valorem** and an
India (TIN) rate of **0.00 per kg** from 2025-10-01. That is a published measure for India-origin
goods, so it resolves to `potentially_applicable_requires_origin_proof` and never further — TEPA
origin qualification is a shipment fact.

The commencement date is load-bearing and tested: assessed before 2025-10-01 the TEPA rate is
**not applied**, and India resolves to `not_applicable`.

### Semantics the source forced

- **Norwegian decimal comma.** Rates are published as `10,70`. `parseFloat` would silently return
  `10` and understate the duty, so values are normalised before parsing and the test pins that the
  result is not 10.
- **Four rate units.** `P` percent of value, `K` per kg, `L` per litre, `S` per piece. Specific
  duties keep their amount and unit; none is converted to an ad-valorem equivalent.
- **A published `0,00` is an observed duty-free rate**, typed `specific` with its unit intact, not
  collapsed into "no duty".
- **A `999999,99` placeholder** appears 10 times in 291,033 rate rows. Reporting it would claim a
  999,999.99% tariff, so it returns `unparsed` with the source text retained.
- **Unknown unit codes** return `unparsed` rather than being assumed ad valorem.

### Archetype coverage, real data

| HS6 | Resolution | General duty | India |
|---|---|---|---|
| `610910` apparel | exact | 10,70 P (10.70%) | TIN 0,00 K, origin proof required |
| `291511` chemical | exact | 0,00 K | origin proof required |
| `854449` cable | all children equivalent (9) | 0,00 K | origin proof required |
| `847989` machinery | all children equivalent (3) | 0,00 K | origin proof required |
| `100630` rice | refinement required (2) | — | unknown |
| `740710` copper | refinement required (2) | — | unknown |
| `220421` wine | refinement required (2) | — | unknown |
| `020230` beef | refinement required (2) | — | unknown |

All eight pass technical qualification; all three resolution states occur naturally.

### Operational qualification

| Metric | Value |
|---|---|
| Retained bundle | 0.6 MB compressed, 44 MB decompressed |
| Commodities | 7,440 (≈291K rate rows) |
| Peak RSS | **421 MB — 41.1% of the worker** |
| Retained heap | 160 MB |
| Duration | 502 ms |
| Verdict | **PASSED**, below the 614 MB warn line |

Registered as a bulk family in `BULK_QUALIFICATION_REQUIRED`, so activation is gated. The decoded
bundle participates in the shared process-wide cache budget at a declared 120 MB weight — no
independent Norway cache, so memory does not grow with adapter count.

Cell values are interned during the read for the same reason as TARIC: Norway's rate table is
columnar and repetitive, and object headers rather than characters dominate retention.

## What this wave did not do

The target was 5–8 packs; one landed. The honest reason is not platform capability — the platform
absorbed Norway without a single architectural change — but that **a defensible pack costs far more
than a search result**. Norway took a dataset-by-dataset licence check, a schema study, discovery
of the India group vocabulary, a placeholder-value trap, a decimal-comma trap, and a real-archive
memory measurement. Five of the ten candidates never got that treatment in this pass, and claiming
a determination for them would have been the same error as reporting `999999,99` as a tariff.

## Regulatory coverage

Not claimed. Tolletaten publishes `innfoerselsrestriksjon` (import restrictions) and `tollkvote`
(quotas) as separate datasets that this release deliberately does not yet carry, so
`regulatory_coverage_complete` is `false` and no requirement records are emitted. Both are obvious
next additions and would use the existing `MarketAccessRequirementRecord` model.

## Rules of origin

No RoO engine was added. The India preference records the scheme, its country group, Tolletaten's
own preference classification and an explicit `requires_origin_proof` condition. TEPA's origin
rules themselves are not encoded — that remains the known architecture seam.
