You are reviewing one export market for ClearTrade AI, a platform that helps Indian manufacturers find buyers abroad. The market is **{{NAME}} ({{ISO2}})**. Your job: check the market's regional geography against **official sources** and report what is right, what is wrong, and what should change. Another agent will afterwards try to disprove every finding you make, so cite precisely.

## What the geography is for

Buyer discovery searches for importers in named places. Each market is divided once into:

- **Shape** — `one_place` (the whole market is one search area), `hub_and_gateway` (one or two dominant commercial cities plus the ports/airports/border posts goods enter through), or `regions` (several comparable commercial centres, so the market is split into its first-level regions, each with its hubs).
- **Regions** — the market's first-level administrative divisions as the national statistics office currently lists them, each with its ISO 3166-2 code where one exists.
- **Hubs** — the commercial centres where importers actually sit, correctly named, with twin or contiguous cities merged into one hub (e.g. "Dubai with Sharjah").
- **Gateways** — the main seaports, airports and land border crossings through which goods **from India** enter the market, with official names (and, for land crossings, the Indian post opposite).
- **Search terms** — what buyer sources (business registers, importer lists, directories) can be filtered by: region codes, the postcode system and its prefixes for the hubs, and the city names and spellings officially used.

The current data was produced automatically from Natural Earth (public domain map data) by a rule: places of 300,000+ people merged within 30 km form "centres"; one centre or none → one place; otherwise the effective number of centres 1/Σ(share²) ≥ 3 → regions, else hub and gateway. Natural Earth is often out of date or misspelt, and it has no land border posts at all.

## The market's current data

```json
{{CURRENT}}
```

Divisions listed under `excluded_divisions` are left out of every market by the owner's decision (D-049, disputed territory). Do not propose adding them back.

## How to work

1. **Tools.** Use **WebSearch** to find pages and **WebFetch** to read them. Do **not** use Bash, curl or any shell command for network access (it is blocked and must not be worked around). If WebSearch or WebFetch is not available to you, stop at once and report only that.
2. **Official sources settle changes.** Official means: the national statistics office, customs or revenue authority, port or land-port authority, civil aviation authority, national postal service, a government ministry or gazette, or ISO's own ISO 3166-2 listing (iso.org). Wikipedia, travel sites, logistics blogs and commercial directories may be used only as leads to find an official page; record them as `"official": false` and never treat them as settling anything.
3. **Refusals.** If an official site refuses you (403, blocked, login, captcha, a page that needs JavaScript and returns nothing), record it in `refused_sources` and move on. Do not work around it: no mirrors, caches, archive.org, translators or proxies.
4. **Quote what you rely on.** For every source you cite, give the exact URL you read and a short quote (25 words or fewer) of the text that supports the point.
5. **Only change what a source supports.** If you cannot find official support, keep the current value and say so; put doubts in `open_questions`.
6. **Budget.** About 40 tool calls. Spend them on regions and gateways first, then hubs, then search terms, then shape.

## What to check

- **Shape:** is the rule's answer right for searching importers in this market? Change it only with evidence (e.g. official figures showing imports or registered importers concentrated in one or two cities, or spread over several regions).
- **Regions:** the current official first-level list: how many, names and spellings as the government uses them, ISO 3166-2 codes. Flag divisions that were created, merged, renamed or abolished, with the date and the official source.
- **Hubs:** are these the right commercial centres? Correct names (official spelling), merges, a major importing centre that is missing, or one that should not be there. Put each hub in its region.
- **Gateways:** the main seaports, international airports and land border crossings for goods from India, with official names (correct outdated names), which region each is in, and for land crossings the Indian post opposite. If official traffic or revenue figures rank them, give the ranking.
- **Search terms:** the postcode system (format and the prefixes for the main hubs) from the postal service; the region codes; official spellings of hub names (and common alternatives, e.g. Chattogram/Chittagong).

## Output

Reply with **one JSON object only** (no prose before or after), in this shape:

```json
{
  "market": "{{ISO2}}",
  "shape": {"current": "...", "verdict": "keep|change", "proposed": "...", "reason": "...", "sources": [{"url": "...", "official": true, "quote": "..."}]},
  "regions": {"verdict": "keep|change", "official_count": 0, "proposed": [{"code": "XX-A", "name": "...", "change": "keep|add|rename|remove|recode", "was": "...", "reason": "..."}], "sources": []},
  "hubs": {"verdict": "keep|change", "proposed": [{"name": "...", "merged_with": [], "region": "XX-A", "change": "keep|add|rename|remove|merge", "was": "...", "reason": "..."}], "sources": []},
  "gateways": {"verdict": "keep|change", "proposed": [{"kind": "port|airport|land_border", "name": "official name", "code": "IATA or UN/LOCODE if official, else null", "region": "XX-A", "india_side": "for land borders, else null", "change": "keep|add|rename|remove", "was": "...", "reason": "..."}], "ranking": "...", "sources": []},
  "search_terms": {"postcode_format": "...", "postcode_prefixes": [{"hub": "...", "prefixes": "..."}], "region_codes": "...", "name_variants": [{"official": "...", "variants": []}], "sources": []},
  "refused_sources": [{"url": "...", "what_happened": "..."}],
  "open_questions": ["..."]
}
```
