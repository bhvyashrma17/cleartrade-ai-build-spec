# 00 — Design System & Visual Language

Source: **ClearTrade AI Interface Architecture / UI Blueprint** (the companion document the PRD
refers to). This is the *visual and interaction* layer; the PRD (`docs/01`–`docs/12`) is the
*behavioral* layer.

> **Precedence rule, straight from the PRD:** if a visual treatment here conflicts with a workflow
> rule in the PRD docs, **preserve the workflow rule and update the visual treatment.** Known
> conflicts are catalogued in `docs/13-blueprint-reconciliation.md`.

---

## 1. Design direction

**Enterprise trust + startup speed.** Clean, restrained, high-information density where needed.
Deep navy for seriousness and compliance credibility; teal for action and forward motion.

The three portals share one design system but differ in density:

| Portal | Density | Rationale |
|---|---|---|
| Exporter | Medium / comfortable | First-time exporters; reduce cognitive load |
| Agent | Compact, table-friendly | High-throughput operations console |
| Ops | Compact, table-friendly | Portfolio-wide monitoring and governance |

---

## 2. Color tokens

Hex values below were sampled directly from the Blueprint's swatch artwork, so they are exact
rather than approximated from the color names.

| Token | Hex | Role |
|---|---|---|
| `--color-primary` (Navy) | `#0B1739` | Deep navy — trust, compliance, serious B2B tone. Top bar, headings, table headers |
| `--color-action` (Teal) | `#14B8A6` | Primary buttons, progress, positive interaction, active accents |
| `--color-info` (Cyan) | `#27C2E8` | Neutral information and **AI assistance** cues |
| `--color-warning` (Amber) | `#F59E0B` | Due soon / attention / partial risk |
| `--color-critical` (Red) | `#EF4444` | Blocked / overdue / compliance risk |
| `--color-accent` (Purple) | `#7C3AED` | Reserved accent (used sparingly; no assigned semantic role in the Blueprint) |
| `--color-surface-raised` | `#132654` | Navy variant used for table header bars |
| `--color-surface-muted` | `#F4F7FB` | Very light blue-gray — page section/card background |
| `--color-surface` | `#FFFFFF` | White cards |

Supporting neutrals (borders, secondary text) are described in the Blueprint as "subtle borders"
and light blue-gray without exact values — derive a neutral ramp from `#0B1739` at low opacity
rather than introducing an unrelated gray.

### Semantic mapping to the status system

The PRD defines status *values*; this maps them to *color*. Remember the accessibility rule from
`docs/03-global-ux-contract.md`: **color may never be the only status cue** — always pair with a
label and/or icon.

| Status | Token |
|---|---|
| Normal / On time / Done / Approved / Cleared | Teal `#14B8A6` |
| Informational / AI-generated / Processing | Cyan `#27C2E8` |
| Watch / Due soon / Waiting / Partial | Amber `#F59E0B` |
| At risk / Blocked / Overdue / Rejected / Escalated | Red `#EF4444` |
| Neutral / Not started / Not applicable | Navy at reduced emphasis |

### AA-safe text tokens for semantic colors

The four hues above are tuned as **fills and accents**, not as small text. Measured as text on
`--color-surface` (white), each falls below WCAG AA's 4.5:1: teal 2.49:1, cyan 2.42:1, amber
2.15:1, red 3.76:1. A full-app contrast sweep (721 rendered text nodes) found 55 failures from
exactly this — teal links, amber/red `StatusChip` labels — because the raw palette value was being
used as a text color.

Use these instead anywhere a semantic hue carries **words**; keep the raw palette tokens above for
fills, borders and icons, where the pairing label supplies the required contrast per docs/03 §2.

| Token | Formula | On white | On `--color-surface-muted` |
|---|---|---|---|
| `--color-action-text` | `color-mix(in srgb, var(--color-action) 55%, var(--color-primary))` | 5.87:1 | 5.46:1 |
| `--color-info-text` | `color-mix(in srgb, var(--color-info) 55%, var(--color-primary))` | 5.18:1 | 4.82:1 |
| `--color-warning-text` | `color-mix(in srgb, var(--color-warning) 55%, var(--color-primary))` | 5.46:1 | 5.08:1 |
| `--color-critical-text` | `color-mix(in srgb, var(--color-critical) 55%, var(--color-primary))` | 8.25:1 | 7.68:1 |

55% hue / 45% navy was chosen as the lightest (most saturated, most identifiable) blend that still
clears 4.5:1 on both backgrounds the design system actually composites text over.

`StatusChip`'s tint itself was a separate bug, not a contrast tuning issue: `bg-warning/10` and
`border-warning/25` compiled to fully transparent / default-grey because Tailwind cannot apply an
alpha modifier to a bare `var()` color (see `AGENTS.md` cross-cutting rules). The chip labels are
now navy on a `color-mix()` tint.

### Icons are graphical objects — WCAG 1.4.11, a flat 3:1

The chip icon originally kept the full-saturation hue on the reasoning that it is always paired
with a label. That reasoning covers **1.4.1 (color is not the only cue)** but not **1.4.11 (non-text
contrast)**, which requires any meaningful graphic to clear **3:1 against its own backdrop**, with
no large-size relaxation. The icon's backdrop is the chip's 12% tint *of the same hue*, which is
close to the worst case: the tint pulls the background toward the foreground.

Measured on the composited tints (`scripts/verify-contrast.ts`, which now samples SVG `stroke`/`fill`
as well as text):

| Tone | Raw hue on its tint | With `--color-*-text` |
|---|---|---|
| positive (teal) | 2.08:1 ✗ | 4.88:1 |
| info (cyan) | 1.92:1 ✗ | 4.73:1 |
| warning (amber) | 1.96:1 ✗ | 4.97:1 |
| critical (red) | 3.23:1 (passed) | 7.09:1 |

Icons now use the same `--color-*-text` tokens as the labels. **Rule: a semantic hue never paints a
glyph directly — text and icon both go through the `*-text` token.** The raw palette values remain
correct for fills, borders and large decorative areas.

> Two measurement traps found while verifying this, both of which silently *understate* a failure:
> a text-node crawler cannot see icons at all (their color is `stroke`/`fill`, not `color`, and they
> have no font size), and Chrome serialises a `color-mix()` result as `color(srgb r g b / a)`, so an
> `rgba()`-only parser reads tinted surfaces as `null` and walks past them to the opaque parent —
> reporting icons as sitting on plain white.

### `--color-text-muted`

Raised from **0.48 to 0.64** navy opacity. At 0.48 it composited to `rgb(138,144,160)` on white —
3.19:1, below AA. It had been treated as safe on the assumption it only ever labeled de-emphasized
metadata, but the same sweep found it carrying journey-rail stage labels, `MetricCard` secondary
text and an Ops KPI drill-down link — all essential, not decorative. 0.64 gives 5.35:1 on white and
5.20:1 on `--color-surface-muted`, while staying visibly lighter than `--color-text-secondary`
(0.70, 6.59:1) so the two remain distinguishable.

---

## 3. Typography, radii, iconography

| Token | Value |
|---|---|
| Font family | **Inter** or a similar modern sans |
| Body (web) | 14–16px |
| Headings | 20–28px, strong weight |
| Border radius | 6–10px — avoid overly playful, pill-heavy design |
| Icons | Simple line icons **with labels**; never rely on icons alone |

---

## 4. Layout structure

Confirmed from the Blueprint's dashboard wireframe:

```
┌────────────────────────────────────────────────────────────┐
│  ClearTrade AI                          [navy top bar]     │
├──────────────┬─────────────────────────────────────────────┤
│              │  Good morning, Exporter                     │
│  Overview ◄  │  ● Ready ─ ● Market ─ ● Buyers ─ ○ Deal …   │  ← journey rail
│  Readiness   │  ┌─────────┐ ┌─────────┐ ┌─────────┐        │
│  Markets     │  │Readiness│ │ Active  │ │Open deal│        │  ← MetricCard row
│  Buyers      │  │ 82/100  │ │ buyers  │ │ INR 37L │        │
│  Deals       │  └─────────┘ └─────────┘ └─────────┘        │
│  Documents   │  ┌──────────────────────┐ ┌──────────────┐  │
│  Shipment    │  │ Next actions         │ │ Deal pipeline│  │  ← 2-col, primary wider
│  Payments    │  │ • Upload certificate │ │ Contacted 14 │  │
│  Support     │  │ • Review 5 buyers    │ │ Interested 5 │  │
│              │  └──────────────────────┘ └──────────────┘  │
└──────────────┴─────────────────────────────────────────────┘
   left nav          light blue-gray page bg, white cards
```

- **Top bar:** navy, product name left, utility actions right.
- **Left nav:** light surface; active item rendered as a raised white card.
- **Content:** page greeting/title → journey rail → metric row → two-column module grid.
- **Journey rail:** filled dots for completed/current stages, hollow for future, connected by
  a line. Future stages are non-actionable (PRD rule).

### Mobile

Exporter mobile uses **bottom navigation**: Home · Deals · Tasks · Messages · More.

Market research and dense buyer tables should remain *available* on mobile, but the mobile
experience is optimized for **approvals, uploads, messaging, tracking and task completion**.

---

## 5. Reusable component library

The Blueprint names these components explicitly. Where the PRD names the same concept
differently, both names are given — pick one and use it consistently across the codebase.

| Component | Purpose | PRD equivalent |
|---|---|---|
| `JourneyProgress` | Top progress rail across the 8 journey stages | (journey rail) |
| `NextActionCard` | Prioritized action with owner, due date, deep link | `NextActionCard` |
| `StatusBadge` | Status label + semantic color + text | `StatusChip` |
| `RiskBadge` | Persistent risk state with reason | part of `RiskBanner` |
| `OwnerChip` | Accountable owner display | — |
| `Deadline/SLA chip` | Due date + SLA urgency | — |
| `BuyerCard` | Buyer identity, fit score, verification, activity | — |
| `MarketScoreCard` | Country, opportunity score, subscores | `MarketScoreCard` |
| `DealHeader` | Buyer, product, stage, value, agent, risk | — |
| `DealTimeline` | Deal milestone progression | — |
| `TaskRow` | Task with owner, due, state, priority | — |
| `ApprovalPanel` | Approve / request changes with version context | `ApprovalPanel` |
| `DocumentRow` | Doc type + 4 independent status chips + CTA | — |
| `MessageThread` | Exporter-visible conversation | — |
| `InternalNote` | Internal-only note — **must be visually unmistakable** | — |
| `ShipmentMilestone` | Milestone with ETA vs. actual | — |
| `PaymentMilestone` | Payment stage with provenance label | — |
| `ExceptionCard` | Exception with type, owner, age, remediation | — |
| `AuditEvent` | Actor + action + object + timestamp | — |

PRD-only components also required: `MetricCard`, `DataTable`, `ActivityTimeline`, `FileUploader`,
`SideDrawer`, `ConfirmDialog`, `Toast`, `Skeleton` (see `docs/03-global-ux-contract.md`).

---

## 6. Interaction patterns

| Pattern | Rule |
|---|---|
| Primary CTA | **One** primary action per card/section. Avoid multiple equally loud buttons |
| Empty states | Explain what the section is for **and** the next action to populate it |
| Blocked states | Always show reason, owner, next action and escalation path |
| AI output | Label as AI-generated; show confidence/source context when material |
| Approvals | Explicit "Approve" / "Request changes" — never an ambiguous "Done" |
| Uploads | Show required vs. optional, accepted types, last uploaded file, reviewer status |
| Technical terms | Plain-language label first; technical term in helper text |
| Destructive actions | Reason + confirmation + audit trail |
| Success messages | Confirm what changed **and** what happens next |

---

## 7. Microcopy — status language

The Blueprint is emphatic that generic system states are a UX failure in this domain. Replace
machine language with a statement of *who owes what*:

| Don't write | Write instead |
|---|---|
| "Pending" | "Waiting for exporter approval" |
| "Error" | "Shipping Bill draft is missing AD code" |
| "Processing" | "Agent is reviewing your Packing List" |
| "Done" | "Filed with customs — reference captured" |

This is a **product requirement, not a copy preference** — it's how the PRD's "who owns the next
action?" success condition is satisfied at the UI level.

---

## 8. Product principles (design intent)

The eight principles the interface must express:

1. **Guided, not menu-heavy** — journey strip + next-actions queue always visible.
2. **Progressive disclosure** — no customs jargon until relevant; expandable technical detail.
3. **One deal = one workspace** — messages, pricing, tasks, documents, shipment, payment, disputes
   all live inside the Deal Workspace.
4. **Human + AI is explicit** — show what AI generated, what the agent reviewed, what the exporter
   approved.
5. **Exceptions are first-class** — blocked docs, missing certification, buyer risk, late payment
   and CHA issues get visible states, owners and SLAs.
6. **Status over activity** — surface milestones, required actions, risk and deadline changes; not
   a noisy feed.
7. **Reuse exporter memory** — prefill product, buyer, packaging, document and routing data for
   repeat shipments.
8. **Mobile-aware, desktop-first** — agents need dense desktop workflows; exporters must be able to
   approve, upload, message and track from a phone.

---

## 9. Prototype before full frontend

The Blueprint recommends validating navigation and state transitions with clickable high-fidelity
prototypes of **six critical screens** before engineering every page:

1. Exporter Dashboard (EXP-01)
2. Readiness (EXP-02)
3. Demand Discovery (EXP-04)
4. Buyer Discovery (EXP-06)
5. Agent Command Center (AGT-01)
6. Deal Workspace (EXP-09)
