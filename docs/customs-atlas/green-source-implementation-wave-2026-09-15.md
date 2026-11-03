# Customs Atlas green-source implementation wave

**Decision date:** 15 September 2026

**Starting checkpoint:** `d2420f3c0e0550f45bef82493f0243fea9103847`

**Attempted:** Nepal, Bhutan, Montenegro, Albania, North Macedonia, Mauritius

**Implementation-qualified:** Nepal, Bhutan, Albania, Mauritius
**Returned to individual investigation:** Montenegro, North Macedonia

## Shared release contract

The four activated packs use one immutable ZIP release contract: `acquisition.json`, every retained
artifact with URL/role/size/SHA-256, and sorted `normalized-lines.json`. The reader authenticates the
whole artifact set, exact country/release/acquisition version, every component hash, rights evidence,
scope flags, row shape and unique code count. Reader and parser versions are separately recorded on
`AuthorityRelease`; a changed format requires a version bump and prior releases remain replayable.

`OFFICIAL_PDF_TABLE` uses coordinate-aware page parsing plus country layout profiles. It fingerprints
PDF page count, bounded table pages, column anchors, code-column tolerance and exact unique-row count.
Continuation rows are joined only below the table header, printed ordinal bands are excluded, cells
are clipped to calibrated column bounds, and blank cells remain `none` rather than zero.

`VERSIONED_ARCHIVE` reuses the same authenticated manifest/release/version-dispatch mechanics. Albania
uses its own table profile; the family label describes release mechanics, not a claim that Balkan PDF
layouts or national rates are interchangeable.

Mauritius uses the common reader with a local ordered amendment layer. The 13 August baseline is
followed by six explicit `REPLACE` operations from the 4 September VAT annex. All later notices through
15 September are retained; notices that change procedure, payment timing or ruling status are not
misrepresented as commodity rates.

## Qualification record

| Country | Family | Authority artifact SHA-256 | Rows | Effective date | Result |
|---|---|---|---:|---|---|
| Nepal | `OFFICIAL_PDF_TABLE` | `2ed7d946b52e5e57fea1eaa2c3f3e5bb71a96770ce98a79a55cc2d537ba8d30d` | 6,144 | 17 Jul 2026 | Qualified |
| Bhutan | `OFFICIAL_PDF_TABLE` | `186e9df1fef0b9d540e04ebf19bcfe72d503b67eb58f994c062ecf3d59427c92` | 5,864 | 30 Jul 2026 | Qualified |
| Albania | `VERSIONED_ARCHIVE` | `30d4a16cc998db4a0e6f3c95770bbdb66ce9ab8e826aa7d47fe790d902066815` | 8,278 | 1 Jan 2026 | Qualified |
| Mauritius | `BASELINE_PLUS_AMENDMENTS` | `26c0e4c6764096639bfb3cbc4dd683eb389c99d45758d2344f7df17c9e65fe11` | 6,920 | 13 Aug 2026 | Qualified, plus six replacements effective 4 Sep 2026 |

Duty expressions retain authority text and distinguish ad-valorem, specific, compound/mixed,
expressly free/zero, blank and unparsed. `unparsed` is a fail-closed state, never a scalar estimate.
Customs duty remains separate from Bhutan GST/excise and Mauritius excise/VAT. Nepal's SAARC column,
Bhutan's bilateral zero rule and Mauritius's INDIA column produce only
`potentially_applicable_requires_origin_proof`; `origin_country=IN` never establishes origin.
Albania's reviewed complete programme index excludes India, producing `not_applicable`.

All four packs declare `tariff_treatment_complete=true` and
`regulatory_coverage_complete=false`. The latter means missing permit/control data is unknown, never
“no restriction.” Rights evidence is retained as checksumed reviewed legal citations alongside the
official tariff facts. It expressly excludes claims over website presentation, software, third-party
content or protected compilation expression.

## Isolated failures

- **Montenegro:** the official 2026 regulation and WAPI identity were located, but repeated requests
  to the authenticated Government endpoint timed out without bytes. Without the artifact there is no
  defensible page/row/currentness qualification. The existing structured blocker remains and now
  names the exact WAPI artifact.
- **North Macedonia:** Customs exposes the annual RAR and correlations, but the official source served
  an expired TLS certificate. Bypassing certificate validation is prohibited; no such bytes were
  retained. The structured blocker remains until an authenticated official acquisition is possible.

These failures do not weaken or substitute the four successful national executions. They reduce the
wave result from the anticipated five or six to four: the operational destination count moves from
41 to 45 after staging qualification.
