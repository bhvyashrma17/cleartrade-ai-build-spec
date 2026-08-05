# 03 — Global UX & Interaction Contract

Source: PRD Part 04. Read this before building **any** screen — it defines the shared shell,
status vocabulary, reusable components, and state handling that every screen spec in
`docs/04`–`docs/06` assumes.

> **Visual design is out of scope here.** This document defines *behavior* — what must exist and
> how it must act. Colors, typography, and spacing live in the companion UI Blueprint (not
> included in this repo — see `AGENTS.md`).

---

## 1. Role-aware application shell

| Area | Exporter | Agent | Ops/Admin |
|---|---|---|---|
| **Left navigation** | Overview, Readiness, Markets, Buyers, Deals, Documents, Shipments, Payments, Support | My Day, Exporters, Outreach, Deals, Tasks, Escalations, Payout | Control Tower, Assignments, Exceptions, Compliance/CHA, Finance, Disputes, Audit, Settings |
| **Top bar** | Global search (optional), notifications, assigned-agent shortcut, profile | Search, notifications, SLA counter, profile | Search, exception counter, system/admin actions, profile |
| **Primary CTA** | Contextual next action | Create/follow-up/complete task | Resolve/reassign/escalate |
| **Default density** | Comfortable | Dense | Dense |
| **Mobile expectation** | Core actions fully usable | Read/triage and limited actions; desktop preferred | Emergency read/triage only; desktop preferred |

### Navigation rules

- Navigation must not expose routes the current role cannot access.
- Every object page must support deep linking with a stable ID in the route or route state.
- Breadcrumbs are required once inside a Deal, Exporter 360, Buyer Lead, or Ops exception context.
- Unsaved form changes require navigation protection: warn before leaving unless autosave is
  explicitly enabled.
- The UI should remember sensible table filters per user, but provide a visible **Reset filters**
  action.

---

## 2. Universal status semantics

Six independent status layers appear throughout the product. **Never collapse two of these into
one chip** — e.g., a document that's "Generated" is not automatically "Approved," and "SLA:
Overdue" is not the same signal as "Risk: Blocked."

| Layer | Values | UI rule |
|---|---|---|
| **Journey** | Onboarding / Ready / Market selected / Buyer engaged / Deal locked / Docs cleared / Shipped / Payment realized | Progress rail; do **not** derive solely from the last page visited |
| **Task** | Not started / In progress / Waiting / Done / Cancelled | Owner and due date visible wherever the task appears |
| **Risk** | Normal / Watch / At risk / Blocked | Persistent badge + reason; Blocked requires an owner and a remediation task |
| **SLA** | On time / Due soon / Overdue / Escalated | Agent/Ops sort by urgency; exporter sees human-readable urgency only when relevant |
| **AI document** | Queued / Processing / Generated / Failed | Generation state is separate from approval/filing |
| **Approval** | Pending / Agent reviewed / Exporter approved / Changes requested / Rejected | Do not collapse into "complete" |
| **External execution** | Draft / Ready / Submitted/Filed / Accepted / Rejected | External reference/evidence shown when submitted |

---

## 3. Common components

These are the reusable building blocks every screen spec references by name.

| Component | Required behavior |
|---|---|
| `StatusChip` | Label + semantic color + accessible text. Color may **not** be the only status cue |
| `NextActionCard` | Action title, owner, due date, urgency, deep-link CTA, optional blocker |
| `MetricCard` | Label, value, comparison/secondary text; skeleton while loading |
| `DataTable` | Server-side pagination where datasets are large; sort, filters, empty state, row actions, mobile fallback |
| `ActivityTimeline` | Material events only; actor, timestamp, action, object link, visibility |
| `FileUploader` | Drag/drop + browse, type/size validation, progress, scan status, retry, preview |
| `ApprovalPanel` | Current version, generated/reviewed state, approver identity, approve/request-changes |
| `RiskBanner` | Persistent reason + owner + remediation + timestamp |
| `SideDrawer` | Use for quick inspect/edit; do **not** hide complex multi-step flows inside a drawer |
| `ConfirmDialog` | High-risk mutations only; state the exact consequence |
| `Toast` | Transient success/info only; errors that block progress must remain visible in context |
| `Skeleton` | Mirror the final layout; avoid generic full-page spinners for page-level loads |

---

## 4. Forms & validation

- Validate on blur for format errors, and on submit for business rules; avoid aggressive
  validation while the user is still typing.
- **Server remains authoritative.** Map backend field errors to the correct control and show a
  non-field summary when needed.
- Required fields use explicit labels; placeholders are examples, not labels.
- Money always stores/displays currency. Quantities always pair with a unit. Dates display
  timezone/context where ambiguity matters.
- Destructive actions require explicit confirmation, and should be soft-delete/archive where
  business history matters.
- For long forms, autosave drafts only when the backend supports version-safe drafts; show
  "Saved" / "Saving" / "Save failed" state.

---

## 5. Tables, search & filters

| Rule | Requirement |
|---|---|
| Pagination | Server-side pagination for Buyers, Leads, Deals, Tasks, Audit, and other potentially large collections |
| Search | Debounce 250–400ms; Enter triggers immediately; retain query in URL when practical |
| Filtering | Chips/controls for stage, country, owner, SLA, risk, date range; multiple filters combine predictably |
| Sorting | One obvious default sort; preserve server sort semantics. Agent task views default to urgency + due date |
| Column customization | Later enhancement, except dense agent/ops tables where hide/show may materially help |
| Bulk actions | Only for safe, homogenous actions. Never bulk-approve commercial or compliance-critical records without explicit design |
| Empty state | Explain why it's empty and provide the next useful action; distinguish "no data yet" from "filters returned zero" |

---

## 6. Files & previews

| Requirement | Specification |
|---|---|
| Upload types | At minimum PDF and common images for evidence; document-specific templates may accept XLSX/CSV/DOCX where the product requires. Backend is the source of truth for allowed types |
| Size limit | Configurable by backend; UI renders the returned `max_size_mb`. Recommended default 25 MB per file unless infrastructure policy differs |
| Security | Virus/malware scan before making a file available; authorization required for every download/preview |

(Files rendered/downloaded anywhere in the product must go through short-lived signed URLs — see
`docs/10-non-functional-requirements.md` §Security & privacy.)

---

## 7. Global states

Every screen needs explicit handling for each of these — not just the happy path.

| State | Required UI response |
|---|---|
| Initial loading | Layout skeleton; prevent duplicate submissions |
| Background job running | Non-blocking progress indicator + status; user may navigate away and return |
| Partial data | Render available sections; mark the unavailable module and offer retry |
| Network failure | Persistent inline error for critical content + Retry. Preserve unsaved user input where possible |
| 403 | Human-readable no-access page; do **not** leak object existence/details |
| 404 | Not found or unavailable; provide a safe return path |
| 409 conflict | Explain that the record changed; refresh/reload latest; do **not** silently overwrite |
| 429 / rate limit | Back off; show retry timing if returned |
| 5xx | Stable error surface with a correlation/reference ID if available |
| Maintenance | Feature-level maintenance state preferred over whole-app outage when possible |

These states map directly to the error-code table in `docs/09-api-platform-contract.md` — build
the handling once, generically, rather than per-screen.
