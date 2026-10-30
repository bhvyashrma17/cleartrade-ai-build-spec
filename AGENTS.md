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
- **Access has two axes: role AND tier.** Role asks "may this kind of user do this?"; tier asks
  "has this tenant paid for it?" Both must pass, and `permits()` in `src/lib/permissions.ts` is
  the only place they combine. Tier is not a `UserRole` — a guest is a real `ExporterOrg` + `User`
  with `tier='guest'`, so tenancy is unchanged and there is **no unauthenticated code path**.
  Anything absent from `CAPABILITY_MIN_TIER` is paid-only by default. Every mutation route calls
  `assertCan()` (role + tier, distinct errors) *before* the scope predicate — skipping it turns a
  tier denial into a bare `FORBIDDEN` and silently disables the upsell. See `docs/14`.
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
- **Tailwind alpha modifiers (`bg-action/10`, `border-warning/25`) do not work on a color defined
  as a bare `var(--x)`** — Tailwind has no channels to decompose, so the class silently compiles to
  nothing rather than erroring. This is exactly how `StatusChip`'s tinted backgrounds shipped fully
  transparent (with a default grey border) for the whole time they existed: `bg-warning/10` on a
  `--color-warning: var(...)`-style token produced `rgba(0,0,0,0)`, not a 10% tint, and nobody
  caught it because the chip still rendered — just without the tint. Use `color-mix()` in an
  arbitrary value instead: `bg-[color-mix(in_srgb,var(--color-warning)_12%,transparent)]`. See
  `docs/00-design-system.md` §2 for the verified pattern and contrast ratios.
  **This was never StatusChip-only.** A later sweep found the same silent failure in five more
  places, each measured as `rgba(0, 0, 0, 0)` in the browser: `Skeleton` (`bg-primary/10` — every
  loading state in the product was rendering *completely invisible*), the readiness step selector's
  active highlight (`bg-action/10`), and the error panels in `NextActionCard`, the overview modules,
  `BuyersExplorer`, `OutreachPipeline`, and both auth forms (`bg-critical/5`, `border-critical/25`
  and `/30` — error states showed a default grey border instead of red). All now use `color-mix()`.
  When adding a tint, verify it in the browser via `getComputedStyle`; the class name looking right
  proves nothing, and this bug is invisible in review precisely because the element still renders.
- **Verification scenarios must not assume a pristine database.** The suites in `scripts/` all run
  against the same seeded org, and several deliberately mutate it (`verify-journey` selects a target
  market, creates a lead and submits the readiness form). Any scenario that hardcodes an expected
  value derived from that shared state passes or fails based on *which suite ran first* — which is
  indistinguishable from a real regression at the point you read the output. Two scenarios had this
  bug: `EXP-01-AC01` hardcoded the rail label `"Readiness"`, and `EXP-02-AC04` reset only
  `ExporterOrg.iec` while the form actually reads from the current assessment's `answers`. Assert
  against **live derived state** (call the same function the server calls) or **seed and restore
  what you depend on**, and prefer `UNVERIFIED` over `PASS` when the data can't distinguish the
  thing under test — a green run that proves nothing is worse than an honest inconclusive one.
- **Seeded fixtures hand-place END states, so the TRANSITIONS into them go
  unexercised.** Twelve suites asserting against the seeded org caught real bugs, but three
  slipped past all of them because the seed writes the destination row directly rather than
  producing it by calling the routes: `shipment/issue` never actually raised `Deal.risk_state`
  (the seed sets `risk_state: blocked` by hand), the `cha_filing` execution gate was a permanent
  deadlock on any deal that didn't already have a partner assigned (the seed pre-assigns one),
  and an `EXP-17` notification read-state test only worked because the seed's target row happened
  to still be near the top of the list. All three were invisible until
  `scripts/verify-cross-portal-walk.ts` built a deal from scratch — lead through dispute
  resolution — and read every step through the *other* portal's API immediately after the write.
  **A new feature needs at least one from-scratch path exercising its state machine, not only
  assertions against rows the seed already placed at the end state.** When you add a new
  lifecycle (a new gate, a new status enum, a new cross-object effect), extend the cross-portal
  walk rather than only adding a seeded-fixture scenario for it.
- **A compatibility alias map is not an authority on provider identity.** `COMTRADE_LEGACY_AREA_TO_ISO2`
  exists to READ area codes already sitting in stored evidence. Phase 1F initially inverted it to
  decide which reporter code to ASK Comtrade about, and produced `381` for Italy — a code UN
  Comtrade lists in neither its reporter nor its partner reference. The request would have returned
  nothing, Italy would have been recorded `unavailable`, and no error would have been raised
  anywhere; the same inversion happened to be right for the USA (`842`) and India (`699`), which is
  exactly why it looked correct. Provider identity now comes from the provider's own reference
  (`src/lib/comtrade/reporter-registry.ts` over a checked-in snapshot of the public, keyless
  `files/v1/app/reference/Reporters.json`), and ISO/M49 stays the geographic identity. When you
  need a provider's internal id, fetch its reference table — never derive one from a mapping built
  for the opposite direction.
- **A `BEFORE DELETE` trigger must `RETURN OLD`.** `NEW` is NULL in a delete trigger, and a BEFORE
  trigger that returns NULL cancels the row silently — no error, `DELETE 0`, and an `ON DELETE
  CASCADE` parent delete leaves the child orphaned. The `MarketAssessment` lineage guard did exactly
  this for a month (fixed in `20261013181000`, ledger E-012): retries appended duplicate result sets
  and deleted runs left their assessments behind. When a guard covers `UPDATE OR DELETE`, branch on
  `TG_OP`, and test that a permitted delete actually removes the row.
- **Restart the WORKER after adding a `JobType`, or it strands jobs in `processing` forever.**
  A long-running `npm run worker` holds a Prisma client generated before the new enum value
  existed. It still claims the new job (the candidate query selects only `id`, so nothing
  fails yet), sets `status = processing`, and then throws while deserializing the unknown
  enum on read-back — leaving the row `processing` with `attempts: 0` and no `JobAttempt`,
  a state no code path can otherwise produce. `reclaimStaleJobs` does eventually rescue
  these after `stale_after_seconds`, so the system self-heals, but in the meantime the stale
  worker silently competes with any inline drain loop. This is exactly how the trade
  warehouse seed first came out with ~1/3 of its rows missing, non-uniformly, which then
  looked like a scoring bug rather than an infrastructure one. Symptom to recognise:
  `processing` + `attempts: 0`. Kill and restart the worker whenever `JobType` changes.
- **A drain loop must not treat one null claim as "queue empty".** `claimNextJob()` also
  returns null when another process won the race for every candidate it looked at. Loop
  until `count({ status: 'queued' })` is actually zero — see `seedTradeWarehouse()` in
  `prisma/seed.ts`. Stopping at the first null is what silently truncated that same seed.
- **Restart the dev server before a full suite run, not just after a migration.** A `next dev`
  process left running for hours accumulates Prisma query logging and degrades HMR compile
  latency, which surfaces as `page.goto`/`waitFor` timeouts in the Playwright suites — a false
  regression signal that looks exactly like a broken page. It has also coincided with a V8 abort
  (`Lazy deopt after a fast API call with return value is unsupported`) killing the process mid-run
  on non-LTS Node; see `.nvmrc` / `package.json#engines` for the pinned version. Kill port 3000,
  `rm -rf .next`, and restart clean before running `scripts/browser-verify.ts` and friends back to
  back — a stale server is indistinguishable from a real regression until you've ruled it out.

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
| `docs/14-guest-and-tiers.md` | **Read before any permission, auth or access-control work.** Guest/freemium tiers, the capability matrix, guest lifecycle from mint through upgrade, retention, and the abuse surface. Supersedes the "all access is authenticated" assumption in `docs/01`–`docs/13` |
| `docs/31-global-country-screening.md` | Phase 1F Stage A: the derived country universe, Country Screening Policy v1, screening rank, quota planning and the handoff into the deep Country Truth pipeline |
| `docs/33-railway-staging-amused-insight.md` | Railway staging as deployed: services, isolation from production, empty-database bootstrap, verification, open production hazards |
| `docs/32-latest-usable-period.md` | Phase 1G: per-country latest-usable-period selection, the fallback walk and its four semantics, mixed-vintage ranking, per-reporter deep analysis windows, and freshness-weighted confidence |
| `docs/34-phase-1-acceptance-gate.md` | The Phase 1 acceptance gate (policy v2, Demand Discovery v5 runs only): proposed thresholds, definitions (official duty, labelled estimate, calibration, scoring replay), evidence matrix, report fields, and the staging runbook for `scripts/gate-phase-1.ts` |
| `docs/35-programme-evidence-ledger.md` | **Read before starting any roadmap work package.** Append-only record of verified repository/CI/staging state, owner decisions, checks run and open risks |
| `docs/36-demand-discovery-v5.md` | Demand Discovery v5 (owner-approved 13 Oct 2026): all 218 markets per product from CEPII BACI with Comtrade fallback and newest-year chain-link, the 12 metrics, the five-part score, labels, gates, auto-start on HS confirmation |
| `docs/37-tariff-sources.md` | Official tariffs for every market (D-024): where each of the 218 markets' tariff comes from (connected, researched, directory, published rule), the agent's recording flow, customs unions, licences and the automation order |
| `docs/38-regional-and-buyer-discovery.md` | Stages 2 and 3 of the product order (D-033): regional demand inside a v5 market (US states and ports from the Census Bureau) and real buyers from official importer lists (UK, Canada) |

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

**Commercial tiers (docs/14)**

`ExporterOrg.tier` is `guest | free | paid`. A guest is a real org + user with a real
session, minted on their **first search** (not first page view), so every existing tenancy
and permission check works on them unchanged.

| | guest | free | paid |
|---|---|---|---|
| Pre-membership market estimate | ✓ (capped per IP, observed history only — no ranking, no LLM) | ✓ | ✓ |
| Full Demand Discovery (ranked, save/select) | — | — | ✓ (commitment fee paid) |
| Buyer Discovery | ✓ (contacts hidden, result ceiling) | ✓ | ✓ |
| Saved discovery history | — (persisted, but no history UI; purged after retention) | ✓ | ✓ |
| Readiness | — | ✓ | ✓ |
| Buyer contacts | — | ✓ | ✓ |
| Buyer leads | — | ✓ (no agent assigned) | ✓ |
| Deals, documents, shipment, payment, agent | — | — | ✓ |

**Full Demand Discovery moved behind the commitment fee (docs/01 §2, docs/14 §3a).** This
is not a new membership concept — it's the SAME commitment fee (`not_due`/`due`/`paid`/
`waived`/`refunded`) docs/01 always specified, now doing the work of gating `paid` tier.
Guest/free tier get `POST /api/v1/market-estimates` instead: a synchronous, no-LLM read of
the `TradeFlow` warehouse returning observed historical import value + unit-price bands
only. **Framing is a product requirement, not copy preference**: never project earnings or
promised revenue, only "buyers in these markets imported X at Y–Z per unit" plus an
explicit not-a-forecast disclaimer — enforced by `src/lib/market-estimate.ts` never
multiplying `monthly_quantity` against a price band anywhere in the computation (it's
captured and echoed, never an operand). Funnel: registration sets the fee `due`
(`POST /api/v1/register`, snapshotted from the active `FeePolicy`, both branches); paying
it (`PATCH /api/v1/exporter-org/commitment-fee`) flips `tier: free → paid` in the same
transaction, via `src/lib/state-machines/commitment-fee.ts`.

Two rules that are easy to get wrong:
- **Guests get no `Product` rows.** Product context is typed ad hoc and snapshotted onto
  `DiscoveryRun.input_snapshot`; it becomes a real `Product` only if the user opts in at
  registration. Never auto-create placeholder products.
- **Guest runs are persisted.** docs/09 §3 requires durable job state, which applies to
  guests too. "Nothing saved" means no history UI + time-limited retention, and the runs
  **survive the upgrade** to become visible history.

Registration upgrades the guest tenant **in place** — same org id, same user id — so nothing
is migrated between systems and nothing is lost at the moment of signup.

**Server-side authorization — where it lives**

All authorization is **server-side, in route handlers and server actions**, never in client components.
`src/lib/permissions.ts` is the single source of truth — everything below calls into it rather than
re-implementing a check.

1. **Route-level guards** — `middleware.ts` is not built yet, so this layer currently lives at the
   call site instead of a shared edge middleware:
   - `src/lib/auth.ts` exports `requirePrincipal()` / `requirePortalAccess(portal)` /
     `requireExporterPrincipal()`, which re-read the session server-side and throw `UNAUTHENTICATED`
     or `FORBIDDEN` (`src/lib/errors.ts`)
   - Every `/api/v1/**` route handler calls one of these (or `getPrincipal()` for the
     guest-accessible ones) before touching Prisma
   - **`/app` no longer requires a session at the layout.** Demand Discovery and Buyer Discovery
     are open to anonymous visitors, so `src/app/app/layout.tsx` enforces only the *role*
     boundary; the portal boundary is no longer the authorization boundary there. Each page under
     `/app` enforces its own requirement. `/agent` and `/ops` are still fully guarded at the layout
   - Layouts catch the thrown `ApiError` and render `AccessDenied` / redirect to `/login`, because
     a thrown error loses `code` and `status` crossing into `src/app/error.tsx` (React strips a
     server error to `{ digest }` in production)

2. **Resource-level predicates** (`src/lib/permissions.ts`)
   - Pure functions: `canReadDeal(user, deal)`, `canTransitionTask(user, task, nextState)`, `canDownloadDocument(user, document)`, `canSearchBuyers(user, filters)`, etc.
   - `tenantScope(principal)` is the scoping helper every list/search query spreads into its Prisma `where` — exporter → own org, agent → assigned orgs, ops → unscoped. **Unchanged by the tier work and must stay that way** — tenancy is orthogonal to tier
   - These return a plain boolean and so cannot carry *why* they denied. Pair each with
     `assertCan()` for the capability + tier; see the convention comment in `permissions.ts`
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

## Automated regression and CI

- **Applied migrations are immutable.** Once a migration has been applied to any shared or
  persistent database, never edit its SQL in place. Put every correction, backfill, constraint,
  or compatibility adjustment in a new, forward-only migration so Prisma checksums and database
  history remain reproducible.
- `npm test` is the canonical fast regression command. Vitest creates a unique disposable PostgreSQL
  schema, applies the complete migration history, runs files serially, and drops the schema afterward.
- Tests refuse production/staging environments and refuse database names that do not clearly identify
  a test, development, or local database. Never weaken that guard or point tests at customer data.
- External network access is denied by the shared Vitest setup. Tests must inject clients or mock
  `fetch`; a test that needs live provider behavior belongs in an explicit/manual contract-validation
  script, never the default suite.
- Pull requests and changes to `main`/`master` must pass Prisma generation and validation, typecheck,
  noninteractive ESLint, `npm test`, and a production build against the CI PostgreSQL service.
- The 20 `scripts/verify-*.ts` scenarios remain the extended acceptance suite. They supplement the
  deterministic tests and are run deliberately against a seeded non-production environment; do not
  fold their stateful browser/network behavior into `npm test`.
