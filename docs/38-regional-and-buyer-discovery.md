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
| United Kingdom | From the importer list's postcodes (next PR) | HMRC's monthly list of businesses importing each 8-digit commodity code (next PR) |
| Canada | From the importer database's cities and provinces (next PR) | ISED's Canadian Importers Database: major importers by HS6 and by country of origin (next PR) |

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

## 2. Real buyers

Built in the next PR.
