# The top-30 regional review (D-048)

D-048 (1): the 30 largest markets by India's 2024 non-fuel goods exports (79.9% of US$358.6 billion,
E-076) are reviewed one by one against official sources. Each change is kept with its source and
reason. The review checks each market's shape, regions, hubs, gateways and search terms as the
regional geography builds them (docs/38 §3).

**Status.** Not run yet. The agent's cloud workspace cannot read official sites (E-078, R-52), so this
kit lets a session that can read them run the review.

## Files

| File | What it is |
|---|---|
| `checker.md` | The first reviewer's instructions, one market at a time. |
| `challenger.md` | The second reviewer's instructions: try to disprove the first reviewer's findings. |
| `markets/NN-XX.json` | What the registry says about each market today. Fields: rank, ISO code, name, 2024 exports, the registry's version and checksum, and `current` (shape, rule, hubs, regions, gateways, and any `excluded_divisions`). |

`markets/` is written by `npx tsx scripts/regional-review-inputs.ts`; `--check` reports stale files
without writing. If the registry changes before the review runs, regenerate the files: the tests fail
while a committed file differs from the registry.

## Filling the templates

| Placeholder | Value |
|---|---|
| `{{NAME}}` | the market file's `name` |
| `{{ISO2}}` | its `iso2` |
| `{{CURRENT}}` | its `current` object, as JSON |
| `{{FINDINGS}}` | the challenger only: the checker's JSON reply for the same market |

## How to run it (the owner's instructions, 12 Nov 2026)

1. **Tools.** Use WebFetch and WebSearch for official sites, never the shell. If a site refuses, note
   it in `refused_sources` and move on. Never work around a refusal (mirrors, caches, archives,
   translators, proxies).
2. **Pilot: Bangladesh** (`markets/08-BD.json`). It has no official regional data, and its gateways
   are land border posts, so it is the hardest test. Run the checker, then the challenger with the
   checker's findings.
3. **The pilot passes only if all of these hold:**
   - every change quotes an official page, with its link;
   - each of the challenger's objections is either fixed or listed as open;
   - nothing rests on a search summary alone.

   If it passes, run the other 29 markets the same way, as one workflow (pre-approved by the owner).
   If it does not, stop the review and write up why.
4. **Workflows only for this review**, nowhere else in the build.
5. **Keep the evidence.** Save each reply as `results/NN-XX.checker.json` and
   `results/NN-XX.challenger.json`.

## What the review produces (PR 2)

- **The 30-row table in docs/38.** For each market: rank, market, what the rule said, what changed,
  why, and a source link for every change.
- **The registry changes.** Each one keeps its official URL, quote and one-line reason.
  - Shape changes go into `SHAPE_OVERRIDES` (`src/lib/regional-geography/registry.ts`).
  - Changes to regions (the statistics office's current list), hubs, gateways (land border posts
    included) and search terms (postcode prefixes) need a small review-data structure. That is built
    in the same PR.

## Context for reviewers

- **docs/38 §3:** how the geography was made.
- **docs/38 §3.5:** its known limits, for example Vietnam's 34 provinces since 2025, Nepal's 7
  provinces, the UK's ITL1 regions, and land border posts such as Benapole and Birgunj.
- **D-049:** Crimea, Sevastopol, Azad Kashmir and Gilgit-Baltistan stay out of every market.
