# Customs Atlas human-access-required queue — 21 September 2026

**Decision:** no destination in this wave cleared all autonomous-source gates. No access request
was sent. These are prepared requests for a human to submit to the named authority; they are not
approval records and they do not authorize scraping, private-endpoint discovery or commercial
reuse.

## Autonomous lane outcome

The priority order was preserved. Each service received one focused public-authority pass.

| Order | Country | Public authority result | Hard gate that failed | Lane |
|---|---|---|---|---|
| 1 | Jordan (`JO`) | Jordan Customs' public Integrated Tariff is current, and ASYCUDA advertises PDF/Excel/CSV. A live CSV export returned only code, description and unit—not duties, taxes, preferences or measures. | Complete executable result, history and reuse. Jordan Customs expressly limits downloads to personal/in-house non-commercial use unless broader permission is granted. | `HUMAN_ACCESS_REQUIRED` |
| 2 | Lebanon (`LB`) | Lebanese Customs exposes deterministic chapter pages with ad-valorem, specific/minimum duty, VAT, agreement and amendment columns. | The authority warns that published restrictions/prohibitions are incomplete; no supported full export, release identity, complete amendment manifest or reuse grant exists. | `HUMAN_ACCESS_REQUIRED` |
| 3 | Uzbekistan (`UZ`) | The Integrated Tariff accepts HS, flow, dispatch, origin and trading-country context and exposes units/directories. | Only an interactive calculation surface is documented. No supported bulk/API/history contract; the attribution notice is paired with “all rights reserved,” not a commercial licence. | `HUMAN_ACCESS_REQUIRED` |

The three remaining services above are genuinely public and useful to a human. None is safe for an autonomous
customer-facing provider under the ten-gate standard. Therefore this wave adds **zero**
`LOCAL_QUALIFIED_STAGING_PENDING` countries and creates no `OfficialPublicTariffProvider` family.

## Prepared authority requests

“API/bulk solves?” means it can solve the acquisition gate only if the response also supplies the
listed version, semantic, completeness and rights prerequisites. An undocumented endpoint or a
one-off spreadsheet without an update contract does not qualify.

| Country | Authority | Public service already checked | Exact blocker | Exact requested access | Official contact | API/bulk solves? | Reuse permission needed? | Prerequisites for qualification |
|---|---|---|---|---|---|---|---|---|
| Jordan (`JO`) | Jordan Customs | [Integrated Customs Tariff](https://www.customs.gov.jo/EN/List/Integrated_customs_tariff), [ASYCUDA tariff](https://asytrade.customs.gov.jo/customs/tariff), and [copyright policy](https://www.customs.gov.jo/EN/Pages/Copyrights) | Export contains classification fields only; rate/measure data, version history and commercial rights are absent. | A complete rate-data API or versioned bulk release covering duties, taxes, preferences, units and national measures; amendment history/data dictionary; written permission for periodic commercial acquisition, retention, transformation and display. | [Jordan Customs contact page](https://www.customs.gov.jo/EN/Pages/Contact_Us); `customs@customs.gov.jo` is the address named by the copyright policy for broader-use requests. | Yes, conditionally. | **Yes—explicitly.** | Stable documented route, release/effective timestamps, pagination/completeness rules, historical versions, field semantics, India-origin treatment, rate limits and rights grant. |
| Lebanon (`LB`) | Lebanese Customs | [Integrated Tariff](https://www.customs.gov.lb/tariff/tariff.aspx) and deterministic [chapter table](https://www.customs.gov.lb/Tariff/Tariff_Table.aspx?CH=1) | Published restrictions are expressly incomplete; no full distribution, immutable release or complete amendment manifest. | Supported full tariff database export/API with duty/VAT/specific-minimum expressions, preferences, amendments and the complete restrictions/prohibitions layer; version history and commercial reuse terms. | [Lebanese Customs contact directory](https://customs.gov.lb/Contact.aspx); `info@customs.gov.lb` / call centre `1703`. | Yes, if complete. | **Yes.** | Field/code dictionary, effective dates, full chapter/line count, amendment precedence, unavailable-vs-zero semantics, India-origin mapping and reuse grant. |
| Uzbekistan (`UZ`) | Customs Committee of the Republic of Uzbekistan | [Integrated Tariff](https://tarif.customs.uz/en), [HS/unit directory](https://tarif.customs.uz/en/directory/tnved), and [country directory](https://tarif.customs.uz/en/directory/countries) | Interactive calculations only; no documented full export/API/history. Attribution plus “all rights reserved” does not grant commercial reuse. | Supported API or versioned bulk release carrying HS line, import/export direction, dispatch/origin/trading-country treatment, duties, units and non-tariff measures; update history and commercial licence. | `info@customs.uz`, shown on the official tariff service; 11-08 hotline. | Yes, conditionally. | **Yes.** | Authentication/rate-limit docs if applicable, schema and code lists, complete-result rules, effective dates, immutable versions, India-origin semantics and rights. |
| Ghana (`GH`) | Ghana Revenue Authority Customs Division / ICUMS | [ICUMS](https://gra.gov.gh/customs/icums/) and public tariff/levy guidance | Calculators and band/levy guidance do not provide a complete commodity-line export/API, version history or commercial terms. | ICUMS classification/rate API or versioned bulk release with every national line, levy, exemption, special measure and historical effective date; commercial use terms. | `info@gra.gov.gh`, +233 24 243 5662/5663 on the official ICUMS page. | Yes, conditionally. | **Yes.** | Full national-line coverage beyond ECOWAS bands, schema, history, exemptions/remedies, India treatment, access/rate-limit terms and licence. |
| Morocco (`MA`) | Administration des Douanes et Impôts Indirects (ADII) | [ADIL](https://www.douane.gov.ma/adil/) and [official application guide](https://www.douane.gov.ma/adil/pdf/adil.pdf) | Interactive tariff only; no supported bulk/API, stable version/history contract or replayable amendment feed. | ADIL API or versioned bulk release covering duties, taxes, preferences, regulatory measures and history, with commercial reuse permission. | `ADii@douane.gov.ma`, 080 100 7000 / +212 5 37 57 90 00, published in the ADIL guide. | Yes, conditionally. | **Yes.** | Field dictionary, completeness/line counts, effective-date and amendment model, origin-program semantics, India treatment, rate limits and rights. |
| Ecuador (`EC`) | Servicio Nacional de Aduana del Ecuador (SENAE) | [National Tariff / service portal](https://mesadeservicios.aduana.gob.ec/arancel/) and [SENAE public site](https://www.aduana.gob.ec/) | A current interactive/live service exists, but there is no supported complete anonymous distribution contract, immutable history or permission for automated commercial caching and derived display. | SENAE machine-readable national tariff/API or versioned bulk release with COMEX amendment history, FODINFA/ICE, safeguards/remedies, field dictionary and commercial reuse authorization. | [SENAE Service Desk](https://mesadeservicios.aduana.gob.ec/otrs/customer.pl), the authority's official channel for requests. | Yes, conditionally. | **Yes—explicitly.** | Supported endpoint policy, complete national overlays, effective dates/history, quota/restriction semantics, India treatment, rate limits and reuse authorization. |
| Vietnam (`VN`) | Department of Vietnam Customs / Ministry of Finance | [Vietnam Customs](https://www.customs.gov.vn/) and tariff/legal lookup surfaces. The public `CHMT_Service` WSDL was checked, but its opaque `TNP` operation has no tariff schema, version or evidence that it distributes the national tariff. | No supported complete current national tariff API/bulk release; baseline, 2026 amendments, special rates and AIFTA instruments remain separate. | Current machine-readable national tariff API or versioned bulk release with baseline and update history, all ordinary/preferential/absolute/mixed/out-of-quota fields, AIFTA treatment and commercial terms. | `webmaster@customs.gov.vn`, +84 24 39440833 on the official Customs portal. | Yes, conditionally. | **Yes.** | Documented tariff semantics, complete line count, amendment precedence/effective dates, specific/compound support, AIFTA/RoO mapping, access policy and rights. |
| Maldives (`MV`) | Maldives Customs Service | [Tariff service](https://www.customs.gov.mv/eServices/Tariff) and current [export/import laws](https://trade.gov.mv/en/laws-and-regulations/) | A prior English HS2022 schedule exists, but deterministic HTTP now receives a Cloudflare challenge; no supported current 2026 API/bulk/history or reuse licence was found. | Current tariff API or versioned bulk release, accessible through a supported machine channel, with amendment history and explicit commercial reuse terms. | `info@customs.gov.mv`, +960 3322001 / 3334142 / 3334126, published by Maldives Customs. | Yes, conditionally. | **Yes.** | Current-year identity, full 10-digit line count, post-2024/2026 amendments, specific-duty semantics, India treatment, machine access/rate limits and reuse grant. |

## Counts and boundaries

- Human-access queue: **8 sovereign countries**. Singapore was removed after the sanctioned SSO
  legislation route was established; its implementation remains fail-closed pending a complete
  live qualification during SSO's 03:00–07:00 Singapore Time automation window. Malaysia was
  removed because the official Customs Duties Order is now technically implemented; it remains
  separately blocked by JKDM's commercial-reuse permission requirement.
- Indonesia was removed after JDIH BPK supplied deterministic official legal artifacts for the
  complete MFN/AIFTA/remedy pack; it is now local-qualified and staging-pending.
- Saudi Arabia was removed after its public ZATCA enumeration, official structural/rate overlays,
  Article 4 rights basis and complete GAFT active-remedy inventory passed local qualification.
- Qatar was removed after its official Customs current Integrated Customs Tariff schedule, Decree
  63/2025 structural amendment, Copyright Law article 4 rights basis and a complete anti-dumping
  register (moci.gov.qa/Industry, cross-referenced against customs.gov.qa) passed local
  qualification.
- Kuwait was removed after its live public HS Code 12-digit tariff portal (7,510 unique codes),
  Copyright Law article 4 rights basis and a complete anti-dumping register (customs.gov.kw's
  complete non-paginated instructions archive) passed local qualification.
- New locally qualified countries in this wave: **1**.
- Existing staging-pending queue: **11 destinations**, of which **6 are sovereign states**
  (Sri Lanka, Monaco, Indonesia, Saudi Arabia, Qatar and Kuwait).
- Accepted operational coverage: **45 sovereign countries**, unchanged.
- Potential sovereign coverage after the existing staging queue is qualified: **51**.
- Potential sovereign coverage if all 8 access requests later succeed and providers qualify: **59**.
- Production was not read or written. Railway was not used.
