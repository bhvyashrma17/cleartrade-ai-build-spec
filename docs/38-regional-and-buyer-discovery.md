# Regional and buyer discovery (D-033)

Stages 2 and 3 of the product order (Country Demand Discovery → **Regional Demand Discovery** →
**Real Buyer Discovery** → Buyer Verification & Enrichment → Outreach). The owner asked on 22 Oct 2026
for both to work end to end on staging for a smaller set of markets ahead of a pitch on 24 Oct, with
country expansion (D-030) on hold. Scope chosen by the owner: the United States, the United Kingdom
and Canada; demonstration product carpets (HS 570110). Every figure comes from a free official source
and names it.

| Market | Regional demand | Real buyers |
|---|---|---|
| United States | Census Bureau: imports by destination state and by port, per HS6, from India and from all countries, monthly | No free source. CBP's vessel manifests are a paid subscription (docs/15) |
| United Kingdom | Importers of the product counted by region, from the postcodes in HMRC's list | HMRC's monthly list of businesses importing each 8-digit commodity code |
| Canada | Importers counted by province (when the list is imported) | ISED's Canadian Importers Database: major importers by HS6 and by country of origin. **Reader not built yet**: ISED's site was down for maintenance on 22 Oct 2026 |

## 1. Regional demand

A v5 market with a regional source gets a section on its market page, "Where in <country> it is
imported". The figures are read by a background job (`regional_demand_discovery`) and stored once on a
`RegionalDemandRun` row (`result`); they are never recalculated afterwards. A run starts in three ways:

1. **Hand-off (D-019).** When a v5 run finishes, each of its handed-off top-10 markets with a regional
   source is requested automatically (`requestHandOffRegionalDemand`). A hand-off that cannot start is
   recorded in the v5 job's result and never fails the v5 run.
2. **The market page.** A paid exporter (or their agent or ops) presses "Show where in …" for any v5
   market with a source. Requests need `demand_discovery.run` and access to the market's exporter.
3. **The operator script.** `scripts/regional-demand.ts request --run=<id>` asks for every supported
   market of a run; `status --run=<id>` prints the results.

An unfinished run for the same market is reused rather than duplicated. The job type is costed (paid
tenants only), like Demand Discovery itself.

### 1.1 United States (Census Bureau)

`src/lib/regional-demand/census.ts`. Four requests per run to
`https://api.census.gov/data/timeseries/intltrade/imports/{statehs,porths}`: each dataset for India
(Census country code 5330) and for all countries (`-`), for the market's HS6, from 15 months back. The
12 newest calendar months are kept. Per state and per port: India's value, the all-origins value,
India's share, India's containerised-vessel value and shipping weight, India's air value, and the
number of months India shipped. The top 15 of each are listed; the rest are summed in one row.

- **Key.** The API requires a free key (`CENSUS_API_KEY`, docs/28). It is sent only as a query parameter
  of the request, never stored, logged or shown; the stored request URLs have it removed. Without a key,
  or with a refused one, the run is `unavailable` with the reason and the page says so.
- **Failures.** An unreachable source or an unexpected answer fails the run and the job retries. A failed
  all-countries request only removes the shares, with a note.
- **Attribution.** Census terms require the notice "This product uses the Census Bureau Data API but is
  not endorsed or certified by the Census Bureau." It is stored with every result and shown under it.
- **What the figures mean.** States are the destination state recorded on the import entry; ports are
  where the goods entered the United States. Values are customs values in US dollars (general
  imports); container figures are shipments in containers by vessel; weights are shipping weights.
  The figures describe recorded trade, never a forecast (docs/14 §3a).

### 1.2 United Kingdom and Canada (official importer lists)

`src/lib/regional-demand/importer-regions.ts`. These lists say who imports, never how much, so the
regional view counts the businesses listed with the product's HS6 in the newest active list, by
region (UK: the ITL1 region of the postcode area, `buyer-discovery/uk-regions.ts`; a few postcode
areas cross a boundary) or by province (Canada), with the most common towns. No key is needed; with
no list imported the run is `unavailable` and says so. The notice "Contains public sector information
licensed under the Open Government Licence v3.0." is shown under the UK figures.

## 2. Real buyers

Buyer discovery is agent-curated (docs/11 §7): agents assigned to the exporter and ops start it, from
the "Find buyers from official importer lists" form on the agent's Exporter 360 (Buyers tab), from
`scripts/buyer-discovery.ts request`, or automatically for a v5 run's handed-off top-10 markets in the
UK or Canada (D-019). Exporters do not run it; their market page now says how many importers were found
and that their agent reviews them, instead of linking to a search that refused them.

### 2.1 The lists

Imported by operations staff with `scripts/import-importer-list.ts` into `ImporterListRelease` (one
row per file set and period, identified by the sha256 of its file manifest) and `ImporterListEntry`
(one row per importer: name and address as published, town, postcode, region, the codes, their HS6
headings). The same bytes again are UNCHANGED; a new file for a period already imported supersedes it;
other periods stay active, because each month is its own list.

- **HMRC importer details** (`uk_hmrc_importers`, Open Government Licence v3.0). One ZIP per month from
  UK Trade Info's bulk data sets: a tab-separated file, no header — period, line number, trader name,
  five address lines, postcode, up to 50 eight-digit codes, continued on further lines for traders with
  more. Codes imported by fewer than three traders in a month appear only as the chapter, so those
  traders are not matched to a product. Businesses can opt out, so the list is not every importer.
  August 2026: 106,285 importers; 86 list a code under 5701.10 (carpets), 184 under 1006.30 (rice), 52
  under 7418.10 (brassware).
- **Canadian Importers Database** (`ca_cid_major_importers`, Open Government Licence – Canada). Major
  importers by HS6 and by country of origin, 2023 data from CBSA. The reader is not built yet; importing
  it is refused with that reason.

Names are shown as published, including sole traders' names (D-034); no contact details are added.

### 2.2 The job

`buyer_discovery` (`src/lib/buyer-discovery/service.ts`). For one exporter, product and market it reads
the market's active lists (for monthly lists, the 12 months up to the newest), takes the importers
listed with the product's HS6, and for each one:

1. creates or updates one canonical `Buyer` (`source_entity_key` = source and importer, so the same
   importer in a later list updates its row); a name that reads as a freight or customs intermediary
   is typed `intermediary` and deprioritised;
2. records each list it appears in as `BuyerSourceEvidence`;
3. screens the name against the sanctions lists when coverage is complete — a possible or confirmed
   match blocks the buyer and opens a screening case for Ops; when coverage is incomplete, the buyer
   carries the flag "Not screened yet" (nothing is sent to buyers at this stage);
4. writes one `BuyerFitAssessment` (`buyer-official-lists-v1`, policy v1) with the reason in words.

| Component | Points | Score |
|---|---|---|
| Product match | 40 | 100 for every candidate: listed with a code under the HS6 |
| Product focus | 30 | Share of the importer's published codes in the product's chapter |
| Buys it from India | 20 | Canada only: listed as importing the HS6 from India (100) or not (0) |
| Months listed | 10 | Monthly lists: months listed with the HS6 over the months available; needs two or more lists |

A component the list does not publish is left out and the score is shared over the rest; confidence is
the share of components scored. The agent's Buyer Discovery control shows these components, the place
(town, postcode, region), the reason ("Imported 5701.10.10 and 5701.10.90 in Aug 2026 (HMRC importer
list).") and the address as published.
