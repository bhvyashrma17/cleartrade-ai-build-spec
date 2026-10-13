# 36 — Demand Discovery v5 (final design)

Status: outcomes approved by the owner on 13 Oct 2026 (ledger D-007 to D-019, evidence E-010).
Model identity: `market-opportunity-v5`. New runs use v5; v3/v4 results stay readable and are never
recomputed in place (they are snapshots, AGENTS.md).

v5 scores **every one of the 218 screening markets** (docs/31 universe, unchanged) for one confirmed
HS6 product, out of 100, from five parts, and hands the top 10 to regional and buyer discovery. It
replaces the docs/31 shortlist (size screen, then 20 deep markets) and the v4 weights for new runs.

The discipline of Phase 1 stays: missing is never zero; every number traces to stored, checksummed
evidence; policies are frozen per run; a market's latest usable year is chosen per market.

## 1. Owner decisions this design implements

| Ledger | Decision |
|---|---|
| D-008 | Score all 218 markets in depth for every product; no shortlist |
| D-009 | Trade data: CEPII BACI primary; UN Comtrade API as fallback |
| D-010 | Comtrade-derived figures are live for customers now; the owner asks UNSD for written permission in parallel and accepts the licence risk (R-14) |
| D-011 | Where Comtrade has a newer year than BACI, it changes the score (§5.3) |
| D-012 | Five parts: Demand 35, India's opportunity 25, Access 20, Risk 10, Exporter fit 10 |
| D-013 | India's existing share counts as a plus |
| D-014 | Size = 3-year average on a log scale against the product's largest market |
| D-015 | Prices compared FOB to FOB: the market against India's usual export price and against the exporter's own price |
| D-016 | Risk = ECGC short-term rating; ECGC no-cover flagged; markets under comprehensive UN sanctions excluded |
| D-017 | Duty from official Customs Atlas sources where configured; elsewhere a labelled estimate built on India's trade agreements (§4.7) |
| D-018 | Runs start automatically when the HS code is confirmed; agents review and flag, never approve a run |
| D-019 | A market is ranked at ≥ 60 live points including size and growth; the top 10 go on |

## 2. Data sources

| Dataset | Use | Identity and licence | Refresh |
|---|---|---|---|
| CEPII BACI, `HS17` and `HS22`, version `V202601` | Primary trade data: every exporter × importer flow per HS6 and year, value (thousand current USD, FOB) and quantity (metric tons) | `https://www.cepii.fr/DATA_DOWNLOAD/baci/data/BACI_HS17_V202601.zip` (2017–2024), `…BACI_HS22_V202601.zip` (2022–2024). Etalab Open Licence 2.0: commercial reuse allowed with credit to CEPII and the update date. Country codes are BACI's own numeric codes, mapped to ISO through BACI's country file. Taiwan is code 490 ("Asia, nes") | Each yearly release (V202601 published 30 Jan 2026) |
| UN Comtrade API (`data/v1/get/C/A/HS`) | Fallback (§3.3) and the newest year (§5.3) | Free key: 500 calls a day, up to 100,000 rows a call. Commercial use needs UNSD's written permission (R-14, D-010) | Per run, batched, within `comtrade.policy.daily_request_budget` |
| Comtrade data availability (`public/v1/getDa/C/A/HS?period=Y`) | Whether a market itself reported a year (evidence quality, label) | Public, keyless | Per run year, cached |
| CEPII GeoDist `geo_cepii` | Capital coordinates for distance fit (great-circle, km) | Etalab 2.0; 225 countries | Static (2011); snapshot once |
| ECGC Country Risk Classification, short term | Country risk (§4.10) | Public circular, `main.ecgc.in`; reuse terms to confirm | Each new ECGC list |
| World Bank WDI `LP.LPI.OVRL.XQ` | Logistics performance, 1–5 | CC BY 4.0; latest value 2022 | Yearly check |
| World Bank WDI `TM.TAX.MANF.SM.AR.ZS`, `TM.TAX.TCOM.SM.AR.ZS` | Sector average applied tariff for the duty estimate | CC BY 4.0; latest 2022 | Yearly check |
| India's trade agreements (curated) | Duty estimate factor and the "trade agreement" note | Department of Commerce agreement pages; each entry cites its source and in-force date | On each new agreement |
| Customs Atlas (docs/33-global-tariff-source-contract, WP2) | Official duty for Indian origin, 53 of the 218 markets | Per authority release | Per release |

Network note (R-17): the agent session cannot reach CEPII, the World Bank or Comtrade. Downloads run
on the owner's machine or the Railway worker; imports follow the retained-release discipline
(`--expect-sha256`, run twice, the second must be UNCHANGED).

## 3. Acquisition and storage

### 3.1 Trade dataset releases

`scripts/import-trade-dataset-release.ts` imports one BACI archive:

1. Refuses unless the file's sha256 equals `--expect-sha256`, and the database identity guard passes.
2. Streams the ZIP (central directory first, then each member through `inflateRaw`; ZIP64 aware). No
   member is held whole in memory.
3. Validates every row: `t` integer, `k` six digits (kept as text), `i` and `j` known BACI codes,
   `v > 0`, `q` empty or `≥ 0`. A malformed row fails the import; nothing is skipped silently.
4. Partitions rows by year and HS2 chapter into gzip CSV objects
   (`trade/cepii_baci/V202601/HS17/2024/52.csv.gz`) in object storage, recording each partition's
   sha256, bytes, row count and value total.
5. Records `TradeDatasetRelease`, its partitions and its country map (BACI code → ISO2/ISO3) in one
   transaction, `status = ready` only when every partition is stored and verified.

A run reads 6–8 small partitions for one product. Nothing per product calls a network.

### 3.2 Reference dataset releases

`ReferenceDatasetRelease` holds each small dataset as immutable, validated rows (`rows Json`,
`rows_checksum`), keyed by `dataset_key`, source sha256 and parser version. Each key has its own
parser and zod schema. A run freezes the release ids it read.

Each definition states what its bytes are (`source_form`): the publisher's own file (WDI JSON,
getDa JSON), a curated list (India's agreements), or a text form of a publisher file that has no
machine-readable edition — the ECGC circular's PDF text (`pdftotext -layout`) and the GeoDist
`.dta` table as CSV. A derived file is imported only from `data/reference/`, where
`manifest.json` lists it with its sha256 and the original it was made from (URL, sha256, bytes,
retrieval time, method); the release stores that original in `validation.derived_from`, and a
repeat import claiming a different original is refused.

### 3.3 Comtrade, batched

One request covers every reporter: `reporterCode` omitted, `partnerCode` omitted (all partners,
World `0` included), `period` a comma list, `cmdCode` the HS6, `flowCode=M`, explicit
`maxRecords`. A response that reaches the cap is split by period, then by reporter halves, until
none does. Each response is stored whole as `SourceEvidence` and split into the same per-reporter
`NormalizedTradeObservation` rows the parser already produces; reporter identity comes from the
provider's reference registry, never from an alias map.

Comtrade is called for:

- **Newest year:** periods `{L, L+1}` where `L` is BACI's last year (2024), for the chain-link in
  §5.3. About 2 requests a product.
- **Fallback, market level:** a screening market absent from BACI's country map gets its own
  reported series (`period` = the window).
- **Fallback, release level:** with no `ready` BACI release in the environment, the whole run uses
  Comtrade (imports, plus exports for partner figures) and says so on every result.

### 3.4 HS revision

A confirmed HS6 is HS 2022. The run tests whether the code means the same thing in BACI's HS17
file: the code exists there and its world totals for 2022–2024 match the HS22 file's within
`hs_revision.max_total_divergence` (default 2%) every year. If so, the HS17 file supplies
2019–2024. If not, the HS22 file supplies 2022–2024 only, and every growth metric carries
`short_history`.

## 4. Metrics

Notation for market `m`, product `k`, window years `y0…yL` (normally 2019–2024; 2020–2025 when
§5.3 applies): `M(m,y)` total imports, `X(s→m,y)` imports from supplier `s`, `Q(…)` the same in
tonnes, `UV = value / quantity` in USD per kg. India is BACI code 699 / ISO `IN`. All parameters
below live in `demand_discovery.v5` config and are frozen into the run.

| # | Metric · points | Formula | Available when |
|---|---|---|---|
| 1 | Market size · 20 | `S = mean(M over the last 3 years)`; score = `100 × clamp((log10 S − log10 floor) / (log10 Smax − log10 floor))`, floor $100,000, `Smax` = the largest `S` among the 218 markets for this product | ≥ 1 of the 3 years observed |
| 2 | Growth · 10 | 70% CAGR over the window, 30% last-year change; each maps −20% → 0 to +20% → 100, linear, clamped. A zero at either end makes CAGR `not_calculable` (as in v4) and growth falls back to momentum; momentum needs only a positive year before the last, so imports that stop score a real −100%, not a missing value | imports in the year before the last, or at both ends of the window |
| 3 | Stability · 5 | population SD of yearly growth rates, in percentage points; score = `100 × (1 − min(SD, 50) / 50)` | ≥ 4 growth rates |
| 4 | India's foothold · 10 | share `s = X(IN→m) / M(m)` in %, latest year; share score = `40 + 60 × min(1, log10(1+s) / log10(11))`; trend = OLS slope of yearly shares, −5 → 0 to +5 pp/yr → 100; foothold = 70% share + 30% trend | latest year observed |
| 5 | Price headroom · 10 | `r = UVm / UVin`: `UVm` = quantity-weighted median of the market's supplier unit values, `UVin` = quantity-weighted median of India's export unit values to all markets, both FOB, Tukey 1.5 IQR outliers removed; score = `clamp(50 + 50 × ln r / ln 1.5)` | ≥ 3 supplier flows with quantity, and India's `UVin` |
| 6 | Openness · 5 | `HHI = Σ share_s²`; score = `100 × (1 − HHI)` | latest year, supplier sum within 95–105% of `M` |
| 7 | Duty on Indian goods · 10 | official: the line's duty for Indian origin, specific duties converted with `UVm`; else the estimate of §4.7; score = `100 × (1 − min(d, 25) / 25)` | official evidence, or an estimate input |
| 8 | Distance fit · 5 | `D̄ = Σ wₛ ln dist(s,m)` (wₛ = supplier value share); `Δ = ln dist(IN,m) − D̄`; score = 100 if `Δ ≤ 0`, else `100 × e^(−Δ)` | supplier mix and coordinates |
| 9 | Logistics · 5 | `(LPI − 1) / 4 × 100` | an LPI value |
| 10 | Country risk · 10 | ECGC grade: A1 100, A2 85, B1 70, B2 55, C1 40, C2 20, D 0; Restricted Cover Group I caps at 40, Group II caps at 20; off cover = 0 | the market is on the list |
| 11 | Price fit · 5 | `r = UVm / pe`, `pe` = the exporter's FOB (or EXW) price per kg in USD (unit net weight; ECB cross rate frozen on the run); same mapping as #5 | price, incoterm FOB/EXW, unit weight, and an FX rate |
| 12 | Volume fit · 5 | `v = 12 × monthly capacity (t) / Q(m)`; 100 at `v ≤ 2%`, 0 at `v ≥ 25%`, log-linear between | capacity convertible to tonnes, and `Q(m)` |

### 4.7 Duty estimate (labelled)

For a market with no Customs Atlas evidence: `d_est = sector average applied tariff (WDI: primary
products for HS chapters 01–27, manufactured otherwise) × agreement factor`. The factor is
`agreement.comprehensive_factor` (default 0.5) when an India agreement covering goods is in force,
`agreement.partial_scope_factor` (default 0.8) for a partial-scope agreement, else 1. With no WDI
value the metric is unavailable. Estimates carry quality 0.5 and the label "Duty estimated".

## 5. The score

### 5.1 Parts

| Part | Metrics (points) | Total |
|---|---|---|
| Demand | size 20, growth 10, stability 5 | 35 |
| India's opportunity | foothold 10, price headroom 10, openness 5 | 25 |
| Access | duty 10, distance fit 5, logistics 5 | 20 |
| Risk | country risk 10 | 10 |
| Exporter fit | price fit 5, volume fit 5 | 10 |

`overall = Σ (score_i × points_i) / Σ live points`, rounded. Unavailable metrics drop out and their
points are shared among the rest. A metric is never scored as zero for lack of data.

### 5.2 Ranking and confidence

- Ranked when live points ≥ `ranking.minimum_live_points` (60) and size and growth are both live.
  Otherwise `not_enough_data`, shown with its partial score, never ranked. Ties on the exact
  (unrounded) score go to the higher confidence, then to the ISO code, so the same inputs always give
  the same order. A flagged market is ranked like any other; its flag is shown beside the rank.
- Confidence = (live points / 100) × evidence quality × 0.8^lag. Evidence quality is the
  points-weighted mean of each live metric's quality: BACI where the market reported that year 1.0;
  BACI partner-only 0.85; Comtrade-reported fallback 0.9; chain-linked newest year 0.95; duty
  estimate 0.5; LPI 0.9 (2022 data). Lag = the newest year any market has, minus this market's.
- Gates run before scoring: comprehensive UN sanctions (initially North Korea) → `excluded`;
  ECGC Group II or off cover → `flagged`; no recorded trade in the window → `no_recorded_demand`.

### 5.3 Newest year (D-011)

When market `m` reported both `L` and `L+1` to Comtrade itself, its series extends by
chain-linking, so BACI keeps the level and Comtrade supplies the change:
`M(m,L+1) = M_BACI(m,L) × M_CT(m,L+1) / M_CT(m,L)`. Comtrade import values are CIF and BACI's are
FOB; the ratio cancels that margin, which a direct splice would not.

What extends (engineering refinement of D-011, E-011):

- **Total imports** — size, growth and stability use the window `y0+1 … L+1` (a short 2022–2024
  history becomes 2022–2025: the window grows by one year and keeps at most `window_years`).
- **Imports from India** — linked the same way, `X(IN→m,L+1) = X_BACI(IN→m,L) × X_CT(IN→m,L+1) /
  X_CT(IN→m,L)`, so India's foothold uses `L+1` too. India links only when both sources agree its
  flow exists in `L`; otherwise (India new in `L+1`, BACI's flow only from India's own export
  declarations, or a linked share above 100%) the foothold stays on the BACI window.
- **Not extended:** supplier mix, unit values and quantities. Openness, distance fit, price
  headroom, price fit and volume fit use BACI's year `L` (the "structure year"): they move slowly,
  BACI's are reconciled and FOB, and Comtrade's newest quantities are often estimated.

A change beyond `chain_link.max_change_ratio` (default 10×) either way is treated as an error in
provisional data and not linked. Every link records both sources and the ratio; every refusal is
recorded with its reason (`not_reported`, `no_baci_base`, `no_comtrade_base`,
`implausible_change`). A market without a usable `L+1` keeps its BACI window, with lag 1.
Linked metrics carry evidence quality 0.95.

## 6. Labels and reasons

Labels (thresholds in config): Big and growing; India already sells here (share ≥ 1%); Pays above
India's price (r ≥ 1.2); Low duty for India (d ≤ 5%, "estimated" when §4.7); Trading hub (the
market's exports of the product ≥ 50% of its imports; information only); ECGC cover restricted;
Estimated from partners' figures (the market did not report its latest year); Newer data used
(§5.3); Short history (§3.4).

Market-level fallback results carry "From the market's own customs reports".

Reasons: three sentences per market from templates: the two metrics adding most points
(`score × points`) and the one costing most (`(100 − score) × points`), each stating the observed
value ("Imports averaged $32.0 million a year over the last three years"). A market that is not
ranked leads with why; an excluded or no-demand market gets one status sentence. No sentence
projects earnings. The optional AI rationale (`RATIONALE_WRITER`) may rephrase; it never changes a
number.

Code: `src/lib/demand-discovery-v5/` — `policy`, `series`, `metrics`, `chain-link`, `hs-revision`,
`baci-flows`, `score`, `explain`, and `assess` (all 218 markets for one product, pure: the caller
reads the frozen releases and passes their rows in).

## 7. Runs and permissions

- Trigger: confirming a product's classification enqueues `demand_discovery_v5` (D-018). No staff
  approval and no exporter click. Re-runs follow a new BACI or reference release, a policy version,
  or a reclassification.
- One job computes all 218 markets: read partitions, call Comtrade for the newest year and any
  fallback, compute metrics in memory, write one `DiscoveryRun` and 218 `MarketAssessment` rows in
  one transaction, with `score_breakdown`, `labels`, `reasons`, `live_points`, `data_year` and the
  frozen release ids. The run's `summary` names the top 10 handed to regional discovery.
- Agents act through the existing `AgentDecision` overlay: promote, flag or reject, shown beside the
  computed rank, never replacing it.
- Tier gates are unchanged (`demand_discovery.run` paid; docs/14). The guest market estimate moves to
  BACI under the same framing rule: observed values and price bands only, no ranking, no projection.

### 7.1 As built (13 Oct 2026, E-012)

- **When v5 runs.** `demand_discovery.v5` config: `enabled`, `auto_start_on_classification`,
  `comtrade_newest_year`, `comtrade_market_fallback` (the R-14 switches), `comtrade_max_records`,
  `fx_max_lookback_days` and the scoring `policy`. v5 is *available* when it is enabled and a ready
  BACI release exists in the environment; otherwise `POST /api/v1/discovery-runs` keeps using the
  earlier engine, so an environment without BACI keeps working.
- **Auto-start.** `confirmClassification` calls `autoStartDemandDiscoveryV5` after its transaction
  commits. It starts a run only for a paid tenant (costed work) with v5 available, never throws, and
  audits `demand_discovery_auto_start` with whether it started and why not. One run per
  classification may be in flight (`dedupe_key demand_discovery_v5:<product>:<classification>`).
- **The run.** `startDemandDiscoveryV5` freezes the product facts the score uses into
  `input_snapshot.v5_product_facts`; the job (`demand_discovery_v5`, costed) reads the newest ready
  BACI HS17 and HS22 releases, runs §3.4, reads the active reference releases, makes at most two
  batched Comtrade calls (newest year; uncovered markets) with quota reserved per call and every
  page stored as `SourceEvidence`, derives the exporter's USD/kg price (ECB rate frozen) and yearly
  kg, scores every universe market, and writes all `MarketAssessment` rows and the run's
  `frozen_inputs`, `summary` and policy hash in one transaction. A failed Comtrade step makes the run
  `partial` with the reason; a missing BACI release fails it.
- **Results.** `GET /api/v1/discovery-runs/:id/market-assessments` orders by `rank`, then score,
  and returns status, rank, live points, data year, parts, labels, reasons and flags. `/app/markets`
  shows the ranked list (top 10 first), the not-ranked markets apart with why, and what the run could
  not use; the market page shows the five parts and twelve measures, a gap as a gap.
- **India's agreements.** Curated in `data/reference/india-trade-agreements-v1.json`, one row per
  agreement and partner, each citing the source of its entry-into-force date (DGFT Appendix 2A for
  the older agreements; PIB, EFTA, the Welsh Government and NZ reporting for the 2022–2026 ones).
  Imported per environment as `india:trade-agreements`; GSTP, SAPTA, the Thailand early harvest,
  the Nepal treaty, APTA for Mongolia and the not-yet-in-force EU FTA are listed as excluded with
  the reason. Pakistan has no row (trade suspended since August 2019).
- **Country risk and distance (13 Oct 2026, E-014).** `ecgc:country-risk:short-term` parses the
  1 July 2026 list: 12 pages, 239 published rows in four tables (open 185, Restricted Group I 29,
  Group II 24, off cover 1), wrapped names, the Iran footnote and Pakistan's withdrawal note.
  Names map to ISO through `i18n-iso-countries` and a reviewed table of 32 ECGC spellings
  (`Tokealu`, `St. Christopher and Nevis`, …); the Channel Isles row covers GG and JE; the Canary
  Islands row is left out (part of Spain, which has its own row). 217 of the 218 markets are rated;
  Saint Barthélemy is not on the list. `cepii:geo_cepii` keeps one capital per country (225); four
  withdrawn 2011 codes map to the successor with the same capital (ZR→CD Kinshasa, AN→CW Willemstad,
  YU→RS Belgrade, TP→TL Dili), checked against the row's city. Six markets have no capital row
  (BL, BQ, ME, SS, SX, VA) and their distance fit is unavailable. BACI's 490 ("Other Asia, nes") is
  placed at Taipei only because CEPII documents it as Taiwan and GeoDist numbers Taiwan 490 too.
- **BACI parser v2.** V202601's country file leaves Namibia's `country_iso2` empty ("NA" read as
  missing) with `country_iso3` NAM. v2 takes the alpha-2 from the file's own alpha-3 when the cell
  holds no valid code and ISO pairs the two both ways, lists each such row in the release
  validation (`iso2_from_iso3`), and refuses a row whose two ISO cells disagree. No release was
  imported with v1.
- **Not yet wired.** Official Customs Atlas duty (every duty is the labelled estimate until then),
  the release-level Comtrade fallback (a run without BACI fails), and the agent and ops views of v5
  fields.

## 8. Verification

- Unit tests for every metric, the score, the chain-link, the HS revision test and each parser, on
  synthetic fixtures; property tests that a missing input never yields a zero score.
- The importer runs twice on the real archive (owner's machine); the second run must be UNCHANGED.
- Three archetype products on staging (rice `100630`, brassware `741810`, carpets `570110`, D-003).
  Each top 10 is compared with India's own largest export destinations for the product in BACI; a
  top 10 that ignores most of them is a calibration failure, not a pass.
- The Phase 1 gate (docs/34) gains a v5 policy; its thresholds stay proposed until the owner approves.

## 9. Known limits

- BACI ends in 2024; the newest-year chain-link covers only markets Comtrade has for 2025.
- Unit values at HS6 mix cheap and premium goods; price metrics carry 15 of 100 points for that reason.
- Duty estimates (§4.7) can be wrong for a specific product; they are always labelled.
- The weights are judgment until deal outcomes exist; refit them then.
- Licence: R-14 (Comtrade, accepted by the owner), R-15 (BACI built on Comtrade data; legal check),
  ECGC and World Bank terms to confirm.
- GeoDist dates from 2011: South Sudan, Montenegro, Bonaire, Sint Maarten, Saint Barthélemy and the
  Holy See have no capital row, so their distance fit is unavailable. The ECGC list does not rate
  Saint Barthélemy.
- The ECGC parser reads one layout. A new circular that changes it fails the import with the line
  that broke; it is never half-read.
