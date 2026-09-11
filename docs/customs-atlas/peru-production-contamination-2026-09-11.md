# Peru staging-to-production contamination report — 11 Sep 2026

## Status and scope

This report records read-only evidence gathered after the Peru checkpoint audit. **No production
row, audit event, or object was changed or deleted during the repair pass.** The proposed cleanup
below is intentionally approval-gated because it removes immutable evidence and retained source
artifacts.

The affected Railway project is `amused-insight`
(`c99f8829-5056-4980-86e0-17083d67a6d8`). At the time of the faulty runs, the production and
staging `cleartrade-ai-build-spec` services resolved to the same database and object-store
credentials. Secret values are deliberately omitted; SHA-256 fingerprints are the comparison
evidence.

| Environment / service | Database URL SHA-256 at incident | Direct URL SHA-256 | Bucket-name SHA-256 | Storage access-key SHA-256 | Finding |
|---|---|---|---|---|---|
| production / `cleartrade-ai-build-spec` | `c7f159cd775ca74907ce0e9823068627d9b9033849038606caf3fbc9864bf537` | `fb31bfba251b727736d9048fdbe5a661ea511a66586bad61ec2b66946a4dd7d6` | `8d98e916b0d9b57e319b3b877b4969359934f72fb2a9754a90d4c6f6377e5d4a` | `df2c08d72a44f251f40adfa108c38b1a7f609b4a325b9248392ee51b1429f406` | Production identity |
| staging / `cleartrade-ai-build-spec` | same | same | same | same | Shared production resources; incident path |
| production / `cleartrade-worker` and `cleartrade-scanner` | not configured at service scope | not configured | not configured | not configured | No second production path found |

The shared bucket was `cleartrade-staging-4nwl2e` (Railway bucket resource
`655c42f5-9b9b-479f-bbcf-1c853f983258`, region `sin`). Both incident objects could be read with the
production and the old staging credentials, independently confirming shared storage.

## Exact affected records

All timestamps are UTC. `MarketAccessEvidenceSnapshot` and `MarketAccessEvidence` do not have a
creation column; their immutable `retrieved_at` is reported instead. The search also checked the
two release correlation windows, all jobs in those windows, release foreign-key descendants, and
objects whose last-modified time fell in those windows. It found no unrelated write.

### Authority releases and retained objects

| Physical model | ID | Imported / retrieved / lifecycle timestamps | Dependency | Object |
|---|---|---|---|---|
| `TaricRelease` (`AuthorityRelease`) | `cmtw3xljo0001uerik9ppzcll` | imported `2026-09-10T22:37:01.907Z`; retrieved and activated `2026-09-10T22:37:01.508Z`; superseded `2026-09-11T06:25:22.461Z` | parent of three snapshots; predecessor of the second release | `objects/c1fee089a5c539bfe6679799e785d5d08a34fce5130a6b75`; 284,195 bytes; SHA-256 `b4fe483547d963c7cba4ab1db747090b329c9098ed9ff2cd5742b922f1480332`; ETag `26c17a396a13fb914d4d3be58f949a6f`; last modified `2026-09-10T22:37:01Z` |
| `TaricRelease` (`AuthorityRelease`) | `cmtwknwa00001ue4cslkjezso` | imported `2026-09-11T06:25:22.728Z`; retrieved and activated `2026-09-11T06:25:22.461Z`; still active when inspected | parent of three snapshots; `previous_release_id` points to the first release | `objects/f41d1a2e60e8b925dc8a17f28df5bcf6fe32de563073b462`; 311,508 bytes; SHA-256 `7bc7dd89c59e14b063bd2ab6a5cb7b35550f4c6c29ae9d73b323d02a3e0782a8`; ETag `96287a0f3bb7131d7f64b9d1fc41152c`; last modified `2026-09-11T06:25:22Z` |

There are no `AuthorityReleaseQualification` children for either release.

### Snapshots, evidence, and tariff lines

| Snapshot ID (`retrieved_at`; `effective_at`) | Source job | Evidence IDs | Tariff-line IDs (`created_at`, kind) |
|---|---|---|---|
| `cmtw3xvfj0003og0p33vona7e` (`2026-09-10T22:37:01.508Z`; `2026-09-10T00:00:00.000Z`) | `cmtw3xumv0001uesdgp0s4dju` | `cmtw3xvgi0006og0p876ffm0h` destination tariff; `cmtw3xvgi0007og0pgxuad1wl` India preference | `cmtw3xvgc0004og0p2di1vl6f` (`2026-09-10T22:37:14.748Z`, third-country); `cmtw3xvgc0005og0pgknru9qa` (same timestamp, additional duty) |
| `cmtw3y44x000bog0p8hcs9kpv` (`2026-09-10T22:37:01.508Z`; `2026-09-10T00:00:00.000Z`) | `cmtw3y3mv0001uet3g4nqyuls` | `cmtw3y454000eog0prjqqyjtg` destination tariff; `cmtw3y454000fog0pvit09rbz` India preference | `cmtw3y451000cog0pe5kvdukr`, `cmtw3y451000dog0pxyy9y36m` (both `2026-09-10T22:37:26.005Z`, third-country) |
| `cmtw3y6jc000jog0pflcek9f1` (`2026-09-10T22:37:01.508Z`; `2026-09-10T00:00:00.000Z`) | `cmtw3y5tr0001uetk6rn64jn3` | `cmtw3y6jm000log0pbp99i1i4` destination tariff; `cmtw3y6jm000mog0pcizydj5j` India preference | `cmtw3y6jg000kog0pndxrtyyx` (`2026-09-10T22:37:29.116Z`, third-country) |
| `cmtwkohm10003p60pja2g7uy0` (`2026-09-11T06:25:22.461Z`; null) | `cmtwkog5x0001ue54e0xdjn08` | `cmtwkohmf0006p60pvytgcuv1` destination tariff; `cmtwkohmf0007p60p3ndbe1fs` India preference | `cmtwkohm80004p60pshpyjhcs` (`2026-09-11T06:25:50.385Z`, third-country); `cmtwkohm80005p60pl3mux1ng` (same timestamp, additional duty) |
| `cmtwkohp4000bp60pzm152idp` (`2026-09-11T06:25:22.461Z`; null) | `cmtwkogkb0003ue54tnu79myq` | `cmtwkohpb000ep60pkgimdnr3` destination tariff; `cmtwkohpb000fp60pnw6zyrmu` India preference | `cmtwkohp8000cp60pn05tga6z`, `cmtwkohp8000dp60p61h8sb55` (both `2026-09-11T06:25:50.492Z`, third-country) |
| `cmtwkohrb000jp60petydb491` (`2026-09-11T06:25:22.461Z`; null) | `cmtwkogoo0005ue54jvh3ts7s` | `cmtwkohrl000lp60pf7qykbmi` destination tariff; `cmtwkohrl000mp60p3jxby0mr` India preference | `cmtwkohrf000kp60pkuul7bai` (`2026-09-11T06:25:50.571Z`, third-country) |

The twelve evidence rows carry the same `retrieved_at` as their parent snapshot. The first six have
`effective_at = 2026-09-10T00:00:00.000Z`; the final six have null `effective_at`; all have null
`expires_at`.

### Jobs and attempts

| Job ID | Created / started / completed | Correlation | Attempt ID (started / finished) |
|---|---|---|---|
| `cmtw3xumv0001uesdgp0s4dju` | `2026-09-10T22:37:13.687Z` / `22:37:14.109Z` / `22:37:14.789Z` | `req_fdd8b4e07a384c38afcdd649` | `cmtw3xuz70001og0pnqy5t1hm` (`22:37:14.129Z` / `22:37:14.778Z`) |
| `cmtw3y3mv0001uet3g4nqyuls` | `2026-09-10T22:37:25.351Z` / `22:37:25.966Z` / `22:37:26.029Z` | `req_1daf094021314f3e91ab07eb` | `cmtw3y44d0009og0pntzvr6uu` (`22:37:25.979Z` / `22:37:26.022Z`) |
| `cmtw3y5tr0001uetk6rn64jn3` | `2026-09-10T22:37:28.191Z` / `22:37:29.077Z` / `22:37:29.158Z` | `req_75034a2c4b2042bc86c5481b` | `cmtw3y6ir000hog0pcly3h1wt` (`22:37:29.089Z` / `22:37:29.150Z`) |
| `cmtwkog5x0001ue54e0xdjn08` | `2026-09-11T06:25:48.501Z` / `06:25:49.621Z` / `06:25:50.429Z` | `req_98ccb4b1e4d5419485b5016c` | `cmtwkoh1y0001p60p6wq8kv1r` (`06:25:49.651Z` / `06:25:50.418Z`) |
| `cmtwkogkb0003ue54tnu79myq` | `2026-09-11T06:25:49.019Z` / `06:25:50.455Z` / `06:25:50.517Z` | `req_9841a5cff6524b029d0b55e1` | `cmtwkohol0009p60p7lshiz3f` (`06:25:50.467Z` / `06:25:50.509Z`) |
| `cmtwkogoo0005ue54jvh3ts7s` | `2026-09-11T06:25:49.176Z` / `06:25:50.535Z` / `06:25:50.599Z` | `req_9c5302f960a946d88253dc33` | `cmtwkohqt000hp60prexrrqj4` (`06:25:50.547Z` / `06:25:50.591Z`) |

`MarketAccessEvidenceSnapshot.source_run_id` is not a foreign key, while `JobAttempt.job_id` is a
cascading foreign key. The six jobs are therefore independently removable after the snapshot set
has been verified.

### Audit events

The two material imports produced the expected append-only records:

- `cmtw3xlqy0003uerifjklm4x8`, `create`, `2026-09-10T22:37:02.170Z`, object
  `cmtw3xljo0001uerik9ppzcll`, correlation `439a1a88-2ab4-4b74-bcee-a4c1a149c895`.
- `cmtwknwhb0003ue4chshcl1pj`, `create`, `2026-09-11T06:25:22.991Z`, object
  `cmtwknwa00001ue4cslkjezso`, correlation `09b69e65-f152-4a80-97c9-5ee96bcba973`.

These events must remain. Cleanup must append corrective events; it must not erase the incident
trail.

## Isolation repair

Staging now has a dedicated managed PostgreSQL service `Postgres`
(`d31add97-5388-4c0f-b787-d46746df14a0`) and dedicated bucket `cleartrade-staging-isolated`
(`86da5701-3033-4c17-b993-77c21f43ef18`; physical bucket
`cleartrade-staging-isolated-j21z3g`). The staging web and worker now share only these staging
resources:

| Service | Database URL SHA-256 | Direct URL SHA-256 | Bucket-name SHA-256 | Storage access-key SHA-256 |
|---|---|---|---|---|
| staging web | `15b1dd6be8bd9704b7aa944403951e121e4d865d458d8db06190e801756961aa` | same | `a4422e9cc191ff41cd0dd356fe1f0ce951f37cfcf06a9550b946921bd0f7ab26` | `de889c577f3963c06e45b08b06ca17c9c6820942c614f4f56b5d53422db13845` |
| staging worker | same | same | same | same |

Those hashes differ from production. Both staging processes also carry
`DATABASE_IDENTITY_SHA256` and `STORAGE_IDENTITY_SHA256` pins. The runtime repair makes staging
fail at boot if the resolved database URL or the tuple `(endpoint, bucket, access key)` no longer
matches its approved pin, preventing a copied production variable set from silently starting.
The staging web deployment `a78faa78-1d87-44ad-af21-46588e10cc9a` and worker deployment
`7a0b9040-dcf4-4ae6-bdcc-e134a6def3ba` both reached `SUCCESS` after this rewire.

## Approval-gated cleanup procedure

Cleanup is not a normal Prisma delete. Database triggers reject deletion of
`MarketAccessEvidenceSnapshot`, `MarketAccessEvidence`, and `TaricRelease`; the release history also
has a restrictive self-reference. If cleanup is approved, use a reviewed, single-purpose DBA
transaction with exact-ID cardinality assertions:

1. Stop PE ingestion and obtain a production backup/restore point. Re-run the exact-ID inventory,
   object `HEAD` checks, reference search, and time-window search; abort on any mismatch or new
   descendant.
2. Append a production `AuditEvent` recording the approval, exact target IDs, hashes, operator,
   reason, and cleanup correlation. Never delete the two original audit events.
3. In one database transaction, lock the affected tables and temporarily disable only the named
   immutable-evidence/release user triggers. Delete the 12 `MarketAccessEvidence` rows and 10
   `MarketAccessTariffLine` rows, then the six `MarketAccessEvidenceSnapshot` rows. Delete the six
   `Job` rows (their six `JobAttempt` children cascade). Delete release
   `cmtwknwa00001ue4cslkjezso` first to clear its restrictive `previous_release_id`, then release
   `cmtw3xljo0001uerik9ppzcll`. Re-enable every trigger before commit; abort unless every affected
   count is exact and no other row changed.
4. After the database transaction commits, delete only the two exact object keys listed above.
   Object deletion is last because it is not rolled back with PostgreSQL. Verify both keys are gone
   and that no other object count/hash changed.
5. Append a second corrective audit event containing the database and object verification results,
   then restore PE ingestion. Verify there is no active production PE release and run read-only
   production health checks.

This procedure must not be executed without separate, explicit user approval.
