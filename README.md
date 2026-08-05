# ClearTrade AI — Build Specification

A structured, agent-readable knowledge base distilled from the two ClearTrade AI source documents:

- **Product Requirements & Technical UI Specification** (106 pp) — behavior, data, states, permissions
- **Interface Architecture / UI Blueprint** (30 pp) — visual language, layout, components, microcopy

## How to use this with OpenCode

Drop this folder at the root of your project (or clone it as the project itself) and run `opencode`
from that directory. `AGENTS.md` is loaded automatically into the agent's context on every session,
and it points to the right `docs/` file for whatever you're working on — so you don't burn context
loading all 14 documents for a one-screen task.

```
your-project/
├── AGENTS.md          ← auto-loaded project context
├── README.md
├── docs/              ← referenced on demand
└── src/               ← your code
```

Useful patterns once you're in a session:

```
@docs/04-screens-exporter-portal.md build EXP-01 with all five required UI states
@docs/07-workflow-state-machines.md implement the Deal state machine with server-side guards
@docs/02-domain-model.md generate the schema for Deal, Task and Document
```

Commit `AGENTS.md` to git so the whole team shares the same context. As the codebase grows, keep it
updated — especially the tech-stack section, once you've chosen one.

## Contents

| File | What's in it |
|---|---|
| `AGENTS.md` | Project context: architecture, cross-cutting rules, doc map, build order |
| `docs/00-design-system.md` | Color tokens (exact hex), typography, layout shell, component library, microcopy |
| `docs/01-product-contract-and-roles.md` | Objective, non-goals, configurable business rules, MVP boundary, RBAC, permission matrix |
| `docs/02-domain-model.md` | 17 canonical entities, full field dictionaries, ER diagram |
| `docs/03-global-ux-contract.md` | Shell, status semantics, shared components, forms, tables, files, global states |
| `docs/04-screens-exporter-portal.md` | EXP-01 … EXP-17 with anatomy, actions, states, acceptance criteria |
| `docs/05-screens-agent-portal.md` | AGT-01 … AGT-08 |
| `docs/06-screens-ops-console.md` | OPS-01 … OPS-07 |
| `docs/07-workflow-state-machines.md` | 7 state machines with transition tables + mermaid diagrams |
| `docs/08-notifications-audit-analytics.md` | Notification catalog, audit rules, 27 analytics events |
| `docs/09-api-platform-contract.md` | API expectations, response envelopes, async jobs, error codes |
| `docs/10-non-functional-requirements.md` | Security, performance, responsive, accessibility, i18n |
| `docs/11-build-plan-qa-release.md` | Phases, tickets, integration matrix, UAT gate, 12 open decisions |
| `docs/12-appendix-reference.md` | Screen registry, route conventions, glossary, definition of done |
| `docs/13-blueprint-reconciliation.md` | Where the two sources conflict + what's missing from each |

## Start here

1. **`AGENTS.md`** — the architecture and the rules that apply everywhere.
2. **`docs/13-blueprint-reconciliation.md`** — read before Phase 0. The two source documents
   disagree in several places, and four of those decisions shape foundational work.
3. **`docs/11-build-plan-qa-release.md`** — the phase plan and the 12 unresolved product decisions.

## Scope at a glance

- **3 portals** — Exporter (`/app/*`), Agent (`/agent/*`), Ops (`/ops/*`)
- **32 screens** — 17 / 8 / 7, of which 21 are P0
- **17 canonical entities** shared across all portals
- **7 workflow state machines**
- **6 phases**, foundations through hardening

## The core architectural constraint

All three portals render the **same** `Deal`, `Task`, `Document`, `Shipment`, `Payment`, `Dispute`
and `Audit` records — differing only in permissions and presentation. Never fork the data per role.
Build vertical slices through shared objects rather than one portal at a time.
