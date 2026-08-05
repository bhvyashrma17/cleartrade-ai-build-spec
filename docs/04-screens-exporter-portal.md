# 04 — Exporter Portal Screens (EXP-01 … EXP-17)

Source: PRD Part 05. All routes are under `/app/*`. All screens assume the shell, status system,
and shared components defined in `docs/03-global-ux-contract.md`, and the entities defined in
`docs/02-domain-model.md`. Every acceptance criterion listed is a hard requirement for calling the
screen done — see the "definition of done" note in `AGENTS.md`.

---

## EXP-01 Dashboard / Overview

`/app/overview` · Exporter · **P0** · Full mobile

The exporter home screen is a **decision surface, not an analytics dashboard**. It must summarize
journey stage, urgent actions, active buyer/deal progress, risk and assigned human support.

**Entry points:** post-login default route for exporter users; Logo/Home from any exporter page.

**Page anatomy**

| Zone / module | Required content | Interaction rule |
|---|---|---|
| Journey rail | Readiness → Market → Buyers → Deal → Docs → Ship → Paid, derived from canonical states | Clicking a completed/current stage deep-links to the relevant page; future unavailable stages are non-actionable |
| Next actions | Max 4–6 highest-priority exporter-owned tasks | Sort by blocked/urgent, due time, then priority. CTA opens the exact action target |
| Health summary | Readiness score/status, active buyers, open deal value, shipment/payment alerts | Metrics based on server aggregates; indicate last refresh if not real-time |
| Deal pipeline | Counts by contacted/interested/negotiation/deal-locked/executing | Click a count to apply the filter on Deals/Buyers page |
| Assigned agent | Name/avatar, response expectation, message/call request, escalation path if policy allows | Agent availability status must not imply real-time presence unless actually supported |
| Risk/exception banner | Only material blockers or at-risk states | Banner remains until resolved; link to owner/remediation |

**Actions & behavior**

| Action | Who | Behavior / side effects | Failure handling |
|---|---|---|---|
| Complete next action | Exporter | Navigate/action inline; update Task after successful mutation | Keep task open; show field/server error |
| Message agent | Exporter | Open thread scoped to exporter/deal | Draft preserved if send fails |
| Open deal | Exporter | Navigate to canonical Deal Workspace | If access revoked, safe 403 |

**Required UI states**

| State | UI behavior |
|---|---|
| New account | Welcome + Start readiness. No fake zero-heavy dashboard |
| Active, no deal | Discovery/buyer actions emphasized |
| Active deal | Deal and execution modules rise in prominence |
| Blocked | Persistent exception banner + owned remediation task |

**Acceptance criteria**

- **AC01** Journey stage is computed from backend status and is not manually set by the frontend.
- **AC02** Every next-action card deep-links to a valid action and disappears/updates after completion.
- **AC03** Dashboard never exposes internal agent notes, payout data, or ops-only exceptions.
- **AC04** Mobile layout preserves journey, next actions, active deal, and agent contact above secondary metrics.
- **AC05** Loading, empty, and failure states exist for each independent module rather than one blank page.

---

## EXP-02 Onboarding & Export Readiness

`/app/readiness` · Exporter · **P0** · Full mobile

Collect the minimum information required to assess export readiness and turn deficiencies into
explicit enablement tasks rather than a one-time questionnaire.

**Page anatomy**

| Zone / module | Required content | Interaction rule |
|---|---|---|
| Progress stepper | Business, Product, Capacity, Compliance, Packaging/QC, Pricing/MOQ, Banking/logistics, Samples/experience | Persist progress; allow back/forward without loss |
| Question panel | 10–15 primary questions with conditional follow-ups | Progressive disclosure; backend schema should drive options where practical |
| Score summary | Green/Amber/Red or 0–100 with explanation and timestamp | Score is output; user cannot edit. Show why the score changed |
| Blockers | Missing IEC/GST/AD code/certification/sample/QC etc. | Each blocker becomes a task with owner and next action |
| Enablement plan | Checklist of required vs. recommended tasks | Mark dependencies; completed task updates readiness state |

**Actions & behavior**

| Action | Who | Behavior / side effects | Failure handling |
|---|---|---|---|
| Save & continue | Exporter | Persist answer snapshot/draft and move to next step | Stay on step; highlight invalid/missing fields |
| Submit assessment | Exporter | Lock answer version; create/run assessment job | If job fails, preserve answers and allow retry |
| Open enablement task | Exporter | Deep-link to field/upload/help module | No state change until task completed |

**Fields & controls**

| Field / control | Type | Required? | Validation / display rule |
|---|---|---|---|
| Product description | textarea | Yes | Min useful content; no jargon required |
| HS code | search / AI suggestion | Conditional | Store `suggested_by` + `confirmed_by` |
| Monthly capacity | number + unit | Yes | Positive; explicit unit |
| Certifications | multi-select/files | Conditional | Status: have / in progress / unknown |
| Target price | money | No | Currency required when entered |
| MOQ | number + unit | No | Positive |
| IEC/GST/AD code | structured status | Conditional | Never infer "verified" merely from a non-empty string |

**Required UI states**

| State | UI behavior |
|---|---|
| Draft | Answers editable |
| Assessing | Show job progress, not duplicate submit |
| Ready | Summary + optional recommended improvements |
| Amber | Continue discovery where policy allows, but highlight blockers |
| Red/Blocked | Explain blocking reasons and required tasks |

**Acceptance criteria**

- **AC01** User can leave and resume without re-entering completed answers.
- **AC02** Conditional questions never erase previously captured data without confirmation.
- **AC03** Assessment output creates/updates concrete enablement tasks with owner/status.
- **AC04** Verification state is separate from field presence for regulatory identifiers.
- **AC05** Re-running readiness preserves prior assessment history for audit/comparison.

---

## EXP-03 Enablement Center

`/app/readiness/tasks` · Exporter · **P1** · Full mobile

Provide one actionable checklist for becoming export-ready, including requirements ClearTrade can
guide, evidence the exporter must upload, and items owned by agent/ops.

**Page anatomy**

| Zone / module | Required content | Interaction rule |
|---|---|---|
| Task groups | Required before outreach, required before shipment, recommended | Dependency-aware ordering |
| Task row | Title, status, owner, due date, why it matters, CTA | Exporter only sees internal owner detail when useful |
| Evidence panel | Uploads, verification notes, rejection reason | Latest evidence visible with status |
| Help | Plain-language guidance and agent message link | Do not imply ClearTrade performs regulated filing when it only assists |

**Actions & behavior**

| Action | Who | Behavior / side effects | Failure handling |
|---|---|---|---|
| Upload evidence | Exporter | Attach file to task; task moves to `waiting_review` if applicable | Upload/scan errors inline |
| Mark self-complete | Exporter | Allowed only for self-attested tasks | Server rejects protected tasks |
| Ask agent | Exporter | Starts scoped message | Message failure retains draft |

**Required UI states**

| State | UI behavior |
|---|---|
| No blockers | Show readiness achieved + recommended improvements |
| Waiting review | Task locked from duplicate submission where appropriate |
| Rejected evidence | Show reason + re-upload CTA |

**Acceptance criteria**

- **AC01** Required/recommended distinction is visible.
- **AC02** Each task has one accountable owner and state.
- **AC03** Evidence review outcome is auditable and linked to the task.
- **AC04** Completion updates the readiness summary without manual refresh where practical.

---

## EXP-04 Demand Discovery — Runs & Ranked Markets

`/app/markets` · Exporter · **P0** · Full mobile

Turn the existing Demand Discovery engine into a guided market-selection workflow with explicit
inputs, ranked outputs, freshness, and a next action to select/save a market.

**Page anatomy**

| Zone / module | Required content | Interaction rule |
|---|---|---|
| Input bar | Product, HS code, optional capacity/price context, target constraints | Prefill from Product; user may adjust the scenario without overwriting the product master unless explicitly saved |
| Run status | queued/processing/completed/partial/failed + `generated_at` | Long-running jobs are asynchronous and resumable |
| Ranked market cards/table | Country, overall score, demand/growth/competition, India share, price band, key requirement/risk | Top 3 emphasized, but all returned results accessible |
| Comparison drawer | Select up to 3 markets for side-by-side criteria | Does not create deal state |
| Saved/selected state | "Saved for later" vs. "Selected as active target" | Selecting a market writes an explicit choice and reason/source |

**Actions & behavior**

| Action | Who | Behavior / side effects | Failure handling |
|---|---|---|---|
| Run discovery | Exporter | Create run with input snapshot; navigate to run result | Prevent duplicate submits; retry failed run |
| Open market | Exporter | Open market detail | Unavailable data fields show N/A with explanation |
| Save market | Exporter | Bookmark MarketAssessment | Idempotent |
| Select target market | Authorized exporter | Set target for buyer discovery; create audit event | Confirm if replacing the current active target |

**Fields & controls**

| Field / control | Type | Required? | Validation / display rule |
|---|---|---|---|
| Product | select | Yes | Must belong to the exporter org |
| HS code | text/search | Yes | Use confirmed or scenario value; display provenance |
| Target constraints | filters | No | Region/country exclusions, certification limits, etc., only if engine supports |
| Comparison selection | multi-select | No | Max 3 recommended for a usable UI |

**Required UI states**

| State | UI behavior |
|---|---|
| No run yet | Explain value + Run Discovery CTA |
| Processing | Show progress/status and permit navigation away |
| Partial | Render available markets and explain missing criteria |
| Failed | Show retry + support reference/correlation ID if available |
| Stale | If result age exceeds product policy, label and offer a rerun |

**Acceptance criteria**

- **AC01** Discovery request persists an immutable input snapshot.
- **AC02** Result UI never fabricates a value missing from engine output.
- **AC03** Scores include clear labels and freshness/source metadata where available.
- **AC04** User can move from a selected market directly to Buyer Discovery with context prefilled.
- **AC05** A failed run does not lose prior successful runs.

> **Implementation note (source):** don't bind the frontend to an assumed AI provider or algorithm.
> The UI contract is a `DiscoveryRun` resource plus ranked `MarketAssessment` records.

---

## EXP-05 Market Detail

`/app/markets/:marketAssessmentId` · Exporter · **P0** · Full mobile

Explain why a country ranks as it does and help the exporter decide whether to proceed, without
overwhelming them with raw trade data.

**Page anatomy**

| Zone / module | Required content | Interaction rule |
|---|---|---|
| Decision header | Country, rank, score, `generated_at`, Save/Select CTA | Selected-market state explicit |
| Score breakdown | Demand, growth, competition, India share, logistics, price/behavior criteria if available | Use charts only when data quality supports them |
| Requirements | Tariffs, certifications, labeling/packaging, documentation considerations | Show source/date and confidence/caveat where provided |
| Commercial signal | Price band, buyer profile, MOQ/behavior notes if the engine returns them | Currency/unit explicit |
| Logistics summary | Likely route/port mode/cost-time signal if available | Mark estimates clearly |
| Next step | Find buyers in this market | Prefills Buyer Discovery |

**Actions & behavior**

| Action | Who | Behavior / side effects | Failure handling |
|---|---|---|---|
| Select market | Exporter | Set as active target; audit choice | Confirm replacement if needed |
| Find buyers | Exporter | Open Buyer Discovery prefilled with product + country | If product context missing, request product selection |

**Required UI states**

| State | UI behavior |
|---|---|
| Data gap | Individual section states "Data unavailable"; rest of page remains usable |
| Risk/requirement | Callout when certification/tariff materially affects viability |

**Acceptance criteria**

- **AC01** Each numeric criterion includes unit/meaning and avoids unlabeled scores.
- **AC02** Unavailable sections degrade independently.
- **AC03** "Find Buyers" always passes a valid product/country context.
- **AC04** Selected state persists across sessions.

---

## EXP-06 Buyer Discovery — Search & Shortlist

`/app/buyers` · Exporter · **P0** · Full mobile

Expose the existing Buyer Discovery engine as a searchable, evidence-aware importer list and
convert promising buyers into tracked `BuyerLead` records.

**Page anatomy**

| Zone / module | Required content | Interaction rule |
|---|---|---|
| Context header | Product + selected market/country + discovery run/freshness | Warn if no market context; permit other countries if product policy allows |
| Filters | Country, buyer type, verification, import recency/activity, relevance/risk as available | Filters map to backend-supported fields only |
| Buyer results | Name, location, type, relevance, verification, activity summary, risk flag, shortlist state | Server pagination; no endless client-only dataset |
| Shortlist tray | Saved buyers and batch "Send to agent / create leads" action | Creating leads is idempotent per exporter/product/buyer context |
| Evidence indicator | Source count/freshness and verification status | Do not present unverified contact details as guaranteed accurate |

**Actions & behavior**

| Action | Who | Behavior / side effects | Failure handling |
|---|---|---|---|
| Open buyer | Exporter | Buyer detail | N/A data safe |
| Shortlist | Exporter | Save relation | Idempotent toggle |
| Create lead / ask agent to pursue | Exporter | Create `BuyerLead` and notify/queue assigned agent | If no agent assigned, route to assignment queue or explain pending assignment |
| Remove shortlist | Exporter | Remove bookmark only; does not delete lead/deal | Confirm when a lead already exists |

**Fields & controls**

| Field / control | Type | Required? | Validation / display rule |
|---|---|---|---|
| Search | text | No | Company/country/keyword; server-side |
| Buyer type | multi-select | No | Only supported categories |
| Verification | select | No | unverified / partial / verified |
| Activity recency | range/select | No | Use returned date metadata |
| Risk | select | No | normal / flags when available |

**Required UI states**

| State | UI behavior |
|---|---|
| No results | Explain filters/context and reset options |
| No agent | Lead may be created but show pending assignment |
| Engine refresh running | Existing results remain viewable; refresh state separate |

**Acceptance criteria**

- **AC01** Shortlisting does not silently create a Deal.
- **AC02** Lead creation results in a visible `BuyerLead` pipeline record with owner/state.
- **AC03** Buyer evidence and verification are visible before an outreach decision.
- **AC04** Exporter cannot access internal agent contact notes or outreach-only fields.
- **AC05** Filters and pagination survive back navigation.

---

## EXP-07 Buyer Detail

`/app/buyers/:buyerId` · Exporter · **P0** · Full mobile

Provide a concise buyer profile, evidence, fit/risk, and current relationship state for this
exporter.

**Page anatomy**

| Zone / module | Required content | Interaction rule |
|---|---|---|
| Buyer summary | Name, country, type, website, verification | Global Buyer data plus exporter-specific lead state kept visually separated |
| Fit | Product relevance, activity summary, market context | Clearly label algorithmic relevance if applicable |
| Evidence | Sources, dates, verified contacts where policy allows | Source/freshness visible |
| Relationship | Not shortlisted / shortlisted / lead stage / linked deal | CTA changes according to state |
| Risk | Risk flags and caveats | Material flags cannot be collapsed by default |

**Actions & behavior**

| Action | Who | Behavior / side effects | Failure handling |
|---|---|---|---|
| Shortlist / Create lead | Exporter | Create relation/lead as appropriate | Idempotent |
| Open deal | Exporter | Go to Deal Workspace if converted | Permission checked |

**Required UI states**

| State | UI behavior |
|---|---|
| Unverified | Strong caveat; agent verification recommended before outreach |
| Existing lead | Show stage and next action instead of duplicate lead CTA |

**Acceptance criteria**

- **AC01** Buyer global facts and exporter-specific pipeline state are visually distinct.
- **AC02** Duplicate `BuyerLead` is prevented server-side.
- **AC03** Risk and verification cannot be hidden behind optional tabs.

---

## EXP-08 Deals List

`/app/deals` · Exporter · **P0** · Full mobile

List all commercial opportunities and executing shipments with stage, next action, risk, and
value.

**Page anatomy**

| Zone / module | Required content | Interaction rule |
|---|---|---|
| Filters | Stage, country, buyer, risk, date | URL-persist when practical |
| Deal rows/cards | Buyer, product, stage, value, next action, agent, risk, updated | Mobile becomes cards; same actions |
| Summary | Open value, negotiating count, executing count | Server aggregate |

**Actions & behavior**

| Action | Who | Behavior / side effects | Failure handling |
|---|---|---|---|
| Open deal | Exporter | Deal Workspace | Safe 403/404 |
| Clone repeat shipment | Authorized exporter | Create a new deal/shipment draft from an eligible closed/won deal | Confirm copied data and fields requiring revalidation |

**Required UI states**

| State | UI behavior |
|---|---|
| Empty | CTA back to Buyer Discovery / ask agent |
| Filtered empty | Reset filters |

**Acceptance criteria**

- **AC01** List differentiates negotiating vs. executing vs. closed deals.
- **AC02** Risk/blocked state visible without opening the row.
- **AC03** Repeat action never reuses old document approvals as current approvals.

---

## EXP-09 Deal Workspace — Overview

`/app/deals/:dealId` · Exporter · **P0** · Full mobile

Canonical exporter workspace for one deal. Summarizes commercial terms, current milestone, tasks,
risks, and links to all execution modules.

**Page anatomy**

| Zone / module | Required content | Interaction rule |
|---|---|---|
| Deal header | Buyer, product, country, stage, value, agent, risk | Sticky on desktop; compact on mobile |
| Progress rail | Buyer engaged → terms → deal locked → docs → shipment → payment | Derived from state machines |
| Commercial terms | Quantity, price, Incoterm, payment/delivery terms, accepted version | Read-only after lock except via the change workflow |
| Next actions | Exporter-owned + waiting-on-agent summary | No internal tasks |
| Risk/exception | Current risk with owner/remediation | Persistent while active |
| Workspace tabs | Overview, Messages, Commercial, Tasks, Documents, Shipment, Payment, Dispute/Support, Activity | Tabs use stable routes/subroutes |
| Activity preview | Latest material events | Full timeline in the Activity tab |

**Actions & behavior**

| Action | Who | Behavior / side effects | Failure handling |
|---|---|---|---|
| Approve/accept terms | Authorized exporter | Create acceptance record/version; may advance stage | Prevent if the version is stale; 409 refresh |
| Request change | Exporter | Create change request, reopen negotiation state as policy defines | Preserve the previous proposed version |
| Message agent | Exporter | Deal-scoped thread | Draft preserved |

**Required UI states**

| State | UI behavior |
|---|---|
| Negotiating | Commercial CTA prominent |
| Deal locked | Terms read-only; execution CTAs prominent |
| Blocked | Risk banner and blocker task shown on every tab |
| Closed | Read-only historical workspace; repeat-shipment CTA if eligible |

**Acceptance criteria**

- **AC01** All deal tabs render the same deal ID and role-scoped shared objects.
- **AC02** Term approval is version-specific and records approver/timestamp.
- **AC03** Locked terms cannot be silently edited; changes require an explicit revision flow.
- **AC04** Blocked risk remains visible across workspace tabs.
- **AC05** Activity timeline records material stage/approval/document/shipment/payment changes.

---

## EXP-10 Deal — Commercial Terms & Negotiation

`/app/deals/:dealId/commercial` · Exporter · **P0** · Full mobile

Let the exporter review the current proposal, understand changed terms, and approve or request
revisions with a complete version history.

**Page anatomy**

| Zone / module | Required content | Interaction rule |
|---|---|---|
| Current proposal | Quantity/unit, unit price, total, currency, Incoterm, payment terms, delivery date/terms, MOQ if applicable | Changed fields highlighted against the prior version |
| Version history | v1/v2…, `proposed_by`, timestamp, state | Older versions read-only |
| Agent note | Exporter-visible rationale/summary | Internal note excluded |
| Approval panel | Approve / request changes; authorized approver | Show legal/commercial acknowledgement text if required |

**Actions & behavior**

| Action | Who | Behavior / side effects | Failure handling |
|---|---|---|---|
| Approve proposal | Authorized exporter | Mark the exact version accepted; advance state if all parties/conditions satisfied | Reject stale version using optimistic concurrency/version ID |
| Request changes | Exporter | Capture structured fields + comment; create agent task | Remain on the current version; no destructive overwrite |

**Fields & controls**

| Field / control | Type | Required? | Validation / display rule |
|---|---|---|---|
| Quantity | number + unit | Yes | Positive |
| Unit price | money | Yes | Currency explicit |
| Incoterm | select | Yes | Supported list + location qualifier if needed |
| Payment terms | structured/text | Yes | Must be explicit before lock |
| Delivery target | date/text | Conditional | Timezone not relevant for date-only; locale-safe |
| Change request | textarea | On request | Explain the desired change |

**Required UI states**

| State | UI behavior |
|---|---|
| Awaiting exporter | Approve/request CTA enabled |
| Revision requested | Show waiting on agent/buyer |
| Accepted | Read-only accepted version |
| Superseded | Historical only |

**Acceptance criteria**

- **AC01** Approval references an immutable proposal version ID.
- **AC02** Changed terms are visually identifiable.
- **AC03** Only users with approval permission can approve.
- **AC04** Requesting a revision generates an agent-visible task/notification.

---

## EXP-11 Deal — Tasks

`/app/deals/:dealId/tasks` · Exporter · **P0** · Full mobile

Show exactly what the exporter must do and what is waiting on ClearTrade, without leaking internal
operating tasks.

**Page anatomy**

| Zone / module | Required content | Interaction rule |
|---|---|---|
| My actions | Exporter-owned actionable tasks | Default first |
| Waiting on ClearTrade | High-level tasks/status only | Internal subtasks hidden |
| Completed | Collapsible history | Timestamp/owner visible |
| Blocked dependency | Reason and dependency link | Cannot mark done until the dependency is resolved, if server-enforced |

**Actions & behavior**

| Action | Who | Behavior / side effects | Failure handling |
|---|---|---|---|
| Complete task | Exporter | Task-specific form/action, then server transition | Validation mapped to the task |
| Upload evidence | Exporter | Attach evidence and move to review if needed | Retry |
| Ask question | Exporter | Scoped message | No task auto-close |

**Required UI states**

| State | UI behavior |
|---|---|
| Due soon/overdue | Human-readable urgency, no agent SLA jargon unless useful |
| Waiting review | Read-only, pending reviewer |

**Acceptance criteria**

- **AC01** Internal-only tasks never appear.
- **AC02** Completing a task requires a successful domain action where the task represents one.
- **AC03** Due date and owner are displayed for every active exporter task.

---

## EXP-12 Document Center — Deal Documents

`/app/deals/:dealId/documents` · Exporter · **P0** · Full mobile

Provide one list of all required/generated/uploaded documents with generation, review, approval,
and filing states represented **separately**.

**Page anatomy**

| Zone / module | Required content | Interaction rule |
|---|---|---|
| Document checklist | PI, Commercial Invoice, Packing List, Shipping Bill draft, COO draft, Declaration/Undertaking, Insurance Declaration, plus configured docs | Required set returned by backend based on deal/stage |
| Status columns | Generation, agent review, exporter approval, filing | Distinct chips; never one ambiguous status |
| Version | Current version + prior versions | Open detail to compare/history |
| Action | Generate/review/approve/download/upload depending on state/permission | One primary CTA per row |
| Exception | Missing input / rejected / changes-requested reason | Visible inline |

**Actions & behavior**

| Action | Who | Behavior / side effects | Failure handling |
|---|---|---|---|
| Generate | Exporter/Agent based on policy | Create async generation job from deal snapshot | Show failed state and missing-input errors |
| Approve | Authorized exporter | Approve the exact version | Stale version/permission failure handled |
| Request changes | Exporter | Comment + task for agent/document owner | Retain version |
| Download | Exporter | Secure signed URL | If expired, request a new URL transparently |
| Upload replacement/supporting file | Exporter | New version/source upload | Validate file and preserve the old version |

**Required UI states**

| State | UI behavior |
|---|---|
| Not required | Hide by default or mark N/A if useful |
| Missing inputs | CTA opens missing fields |
| Generating | Progress; prevent duplicate |
| Generated–awaiting review | Exporter may be restricted until agent review policy allows |
| Approved | Immutable approval record |
| Filed/accepted | Show reference and `filed_by`/date |
| Rejected | Show external/internal-safe rejection reason + remediation |

**Acceptance criteria**

- **AC01** All seven current ClearTrade generated document types are supported via a configurable document-type registry.
- **AC02** Generation state is separate from approval and filing state.
- **AC03** Approvals are per-version and auditable.
- **AC04** Filed/accepted versions cannot be overwritten by uploading a replacement.
- **AC05** Missing-input error deep-links to the exact data requirement where possible.

---

## EXP-13 Document Detail / Review

`/app/deals/:dealId/documents/:documentId` · Exporter · **P0** · Mobile review supported

Allow secure preview, version review, approval, or change request for one document.

**Page anatomy**

| Zone / module | Required content | Interaction rule |
|---|---|---|
| Header | Doc type, version, statuses, generated/reviewed metadata | Clear provenance |
| Preview | PDF/image preview or structured rendered preview | Fallback to secure download |
| Data summary | Key extracted/generated fields used | Optional but useful for high-risk docs |
| Approval panel | Approve / request changes / download | Sticky on desktop; bottom action on mobile |
| Version history | Prior versions and status | Read-only history |

**Actions & behavior**

| Action | Who | Behavior / side effects | Failure handling |
|---|---|---|---|
| Approve version | Authorized exporter | Write approval with version/checksum | 409 on stale current version |
| Request changes | Exporter | Comment; create document revision task | Keep current preview |
| Download | Exporter | Secure URL | Refresh expired URL |

**Required UI states**

| State | UI behavior |
|---|---|
| Preview unavailable | Offer download + retry; approval may be blocked by policy |
| Superseded | Prominent historical badge; disable approve |
| Filed | Read-only, show filing reference |

**Acceptance criteria**

- **AC01** User cannot approve a superseded version.
- **AC02** Preview access is authorization-protected.
- **AC03** Approval identity/time/version are visible after approval.
- **AC04** Request-change reason appears to the agent/document owner.

---

## EXP-14 Shipment & CHA Tracking

`/app/deals/:dealId/shipment` · Exporter · **P0** · Full mobile

Summarize logistics/customs execution without forcing the exporter to understand internal CHA
coordination details.

**Page anatomy**

| Zone / module | Required content | Interaction rule |
|---|---|---|
| Shipment header | Mode, origin, destination, Incoterm, booking/ref, CHA name where appropriate | External refs copyable |
| Milestone timeline | Planning, booking, pickup, customs, loaded, in transit, arrived, delivered | ETA vs. actual |
| Exporter actions | Confirm pickup, upload packing/evidence, answer customs query | Tasks drive actions |
| Documents/refs | Shipping bill no., BL/AWB where available, customs refs | Secure links |
| Exception | Customs rejection, delay, missing doc, inspection, etc. | Visible owner + next step |

**Actions & behavior**

| Action | Who | Behavior / side effects | Failure handling |
|---|---|---|---|
| Confirm pickup details | Exporter | Persist pickup window/contact/address | Validate address/date |
| Upload requested evidence | Exporter | Attach to shipment/task | Scan/validation |
| Raise issue | Exporter | Open dispute/support case scoped to shipment | No duplicate critical issue if an open case exists; link the existing one |

**Required UI states**

| State | UI behavior |
|---|---|
| Not created | Show execution will appear after deal lock |
| Planning | ETA may be tentative |
| In transit | Timeline focus |
| Exception | Risk banner + case/task |
| Delivered | Delivery proof and payment next step |

**Acceptance criteria**

- **AC01** Shipment status comes from Shipment state, not inferred from chat.
- **AC02** External milestone timestamps differentiate ETA and actual.
- **AC03** Exporter cannot edit CHA filing reference fields directly unless explicitly allowed.
- **AC04** Exceptions create/associate a managed task or dispute.

---

## EXP-15 Payment, Banking Visibility & Insurance

`/app/deals/:dealId/payment` · Exporter · **P1** · Full mobile

Track expected payment, due/received/realized milestones, proof/BRC status, and optional
insurance — **without presenting ClearTrade as a bank**.

**Page anatomy**

| Zone / module | Required content | Interaction rule |
|---|---|---|
| Payment summary | Amount/currency, method, due date, received/realized status | Source of status visible where useful |
| Milestones | Invoice/advance/LC/received/realized/BRC as applicable | Only show relevant milestones |
| Evidence | Upload/select bank/payment proof | Authorization protected |
| Insurance | No policy / quote requested / quoted / active / claim | Separate case state |
| Overdue action | Contact agent/open payment dispute | Prominent when overdue |

**Actions & behavior**

| Action | Who | Behavior / side effects | Failure handling |
|---|---|---|---|
| Update payment status | Exporter, where policy allows | Submit exporter-reported update/evidence | Mark source as `exporter_update`, pending verification if applicable |
| Upload evidence | Exporter | Attach proof | Validation |
| Request insurance quote | Exporter | Create `InsuranceCase`/task | Handle partner unavailable |
| Open payment dispute | Exporter | Create dispute | Link existing open case if duplicate |

**Required UI states**

| State | UI behavior |
|---|---|
| Not due | No alarming treatment |
| Due soon | Reminder |
| Overdue | Risk state + remediation |
| Partially received | Show received vs. outstanding |
| Realized | BRC next, if applicable |

**Acceptance criteria**

- **AC01** UI never claims ClearTrade itself holds/settles funds unless that product later exists.
- **AC02** Payment source/provenance is preserved.
- **AC03** Partial receipt is supported.
- **AC04** BRC status is independent from payment received/realized status.

---

## EXP-16 Messages, Support & Disputes

`/app/deals/:dealId/support` · Exporter · **P1** · Full mobile

Give exporters a clear communication path while elevating operational problems into structured
disputes rather than leaving them buried in chat.

**Page anatomy**

| Zone / module | Required content | Interaction rule |
|---|---|---|
| Conversation | Exporter-visible messages with agent/ops | Deal-scoped; attachments allowed per policy |
| Open cases | Dispute type, severity, status, owner, SLA-facing expectation, last update | Internal severity/SLA details simplified as needed |
| Create case | Payment/quality/logistics/document/LC/inspection/other | Prefill deal/shipment context |
| Resolution | Proposed/final resolution and exporter acceptance if needed | Immutable history |

**Actions & behavior**

| Action | Who | Behavior / side effects | Failure handling |
|---|---|---|---|
| Send message | Exporter | Create message + notify recipient based on rules | Draft preserved |
| Open dispute | Exporter | Create structured Dispute + owner task | Prevent obvious duplicates / link existing |
| Accept resolution | Authorized exporter | Mark resolution accepted and close, as policy | Require confirmation |

**Required UI states**

| State | UI behavior |
|---|---|
| No open cases | Message/support only |
| Critical case | Banner on Deal Workspace |
| Waiting external | Explain next expected update |

**Acceptance criteria**

- **AC01** Chat and dispute records are separate object types.

---

## EXP-17 Notifications & Account

`/app/notifications` · Exporter · **P1** · Full mobile

Surface actionable notifications, account settings, and organization members without creating
notification noise.

**Page anatomy**

| Zone / module | Required content | Interaction rule |
|---|---|---|
| Notification list | Unread/read, severity, title, timestamp, deep link | Group duplicate events; paginate |
| Preferences | Email/in-app/push if supported, categories | Critical legal/security notifications may be non-disableable |
| Organization profile | Business details, products, contacts | Permission-controlled |
| Team | Members, roles, invite/remove where supported | Owner-only critical actions |

**Actions & behavior**

| Action | Who | Behavior / side effects | Failure handling |
|---|---|---|---|
| Open notification | Exporter | Mark read + deep link | If object unavailable, safe fallback |
| Change preference | Exporter | Persist per channel/category | Show saved state |
| Invite member | Exporter owner | Send invite with scoped org role | Prevent duplicate active invite |

**Required UI states**

| State | UI behavior |
|---|---|
| Empty notifications | No alerts; do not show fake content |
| Invite pending | Visible status + resend/revoke |

**Acceptance criteria**

- **AC01** Notifications deep-link to actionable context.
- **AC02** Read status syncs across sessions.
- **AC03** Org member role is enforced server-side.
