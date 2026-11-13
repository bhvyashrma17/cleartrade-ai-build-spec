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

### 1.3 The regional view, v2 (D-048)

`src/lib/regional-demand/view.ts` and `estimate.ts` (`regional-view-v2`). Every one of the 218 markets
has a regional view, under one of six evidence labels:

| Label | What is counted | Markets today |
|---|---|---|
| Your product | Imports of the exact product code, by region | United States (Census Bureau, states and ports) |
| Product group | Imports of the wider group the product sits in | None yet (later clusters) |
| Traders | Importers or wholesalers counted by region | United Kingdom (HMRC), Canada (once its list is imported) |
| All goods | A region's or port's total imports | None yet (later clusters) |
| Estimate | Nothing official: the main cities, ranked by size | The other 88 hub-and-gateway and regions markets |
| Not needed | One search area: the whole market | The 127 one-place markets |

**Rules.** These are applied when a run is read, so stored runs are never rewritten.
- **Top 10.** A view lists its 10 largest areas and sums the rest.
- **The 80% mark.** It marks the smallest set of the largest areas that together hold 80%. When that
  set runs past the 10 listed, the view says how many it takes.
- **Ranking.** A view of values ranks by the product's imports from all origins where every area has
  them, with India's figures beside. Otherwise it ranks by imports from India: when the all-countries
  figures could not be read, or for a run stored before v2, which kept only its top 15 by India's
  value and summed the rest.
- **Lists of importers** rank by the number of importers.
- **The US view** is cut from 15 to 10. Readers now store every area; the view takes its own top 10.

**Estimates.** A market without an official source needs no run and no job: its view comes from the
regional geography (§3).
- **One place:** "Not needed". It still lists its main city and gateways.
- **Hub and gateway:** the main cities, ranked by population.
- **Regions:** the regions, ranked by the population of their cities of 300,000 or more. Regions with
  no such city are counted, not ranked.

The estimate names the geography it used (version and checksum). It says that it ranks city size,
not imports, and that it is the same for every product.

**Open for the owner.**
1. **Ranking by all origins.** D-048 (2) marks "the product's imports", so v2 ranks by imports from
   all origins and shows India's beside them. The US view used to rank by India's value. Ranking by
   India again is one line.
2. **The regional economy in estimates.** D-048 (4) names city size, regional economy and gateways.
   The regional economy (Kummu and others, CC BY 4.0) cannot be downloaded from the agent workspace
   (E-078), so estimates use city size and gateways now. Recommended and built: add the regional
   economy when its data can be read. The alternative is to hold estimates until then.

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

## 3. The regional geography of every market (D-048)

The base of the regional plan (D-048, E-076, E-077). Each of the 218 v5 markets gets a shape, its
centres (the hubs buyer discovery searches), its first-level regions with their ISO 3166-2 codes, and
its gateways. All of it comes from open data, so every market has named places to search before any
official regional figures exist. Code: `src/lib/regional-geography/`. Nothing in the product reads it
yet; the regional view, the market page and the buyer discovery card come next.

`marketGeography('AE')` → hub and gateway; centres Dubai (with Sharjah), Abu Dhabi, Al Ain; the seven
emirates as regions, each with its hubs; Dubai's port and the DXB, SHJ and AUH airports as gateways.

### 3.1 Source and build

Natural Earth v5.1.2, public domain: populated places, admin-1 states and provinces, ports and
airports, pinned by commit and sha256 in `source.ts`. `scripts/build-regional-geography.ts
--source-dir=<folder>` writes `reference/natural-earth-geography.json` (742 KB, one item per line).
It needs no network and no database, refuses a file whose sha256 differs, and writes the same bytes
from the same files. The tests pin the snapshot's sha256 (`GEOGRAPHY_SNAPSHOT_SHA256`), its canonical
form, and its 218 markets against the default screening universe.

The snapshot keeps facts only: per market, its places of 300,000 people or more (1,362), its
divisions (4,345), and its ports (1,054) and civil airports (820), each placed in a division.

- **Divisions** belong to the market of their geounit, else their country, else the country their
  ISO code names. Sint Maarten and Martinique are their own markets; Puerto Rico is the United
  States', as Comtrade counts it.
- **Places, ports and airports** belong to the division that contains them, or the nearest within
  25 km. Every kept place and gateway is placed. One place moves market this way: San Juan, into the US.
- **Pieces sharing a code** are one division (60 codes), because no buyer source can tell them
  apart: Cebu City inside Cebu, Metro Manila's 17 cities, Bosnia's 10 cantons as its Federation. A
  merged division takes its largest piece's name, or its ISO name where no piece names the whole.

### 3.2 Shape (`regional-shape-rule-v1`)

1. **Centres.** Places of 300,000 or more, largest first. Each starts a centre and takes in every
   smaller place within 30 km of it. A centre's size is its largest place's.
2. **Shape.** No centre or one → **one place**. Otherwise the effective number of centres,
   1 / Σ sᵢ² over the centres' shares sᵢ, decides: 3 or more → **regions**, fewer → **hub and gateway**.

The rule alone gives one place 128, hub and gateway 48, regions 42. Three shapes are set by hand
(`SHAPE_OVERRIDES`, each with its reason), giving the approved 127, 51 and 40:

| Market | The rule | Set by hand | Reason |
|---|---|---|---|
| Nepal | One place (Kathmandu) | Hub and gateway | Goods from India enter at border customs offices such as Birgunj and Bhairahawa |
| Egypt | Regions (3.32 effective) | Hub and gateway | Greater Cairo and the port of Alexandria; the rule counts governorate capitals of about 600,000 |
| Philippines | Regions (3.21) | Hub and gateway | Metro Manila; the rule counts cities under 1.5 million |

Merging at 20 km instead of 30 moves one market (the UAE); at 50 km, three (Belgium, the Netherlands,
North Korea). The tests hold both.

Against the table in the owner's plan (E-076) every shape is the same. Four centre counts differ:

- **Japan:** 40, not 41.
- **Mexico:** 39, not 40. Tlaxcala is 29.96 km from Puebla and merges.
- **Russia:** 66, not 68. Sevastopol and Simferopol are left out (§3.3).
- **United States:** 112, not 111. San Juan is added.

E-076 also said 20 km moves Benin. It does not here: Porto-Novo is 14 km from Cotonou and merges at
both distances.

### 3.3 Territory no market offers

Natural Earth draws Crimea and Sevastopol (UA-43, UA-40) in Russia, while ISO 3166-2 lists them in
Ukraine; both are under comprehensive US, EU and UK trade sanctions. It draws Azad Kashmir and
Gilgit-Baltistan (PK-JK, PK-GB) in Pakistan; India's official map shows them as part of Jammu and
Kashmir and of Ladakh.

`EXCLUDED_DIVISIONS` keeps all four out of every market's regions, centres and gateways, each with
its reason. The snapshot still records them. The owner decided this on 12 Nov 2026 (D-049), over the
two alternatives: following ISO 3166-2 (Crimea in Ukraine, the two Kashmir areas in Pakistan) or
Natural Earth's drawing.

### 3.4 What each market gives

| Field | Meaning |
|---|---|
| `shape` | `one_place`, `hub_and_gateway` or `regions`, with `rule` (the rule's answer, centres, effective centres) and `override` (reason, decision) beside it |
| `centres` | Name, the places merged into it, population (Natural Earth's estimate, of varying years), coordinates, region code |
| `regions` | Every first-level division: code, English and local name, type, whether the code is ISO 3166-2, and the centres inside it |
| `gateways` | Ports and civil airports: name, IATA code, region code, Natural Earth's map rank (drawing order, not cargo) |
| `excluded_divisions` | §3.3 entries that applied to this market |

The registry's `checksum` covers every market and the versions, so a stored regional view can name
the geography it used.

### 3.5 Known limits, for the reviews

The top-30 review (D-048) checks each of these against official sources, market by market. The
cluster reviews cover the rest.

- **Out of date.** Some divisions predate reforms: Nepal's 14 zones (7 provinces since 2015),
  Vietnam's 63 provinces (34 since 2025), Madagascar's six ISO provinces (22 regions since 2009).
- **A different level from the statistics office.** The UK has 232 councils where HMRC uses 12
  regions. France is listed by département, Italy and Spain by province.
- **Wrong codes in Natural Earth, merged with a neighbour.** Bogotá under Cundinamarca, Alborz under
  Tehran, Almaty city and region, Lima's capital district and region, two Croatian counties, East
  and South Darfur, Vientiane prefecture and province, Malé and Meemu, five Latvian city and
  municipality pairs.
- **Placeholder codes.** 108 divisions carry Natural Earth's own codes (`HK-X01~`), among them Hong
  Kong's 18 districts; no buyer source filters by them.
- **Gateways.** Natural Earth's ports and airports only: no land border posts (Benapole, Birgunj,
  Phuentsholing), and 15 markets with none at all, among them Bhutan, Tajikistan and South Sudan.
  Some names carry Natural Earth's spelling errors ("Sheremtyevo").
- **Places.** 70 markets have no place of 300,000 or more: they are one search area, the whole market.
