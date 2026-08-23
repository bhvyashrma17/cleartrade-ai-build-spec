# ClearTrade — UI design system

What the interface is, why each decision was made, and what changed. `docs/27-ui-redesign.md`
is the argument that preceded this work; this file is the system as it ships. Behavioural
rules in `docs/03-global-ux-contract.md` are unchanged — this is a visual layer, and where
the two conflict the workflow rule wins.

Implementation: `src/app/globals.css` (tokens), `tailwind.config.ts` (token surface),
`src/components/brand/` (the mark), `src/components/shell/` (chrome), `src/components/ui/`.

---

## 0. Why this was redone twice

The first pass polished a light admin dashboard: it fixed the type ladder, the contrast and
the token bugs, and it was still the wrong product. The verdict was that the *structure* was
generic — and it was, for two reasons that no amount of restyling reaches:

1. **The layout was the default admin skeleton.** A fixed dark top bar plus a 256px sidebar
   spent roughly a fifth of a laptop screen on furniture before any content, on every page,
   and left every page a narrow column of stacked cards.
2. **The brand was invented rather than read.** `brand-logo.svg` was not in the repo, so the
   mark had been *reconstructed from a written description* — as a round "C" in a ticked
   frame, set in Inter and Instrument Serif. The real logo turned out to be orthogonal (not
   one curve in it), set in a high-contrast Didone, and drawn **bone on a dark ground**.

The product was translating a dark brand onto white. It now lives where the brand already
lived.

---

## 1. The brand

### 1.1 The mark

`src/components/brand/BrandMark.tsx` · geometry verbatim from `public/brand/logo-full.svg`.

A solid square frame, notched at three cardinal points, enclosing a nested square bracket
that opens to the right. Every stroke is a rectangle. It is a register, a frame around a
record — which is what the product produces.

The frame is exported as eight fillable segments so `JourneyFrame` can close them one at a
time (§4). **Do not redraw it by eye**; that is exactly how the first version went wrong.

Assets are the real files from the logo package: `public/brand/` (full lockup, 192/512 PNG,
apple-touch, favicons) and `src/app/favicon.ico`.

### 1.2 The lockup

Mark + "ClearTrade" in the display Didone. The wordmark is live text in the same face as
every page masthead, not traced outlines — so it scales with the reader's font settings and
the name and the page titles are visibly one voice.

---

## 2. Type

| Role | Face | Used for |
|---|---|---|
| **Masthead** | **Playfair Display** | Page `h1`, the landing hero, the wordmark. Nothing else. |
| **Interface** | **Space Grotesk** | Everything else. |
| **Record** | **JetBrains Mono** | Every instrument of record — §2.2. |

Chosen against the logo file rather than a description of it. The wordmark is a
high-contrast Didone with vertical stress and ball terminals, and Playfair is the closest
web-licensed match. The tagline is set in a geometric sans; Space Grotesk is the version of
that idea that survives 13px in a dense queue table, and is emphatically not the Inter that
every other product defaults to.

Loaded via `next/font/google` — self-hosted, hashed, preloaded.

### 2.1 Scale

| Token | Size / weight | Face | Use |
|---|---|---|---|
| `display` | 64 / 500 | Serif | Landing hero only |
| `title-page` | 40 / 500 | Serif | Page `h1` |
| `figure` | clamp(26→44) / 500, tabular | Sans | The headline number |
| `title-section` | 22 / 500 | Sans | Section `h2` |
| `subtitle` | 17 / 500 | Sans | Card `h3` |
| `body` (`text-sm`) | 14 / 400 | Sans | Default paragraph |
| `body-sm` (`text-xs`) | 13 / 400 | Sans | Dense tables, agent/ops |
| `label` / `.eyebrow` | 11 / 500, `0.14em`, upper | Sans | Eyebrows, table headers, `dt` |
| `record` | 13 / 400, tabular | Mono | §2.2 |

**The ladder is installed by re-pointing `text-sm` and `text-xs`**, which carry ~90% of the
type in this product (694 and 740 call sites), rather than by rewriting 1,434 class names.

`figure` is a `clamp()` rather than a fixed size: a fixed 44px overflowed the context rail
on the dashboard, clipping "USD 56,4…".

### 2.2 Mono is a product decision

In a trade product the reference number *is* the content. Every one of these goes through
the single `.record` class: HS codes · B/L and AWB numbers · shipping bill numbers ·
container numbers · invoice numbers · LC references · customs and filing references ·
hashes · payout transfer references · correlation IDs · UN/LOCODEs. Somebody reads these
down a phone line, character by character.

---

## 3. Colour — a dark system

The logo is bone on dark. So is the product.

### 3.1 The ground stack

Four steps, not one flat black. On a dark ground **elevation is light, not shadow**: a
raised surface is lighter than the one beneath it. Shadows are reserved for true overlays.

```
--ground     #0C0E11   the page
--surface    #14171C   panels, cards
--surface-2  #1B1F26   raised: hover, active row, inputs
--surface-3  #242932   overlay: menus, dialogs, the palette
```

### 3.2 Ink

```
--bone   #EFE9E9   primary text, the mark      15.0:1 on --surface
--slate  #9B9EA7   secondary text               6.7:1
--muted  #838A98   tertiary — the floor for body copy   5.2:1 / 4.8:1 on --surface-2
--faint  #4E545F   rules and decorative glyphs. NEVER text (2.4:1).
```

`--muted` was raised once during this pass: the darker value cleared AA on `--surface` but
not on `--surface-2`, and plenty of muted text sits inside a raised panel.

**`--faint` is never text — and that includes disabled labels.** A control being inert is
carried by its flat fill, its cursor and its `disabled` attribute; making its text
unreadable is not an accessibility trade worth taking.

### 3.3 Accent, and why primary is not it

`--accent #9A8CFF`. One colour, never a status: links, focus, the active nav marker, the
journey segment in flight. ~2% of any screen.

**Primary actions are bone, not the accent.** On a dark ground the highest-contrast object
available is light, so primary inverts to a bone fill with ground text. That is what keeps
colour meaningful everywhere else — a violet CTA would compete with every warning on screen.

### 3.4 Status

Tuned for a dark ground; the light-mode hues go muddy here. Each clears AA as text on
`--surface`.

```
--ok #4ADE80 (10.3:1) · --info #56CCF2 (8.9) · --warn #FBBF24 (9.9) · --crit #FF7A70 (7.1)
```

Tints via `color-mix`, **never** a Tailwind alpha modifier on a bare `var()` colour — see §7.1.

---

## 4. Structure — the change that mattered

### 4.1 One bar, not two

The sidebar is gone. Navigation is horizontal in a single 60px command bar, and the content
gets the full deck back (`max-w-shell`, 1440px). Below `lg` the nav becomes a scrolling rail
rather than collapsing into a hamburger — a queue worker on a tablet should not have to open
a menu to change surface.

### 4.2 ⌘K

Removing a sidebar has to *add* something. A sidebar's real job is "show me everything I can
reach", and the palette does that job better: every destination the current role and tier can
actually reach, reachable without leaving the keyboard, at zero pixels until asked for.
`⌘K` / `Ctrl+K` / `/`, arrow keys, Enter, Esc. The trigger stays visible and shows its own
shortcut, because a keyboard feature nobody can see is a keyboard feature nobody uses.

### 4.3 Focus and context, not a stack of equal cards

Pages open with a masthead, then split: the work on the left at two-thirds, context in a
sticky rail at one-third. The dashboard used to give the thing you have to *do* the same
weight as the thing you might like to *know*. Below `lg` it collapses to one column in the
same order, so the priority survives on a phone.

48 page wrappers were unwound as part of this — each carried its own `mx-auto max-w-* p-*`
from the era when every page built its own container, which now double-padded the gutters and
re-constrained a width the shell had already set.

### 4.4 Density is a shell property

Set once as `data-density` on the shell root; components read the variables it re-points and
never opt in.

```
Exporter (comfortable)   body 14px · inset 24 · row 52 · control 38
Agent / Ops (compact)    body 13px · inset 16 · row 36 · control 32
```

---

## 5. The signature: the frame closes

`src/components/ui/JourneyFrame.tsx`

The logo is a square frame around a bracket. A deal is a sequence that closes. So the eight
frame segments fill clockwise as stages complete, and **a finished deal has drawn the logo
exactly**. The bracket is always present — it is the record being framed; the frame is how
far along it is.

Done segments are bone, the segment in flight is accent, the future sits at 18% opacity.
This is the one place the accent appears at size, which is what makes it read as the brand.

Progress maps onto eight segments for any stage count, so a 7-stage rail, an 8-state
lifecycle and a bare percentage render on identical geometry — the glyph means the same
thing in a deal table, an agent queue and the deal header.

**The rail beside it is segmented bars, not dots on a connector.** The dot rail could not be
made to behave: each connector had to be centred against a column that also held its label,
so the line ran through the text, and a centred label on the final stage clipped at the
container edge. Bars have neither problem and read as a progress track rather than as a row
of checkboxes.

---

## 6. Components

| Component | What it is |
|---|---|
| `Button` / `buttonClass()` | One recipe. `primary` bone-on-ground, `secondary`, `ghost`, `danger` (crit tint + border, never a solid red fill), `accent` for a single hero CTA. Exported as a class because a third of this product's "buttons" are `<Link>`s. |
| `Input` | Field one step lighter than its panel, `eyebrow` label, accent focus, error **with an icon** so failure is never colour alone. |
| `Card` | `tone`: default / raised / bare. No shadow — elevation on dark is tone. `ticked` adds the mark's corner registration ticks; one panel per screen. |
| `PageHeader` | The masthead. The Didone appears here and nowhere else. |
| `SectionHeading` | Hairline above the title, accent tick for the one section that is the point of the page. |
| `StatusChip` | Square, not a pill. Icon at full hue, label at full hue, tint ground, 28% border. Label + icon always. |
| `MetricCard` | Tracked label, `figure`-size tabular value. The number is the content. |
| `EmptyState` | Centred with the mark, or `bordered` for an in-section notice. |
| `Table` / `DataTable` | Header is a tracked label over a rule — not a filled band. Rows hover to `--surface-2`. |
| `CommandPalette` | §4.2. |
| `AppShell` | §4.1, §4.4. |

---

## 7. Live defects fixed, as categories

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

Introduced during this work and caught by measuring rather than by looking:
`html, body { font-size: var(--text-body) }` where `--text-body` is in `rem` makes
`1rem = 14px`, so every token then resolves ~6% small. The root stays at the browser default
— which is also what a reader's own font-size preference sets — and the body size is applied
one level down.

### 7.5 `w` and `h` are not SVG rect attributes

The rebuilt mark stored its geometry as `{x, y, w, h}` and spread it onto `<rect>`. React
passes unknown attributes straight through and the browser ignores them, so every rectangle
had zero size and **the mark rendered nothing at all** — silently, with no error, on every
surface in the product. Caught by looking at a screenshot, not at the code.

---

## 8. Verification

Everything below was measured, not asserted.

| Check | Result |
|---|---|
| `scripts/verify-contrast.ts` — full-app WCAG AA sweep, 41 surfaces | **0 failing text nodes of 3,880**, **0 failing icons of 481** |
| `npm test` | 979 passing / 47 files |
| `npm run lint`, `npx tsc --noEmit` | clean |
| `npm run build` | succeeds; `next/font` resolves at build time |
| Density, in-browser | `/app/overview` body 14px, `/agent` 13px |

**Three pre-existing failures are not from this work.** `/agent/deals/:id`, `/ops/execution`
and `/ops/audit` under-sample because the dev database is missing
`Shipment.final_destination_name` from migration `20260821150000_document_capability_foundation`.
The same three fail identically on unmodified code — verified by stashing.
`npx prisma migrate deploy` clears it.

## 9. Rules worth keeping

1. **Colour always carries meaning.** Primary actions are bone so that it can.
2. **The serif appears once per page.** Restraint is what makes it a masthead and not a theme.
3. **Never an alpha modifier on a `var()` colour.** Use a `*-tint` token or `color-mix()`.
4. **`--faint` is never text**, disabled labels included.
5. **Status is never colour alone** — always a label, and an icon where there is room.
6. **Density belongs to the shell**, never to a component variant.
7. **A structural device must encode something true.** The frame is the completion state.
8. **Read the brand file, do not infer it.** The mark was reconstructed from prose once and
   was wrong in every particular that mattered.
9. **Measure the rendered pixel.** Every defect in §7 passed code review and failed a browser.
