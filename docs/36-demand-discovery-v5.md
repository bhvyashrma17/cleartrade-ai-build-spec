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
| World Bank WDI `IS.SHP.GCNW.XQ` (UNCTAD liner shipping connectivity) | Logistics estimate where no LPI exists (policy v5, D-025) | CC BY 4.0; latest value 2020 for most markets | Yearly check |
| World Bank WDI `TM.TAX.MANF.SM.AR.ZS`, `TM.TAX.TCOM.SM.AR.ZS` | Sector average applied tariff for the duty estimate | CC BY 4.0; latest 2022 | Yearly check |
| India's trade agreements (curated) | Duty estimate factor and the "trade agreement" note | Department of Commerce agreement pages; each entry cites its source and in-force date | On each new agreement |
| Currency pegs (curated, `curated:currency-pegs`) | Converting the 14 pegged currencies the ECB does not publish (D-025) | Central bank pages or the authority's statement as reported; one source per row | On a change of parity |
| Sanctions programmes (curated, `curated:sanctions-programmes`) | Market flags: UN Security Council regimes, US and EU programmes (D-025) | Legal basis and source per row; checked 17 Oct 2026 | Monthly check |
| Customs Atlas (docs/33-global-tariff-source-contract, WP2) | Official duty for Indian origin, 56 of the 218 markets (docs/37) | Per authority release | Per release |

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
| 7 | Duty on Indian goods · 10 | official: the line's duty for Indian origin — India's published preference when it is not a quota (policy v6), else the ordinary rate — specific duties converted with `UVm` (read automatically, or by an agent — quality 0.9, labelled); else a published rule (policy v5 `rule_rates`); else the estimate of §4.7; score = `100 × (1 − min(d, 25) / 25)` | official evidence, a rule, or an estimate input |
| 8 | Distance fit · 5 | `D̄ = Σ wₛ ln dist(s,m)` (wₛ = supplier value share); `Δ = ln dist(IN,m) − D̄`; score = 100 if `Δ ≤ 0`, else `100 × e^(−Δ)` | supplier mix and coordinates |
| 9 | Logistics · 5 | `(LPI − 1) / 4 × 100`; without an LPI (policy v5), the LPI predicted from shipping connectivity: OLS of LPI on `ln(LSCI)` over the run's markets with both (≥ 30), clamped to 1–5, quality 0.5, labelled | an LPI value, or an LSCI value and the fit |
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
  `fx_max_lookback_days`, `fx_fetch_missing`, `tariff_acquisition`, `tariff_live_fetch_timeout_ms`
  and the scoring `policy`. v5 is *available* when it is enabled and a ready
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
  (BL, BQ, ME, SS, SX, VA); since 14 Oct their capitals come from `curated:capitals-supplement`
  (`data/reference/capitals-supplement-v1.json`, a source per row: Natural Earth, public domain, for
  ME, SS and VA; Wikipedia infobox coordinates for BL, BQ and SX), used only where GeoDist has no
  row. BACI's 490 ("Other Asia, nes") is
  placed at Taipei only because CEPII documents it as Taiwan and GeoDist numbers Taiwan 490 too.
- **BACI parser v2.** V202601's country file leaves Namibia's `country_iso2` empty ("NA" read as
  missing) with `country_iso3` NAM. v2 takes the alpha-2 from the file's own alpha-3 when the cell
  holds no valid code and ISO pairs the two both ways, lists each such row in the release
  validation (`iso2_from_iso3`), and refuses a row whose two ISO cells disagree. No release was
  imported with v1.
- **Official duty (13 Oct 2026, E-015).** A run reads the Customs Atlas evidence already stored for
  the product's exact HS6 in each market (`MarketAccessEvidenceSnapshot`/`MarketAccessEvidence`,
  allowed evidence origins, retrieved before the run's clock) and admits it with the deep
  assessment's own rules (`selectTariffFactsOnly`: clock, status, supersession, exact HS6 line,
  licensed-content approval; authoritative public assertions only; confidence ≥
  `duty.official_minimum_confidence`, policy v2). The scored rate is the market's ordinary
  (third-country) duty — what Indian goods pay without claiming a preference. Policy v6 (D-026,
  18 Oct 2026): where the tariff publishes a preference for India that is not a tariff quota, that
  preferential rate is scored instead ("Duty on Indian goods is 2.5% at India's preferential rate
  (standard rate 11.2%); claiming it needs proof of Indian origin."), read from the pack's own
  parsed duty where the evidence row keeps it; a quota preference, one above the standard rate or
  one that is not a single rate is shown and not scored. An ad-valorem duty is used as published; a specific duty per kg or tonne is converted with the ECB
  rate frozen on the run and, in the score, the market's median supplier unit value (the reason
  shows the published expression); compound, mixed, per-litre or per-item duties and currencies
  without an ECB rate fall back to the labelled estimate with the reason recorded.
- **Tariff look-up inside each run (14 Oct 2026, D-020).** With `tariff_acquisition` on (the
  default), a run asks every market that has a Customs Atlas source for the product's HS6 before it
  reads tariff evidence (`tariff-step.ts`), through the deep run's own acquisition
  (`country-truth/tariff-acquisition.ts`): inline, retained releases resolved at the run's clock,
  live sources (UK, US) at real time within `tariff_live_fetch_timeout_ms`. Markets are taken one
  source at a time, so EU TARIC is decoded once for its 27 members instead of being evicted from the
  160 MB shared bundle cache between two of them. What a run acquires is admitted at its tariff
  clock (no earlier than the run's clock or any retrieval, as in the deep run); an identical release
  ingest is reused, not duplicated. Every market's outcome is frozen in `tariff_acquisition`; a failed
  or timed-out look-up makes the run `partial` and that market uses the estimate. With the switch off
  a run reads only evidence ingested earlier, as before.
- **Exchange rates (14 Oct 2026, E-018).** Nothing loaded ECB rates into an environment, so a price
  outside US dollars and every specific duty went unconverted. A run now reads stored ECB
  observations first; when no single published day within `fx_max_lookback_days` carries every leg,
  and `fx_fetch_missing` allows it, it fetches the missing series over exactly that window, stores
  them (`ingestEcbSeries`: immutable, raw response kept) and derives again (`fx.ts`). One fetch per
  series per run; every fetch is frozen in `fx_fetches`. A failed fetch leaves the rate unavailable
  with its reason and makes the run `partial`; an ECB 404 (no such series) is recorded, not a failure.
- **World Bank age limit (policy v3, D-021).** A logistics score or tariff average more than
  `world_bank.max_age_years` (10) old on the run's date counts as missing, and the market's metric
  says so. Against the files imported on 14 Oct this drops logistics for AZ (2014) and TL (2007) and
  the tariff averages for DJ (2014), ER (2006) and TM (2002). The dropped values are frozen in
  `world_bank_too_old`.
- **Agent and ops views (13 Oct 2026, E-016).** The agent's market control table
  (`/agent/exporters/:org/products/:product/markets/manage`) reads a v5 run's stored rank — only
  ranked markets have one, so a partial score is shown as partial and never ranked — orders by it,
  shows each market's status, flags and top-10 hand-off, and opens the same five-part, twelve-measure
  breakdown the exporter sees (`src/lib/demand-discovery-v5/detail.ts`, one builder for both). An
  agent decision freezes the stored rank, not a count of scores. `/ops/discovery` gains a v5 panel:
  whether runs can start here and why not, the switches and policy version, each dataset a run reads
  with its version and what its absence costs, last-7-day run counts by status, and the 20 latest
  runs with their ranked count, top markets and the notes on what each could not use.
- **Rupees beside dollars (14 Oct 2026, D-023).** Every dollar amount in a market's reasons and
  breakdown is followed by its rupee figure at the newest ECB rate (`src/lib/fx/display-rate.ts`,
  `src/lib/money-format.ts`: lakh and crore), with the rate and its day named on the page. The figure
  follows today's rate, so it changes from day to day (the owner's choice over the rate frozen with
  the run); stored run values stay in US dollars. The newest stored day older than the newest
  publishable ECB day triggers one fetch of the INR and USD series, at most once an hour per process.
  Price sentences now state the per-kilogram prices behind the ratio ("They pay $2.10/kg; India
  usually sells at $1.80/kg").
- **Customs-union estimates (policy v4).** A market with no World Bank tariff average of its own
  borrows its customs union's common external tariff for the estimate, labelled as such: LU, MQ and
  SM from the EU (all chapters), AD from the EU for chapters 25–97 only. Each entry names its legal
  basis in `customs_unions`.
- **Tariffs for every market (17 Oct 2026, D-024, docs/37).** Martinique, San Marino and Andorra
  (chapters 25–97) now read the EU tariff (Customs Atlas, 56 markets connected). Policy v5
  `rule_rates`: eight markets whose duty follows from a published rule — free ports (HK, MO, SX, BQ,
  VA, and SG outside its dutiable goods) and one-rate markets (Timor-Leste 5%, Saint-Barthélemy 5%) —
  each with its official source, the goods it leaves out and a review date. Every other market has a
  directory entry naming where its tariff can be read; the agent's market table links it and lets an
  assigned agent record the product's declarable line (`POST /api/v1/market-access/manual-captures`),
  which the next run scores at quality 0.9 and labels "read from the official tariff by a ClearTrade
  agent".
- **Pegged currencies (D-025).** `curated:currency-pegs`: 14 currencies the ECB does not publish (AED,
  BAM, BHD, BND, BTN, KMF, NPR, OMR, QAR, SAR, XAF, XCD, XOF, XPF) convert through their anchor's ECB
  rate on the run date; the frozen rate names the parity and its source. A stored ECB rate always
  comes first. Floating currencies the ECB lacks (LKR, TWD, VND and others) stay unconverted.
- **Logistics estimate (policy v5, D-025).** Where no World Bank LPI is usable, logistics uses the LPI
  that UNCTAD's liner shipping connectivity index predicts (`wdi:IS.SHP.GCNW.XQ`), fitted on the run's
  markets with both; labelled as an estimate, quality 0.5, the fit frozen in `logistics_estimate`.
  Landlocked markets have no index and stay unscored.
- **Sanctions programmes (D-025).** `curated:sanctions-programmes`: UN Security Council country
  regimes (14 markets), US comprehensive (Cuba, Iran, North Korea) and sectoral (Russia, Belarus,
  Venezuela) programmes and EU regimes (Russia, Belarus, Iran, North Korea), shown as flags on the
  market. A flag never changes a score; North Korea stays excluded by policy (D-016).
- **Owner decisions of 14 Oct 2026 (E-018).** Tariff look-up inside runs: built, behind a switch
  (D-020). World Bank age limit: 10 years (D-021). The release-level Comtrade fallback of §3.3: not
  built (D-022) — an environment with no BACI release keeps the earlier engine, and the BACI import
  is part of each environment's bootstrap (§10).

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
- World Bank values more than 10 years old count as missing (D-021). With that limit 184 of the 218
  markets have a tariff average and 166 a logistics score; values up to 10 years old are still used.
- Where the tariff publishes a preference for India (policy v6), the score assumes the exporter
  can prove Indian origin; one who cannot pays the standard rate shown beside it. Evidence stored
  before 18 Oct 2026 lacks the pack's parsed preferential duty, so a preference written only as
  "Free" there is shown, not scored, until the product is looked up again. The estimate path
  likewise assumes an agreement in force is used (§4.7).
- A specific duty's percentage uses the FOB unit value of the market's suppliers; customs value is
  usually CIF, so the derived percentage reads slightly high.
- The weights are judgment until deal outcomes exist; refit them then.
- Licence: R-14 (Comtrade, accepted by the owner), R-15 (BACI built on Comtrade data; legal check),
  ECGC and World Bank terms to confirm.
- GeoDist dates from 2011: South Sudan, Montenegro, Bonaire, Sint Maarten, Saint Barthélemy and the
  Holy See have no capital row there; their capitals come from the curated supplement. The ECGC list
  does not rate Saint Barthélemy.
- A duty estimate from a customs union (policy v4) uses the union's common external tariff as the
  World Bank reports it for a member (Germany for the EU): it inherits that member's data year.
- The ECGC parser reads one layout. A new circular that changes it fails the import with the line
  that broke; it is never half-read.
- A published rule (policy v5) covers ordinary goods only; the goods it leaves out fall back to the
  estimate, and Saint-Barthélemy's and Timor-Leste's rates are levies on all goods rather than a tariff
  schedule. Rules stop applying after their review date until checked again.
- An agent-read line is as good as the reading: the record keeps the reader, the source address and
  the date, and v5 gives it quality 0.9, not 1.
- The logistics estimate assumes that LPI and shipping connectivity move together; the fit's r² is
  recorded with every estimate. WDI's copy of the index ends in 2020 for most markets.
- Sanctions programmes change often; the curated list carries the day it was checked and must be
  re-checked monthly. It holds country programmes only — named people and firms are screened per buyer.

## 10. Bringing an environment up (operator runbook)

Run from the repository root on a machine that can reach the environment's database (TCP proxy) and
bucket, with that environment's operator env file (for staging, the one kept in the gitignored
`tmp/rw/`, docs/33 §3). Every import checks the database identity first, refuses a file whose sha256
differs from the one stated, runs twice and requires the second run to be UNCHANGED. Nothing here
touches production.

1. **Code and schema.** The v5 branch is merged and deployed; the pre-deploy step applies migrations
   `20261013100000`, `20261013180000` and `20261013181000`; `/api/health/ready` is `ready`. The
   deploy restarts the worker, which must happen after a new `JobType` (AGENTS.md).
2. **BACI** (about 1.1 GB; the import streams each archive into year/chapter partitions in the bucket):

   ```
   npx tsx --env-file=<env> scripts/import-trade-dataset-release.ts --file=<dir>/BACI_HS17_V202601.zip \
     --expect-sha256=16aaa22d3b000cc87744c2c28ac97ce44394c3adf315ec259451d5bb4fcae609 --version=V202601 --hs-revision=HS17 \
     --source-url=https://www.cepii.fr/DATA_DOWNLOAD/baci/data/BACI_HS17_V202601.zip --retrieved-at=2026-10-13 --actor-email=<operator>
   npx tsx --env-file=<env> scripts/import-trade-dataset-release.ts --file=<dir>/BACI_HS22_V202601.zip \
     --expect-sha256=376f9b4cda53710a580f347b9bae69c5fb16911d0ae19b50896c109bd5dfb1f7 --version=V202601 --hs-revision=HS22 \
     --source-url=https://www.cepii.fr/DATA_DOWNLOAD/baci/data/BACI_HS22_V202601.zip --retrieved-at=2026-10-13 --actor-email=<operator>
   ```

   Each release's validation must list `iso2_from_iso3: [{ provider_code: "516", iso2_cell: "", iso3: "NAM", iso2: "NA" }]`.
3. **World Bank indicators** (files from 13 Oct, sha256 in `data/dd5-snapshots/manifest.json`):
   `--dataset=wdi:LP.LPI.OVRL.XQ` (`d44b7fd4…`), `wdi:TM.TAX.MANF.SM.AR.ZS` (`ed0c03e4…`) and
   `wdi:TM.TAX.TCOM.SM.AR.ZS` (`e292f1e0…`) through `scripts/import-reference-dataset.ts`, each with
   `--source-url` set to its API URL in that manifest and `--retrieved-at=2026-10-13`.
4. **Comtrade reporting lists**: download `https://comtradeapi.un.org/public/v1/getDa/C/A/HS?period=2024`
   and `…period=2025` (public, no key), then import each as `comtrade:availability:2024` /
   `comtrade:availability:2025` with its own sha256 and the download date.
5. **Files in the repository** (provenance comes from `data/reference/manifest.json`; the derived ones
   need no `--source-url` or `--retrieved-at`):

   ```
   npx tsx --env-file=<env> scripts/import-reference-dataset.ts --dataset=ecgc:country-risk:short-term \
     --file=data/reference/ecgc-country-risk-st-2026-07-01.txt --expect-sha256=7985b79e392e2b2144aea565c5fbe5f867a03ecc2c55680b2da3ac3c77f40311 --actor-email=<operator>
   npx tsx --env-file=<env> scripts/import-reference-dataset.ts --dataset=cepii:geo_cepii \
     --file=data/reference/geo_cepii.csv --expect-sha256=cd6398aef5bdf655e09e646a7082d2c844f3d2fab47d37c6fd6922cfed4afe93 --actor-email=<operator>
   npx tsx --env-file=<env> scripts/import-reference-dataset.ts --dataset=india:trade-agreements \
     --file=data/reference/india-trade-agreements-v1.json --expect-sha256=0e2588c971dd25605033f74cfb62e94b2d4b17486560e54ad104919d678d8075 \
     --source-url=https://github.com/bhvyashrma17/cleartrade-ai-build-spec/blob/<merged commit>/data/reference/india-trade-agreements-v1.json \
     --retrieved-at=2026-10-13 --actor-email=<operator>
   npx tsx --env-file=<env> scripts/import-reference-dataset.ts --dataset=curated:capitals-supplement \
     --file=data/reference/capitals-supplement-v1.json --expect-sha256=b799dd988c6f0a63b6991b484775bb3d0207ed8b046a50d2c0a73796e40e0823 \
     --source-url=https://github.com/bhvyashrma17/cleartrade-ai-build-spec/blob/<merged commit>/data/reference/capitals-supplement-v1.json \
     --retrieved-at=2026-10-14 --actor-email=<operator>
   npx tsx --env-file=<env> scripts/import-reference-dataset.ts --dataset=curated:currency-pegs \
     --file=data/reference/currency-pegs-v1.json --expect-sha256=64ddb6d2a46fb8372022072f1741b3cb61fc057411e533b56bc9ace0769c0825 \
     --source-url=https://github.com/bhvyashrma17/cleartrade-ai-build-spec/blob/<merged commit>/data/reference/currency-pegs-v1.json \
     --retrieved-at=2026-10-17 --actor-email=<operator>
   npx tsx --env-file=<env> scripts/import-reference-dataset.ts --dataset=curated:sanctions-programmes \
     --file=data/reference/sanctions-programmes-v1.json --expect-sha256=bf2660faae28a456ab5cb2f6e8d94d526d318023947ba57c872741df69a56c50 \
     --source-url=https://github.com/bhvyashrma17/cleartrade-ai-build-spec/blob/<merged commit>/data/reference/sanctions-programmes-v1.json \
     --retrieved-at=2026-10-17 --actor-email=<operator>
   ```

   Shipping connectivity (policy v5): download
   `https://api.worldbank.org/v2/country/all/indicator/IS.SHP.GCNW.XQ?format=json&per_page=20000&mrnev=1`,
   then import it as `--dataset=wdi:IS.SHP.GCNW.XQ` with its own sha256, that URL as `--source-url` and
   the download date as `--retrieved-at`.

   R-19, once: `pdftotext -layout <ECGC PDF> -` and a CSV export of `geo_cepii.dta` should reproduce
   the two derived files byte for byte; if not, diff before importing the re-derived file.
6. **Check.** `/ops/discovery` shows "Runs can start", no dataset "Not imported", official tariff
   look-up on and ECB rates fetched by runs when missing. Customs Atlas releases must be active in the
   environment (docs/33 §3 step 4) for the look-up to find release-backed tariffs.
7. **Archetype runs** (D-003): for a paid test tenant, create rice `100630`, brassware `741810` and
   carpets `570110` and confirm each classification; v5 starts by itself. When each run finishes:
   `npx tsx --env-file=<env> scripts/dd5-compare-top10.ts --run=<run id>`. `verdict: calibration_failure`
   (the top 10 leaves out more than half of India's ten largest destinations) is a finding to
   investigate through `missed`, not a pass.
