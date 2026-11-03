# Source families — regional customs blocs

For each family: does a common external tariff genuinely exist, is it actually machine-accessible
from one place, and does one adapter really unlock every member — or does "customs union" turn out
to mean "shared nomenclature, national administration"? The task's own instruction was not to
count a country as unlocked merely because it belongs to a bloc, and the honest answer for five of
the seven families below is that it does not unlock anything by itself.

Each family answers the same twelve questions from the task. Full technical/licensing detail per
member sits in `authority-registry.json`; this file is the reasoning.

## EU — TARIC

1. **Genuine common external tariff?** Yes — the oldest and most complete of the seven.
2. **Members actually using it?** All 27 EU member states.
3. **National line extensions differ?** No — TARIC's 10-digit code IS the national line for every
   member; there is no member-specific extension layer to reconcile.
4. **Preferences centralized or national?** Centralized — published in the same release.
5. **India-origin preferences shared?** Yes, as a single determination per line.
6. **Quotas/remedies centralized?** Yes.
7. **VAT/excise separate?** Yes, national — out of scope for Market Access, correctly excluded.
8. **Import controls national?** Some are, but the bulk of SPS/TBT-type controls are also
   published centrally in the same release.
9. **One reusable machine source?** Yes — the Commission's own monthly extraction.
10. **Reuse commercially permitted?** Sidestepped, not resolved: ClearTrade ingests the
    Commission's own release bytes via a named staff reviewer rather than calling a rate-limited
    public API, which is why this is `authoritative_public` and not blocked the way WTO is.
11. **One adapter safely unlocks multiple countries?** Yes — proven, in production.
12. **National override layer still required?** None identified.

**Verdict: the only family where "one adapter unlocks the whole bloc" is actually true.** It is
also the reason it was built first.

## GCC — Gulf Cooperation Council

1. **Genuine common external tariff?** Structurally yes since the 2025 rollout of a shared
   12-digit HS-based code across the six states.
2. **Members using it?** Saudi Arabia, UAE, Kuwait, Qatar, Bahrain, Oman.
3. **National line extensions differ?** The 12-digit *structure* is shared, but each state
   publishes and amends its own schedule on its own site, on its own timeline (UAE's own rollout
   trailed Saudi's by months in 2025). Treat lines as nationally administered even though the
   digit count matches.
4. **Preferences centralized or national?** National — no shared preference database found.
5. **India-origin preferences shared?** Not confirmed; nothing suggests a shared determination.
6. **Quotas/remedies centralized?** Not confirmed.
7. **VAT/excise separate?** Yes, and rolled out unevenly across members historically.
8. **Import controls national?** Yes.
9. **One reusable machine source?** **No.** No single GCC-level API or database was found. Dubai
   Customs (UAE) is the strongest single node researched; Saudi's ZATCA is confirmed blocked
   (already recorded in `unconfigured-sources.ts`); the other four are unresolved.
10. **Reuse commercially permitted?** Varies enormously by member — UAE's Dubai Pulse platform
    carries a confirmed, genuinely open federal licence; Saudi is confirmed blocked; the rest
    unresolved. This spread within one "harmonised" bloc is exactly why licensing must be checked
    per source, never inferred from a bloc's reputation.
11. **One adapter safely unlocks multiple countries?** No.
12. **National override layer still required?** Full national acquisition, per state — the
    harmonisation buys a transferable *parser design*, not a transferable *data source*.

**Verdict: real code-structure leverage, zero acquisition leverage.** The right way to bank this
finding is to design the first GCC parser (UAE, the strongest license) so its shape is reusable,
not to expect it to unlock six countries.

## EAEU — Eurasian Economic Union

1. **Genuine common external tariff?** A Common Customs Tariff exists as approved Commission
   decisions.
2. **Members?** Russia, Kazakhstan, Belarus, Armenia, Kyrgyzstan.
3–8. Not resolved — the family fails at the acquisition question before these matter.
9. **One reusable machine source?** **No — confirmed.** No single public EAEU-level database
   exists for either export duties or preferential rates; the tariff exists in published legal-
   decision form, not as a queryable dataset.
10. **Reuse commercially permitted?** Not evaluated.
11–12. Not applicable.

**Verdict: not viable as a family, and not a near-term priority regardless.** Beyond the data gap,
Russia specifically carries independent sanctions/geopolitical exposure. Recorded for the
destination universe's completeness only.

## ECOWAS — Economic Community of West African States

1. **Genuine common external tariff?** Yes in structure — a five-band CET (0/5/10/20/35%).
2. **Members using it?** Nigeria and Ghana both confirmed as implementing; the other 13 members
   were not individually checked.
3. **National line extensions differ?** Not confirmed either way.
4–8. Not resolved.
9. **One reusable machine source?** No confirmed machine interface. ECOTIS (the regional trade
   information system) publishes policy documentation; it was not evidenced as a queryable tariff
   database.
10. **Reuse commercially permitted?** Not located.
11. **One adapter unlocks multiple?** No evidence for this.
12. **National override layer?** Presumed necessary, not characterised.

**Verdict: real shared band structure, no shared source.** Same shape of finding as GCC — a
transferable nomenclature/band concept, national acquisition per member, currently at
`C_manual_authoritative` at best.

## EAC — East African Community

1. **Genuine common external tariff?** Yes in structure — originally three bands (0/10/25%), a
   fourth band (35%, agricultural products) added in 2022.
2. **Members?** Kenya, Tanzania, Uganda, Rwanda, Burundi, South Sudan, DR Congo.
3–8. Not resolved for any member beyond the CET's own headline structure.
9. **One reusable machine source?** No confirmed database or API — gazetted Council decisions on
   eac.int, not a queryable tariff database.
10–12. Not resolved.

**Verdict: same pattern as ECOWAS.** Real regional policy coordination, no machine source, no
leverage claimed.

## SACU — Southern African Customs Union

1. **Genuine common external tariff?** Yes, and administered differently from every other family
   researched.
2. **Members?** South Africa, Botswana, Eswatini, Lesotho, Namibia.
3. **National line extensions differ?** **Confirmed different from the other blocs**: SACU's
   design has South Africa's SARS Schedule 1 function as the tariff the other four members apply,
   rather than each running a fully independent national schedule that happens to converge.
4. **Preferences centralized or national?** Effectively centralized through South Africa's
   schedule for the shared tariff; each member's own trade agreements outside SACU are its own.
5. **India-origin preferences shared?** Not confirmed, but would plausibly follow South Africa's
   determination for the CET portion.
6. **Quotas/remedies centralized?** South Africa's schedule includes anti-dumping and
   countervailing duties (Schedule 2) that, per SACU's design, extend to the other members.
7. **VAT/excise separate?** Yes, and set nationally — Botswana/Eswatini/Lesotho/Namibia each set
   their own VAT and can vary excise, independent of the shared external tariff.
8. **Import controls national?** Yes — each of the four smaller members retains its own import-
   licensing and prohibition regime layered on top of the shared tariff.
9. **One reusable machine source?** Effectively yes for the tariff RATE itself (SARS Schedule 1),
   though it ships as a large PDF, not an API.
10. **Reuse commercially permitted?** Not located this pass.
11. **One adapter safely unlocks multiple countries?** **Provisionally yes, for the tariff-rate
    portion — the one genuine case of this among the six African/Eurasian families researched.**
12. **National override layer still required?** Yes, and it is specific: VAT/excise are always
    national, import-control/licensing regimes are always national, and any member-specific rebate
    provision must be checked before a SARS rate is presented as that member's own duty.

**Verdict: the second-strongest bloc found, after the EU, and the strongest African one** — but
"provisionally," on a large manual PDF, with a defined and non-trivial override layer, not a clean
machine win.

## MERCOSUR — Mercado Común del Sur

1. **Genuine common external tariff?** Yes — the TEC (Tarifa Externa Común), in force since 1995.
2. **Members?** Brazil, Argentina, Paraguay, Uruguay (full members relevant to Indian exports).
3. **National line extensions differ?** The 8-digit NCM (Nomenclatura Común do Mercosul) is
   genuinely shared. But **LETEC (Lista Nacional de Exceções à Tarifa Externa Comum)** lets any
   member run a national exception list against the shared TEC rate — confirmed via recent
   LETEC-expansion filings. A TEC rate read from Brazil's schedule is not guaranteed to be the
   rate Argentina or Paraguay actually applies to the same NCM code.
4. **Preferences centralized or national?** Not confirmed either way.
5. **India-origin preferences shared?** Not confirmed.
6. **Quotas/remedies centralized?** Not confirmed.
7. **VAT/excise separate?** Presumed national (Brazil's ICMS/IPI structure is well known to be
   national), not independently re-confirmed here.
8. **Import controls national?** Not confirmed.
9. **One reusable machine source?** No single MERCOSUR-level source — Brazil's own Portal Único
   exposes an API surface (evidenced by a third-party vendor integration), which is the strongest
   single node, but it is Brazil's, not the bloc's.
10. **Reuse commercially permitted?** Not located.
11. **One adapter safely unlocks multiple countries?** No — LETEC alone rules this out without
    per-country exception-list verification.
12. **National override layer still required?** Yes: the LETEC exception list, per member, is a
    hard requirement, not an edge case.

**Verdict: genuine nomenclature-level leverage (NCM concordance work transfers), no acquisition
leverage.** Brazil is worth building as its own national pack; MERCOSUR's shared NCM makes a
follow-on Argentina/Paraguay/Uruguay adapter cheaper to design, not free to acquire.

## ASEAN / AHTN — discovered during research, not in the original task list

Not one of the seven named families, but structurally identical in kind and material enough to the
Indian-export destination set (Singapore, Malaysia, Philippines, Vietnam, Thailand, Indonesia,
Brunei, Cambodia, Laos, Myanmar) to record properly rather than silently fold into "national."

1. **Genuine common external tariff?** **No.** ASEAN is not a customs union. There is no common
   external duty rate.
2. **What is actually shared?** The AHTN (ASEAN Harmonised Tariff Nomenclature), an 8-digit
   classification base every member extends independently — a nomenclature-sharing arrangement,
   the same shape as MERCOSUR's NCM, not a tariff-sharing one.
3. **National line extensions differ?** By design — each member sets its own MFN rates and
   negotiates its own FTA schedules on top of the shared 8-digit base.
4–8. National, not centralized, for every dimension checked.
9. **One reusable machine source?** No — ten separate national customs authorities, none evidenced
   with a public API in this pass (Singapore, Malaysia, Philippines and Vietnam were each checked
   individually; all four are web-tool/database-delivered, not API-delivered).
10–12. National in every respect; no bloc-level leverage.

**Verdict: nomenclature leverage only, same category as MERCOSUR.** A classification-refinement
concordance built once for AHTN transfers across all ten members even though each acquisition is
separate and national.

## Summary table

| Family | Real shared source? | Members | Genuine leverage | Verdict |
|---|---|---|---|---|
| EU / TARIC | **Yes** | 27 | Full — already built | One adapter, whole bloc |
| SACU | Provisionally (rate only) | 5 | Rate-level, defined override needed | Second-best bloc found |
| GCC | No | 6 | Parser-design only | Six separate acquisitions |
| ECOWAS | No | up to 15 | Band-structure only | Six separate acquisitions (of 15) |
| EAC | No | 7 | Band-structure only | Separate acquisitions |
| MERCOSUR | No | 4 | Nomenclature (NCM) only | Separate acquisitions, cheaper design |
| ASEAN/AHTN | No (not even a CET) | 10 | Nomenclature (AHTN) only | Separate acquisitions, cheaper design |
| EAEU | No — confirmed absent | 5 | None | Not viable; also low-priority |
