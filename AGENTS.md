# AGENTS.md — ClearTrade AI

This file is auto-loaded as context by OpenCode (and compatible agents) on every session in this
repo. Keep it accurate as the codebase evolves — treat it as living memory, not a one-time export.

**Sources.** This repo distills two documents, both v1.0, 05 Aug 2026:

1. `ClearTrade_AI_PRD_Technical_UI_Specification.pdf` (106 pp) — behavior, data, states, permissions.
2. `ClearTrade_AI_UI_Blueprint.pdf` (30 pp) — visual language, layout, component naming, microcopy.

Nothing in `docs/` was invented beyond those two documents. Where they left something open it's
flagged as an **open decision** (`docs/11`); where they *disagree*, the conflict is catalogued with a
recommended resolution (`docs/13`) rather than silently resolved.

**Precedence:** the PRD wins on behavior, data, states and permissions. The Blueprint wins on visual
language, layout and copy. The PRD states this itself: *if a visual treatment conflicts with a
workflow rule, preserve the workflow rule and update the visual treatment.*

## What ClearTrade AI is

An AI + human-agent **export operating system** for Indian manufacturers, especially first-time
exporters. It turns a complex export process into a guided workflow across three portals that all
render the **same underlying records**:

| Portal | Who | Root route | Job to be done |
|---|---|---|---|
| **Exporter Portal** | Exporter owner / member | `/app/*` | Become export-ready → pick a market → find a buyer → close a deal → ship → get paid |
| **Agent Portal** | ClearTrade human operator | `/agent/*` | Own assigned exporters: outreach, negotiation, execution coordination |
| **Ops/Admin Console** | Ops supervisor / Ops finance / Admin | `/ops/*` | Assignment, exceptions, compliance oversight, finance, audit, config |

32 screens total (17 exporter, 8 agent, 7 ops); 21 are P0. Full registry: `docs/12`.

## The one rule that matters most

> **Do not create separate copies of the same business object for Exporter, Agent and Ops views.**
> All three portals must render the same canonical `Deal`, `Task`, `Document`, `Shipment`,
> `Payment`, `Dispute` and `Audit` records, with role-specific permissions and presentation layered
> on top — never role-specific data forks.

A screen that looks right but doesn't create/update the canonical object, notify the next owner,
preserve history, enforce permissions server-side, handle failure states, and show up correctly in
the *other* relevant portal is **not done**. This is the spec's own definition of done and should
govern every PR.

## Cross-cutting rules (apply to every feature, every screen)

- **Authorization is server-side, always.** Hiding a button is not access control. Exporters are
  tenant-scoped by `exporter_org_id` and can never reach another org by editing a route param.
  Agents only see exporters/deals assigned to them. Applies to search endpoints and file downloads
  too — the two most commonly missed.
- **Nothing business-critical is hardcoded on the frontend.** Fees, agent share, SLA thresholds,
  minimum shipment value, document type registry — all backend config, versioned, rendered from
  the API.
- **Historical records are snapshots, not live recalculations.** A deal's quoted fee, an approved
  document version, a payout basis — once created, later config changes must never silently rewrite
  them. At deal lock, freeze a **Deal Snapshot**; all documents generate from it.
- **Generation / review / approval / filing are four independent states**, never collapsed into one
  status chip. Same for Task state vs. SLA state, and Journey stage vs. Risk state. See `docs/03`.
- **Internal notes and exporter-visible content are structurally separate**, not a visibility flag
  that defaults open. Leakage of internal negotiation notes is called out as a top trust risk.
- **Every material mutation writes an AuditEvent** (actor, role, object, before/after, timestamp,
  correlation_id). Audit is append-only — corrections create new events, never edits.
- **Long-running work (AI discovery, document generation) is an async job**, not a held HTTP
  request. Job state must survive refresh and login on another device.
- **Optimistic concurrency everywhere versions matter.** Stale writes return `409 VERSION_CONFLICT`,
  never a silent overwrite.
- **AI output always carries visible provenance and review state.** Never present a generated
  artifact as already approved.
- **Color is never the only status cue**, and status copy names the owner: "Waiting for exporter
  approval," not "Pending."

## Doc map — read what's relevant to the task, not everything

| File | Read this when you're working on... |
|---|---|
| `docs/00-design-system.md` | Any UI work — color tokens (exact hex), typography, layout shell, component library, microcopy rules |
| `docs/01-product-contract-and-roles.md` | Product scope, MVP boundary, configurable business rules, RBAC, permission matrix |
| `docs/02-domain-model.md` | Any entity/schema/API payload — canonical fields, types, relationships |
| `docs/03-global-ux-contract.md` | Shared shell, nav, status semantics, forms, tables, uploads, loading/error states — **read before building any screen** |
| `docs/04-screens-exporter-portal.md` | Any `/app/*` screen (EXP-01 … EXP-17) |
| `docs/05-screens-agent-portal.md` | Any `/agent/*` screen (AGT-01 … AGT-08) |
| `docs/06-screens-ops-console.md` | Any `/ops/*` screen (OPS-01 … OPS-07) |
| `docs/07-workflow-state-machines.md` | Backend transitions: BuyerLead, Deal, Document, Shipment, Payment, Task, Dispute |
| `docs/08-notifications-audit-analytics.md` | Notifications, audit logging, analytics instrumentation |
| `docs/09-api-platform-contract.md` | API design, response envelopes, background jobs, error codes |
| `docs/10-non-functional-requirements.md` | Security, performance, responsive/mobile, accessibility, i18n |
| `docs/11-build-plan-qa-release.md` | Build sequencing, tickets, test matrices, UAT/release gates, **12 open product decisions** |
| `docs/12-appendix-reference.md` | Screen registry, route conventions, glossary (CHA, BRC, ICEGATE, Incoterm, HS code…) |
| `docs/13-blueprint-reconciliation.md` | **Read before Phase 0.** Where the two sources conflict, what's missing from each, and 10 decisions this raises |

## Build order (don't build portal-by-portal)

Build **vertical slices through shared objects**. A `BuyerLead` should be creatable in the exporter
UI, immediately visible in the agent CRM, generate the right tasks/notifications, and be inspectable
by Ops — before moving to the next feature. This catches data-model and permission bugs early.

| Phase | Focus |
|---|---|
| 0 — Foundations | Auth/role routing, design tokens/components, API client + error handling, entity types, file service, task/status primitives, audit hooks |
| 1 — Exporter spine | Dashboard, Readiness, Demand Discovery, Buyer Discovery, Deals List, Deal Workspace shell |
| 2 — Conversion | Agent My Day, Exporter 360, Outreach CRM, Lead Workspace, proposal versioning/approval, deal lock |
| 3 — Execution | Document Center/detail, task system, Agent Execution Workspace, Shipment/CHA, exporter tracking |
| 4 — Money/exceptions | Payment, insurance, disputes, Ops Control Tower, assignments, exceptions, finance/payout |
| 5 — Hardening | Notifications, analytics, audit UI, responsive polish, a11y, performance, security testing, UAT |

Prototype six critical screens first (Exporter Dashboard, Readiness, Demand Discovery, Buyer
Discovery, Agent Command Center, Deal Workspace) before engineering all 32.

## Decide these in Phase 0

From `docs/13`, these block or shape foundational work:

- **Component naming** — Blueprint set (`StatusBadge`) or PRD set (`StatusChip`)? Record the choice
  in the Tech stack section below once made.
- **`/app/tasks`** — the specified mobile bottom nav requires a cross-deal exporter task list that
  the screen registry doesn't define. Recommended P0.
- **Buyer fit score placement** — it's a function of buyer × product × market, so it does not belong
  on the global `Buyer` entity.
- **Deal tab label** — "Quote" or "Commercial" (route is `/commercial` either way).

## What's still not decided

- **Tech stack.** Both sources are deliberately stack-neutral. Once chosen (frontend framework,
  backend language, DB, job queue, file storage, auth provider), add a `## Tech stack` section here
  with the actual conventions so future sessions inherit them.
- **12 product decisions** — auth channel, whether non-owner exporter members can approve terms, CHA
  assignment model, etc. See `docs/11` §7. Not blockers: build the state/permission hooks behind
  config flags, lock the decision before enabling the production action.
- **10 reconciliation decisions** — see `docs/13` §F.

## Non-negotiables worth repeating

- Never present ClearTrade as a bank or settlement party — payment views are milestone/visibility
  surfaces only, and every milestone shows its source (`exporter_update` / `AA` / `bank_partner` /
  `manual_ops`).
- Never imply ClearTrade files directly with ICEGATE/CHA where it isn't the filing party.
- Use progressive disclosure — plain language first, customs jargon in helper text.
- P0 screens need loading, empty, error, permission (403/404) and mobile states before they're done.
