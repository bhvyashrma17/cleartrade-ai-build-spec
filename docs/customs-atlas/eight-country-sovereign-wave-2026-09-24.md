# Customs Atlas eight-country sovereign wave — 24 September 2026

**Starting checkpoint:** `53233023b7e96a4f30a33d715b8079e112dabdc1`
**Scope:** United Arab Emirates, Pakistan, Tunisia, Bangladesh, Ecuador, Panama, Uruguay and Nigeria,
reference date 2026-09-24. Each destination was first source-gated on six points (base source,
currentness, India preference, remedy enumeration, rights, acquisition feasibility), and only those
that passed were implemented. No authority was contacted. No Railway or production operation ran.

**Result:** 1 locally qualified (Tunisia); 7 blocked. Accepted operational coverage remains **45**.

## Gate outcomes

| ISO | Outcome | Decisive finding |
|---|---|---|
| TN | `LOCAL_QUALIFIED_STAGING_PENDING` | Tarifweb 2026 serves every line as server-rendered HTML with a structured duty table; Finance Law 2026 is reconciled line by line; the remedy record is complete from Tunisia's own WTO notifications. See below. |
| AE | `BLOCKED_SOURCE` | The federal [Central Customs Tariff System](https://icp.gov.ae/en/central-customs-tariff-system/) (12-digit, from 2025-04-01) is searchable only behind ICP's authenticated channels; ICP [open data](https://icp.gov.ae/en/open-data/) holds no tariff. The only public workbook, Dubai Customs' [HS code master v3.3](https://www.dubaicustoms.gov.ae/en/PoliciesAndNotices/Documents/HSCodeMaster-v3.3customers.xlsx) (modified 2025-07-31), is an emirate transition artifact that flattens GCC tobacco to "100%" without its specific minimum. |
| PK | `BLOCKED_SOURCE` | Every FBR host serving the [Pakistan Customs Tariff](https://www.fbr.gov.pk/Categ/Pakistan-Customs-Tariff/1147/30859/) refused connections, and the [NTC](https://ntc.gov.pk/) remedy record is behind a Cloudflare challenge. Neither was bypassed. |
| BD | `BLOCKED_CURRENTNESS` | NBR's [First Schedule](https://nbr.gov.bd/budget/tariff-schedule/eng) chapter PDFs exist, but no complete FY 2026-27 operative tariff with CD, RD, SD, VAT, AIT and AT is published; the [2026-27 budget pages](https://bangladeshcustoms.gov.bd/budget/2026-27) do not carry it. Reconstructing it from SROs and the Finance Bill is not an acceptable source. |
| EC | `BLOCKED_SOURCE` | SENAE's [Arancel Nacional](https://mesadeservicios.aduana.gob.ec/arancel/) is a browser application over undocumented JSON endpoints; no complete published schedule exists, and Andean price-band duties apply. The endpoints were not enumerated. |
| PA | `BLOCKED_SOURCE` | The ANA [interactive tariff](https://aranceles.ana.gob.pa/) is an Angular application over `aranceles-api.ana.gob.pa`, an undocumented backend; its visible existence does not authorise its use. No complete official schedule document is published. |
| UY | `BLOCKED_CURRENTNESS` | The MEF [nomenclature and tariff area](https://www.mef.gub.uy/711/3/areas/nomenclatura-y-aranceles-uruguay.html) publishes complete schedules only to January 2022 (base) and November 2024 (per partner); no complete 2025–2026 state exists. |
| NG | `BLOCKED_SOURCE` | The Customs [CET workbook link](https://customs.gov.ng/wp-content/uploads/CET_tariff.xls) returns an HTML page, not a workbook, and `tariff.customs.gov.ng` does not resolve. Nigeria's fiscal-policy measures and import adjustment tax could not be sourced either. |

The blocked destinations keep their existing fail-closed entries in `unconfigured-sources.ts`.

## Tunisia (`TN`)

- **Base source:** [Tarifweb 2026](https://www.douane.gov.tn/tarifweb2026/). 97 chapter listings (Chapter 77
  reserved) name 17,541 eleven-digit lines; each line page carries general data, the CCEC import status,
  the import duties and taxes (component, value, basis), per-country preferential rates and required
  documents. Pages are read structurally; a new component code, a changed line count or a layout change
  fails acquisition closed.
- **Duty semantics:** the printed customs duty (`DD` family) is the applicable conventional rate —
  GATT/WTO Members and, absent a contrary provision, every third country — or the autonomous rate where
  lower ([tariff rules](https://www.douane.gov.tn/tarif-douanier/)). Its simple average (23.74%) and
  zero-rated share (27.5%) match the WTO Secretariat's 2025 review (23.8%, 27.4%). The 15% legal minimum
  of collection in the autonomous tariff limits suspensions and exemptions, not the printed rate, so it is
  never applied. VAT, the customs services fee, consumption duties and levies are carried separately;
  dinar amounts stay specific.
- **Currentness:** Tarifweb is labelled "Dernière mise à jour : 17 juin 2025", but the Finance Law 2026
  (Law 2025-17, customs bulletin 038/2025) is applied: article 72 (frames 10%), article 47 §3 (plug-in
  hybrids 0%), article 60 (TPE on polyolefin fabrics and bags) and article 31 (no fruit-and-vegetable
  levy on potatoes, per Customs' application note 039/2025). Article 47 §4 (EV chargers 10% until
  2028-12-31, on a fiscal-privilege request) is not applied by Tarifweb and is carried as a
  non-declarable overlay; article 46 (lithium-battery inputs) is a beneficiary exemption overlay. Every
  2026 bulletin (001–034) and 036–039/2025 was reviewed; a new bulletin fails closed.
- **Remedies:** no anti-dumping or countervailing action ever (WT/TPR/S/479/Rev.1 ¶3.51). One safeguard:
  the steel-wire quantitative restriction (G/SG/N/8/TUN/1) — a volume cap, not a duty — until 2026-11-30,
  with a developing-country exemption that depends on unobservable import shares. The special
  agricultural safeguard was not invoked (G/AG/N/TUN/74). The next symbol of every WTO series is probed
  and must be unpublished.
- **Tariff quotas:** 13 WTO-bound minimum-access quotas (latest fill G/AG/N/TUN/79, 2024, volumes unchanged)
  administered by Special Tariff Quota Authorization (G/AG/N/TUN/4, Decree 96-119). No national source
  publishes the applied in-quota rates for 2026, so they are carried as unknown, never zero, and
  `tariff_treatment_complete=false` on those lines. The only reported rate — butter at 35% in-quota
  against 36% ex-quota in 2024 — is kept as provenance and not applied to 2026. The agriculture series was
  read to its end (75 is domestic support; 76–79 are quota fill); G/AG/N/TUN/80 is probed.
- **India preference:** `unknown`. Tarifweb lists 19 preferential origins and never India, but Tunisia
  and India are both GSTP and PTN participants and no concession schedule is published.
- **Rights:** Law 94-36 as amended by Law 2009-33, Article premier: copyright does not cover official
  texts of a legislative, administrative or judicial nature ([WIPO Lex](https://www.wipo.int/wipolex/fr/legislation/details/21148)).
- **TLS:** `www.douane.gov.tn` omits its intermediate; see the operational note in
  [`staging-pending-queue.md`](./staging-pending-queue.md).
