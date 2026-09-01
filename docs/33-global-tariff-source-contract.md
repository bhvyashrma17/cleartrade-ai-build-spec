# Global tariff source contract

Research record from Confidence Closure Step 2, which investigated whether a single global source could
close the Market Access evidence gap across 120+ destinations. It could not. This document exists so the
investigation is not repeated: every finding below was obtained by querying the real source or reading the
publisher's own terms, not from secondary description.

No WTO or TRAINS provider code exists in this repository, and none should be written on the strength of
this document alone. See `src/lib/market-access/unconfigured-sources.ts` for the machine-readable form of
the licensing determinations.

## WTO — licence blocked

The WTO Timeseries API (`api.wto.org/timeseries/v1`) covers applied and preferential tariffs and is the
obvious global backbone candidate. It is not usable here.

Access requires a subscription key: an unauthenticated request returns `HTTP 401 — "Access denied due to
missing subscription key."` Sign-up is free and self-serve, so the key is not the obstacle.

The obstacle is licensing. The WTO's own copyright page states that **commercial use of WTO material
requires written permission from the WTO**, requested by email. ClearTrade is a commercial, customer-facing
product that re-disseminates tariff evidence to paying exporters, which is squarely commercial use. The WITS
terms and conditions confirm the same constraint from the other direction: re-dissemination of WTO IDB/CTS
data "beyond the purpose of publication of analytical work must be approved by the WTO Secretariat", and
publication by authorised users "should not be more detailed than the level of HS six-digit subheadings".

No such permission is recorded in this repository. Obtaining it is a viable future path — it is an email
request, not a technical barrier — and would make WTO a corroboration source. Until it is recorded, WTO
data must not be ingested. Legal uncertainty must not be shipped as a technical success.

## UNCTAD TRAINS via WITS — licence unresolved

WITS (`wits.worldbank.org/API/V1/SDMX/V21/datasource/TRN/...`) serves UNCTAD TRAINS tariff data and, unlike
the WTO API, answers without any credential. The World Bank's default data licence is CC-BY 4.0, which
permits commercial use, and that is what makes TRAINS look promising at first glance.

It does not survive checking. CC-BY 4.0 covers World Bank-produced data; TRAINS is UNCTAD's, maintained by
UNCTAD and merely hosted on World Bank infrastructure, and the World Bank licence catalogue explicitly
carves out "externally-licensed datasets with third-party terms". The WITS terms and conditions state that
TRAINS access is "free of charge and unlimited" but then defer re-dissemination terms to a separate UNCTAD
document, and UNCTAD's public dissemination pages do not state those terms. The re-dissemination question is
therefore unanswerable from published sources — the same category of legal uncertainty that blocks WTO,
without even a documented permission route.

## TRAINS is not a tariff of record

The licensing question is ultimately moot, because TRAINS is structurally the wrong kind of data. It
publishes **statistics about tariff schedules**, not the duties a shipment pays. Every observation carries
`OBS_VALUE_MEASURE="SimpleAverage"`.

The decisive observation, from a real query for EU rice (reporter 918, HS 100630, 2020):

    TOTALNOOFLINES="72" NBR_MFN_LINES="0" NBR_NA_LINES="72"
    OBS_VALUE="0" MIN_RATE="0" MAX_RATE="0" TARIFFTYPE="MFN"

All seventy-two EU rice lines are counted as "not available" because none can be expressed as a percentage,
and the reported value is then **zero**. The EU's actual duty on milled rice is a specific duty of roughly
EUR 175 per tonne. A naive ingest would tell an Indian basmati exporter that the EU charges nothing, and that
figure would flow into landed-cost economics, understating cost and making the destination look artificially
attractive. This is exactly the "missing becomes zero" defect the evidence architecture exists to prevent,
and it is optimistically biased, which is the dangerous direction.

Three further limits follow from the same aggregate design:

- No specific, compound, mixed, minimum or maximum duty can be represented at all. The schema carries a
  single numeric percentage, so a non-ad-valorem duty can only be dropped, never expressed.
- No national tariff line codes are returned. Observations are HS6 aggregates, so the HS6-to-candidate-lines
  refinement the Market Access contract is built on cannot be performed from this source.
- No regulatory, SPS, TBT or licensing coverage is included, so the regulatory half of Market Access is
  untouched regardless of tariff coverage.

The averaging also destroys the answer even where every line is ad valorem. For a cricket bat (reporter 840,
HS 950669) the response carries `MIN_RATE="0"`, `MAX_RATE="5.4"` and `OBS_VALUE="3.43…"`: the reported rate
is one no shipment ever pays, because the true rate depends on which of the three national lines the goods
classify into.

## What TRAINS could honestly support

The accompanying counts are genuinely machine-readable and, unlike `OBS_VALUE`, they do not lie. Were TRAINS
ever licensed, it could serve as a triage or corroboration signal on these rules, and never as the tariff of
record:

- `NBR_NA_LINES > 0` means at least one line is not expressible as a percentage. The observation must be
  refused as not-expressible or needs-review. It must never be read as zero.
- `MIN_RATE == MAX_RATE` with `NBR_NA_LINES == 0` is evidence that the candidate lines carry materially
  equivalent treatment, which is the same condition the TARIC path already calls `all_children_equivalent`.
- `MIN_RATE != MAX_RATE` means the candidate lines disagree and classification refinement is required.
- `NOMENCODE` carries the HS revision and must be honoured rather than assumed: the same query returned `H5`
  for 2020 and `H6` for 2023, so a six-digit code is not comparable across periods without a concordance.

Preference data is present (`TARIFFTYPE="PREF"`) and behaves sensibly. For EU rice, India is correctly absent
from the preferential partner list, because no EU–India rice preference exists. That is the right answer, and
it also means TRAINS offers nothing for the flagship EU/India/basmati case beyond the misleading zero.

## Conclusion — national authorities remain the strategy

There is no global tariff source that is simultaneously licensed for commercial re-dissemination and capable
of line-level duty evidence. The existing design is correct: authoritative national providers (EU TARIC, the
UK Integrated Online Tariff, USITC HTS) producing real duty expressions on real declarable lines, admitted
only as `authoritative_public`. Coverage extends by adding national providers one at a time, not by layering
a global average over them.

Two constraints should inform any expectation of what such work buys. Market Access sub-signal weights are
`tariff: 60, regulatory: 40`, so tariff evidence alone leaves the component partial. The regulatory half
additionally requires a source proving `completeness === 'COMPLETE'` and refreshed within
`maximum_coverage_age_days`, which no aggregate source supplies.

## Commercial provider evaluation

Ruling out WTO and TRAINS removes two free sources, not the requirement for global coverage. The remaining
route is licensed commercial trade content. What follows is a documentation-level comparison only: no vendor
has been contacted, no contract exists, and no integration code has been written.

Everything in the table below is from published vendor documentation. The decisive facts for this
architecture — duty representation, redistribution rights and pricing — are **not published by any of them**
and can only be settled by sales contact.

| | e2open Global Knowledge | Descartes CustomsInfo | Avalara Trade & Tariff Library | Zonos |
|---|---|---|---|---|
| Destinations | 230+ countries/territories | 190+ countries | not published | 200+ countries |
| National tariff lines | stated explicitly | stated | HS-6 or HS-10, 10-digit in docs | via classification |
| FTA / rules of origin | ~240–250 FTAs incl. rules of origin | preferential tariff detail | origin-specific duty (CN→US) | not a focus |
| Regulatory / licensing | permits, documentation, licensing, 5,000 agencies | OGA, restrictions, licensing, safety certs | restrictions, some regulatory | minimal |
| Historical / effective dates | continuous updates | rulings and directives | date-ranged retrieval API | not published |
| API | REST, feeds partner platforms | REST, JSON/XML | REST + documented MCP server | GraphQL + legacy REST |
| Public pricing | none | none | none | none |

On published evidence e2open has the broadest destination coverage, the only explicit rules-of-origin corpus
at FTA scale, and the deepest regulatory content. Descartes is the closest equivalent with narrower coverage.
Avalara has by far the best-documented developer surface and is the only one publishing a date-ranged
historical tariff endpoint, which maps well onto immutable evidence, but it is a landed-cost tax product
first and its regulatory depth appears shallower. Zonos is developer-friendly but oriented to ecommerce
checkout rather than trade-content licensing, and is not competitive for the regulatory half.

## The assertion-class problem applies to every vendor

This is independent of which vendor is chosen and must be settled before any integration.

Market Access admits evidence only from `allowed_assertion_classes: ['authoritative_public']`. The defined
classes are `authoritative_public`, `system_derived`, `agent_verified`, `partner_quote`, `exporter_declared`
and `unknown_legacy`. **There is no class for licensed commercial content**, and a vendor does not fit the
existing ones: `authoritative_public` means the authority's own machine-readable response, `agent_verified`
means a named ClearTrade reviewer reading a publication, and `partner_quote` is commercial freight pricing.

A commercial vendor is a third party asserting what an authority published. Filing that as
`authoritative_public` would erase exactly the distinction `manual-authoritative.ts` exists to protect — that
blurring the government's own response with someone's report of it is how an unverifiable claim acquires the
authority of a primary source. Filing it under an existing lower class leaves it excluded from Market Access
entirely, which makes the integration pointless for closing the gap.

Integrating any vendor therefore requires a deliberate decision to introduce a new assertion class for
licensed content, with its own confidence multiplier and an explicit policy change admitting it to Market
Access. That is a semantic decision about evidence epistemology, not a connector detail, and it caps what the
integration can contribute: a multiplier below 1.0 limits the component's reachable confidence.

Source precedence is unaffected: TARIC, the UK tariff and USITC remain preferred for their jurisdictions, and
a licensed-content observation must never displace a national-authority one.

## Acceptance test for any vendor trial

The EU rice case that disqualified TRAINS is the sharpest available discriminator and should be the first
request made of any vendor sandbox, before commercial discussion goes far:

> For HS 100630 into the EU, return the duty applicable to goods originating in India.

A usable vendor returns a **specific duty of roughly EUR 175 per tonne, carrying its own amount, currency and
unit**, and reports no India preference because none exists. A vendor that returns `0`, or an ad-valorem
percentage, or silently omits the line, has the same defect as TRAINS and must be rejected regardless of
coverage claims or price.

Alongside it, the following must be obtained in writing, since none are published:

- redistribution and embedding rights inside a commercial customer-facing product;
- whether specific, compound, mixed, minimum and maximum duties are returned as structured fields rather than
  collapsed into a single percentage;
- whether the vendor will contractually warrant regulatory completeness per destination, which is what the
  `completeness === 'COMPLETE'` requirement depends on;
- provenance depth: source citation, effective dates and a stable version or snapshot identifier per record,
  sufficient for immutable `SourceEvidence`;
- sandbox availability, authentication model, rate limits and pricing.
