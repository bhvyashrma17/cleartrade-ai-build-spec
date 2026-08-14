# 11 — Build Plan, QA & Release Gate

Source: PRD Part 10, cross-referenced with Blueprint sections 25–26.

---

## 1. Recommended build sequence

Both source documents give a phase plan. They agree on dependencies; the PRD's is slightly more
granular. Merged view:

| Phase | Deliverables | Exit criteria |
|---|---|---|
| **0 — Foundations** | Auth/role routing; design tokens/components; API client + error handling; entity types; file service; task/status primitives; audit hooks | All portals use the same user/deal/task/document schema |
| **1 — Exporter spine** | Exporter Dashboard; Readiness; Demand Discovery; Buyer Discovery; Deals List; Deal Workspace shell | Exporter can onboard, act on tasks, and complete market → buyer → outreach handoff |
| **2 — Conversion** | Agent My Day; Exporter 360; Outreach CRM; Lead Workspace; commercial proposal/version/approval; deal lock | Agent can operate ~10 accounts without spreadsheets; a qualified buyer becomes an executable deal |
| **3 — Execution** | Document Center/detail; task system; Agent Execution Workspace; Shipment/CHA; exporter shipment tracking | A deal can reach shipment end-to-end |
| **4 — Money/exceptions** | Payment; insurance case; disputes; Ops Control Tower; Assignments; Exceptions; finance/payout | Managers can operate without database/manual admin |
| **5 — Hardening** | Notifications, analytics, audit UI, responsive polish, accessibility, performance, security test, UAT, release observability | Release checklist passes |

> ### Do not build portal-by-portal in isolation
>
> Build **vertical slices through shared objects**. Example: a `BuyerLead` should be created in the
> exporter UI, appear in the agent CRM, create tasks/notifications, and be inspectable by Ops
> *before* moving on to the next large feature. This catches data-model and permission mistakes
> early, when they're cheap to fix.

**Prototype first (Blueprint):** build clickable high-fidelity prototypes for six critical screens
before engineering every page — Exporter Dashboard, Readiness, Demand Discovery, Buyer Discovery,
Agent Command Center, Deal Workspace. Validate navigation and state transitions first.

### MVP scope control

| Build now — MVP | Build later |
|---|---|
| Role-based login + permissions | Deep organization hierarchy / multi-branch accounts |
| Exporter dashboard + readiness | Advanced benchmarking dashboards |
| Demand + Buyer Discovery surfaces | Buyer portal |
| Agent Command Center + Exporter 360 | Full omnichannel sequencing engine |
| Outreach CRM + Deal Workspace | Advanced sales forecasting |
| Document Center + approvals | Collaborative document editor |
| Tasks + SLA + notifications | Complex workflow builder |
| Shipment/CHA milestone tracker | Real-time multi-carrier integrations |
| Payment/dispute milestone tracker | Deep finance reconciliation |
| Ops Control Tower + assignments + audit | Partner self-service portals |

---

## 2. Ticket structure

Each screen becomes an epic, decomposed into consistent layers:

| Ticket layer | Example (for EXP-04 Demand Discovery) |
|---|---|
| **Epic** | EXP-04 Demand Discovery |
| **Frontend story** | Render discovery run inputs, job states and ranked market result list |
| **Backend story** | Expose/create `DiscoveryRun`; authorize org; persist input snapshot; return status/results |
| **Component story** | `StatusChip` / `AsyncJobBanner` / `MarketScoreCard` |
| **Analytics story** | `demand_run_started` / `demand_run_completed` events |
| **QA story** | P0 happy path + failed/partial/stale run + permission + mobile |
| **Migration/config story** | Document type registry / fee policy / SLA policy as needed |

Note that **analytics and config are first-class ticket layers**, not afterthoughts. The acceptance
criteria listed on each screen in `docs/04`–`docs/06` are the QA story's checklist.

---

## 3. Cross-portal integration test matrix

These are the scenarios that prove the shared-object architecture actually works. Each one crosses
at least two portals.

| Scenario | Expected cross-portal behavior |
|---|---|
| Exporter creates buyer lead | Lead appears in Agent Outreach CRM; assigned agent notified; Ops sees it as unassigned **only if** assignment is missing |
| Agent sends commercial proposal | Exporter gets approval task/notification; proposal version visible; Ops audit event exists |
| Exporter requests changes | Agent receives task; proposal status changes; prior version remains in history |
| Deal locks | Execution tasks/doc checklist created; exporter journey advances; agent execution queue updates |
| Agent generates document | Exporter sees generation/review state according to policy; **no duplicate job** |
| Exporter approves doc | Agent execution workspace updates; audit records actor/version |
| CHA rejects filing | Document filing status → rejected; remediation task + risk appears; exporter gets a safe update; Ops exception queue sees it |
| Shipment exception | Deal risk banner visible to all relevant roles; Ops/agent owners explicit; exporter sees the next step |
| Payment overdue | Exporter reminder + agent task + Ops risk based on threshold; dispute path available |
| Agent reassigned | New agent gains access; old agent loses it per policy; ownership/tasks transfer per rule; **audit trail preserved** |

---

## 4. UAT acceptance gate

The product is not ready until **all** of these pass:

- A fresh exporter can complete onboarding, receive a readiness result, run Demand Discovery,
  select a market, discover/shortlist a buyer and create a `BuyerLead` — **without staff database
  edits**.
- The assigned agent can see that lead, work outreach, record replies, create/version commercial
  terms and send a proposal for exporter approval.
- The exporter can approve the exact proposal version; the system can lock the deal **only after**
  required prerequisites.
- Required deal documents can be generated, reviewed, approved, versioned and moved through filing
  states **without losing history**.
- Shipment milestones and payment states can progress, and a blocker/dispute can be opened, owned,
  resolved and audited.
- Ops can find unassigned/overdue/blocked work and reassign or escalate it **without direct
  database changes**.
- An exporter **cannot** access another exporter by changing IDs. An agent **cannot** access an
  unassigned exporter unless policy grants it.
- Mobile exporter flows support the critical actions: approve, upload, complete task, message,
  track shipment/payment.
- P0 screen acceptance criteria pass; no critical accessibility/security/performance defect remains
  open.

---

## 5. P0 QA checklist

| Area | Cases |
|---|---|
| Authentication/authorization | Tenant escape, agent assignment scope, role button visibility **and server enforcement** |
| Forms | Required, invalid formats, server field errors, unsaved navigation, duplicate submit |
| Async jobs | Queue / process / success / failure / partial / retry / refresh / duplicate-click |
| Tables | Pagination / filter / sort / search / empty / filter-empty / back-nav persistence |
| Files | Type / size / progress / failure / scan / secure preview / version / re-upload |
| Commercial approval | Stale version conflict, unauthorized approver, revision, audit |
| Documents | Missing inputs, generation failure, new version resets approval, filed version preserved |
| Tasks/SLA | Owner, due, waiting reason, overdue/escalation, completion guard |
| Cross-role sync | Exporter action reflected in agent/ops and vice versa |
| Notifications | Correct recipient, dedupe, deep link, read state |
| Responsive | Exporter P0 actions usable at common mobile widths |
| A11y | Keyboard, focus, labels, errors, contrast/status semantics |
| Recovery | 403 / 404 / 409 / 422 / 429 / 5xx and offline/network retry |
| Audit | Material mutations create the correct actor/object/timestamp trail |

---

## 6. Release checklist

- Production configuration created: fee policy, document types, SLA thresholds, partner statuses,
  role permissions.
- Seed/test data removed or isolated; production admin accounts secured.
- Error monitoring and structured logs operational; correlation IDs visible to support/engineering.
- Analytics event validation completed in staging; sensitive payload audit completed.
- File storage/scan/access-control test completed.
- Database backups/migrations/rollback plan verified.
- Email/in-app notification templates approved and tested with **real deep links**.
- Legal/privacy/terms/cookie requirements reviewed for the deployed geography and integrations.
- Runbook exists for: failed AI job, document generation outage, partner outage, notification
  outage, security incident.
- **UAT signed off by product + operations users, not engineering alone.**

---

## 7. Open product decisions

These are **not blockers to building**. The underlying state/permission hooks can be built using
configuration and feature flags — but each decision should be locked before enabling the affected
production action.

| Decision | Why it matters | Status |
|---|---|---|
| **Authentication channel** | Email/password, magic link, OTP/phone, or a combination. UI shell can be designed now; auth flow needs a final choice | ❓ Open |
| **Exporter team roles** | Whether non-owner exporter members can approve commercial terms/documents | ❓ Open |
| **Buyer Discovery exporter access** | Whether exporters directly run all searches or primarily receive agent-curated lists. Spec supports both; decide the default | ✅ **Resolved and implemented** — buyer discovery is agent-curated, not exporter-run. `buyer_discovery.run` and buyer-lead creation deny exporter roles; agent/ops searches require an explicit assigned exporter and product context. |
| **Outreach integration** | Whether the agent sends through integrated email/LinkedIn/WhatsApp or logs external outreach. UI must adapt to available integrations and legal terms | ❓ Open |
| **Buyer acceptance evidence** | What qualifies as buyer-side terms acceptance before deal lock: email evidence, uploaded PO, agent attestation, etc. | ❓ Open |
| **CHA directory/assignment** | Whether agents choose from an approved CHA directory or Ops assigns centrally | ❓ Open |
| **Shipment tracking source** | Manual partner updates vs. carrier API. UI state model supports both | ❓ Open |
| **Banking source** | Exact AA/bank integration scope and verification rules for payment status | ❓ Open |
| **Insurance flow** | Quote referral only vs. in-product partner quote/acceptance | ❓ Open |
| **Fee invoicing** | When the success fee becomes due, and which events make agent payout eligible | ❓ Open |
| **Notification channels** | In-app + email is the baseline; whether SMS/WhatsApp/push are launch requirements | ❓ Open |
| **Support escalation** | Whether the exporter can self-escalate agent responsiveness, and after what SLA | ❓ Open |

**How to handle these while building:** each maps to a config flag or policy record rather than a
code branch. E.g. "exporter team roles" → a permission on the org role record, checked server-side;
"CHA directory/assignment" → whether the agent's CHA selector is enabled or replaced by a
"request Ops assignment" action. Build both paths behind the flag where cheap; build the hook and
one path where not.

> **Keep this table updated.** When a decision is made, change the status, note the resolution, and
> record which config key or permission now encodes it.
