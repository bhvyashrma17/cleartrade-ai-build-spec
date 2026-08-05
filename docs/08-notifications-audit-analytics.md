# 08 — Notifications, Audit & Analytics

Source: PRD Part 07, enriched with Blueprint sections 13 and 28.

---

## 1. Notification catalog

| Audience | Trigger | Channels | Deep link | Noise rule |
|---|---|---|---|---|
| Exporter | Readiness assessment completed | In-app + email optional | `/app/readiness` | Once per completed version |
| Exporter | New exporter-owned task | In-app; email if due/important | Task deep link | Group low-priority tasks |
| Exporter | Commercial proposal awaiting approval | In-app + email | Deal commercial | Always actionable |
| Exporter | Document awaiting approval | In-app + email | Document detail | Group per deal if many at once |
| Exporter | Document rejected / changes requested | In-app + email | Document detail | High importance |
| Exporter | Shipment milestone / exception | In-app; email for major milestone/exception | Shipment | Avoid every micro-scan event |
| Exporter | Payment due / overdue / received | In-app + email | Payment | Policy driven |
| Exporter | Dispute update / resolution | In-app + email | Support/dispute | Material updates only |
| Agent | Exporter assigned | In-app | Exporter 360 | Immediate |
| Agent | New buyer lead | In-app | Lead | Immediate |
| Agent | Follow-up due/overdue | In-app / digest | Lead/task | Deduplicate |
| Agent | Exporter requested changes | In-app | Commercial/document | Immediate |
| Agent | Execution blocker | In-app | Deal | High |
| Agent | Ops escalation update | In-app | Task/exception | Material updates |
| Ops | Unassigned exporter/lead exceeds threshold | In-app / control tower | Assignments | Escalation rule |
| Ops | Agent SLA escalated | In-app | Exceptions | Deduplicate |
| Ops | Critical document/shipment/payment exception | In-app + optional external channel | Exception | High severity |
| Ops Finance | Payout/fee exception | In-app | Finance | Target finance role |

### Channel priority (Blueprint view)

| Notification type | Channel priority | Deep link |
|---|---|---|
| Approval required | In-app + WhatsApp/email optional | Exact document / quote approval |
| Agent needs input | In-app + push | Task form |
| Buyer replied | In-app | Deal messages |
| Shipment exception | Push + in-app | Shipment exception |
| Payment due/late | Push + in-app | Payment timeline |
| FYI milestone | In-app only | Deal timeline |

> Whether SMS/WhatsApp/push are launch requirements is an **open product decision** — in-app +
> email is the confirmed baseline. See `docs/11-build-plan-qa-release.md`.

### Notification payload contract

| Field | Requirement |
|---|---|
| `id` | Stable notification ID |
| `user_id` | Target user |
| `type` | Machine-readable event type |
| `title` / `body` | Human-readable; **no secrets** |
| `severity` | `info` / `action_required` / `warning` / `critical` |
| `object_type` / `object_id` | Context target |
| `deep_link` | Role-valid route; **server/API still authorizes** |
| `read_at` | Nullable timestamp |
| `created_at` | Server timestamp |
| `dedupe_key` | Optional grouping/deduplication key |

**Implementation notes:**

- A deep link is a convenience, not an authorization grant — the target route/API must still
  perform its own permission check and return a safe 403/404 if access has since been revoked
  (EXP-17-AC01, EXP-01 action failure handling).
- Read state must sync across sessions/devices (EXP-17-AC02).
- Critical legal/security notifications may be **non-disableable** in preferences.
- Use `dedupe_key` for grouping — the recurring theme across the catalog is *avoid notification
  volume*, prioritize meaningful deadlines.

---

## 2. Audit event catalog

**Record** (as `AuditEvent` records):

- Login/security events, as policy requires
- Assignment / reassignment
- Commercial proposal / approval
- Deal lock / cancel
- Document generation, version, approval, filing, rejection
- Shipment external refs / status override
- Payment status / evidence
- Dispute state / resolution
- Fee / payout adjustments
- Permission / config changes

**Rules:**

- Do **not** record every read/view as an `AuditEvent` unless compliance policy requires it —
  product analytics handles ordinary views.
- Audit records are **append-only** to application users. Corrections create **new** events, never
  edits to old ones.
- Use `correlation_id` / `request_id` so a single user action can be traced through background jobs
  and downstream mutations.
- The audit log **cannot be edited through the UI** (OPS-07-AC01).

See the `AuditEvent` field dictionary in `docs/02-domain-model.md` and the audit search UI in
`docs/06-screens-ops-console.md` (OPS-07).

---

## 3. Product analytics events

| Event | Properties (minimum useful) |
|---|---|
| `auth_login_success` | `role`, `org_id` |
| `readiness_started` | `org_id` |
| `readiness_submitted` | `assessment_id` |
| `readiness_completed` | `score_band`, `blockers_count` |
| `demand_run_started` | `run_id`, `product_id` |
| `demand_run_completed` | `run_id`, `results_count`, `duration_ms`, `partial` |
| `market_selected` | `market_assessment_id`, `country` |
| `buyer_search_performed` | `country`, `filters_count`, `results_count` |
| `buyer_shortlisted` | `buyer_id`, `product_id` |
| `buyer_lead_created` | `lead_id`, `source` |
| `lead_stage_changed` | `from`, `to`, `agent_id` |
| `outreach_activity_logged` | `activity_type`, `outcome` |
| `deal_created` | `deal_id` |
| `proposal_sent` | `deal_id`, `version` |
| `proposal_approved` | `deal_id`, `version` |
| `deal_locked` | `deal_id`, `value`, `currency` |
| `document_generation_started` | `doc_type` |
| `document_generation_completed` | `doc_type`, `duration_ms`, `success` |
| `document_approved` | `doc_type`, `version` |
| `document_filed` | `doc_type` |
| `shipment_status_changed` | `from`, `to`, `mode` |
| `payment_status_changed` | `from`, `to` |
| `dispute_opened` | `type`, `severity` |
| `dispute_resolved` | `type`, `duration_hours` |
| `task_completed` | `task_type`, `owner_role`, `sla_state` |
| `exception_escalated` | `type`, `severity` |
| `repeat_shipment_started` | `source_deal_id` |

> **Analytics privacy:** do **not** send document contents, contact message bodies, bank proofs or
> other sensitive payloads into product analytics. Use IDs and categorical metadata only.

### Funnels to instrument (Blueprint)

Measure **where deals stall**, not page views:

| Funnel | Key events |
|---|---|
| Readiness completion | Started, section completed, blockers created, Green/Amber/Red |
| Market conversion | Market viewed, selected, buyer search launched |
| Buyer funnel | Shortlisted, outreach started, replied, qualified, rejected |
| Deal funnel | Created, negotiated, locked, lost + reason |
| Document funnel | Generated, reviewed, changes requested, approved, filed |
| Execution | CHA assigned, pickup, filing, cleared, departed, delivered |
| Payment | Advance due/received, balance due/received, realized, BRC |
| Agent ops | Task SLA, first response, overdue, escalation, conversion |
| Exceptions | Type, root cause, duration, owner, resolution outcome |

### North-star operational metric

> Track **"deals progressing without manual ops intervention"** alongside deal conversion. If every
> shipment requires founders to fix hidden handoffs, the UI is not yet functioning as an operating
> system.

This is the single best signal that the product is working as designed — worth instrumenting in
Phase 1 rather than deferring to the hardening phase.
