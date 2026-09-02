# Coverage optimizer — build-priority scoring

This ranks **build order**, not country importance and not Country Truth attractiveness. It is
completely separate from Country Truth scoring — nothing here feeds `src/lib/config.ts`'s
`market_access` weights, and nothing here should. A destination scoring low here can still be a
great export market; it just means the authority is harder or riskier to acquire cleanly first.

## Method

Ordinal, transparent, computed directly from the qualitative fields already recorded in
`authority-registry.json` (not a second, hidden judgment layer). Every input maps through one of
four fixed tables below; nothing here claims false numeric precision — a "19.0" and a "17.0" are
close calls, not a 2-point gap worth defending.

**Positive factors**

| Factor | Source field | Scale |
|---|---|---|
| Destinations unlocked | `destinations_unlocked` + `acquisition_tier` | tier baseline (A=5, B=3, C=2, D=0), boosted for multi-country records: `min(5, 1 + destinations_unlocked // 3)` when that exceeds the tier baseline |
| Authority quality | `authority_quality` | high=5, medium=3, low=1 |
| Machine readability | `machine_readability` | high=5, medium=3, low=1 |
| Licensing certainty | `licensing_certainty` | high=5, medium=3, low=1, blocked=0 |
| Module breadth | count of the 6 module-coverage fields marked `strong` or `partial` | 0–6 |
| India export relevance | qualitative judgement — see caveat below | 1–5 |

**Penalties**

| Factor | Source field | Scale |
|---|---|---|
| Engineering effort | `estimated_engineering_effort` | low=0, medium=−2, high=−4 |
| Maintenance risk | `maintenance_risk` | low=0, medium=−1, high=−3 |
| Fragmented national overrides | `destinations_unlocked > 1` AND not EU_TARIC | −2 |

**Score = sum of positives + sum of penalties.**

**Caveat on "India export relevance":** this is the one input not independently sourced this pass
— it's a judgement call informed by general knowledge of India's major export destinations (the
US/UK/EU/UAE/Germany-scale markets, plus the five canaries — DE, FR, US, GB, NL — that recur
throughout this project's own Country Truth work). It is not derived from ClearTrade's own trade
data in this pass. Treat it as a soft prior, not a verified figure, and revisit it against real
Comtrade/DGFT export-value data before treating the ranking below as final.

## Computed ranking (already-integrated EU/UK/US excluded)

| Score | Destination | Family | Tier | Licence | Unlocks |
|---:|---|---|---|---|---:|
| 21.0 | New Zealand | national | A_machine | medium | 1 |
| 19.0 | South Korea | national | A_machine | medium | 1 |
| 19.0 | Canada | national | B_structured_web | **high** | 1 |
| 17.0 | UAE | GCC | B_structured_web | medium | 1 |
| 16.0 | Singapore | ASEAN_AHTN | B_structured_web | medium | 1 |
| 15.0 | Japan | national | B_structured_web | medium | 1 |
| 15.0 | Brazil | MERCOSUR | B_structured_web | medium | 1 |
| 13.0 | Vietnam | ASEAN_AHTN | B_structured_web | medium | 1 |
| 13.0 | Switzerland | national | D_blocked | **blocked** | 1 |
| 13.0 | Philippines | ASEAN_AHTN | B_structured_web | medium | 1 |
| 13.0 | Malaysia | ASEAN_AHTN | B_structured_web | medium | 1 |
| 12.0 | Israel | national | B_structured_web | medium | 1 |
| 11.0 | Türkiye | national | B_structured_web | medium | 1 |
| 11.0 | South Africa | SACU | C_manual_authoritative | medium | 1 |
| 10.0 | Mexico | national | B_structured_web | medium | 1 |
|  9.0 | Australia | national | B_structured_web | medium | 1 |
|  8.0 | China | national | C_manual_authoritative | medium | 1 |
|  5.0 | ECOWAS family | ECOWAS | C_manual_authoritative | medium | 15 |
|  4.0 | SACU family (4 more) | SACU | C_manual_authoritative | medium | 4 |
|  4.0 | ASEAN AHTN family (10 total) | ASEAN_AHTN | C_manual_authoritative | medium | 10 |
|  3.0 | Saudi Arabia | GCC | D_blocked | blocked | 1 |
|  3.0 | EAC family | EAC | C_manual_authoritative | medium | 7 |
|  2.0 | MERCOSUR family (4 total) | MERCOSUR | C_manual_authoritative | medium | 4 |
|  0.0 | GCC family (6 total) | GCC | D_blocked | blocked | 6 |
| −1.0 | Kuwait | GCC | D_blocked | blocked | 1 |
| −4.0 | EAEU family | EAEU | D_blocked | blocked | 5 |

## Reading the ranking, not just the numbers

**Switzerland's 13.0 is a trap if read literally.** It scores well because its authority quality,
machine readability and module breadth are genuinely the best researched of any non-EU source — a
real JSON/XML API on opendata.swiss. It is `D_blocked` because commercial use requires permission
from the data owner, exactly WTO's shape of blocker. Its true position is "send the permission
email; if granted, it jumps to the top of Wave 1" — not "build it now." The optimizer scores what
the source *could* offer, not whether ClearTrade may use it; `licensing_certainty` pulls it down
but doesn't zero it out the way the model should for a hard blocker. Treat any `D_blocked` entry as
excluded from the buildable order regardless of its raw score, full stop — Switzerland, Saudi,
Kuwait, GCC-family and EAEU-family are not next, no matter what number sits next to them.

**The family rollups score low on purpose.** ECOWAS/SACU/ASEAN/EAC/MERCOSUR rollups sit near the
bottom not because the countries inside them are unimportant, but because the *rollup itself* is
never something to build — each member is a separate acquisition. Their real value is read off
`source-families.md`: SACU's four smaller members become cheap follow-ons once South Africa is
built; ASEAN/MERCOSUR's shared nomenclatures make follow-on members cheaper to design, not free to
acquire.

**The real Wave 1 candidates are the top individually-scored rows with a non-blocked licence**:
New Zealand, South Korea, Canada, UAE, Singapore, Japan, Brazil — see `implementation-waves.md`.
