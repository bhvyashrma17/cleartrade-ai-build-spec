# 05 — Agent Portal Screens (AGT-01 … AGT-08)

Source: PRD Part 06, enriched with Blueprint sections 14–20. All routes under `/agent/*`.
**Desktop-first** — the agent portal is a high-density operations console, *not* a mirror of the
exporter UI.

Agents see the same canonical objects as exporters, plus internal notes, internal tasks, SLA
detail and outreach data. Every screen must make the internal/exporter-visible boundary
unmistakable — accidental leakage of internal negotiation notes is called out in the Blueprint as
a major trust risk.

---

## AGT-01 My Day / Command Center

`/agent` · Agent · **P0** · Desktop-first

Prioritize an agent's work across assigned exporters, leads, deals and execution tasks using
**SLA and risk**, not raw activity volume.

**Page anatomy**

| Zone / module | Required content | Interaction rule |
|---|---|---|
| Today queue | Overdue, due today, blocked, follow-ups, approvals waiting | Default sort: escalation > overdue > due soon > priority |
| Portfolio summary | Assigned exporters, active leads, negotiations, executions, blockers | Server aggregate |
| Follow-up lane | Buyer outreach requiring next touch | `next_action_at` mandatory for active outreach |
| Execution lane | Deal docs/shipment/payment tasks | Blocked reason visible |
| Risk panel | At-risk exporters/deals and reason | One-click open of the relevant workspace |

**Quick filters (Blueprint):** Due today · Buyer reply pending · Exporter input pending · Document
blocked · Shipment risk · Payment overdue.

**Header metrics (Blueprint):** Assigned · Due today · Active deals · At risk. Plus an SLA health
block: on-time %, overdue count, reply pending, escalated.

**Actions & behavior**

| Action | Who | Behavior / side effects | Failure handling |
|---|---|---|---|
| Start/complete task | Agent | Update task state and domain object if coupled | Cannot complete if the required domain mutation fails |
| Follow up buyer | Agent | Open outreach/lead workspace and log activity | Draft/log preserved on send failure when integrated |
| Escalate | Agent | Create escalation/notify Ops with reason | Prevent duplicate open escalation of the same type |

**Required UI states**

| State | UI behavior |
|---|---|
| No urgent work | Show upcoming follow-ups/portfolio health; **never blank** |
| Over capacity | Ops-facing signal based on active load; not a hard block |

**Acceptance criteria**

- **AC01** Every active queue item has an owner and due time.
- **AC02** Agent can reach any urgent item in one click.
- **AC03** Internal and exporter-facing tasks are clearly differentiated.
- **AC04** SLA/risk ordering is server-consistent and testable.

---

## AGT-02 Exporter 360

`/agent/exporters/:exporterOrgId` · Agent · **P0** · Desktop-first

Single account view: readiness, products, selected markets, buyer pipeline, active deals, tasks,
communications and risk for one assigned exporter.

**Page anatomy**

| Zone / module | Required content | Interaction rule |
|---|---|---|
| Account header | Exporter name, readiness, agent assignment, health/risk, latest contact | Show assignment status |
| Products | HS codes, capacity, certifications, price/MOQ | Quick-edit allowed fields with audit |
| Discovery summary | Saved/selected markets, latest run | Jump to run |
| Buyer pipeline | Stage counts + high-priority leads | Opens Outreach CRM filtered to this exporter |
| Deals | Negotiating/executing deals | Open workspace |
| Tasks & blockers | Agent/exporter/ops tasks **separated** | Internal tasks visible |
| Timeline | Material account events | Includes assignment changes |

**Blueprint additions:** commercial profile (capacity, MOQ, price, certifications, target markets,
previous export history); execution readiness (IEC/GST/AD, packaging, QC, sample, compliance
gaps); history (previous shipments, document patterns, buyer repeats, disputes); internal notes
section kept visually distinct from exporter-visible messages.

**Actions & behavior**

| Action | Who | Behavior / side effects | Failure handling |
|---|---|---|---|
| Create task | Agent | Task scoped to exporter/lead/deal | Validation |
| Run discovery | Agent | Use product context; same engine as exporter | Async job state |
| Create lead | Agent | `BuyerLead` | Dedup |
| Message exporter | Agent | Exporter-visible thread | Visibility explicit |

**Required UI states**

| State | UI behavior |
|---|---|
| Unassigned/revoked | Read-only or no access, based on policy |
| Blocked exporter | Top risk banner |

**Acceptance criteria**

- **AC01** Agent cannot access an unrelated exporter by URL manipulation.
- **AC02** Exporter-visible and internal notes have unmistakable composition modes.
- **AC03** Account summary reflects shared canonical objects, not agent-local copies.

---

## AGT-03 Outreach CRM / Buyer Pipeline

`/agent/outreach` · Agent · **P0** · Desktop-first

A lightweight **export-specific** CRM — explicitly *not* a generic Salesforce clone. Manages buyer
leads from shortlist through contact, reply, interest, negotiation, disqualification or conversion.

**Page anatomy**

| Zone / module | Required content | Interaction rule |
|---|---|---|
| Pipeline | new, shortlisted, contacted, replied, interested, negotiation, converted/disqualified | Kanban optional; **table view required** for density |
| Filters | Exporter, product, country, stage, next action, recency, owner | Persist filters |
| Lead row | Buyer, exporter/product, stage, last contact, next action, verification, risk | Overdue next action visible |
| Activity quick-add | Call/email/message/meeting/note/outcome | Internal vs. external activity classification |
| Templates | Approved outreach templates | Template selection **never auto-sends** |

**Actions & behavior**

| Action | Who | Behavior / side effects | Failure handling |
|---|---|---|---|
| Log contact | Agent | Create activity, update `last_contact_at`, optionally stage and next task | Allow save without stage change |
| Schedule follow-up | Agent | Create/update next-action Task | Date required |
| Change stage | Agent | Validate transition and required reason | Reject invalid transition |
| Disqualify | Agent | Require reason; close active outreach tasks | Confirm |
| Convert to deal | Agent | Create/link Deal; move stage to `converted` | Idempotent; prevent duplicate deal |

**Fields & controls**

| Field / control | Type | Required? | Validation / display rule |
|---|---|---|---|
| Stage | select | Yes | Allowed transition matrix |
| Outcome | select/text | Conditional | Required for contact activity depending on type |
| Next action date | datetime | Required for active contacted/replied/interested leads | Cannot be unreasonably past unless logging overdue |
| Disqualification reason | select + text | On disqualify | Required |
| Internal note | textarea | No | Visibility **internal by default** |

**Required UI states**

| State | UI behavior |
|---|---|
| Stale lead | No activity beyond threshold; highlight |
| Buyer risk | Risk flag visible **before** outreach |
| No verified contact | Verification task CTA rather than pretending outreach-ready |

**Acceptance criteria**

- **AC01** Every active worked lead has a next action or an explicit waiting state.
- **AC02** Stage transitions are audited.
- **AC03** Disqualified leads require a reason and are excluded from the default active view.
- **AC04** Conversion creates exactly **one** canonical Deal.

> **Blueprint rule:** once a buyer becomes qualified, create/attach a Deal Workspace rather than
> keeping negotiation inside the CRM. Auto-create a follow-up task after every outreach action.

---

## AGT-04 Lead / Buyer Workspace

`/agent/leads/:buyerLeadId` · Agent · **P0** · Desktop-first

Full buyer evidence, exporter/product fit, outreach history, contact options, next action and
conversion controls in one place.

**Page anatomy**

| Zone / module | Required content | Interaction rule |
|---|---|---|
| Lead header | Buyer + exporter/product + stage + owner + risk | Persistent |
| Buyer intelligence | Verification, source evidence, import activity, contacts | Provenance visible |
| Exporter offer | Capacity, price/MOQ, certifications, sample status | Read from Product/Readiness |
| Timeline | Outreach activities, replies, notes | Internal notes distinct |
| Next action | Task owner/due/CTA | Required for active state |
| Conversion panel | Proposed commercial terms and Create Deal | Only once the interest threshold is reached by business policy |

**Actions & behavior**

| Action | Who | Behavior / side effects | Failure handling |
|---|---|---|---|
| Log outreach/reply | Agent | Activity + optional stage/next action | Failure retains composition/log |
| Verify contact | Agent | Update verification status with evidence | Audit |
| Create negotiation/deal | Agent | Create Deal linked to lead | Dedup |
| Ask exporter question | Agent | Exporter-visible message/task | Visibility explicit |

**Required UI states**

| State | UI behavior |
|---|---|
| Unverified | Verification CTA prominent |
| No fit | Disqualify with reason |
| Negotiation | Commercial panel expanded |

**Acceptance criteria**

- **AC01** Agent sees source/evidence before relying on buyer contact data.
- **AC02** Exporter-facing communication is never confused with internal notes.
- **AC03** Lead-to-deal conversion retains lead history and relation.

---

## AGT-05 Negotiation & Deal Conversion

`/agent/deals/:dealId/commercial` · Agent · **P0** · Desktop-first

Prepare and version commercial proposals, coordinate exporter approval, and record buyer-side
progress until terms are locked. Structured pricing/term controls exist so negotiations do not
disappear inside chat threads.

**Page anatomy**

| Zone / module | Required content | Interaction rule |
|---|---|---|
| Current terms editor | Quantity, unit price, currency, Incoterm, payment/delivery, notes | Draft vs. proposed states |
| Exporter approval | Current exporter approval status and comments | **Cannot impersonate approval** |
| Buyer status | Agent-recorded buyer acceptance/negotiation state, evidence/note | No false legal acceptance if only verbal interest |
| Version compare | Diff against previous proposal | Changed fields highlighted |
| Risk | Payment terms, low margin/other policy flags if configured | Warnings before propose/lock |

**Blueprint offer-builder fields:** unit price, currency, MOQ, quantity tiers, Incoterm, validity.
**Terms:** advance %, balance trigger, LC/TT/open account, inspection, sample terms.
**AI assist:** suggested response, price comparison, risk flags — **never auto-send**.

**Actions & behavior**

| Action | Who | Behavior / side effects | Failure handling |
|---|---|---|---|
| Save draft | Agent | Version-safe draft | 409 conflict handling |
| Send to exporter for approval | Agent | Freeze proposal version + task/notification | Validate required fields |
| Revise | Agent | Create new version; preserve old | Do not mutate an accepted historical version |
| Lock deal | Agent/Ops per policy | Allowed only when required approvals/conditions are satisfied | Server rejects unmet prerequisites |

**Required UI states**

| State | UI behavior |
|---|---|
| Draft | Editable |
| Awaiting exporter | Read-only current proposal except withdraw/revise policy |
| Changes requested | Create new draft |
| Approved | Ready for buyer condition/lock |
| Locked | Commercial read-only except via explicit amendment workflow |

**Acceptance criteria**

- **AC01** Commercial proposals are versioned.
- **AC02** Exporter approval is recorded by an exporter-authorized actor, **not** the agent.
- **AC03** Deal lock checks prerequisites server-side.
- **AC04** Every revision preserves previous acceptance/change history.

> **Deal lock gate (Blueprint):** once the exporter approves final commercial terms, freeze a
> **Deal Snapshot** — buyer, SKU, quantity, price, Incoterm, payment terms, ship window, special
> conditions. **All documents generate from this canonical snapshot.**

---

## AGT-06 Deal Execution Workspace

`/agent/deals/:dealId` · Agent · **P0** · Desktop-first

After deal lock, the agent switches from sales mode to execution mode without leaving the deal.
Operates docs, CHA, freight, shipment, payment and exceptions with clear dependencies and
accountable tasks.

**Page anatomy**

| Zone / module | Required content | Interaction rule |
|---|---|---|
| Execution header | Deal, stage, value, exporter, buyer, risk, SLA | Persistent |
| Dependency checklist | Terms locked → required inputs → docs → CHA/file → pickup → customs → shipment → payment | Server-driven prerequisites |
| Task board | Agent/Exporter/Ops tasks by owner/status | Internal details visible to agent |
| Documents | Status table and generation/approval/file controls | Canonical `Document` objects |
| CHA/freight | Partner assignment, references, handoff notes, deadlines | Ops override visible |
| Shipment/payment | Milestones and exception state | Deep link or embedded summary |

**Execution lanes and agent controls (Blueprint)**

| Lane | Agent controls |
|---|---|
| Documents | Generate, review, request exporter input, approve, hand to CHA |
| CHA | Assign partner, share packet, capture queries, filing status, references |
| Freight | Quote/select partner, pickup, route, booking, tracking |
| Inspection / QC | Optional inspection booking, report, buyer acceptance |
| Insurance | Quote / selection / policy / claim |
| Payment | Advance confirmation, balance follow-up, realization/BRC |
| Dispute | Open case, classify issue, collect evidence, manage resolution |

**Actions & behavior**

| Action | Who | Behavior / side effects | Failure handling |
|---|---|---|---|
| Generate document | Agent | Async generation | Missing inputs return actionable errors |
| Assign/request CHA | Agent if allowed | Select approved partner or send request to Ops | No free-text phantom partner in structured assignment |
| Create exporter task | Agent | Exporter-visible task | Visibility explicit |
| Escalate blocker | Agent | Exception to Ops | Dedup / open case link |

**Required UI states**

| State | UI behavior |
|---|---|
| Prerequisite blocked | Disable downstream action **with reason and link** |
| Executing | Normal |
| Exception | Persistent risk |
| Closed | Read-only operational history |

**Acceptance criteria**

- **AC01** Downstream actions respect prerequisite state.
- **AC02** Every external filing/partner handoff has owner, status, timestamp and reference/evidence where available.
- **AC03** Agent can see exporter-visible status before sending updates.

> **Blueprint page rule:** default to a timeline with only the **current and next** milestones
> expanded. Historical completed steps collapse automatically.

---

## AGT-07 Tasks, SLAs & Escalations

`/agent/tasks` · Agent · **P0** · Desktop-first

Central task queue with explicit ownership, due date, waiting reason, escalation and linked
business context. This layer is what makes the human-agent model scalable.

**Page anatomy**

| Zone / module | Required content | Interaction rule |
|---|---|---|
| Views | My open, overdue, due soon, waiting, escalated, completed | Server filters |
| Task table | Title, exporter/deal, type, owner, state, priority, due, SLA, blocker | Default sort: SLA urgency |
| Quick actions | Start, done, waiting, reassign request, escalate | Only allowed transitions |
| Escalation detail | Reason, ops owner, status | Audit trail |

**Default SLA concepts (Blueprint — configurable, never hardcoded)**

| Task type | Default SLA idea | Escalation trigger |
|---|---|---|
| New buyer reply | Same business day | No agent action within SLA |
| Exporter approval | 24 hours | Reminder → agent nudge → Ops if deal-critical |
| Document review | Same day | Ship date threatened |
| CHA query | 2–4 business hours | No response / customs hold |
| Payment follow-up | Based on due date | Overdue by defined threshold |
| Dispute action | Priority-based | No owner or unresolved critical issue |

These are **starting values for the SLA config table**, not constants — see the configurable
business rules in `docs/01-product-contract-and-roles.md`.

**Actions & behavior**

| Action | Who | Behavior / side effects | Failure handling |
|---|---|---|---|
| Mark waiting | Agent | Require reason + `waiting_on` party + optional follow-up date | Cannot leave an active task ownerless |
| Complete | Agent | Transition only if the domain prerequisite is satisfied | Show server reason |
| Escalate | Agent | Create escalation event/case to Ops | Dedup |
| Create task | Agent | Context + owner + due | Required fields |

**Required UI states**

| State | UI behavior |
|---|---|
| Overdue | Prominent |
| Escalated | Ops owner and latest update shown |
| Waiting external | Follow-up reminder required where appropriate |

**Acceptance criteria**

- **AC01** No active task lacks an accountable owner.
- **AC02** Waiting requires a reason.
- **AC03** SLA state is derived from timestamps/config, **not manually edited**.
- **AC04** Escalation is auditable and visible in the Ops queue.

> Every task = owner, due date, linked exporter/deal, status, priority, source and completion
> evidence. Agents should never manage work from memory or WhatsApp alone. Use reminders
> conservatively — prioritize meaningful deadlines over notification volume.

---

## AGT-08 Agent Performance & Payout

`/agent/performance` · Agent · **P1** · Desktop-first

Transparent agent workload, conversion/activity quality and payout records — **without turning the
UI into a vanity leaderboard**. Tie metrics to customer outcomes, not raw message volume.

**Page anatomy**

| Zone / module | Required content | Interaction rule |
|---|---|---|
| Workload | Assigned exporters, active leads, deals, overdue tasks | Operational first |
| Performance | contacted → reply → interested → deal conversion, cycle times, repeat exporters | Use sufficient-sample-size caveats |
| Quality | SLA compliance, disputes/escalations, data completeness | No single misleading composite score unless the product defines one |
| Payouts | Deal/shipment, eligible fee basis, agent share snapshot, status, paid date | **Internal only** |

**Metric catalog (Blueprint)**

| Metric | Use |
|---|---|
| Assigned exporters | Capacity / workload |
| First-response SLA | Service quality |
| Qualified buyer rate | Outreach quality |
| Deal conversion | Commercial effectiveness |
| Deal cycle time | Speed without gaming volume |
| Blocked-deal recovery | Operational problem solving |
| Shipment success / dispute rate | Execution quality |
| Exporter satisfaction | Relationship quality |
| Success-fee eligible value | Payout basis and auditability |

**Actions & behavior**

| Action | Who | Behavior / side effects | Failure handling |
|---|---|---|---|
| Open payout detail | Agent | View calculation snapshot | **No edit** |
| Raise payout query | Agent | Create finance query/case | Track status |

**Required UI states**

| State | UI behavior |
|---|---|
| No payout yet | Explain eligibility |
| Payout pending | Show dependency/reason |
| Disputed | Finance case link |

**Acceptance criteria**

- **AC01** Agent cannot edit the payout calculation.
- **AC02** Payout is based on an immutable deal-level fee/share snapshot.
- **AC03** Performance metrics define time window and denominator.

> **Blueprint:** show eligible deals, fee basis, agent share, adjustments, payout status and the
> calculation breakdown. Make the math auditable so compensation disputes don't become an ops
> burden.
