# Wave 3B — unblock sprint

Continues from Wave 3A (`5659801`, [wave3a-source-clearance-sprint.md](wave3a-source-clearance-sprint.md)),
unchanged and not retroactively edited. This is a new decision layer on top of it, not a
replacement of it. Research and preparation only — no adapters, no migrations, no production
changes.

## Part 0 — research commit

- Branch: `agent-portal-and-document-engine`.
- Starting HEAD: `565980191bd79adf137293afd8e11d944285a877` (`5659801`), working tree clean.
- `5659801` was on the local branch but **not yet on `origin`** — pushed at the start of this
  sprint (`1cb037d..5659801 agent-portal-and-document-engine -> agent-portal-and-document-engine`).
  No deploy was triggered by that push.

## Part 1 — South Korea credential check

Checked Railway project `amused-insight`, **staging** environment, both named services
(`cleartrade-worker`, `cleartrade-ai-build-spec`) via `list-variables`. Variable names only were
inspected; no value was read, printed, or retained.

**`KCS_DATA_GO_KR_SERVICE_KEY`: absent** from both services' staging variable sets.

Per instruction, the credential was not bypassed. Exact human provisioning steps (unchanged from
Wave 3A's findings, restated here for completeness):

1. **Account/signup URL:** `https://www.data.go.kr` — create a free data.go.kr account (Korean
   government open-data portal).
2. **Dataset/API access request:** from the account, open dataset `15051179`
   (`관세청_품목번호별 관세율표` — Korea Customs Service tariff-rate-by-item-number table) at
   `https://www.data.go.kr/data/15051179/fileData.do`, and request Open API access for it. The
   underlying API is served through `infuser.odcloud.kr`, whose OAS/Swagger spec is public at
   `https://infuser.odcloud.kr/oas/docs?namespace=15051179/v1`.
3. **Approval:** two tiers exist per the portal's own model — 자동승인 (automatic, effectively
   instant) or 심의승인 (manual review, ~2–3 business days) depending on which endpoint is
   requested for this dataset. Which tier applies to this specific dataset's Open API was not
   re-verified in this pass (unchanged from Wave 3A; would require actually filing the request to
   observe).
4. **Where the `serviceKey` is obtained:** issued by data.go.kr on approval, visible in the
   account's "마이페이지" (My Page) API-key management area. Typical activation lag is 1–2 hours
   after issuance.
5. **Exact Railway variable name:** `KCS_DATA_GO_KR_SERVICE_KEY` (matches the name already assumed
   by the existing `unconfigured-sources.ts` registry entry `KR_DATA_GO_KR` — no renaming needed).
6. **Which service requires it:** the acquisition/import path for a Korea authority pack would run
   as a one-off script analogous to `scripts/import-norway-release.ts`, executed via
   `railway run` against **`cleartrade-worker`** (the service that owns import/acquisition
   scripts in this repo's existing pattern) — so the variable belongs there at minimum.
7. **Whether the web service also needs it:** only if the web app (`cleartrade-ai-build-spec`)
   ever calls the Korean API directly at request time rather than reading from the already-imported
   database. The existing architecture (Norway, TARIC, etc.) imports into ClearTrade's own database
   ahead of time and serves reads from there, not from the authority's live API — so the expectation
   is **no**, the web service does not need this key, only the worker/import path does. This should
   be confirmed against the actual Korea provider implementation once written, not assumed.

Since the credential remains absent, **Parts 2–5 of this task (real payload inspection, Korea
implementation, CEPA determination, semantic qualification) do not apply in this run.** No Korea
adapter code was written, no live call to the Korean API was made, and no schema was newly observed
— this preserves the empirical-first rule (don't design parser assumptions from documentation when
a real response isn't available) by simply not designing them yet, rather than guessing.

## Part 6 — Iceland rights resolution

Went beyond Wave 3A's pass, specifically into the site's dedicated professional/software-vendor
section (`fagadilar/tollamal/hugbunadarhus/...`, distinct from the general public pages checked
before), looking for a licence, agreement, or registration step that Wave 3A might have missed by
staying on the public-facing pages.

**Findings:**

- **The exact tariff dataset, traced precisely.** `tollskrárlyklar` ("tariff keys") is a text-file
  export from Tollakerfi (Skatturinn's customs IT system), published in two files (import and
  export) at `skatturinn.is/fagadilar/tollamal/hugbunadarhus/tollskrarlyklar`. The page states its
  purpose explicitly: for import/export software vendors' declaration software, error-checking, and
  duty calculation. A companion disclaimer document ("Fyrirvarar og frávik tollskrárlykla," PDF)
  lists known deviations from the legal tariff annex — real evidence this is treated as a working
  operational export, not a casual publication. Also newly confirmed: **the tariff-keys file does
  not include HS product-description text** — only codes, rates, and conditions. Description text
  lives separately in the legal tariff annex or the `veftollskra` web lookup. This narrows what an
  Iceland pack could source from this file alone.
- **A public list of approved third-party software vendors** exists at
  `.../hugbunadarhus/seljendur-hugbunadar` (Advania, Origo, dk hugbúnaður, and 12 others) who already
  build commercial customs-declaration software against this exact file. This is meaningful
  circumstantial evidence that commercial use of the tariff-keys data is the file's entire reason
  for existing — but it is not itself a rights statement, and the task's discipline forbids treating
  "other companies clearly use this commercially" as a substitute for an explicit grant.
- **No licence, terms-of-use, or reuse statement was found on any of these pages** — the
  professional/software-vendor section included.
- **The site-wide contrast still holds and was re-confirmed.** `/notkunarskilmalar` explicitly
  prohibits copying, altering, distributing, or reproducing content from three named lookup engines
  (company register, annual-accounts register, VAT register) — and says nothing about tariff data.
  Skatturinn demonstrably writes explicit restrictions when it wants to; it has not written one for
  the tariff keys, and has not written a permission either.

**Determination: still `RIGHTS_UNRESOLVED`, but now on stronger, more specific evidence.** This is
not the same as Wave 3A's finding of a gap — it is now a confirmed gap in the one section of the
site where a licence would most plausibly appear (the section aimed at exactly the audience
ClearTrade would be), following exhaustion of every promising internal thread found so far. It does
not become `CLEARED_WITH_CONDITIONS`, because no primary evidence grants the required rights, and
the task's rule against inferring rights from public availability or from other companies' apparent
use applies directly here.

### Part 7 — Iceland permission packet

**Contact route identified:** `vefur@skatturinn.is` — the webmaster/website contact address,
published on the exact software-vendor pages this dataset lives on (used there for vendors to
correct or add their own listing), making it the most directly relevant published address for a
question about this specific dataset's terms. Iceland does not publish a separate legal/licensing
or open-data team address for customs data; this is Skatturinn's own designated channel for
questions about this section of the site. A general phone line (+354 442 1000) exists as a fallback.

**Packet (ready to send, not sent):**

> **Subject:** Commercial reuse terms for tollskrárlyklar (tariff keys) — request for written
> clarification
>
> To the Skatturinn team,
>
> ClearTrade is a trade-compliance SaaS platform that helps exporters determine tariff treatment
> across destination markets. We would like to build automated support for Iceland using the
> `tollskrárlyklar` dataset published for software vendors at
> `skatturinn.is/fagadilar/tollamal/hugbunadarhus/tollskrarlyklar`, and want to confirm the terms
> under which we may do so before proceeding.
>
> Specifically, we would like to know whether ClearTrade may:
>
> 1. automatically and periodically download the published `tollskrárlyklar` release files;
> 2. cache those releases internally on our own infrastructure;
> 3. retain historical releases (not only the current one) for audit and effective-dating purposes;
> 4. transform the tariff facts in the file into our own canonical database structure;
> 5. use the resulting data as part of a commercial, paid product;
> 6. display tariff facts and duty conclusions derived from the data to our paying customers;
> 7. retain and display attribution to Skatturinn as the source; and
> 8. do all of the above without redistributing your raw source files themselves to third parties.
>
> If a specific licence or terms-of-use document applies to this dataset, we would be grateful if
> you could point us to it. If commercial automated use requires separate written permission, we
> would like to request it for the use described above.
>
> Thank you for your time.

## Part 8 — Chile rights resolution

**The exact tariff dataset, traced precisely.** The Arancel Aduanero Nacional de Chile is published
by the Servicio Nacional de Aduanas (SNA) at `aduana.cl`, current release referencing Ministry of
Finance Decree No. 473 (26.10.2021, published in the Official Gazette 10.12.2021) with a most-recent
found update dated 2023, as decree-backed sectional Excel files (e.g.
`listado_items_arancelarios_capitulos_1_a_97.xlsx` covering all chapters 1–97, plus per-section
files). This is a real, structured, government-decree-backed dataset — Grade B.

**What was newly resolved in this pass:**

- **SNA's institutional open-data habit, confirmed programmatically.** A direct CKAN
  `organization_show` API call against `datos.gob.cl` (`https://datos.gob.cl/api/3/action/
  organization_show?id=servicio_nacional_de_aduanas&include_datasets=true`) returned all ten of
  SNA's published datasets — annual import/export declaration records, 2003–2026 — every one
  licensed `odc-by`. This is a real, verified positive signal about SNA as a publisher, not an
  inference from the platform's general policy.
- **But the Arancel Excel files are not among those ten datasets.** They live directly on
  `aduana.cl`, outside the `datos.gob.cl` CKAN catalogue, so the confirmed `odc-by` licence cannot
  be assumed to travel with them. This is the same "does the licence attach to this specific
  content" gap seen in every other country in this project (Singapore's STCCED PDF, Hong Kong's
  duty-rate page below) — a real, structural pattern in how government open-data programmes work,
  not a coincidence.
- **`datos.gob.cl`'s own portal-wide terms of use** (referenced by search results as living at
  `datos.gob.cl/terminos-y-condiciones`) could not be directly fetched in this pass — the URL
  returned HTTP 404, consistent with the portal being a JS-rendered SPA (matching the earlier
  Wave 3A finding that this portal's routes are unreliable for plain HTTP fetch). This is recorded
  as an access limitation, not as evidence either way.
- **A same-government pattern worth flagging as context, not as a determination.** A different
  Chilean agency (SAG, Servicio Agrícola y Ganadero) was found to license its own general website
  content under CC BY-NC-SA (non-commercial) by default, distinct from its `datos.gob.cl` open-data
  publications. This suggests a two-tier pattern across Chilean government sites generally — general
  website content is more restrictive, portal-published open data is not — but this is evidence
  about a *different* agency's practice, not a statement found on `aduana.cl` itself, so it informs
  the risk assessment without being treated as Aduana's own rights determination.
- **India preference confirmed to exist.** The Acuerdo de Alcance Parcial Chile–India (Chile–India
  Partial Scope Agreement) was signed 2006-03-08 and has been in force since 2007-08-17
  (Supreme Decree No. 148, Ministry of Foreign Affairs), with an official Aduana page devoted to it
  (`aduana.cl/acuerdo-de-alcance-parcial-chile-india/...`). It began with fixed preferential margins
  on 296 Chilean tariff lines for India-origin goods and has since been expanded toward roughly
  2,800 lines. **Scheme existence is confirmed; line-level coverage and whether the arancel Excel
  files carry a machine-readable India-preference column were not verified in this pass** (rights
  were not yet cleared, so this was not pursued further — consistent with the project's discipline
  against building semantic understanding of a source before its rights are settled).
- **National tariff-code depth, MFN, effective dates:** not mapped line-by-line in this pass — out
  of scope while rights remain unresolved, and would duplicate effort if permission is not granted.

**Determination: `RIGHTS_UNRESOLVED`** — the strongest replacement lead in Wave 3A, and it remains
so, now with a confirmed positive institutional signal (SNA's other datasets) weighed against a
confirmed structural gap (the Arancel files sit outside that same licensed catalogue) and a
same-government cautionary pattern (SAG's non-commercial default). Not `CLEARED_WITH_CONDITIONS` —
no primary evidence grants the required rights for the actual dataset needed.

### Part 9 — Chile permission packet

**Contact route identified:** two real, confirmed options. (1) `aduana.cl`'s own **"Contáctanos"**
page (`aduana.cl/contactanos/aduana/2019-03-21/002852.html`) routes to a web form rather than a
direct email — appropriate for a routine inquiry. (2) The **Ley de Transparencia (Transparency Law)
formal information-request channel**, run through the Portal de Transparencia, or directly to
`transparencia@aduana.cl` for portal difficulties — this is a statutory channel with a mandatory
20-business-day response window (extendable by 10), which makes it the stronger choice for a
question ClearTrade wants answered on the record rather than informally. **Recommended: file the
Ley de Transparencia request** for a documented, time-bound answer.

**Packet (ready to send/file, not sent):**

> **Subject / solicitud:** Confirmación de términos de reutilización — Arancel Aduanero Nacional
> (archivos Excel publicados en aduana.cl)
>
> ClearTrade es una plataforma SaaS de cumplimiento de comercio exterior que ayuda a exportadores a
> determinar el tratamiento arancelario aplicable en distintos mercados de destino. Deseamos
> incorporar de forma automatizada los archivos del Arancel Aduanero Nacional publicados en
> aduana.cl (por ejemplo, los archivos organizados por sección/capítulo del Arancel vigente), y
> queremos confirmar los términos bajo los cuales podemos hacerlo antes de proceder.
>
> No solicitamos autorización para republicar su base de datos en bruto. Solicitamos confirmación
> de que podemos:
>
> 1. descargar automática y periódicamente los archivos Excel del Arancel Aduanero Nacional
>    publicados oficialmente;
> 2. normalizar internamente esa información en nuestra propia base de datos;
> 3. conservar versiones históricas de las publicaciones para fines de trazabilidad y vigencia;
> 4. generar resultados derivados (clasificación arancelaria y condiciones de acceso a mercado) a
>    partir de esa información;
> 5. poner esos resultados derivados a disposición de nuestros clientes de pago, como parte de un
>    servicio comercial; y
> 6. hacerlo dando atribución clara al Servicio Nacional de Aduanas como fuente, sin redistribuir
>    los archivos originales en bruto a terceros.
>
> Notamos que el Servicio Nacional de Aduanas ya publica otros conjuntos de datos (registros de
> importación y exportación) en datos.gob.cl bajo licencia ODC-BY. Agradeceríamos confirmar si el
> Arancel Aduanero Nacional está sujeto a la misma licencia, a una distinta, o si se requiere
> autorización específica para el uso descrito.
>
> Agradecemos su respuesta a la brevedad posible.

## Part 10 — Hong Kong rights resolution

This pass changed Hong Kong's picture more than either Iceland's or Chile's — from Wave 3A's
"promising, rights unresolved" to a more specific and less favorable finding.

- **Does Hong Kong actually levy customs tariffs generally?** Confirmed, precisely: Hong Kong is a
  free port. The Customs and Excise Department (C&ED) collects duty on exactly four categories of
  dutiable goods — liquor, tobacco, hydrocarbon oil, and methyl alcohol. All other goods carry a 0%
  general import duty, confirmed by C&ED's own published guidance. This means "observed zero" is a
  real, authoritative fact for the overwhelming majority of HS lines, not a data gap — see the
  semantic note below.
- **The actual rate content, confirmed real and non-trivial.** The "Types and Duty Rates" page
  (`customs.gov.hk/en/service-enforcement-information/trade-facilitation/dutiable-commodities/
  types-and-duty-rates/index.html`) was fetched directly and contains genuine tiered/formula-based
  duty rules — e.g., liquor above 30% alcoholic strength by volume is charged 100% ad valorem on the
  first HK$200 of value-per-litre and 10% on the remainder, with an explicit fallback assessment
  rate (HK$160/litre) when value information is insufficient; wine and lower-strength liquor are
  confirmed at 0%. This is Grade C: a single official page, not an API, but genuinely structured
  and non-trivial.
- **Does `data.gov.hk`'s licence cover this page?** This is the crux, and it resolves negatively.
  `data.gov.hk`'s own Terms and Conditions were fetched and are explicit and permissive: "Data"
  published *on DATA.GOV.HK* may be browsed, downloaded, distributed, reproduced, and used **for
  both commercial and non-commercial purposes**, free of charge, subject only to attribution. This
  is as clean a grant as exists anywhere in this project. But a direct search for a Customs and
  Excise Department dutiable-commodities or duty-rate dataset *on data.gov.hk itself* found none —
  the duty-rate content exists only on `customs.gov.hk`, a page never published through the open-data
  platform, so this permissive licence's own stated scope ("on DATA.GOV.HK") does not reach it.
- **What governs `customs.gov.hk` instead — found, and materially different.** The territory-wide
  **GovHK Copyright Notice & Disclaimer** (`gov.hk/en/about/copyright.htm`) was fetched directly.
  It draws exactly the two-tier distinction this project has now seen repeatedly: "Data" on
  data.gov.hk is broadly reusable, but general Government **text content** — the category a page
  like Types and Duty Rates falls into — "may be reproduced and distributed free of charge... for
  **personal or internal use within an organisation**," explicitly **excluding** any "sale, or
  exchange for any benefit, gain, profit or reward, or **any other commercial purposes**," with
  commercial purposes defined broadly enough to cover a paid SaaS product without ambiguity. Clause
  7 is unambiguous: **"Prior written consent of the Government is required"** for any use beyond
  personal/internal, addressed to a named channel (below). This notice governs `gov.hk` itself; it
  was not separately confirmed that `customs.gov.hk` carries an identical clause rather than its own
  department-specific one (a direct guess at a C&ED-specific copyright URL 404'd, and no
  department-specific alternative was located), but it is the correct, evidenced HKSAR-wide default
  pattern and the strongest primary signal available for how this content is actually licensed.

**Determination: upgraded from `RIGHTS_UNRESOLVED` to `WRITTEN_PERMISSION_REQUIRED`.** This is a
more precise, and less favorable, finding than Wave 3A's — the government's own general policy, not
silence, is what applies here, and it explicitly requires written consent for exactly the use
ClearTrade needs. This is recorded as new information superseding Wave 3A's characterization for
Hong Kong specifically, not as a retroactive edit of the Wave 3A document itself.

**On the semantic point the task specifically flagged:** once permission is resolved, Hong Kong is
a genuinely good test of "observed zero" vs. "missing evidence" — a general 0% MFN rate, authoritatively
stated by C&ED for all non-dutiable goods, is real observed evidence of a duty-free regime and should
be represented as such (`specific`/`ad valorem` zero, sourced and dated), never as `unparsed` or
absent. This remains a design note for whenever Hong Kong is actually built — no code was written.

**India relevance, honestly assessed:** minimal. With general duty already at 0% for virtually all
goods, there is little for a preference scheme to do — India-origin goods already receive the best
possible MFN treatment on non-dutiable goods. This keeps Hong Kong's overall priority below Iceland
and Chile even though its interface and underlying rate content are real and well understood.

### Part 11 — Hong Kong permission packet

**Contact route identified, directly from the primary source:** the GovHK Copyright Notice names
the exact channel for consent requests — **`enquiry@1835500.gov.hk`** (the "1835500" GovHK Help
Desk). This is a real, confirmed, government-published address for exactly this kind of request, not
a guess.

**Packet (ready to send, not sent):**

> **Subject:** Written consent request — commercial use of Customs and Excise Department dutiable
> commodities duty-rate information
>
> To the GovHK Help Desk,
>
> ClearTrade is a trade-compliance SaaS platform that helps exporters determine tariff and duty
> treatment across destination markets. We would like to build automated support for Hong Kong,
> sourced from the Customs and Excise Department's published "Types and Duty Rates" information
> (dutiable commodities: liquor, tobacco, hydrocarbon oil, methyl alcohol) at
> `customs.gov.hk/en/service-enforcement-information/trade-facilitation/dutiable-commodities/
> types-and-duty-rates/index.html`, together with the Department's own confirmation that all other
> goods carry a 0% general import duty.
>
> We understand from the GovHK Copyright Notice that text content of this kind may be used for
> personal or internal use free of charge, but that written consent is required for any other use,
> including commercial use. We are writing to request that consent for the following specific use:
>
> 1. periodically and automatically retrieving the published duty-rate information;
> 2. transforming it into our own canonical tariff database;
> 3. retaining historical versions as rates change, for audit and effective-dating purposes;
> 4. incorporating the resulting duty facts (including the confirmed 0% general rate) into a
>    commercial, paid SaaS product; and
> 5. displaying those facts, with clear attribution to the Government of the Hong Kong Special
>    Administrative Region and the Customs and Excise Department, to our paying customers — without
>    redistributing the Department's own pages or files to third parties.
>
> We would be grateful for written confirmation that this use is permitted, or guidance on any
> conditions that would apply.

## Part 12 — not waiting

This task is complete as research and preparation: primary-source research is exhausted for all
three rights questions within a reasonable pass, the exact unresolved questions are identified, and
all three permission packets are drafted and ready to send. No email was actually sent by this
agent — sending a written request to a government authority is a communication on ClearTrade's
behalf that a human operator should dispatch (and can adjust tone/sender identity for), not something
this task authorizes an agent to transmit autonomously. Status for all three is recorded as
**`WRITTEN_PERMISSION_SENT_OR_READY`**, not "research incomplete."

## Part 13 — registry update (Wave 3B decision layer)

This section is a new layer on top of Wave 3A's conclusions, not an edit to them.
`src/lib/market-access/unconfigured-sources.ts` was **not modified** — it is runtime code, and this
task is research/preparation only. The determinations below are what a future runtime-code change
should encode once the underlying blocker actually clears.

| Country | Wave 3A status | Wave 3B status | What changed |
|---|---|---|---|
| KR (South Korea) | `CREDENTIAL_REQUIRED` | `CREDENTIAL_REQUIRED` — confirmed absent on staging | Registration mechanics fully specified (Part 1); credential itself still not provisioned |
| IS (Iceland) | `RIGHTS_UNRESOLVED` | `WRITTEN_PERMISSION_SENT_OR_READY` | Traced to the professional/software-vendor section specifically; permission packet drafted; contact route identified (`vefur@skatturinn.is`) |
| CL (Chile) | `RIGHTS_UNRESOLVED` | `WRITTEN_PERMISSION_SENT_OR_READY` | SNA's other datasets confirmed `odc-by` via direct CKAN API call; Arancel files confirmed outside that catalogue; India-Chile PTA confirmed to exist; permission packet drafted; contact route identified (Ley de Transparencia / Contáctanos) |
| HK (Hong Kong) | `RIGHTS_UNRESOLVED` | `WRITTEN_PERMISSION_REQUIRED` → `WRITTEN_PERMISSION_SENT_OR_READY` | Upgraded to a more specific, less favorable finding: GovHK's own copyright notice explicitly requires written consent for this content; permission packet drafted; contact route identified (`enquiry@1835500.gov.hk`) |

No candidate reached `CLEARED` or `CLEARED_WITH_CONDITIONS` in this sprint.

## Part 14 — Korea implementation

Not applicable. The credential remains absent, so no Korea adapter was implemented, and none of the
build/test/deploy gates in Part 14 of the task were run. Per the task's own instruction, research-only
changes (this document, plus the already-pushed Wave 3A commit) are not being deployed — deployment
is not genuinely necessary for a documentation-only change, and staging/production both remain
untouched by this sprint beyond the read-only Railway variable-name inspection in Part 1.

## Part 15 — final queues

**# IMPLEMENTED THIS RUN**

*(none)*

**# READY TO BUILD NEXT**

*(none unconditionally.)* Once any one of the following clears, it becomes the queue:
- **South Korea**, immediately upon `KCS_DATA_GO_KR_SERVICE_KEY` provisioning — the only remaining
  gate is operational, not a research one.
- **Iceland**, **Chile**, or **Hong Kong**, each immediately upon written permission being granted
  in the terms requested — packets are drafted and ready.

**# CREDENTIAL REQUIRED**

- South Korea — `KCS_DATA_GO_KR_SERVICE_KEY`, self-service registration, steps recorded in Part 1.

**# WRITTEN PERMISSION REQUIRED**

- Iceland — packet ready, contact `vefur@skatturinn.is`.
- Chile — packet ready, recommended route: Ley de Transparencia formal request.
- Hong Kong — packet ready, contact `enquiry@1835500.gov.hk`.
- (Carried forward, unchanged this sprint: Switzerland/`CH_BAZG_TARES`, Liechtenstein by
  inheritance, South Africa.)

**# INTERFACE BLOCKED**

- Carried forward unchanged: Thailand, Israel, Singapore, Indonesia, Vietnam, Malaysia.

**# LEGALLY BLOCKED**

- Carried forward unchanged: Türkiye.

**# DEFER**

- Mexico (`SOURCE_INSUFFICIENT`), Taiwan (inconclusive) — carried forward unchanged.

## Part 16 — final report

1. **Starting HEAD:** `565980191bd79adf137293afd8e11d944285a877` (`5659801`).
2. **Ending HEAD:** unchanged, `565980191bd79adf137293afd8e11d944285a877` — this sprint produced
   only this new document, not yet committed at the time of writing this report (committed
   immediately after, see final line of this section once done).
3. **Was `5659801` pushed?** Yes — it was on the local branch but not on `origin` at the start of
   this sprint; pushed to `origin/agent-portal-and-document-engine` with no deploy triggered.
4. **KR credential status:** absent from both `cleartrade-worker` and `cleartrade-ai-build-spec` on
   Railway staging. Value never read or logged — presence only.
5. **KR API schema:** not accessed — credential absent, so no live call was made (Parts 2–5 skipped
   as instructed).
6. **KR implementation status:** not implemented. No adapter code written.
7. **KR MFN coverage:** not established this sprint (requires the credential).
8. **KR India CEPA coverage:** not established this sprint; Wave 3A's finding stands (scheme exists,
   exact rate-classification code unconfirmed, secondary CEPA-specific dataset not yet identified).
9. **KR qualification result:** not run — no data was acquired.
10. **Iceland final rights status:** `RIGHTS_UNRESOLVED` on the merits, operationally
    `WRITTEN_PERMISSION_SENT_OR_READY` — packet drafted, not yet sent by a human.
11. **Iceland contact route:** `vefur@skatturinn.is` (Skatturinn website/webmaster contact,
    published on the exact software-vendor pages this dataset lives on); phone +354 442 1000 as
    fallback.
12. **Chile final rights status:** `RIGHTS_UNRESOLVED` on the merits, operationally
    `WRITTEN_PERMISSION_SENT_OR_READY` — packet drafted, not yet filed.
13. **Chile contact route:** Ley de Transparencia formal information request via the Portal de
    Transparencia (statutory 20-business-day response, extendable by 10) — recommended over the
    informal `aduana.cl` "Contáctanos" web form for a question ClearTrade wants answered on record.
14. **Hong Kong final rights status:** upgraded from Wave 3A's `RIGHTS_UNRESOLVED` to
    `WRITTEN_PERMISSION_REQUIRED`, operationally `WRITTEN_PERMISSION_SENT_OR_READY` — packet drafted,
    not yet sent.
15. **Hong Kong contact route:** `enquiry@1835500.gov.hk` (GovHK Help Desk, the exact channel named
    in the GovHK Copyright Notice for consent requests).
16. **Permission packets prepared:** three — Iceland, Chile, Hong Kong. All describe ClearTrade's
    actual SaaS use point-by-point (retrieval, caching, retention, transformation, commercial use,
    customer display, attribution, no raw redistribution); none is a vague "can we use your
    website" ask.
17. **Updated READY_TO_BUILD queue:** still empty, unconditionally. Four items are now exactly one
    external action away: one credential (Korea, self-service) and three written-permission
    responses (Iceland, Chile, Hong Kong, all now drafted and ready to send).
18. **Operational destinations before this sprint:** 34 (unchanged — Wave 3A added none, and this
    sprint implements nothing).
19. **Operational destinations after this sprint:** 34 (unchanged). No adapter was built.
20. **Recommended next coding batch:** none yet. The recommended next *actions* are non-coding: (a)
    a ClearTrade operator provisions the Korea credential (near-certain, self-service, single
    destination); (b) a ClearTrade operator sends the three drafted permission requests. The first
    of these four to resolve should trigger a small, single-country coding pass sized like Norway in
    Wave 2 — not a bundled wave, since each of the four is an independent unlock with no shared
    acquisition path.

## DID WAVE 3B CREATE AT LEAST ONE NEW BUILDABLE AUTHORITY PACK?

**NO.**

Nothing in this sprint crossed into `CLEARED`/`CLEARED_WITH_CONDITIONS` territory — the Korea
credential remains genuinely absent (an operational fact, not a research question this sprint could
resolve), and Iceland, Chile, and Hong Kong's rights questions were narrowed and specified precisely
but not answered, because answering them requires a response from a foreign government authority
that only a human-dispatched written request can obtain. Fabricating a coding wave on top of any of
these four would repeat the exact mistake this whole Wave 3 track exists to avoid.

**Recommended next source-clearance targets**, instead of a coding wave: none — this sprint's
job was to unblock the four items Wave 3A already identified as closest, not to widen the pool
further. The correct next step is operational (provision the Korea key, send the three packets), and
the correct next *research* action is to re-run this same rights-resolution pass on whichever of
Iceland/Chile/Hong Kong responds first, once a reply exists to evaluate — not to open new candidates
prematurely.

No Phase 2 work was started. No Country Truth scoring was modified. Production was not touched.
