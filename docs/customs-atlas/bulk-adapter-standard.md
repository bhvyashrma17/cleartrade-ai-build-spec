# The bulk authority adapter standard

What a BULK / release-based Customs Atlas adapter must satisfy before it may be marked operational.
This is the reusable bar for every future pack; it exists because two waves in a row shipped
adapters that were semantically correct and still unfit to run.

An adapter must pass **both** halves. Neither substitutes for the other.

---

## A. Semantic qualification — "is the tariff represented correctly?"

Proven by tests against real authority fixtures, via `runTechnicalQualification`
(`vendor-qualification.ts`). A dimension may be `supported`, `unsupported` or `not_applicable`, but
it may never be fabricated.

| Dimension | The failure it prevents |
|---|---|
| National tariff-line identity | Reporting an HS6 rate as if it were a declarable line |
| HS revision / nomenclature version | Comparing rates across incompatible nomenclatures |
| Zero vs missing | `Free` (observed evidence) collapsing into "no data", or vice versa |
| Specific duties | A per-kg amount silently read as a percentage |
| Compound / mixed duties | Dropping a component — `25% + 63 JPY/kg` must keep both |
| Preference semantics | "A preference exists" being read as "this shipment qualifies" |
| Quota semantics | A within-quota rate presented as the unconditional applied rate |
| Effective dates | Serving a superseded or not-yet-commenced rate as current |
| Source authority + release identity | Evidence that cannot be traced to exact published bytes |

Cross-archetype coverage is required, not optional: at minimum rice, brassware/metals, machinery,
electrical cable and an industrial chemical. Adapters validated only on food have repeatedly hidden
kg-only, ad-valorem-only assumptions.

---

## B. Operational qualification — "does it fit the machine it runs on?"

Proven by measuring the **real retained archive**, via `scripts/qualify-bulk-release.ts`, recorded
in `AuthorityReleaseQualification`, enforced at activation by `bulk-release-gate.ts`.

Fixture-based tests categorically cannot establish this. New Zealand passed every semantic test on
hand-built fixtures and then OOM-killed the staging worker three times on first contact with 945K
real rows. The defect was purely a function of scale.

| Requirement | Threshold / rule |
|---|---|
| Peak RSS, single decode | **FAIL above 70% of the worker limit (717MB of 1GiB)**; WARN above 60% |
| Row count | Recorded — it is the scale figure fixtures never exercise |
| Parser version | Recorded; a change invalidates the qualification |
| Archive checksum | Recorded; different bytes are a different subject |
| Cache bound | Every decoded-bundle cache must be bounded (`BoundedBundleCache`), never a bare `Map` |
| Whole-source materialisation | Retaining ≫ the source size is flagged: build rows while walking, do not keep an intermediate copy |
| Idempotency | Re-importing identical bytes creates nothing new |
| Reparse | A new parser version appends a new snapshot; it never rewrites evidence |
| Restart behaviour | An interrupted import resumes; stale jobs reclaim on the existing 300s path |

### Why 70%

The worker limit is 1 GiB. Three claims share it: a ~130MB baseline (Node, Prisma pool, job loop),
the decode itself, and the headroom V8 needs *above* steady state — a mark-compact pass can hold
both copies of what it moves, which is how the NZ crash actually presented (the fatal log was a GC
trace, not an allocation failure). 70% leaves ~300MB for that. The threshold is derived from the
container, not fitted to current adapters, and a test pins that the pre-fix 977MB shape still fails.

### Concurrency

`MAX_BULK_DECODES_PER_WORKER = 1`. The ceiling above is a **single-decode** budget, which is
sufficient only while decodes cannot overlap. Two properties make that true, both verified:
the worker claims one job and awaits it before looping, and the NZ/Japan readers are synchronous
and never yield mid-decode. Measured: two overlapping NZ decodes peaked at 598MB versus 597MB for
one — they serialised entirely.

Raising that number is not a throughput setting. It invalidates every recorded per-adapter ceiling
and requires re-deriving the budget for N simultaneous decodes.

---

## Registering a new bulk adapter

1. Add its source family to `BULK_QUALIFICATION_REQUIRED` in `bulk-release-gate.ts`. Set `true` for
   a single bulk archive; `false` is only correct for per-chapter page sources, whose real risk is
   cache accumulation rather than one large decode.
2. Register a decoder in `DECODERS` in `scripts/qualify-bulk-release.ts`, returning row count and
   materialised size.
3. Import the release **without** activating. Bulk families are refused activation-on-import
   precisely so the archive can be measured before it goes live.
4. Run `railway run npx tsx scripts/qualify-bulk-release.ts --family=<FAMILY>`.
5. Activate. The gate reads the recorded qualification and blocks if it is missing, stale against
   the current parser, measured on different bytes, or last failed.

`acknowledge_unqualified` exists for a deliberate operator override in an emergency. It is recorded
on the activation audit event, so bypassing the gate is visible after the fact rather than silent.
