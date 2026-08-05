# 10 — Non-Functional Requirements

Source: PRD Part 09.

---

## 1. Security & privacy

- Use a secure session/authentication implementation appropriate to the stack. Sensitive
  auth/session material should not be exposed to frontend JavaScript unnecessarily.
- **Enforce organization and assignment scope on every server request** — including file downloads
  and search endpoints. (These two are the most commonly missed.)
- Use short-lived signed URLs or authorized file streaming for export documents, bank proofs,
  IDs/certificates and dispute evidence.
- Encrypt data in transit and at rest per infrastructure policy. **Do not log secrets, document
  contents or payment evidence** in application logs.
- Rate-limit auth and high-cost AI/discovery/document-generation endpoints.
- Use CSRF protection where relevant to the auth architecture; set secure cookie attributes where
  cookies are used.
- Virus/malware scan uploads **before** downstream consumption.
- Admin/config/finance mutations should support stronger permission checks and, where appropriate,
  **step-up confirmation**.
- Account deletion/data retention policy must be defined separately. The UI must **not hard-delete
  trade records** that legal/audit policy requires retaining — soft-delete/archive instead.

---

## 2. Performance targets

| Surface | Target / behavior |
|---|---|
| App shell | Interactive quickly on normal broadband; cache static assets aggressively |
| Typical data page | Aim p75 under ~2.5s meaningful render; skeleton immediately |
| Table filter/search | Aim response under ~1.5s for typical queries; debounce text search |
| Mutation feedback | Immediate disabled/submitting state; success/error surfaced promptly |
| AI / discovery / docs | Async jobs; **never rely on a >30s browser request** |
| Large documents | Lazy preview/pages; do not load a full oversized PDF into memory if avoidable |
| Dashboard | Parallel module requests or one aggregate endpoint; **one failed card must not blank the whole page** |

The dashboard rule is an acceptance criterion in its own right (EXP-01-AC05): each module needs
independent loading, empty and failure states.

---

## 3. Responsive contract

| Breakpoint | Exporter | Agent | Ops |
|---|---|---|---|
| **Mobile** (<768) | Full task/approval/upload/message/track use. Tables become cards or horizontal-safe patterns | Triage, message, task completion, lead review; advanced dense CRM may prompt desktop | Read/critical exception triage only; no promise of full configuration |
| **Tablet** | Full exporter | Most agent workflows usable with reduced columns | Read and simple resolution usable |
| **Desktop** | Full | **Primary experience** — dense tables/drawers | **Primary experience** |

### Mobile priority order for an exporter deal

When space is constrained, this is the required stacking order:

1. Risk/blocker banner
2. Current stage + next action
3. Approval/task CTA
4. Agent/message
5. Key commercial/shipment/payment summary
6. Secondary history and analytics

Exporter mobile navigation is a **bottom bar**: Home · Deals · Tasks · Messages · More
(see `docs/00-design-system.md`).

---

## 4. Accessibility minimums

- Keyboard-operable navigation, dialogs, tabs, menus and form controls; **visible focus indicator**.
- Semantic headings and labels; tables have header semantics; **status is not conveyed by color
  alone**.
- Text contrast targets **WCAG AA** for normal text; error/warning states include icons/text labels
  in addition to color.
- Dialog focus trap and return focus on close; consistent Escape behavior.
- Form errors associated with controls and summarized for screen-reader navigation.
- File upload progress/status announced where feasible; buttons have descriptive accessible names.
- **Charts must have a textual/table equivalent for critical decision data.**

The "never color alone" rule interacts directly with the status system in
`docs/03-global-ux-contract.md` and the palette in `docs/00-design-system.md` — every `StatusChip`
needs a text label, and ideally an icon, not just a teal/amber/red fill.

---

## 5. Localization, currency & dates

- **English first**, but externalize UI strings so Hindi/other languages can be added without
  rebuilding layouts.
- **Money:** always show currency code/symbol and use locale-aware formatting. **Do not assume INR**
  for buyer/deal values — buyers are overseas and deals are frequently in USD/EUR/AED.
- **Countries:** ISO-based canonical codes; avoid free-text country identity.
- **Dates:** use `dd MMM yyyy` in the English UI for clarity; timestamps show local timezone or an
  explicit timezone. Store UTC server-side where appropriate.
- **Domain terms:** Incoterms, HS codes and regulatory terms are domain labels and should **not be
  translated incorrectly**. Pair jargon with plain-language help (progressive disclosure).

> This last point connects to the microcopy rules in `docs/00-design-system.md`: plain-language
> label first, technical term in helper text. "Certificate of Origin" before "COO"; "customs
> documents submitted" before "ICEGATE filing reference."
