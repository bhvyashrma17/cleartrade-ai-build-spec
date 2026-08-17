# Agent portal completion + legacy document engine integration — design

**Status: design only. No implementation in this document.** Produced from a recursive audit of
both codebases. Nothing in the legacy project was modified, and nothing has been copied yet.

- Current repo: `/Users/bhavya-mac/Downloads/cleartrade-ai-build-spec`
- Legacy project: `/Users/bhavya-mac/Desktop/Export` — 246 files, 5.3 MB, no `node_modules`/`.next`
  present. (The second path given, `~/Downloads/cleartrade-old-document-engine/Export`, does not
  exist; `~/Desktop/Export` is the only copy on this machine.)

---

## 0. The three findings that shape everything below

**1. ClearTrade already has the exact seam this integration needs.**
`src/lib/document-generation/index.ts` selects an engine from `DOCUMENT_ENGINE` and today only
knows `MockDocumentEngine`. Its own comment states the intent: *"Swapping in a real renderer
means adding an implementation of `DocumentGenerationEngine` and a case here. Nothing in the job
handler, the routes, the schema, or the UI names an engine."* So the legacy engine becomes
`case 'legacy'` behind `DocumentGenerationEngine` — a library, not a second app. This is the
single most important fact in the audit: the integration target already exists and is designed
for this.

**2. The legacy renderers are pure functions over plain objects.** Every
`html*Template.ts`, `pdf.ts` and `docx.ts` generator takes `(invoice: any, …)` and returns
bytes/HTML. Only `documentPdfService.ts` touches Prisma, and it is a thin 363-line adapter that
loads the legacy DB and calls the pure generators. **That adapter is the only file we replace** —
we write a ClearTrade adapter that maps canonical data into the same plain-object shape.

**3. The blocker is data, not code.** The generators are reusable; ClearTrade cannot currently
*feed* them. `DealSnapshot` carries 15 commercial fields (buyer name, product, quantity, price,
incoterm, ship window). A statutory commercial invoice or shipping bill additionally needs
exporter postal address, AD code, buyer street address, ports + UN/LOCODE, container/BL/AWB,
package counts, marks & numbers, freight/insurance split, FOB/CIF, exchange rate + RBI rate date,
and a controlled invoice number. **None of those exist in ClearTrade today.** Wiring the engine
without closing this gap produces documents that render but are not filable — the worst outcome,
because they look finished. Schema work in §4 is therefore a prerequisite, not a follow-up.

---

## 1. Legacy capability → source → ClearTrade equivalent → verdict

Verdicts: **REUSE** (lift near-verbatim) · **ADAPT** (keep logic, replace data access) ·
**REJECT** (ClearTrade already has a better one, or it does not belong).

### 1a. Document renderers — the core asset

Confirmed from source, not from description. Legacy supports **7 PDF, 8 DOCX, 8 HTML** documents:

| Document | Legacy source | ClearTrade `DocType` | Verdict | Reason |
|---|---|---|---|---|
| Commercial invoice | `pdf.ts:generateInvoicePDF`, `docx.ts:generateInvoiceDOCX`, `htmlInvoiceTemplate.ts` (523 L) | `CI` / `PI` | **REUSE** | Pure over plain objects. No ClearTrade equivalent exists. |
| Packing list | `pdf.ts:182`, `docx.ts:114`, `htmlPackingListTemplate.ts` (388 L) | `packing_list` | **REUSE** | Same. |
| Shipping bill | `pdf.ts:219`, `docx.ts:176`, `htmlShippingBillTemplate.ts` (368 L) | `shipping_bill_draft` | **REUSE** | Same. Largest generator (269 L in `pdf.ts`) — statutory layout. |
| Certificate of origin | `pdf.ts:584`, `docx.ts:234`, `htmlCertificateOfOriginTemplate.ts` | `COO_draft` | **REUSE** | Same. |
| Insurance declaration | `pdf.ts:723`, `docx.ts:278`, `htmlInsuranceTemplate.ts` | `insurance_declaration` | **REUSE** | Same. |
| Declaration | `pdf.ts:488`, `docx.ts:334`, `htmlDeclarationTemplate.ts` | `declaration` | **REUSE** | Same. |
| Letter of credit | `pdf.ts:842`, `docx.ts:377`, `htmlLCTemplate.ts` | **none — enum gap** | **REUSE + schema** | Requires new `DocType.letter_of_credit`. |
| Compliance report | `htmlComplianceReportTemplate.ts`, `docx.ts:433`, `complianceReport.ts` | **none — enum gap** | **REUSE + schema** | Requires new `DocType.compliance_report`. |
| A4 layout contract | `documentLayoutSystem.ts` (**2081 L**), `renderDocumentLayout.ts`, `renderDocumentSkeleton.ts`, `renderSignatureBlock.ts` | none | **REUSE** | Pure. Encodes page geometry/overflow rules; has a contract audit script. Do not reimplement. |

### 1b. PDF/DOCX rendering strategy — the de-risked decision

| Path | Legacy source | Verdict | Reason |
|---|---|---|---|
| `pdf-lib` direct | `pdf.ts` (923 L), dep `pdf-lib` | **REUSE — primary** | Pure JS, no browser binary. All 7 documents implemented here, not stubs. |
| Puppeteer HTML→PDF | `pdfBrowser.ts` (120 L), deps `puppeteer` + `@sparticuz/chromium` | **REJECT for now** | Needs a ~300 MB Chromium in the image. The scanner already showed this platform is memory-constrained. Legacy itself treats it as optional: `documentPdfService.ts` catches `puppeteerError` and **falls back to `pdf-lib`**. We adopt the fallback as the only path and keep HTML templates for on-screen preview. |
| DOCX | `docx.ts` (482 L), `docx/layout.ts`, dep `docx` | **REUSE** | Pure JS, no binary. |
| Zip bundling | `app/api/documents/download-zip`, dep `jszip` | **ADAPT later** | Useful for "download all deal documents"; not phase 1. |

New ClearTrade dependencies required: **`pdf-lib`, `docx`** (both pure JS). Explicitly *not*
`puppeteer`, `@sparticuz/chromium`.

### 1c. Compliance / validation engines

| Capability | Legacy source | Coupling | Verdict | Reason |
|---|---|---|---|---|
| Master compliance pipeline | `masterCompliancePipeline.ts` (519 L) + test | pure | **REUSE** | Orchestrates the engines below; pure. The natural entry point for "run compliance validation". |
| Cross-document consistency | `crossDocumentConsistencyEngine.ts` (**1067 L**) | pure | **REUSE** | Highest-value engine: catches invoice↔packing-list↔shipping-bill contradictions. No ClearTrade equivalent. |
| Compliance blocks | `complianceBlocks.ts` (836 L), `complianceHelpers.ts` | pure | **REUSE** | Produces the blocking-error/warning list the UI needs. |
| LC compliance (UCP 600) | `lcComplianceEngine.ts` (883 L) + 626 L test | pure | **REUSE** | Substantial, tested, pure. |
| LC term fuzzy match | `lcTermFuzzyMatchService.ts` (444 L) | pure | **REUSE** | Pure. |
| Commodity rules | `commodityEngine.ts` (756 L) + 548 L test | pure | **REUSE** | Pure. |
| HS/GST tariff | `hsGstTariffService.ts` (862 L) | pure | **REUSE** | Pure. Cross-check against ClearTrade `ProductClassification` rather than duplicating HS storage. |
| FEMA/RBI realization | `feamRBIRealizationService.ts` (859 L) | pure | **REUSE** | Pure. Note filename typo (`feam`) — rename on import. |
| Money / decimal arithmetic | `money.ts` (343 L), `calculations.ts` (320 L) | pure | **REUSE** | Decimal-safe arithmetic; documented hardening. Must not be re-derived with floats. |
| Exchange rate | `exchangeRateService.ts` (288 L) | pure | **REUSE** | Pure. |
| Exchange-rate crypto proof | `exchangeRateCryptoProofService.ts` (514 L) | PRISMA | **ADAPT** | Concept (provable rate at a point in time) is sound; storage must become a ClearTrade model. |
| Consistency engine (v1) | `consistencyEngine.ts` (771 L), `documentConsistencyEngine.ts` (177 L) | PRISMA | **ADAPT** | Superseded in part by `crossDocumentConsistencyEngine`; de-duplicate on import — legacy carries both. |
| Customs duties | `customsDutiesEngine.ts` (671 L) + test | PRISMA | **ADAPT** | Logic reusable; reads legacy Invoice/Item. |
| Port compliance | `portComplianceEngine.ts` (648 L) + test | PRISMA | **ADAPT** | Needs UN/LOCODE data (below). |
| Trade classification | `tradeClassificationEngine.ts` (722 L) + test | PRISMA | **ADAPT** | Overlaps ClearTrade `ProductClassification`/`product-classification.ts` — reconcile, do not run both. |
| Realization compliance | `realizationCompliance.ts` (701 L), `sectorRealizationGateService.ts` (627 L) | PRISMA | **ADAPT** | Maps onto ClearTrade `Payment`/`BrcStatus`. |
| Pre-submission gate | `preSubmissionValidationGate.ts` (400 L), `validate.ts` (353 L) | PRISMA | **ADAPT** | Becomes the gate before `approval_status → approved`. |
| HS live validation | `hsCodeLiveValidationService.ts` (522 L) | PRISMA | **ADAPT** | External lookup; must respect ClearTrade provider-quota + evidence-origin rules. |
| LC term lock | `lcTermLockService.ts` (766 L), `lcComplianceService.ts` | PRISMA | **ADAPT** | Locking concept overlaps ClearTrade `DealSnapshot`/deal lock — reuse ClearTrade's lock, keep LC-specific term comparison. |
| UN/LOCODE port data | `data/unlocodePorts.ts` (**39,718 L**) | pure data | **REUSE, relocated** | Reference data, not code. Do not put a 40k-line literal in the app bundle — load as a JSON asset or seed a table. |
| Invoice number sequencing | `invoiceSequence.ts` (411 L) + models `InvoiceSequence`, `CancelledInvoiceNumber`, `InvoiceSequenceAudit` | PRISMA | **ADAPT — required** | Statutory gapless numbering with cancellation audit. ClearTrade has **no** equivalent. Needed before any real CI is issued. |
| Document lifecycle | `documentLifecycle.ts` (245 L), `InvoiceLifecycleStatus` (DRAFT/READY/LOCKED/AMENDED), `documentHash`, `InvoiceVersion` | PRISMA | **REJECT — ClearTrade is better** | ClearTrade `Document` already has 4 *independent* dimensions (generation/review/approval/filing), `version` + `is_current_version` + `@@unique([deal_id, doc_type, version])`, `checksum`, and approval bound to `approved_version` + `approved_checksum`. Legacy collapses this into one enum. Keep ClearTrade's. |

### 1d. Rejected wholesale — ClearTrade already owns these

| Legacy area | Source | Why rejected |
|---|---|---|
| Auth | `authOptions.ts`, `auth.ts`, `session.ts`, `app/api/auth/**`, deps `next-auth@4`, `@auth/prisma-adapter`, `bcryptjs`, `jose` | ClearTrade runs Auth.js **v5** with a deliberate no-adapter design (docs/29). Importing v4 + adapter would create a second auth system. |
| Users / exporters / buyers | legacy `User`, `Exporter`, `Buyer`, `ExporterADMapping` | ClearTrade `User`, `ExporterOrg`, `Buyer` are canonical and RBAC-scoped. Never duplicate. |
| Prisma client | `db.ts` | ClearTrade `src/lib/prisma.ts`. Legacy also sets `log: ["query"]` — would log every query in production. |
| Payments | `razorpay`, `app/api/payments/**`, `create-order`, `verify-payment`, legacy `Payment` | ClearTrade has its own commitment-fee/`Payment`/`Payout` model. |
| Quota / freemium / guest | `usage.ts`, `guestTracking.ts`, `useGuestTracking.ts`, `GuestUser`, `Usage`, `app/api/guest/**`, `app/(app)/upgrade` | ClearTrade has `OrgTier` + `GuestRunQuota` with keyed IP hashing. Legacy guest tracking is weaker. |
| Admin dashboard | `adminDashboard.ts`, `app/(admin)/**` (user-segment CRUD) | ClearTrade has the `/ops` portal with real RBAC. |
| Email | `nodemailer` | ClearTrade has `notification-delivery.ts` (Resend/sandbox + redirect guards). |
| Watermarking | `watermarkDecision.test.ts` | Tier-gated watermarking is a legacy freemium behaviour; ClearTrade gates by `OrgTier`/capability instead. Revisit only if product asks. |
| All `app/**` routes/pages | `app/(app)/documents/**`, `app/api/documents/**` (24 route dirs) | These are a **parallel application**. We take the libraries they call, not the routes. ClearTrade's own routes + RBAC + audit replace them. |
| Env / build / editor files | `.gitignore`, `.DS_Store`, any env file | Never copied, per instruction. |

### 1e. Legacy documentation worth keeping

18 top-level `.md` files (~300 KB) encode the regulatory reasoning: `CROSS_DOCUMENT_CONSISTENCY.md`,
`INVOICE_SEQUENCE_CONTROL.md`, `LC_TERM_LOCK_SERVICE.md`, `FEMA_RBI_REALIZATION_CLAUSES.md`,
`HS_GST_TARIFF_VALIDATION.md`, `DECIMAL_ARITHMETIC_*.md`, `AD_PORT_VALIDATION.md`, engine
references. **REUSE as reference** under `docs/legacy-engine/` — this is the *why* behind the
rules, and it is cheaper to keep than to re-derive from Indian trade regulation.

---

## 2. Existing Agent capability → required → gap → implementation

The portal is more complete than the brief assumes. `/agent/exporters/[exporterOrgId]` is already
389 lines with 9 sections (products & commercial profile, discovery summary, execution readiness,
buyer pipeline, deals, tasks & blockers, history, communication, timeline). Seven of nine agent
pages are substantially built. The gaps are **depth and control**, not existence.

| Required (Exporter 360) | Exists today | Gap | Implementation |
|---|---|---|---|
| Readiness summary | ✅ "Execution readiness" | none | — |
| Products + confirmed HS | ✅ "Products & commercial profile" | none | — |
| Demand Discovery **control** | ⚠️ "Discovery summary" (read-only summary) | **large** | §3a |
| Buyer Discovery **control** | ⚠️ "Buyer pipeline" (pipeline only, no fit evidence) | **large** | §3b |
| Outreach | ⚠️ partial via pipeline | medium | Surface `OutreachActivity`/`OutreachAttempt` + approve/reject draft actions |
| Deals | ✅ "Deals" | none | — |
| **Documents** | ❌ absent | **large** | §5 |
| Execution | ✅ "Execution readiness" | none | — |
| Tasks / escalations | ✅ "Tasks & blockers" | small | Add escalation filter + link to `/agent/escalations` |
| Internal notes | ⚠️ "Communication" | small | Confirm it renders `InternalNote` (model exists) |
| Audit / activity history | ✅ "History" + "Timeline" | none | Backed by `AuditEvent` |

### Missing first-class routes

| Route | Decision | Reason |
|---|---|---|
| `/agent/deals` | **Build** | Nav links to it and it 404s today. Cross-exporter deal queue is a real agent need (an agent holds ~10 exporters). |
| `/agent/escalations` | **Build** | Same — nav 404. Backed by `Task.sla_state ∈ {overdue, escalated}` + `Dispute`, both existing. |
| `/agent/exporters` (index) | **Build** | Nav links to `/agent/exporters` but only `[exporterOrgId]` exists — also a 404. **Found during audit; not in the brief.** |
| exporter-level markets / buyers / documents | **Tabs, not routes** | They are always *within one exporter's* context. Nesting them as `/agent/exporters/[id]?tab=markets` keeps one permission check, one data load, one breadcrumb. New top-level routes would duplicate the assignment guard and invite unscoped queries. |
| `/ops/settings` | **Note only** | Ops nav links to it and it 404s. Out of scope here, but it is where agent provisioning (§6) belongs. |

---

## 3. Discovery control surfaces

### 3a. Demand Discovery

`MarketAssessment` already stores **everything** the brief asks the agent to see — this is a UI
gap, not a data gap: `overall_score` + 8 component scores, `confidence_score`, `model_version`,
`weight_profile_key`/`_version`, `scoring_policy_version`/`_hash`/`_snapshot`,
`reproducibility_status`, `as_of_date`, `evidence_origins`, `eligibility_status`/`_reasons`, and
`field_provenance` — which already carries the `{status:'unavailable', reason}` shape needed for
"unavailable components and reasons" (its own comment notes fabricating a missing value is
forbidden). Rank is derived from the existing `@@index([run_id, overall_score])` ordering.

One genuine gap: **effective vs base weights.** `weight_profile_key`/`_version` identify the
profile; the resolved per-component effective weights must be read from
`scoring_policy_snapshot` (verify at implementation) or added to it. Do not recompute them in the
UI — a recomputed weight is not the weight that produced the score.

### 3b. Buyer Discovery

`BuyerFitAssessment` holds `score`, `components` (Json breakdown), `input_snapshot`,
`confidence_score`, `model_version`, `evidence_origins`. Surrounding evidence exists in
`BuyerSourceEvidence`, `BuyerAttributeClaim`, `BuyerFeatureSnapshot`, `ImportRecord` +
`SourceRightsGrant` (privacy/source-rights state), `SanctionsScreeningCase` (fail-closed),
`BuyerContact`, `OutreachActivity`, `BuyerLead`. All present; none needs new storage.

### 3c. The learning loop

`BuyerOutcome` already records `contacted_at`, `replied_at`, `converted`, `rejection_reason`,
`payment_behavior`, `deal_id`. To answer *"did human overrides beat the model?"* the override row
must capture the **model score as it was at override time** (§4), so the join is
`AgentDecision.original_score → BuyerOutcome.converted` without re-reading a since-recomputed
assessment. Storing only a foreign key would silently re-point at a newer score and destroy the
comparison.

---

## 4. Schema changes required — before any Prisma edit

### 4a. The audited override layer (the core of this work)

One polymorphic `AgentDecision` model, not two, so the "AI recommendation vs Agent decision"
distinction and the audit shape are identical for markets and buyers.

```
model AgentDecision
  id, exporter_org_id, actor_user_id
  subject_type      enum(market_assessment | buyer_fit)
  subject_id        String            // MarketAssessment.id | BuyerFitAssessment.id
  decision          enum(promote|demote|reject|restore|shortlist|disqualify
                         |mark_selected|mark_not_selected|qualify|unqualify
                         |pause_automation|resume_automation|request_review)
  agent_priority    Int?              // operational rank — NEVER the model rank
  reason            String            // mandatory, free text
  // Immutable copies of what the model said AT DECISION TIME:
  original_score    Int?
  original_rank     Int?
  original_model_version   String?
  original_policy_hash     String?
  expires_at        DateTime?
  review_state      enum(active|expired|superseded|withdrawn)
  superseded_by_id  String?
  created_at        DateTime          // no updated_at — rows are immutable
```

Invariants: **append-only** (a change writes a new row and sets `superseded_by_id` on the old
one — never `UPDATE`); the model's own columns are **never written** by this path; every write
also emits an `AuditEvent`. The `original_*` snapshot is what makes the §3c comparison possible
and what stops an override from being retro-justified by a later recompute.

### 4b. Document generation prerequisites

| Change | Why |
|---|---|
| `DocType` += `letter_of_credit`, `compliance_report` | Legacy generates both; enum has no value for them (§1a). |
| `DocumentGenerationResult.content: string` → `string \| Uint8Array` | PDFs/DOCX are binary. Current type cannot carry them; the comment already anticipates this. |
| `DocumentGenerationInput.snapshot` extension | 15 fields is not enough for a filable document (§0.3). |
| New `ExporterOrg` fields: postal address, AD code | Absent. Shipping bill and FEMA/RBI checks need them (legacy has `ExporterADMapping` + an `add_ad_code_fields` migration). |
| New `Buyer` address fields | `Buyer` has `legal_name`, `country_code` only — an invoice needs a consignee address. |
| `Shipment`: typed ports + UN/LOCODE, container/BL/AWB, package count, marks & numbers | Today `origin`/`destination` are untyped `Json?`. Statutory fields must not live in loose JSON. |
| Exchange rate + rate date on the deal/snapshot | RBI requires the rate *and* when it was fixed. Absent. |
| `InvoiceSequence` + `CancelledInvoiceNumber` + `InvoiceSequenceAudit` | Gapless statutory numbering with cancellation audit. No ClearTrade equivalent. |

**These are prerequisites.** Generating a CI without them yields a document that renders and is
not filable — which is worse than no document, because it looks done.

---

## 5. Target document experience

`LegacyDocumentEngine implements DocumentGenerationEngine`, registered as `DOCUMENT_ENGINE=legacy`.
It reuses, unchanged: ClearTrade `Document` rows (4 status dimensions, versions, checksum),
`DocumentStorage` (S3/local), the **malware scanner** fail-closed path, `AuditEvent`, RBAC, and
`DealSnapshot` as the generation source of record (`generated_from_snapshot_id` already exists →
reproducible regeneration). No parallel document table, no second ownership model.

Agent flow → existing mechanism: *required/missing* → `requirements.ts:collectMissingSnapshotFields`
· *generate* → job handler + engine · *preview* → HTML templates · *validate* →
`masterCompliancePipeline` · *blocking errors* → `complianceBlocks` · *correct + regenerate* → new
`version` row · *review/approve* → `review_status`/`approval_status` (+ `preSubmissionValidationGate`
before approve) · *download* → existing signed-URL download route · *versions/amendments* →
`version` + `is_current_version` · *who did what* → `reviewed_by`/`approved_by`/`filed_by` +
`AuditEvent` · *handoff* → `PartnerHandoff` (CHA).

---

## 6. Ops-side agent provisioning (no self-service, no manual SQL)

`Invitation` already has `role: UserRole` + a unique `token` — but `exporter_org_id` is
**non-nullable**, which structurally blocks staff: an agent belongs to *no* org and is attached to
many via `AgentAssignment`. That single constraint is why provisioning currently has no path
other than editing Postgres.

Proposal: make `Invitation.exporter_org_id` nullable to represent a **staff invitation**, guarded
so `role ∈ {agent, ops_*, admin}` requires it to be null and exporter roles require it set.
Then an ops-only route (`admin`/`ops_supervisor`) issues the invite, the invitee accepts via token
and sets a password (or Google/Apple, which already provisions `exporter_owner` only — the accept
flow must attach the invited role instead), and `AgentAssignment` (complete already:
`assigned_by_id`, `status`, `started_at`/`ended_at`, history-preserving) assigns exporters. UI
lands in `/ops/settings`, which does not exist yet. `resolveSocialIdentity` must remain
incapable of granting a privileged role — the existing test asserting `UserRole.agent` never
appears in `social-auth.ts` stays as-is.

---

## 7. Proposed phases

| Phase | Content | Gate |
|---|---|---|
| **1** | `AgentDecision` model + migration + append-only service + audit wiring. No UI. | tests/typecheck/lint/build |
| **2** | Demand Discovery control surface in the exporter workspace (full scoring display + decision actions), AI-vs-Agent visual split. | + live check |
| **3** | Buyer Discovery control surface, same pattern. | + live check |
| **4** | `/agent/deals`, `/agent/escalations`, `/agent/exporters` index — kill the three dead nav links. | + live check |
| **5** | Document data prerequisites (§4b schema) — the honest blocker before generation. | tests |
| **6** | Legacy engine import as `src/lib/document-engine/**` (pure files first) + `LegacyDocumentEngine`, `pdf-lib`/`docx` deps, compliance pipeline. | + engine tests ported |
| **7** | Documents tab in agent deal/exporter workflow. | + live check |
| **8** | Ops agent provisioning (`Invitation` staff support + `/ops/settings`). | tests |

Phases 1–4 need no legacy code and no new dependencies. Phase 5 is the gate that must not be
skipped to reach 6–7.

---

## 8. Preserved throughout

RBAC and portal guards · assignment scoping (`assignedOrgIds`) · provenance and
`field_provenance` gaps-as-gaps · `BuyerOutcome` instrumentation · `SourceRightsGrant`
privacy controls · sanctions fail-closed · score reproducibility (`scoring_policy_hash`,
`reproducibility_status`) · malware-scan fail-closed on every document byte · append-only audit.

**The rule that governs every line of this work:** the computed model score is never overwritten,
never recomputed for display, and never inferred. Agent judgement is additive and separately
attributable.
