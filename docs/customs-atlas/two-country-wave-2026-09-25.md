# Customs Atlas two-country wave: Costa Rica and Chile — 25 September 2026

**Starting checkpoint:** `2d741bd`
**Scope:** Costa Rica (planned research: trade-remedy completeness) and Chile (planned research: commercial
reuse rights), reference date 2026-09-25. The brief marked the other gates SOURCE_CONFIRMED, so they were not
re-researched. A confirmed source that proved unavailable stops the country at that gate. No authority was
contacted. No Railway or production operation ran.

**Result:** 0 locally qualified; 2 blocked. The staging-pending sovereign count stays **10**, potential after
Railway stays **55**, and accepted stays **45**. Both fail-closed entries in `unconfigured-sources.ts` now record
the findings below.

## Costa Rica (`CR`) — `BLOCKED_SOURCE`

### Base (SOURCE_CONFIRMED, found unavailable)

Ar@ncelNet is `serviciosnet.hacienda.go.cr`, a 30-second-TTL CNAME to Akamai. It is not a deterministic source
from the qualification environment:

- `hacienda.go.cr`'s own nameservers (ns4–ns7) do not answer reliably. Resolution alternated between SERVFAIL,
  empty answers, and success through one public resolver.
- When the host was reached, it returned **HTTP 400 with an Akamai "su solicitud está en revisión" bot-review
  hold**. The hold was not circumvented; the user agent was not changed and there was one honest retry.
- `www.meic.go.cr`, the Dirección de Defensa Comercial, refuses TCP connections, so no controlling remedy
  instrument could be read.

### Trade remedies (RESEARCH_REQUIRED), partly resolved from WTO records

- **Brazil refined-sugar anti-dumping (case 001-2015): terminated on expiry on 28 March 2022**
  (G/ADP/N/370/CRI). It is *not* the one anti-dumping measure that WTO data shows in force at 30 June 2026.
- **2020 refined-sugar safeguard:** notified (G/SG/N/8/CRI/2, 9 July 2020) as a three-year measure with a
  liberalisation timetable. No extension notification exists (G/SG/N/10/CRI/3 is unpublished), so on the WTO
  record it lapsed around mid-2023. The controlling DM-058-2020-MEIC text sits on the unreachable MEIC host.
- **The measure WTO reports in force in 2026 is unidentified.** Costa Rica's semi-annual anti-dumping reports on
  the WTO record end at G/ADP/N/370/CRI (January–June 2022).
- **Special agricultural safeguards, tariff quotas, countervailing:** not resolved. The national authority
  cannot be reached. Absence of a hit is not evidence of absence.

### Unblocked by

Stable, unchallenged acquisition from Ar@ncelNet or an official current release, plus reachable MEIC/DDC
resolutions.

## Chile (`CL`) — `BLOCKED_RIGHTS`

The planned research question: is there a current legal basis for ClearTrade to periodically acquire,
retain, normalise, cache and commercially display the current Chilean Customs Tariff? There is not.

| Candidate basis | Finding |
|---|---|
| Official-text exception in Ley 17.336 | **None.** The exceptions (arts. 71 A–S) cover quotation, disability, libraries, education, parody and judicial or administrative use only. |
| Art. 88 | The State **owns** copyright in works produced by its officials. They can be released into the common cultural heritage only "mediante resolución del titular". **No release resolution was found for the Arancel Aduanero.** |
| Art. 3 no. 17 | Compilation protection "no abarca los datos o materiales en sí mismos", *sin perjuicio* of any copyright subsisting in the materials. It does not displace art. 88 ownership. |
| Tariff-specific or open-data licence | **None.** datos.gob.cl holds 51 Aduanas datasets (ODC-BY, ODbL, CC BY), all import/export transaction registers plus a field dictionary. None is the tariff schedule, and those licences do not attach to it. |
| Site terms | The Servicio Nacional de Aduanas' terms, **clause 5 "Derechos reservados"**, reserve all rights in the portal and its contents, including intellectual property. |
| BCN legislation reuse | No explicit legislation-reuse licence could be established (pages are script-rendered; the law text was read through BCN's documented XML service). |

**Commercial normalisation permitted: no.** No tariff was bulk-acquired and no provider was built.

SUBREI's operative Chile–India partial-scope agreement (in force 2007, expanded 2017; 2,099 Chilean concessions)
is unaffected and remains available once rights clear.

**Unblocked by:** an art. 88 release resolution for the Arancel Aduanero, or an explicit SNA or open-data
licence covering the current tariff for commercial acquisition, retention, transformation and display.
