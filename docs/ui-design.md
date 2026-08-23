# ClearTrade — UI design system

What the interface is, why each decision was made, and what changed in the pass that
built it. `docs/27-ui-redesign.md` is the argument that preceded this work; this file is
the system as it now ships. Behavioural rules in `docs/03-global-ux-contract.md` are
unchanged — this is a visual layer, and where the two conflict the workflow rule wins.

Implementation lives in `src/app/globals.css` (tokens), `tailwind.config.ts` (the token
surface), `src/components/brand/` (the mark) and `src/components/ui/` (the primitives).

---

## 0. The problem this pass was fixing

The product read as bland and machine-made, and the reasons were specific and measurable
rather than a matter of taste:

| Symptom | Measurement | Why it read as "AI-generated" |
|---|---|---|
| No typographic hierarchy | `text-sm` on 694 elements, `text-xs` on 740 — 90% of all type in the product | Every page was a uniform field of 12–14px text. Nothing led the eye. |
| No brand present anywhere | `public/` contained one file: `.gitkeep` | The strongest position on every screen — the top-left — held the string "ClearTrade AI" set in bold interface sans. |
| No elevation | `shadow-card` on 182 elements, `shadow-raised` on 2 | Everything sat on one plane, all of it faintly shadowed, so nothing floated. |
| The palette was unused | `bg-action` on 18 elements against `text-primary` on 872 | Monochrome in practice. |
| The default AI landing page | Centred serif headline over a centred column | Precisely the house style `docs/27` §3.1 warned against — and the product was wearing it. |

Underneath those, a half-finished token migration had left four **live defects** that no
amount of restyling would have hidden. They are documented in §7 because each one is a
category of mistake worth recognising again, not just a bug that got fixed.

---

## 1. The brand

### 1.1 The mark

`src/components/brand/BrandMark.tsx` · `public/brand/mark.svg`

A square registration frame — four corner brackets and four cardinal ticks — enclosing an
open "C". It reads as a customs stamp, a die, a seal: **an instrument of record, not a tech
logo.** That is what the product is. It generates the documents that clear customs.

The mark is drawn in `currentColor` and never given a colour of its own, so one component
serves bone-on-ink chrome, ink-on-paper page furniture and inherited-colour inline use.

Its eight frame strokes are exported as `FRAME_STROKES` and shared with `JourneyFrame`
(§4). Change the geometry in one place or the two marks drift apart.

### 1.2 The lockup

`src/components/brand/Wordmark.tsx`

Mark + "ClearTrade" in the display serif + "AI" as a tracked slate label. The wordmark is
set in the same face as every page masthead, which is the point: the name and the page
titles are one voice. The "AI" rides behind rather than matching, so the name reads as
ClearTrade and the qualifier stays a qualifier.

Assets: `public/brand/mark.svg` (favicon, bone on ink so it reads on any tab colour),
`mark-app.svg` (touch icon), `lockup.svg` (email, README, OG — carries a fallback font
stack; the product UI always uses the React component so the wordmark renders in the real
webfont).

---

## 2. Type

### 2.1 Three faces, three jobs

| Role | Face | Used for |
|---|---|---|
| **Masthead** | **Newsreader** | Page `h1`, the landing hero, the wordmark. Nothing else. |
| **Interface** | **IBM Plex Sans** | Everything else. |
| **Record** | **IBM Plex Mono**, tabular | Every instrument of record — see §2.3. |

Two deliberate rejections:

- **Not Inter.** It is the most legible typeface in the world and also the single most
  common signal that nobody chose a typeface. IBM Plex Sans is an institutional grotesque
  — engineered, slightly flared, designed for dense enterprise UI in IBM Carbon — and it
  is the sibling of the mono below, so the interface and the record set share one
  skeleton.
- **Not Instrument Serif.** `docs/27` §3.1 warns that warm cream plus a high-contrast
  display serif is the house style of every AI-generated site — and then specified
  Instrument Serif, which *is* that face. Newsreader is a newspaper-of-record serif with
  optical sizing: editorial and institutional rather than fashionable, and far less worn.

Loaded through `next/font/google` (`src/app/fonts.ts`), not a `<link>` to
fonts.googleapis.com. The files are self-hosted from our own origin, hashed by the build
and preloaded. The old `<link>` cost two DNS handshakes on every cold load and shipped a
render-blocking third-party stylesheet — visible as a flash of Times New Roman on the
masthead, which is the most brand-critical glyph run on the page.

### 2.2 Scale

| Token | Size / line / weight | Face | Use |
|---|---|---|---|
| `display` | 52 / 1.02 / 500 | Serif | Landing hero only |
| `title-page` | 32 / 1.12 / 500 | Serif | Page `h1` |
| `title-section` | 21 / 1.3 / 600 | Sans | Section `h2` |
| `subtitle` | 17 / 1.4 / 600 | Sans | Card `h3` |
| `body` (`text-sm`) | 15 / 1.6 / 400 | Sans | Default paragraph |
| `body-sm` (`text-xs`) | 13 / 1.5 / 400 | Sans | Dense tables, agent/ops |
| `label` / `.eyebrow` | 11 / 1.3 / 600, `0.09em`, uppercase | Sans | Eyebrows, table headers, `dt` |
| `record` | 13 / 1.5 / 400, tabular | Mono | §2.3 |

**The ladder was installed by retuning `text-sm` and `text-xs`, not by rewriting 1,434
class names.** Those two utilities carry 90% of the type in the product, so they were
re-pointed at the 15px body and the 13px dense body. Every existing call site inherited
the new scale without an edit, and the sizes above them were spread to leave a real gap.

### 2.3 Mono is a product decision, not a style

In a trade product, reference numbers *are* the content. Every one of these is set through
the single `.record` class (60 call sites): HS/ITC-HS codes · bill of lading and AWB
numbers · shipping bill numbers · container numbers · invoice numbers · LC references ·
customs and filing references · snapshot hashes · partner handoff references · payout
transfer references · correlation IDs · UN/LOCODEs.

It does more for "purpose-built" than any amount of colour, and it is a real usability
gain: a filing reference read off a screen character by character, down a phone line, is a
thing that actually happens in this product.

---

## 3. Colour

### 3.1 The inversion

**Cool light surfaces, warm dark chrome.** Bone is reserved for where the mark lives — the
top bar, dark panels, the logo. The light surfaces take their cast from slate. This is
what makes the dark chrome feel deliberate instead of like a default navy header, and it
is the opposite of the warm-cream-plus-serif reflex.

```
Brand      bone #EFE9E9 · slate #9B9EA7
Ink        900 #15171B · 700 #24272E · 500 #4A4E58 · 300 #666B78 · 200 #9B9EA7
Paper      paper #F4F5F7 · sunk #EBEDF1 · card #FFFFFF · line #E2E5EA · strong #CBD0D8
Seal       600 #4B3FAE · 500 #5C51C4
Status     ok #12805A · info #0E7490 · warn #B45309 · crit #C0271D  (each + a -text and -tint)
```

`--ink-200` is **decorative and border-only** — 2.45:1 as text. That is written into the
token's own documentation because this pass violated it once (§7.4) and the sweep caught
it.

### 3.2 Primary actions are ink

Not seal, not a status hue. This is the rule the rest of the colour system hangs off: if
buttons were the accent, colour would mean "clickable" in one place and "at risk" in
another, and a violet CTA would compete with every warning on screen. **Ink primary keeps
colour meaningful everywhere else.**

Seal is the one accent — links, focus ring, the active nav bar, the in-progress segment of
the journey frame. Roughly 2% of any screen, and never a status.

### 3.3 Tints

Always via the pre-mixed `--*-tint` tokens or an explicit `color-mix()`. **Never a Tailwind
alpha modifier on a bare `var()` colour** (`bg-seal/10`) — see §7.1.

---

## 4. The signature: the frame closes

`src/components/ui/JourneyFrame.tsx`

Every design needs one memorable element, and this one was already in the logo. The mark
is **a square frame that closes.** The product's core object — a deal — is a sequence that
progresses toward completion. So:

> **The deal's progress closes the frame.** Eight strokes, filling clockwise from the
> top-left. A deal that completes has drawn the logo exactly.

Complete strokes are ink, the stroke in progress is seal, future strokes are
`--line-strong`; the aperture in the centre stays grey until the frame closes. This is the
only place seal appears at any size, which is what makes it read as the brand rather than
as decoration.

It passes the test that a structural device must encode something true: it is not an
ornament, it is the completion state.

Progress maps onto eight strokes for any stage count, so a 7-stage rail, an 8-state
lifecycle and a percentage all render on the same geometry — the glyph means the same
thing in a deal table, an agent queue and the deal header.

**Supporting motif:** the mark's registration ticks become the section divider — a hairline
rule with a short heavy tick at the left edge (`.tick-rule`, used by `SectionHeading`).
Section headers only. A motif that is everywhere is wallpaper.

---

## 5. Rhythm, density and elevation

### 5.1 Density is a shell property

Set once by `AppShell` as `data-density` on the shell root; components read the CSS
variables it re-points and never opt in.

```
Exporter (comfortable)   body 15px · card inset 24 · row 52px · stack 24 · control 38px
Agent / Ops (compact)    body 13px · card inset 16 · row 36px · stack 16 · control 32px
```

This is what keeps the three portals one product at two densities instead of two designs.
Verified in the browser: `/app/overview` renders body at 15px, `/agent` at 13px, both with
a 32px masthead.

### 5.2 Spacing

Six steps — 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 — routed through two primitives rather
than applied per element, because the fix for 38 distinct padding values is removing the
opportunity, not discipline:

- `<Stack gap>` — vertical rhythm, replacing sibling `mt-*`
- `<Inset size>` — padding, replacing per-element `p-*`

### 5.3 Elevation — three levels, used honestly

| Level | Treatment | For |
|---|---|---|
| flat | 1px `--line`, no shadow | Most cards. White on cool paper already reads as raised. |
| `raised` | soft 6/16px | Active nav item, hovered rows, sticky headers |
| `overlay` | 12/32px | Drawers, dialogs, menus |

`--shadow-card` was retuned to a near-hairline rather than removed from 182 call sites, so
they all de-escalate without being edited.

### 5.4 Radius

4 inputs and chips · 8 cards and buttons · 12 panels and dialogs · full **avatars only —
and not even those**. The monogram plate is square. The mark is built from hard corners;
`rounded-full` was the one shape in the system that belonged to somebody else's product.

---

## 6. Components

| Component | What it now is |
|---|---|
| `Button` / `buttonClass()` | One recipe. `primary` ink+bone, `secondary` card+strong border, `ghost`, `danger` (crit tint + border, never a solid red fill), `inverse` for ink chrome. `buttonClass()` is exported because a third of the product's "buttons" are `<Link>`s. |
| `Input` | 15px field text, `label`-token label, seal focus ring, error below the field **with an icon** so failure is never carried by colour alone. |
| `Card` | Flat by default. `tone`: default / sunk / ink. |
| `PageHeader` | The masthead — serif `h1`, tracked eyebrow, one-line description, optional `meta` row. The serif appears here and nowhere else. |
| `SectionHeading` | `h2`/`h3` under the registration-tick rule. |
| `StatusChip` | Square, not a pill. Icon in `*-fill`, label in `*-text`, `*-tint` ground, border at 30% fill. Label + icon always. |
| `MetricCard` | Tracked label, 28px/600 tabular value. Numbers are the content. |
| `EmptyState` | Centred with the mark at low contrast, or `bordered` for an in-section notice. An empty page is the one moment with room for the brand. |
| `Table` / `DataTable` | Header is the `label` token on `--paper-sunk`. Rows hover to `--paper`, 1px lines, no zebra, density-driven cell padding. |
| `JourneyProgress` | Square markers, ink/seal only, led by the `JourneyFrame` glyph. |
| `AppShell` | Ink top bar with the lockup; nav on `--paper-sunk` so the active white card actually contrasts, with a 2px seal bar at its left edge; portal eyebrow; density attribute. |

---

## 7. The four live defects this pass fixed

Each is a category worth recognising again.

### 7.1 A Tailwind alpha modifier on a bare `var()` colour silently yields transparent

`bg-[var(--color-info)]/5` and `border-[var(--color-action)]/30`. Tailwind cannot
re-compose a colour it cannot see the channels of, so the utility resolves to
`rgba(0,0,0,0)` — **no error, no warning, just an invisible element.** Every `StatusChip`
tint in the product rendered transparent with a default grey border, and five more
surfaces (the guest banner on `/app/markets`, the market estimate panels, the guest-upgrade
notice on `/register`) rendered as empty outlines.

Fixed with pre-mixed `--*-tint` tokens and explicit `color-mix()`. The rule is now stated
in `tailwind.config.ts` where someone reaching for the modifier will read it.

### 7.2 Focus was suppressed app-wide

```css
.focus-visible-ring:focus-visible { outline: none; ring: 2px; ring-color: …; }
```

`ring` is a Tailwind utility, not a CSS property. Inside a plain stylesheet those three
declarations are discarded and **only `outline: none` survives.** The class is on ~400
interactive elements, so the product shipped with keyboard focus removed and nothing drawn
in its place. Now written as real CSS, with a bone variant for ink chrome.

### 7.3 The accent repoint made primary buttons illegible

`--color-action` was moved from teal to seal violet while `Button`'s primary variant was
still `bg-action text-primary` — near-black text on dark violet, **~1.6:1.** The landing
CTA, the upgrade buttons, the billing CTA and the bug-report submit were all in that
state. The same repoint turned every `positive` StatusChip violet, so "Approved",
"Cleared" and "On time" rendered in the brand accent while nothing in the product was
green.

The lesson is in the fix: status hues are now their own tokens and cannot be re-pointed by
an accent change again.

### 7.4 A rem-relative font-size on `:root` re-defines the unit the tokens are measured in

Introduced *during* this pass and caught by measuring rather than by looking:
`html, body { font-size: var(--text-body) }` where `--text-body: 0.9375rem` makes
`1rem = 15px`, so every token then resolved 6.25% small — a 15px body rendering at
14.06px, a 32px title at 30px. The root now stays at the browser default (which is also
what a reader's own font-size preference sets) and the body size is applied one level down.

---

## 8. Verification

Everything below was measured, not asserted.

| Check | Result |
|---|---|
| `scripts/verify-contrast.ts` — full-app WCAG AA sweep, 41 surfaces | **0 failing text nodes of 3,857**, **0 failing icons of 456** |
| Same sweep on the pre-change code | **259 failing text nodes** |
| `npm test` | 979 passing / 47 files |
| `npm run lint`, `npx tsc --noEmit` | clean |
| `npm run build` | succeeds; `next/font` resolves at build time |
| Density, in-browser | `/app/overview` body 15px, `/agent` body 13px, masthead 32px both |

**Three pre-existing failures are not from this work.** `/agent/deals/:id`, `/ops/execution`
and `/ops/audit` under-sample because the local dev database is missing
`Shipment.final_destination_name` from migration `20260821150000_document_capability_foundation`.
The same three surfaces fail identically on the unmodified code — verified by stashing.
`npx prisma migrate deploy` against the dev database clears it.

---

## 9. Rules worth keeping

1. **Colour always carries meaning.** Primary actions are ink so that it can.
2. **The serif appears once per page.** Restraint is what makes it a masthead and not a theme.
3. **Never an alpha modifier on a `var()` colour.** Use a `*-tint` token or `color-mix()`.
4. **`--ink-200` is never text.**
5. **Status is never colour alone** — always a label, and an icon where there is room.
6. **Density belongs to the shell**, never to a component variant.
7. **A structural device must encode something true.** The frame is the completion state.
8. **Measure the rendered pixel.** Every defect in §7 passed code review and failed a browser.
