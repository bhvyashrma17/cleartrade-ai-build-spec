# 09 — Frontend ↔ Backend Contract

Source: PRD Part 08. Technology-neutral: these are behavioral requirements the API must satisfy
regardless of language, framework, or transport choice.

---

## 1. API behavior expectations

| Concern | Requirement |
|---|---|
| **Identity** | Every response/action is scoped by authenticated user and server-side authorization |
| **Resource IDs** | Stable opaque IDs; do **not** use mutable display names as identifiers |
| **Pagination** | Cursor or page pagination with total/count where practical; consistent across large lists |
| **Filtering/sorting** | Server accepts explicit supported fields; an invalid field returns a structured 4xx |
| **Validation** | 422/400 identifies field errors **and** non-field business-rule errors |
| **Conflicts** | 409 for stale version/invalid concurrent update; include a current-version hint if possible |
| **Idempotency** | Create/pay/approve/generate-like mutations that can be double-submitted must accept an idempotency key or otherwise deduplicate |
| **Time** | ISO-8601 server timestamps; timezone explicit |
| **Money** | `amount` + `currency`, ideally minor units or precise decimal; **never JS floating-point assumptions** |
| **Units** | Quantity + unit; no hidden unit conventions |
| **Files** | Return file metadata + a secure preview/download action; **never a raw public bucket URL** |
| **Errors** | Stable `error_code` + human message + field errors + `correlation_id` |

---

## 2. Recommended response envelope

| Case | Shape expectation |
|---|---|
| Success (single) | `data: resource`; `meta` optional |
| Success (list) | `data: items[]`; `meta`: pagination, filters/sort if useful |
| Async accepted | `job_id` + `status` + resource target/run ID |
| Validation error | `error.code` + `message` + `fields[{field, code, message}]` + `correlation_id` |
| Business rule block | `error.code` (e.g. `DEAL_LOCK_PREREQUISITES_NOT_MET`) + `blockers[]` with object/deep-link hints |
| Conflict | `error.code` (e.g. `VERSION_CONFLICT`) + `current_version` / `current_updated_at` |

**Illustrative shapes** (structure implied by the spec; field naming is a team decision):

```jsonc
// Success — list
{
  "data": [ /* … */ ],
  "meta": { "page": 1, "per_page": 25, "total": 143, "sort": "due_at:asc" }
}

// Async accepted (202)
{
  "job_id": "job_01H…",
  "status": "queued",
  "target": { "type": "discovery_run", "id": "run_01H…" }
}

// Business rule block — the blockers[] array is what powers the UI
{
  "error": {
    "code": "DEAL_LOCK_PREREQUISITES_NOT_MET",
    "message": "This deal cannot be locked yet.",
    "blockers": [
      { "object_type": "document", "object_id": "doc_…",
        "reason": "Proforma Invoice awaiting exporter approval",
        "deep_link": "/app/deals/deal_…/documents/doc_…" }
    ]
  },
  "correlation_id": "req_01H…"
}

// Conflict
{
  "error": { "code": "VERSION_CONFLICT", "message": "This proposal changed since you opened it." },
  "current_version": 4,
  "current_updated_at": "2026-08-05T09:31:00Z",
  "correlation_id": "req_01H…"
}
```

The `blockers[]` pattern matters: it's what lets the UI render *"you can't do this yet, and here's
exactly what to fix, with a link"* instead of a dead-end error. Several acceptance criteria depend
on it (EXP-12-AC05, AGT-06-AC01).

---

## 3. Background jobs

Demand Discovery, Buyer Discovery refresh/enrichment, document generation and some report/export
operations may exceed an interactive request time. **Treat them as jobs — never hold a browser
request open.**

| Job state | UI behavior |
|---|---|
| `queued` | Show queued; allow the user to leave the page |
| `processing` | Progress text/percent if reliable; otherwise an activity indicator + `started_at` |
| `completed` | Fetch/render result; notification optional |
| `partial` | Render successful records + clearly mark missing/failed segments |
| `failed` | Show a human-safe error, correlation ID, and Retry if safe |
| `cancelled` | Only if the job supports cancellation; result not current |

**Async requirements:**

- Job status must **survive refresh and login on another device**.
- The frontend may poll with backoff or use a real-time transport — the implementation choice is
  secondary to **durable job state**.
- Retry creates a new attempt or a documented retry state; **never silently overwrite a historical
  successful result**.
- User action buttons are disabled/idempotent while an equivalent job is already active.

> Performance target: never rely on a >30s browser request for AI/discovery/document operations
> (see `docs/10-non-functional-requirements.md`).

---

## 4. Error codes

| Code | UI action |
|---|---|
| `VALIDATION_ERROR` | Map to fields + top summary |
| `FORBIDDEN` | Safe no-access page / inline action denial |
| `NOT_FOUND` | Safe not-found; **do not leak an inaccessible record** |
| `VERSION_CONFLICT` | Refresh latest + preserve unsaved draft where feasible |
| `DUPLICATE_LEAD` | Open the existing lead |
| `DUPLICATE_DEAL` | Open the existing deal |
| `PREREQUISITES_NOT_MET` | Render blockers with deep links |
| `JOB_ALREADY_RUNNING` | Attach to / show the existing job |
| `FILE_TYPE_NOT_ALLOWED` | Explain allowed types |
| `FILE_TOO_LARGE` | Show backend max size |
| `FILE_SCAN_FAILED` | Quarantine + re-upload/support |
| `EXTERNAL_PARTNER_ERROR` | Show retry/waiting state; **do not expose secrets** |
| `RATE_LIMITED` | Backoff / retry timing |
| `INTERNAL_ERROR` | Stable message + correlation ID |

Build this handling **once, generically** in the API client layer rather than per-screen — the
global states table in `docs/03-global-ux-contract.md` maps 1:1 onto these codes.

---

## 5. Endpoint surface (derived)

The PRD does not enumerate endpoints, but the screen specs and domain model imply the following
resource surface. Treat this as a **starting point to confirm**, not spec text:

| Resource | Notable operations |
|---|---|
| `/exporter-orgs` | read, update allowed fields, team invite |
| `/products` | CRUD within org |
| `/readiness-assessments` | create (async job), read, history |
| `/discovery-runs` | create (async), read status, list |
| `/market-assessments` | list by run, read, save, select |
| `/buyers` | search (server-side filter/paginate), read |
| `/buyer-leads` | create (idempotent), list, read, stage transition, disqualify, convert |
| `/deals` | create, list, read, stage transitions, lock, clone-for-repeat |
| `/deals/:id/proposals` | create version, send for approval, approve, request changes |
| `/tasks` | list (server filters/views), create, transition, escalate |
| `/documents` | generate (async), list, read version, approve, request changes, upload, signed download |
| `/shipments` | read, milestone update, exception |
| `/payments` | read, status update with evidence, BRC status |
| `/insurance-cases` | create/quote request, read |
| `/disputes` | create, list, read, transitions, resolution |
| `/messages` | threaded, visibility-aware |
| `/notifications` | list, mark read, preferences |
| `/assignments` | assign, reassign, history |
| `/exceptions` | list, assign, severity, resolve |
| `/fees`, `/payouts` | read, state transitions (finance role) |
| `/audit-events` | search only, read-only |
| `/config` | versioned read; admin-only write |
| `/jobs/:id` | universal job status polling |

**Every one of these must enforce tenant/assignment scope server-side** — including search
endpoints and file downloads, which are the two most commonly missed.
