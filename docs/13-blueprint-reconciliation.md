# 13 — Blueprint ↔ PRD Reconciliation

The two source documents were written to complement each other, and they agree on architecture,
principles and phasing. But they **do not agree on every detail** — and several things appear in
one document and not the other.

This file catalogues those differences so nobody discovers them mid-sprint.

### Precedence rule

> The PRD states it directly: *"If a visual treatment conflicts with a workflow rule here, preserve
> the workflow rule and update the visual treatment."*

So: **PRD wins on behavior, data, states and permissions. Blueprint wins on visual language,
layout, component naming and microcopy.** Where the Blueprint proposes a *route* or an *enum*, the
PRD's version is authoritative — the Blueprint labels its routes "suggested examples," while the
PRD's screen registry is the implementation contract.

---

## A. Conflicts requiring a decision

### A1. Top-level Documents / Shipments / Payments / Tasks navigation

| Source | Says |
|---|---|
| Blueprint nav + PRD §4.1 shell | Exporter left nav includes **Documents, Shipment, Payments, Support** as top-level items |
| PRD screen registry | **No** `/app/documents`, `/app/shipments`, `/app/payments` routes exist — these are only nested under `/app/deals/:dealId/…` |
| Blueprint suggested routes | Lists `/app/documents` and `/app/tasks` |
| Blueprint mobile bottom nav | Home · Deals · **Tasks** · Messages · More |

**This is a real gap, not a wording difference.** The PRD's own shell section lists nav items its
registry never defines. And the Blueprint's mobile bottom nav requires a cross-deal task list that
doesn't exist in the registry (`/app/readiness/tasks` is enablement-only).

**Recommended resolution** — the Blueprint already supplies the principle:

> *"These capabilities can have top-level discovery views, but the actual execution should converge
> inside Deal Workspace."*

Build top-level routes as **cross-deal index views** that filter and deep-link into the canonical
deal-scoped screens. They are views, not new objects:

| New route | Renders | Deep-links to |
|---|---|---|
| `/app/documents` | All documents across the org's deals, filtered by status | `/app/deals/:dealId/documents/:documentId` |
| `/app/shipments` | All active shipments with milestone/exception state | `/app/deals/:dealId/shipment` |
| `/app/payments` | All payment records with due/overdue state | `/app/deals/:dealId/payment` |
| `/app/tasks` | **All** exporter-owned tasks across deals + enablement | Task's own action target |

`/app/tasks` is the highest priority of the four — mobile navigation depends on it, and "what do I
need to do next?" is the product's core success condition. Treat it as **P0**, not P1.

**Update — no longer just a recommendation, now a confirmed blocker.** The exporter mobile bottom
nav was verified end to end against a real browser (`scripts/browser-verify.ts` scenario 15): it
renders the Blueprint's specified `Home · Deals · Tasks · Messages · More`, but three of those five
links — `/app/deals`, `/app/tasks`, `/app/messages` — 404, because none of the four cross-deal index
views exist yet. Per instruction, the mobile nav is being shipped with those items live and pointing
at unbuilt routes rather than hidden, so this is a **known, currently-live gap in production**, not
a hypothetical one. `/app/tasks` specifically blocks AGENTS.md's own "P0 screens need loading, empty,
error and mobile states before they're done" bar for the exporter mobile shell — the shell cannot
be called done while its own primary nav 404s.

**Backend impact:** each needs an org-scoped, server-paginated list endpoint with cross-deal
filtering — not a client-side aggregation over N deal fetches.

---

### A2. BuyerLead stage vocabulary

| Source | Stages |
|---|---|
| **PRD** (data contract) | `new` · `shortlisted` · `contacted` · `replied` · `interested` · `negotiation` · `disqualified` · `converted` |
| **Blueprint** (CRM columns) | New → Contacted → Replied → **Qualified** → Negotiation → **Won/Lost** |

Three differences: the Blueprint omits `shortlisted`, renames `interested` → "Qualified", and
collapses the terminal states into "Won/Lost".

**Resolution:** use the **PRD enum** as the stored value. The Blueprint's labels may be used as
display strings if preferred (`interested` → "Qualified"), but only via a display map — never as
stored values.

⚠️ **Do not adopt "Won/Lost" on the lead.** That conflates lead outcome with deal outcome. A lead
`converted` produces a Deal, and the Deal then has its own `closed_won`/`closed_lost`. Merging them
would break the one-lead-to-one-deal relationship the PRD requires (AGT-03-AC04).

---

### A3. Deal Workspace tab set

| Source | Tabs |
|---|---|
| **PRD** | Overview · Messages · **Commercial** · Tasks · Documents · Shipment · Payment · Dispute/Support · **Activity** |
| **Blueprint** | Overview · Messages · **Quote** · Tasks · Documents · Shipment · Payment · Dispute *(conditional)* |

**Resolution:** route is `/commercial` (PRD registry, and it matches `/agent/deals/:dealId/commercial`).
Pick one display label and use it in both portals — "Commercial" is more accurate once terms are
locked, since the tab outlives the quoting phase.

The PRD's **Activity** tab has no Blueprint equivalent but is required by EXP-09-AC05 (activity
timeline records material changes). Build it.

The Blueprint's rule that the **Dispute tab appears only when a dispute is opened** is a good
refinement the PRD doesn't state — adopt it. It supports the "don't clutter normal deals" principle.

---

### A4. Journey rail — 7 segments or 8 states?

| Source | Values |
|---|---|
| PRD §4.2 + Blueprint status system | **8:** Onboarding · Ready · Market selected · Buyer engaged · Deal locked · Docs cleared · Shipped · Payment realized |
| PRD EXP-01 + Blueprint wireframe | **7:** Readiness · Market · Buyers · Deal · Docs · Ship · Paid |

**Resolution:** 8 canonical states in the data model; 7 segments in the rail — `Onboarding` and
`Ready` are two states of the *same* first segment. Build one shared `JourneyProgress` component
driven by the 8-state enum, rendering 7 segments. Don't let two different rails emerge in the
exporter dashboard and the deal workspace.

---

### A5. Approval status — one layer or four?

The Blueprint's status table lists a single **"Approval state: AI generated → Agent reviewed →
Exporter approved → Filed."**

The PRD treats these as **four independent dimensions** (generation / review / approval / filing),
and makes it an acceptance criterion: *"Generation state is separate from approval and filing
state"* (EXP-12-AC02).

**Resolution: the PRD is correct and the Blueprint's version is a simplification.** A document can
be `generated` + `changes_requested` + `not_approved` + `draft` simultaneously. Modeling this as one
linear enum will require a painful migration later. Four fields, four chips.

The Blueprint doesn't actually disagree in spirit — its own Document Center table shows separate
per-document state flows, and its "critical pattern" callout demands version, missing-field
checklist, and audit trail. It's just a compressed summary in the status table.

---

### A6. Navigation item differences

| Portal | Blueprint | PRD | Resolution |
|---|---|---|---|
| Agent | My day, Exporters, Outreach, Deals, **Execution**, Escalations, Payouts, **Knowledge** | My Day, Exporters, Outreach, Deals, **Tasks**, Escalations, Payout | Use PRD. "Execution" is AGT-06 reached via a deal, not a nav root. **"Knowledge" has no PRD spec — see B4** |
| Ops | Control tower, Assignments, **Agents**, **CHAs**, Escalations, **Payouts**, Audit log, Settings | Control Tower, Assignments, Exceptions, Compliance/CHA, Finance, Disputes, Audit, Settings | Use PRD. Agents → OPS-02; CHAs → OPS-04 + config registry; Payouts → OPS-05 |
| Shared | `/messages`, `/notifications`, `/settings` | `/app/notifications` only | Decide: global vs. portal-prefixed. Portal-prefixed is more consistent with the role-scoped route convention |

---

## B. In the Blueprint, missing from the PRD (new scope)

These have **no screen spec, acceptance criteria, or data model** in the PRD. Each needs a decision:
build it (and write the spec), or explicitly defer.

### B1. Inspection / QC

Blueprint lists **"Inspection / QC — optional inspection booking, report, buyer acceptance"** as an
AGT-06 execution lane, and **"inspection option"** in exporter deal protection.

The PRD has **no `InspectionCase` entity** and no inspection lane — though `inspection` *is* a valid
`Dispute.type`, which implies inspections happen. **Gap.** If inspection is in scope, it likely
needs an entity parallel to `InsuranceCase` (quote → booked → report → accepted).

### B2. Agent annotation of AI output

Blueprint, on Demand Discovery: *"allow agent to annotate AI output — e.g. 'UAE looks strongest, but
buyer concentration is high; test Saudi in parallel.'"*

The PRD has no agent-note module on `MarketAssessment` in EXP-04, EXP-05 or AGT-02. **Gap** — and a
valuable one, since it's exactly the "AI + human agent" differentiation the product is built on.
Small to add: an exporter-visible note attached to a `MarketAssessment` or `DiscoveryRun`.

### B3. Exporter-facing "Deal protection" module

Blueprint: *"Payment term warnings, Incoterm summary, inspection option"* for the exporter, and
*"Risk checklist + recommended controls"* for the agent.

The PRD has the agent side (AGT-05 Risk zone) but no exporter-facing deal-protection summary.
**Gap** — optional enhancement, but it fits the "first-time exporter" audience well.

### B4. Agent Knowledge base

A **"Knowledge"** nav item appears in the Blueprint's agent portal with no further description and
no PRD equivalent. **Undefined scope** — needs a product decision before it's more than a nav stub.

### B5. Buyer fit score

The Blueprint's Buyer Discovery shows a **fit score** per buyer and a **"Min score: 70"** filter.
The PRD's `Buyer` field dictionary has no `fit_score` / `relevance_score` field, and EXP-06 lists
relevance only as *"as available."*

**Schema question:** fit is a function of *buyer × product × market*, so it does **not** belong on
the global `Buyer` entity — it belongs on the search-result projection or on `BuyerLead`. Decide
before building the filter, or the score will end up cached on the wrong object.

### B6. Readiness score de-emphasis

Blueprint: *"Readiness score: visible only until the exporter is sufficiently enabled; later it
becomes a smaller health indicator."* The PRD shows it persistently in the EXP-01 health summary.
Minor, adopt the Blueprint's progressive de-emphasis — it supports "status over activity."

---

## C. In the PRD, missing from the Blueprint

The Blueprint predates or omits visual treatment for several PRD requirements. These need design
work before implementation:

- **All error/edge states** — 403, 404, 409 conflict, 429, 5xx, partial data, maintenance
  (`docs/03-global-ux-contract.md` §7). The Blueprint shows only happy-path wireframes.
- **Async job states** — queued/processing/partial/failed UI for discovery and document generation.
- **Version-diff UI** — how changed commercial terms are highlighted against the prior version
  (EXP-10-AC02, AGT-05 version compare).
- **The `blockers[]` presentation** — how `PREREQUISITES_NOT_MET` renders as an actionable list with
  deep links.
- **Empty states** for each of the 32 screens (the Blueprint states the *rule*, not the designs).
- **Ops screens OPS-02 … OPS-07** — the Blueprint wireframes only the Control Tower.
- **Exporter audit visibility** — the Blueprint's permission matrix grants the exporter "own
  approvals" in the audit log; the PRD has no exporter-facing audit view. Probably satisfied by the
  EXP-09 Activity timeline + EXP-13 approval metadata, but confirm.

---

## D. Frontend implications

What the Blueprint changes about how the frontend gets built:

1. **Design tokens are now known.** Exact hex values, typography, radii and density rules are in
   `docs/00-design-system.md`. Phase 0 can produce a real token file rather than placeholders.
2. **Component library has two naming conventions.** The Blueprint names 19 components, the PRD
   names 12, and they overlap partially (`StatusBadge` vs `StatusChip`). **Pick one set of names in
   Phase 0 and record it in `AGENTS.md`** — otherwise the codebase will grow both.
3. **Three density modes, one system.** Exporter medium / Agent compact / Ops compact. Build density
   as a theme-level concern (spacing scale + table row height), not per-component variants.
4. **Layout skeleton is specified.** Navy top bar → light left nav (active = raised white card) →
   page title → journey rail → metric row → module grid. Build this as one shell component
   parameterized by role.
5. **Microcopy is a build requirement.** "Waiting for exporter approval," not "Pending." This means
   status strings must be **contextual functions**, not a flat enum→label map — the same
   `Task.state = waiting` renders differently depending on who's waiting on whom.
6. **Color can never be the only cue** (accessibility + PRD rule). Every status component takes a
   label and icon, not just a variant prop.
7. **Mobile bottom nav requires `/app/tasks`** — see A1. Frontend can't ship the specified mobile
   navigation without that route existing.
8. **Prototype six screens first** before building all 32.

---

## E. Backend implications

What the Blueprint adds or sharpens on the backend side:

1. **The Deal Snapshot is now explicit.** The Blueprint's deal-lock gate says: freeze buyer, SKU,
   quantity, price, Incoterm, payment terms, ship window and special conditions — and **all
   documents generate from this canonical snapshot**. This confirms `Document.generated_from_snapshot`
   should reference the *deal snapshot*, not re-read live deal fields. Document regeneration must be
   reproducible.
2. **Cross-deal index endpoints are needed** (A1) — org-scoped, server-paginated lists for documents,
   shipments, payments and tasks that span deals.
3. **Payment provenance is a first-class label**, not metadata. The Blueprint: *"show source labels
   like 'Exporter updated', 'Bank data', or 'Agent verified' next to each milestone."* The
   `Payment.source` enum must be returned and rendered on every milestone, not just stored.
4. **SLA defaults now have concrete starting values** (AGT-07 table: same business day, 24h, 2–4
   business hours, etc.). These seed the SLA config table — still configurable, never hardcoded.
5. **Auto-create follow-up tasks after outreach actions** (Blueprint CRM rule). This is a server-side
   side effect of logging an outreach activity, not a frontend convenience.
6. **Partner directory** needs a home — recommended as part of the OPS-07 config registry with
   `partner_status`, surfaced for assignment in OPS-04 (see `docs/06-screens-ops-console.md`).
7. **Agent metrics need defined windows and denominators** (AGT-08-AC03). The Blueprint's 9-metric
   catalog should be computed server-side with explicit time windows — not derived client-side from
   partial data.
8. **North-star metric to instrument:** "deals progressing without manual ops intervention." This
   requires tagging which state transitions were ops-initiated vs. self-service — worth designing
   into the `AuditEvent.source` field usage from Phase 0 rather than retrofitting.

---

## F. Open items summary

Decisions needed that come **from this reconciliation**, on top of the 12 product decisions already
listed in `docs/11-build-plan-qa-release.md`:

| # | Item | Type | Suggested owner |
|---|---|---|---|
| R1 | Build top-level `/app/documents`, `/app/shipments`, `/app/payments`, `/app/tasks` as cross-deal index views? **`/app/tasks` is no longer a P0 recommendation — the mobile bottom nav ships live today with a `Tasks` link that 404s (verified in browser); it now blocks calling the exporter mobile shell done.** | Scope | Product |
| R2 | Component naming: Blueprint set or PRD set? | Convention | Frontend lead |
| R3 | Deal tab label: "Quote" or "Commercial"? | Copy | Product/Design |
| R4 | Is Inspection/QC in MVP scope? If so, define the entity | Scope | Product |
| R5 | Add agent annotation on AI market results? | Scope | Product |
| R6 | Where does buyer fit score live — search projection or `BuyerLead`? | Schema | Backend lead |
| R7 | Is the agent "Knowledge" base in scope at all? | Scope | Product |
| R8 | Exporter-facing "deal protection" summary — build or defer? | Scope | Product |
| R9 | Shared routes (`/messages`, `/settings`) global or portal-prefixed? | Convention | Frontend lead |
| R10 | Does the exporter need an audit view beyond the Activity timeline? | Scope | Product |
