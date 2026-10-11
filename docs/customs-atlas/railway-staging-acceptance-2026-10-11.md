# Railway staging acceptance — 11 October 2026

**Decision:** the ten staging-pending sovereigns are `ACCEPTED`.
Ledger: **ACCEPTED 55, LOCAL_QUALIFIED_STAGING_PENDING 0, ENGINEERING_COMPLETE 55.**
Staging currently reproduces **52/55**: Iceland, Korea and Mauritius were accepted earlier and
stay accepted, but their qualified artifacts cannot be reloaded into this fresh staging database
today (below). They fail closed — no release, no snapshot, no invented duty.

Environment: Railway `amused-insight` / `staging`, branch `staging/railway`, deployed commit
`933614fa`; staging-only Postgres and bucket (`docs/33`). Associated territories (AX, GG, IM, JE,
PR) are not counted and were not exercised in this run.

## Method

Every release was loaded through its family's canonical importer — no hand-written rows:

- Retained qualified bundles (ID, SA, QA, KW, UZ, VN, MA, TN): `scripts/import-retained-authority-release.ts`
  with `--expect-sha256` set to the qualification record's bundle SHA-256. For UZ, VN and MA the
  record pins the normalized SHA-256; the retained bundle's `normalized.json` was hashed and matched
  `943815f2…`, `a243ca8b…` and `f8495c21…` before import. Every import was repeated and resolved to
  the same release as `UNCHANGED`.
- EU TARIC: the September 2026 CIRCABC extraction (`3326296a…`, as `docs/18`), imported, bulk-qualified
  (peak RSS 422 MB of a 717 MB ceiling), activated.
- NZ (`1b00f8e8…`, 592 MB peak), CA (273 MB) and NO (443 MB): imported, bulk-qualified, activated.
- TW, GE, IL, PE, OM, NP, BT, AL: `scripts/ingest-authority-release.ts`, live from the authority.
- LK: `canary-green-wave-authority-packs.ts acquisition LK` — tariff SHA-256 `d9273968…`, 6,609 codes,
  byte-identical reacquisition, as qualified.
- JP (schedule `2026_08_08`, 96/96 chapters, 15,437 rows) and AU (96/96, 6,707 rows): backfill scripts.
- US and GB: live official APIs, no release.

Acceptance ran through the deployed system with `scripts/canary-staging-atlas.ts`: enqueue
`market_access_ingest` (origin `IN`), let the **deployed** worker run it, read the job back through
the **deployed** API as an ops user, require the API result to equal the stored result, and check
the stored snapshot: destination persisted as itself, no percentage on a specific/none/unparsed
line, evidence `tariff_rate_percent` only on ad valorem, never `confirmed_applicable` from origin
alone. Fail-closed probes: invalid HS → failed job, unknown destination → failed job,
unauthenticated → 401, unknown job → 404. All passed.

## Pending ten — all pass

| ISO | Case | Result |
|---|---|---|
| LK | 030233 | 20% ad valorem, exact; ISFTA `potentially_applicable_requires_origin_proof` |
| MC | 610910 / 100630 / 220421 | 12.000 %; `175.000 EUR / 1 tonne` specific, all children equivalent; refinement required — persisted as `MC`, not France |
| ID | 100630 / 610910 | `IDR 450/kg` specific / 25%; AIFTA requires origin proof |
| SA | 841810 / 120110 | 10% / legal 0% on `120110000000`; India `not_applicable` |
| QA | 850710 / 120110 | 5% / legal 0% |
| KW | 120110 | legal 0% |
| UZ | 100630 / 640399 | 0% / mixed "20%, but not less than USD 3 per pair" |
| VN | 100630 / 040721 | 40%, AIFTA requires origin proof / 80% out-of-quota, India `not_applicable` |
| MA | 091020 | 60% (Finance Law 2026) |
| TN | 900311 / 270900 | 10% on `90031100003` / refinement required, blank `27090090967` not served as 0%; India `unknown` |

The first run expected Monaco 100630 to require refinement. The real September extraction is
`all_children_equivalent` (`taric-memory-closure.md`), which is what staging returned; the check was
corrected and 220421 added as the documented refinement case.

## Accepted forty-five — 42 reproduce

All pass except:

| ISO | Why staging cannot reload it today |
|---|---|
| IS | Skatturinn republished `TSKINN01092026.zip` in place on 16 Sep 2026: it now holds `TollskIR20260901A.txt` (SHA-256 `dc9affd9…`), not the qualified `Tollsk20260901.txt` key file (`fc664a01…`). The adapter and canary refuse it. Re-qualification of the revised file is required. |
| MU | MRA no longer serves the pinned tariff PDF (`TariffInf130826.pdf` → HTTP 404). Re-qualification against MRA's current publication is required. |
| KR | Manual source: the KCS XLSX from data.go.kr dataset 15051179 must be downloaded by a person through the portal's interactive download (not automated; the API route needs an unprovisioned `KCS_DATA_GO_KR_SERVICE_KEY`). Once placed in `.artifacts/customs-atlas/korea/`, run `import-korea-release.ts` → `qualify-bulk-release.ts --family=KR_KCS` → activate. |

No accepted country was demoted: acceptance records a qualification that happened; these three are a
staging-reproduction gap with named causes.
