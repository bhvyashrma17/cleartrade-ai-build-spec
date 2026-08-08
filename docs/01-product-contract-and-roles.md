# 01 — Product Contract & Roles

Source: PRD Parts 01 (Product contract) and 02 (Roles, tenancy & permissions).

> **Superseded in part by `docs/14-guest-and-tiers.md`.** This document — like the rest of
> `docs/01`–`docs/13` — assumes every request is authenticated and belongs to a paying
> tenant. That is no longer true: Demand Discovery and Buyer Discovery are open to
> anonymous visitors, and access is now gated on **two** axes, role *and* commercial tier.
>
> The permission matrix in §5 below still defines the **role** axis and is still accurate
> for it. What it does not capture is the tier axis, which can withhold a capability the
> role permits. Read `docs/14` before relying on §5 to decide whether something is allowed.
>
> The tenancy rules in §4 are unchanged and hold more strongly than before — a guest is a
> real tenant, scoped exactly like any other.

---

## 1. Product objective

ClearTrade is an **AI + human-agent export operating system** for Indian manufacturers, with
particular emphasis on first-time exporters. The UI must convert a complex export process into a
guided workflow: become export-ready → select markets → identify buyers → convert a buyer →
generate/approve documents → coordinate CHA/freight → ship → realize payment → resolve exceptions →
reuse the exporter's memory for repeat shipments.

### Success conditions for the interface

The interface is working if, at any point, each role can answer these questions without needing
to ask a human:

- **Exporter:** What stage am I in? What do I need to do next? Who owns the next action? Is
  anything blocked?
- **Agent:** Which exporters or deals require action today? Which outreach/negotiation tasks are
  overdue? What is blocked?
- **Ops:** Where is work stuck across the portfolio? Who owns the exception? Which SLA, compliance,
  payout or dispute needs intervention?

Plus two structural guarantees:

- The same **Deal Workspace** is the source of truth across roles. Chat or informal notes must
  never be the only location of a required action or blocker.
- AI-generated outputs must have **visible provenance and review state**: generated, reviewed,
  approved/filed where relevant.
- The product must support **repeat shipments** without forcing a full restart.

### Explicit non-goals for the first production UI

- Do **not** attempt to replace ICEGATE/CHA filing where ClearTrade is not legally or operationally
  the filing party.
- Do **not** present ClearTrade as a bank. Banking views are milestone/visibility surfaces, not
  settlement infrastructure.
- Do **not** build a generic social feed. Activity is secondary to milestones, tasks, approvals and
  exceptions.
- Do **not** expose every customs or trade field to exporters by default — use progressive
  disclosure.
- Do **not** hardcode current fees, agent shares, SLA durations or thresholds in frontend code.
  They are business settings (see table below).

---

## 2. Business rules that must be configurable

These are **backend/config values**, not constants. The frontend renders whatever the API returns
and never recalculates from a hardcoded assumption.

| Rule | Current/default assumption | Implementation requirement |
|---|---|---|
| Commitment fee | INR 1,000 | Render from backend/config; support status: `not_due` / `due` / `paid` / `waived` / `refunded` |
| Success fee | 1% of shipment value | Configurable rate; calculation should return source amount, rate, and result |
| Small-shipment pricing | Below INR 5 lakh: 2% or INR 10,000 flat | Store as a pricing policy; UI must display the exact quoted commercial terms, not recalculate from hardcoded constants |
| Agent share | 30% concept | Internal only; configurable and versioned by deal/payout record |
| Agent capacity | ~10 exporters concept | Use as an operational planning metric, not a hard platform limit |
| Task/SLA thresholds | Varies by task type | Backend/config must provide `due_at`, `warning_at`, and escalation rules |
| Minimum shipment | INR 5 lakh concept | Configurable qualification/business rule; never assume it's permanent |

> **Rule of record:** For pricing, compliance, and fees, the deal-level quoted/accepted terms are
> the historical record. Later configuration changes must never silently rewrite older deals.

---

## 3. MVP boundary

| Capability | MVP build | Later / enhancement |
|---|---|---|
| Auth & organization | Email/phone auth (channel TBD — see open decisions), profile, exporter org, role routing | SSO, complex enterprise org hierarchy |
| Readiness | Questionnaire, score, blockers, enablement tasks | Adaptive AI interview, deeper certification recommendation engine |
| Demand Discovery | Run/search, ranked markets, detail, save/select | Scenario comparison, watchlists, scheduled refresh |
| Buyer Discovery | Search/filter, buyer list/detail, shortlist, lead creation | Enrichment marketplace, external CRM sync |
| Outreach | Agent pipeline, templates, activities, follow-up tasks | Deep email/LinkedIn automation where legally/integration feasible |
| Deal Workspace | Overview, terms, tasks, messages/activity, documents, shipment, payment | Advanced collaboration, buyer portal |
| Documents | Generate, review, approve, version, download, status | E-sign, advanced templates, document intelligence |
| Execution | CHA assignment/reference, shipment milestones, exceptions | Automated carrier booking and full tracking integrations |
| Payment | Milestone visibility, proof upload, BRC/realization status | Bank rails/financial products |
| Ops | Control tower, assignment, exceptions, audit basics | Advanced workforce planning and BI |

---

## 4. Role model

| Role | Primary objective | Default scope | Sensitive capabilities |
|---|---|---|---|
| **Exporter owner** | Run organization exports | Own organization only | Invite team, approve documents/terms, view fees/payments |
| **Exporter member** | Collaborate on exports | Own organization only | Permissions limited by org role; cannot necessarily approve commercial/critical docs |
| **Agent** | Execute assigned accounts | Assigned exporters/deals | Internal notes, outreach, task ownership, negotiation preparation |
| **Ops supervisor** | Manage flow and exceptions | All permitted portfolio | Reassign, override owners, escalate, inspect SLAs, audit |
| **Ops finance** | Manage fees/payouts | Finance objects | Fee/payment/payout states; no need for edit access to all commercial content |
| **Admin** | Platform configuration | Global | Role/config management; highly restricted |

### Authorization rules

- **Authorization must be enforced server-side.** Hiding a button is not access control.
- Exporter users are tenant-scoped by `exporter_org_id`. They may never query another exporter
  organization by changing route parameters.
- Agents only access exporter/deal records assigned to them, or explicitly granted by Ops;
  exceptions for shared teams must be explicit.
- Ops/admin access should be role- and permission-scoped, **not** one universal superuser role.
- Every material permission-sensitive mutation should write an `AuditEvent` with actor, role,
  object, before/after summary, and timestamp.
- Internal notes must be separately stored/flagged from exporter-visible messages. A visibility
  toggle should **never** default to public for internal operational notes.

---

## 5. Permission matrix

| Object / action | Exporter | Agent | Ops | Admin |
|---|---|---|---|---|
| View exporter profile | Own org | Assigned | Yes | Yes |
| Edit exporter master data | Own allowed fields | Suggest/edit allowed fields | Yes | Yes |
| Run Demand Discovery | Yes | Yes for assigned | Yes | Config only |
| Run Buyer Discovery | Yes / optional product policy | Yes | Yes | Config only |
| Create buyer lead | Yes | Yes | Yes | No routine use |
| Send outreach | No by default / request via agent | Yes | Override/assist | No routine use |
| Edit internal note | No | Yes | Yes | Yes |
| View internal note | No | Yes | Yes | Yes |
| Approve commercial terms | Authorized exporter user | Prepare only | Assist/override only per policy | No |
| Generate document | Yes / Agent depending on doc | Yes | Yes | Config |
| Approve exporter document | Authorized exporter | Cannot impersonate exporter | Override only if policy allows | No |
| Mark filed with CHA | View | Yes if assigned | Yes | No |
| Assign/reassign agent | No | No | Yes | Yes |
| Open dispute | Yes | Yes, on behalf, with audit | Yes | No |
| Resolve/close dispute | Accept resolution | Propose | Yes | No |
| View platform payout | No | Own payout | Yes (finance) | Yes |
| Edit fee policy | No | No | Restricted | Yes |

**Implementation note:** none of the above is a frontend-only concern. Every row implies a
server-side authorization check on the corresponding API endpoint(s); the UI merely reflects what
the server already enforces.
