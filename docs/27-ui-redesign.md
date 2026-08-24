# 27 — UI Redesign (superseded proposal)

> **Status: superseded.** The system as it ships is `docs/ui-design.md`; the implementation is
> `src/app/globals.css`, `tailwind.config.ts`, `src/components/brand/`, `src/components/shell/`
> and `src/components/ui/`. **Do not implement the tokens or the type stack this document
> originally specified** — they describe a light interface the product does not have.
>
> This file is retained for two things that are still worth having: the **diagnosis in §1**,
> which is measured evidence rather than opinion and is the reason the work was done at all,
> and the **reconciliation in §3**, which records which of the proposals held, which were
> overturned, and why. §5 is the honest list of what this proposal called for and the product
> still does not do.

Behavioural rules in `docs/03-global-ux-contract.md` are unchanged by any of this — the redesign
is a visual layer, and where the two conflict the workflow rule wins.

---

## 1. Diagnosis — why it read bland and unfinished

Not opinion. These were the audit's own numbers, taken from `docs/ui-audit.md` before any of the
work landed. The right-hand column is the same count taken from `src/` today.

| Symptom | Evidence at the time | Where it stands now |
|---|---|---|
| **No typographic hierarchy** | `text-sm` 725 + `text-xs` 697 = 1,422 of 1,595 type classes (89%). `text-3xl` 2, `text-4xl` 1 — across the entire product. | Still ~90% two classes (682 / 756) **by design**: the ladder was installed by re-pointing what `text-sm` and `text-xs` resolve to, rather than by rewriting 1,434 class names. The rendered sizes now differ; the class names deliberately did not have to. |
| **Everything is emphasised** | `font-medium` 424, `font-semibold` 284, `font-normal` **22**. | 302 / 252 / 109. Body default is 400 and the serif masthead carries the top of the page, so weight is no longer the only signal. |
| **No elevation** | `shadow-card` 167, `shadow-raised` **2**. | On a dark ground elevation is *tone*, not shadow: `--shadow-card` resolves to `none` and the four-step ground stack does the lifting. The 171 remaining `shadow-card` class names are inert (see §5). |
| **The palette is unused** | `primary` 896, `surface` 465 — but `action` 20, `warning` 3, `info` 1, `accent` **0**. | Status hues are their own tokens and cannot be re-pointed by an accent change; the accent is one colour used at ~2% of a screen. |
| **Spacing is ad hoc** | 38 distinct padding values, 26 margin values, 13 gaps. `mt-1` alone 367 times. | 12 distinct `p-*` values. `mt-1*` is still 452 (see §5) — rhythm is carried by the density variables, not by the layout primitives this document proposed. |
| **Two of everything** | Two card treatments, two empty states, two button implementations, two table implementations. `DataTable` imported by **0 pages**. | One `Button` (exported as `buttonClass()` too, because a third of the "buttons" are `<Link>`s), one `Card`, one `EmptyState`, one `PageHeader`. `DataTable` is now used by six routes. Three components still hand-roll a `<table>`. |
| **Token bypasses** | `bg-red-50` in 4 files. `var(--color-danger)` referenced 5× and **never defined**. | Both gone — zero occurrences of either in `src/`. |
| **Untested dark mode** | A `prefers-color-scheme` block remapped `--color-surface` to navy. | Deleted. The product is dark unconditionally, so there is no second mode to leave untested. |

**And the root cause:** the design system was written from the Blueprint before the brand
existed. Navy `#0B1739` and teal `#14B8A6` appear nowhere in the logo. The product was wearing
someone else's identity. That finding is the one thing in this document that survived intact.

---

## 2. Where this proposal was itself wrong

Worth stating plainly, because the failure mode is repeatable.

**`brand-logo.svg` was not in the repo when this was written.** The mark was reconstructed from a
written description of it, and the reconstruction was wrong in every particular that mattered:

| This document claimed | The actual logo |
|---|---|
| A nested open **"C"** in a ticked frame | A nested square **bracket** opening right — not one curve anywhere in the mark |
| Registration ticks at four cardinal points | Notches at three |
| Wordmark is "a high-contrast serif" → Instrument Serif | A high-contrast **Didone** with vertical stress and ball terminals → Playfair Display |
| Interface face: Inter (already in place) | Space Grotesk — the tagline is set in a geometric sans, and Inter is what every other product defaults to |

**The inversion in §3.1 was the substantive error.** This document argued for cool light surfaces
with warm dark chrome, on the reasoning that warm cream plus a serif is the house style of every
AI-generated site. The reasoning was sound and the conclusion was still wrong: the logo is drawn
**bone on a dark ground**, so the light interface was translating a dark brand onto white. The
product now lives where the brand already lived. `--seal-600 #4B3FAE`, the violet accent this
document introduced, went muddy on a dark ground and became `--accent #9A8CFF`.

A first implementation pass was built to this spec — light palette, Instrument Serif, Inter, the
seal accent — and was thrown away. It fixed the type ladder, the contrast and the token bugs, and
it was still a generic light admin dashboard with a fixed sidebar. **Restyling never reaches a
structural problem.** See `docs/ui-design.md` §0 and §4.

---

## 3. Reconciliation — proposal against what shipped

| # | This document proposed | What shipped | Why the difference |
|---|---|---|---|
| 3.1 | Light `--paper`/`--card` surfaces, dark chrome | Four-step dark ground stack: `--ground` `--surface` `--surface-2` `--surface-3` | The brand is bone on dark. §2. |
| 3.3 | Seal violet `#4B3FAE` as the one accent | `--accent #9A8CFF`, same role, same ~2% budget | The accent argument held; the value had to be lightened for a dark ground. |
| 3.4 | Primary actions in ink, so colour always carries meaning | Primary actions in **bone**, same principle | On dark, the highest-contrast fill available is light. The rule survived; the direction inverted. |
| 3.4 | Split `*-fill` / `*-text` status pairs | One token per status, each clearing AA as text on `--surface` | The split existed to clear AA on white. One dark ground made it unnecessary. |
| 3.4 | Tints via `color-mix`, **never** a Tailwind alpha modifier on a bare `var()` | Adopted, and the rule is written into `tailwind.config.ts` where someone reaching for the modifier will read it | This was the single most valuable line in the original document — it turned out to be live in five more places than the audit found. `docs/ui-design.md` §7.1. |
| 4.1 | Instrument Serif · Inter · IBM Plex Mono | Playfair Display · Space Grotesk · JetBrains Mono | Chosen against the logo file rather than a description of it. |
| 4.2 | A real type ladder; body weight 500 → 400 | Adopted, installed by re-pointing `text-sm` / `text-xs` | Rewriting 1,434 class names was never the cheapest route to the same rendered result. |
| 4.3 | Mono for every instrument of record | Adopted as a single `.record` class | Unchanged in substance. |
| 5.1 | `<Stack>` / `<Inset>` primitives to remove the opportunity for ad hoc spacing | Both components exist; **rhythm is actually carried by the density variables** | The primitives were built and then largely not adopted. See §5. |
| 5.2 | Density as a shell property, not a component variant | Adopted exactly — `data-density` on the shell root | Held. |
| 5.3 | Three elevation levels, shadow-based | Elevation is tone; shadows only detach true overlays | A shadow on a dark ground does nothing a lighter surface does not do better. |
| 6 | The frame closes as the deal progresses; eight segments | Shipped as `JourneyFrame`, geometry taken verbatim from the logo file | The idea was the best thing in this document. Its execution had to wait for the real mark. |
| 6 | An expanded **dot rail** with connectors | Segmented bars | Each connector had to be centred against a column that also held its label, so the line ran through the text; the final label clipped at the container edge. |
| 7.1 | Consolidate Button / Table / Card / EmptyState / PageHeader | Done, plus `SectionHeading`, `StatusChip`, `MetricCard`, `CommandPalette` | Held. This was correctly identified as most of the value. |
| — | *(not proposed)* | **The sidebar was removed** for a single 60px command bar plus ⌘K | The layout was the default admin skeleton, spending a fifth of a laptop screen on furniture. This document never questioned it, and that was its largest blind spot. |
| 8 | Landing hero set on the tagline | Shipped, with the second half in the Didone italic | Held. |
| 8 | Owner-naming copy fixes | **Not done.** See §5. | — |
| 9 | Extend `verify-contrast.ts`; record every measured ratio | Done — 41 surfaces, 0 failing text nodes of 3,880, 0 failing icons of 481 | Held, and it caught defects that code review did not. |

---

## 4. What this document got right and is worth keeping

1. **Read the numbers before redesigning.** Every claim in §1 was checkable, which is why the
   direction survived a full change of palette.
2. **Colour must always carry meaning.** Primary actions stay neutral so that it can.
3. **The serif appears once per page.** Restraint is what makes it a masthead and not a theme.
4. **Mono is a product decision, not a style.** In a trade product the reference number *is* the
   content, and somebody reads it down a phone line character by character.
5. **A structural device must encode something true.** The frame is the completion state, and a
   finished deal draws the logo exactly.
6. **Consolidate before restyling.** Two of everything reads as unfinished even when each
   instance is fine, and restyling both is doing the work twice.
7. **Read the brand file; do not infer it.** §2 is the cost of not doing this.

---

## 5. Still outstanding

Called for here, still true in `src/` — carried forward rather than quietly dropped.

- **171 inert `shadow-card` class names.** `--shadow-card` resolves to `none`, so these render
  correctly and mean nothing. Dead vocabulary that will mislead the next person who greps for
  elevation.
- **`mt-1*` at 452 sites**, and `<Stack>` / `<Inset>` adopted at 2 sites each. The primitives
  exist; the migration did not happen. The spacing scale is honoured because the density
  variables set the inset and row rhythm, not because per-element margins went away.
- **Three components still hand-roll `<table>`**: `components/commercial/ProposalDiff.tsx`,
  `components/agent/BuyerDiscoveryControl.tsx`, `components/agent/DemandDiscoveryControl.tsx`.
  Six routes did migrate to `DataTable`.
- **The owner-naming copy pass (§8 of the original) was never run.** Still live: "Awaiting deal
  lock" (`app/agent/deals/[dealId]/documents`), "Nothing waiting to file." (`app/ops/execution`),
  "Pending invitations" (`components/notifications/TeamPanel`). The good pattern already exists
  elsewhere in the product — "Waiting on an authorized approver" — so this is consistency work,
  not invention.
- **`docs/00-design-system.md` still specifies navy and teal** in §1 and is still the document a
  newcomer reads first. Its palette and type sections are superseded by `docs/ui-design.md`; the
  conflict should be resolved in `docs/13-blueprint-reconciliation.md` rather than left for a
  reader to discover.
