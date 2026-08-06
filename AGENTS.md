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

- **Component naming — RESOLVED.** PRD set (`StatusChip`, not the Blueprint's `StatusBadge`). Built
  in `src/components/ui/StatusChip.tsx` and used by every status-bearing component since.
- **`/app/tasks`** — still open. The specified mobile bottom nav requires a cross-deal exporter task
  list that the screen registry doesn't define. Recommended P0.
- **Buyer fit score placement** — still open. It's a function of buyer × product × market, so it does
  not belong on the global `Buyer` entity.
- **Deal tab label** — still open. "Quote" or "Commercial" (route is `/commercial` either way).

## What's still not decided

- **12 product decisions** — auth channel, whether non-owner exporter members can approve terms, CHA
  assignment model, etc. See `docs/11` §7. Not blockers: build the state/permission hooks behind
  config flags, lock the decision before enabling the production action.
- **10 reconciliation decisions** — see `docs/13` §F.

## Tech stack

What's actually built, not just planned — see the folder structure and authorization notes below
for where things live today vs. where docs/13 originally sketched them.

**Runtime & framework**
- Next.js (App Router, TypeScript) — server components by default, route handlers for API
- PostgreSQL — primary data store
- Prisma ORM — schema, migrations, typed client
- Tailwind CSS — styling via design tokens in `docs/00-design-system.md`
- Auth.js (NextAuth v5) — session auth, credentials provider, JWT strategy (`src/lib/auth.ts`)
- Background jobs — DB-backed job table (`Job`, `JobAttempt`); no external queue for MVP

**Folder structure (monorepo, single Next.js app)**

```
/src
  /app                          # Next.js App Router
    /(auth)                     # Auth group (login, register, callbacks)
    /app                        # Exporter portal (/app/*)
      /deals/[dealId]/...
      /documents/...            # Cross-deal index views (A1)
      /shipments/...
      /payments/...
      /tasks/...                # P0 cross-deal task list
      layout.tsx                # Exporter shell (navy top bar, left nav, journey rail)
    /agent                      # Agent portal (/agent/*)
      layout.tsx                # Agent shell (compact density)
    /ops                        # Ops console (/ops/*)
      layout.tsx                # Ops shell
    /api                        # Route handlers (REST-ish)
      /v1/...                   # Versioned API surface
      /auth/[...nextauth]/route.ts
    layout.tsx                  # Root layout (providers, global styles)
    globals.css                 # Tailwind + design tokens
  /components                   # Shared UI components
    /ui                         # Primitive components (Button, Input, Table, StatusChip, etc.)
    /portal                     # Portal-specific composed components
    /shell                      # Layout shell: TopBar, LeftNav, JourneyRail, PageHeader
    /forms                      # Form primitives with react-hook-form + Zod
    /data-display               # Tables, cards, badges, timelines, diff views
  /lib                          # Shared utilities
    /auth.ts                    # Auth.js config, role helpers, server session
    /prisma.ts                  # Prisma singleton
    /api-client.ts              # Typed fetch wrapper with error envelope handling (docs/09 §2)
    /errors.ts                  # ApiError + envelope builders — every route handler's error path
    /jobs.ts                    # Job queue helpers (enqueue, poll, retry)
    /permissions.ts             # Server-side authorization predicates — single source of truth (see below)
    /state-machines/            # Transition guards + side effects per docs/07 (buyer-lead.ts, deal.ts, task.ts)
    /config.ts                  # Runtime config (fees, SLA, doc registry) from DB
    /i18n.ts                    # Locale/currency/date helpers (docs/10 §5)
    /validators/                # Zod schemas mirroring Prisma models + API envelopes
  /hooks                        # Client-only React hooks (useJobPoll, useDebounce, etc.)
  /types                        # Shared TypeScript types (API envelopes, domain enums)
  /styles                       # Tailwind config extension, CSS variables for tokens
/prisma
  schema.prisma                 # Canonical domain model (docs/02)
  /migrations
/scripts                        # One-off migration/seed scripts
/public                         # Static assets
/tests                          # Playwright e2e + Vitest unit
```

**Server-side authorization — where it lives**

All authorization is **server-side, in route handlers and server actions**, never in client components.
`src/lib/permissions.ts` is the single source of truth — everything below calls into it rather than
re-implementing a check.

1. **Route-level guards** — `middleware.ts` is not built yet, so this layer currently lives at the
   call site instead of a shared edge middleware:
   - `src/lib/auth.ts` exports `requirePrincipal()` / `requirePortalAccess(portal)` /
     `requireExporterPrincipal()`, which re-read the session server-side and throw `UNAUTHENTICATED`
     or `FORBIDDEN` (`src/lib/errors.ts`)
   - Every portal page (`src/app/app/**/page.tsx`, `src/app/agent/**/page.tsx`, ...) and every
     `/api/v1/**` route handler calls one of these first, before touching Prisma. There is no shared
     `error.tsx` boundary yet either, so a page that calls a guard must catch the thrown `ApiError`
     itself and render the 401/403 state (see `src/app/app/buyers/page.tsx` for the pattern)

2. **Resource-level predicates** (`src/lib/permissions.ts`)
   - Pure functions: `canReadDeal(user, deal)`, `canTransitionTask(user, task, nextState)`, `canDownloadDocument(user, document)`, `canSearchBuyers(user, filters)`, etc.
   - `tenantScope(principal)` is the scoping helper every list/search query spreads into its Prisma `where` — exporter → own org, agent → assigned orgs, ops → unscoped
   - Every route handler / server action calls the relevant predicate **before** querying Prisma
   - Predicates encode the rules from `docs/01` (RBAC matrix) and `docs/07` (state-machine transition guards)
   - Search endpoints and file downloads **must** call predicates — these are the two most commonly missed (docs/09 §5, docs/10 §1)

**Conventions derived from docs/09 + docs/10**

- API responses use the envelope shapes in `docs/09` §2 (success list, async 202, validation error with `fields[]`, `blockers[]`, `VERSION_CONFLICT` with `current_version`)
- Error handling is centralized in `src/lib/api-client.ts` — maps `error.code` to global UI states (docs/03 §7)
- Background jobs: enqueue via `src/lib/jobs.ts` → returns `job_id`; frontend polls `/api/v1/jobs/:id` with backoff; job state survives refresh/device change (docs/09 §3)
- Money: Prisma `Decimal` (minor units or precise decimal); API returns `{ amount: number, currency: string }`; never JS floats (docs/09 §1)
- Files: return metadata + signed download URL (short-lived); never raw bucket URLs (docs/09 §1, docs/10 §1)
- Pagination: cursor-based with `total` where practical; consistent across all list endpoints (docs/09 §1)
- Idempotency: mutations that can be double-submitted accept `Idempotency-Key` header; deduplicate server-side (docs/09 §1)
- Responsive: three density modes via Tailwind theme — exporter `medium`, agent `compact`, ops `compact` (docs/13 D3)
- Accessibility: every status component renders label + icon; color never sole cue (docs/10 §4)
- i18n: English first; strings externalized; currency locale-aware; ISO country codes; `dd MMM yyyy` dates (docs/10 §5)

## Non-negotiables worth repeating

- Never present ClearTrade as a bank or settlement party — payment views are milestone/visibility
  surfaces only, and every milestone shows its source (`exporter_update` / `AA` / `bank_partner` /
  `manual_ops`).
- Never imply ClearTrade files directly with ICEGATE/CHA where it isn't the filing party.
- Use progressive disclosure — plain language first, customs jargon in helper text.
- P0 screens need loading, empty, error, permission (403/404) and mobile states before they're done.
