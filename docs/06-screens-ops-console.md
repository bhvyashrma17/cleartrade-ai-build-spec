# 06 — Ops / Admin Console Screens (OPS-01 … OPS-07)

Source: PRD Part 07, enriched with Blueprint section 21. All routes under `/ops/*`.
**Desktop-only primary** — mobile is emergency read/triage only.

The Blueprint calls this "the minimum viable third interface ClearTrade needs to operate reliably."
Build it from day one, not after volume arrives.

Ops access is **role- and permission-scoped, not one universal superuser role** — `Ops supervisor`,
`Ops finance` and `Admin` are distinct (see `docs/01-product-contract-and-roles.md`).

---

## OPS-01 Operations Control Tower

`/ops` · Ops · **P0** · Desktop-only primary

Portfolio-level exception and flow control across exporter onboarding, outreach, deals, execution,
payments and disputes.

**Page anatomy**

| Zone / module | Required content | Interaction rule |
|---|---|---|
| Exception KPIs | Blocked deals, overdue SLAs, unassigned exporters, docs rejected, shipment exceptions, overdue payments, open disputes | Counts link to filtered queues |
| Stage funnel | Portfolio counts by journey stage | Monitor **flow**, not vanity metrics |
| Risk queue | Highest severity/age exceptions with owner | Default sort: severity, then age |
| Capacity | Agents by assigned/active load, overdue load | Advisory capacity signal |
| Recent escalations | Open/awaiting Ops decisions | Deep-link |

**Exception row shape (Blueprint):** deal ref · issue · category (Exporter / CHA / Buyer /
Compliance) · owning agent · age. Example: `CT-1042 · PI approval blocked · Exporter · Agent
A. Singh · 2h`.

**Actions & behavior**

| Action | Who | Behavior / side effects | Failure handling |
|---|---|---|---|
| Open exception | Ops | Exception detail/context | Safe |
| Reassign owner | Ops | Assignment history + notifications | Require reason for forced reassign |
| Escalate severity | Ops | Update risk/severity and notify stakeholders | Audit |
| Resolve exception | Ops | Require resolution outcome and downstream state | Cannot close an unresolved linked blocker if policy disallows |

**Required UI states**

| State | UI behavior |
|---|---|
| Healthy portfolio | Still show upcoming/aging items |
| Incident spike | Prioritize exception queue; metrics may show a partial-data caveat |

**Acceptance criteria**

- **AC01** Every KPI can be traced to the filtered underlying records.
- **AC02** Ops can identify owner and age of each open exception.
- **AC03** Reassignment preserves history and notifies old/new owners as policy requires.

---

## OPS-02 Assignments & Agent Capacity

`/ops/assignments` · Ops · **P0** · Desktop-only primary

Assign exporters/leads/deals to agents and **prevent invisible ownership gaps**.

**Page anatomy**

| Zone / module | Required content | Interaction rule |
|---|---|---|
| Unassigned queue | Exporter/deal/lead awaiting an owner | Age and priority shown |
| Agent capacity table | Agent, active exporters, leads, deals, overdue tasks, capacity signal | No hard cap unless configured |
| Assignment history | Who assigned/reassigned, reason, timestamp | Audit-backed |
| Bulk assignment | Optional safe MVP enhancement | Only after capacity/filters are proven |

Assignment criteria (Blueprint): capacity, geography/product expertise, SLA health.

**Actions & behavior**

| Action | Who | Behavior / side effects | Failure handling |
|---|---|---|---|
| Assign agent | Ops | Set owner, close assignment-gap task, notify | Server verifies agent is active |
| Reassign | Ops | Update owner and assignment history; transfer open tasks per rule | Require a strategy for task transfer |
| Deactivate agent | Admin/Ops per policy | Block new assignment; queue owned records for reassignment | **Cannot orphan active records** |

**Required UI states**

| State | UI behavior |
|---|---|
| No available agent | Queue with priority and Ops warning |
| Agent inactive | Visible and excluded from selector |

**Acceptance criteria**

- **AC01** No newly active exporter remains unassigned without appearing in the Ops queue.
- **AC02** Reassignment does not silently leave the old owner on active tasks unless intentionally retained.
- **AC03** Assignment history is immutable/auditable.

---

## OPS-03 Exceptions & Escalations Queue

`/ops/exceptions` · Ops · **P0** · Desktop-only primary

Centralize blocked, overdue, rejected, risk and escalated work **across all domains**.

**Page anatomy**

| Zone / module | Required content | Interaction rule |
|---|---|---|
| Filters | Type, severity, age, owner, exporter, stage, object | Server-side |
| Exception row | Type, object, reason, severity, owner, age, SLA, last update | Open context |
| Resolution panel | Root cause, remediation task, owner, target date, outcome | Structured close |
| Linked history | Related tasks/disputes/document/shipment | Traceable |

**Actions & behavior**

| Action | Who | Behavior / side effects | Failure handling |
|---|---|---|---|
| Assign owner | Ops | Set owner/due | Cannot close a newly created unowned exception |
| Change severity | Ops | Audit reason | Permission check |
| Resolve | Ops | Resolution + linked blocker transition | Validate downstream consistency |
| Create dispute | Ops | For a case-worthy issue | Link exception |

**Required UI states**

| State | UI behavior |
|---|---|
| Duplicate | Merge/link workflow optional; **do not delete history** |
| Critical | Top-of-queue and notification policy |

**Acceptance criteria**

- **AC01** Every active exception has type, owner, reason and `created_at`.
- **AC02** Resolved exceptions store resolution and timestamp.
- **AC03** Closing an exception updates/clears the corresponding risk/blocker only through an explicit domain rule.

> **Exception vs. Dispute:** an *exception* is an operational issue requiring an owner and
> remediation; a *dispute* is a structured case for a substantive payment, quality, logistics or
> document conflict. They are different objects — see the glossary in `docs/12-appendix-reference.md`.

---

## OPS-04 CHA, Compliance & Document Oversight

`/ops/execution` · Ops · **P1** · Desktop-only primary

Supervise document rejections, partner assignments, external filing references and shipment
readiness across deals.

**Page anatomy**

| Zone / module | Required content | Interaction rule |
|---|---|---|
| Ready-to-file queue | Docs cleared and waiting CHA/external action | Prerequisite-driven |
| Rejected/missing queue | Document/compliance blockers | Reason + owner |
| CHA assignments | Partner, deal/shipment, SLA, reference status | Approved partner directory |
| Partner performance | Later/minimal metrics: response/rejection patterns | **No unsupported score in MVP** |

**Actions & behavior**

| Action | Who | Behavior / side effects | Failure handling |
|---|---|---|---|
| Assign CHA | Ops | Select partner + owner/task | Partner active check |
| Record filing/reference | Ops/agent | External reference + evidence + date | Required fields by doc type |
| Record rejection | Ops/agent | Reason + remediation task; update filing status | **Cannot erase prior submitted state** |
| Override requirement | Restricted Ops | Policy-controlled with reason/audit | High-risk confirm |

**Required UI states**

| State | UI behavior |
|---|---|
| Partner unavailable | Queue/reassign |
| Rejected | Prominent remediation |
| Ready | **Avoid green unless all prerequisites are satisfied** |

**Acceptance criteria**

- **AC01** External filing status has evidence/reference where policy requires.
- **AC02** Rejected submissions preserve previous attempt history.
- **AC03** Requirement override is restricted and audited.

> ClearTrade may **prepare/coordinate** customs filing but is not necessarily the filing party.
> Never present the UI as if ClearTrade files directly with ICEGATE.

---

## OPS-05 Finance, Fees & Agent Payouts

`/ops/finance` · **Ops Finance** · **P1** · Desktop-only primary

Manage ClearTrade commercial fees, exporter payment status and agent payout eligibility as
traceable financial records.

**Page anatomy**

| Zone / module | Required content | Interaction rule |
|---|---|---|
| Fee records | Deal, fee basis, quoted rate/policy snapshot, amount, status | Historical snapshot |
| Exporter fee status | due / invoiced / paid / waived / refunded as the product requires | **Do not mix with buyer payment** |
| Agent payout | Eligible basis, share snapshot, amount, status, paid reference | Internal |
| Exceptions | Disputed fee/payout, missing realization | Case link |

**Actions & behavior**

| Action | Who | Behavior / side effects | Failure handling |
|---|---|---|---|
| Mark fee state | Ops Finance | Update with evidence/reference | Audit |
| Approve payout | Authorized finance | Transition eligible → approved | Permission + prerequisites |
| Mark payout paid | Authorized finance | Reference/date | No edit by agent |
| Adjust/waive | Restricted | Reason + adjustment record, **never rewrite the original quote** | High-risk confirm |

**Required UI states**

| State | UI behavior |
|---|---|
| Not eligible | Explain dependency |
| Pending realization | Waiting on buyer payment realization, if policy requires |
| Disputed | Case link |

**Acceptance criteria**

- **AC01** Buyer payment and ClearTrade fee are **separate records/views**.
- **AC02** Fee/payout calculations store input snapshots and do not depend on current config after creation.
- **AC03** Adjustments are additive/audited, not destructive rewrites.

---

## OPS-06 Dispute Oversight

`/ops/disputes` · Ops · **P1** · Desktop-only primary

Manage structured disputes from intake through investigation, external waiting, proposed
resolution and closure.

**Page anatomy**

| Zone / module | Required content | Interaction rule |
|---|---|---|
| Case queue | Type, severity, exporter, deal, amount impact if applicable, owner, SLA, state | Sort critical/overdue |
| Case detail | Facts, evidence, messages, internal notes, linked objects | **Visibility segmentation** |
| Resolution workflow | Actions, proposal, exporter acceptance if needed, final outcome | State machine |
| Escalation | Legal/external specialist marker if the product later adds it | **Do not fake external capability** |

**Actions & behavior**

| Action | Who | Behavior / side effects | Failure handling |
|---|---|---|---|
| Assign investigator | Ops | Owner + due | Active user check |
| Request evidence | Ops | Create exporter/agent task | Notification |
| Propose resolution | Ops | Structured proposal; exporter-visible if applicable | Permission |
| Close | Ops | Final outcome + accepted/authority basis | Validate prerequisites |

**Required UI states**

| State | UI behavior |
|---|---|
| Waiting exporter | Task link |
| Waiting external | Follow-up date required |
| Critical | Control tower alert |

**Acceptance criteria**

- **AC01** Internal notes are **never** exposed through the exporter case API response.
- **AC02** Every open case has an owner and next action/follow-up.
- **AC03** Closure stores outcome and linked financial/operational impact where applicable.

---

## OPS-07 Audit Log & Admin Configuration

`/ops/audit` · Ops/Admin · **P1** · Desktop-only primary

Immutable traceability for material changes, plus a controlled place for business configuration.

**Page anatomy**

| Zone / module | Required content | Interaction rule |
|---|---|---|
| Audit search | Actor, action, object, date, exporter, correlation ID | **Read-only** |
| Event detail | Before/after summary, actor role, source, timestamp | Sensitive values minimized |
| Config registry | Fee policy, thresholds, SLA templates, document type registry, role permissions, partner statuses | **Admin-only write** |
| Version history | Config `effective_at`/version | Historical deals use snapshots |

**Actions & behavior**

| Action | Who | Behavior / side effects | Failure handling |
|---|---|---|---|
| Search audit | Ops | Filter/paginate | No mutation |
| Change config | Admin | Create new version/effective state | High-risk confirm + audit |
| Deactivate config item | Admin | Future use disabled; history retained | Dependency check |

**Required UI states**

| State | UI behavior |
|---|---|
| Large audit range | Require date/filter limits, or async export |
| Config conflict | Version / optimistic concurrency |

**Acceptance criteria**

- **AC01** Audit log cannot be edited through the UI.
- **AC02** Config change is versioned and audited.
- **AC03** Historical deals/documents retain original policy/template version references.

---

## Partner directory (cross-cutting)

The Blueprint lists a **CHAs / partners** section in the Ops navigation and calls for managing the
"CHA/freight/insurance partner directory and service quality." The PRD does not assign this a
dedicated screen ID — it surfaces partner assignment inside OPS-04 and the config registry inside
OPS-07.

**Recommendation:** implement the partner directory as part of the OPS-07 config registry
(partner statuses are explicitly listed there), and surface partner *assignment* and *performance*
in OPS-04. If a standalone `/ops/partners` route is wanted, treat it as a view onto the same
config-registry records — not a new object. Flagged in `docs/13-blueprint-reconciliation.md`.
