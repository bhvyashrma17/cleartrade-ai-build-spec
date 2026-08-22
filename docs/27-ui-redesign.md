# ClearTrade — UI Redesign

Derived from `brand-logo.svg` and `docs/ui-audit.md`. This supersedes the palette and type
sections of `docs/00-design-system.md`. Behavioural rules in `docs/03-global-ux-contract.md`
are unchanged — this is a visual layer, and where the two conflict, the workflow rule wins.

---

## 1. Diagnosis — why it reads bland and unfinished

Not opinion. These are the audit's own numbers.

| Symptom | Evidence | Consequence |
|---|---|---|
| **No typographic hierarchy** | `text-sm` 725 + `text-xs` 697 = 1,422 of 1,595 type classes (89%). `text-3xl` 2, `text-4xl` 1 — across the entire product. | Every page is a uniform field of 12–14px text. Nothing leads the eye. This is the single largest cause of "bland." |
| **Everything is emphasised** | `font-medium` 424, `font-semibold` 284, `font-normal` **22**. | Body copy is set in a UI weight. When everything is semi-bold, nothing reads as important. |
| **No elevation** | `shadow-card` 167, `shadow-raised` **2**. | All surfaces sit on one plane. No depth, no focus. |
| **The palette is unused** | `primary` 896, `surface` 465 — but `action` 20, `warning` 3, `info` 1, `accent` **0**. | The product is monochrome navy-on-grey in practice. The "colour selection" problem is that there effectively isn't one. |
| **Spacing is ad hoc** | 38 distinct padding values, 26 margin values, 13 gaps. `mt-1` alone 367 times. | Spacing is applied per-element rather than by layout rhythm. This is the "unfinished" feeling, precisely. |
| **Two of everything** | Two card treatments, two empty states, two button implementations, two table implementations. `DataTable` is imported by **0 pages**; every Ops/Agent queue hand-rolls a `<table>`. | Inconsistency reads as unfinished even when each instance is fine. |
| **Token bypasses** | `bg-red-50` in 4 files. `var(--color-danger)` referenced 5× and **never defined**. | Small, but they're the visible cracks. |
| **Untested dark mode** | `prefers-color-scheme` block remaps `--color-surface` to navy `#132654`. | On a user's dark-set machine the navy topbar sits on navy cards. Either build it properly or delete it. |

**And the root cause:** the design system was written from the Blueprint before the brand existed.
Navy `#0B1739` and teal `#14B8A6` appear nowhere in the logo. The product is wearing someone
else's identity.

---

## 2. Brand foundation

From `brand-logo.svg`, verbatim:

| | Value | Role in the mark |
|---|---|---|
| Bone | `#EFE9E9` | The mark and the "ClearTrade" wordmark. Warm off-white. |
| Slate | `#9B9EA7` | The tagline "Structured exports. Zero Chaos." Cool grey, blue cast. |

Two structural facts:

- **The mark is light on dark.** It is a bone square frame containing a nested open "C", with
  registration ticks at the cardinal points. It reads as a customs stamp, a die, a seal — an
  instrument of record. Not a tech logo.
- **The wordmark is a high-contrast serif.** Editorial, institutional, and completely absent from
  the current UI.

**Design thesis, taken straight from the tagline:** the interface must *feel* structured.
Alignment, rhythm and restraint are the brand promise being kept. Every ad hoc margin is the
brand promise being broken.

---

## 3. Colour

### 3.1 The inversion

The instinct is warm cream + serif. Resist it — that combination is the current house style of
every AI-generated site, and it would make a distinctive brand look generic.

Instead, invert: **cool light surfaces, warm dark chrome.** Bone is reserved for where the mark
lives — the dark top bar, dark panels, the logo. The light surfaces take their cast from slate.
This is a genuine system rather than a mood, and it makes the dark chrome feel deliberate instead
of like a default navy header.

### 3.2 Foundation

```css
/* Brand — verbatim from the mark. Do not adjust. */
--bone:            #EFE9E9;   /* text and marks on dark surfaces */
--slate:           #9B9EA7;   /* the neutral the light ramp descends from */

/* Ink — near-black, faintly cool so bone reads warm against it */
--ink-900:         #15171B;   /* top bar, dark panels, primary buttons */
--ink-700:         #24272E;   /* dark panel raised */
--ink-500:         #4A4E58;   /* body text */
--ink-300:         #6E7380;   /* secondary text */
--ink-200:         #9B9EA7;   /* = slate. Muted text, strong borders */

/* Paper — cool light ramp */
--paper:           #F4F5F7;   /* page background */
--paper-sunk:      #EDEFF3;   /* wells, table headers, inset areas */
--card:            #FFFFFF;   /* card and panel surface */
--line:            #E2E5EA;   /* default border */
--line-strong:     #CBD0D8;   /* emphasised border, dividers */
```

Text contrast on `--card` (#FFFFFF): ink-900 16.9:1, ink-500 8.1:1, ink-300 4.9:1, ink-200 3.1:1.
`--ink-200` is **decorative and border-only** — never body text. That is the same trap the current
`--color-text-muted` fell into at 0.48 alpha; it is written into the token name here so it cannot
recur.

### 3.3 Seal — the one accent

Trade documents, customs stamps and notarial seals are traditionally struck in aniline violet.
The mark already reads as a die. The accent is therefore not arbitrary — it is the ink of official
documents, which is exactly what this product produces.

```css
--seal-600:        #4B3FAE;   /* links, focus ring, active nav, the frame device */
--seal-500:        #5C51C4;   /* hover */
--seal-tint:       color-mix(in srgb, var(--seal-600) 8%, var(--card));
```

**Used sparingly and never as a status.** Roughly 2% of any screen.

### 3.4 Status — the only other colour

Primary actions are **ink, not seal, not a status hue**. This matters: it means colour in this
product always carries meaning, never decoration. Buttons don't compete with warnings.

Each status has a **fill** (icons, tints, borders) and a **text** value that clears AA on both
`--card` and `--paper`.

```css
--ok-fill:   #12805A;  --ok-text:   #0B6344;   /* cleared, approved, on time */
--info-fill: #0E7490;  --info-text: #0A5A70;   /* AI-generated, processing, informational */
--warn-fill: #B45309;  --warn-text: #8A4008;   /* due soon, watch, partial */
--crit-fill: #C0271D;  --crit-text: #9B1F17;   /* blocked, overdue, rejected */
```

Info is cyan-teal, deliberately far from seal violet so the two never read as the same signal at
12px.

Tints via `color-mix(in srgb, var(--x-fill) 8%, var(--card))`. **Never `bg-x/8`** — Tailwind alpha
modifiers fail silently on bare `var()` colours, which is how `StatusChip` tints rendered fully
transparent for months.

### 3.5 What to delete

- `--color-accent: #7C3AED` — 0 uses. Replaced by seal.
- The `prefers-color-scheme` block — untested and would break the top bar.
- `--color-danger` — referenced 5×, never declared. Fix the call sites to `--crit-text`.
- `bg-red-50` in the 4 files that use it.

---

## 4. Type

### 4.1 Three faces, three jobs

| Role | Face | Used for |
|---|---|---|
| **Display** | The logo's serif. Identify the exact face from the source file; if it isn't web-licensed, **Instrument Serif** is the closest available match. | Page titles and the landing hero **only**. Never UI chrome, never inside cards. |
| **Interface** | **Inter** (already in place) | Everything else. |
| **Record** | **IBM Plex Mono**, tabular figures | Every instrument of record — see 4.3. |

The serif's restraint is the point. It appears once per page, at the top, and nowhere else. That
is what makes it read as a masthead rather than a theme.

### 4.2 Scale

The current scale is 89% two sizes. This one has a real ladder.

| Token | Size / line / weight | Face | Use |
|---|---|---|---|
| `display` | 44 / 1.05 / 600, `-0.02em` | Serif | Landing hero only |
| `title-page` | 30 / 1.15 / 600, `-0.015em` | Serif | Page `h1` |
| `title-section` | 21 / 1.3 / 600 | Inter | Section `h2` |
| `subtitle` | 17 / 1.4 / 600 | Inter | Card `h3` |
| `body` | 15 / 1.55 / **400** | Inter | Default paragraph |
| `body-sm` | 13 / 1.5 / 400 | Inter | Dense tables, agent/ops |
| `label` | 11.5 / 1.35 / 600, `0.06em`, uppercase | Inter | Eyebrows, table headers, `dt` |
| `record` | 13 / 1.5 / 400, tabular | Mono | See below |

**The weight change matters as much as the size change.** Body default moves from 500 to 400.
`font-medium` currently appears 424 times against `font-normal` 22 — reversing that default is
what creates hierarchy, at zero layout cost.

### 4.3 Mono is a product decision, not a style

In a trade product, reference numbers *are* the content. Set every one of these in `record`:

HS / ITC-HS codes · bill of lading and AWB numbers · shipping bill numbers · container numbers ·
invoice numbers · LC references · customs and filing references · snapshot hashes and checksums ·
partner handoff references · payout transfer references · correlation IDs · UN/LOCODEs.

There is currently **zero** mono usage in the product. Adding it does more for "purpose-built"
than any amount of colour, and it makes long alphanumerics scannable, which is a real usability
gain for the Moradabad user reading a filing reference off a screen.

---

## 5. Rhythm

### 5.1 One scale, applied at the layout level

Six steps. Nothing else.

```
4 · 8 · 12 · 16 · 24 · 32 · 48 · 64
```

The fix for 38 padding values and 367 `mt-1`s is not discipline — it is removing the opportunity.
Introduce two layout primitives and route spacing through them:

- `<Stack gap="sm|md|lg">` — vertical rhythm. Replaces sibling `mt-*` entirely.
- `<Inset size="sm|md|lg">` — padding. Replaces per-element `p-*`.

Cards get **one** padding value per density mode. Not `p-3`, `p-4`, `p-5`, `p-6` and `p-8`.

### 5.2 Density is a shell property, not a component variant

```
Exporter   body 15px · card inset 24 · table row 52px · stack gap 24
Agent/Ops  body 13px · card inset 16 · table row 36px · stack gap 16
```

Set `data-density="comfortable|compact"` on the shell; components read it. This gives the three
portals visual consistency with genuinely different information density — which is what you asked
for, and what `docs/00` §1 already specified but the code never implemented.

### 5.3 Elevation — three levels, used honestly

| Level | Treatment | For |
|---|---|---|
| `flat` | 1px `--line`, no shadow | Most cards. White on cool paper already reads as raised by value alone. |
| `raised` | `0 1px 2px rgba(21,23,27,.06), 0 4px 12px rgba(21,23,27,.06)` | Active nav item, hovered rows, sticky headers |
| `overlay` | `0 12px 32px rgba(21,23,27,.16)` | Drawers, dialogs, menus |

`shadow-card` on 167 elements is why nothing appears to float. Most cards should lose it.

### 5.4 Radius

`4` inputs and chips · `8` cards and buttons · `12` panels and dialogs · `full` avatars only.

The mark has hard corners; the UI needs a little softness for warmth. 8px is the compromise.
`rounded-xl` (10px) is currently declared and never used — drop it.

---

## 6. The signature: the registration frame

Every design needs one memorable element. This one is already in the logo.

The mark is a **square frame that closes**. The product's core object — a deal — is a sequence
that progresses toward completion. So: **the deal's progress closes the frame.**

```
      ┌── ──┐              ┌── ──┐              ┌─────────┐
     │       │            │       │            │         │
                            │                   │         │
     │       │            │       │            │         │
      └──                  └── ──┘              └─────────┘
     2 of 8 stages        5 of 8 stages         Complete
```

Eight journey stages, eight frame segments, filling clockwise from the top-left. Two forms:

- **Compact glyph** (16px) — in deal tables, the deal header, agent queues. Shows at a glance how
  far a deal has closed, with the label alongside.
- **Expanded rail** — on the dashboard and deal workspace, the same segments drawn wide with stage
  labels beneath. Replaces the current dot rail.

Segments are ink when complete, `--line-strong` when future, **seal** for the current one. This is
the only place seal appears at any size, which is what makes it read as the brand.

It satisfies the rule that structural devices must encode something true: the frame is not
decoration, it is the completion state, and it resolves into the logo when a deal is done.

**Supporting motif, used sparingly:** the mark's registration ticks become the section divider —
a hairline rule with a short thick tick at the left edge. On section headers only, not everywhere.

---

## 7. Components

### 7.1 Consolidate first

Before any restyle. The audit found parallel implementations of five things:

| Kind | Action |
|---|---|
| **Button** | `Button.tsx` exists. Native `<button>` with local classes appears in `BuyersExplorer`, `DemandDiscovery`, `OutreachPipeline`, and most of `components/agent/*` and `components/ops/*`. Migrate all. |
| **Table** | `DataTable.tsx` is imported by **0 pages**. Six Ops/Agent routes hand-roll `<table>` with four different cell paddings. Either adopt `DataTable` or delete it — do not keep both. |
| **Card** | Two treatments (with and without `shadow-card`). One `Card` component, `flat` by default. |
| **Empty state** | Two treatments (bare muted paragraph vs. bordered panel). One `EmptyState` with title, line, and optional action. |
| **Page header** | Agent/Ops render an eyebrow + `h1`; exporter deal tabs start at `h2`; auth pages differ again. One `PageHeader` — eyebrow, title, one-line description. |

### 7.2 Restyle

**StatusChip** — fix the transparent-tint bug via `color-mix`. Icon in `*-fill`, label in
`*-text`, tint background, 1px border at 20% fill. Label and icon always; colour is never the
only cue.

**MetricCard** — currently label 12px + value 24px, all `font-medium`. Change to `label` token
for the caption and **28px/600 Inter, tabular figures** for the value. Numbers are the content;
let them be large. Secondary line in `body-sm`, `--ink-300`.

**DataTable** — header row `label` token on `--paper-sunk`; body `body-sm`; row height per
density; hover `--paper`; 1px `--line` between rows, no zebra. Numeric and reference columns
right-aligned and set in `record`.

**Top bar** — `--ink-900`, 56px, bone wordmark. Add the mark glyph left of the wordmark; it is
currently text-only, which wastes the strongest brand asset you have. Right cluster in bone at
80% opacity.

**Left nav** — on `--paper-sunk`, so the active item's white card actually contrasts. Currently
both are `bg-surface-muted`, which is why the "raised card" active state is invisible. Active:
white, `raised`, with a 2px seal bar at the left edge. Inactive: `--ink-300`, no background.

**Buttons** — primary: `--ink-900` fill, bone text. Secondary: `--card` with `--line-strong`
border, ink text. Danger: `--crit-text` text on `--crit` tint with a `--crit-fill` border, never a
solid red fill. Height 36 comfortable / 32 compact.

**Forms** — 15px input text (currently inherits small), `--line` border, seal focus ring at 2px
with 2px offset. Labels in `label` token. Errors in `--crit-text` with an icon, below the field.

---

## 8. Copy

The audit's microcopy register found the owner-naming rule broken in the places it matters. Fix
these — they are the ones a user actually hits:

| Currently | Should be |
|---|---|
| "Pending" (`agent/deals/[dealId]`, `ops/execution`) | Name the party being waited on |
| "Waiting" (4 sites incl. `TaskActions`) | "Waiting on {party}" |
| "Awaiting deal lock" | "Waiting for the agent to lock the deal" |
| "Nothing waiting to file" | "No documents are ready to file" |
| "Pending invitations" | "Invitations not yet accepted" |

The register also shows the good pattern already exists — "Waiting on an authorized approver",
"Nothing pending on ClearTrade's side" — so this is consistency work, not invention.

**Landing hero.** The current headline is "Find buyers for what you export — before you sign up
for anything." The tagline on your own logo is better and is already yours:

> ## Structured exports. Zero chaos.
> Find your markets and buyers free. When you're ready to ship, a ClearTrade agent handles the
> paperwork, customs, freight and payment with you.

Set the headline in the display serif, the sub in `body` at 17px, and place the frame glyph
mid-completion beside it. That is the thesis, the mark and the product in one view.

---

## 9. Order of work

1. **Tokens** — replace the palette in `globals.css` and `tailwind.config.ts`. Delete the dark
   mode block, `--color-accent`, and fix `--color-danger` call sites. Nothing visual ships yet.
2. **Type** — load the serif and IBM Plex Mono; implement the scale; flip body default to 400.
   This alone will change the product more than anything else on this list.
3. **Consolidate** — one Button, one Card, one EmptyState, one PageHeader, one table. Migrate the
   bypasses. This is the "unfinished" fix and it is mostly deletion.
4. **Shell** — top bar with the mark, nav contrast fix, density attribute.
5. **Frame device** — build `JourneyFrame` in both forms, replace the dot rail.
6. **Mono pass** — route every reference field through the `record` token.
7. **Landing** — rebuild the hero on the thesis.
8. **Copy pass** — the owner-naming fixes above.
9. **Verify** — extend `verify-contrast.ts`; every new token needs its measured ratio recorded.

Steps 1–3 are most of the value. Do not start step 5 before step 3, or the frame device will be
built twice.
