# 14 — Guest Access & Commercial Tiers

**This document supersedes the "all access is authenticated and tenant-scoped" assumption
that runs through `docs/01`–`docs/13`.** Those documents were written for a product where
every request carried a session and belonged to a paying tenant. That is no longer true:
Demand Discovery and Buyer Discovery are open to anonymous visitors.

Everything else in those documents still holds. In particular the tenancy rule holds
*more* strongly than before, not less — see §2.

---

## 1. The model in one paragraph

A guest is **a real `ExporterOrg` + `User` row with `tier = 'guest'` and a real session**.
There is no anonymous request path, no shadow session store, and no parallel "unregistered
user" system. `tenantScope()`, `canAccessOrg()` and every predicate in
`src/lib/permissions.ts` treat a guest tenant exactly like a paying one, because as far as
they are concerned it *is* one. The paywall is a **tier** check that sits beside the
existing **role** check; it is not an auth check.

The single most important consequence: **guest rows upgrade in place.** Registration fills
in the existing User and flips the org's tier. The org id never changes, so every row
already pointing at it survives without a migration between systems.

---

## 2. Two independent axes

| Axis | Question it answers | Source of truth |
|---|---|---|
| **Role** | May this *kind of user* do this at all? | `MATRIX` in `src/lib/permissions.ts` (docs/01 §5) |
| **Tier** | Has this *tenant* paid for it? | `CAPABILITY_MIN_TIER` in `src/lib/permissions.ts` |

Both must pass. `permits(principal, capability)` is the only place they combine, and every
predicate routes through it.

Tier is deliberately **not** a `UserRole`. Making it one would have forced a `guest:` entry
into all twenty capability blocks of the matrix — rewriting every existing permission check
— and would have modelled a commercial fact as an identity fact. A free org and a paid org
both contain `exporter_owner` users; what differs is what the tenant bought.

**Tenancy is orthogonal to tier and is unchanged.** `tenantScope()`, `tenantScopeVia()`,
`canAccessOrg()` and `assertOrgAccess()` were not modified for this feature and must not be.
A guest org is scoped like any other org, which is exactly why guest access does not open a
cross-tenant hole.

### Deny by default

Any capability **absent** from `CAPABILITY_MIN_TIER` requires `paid`. This is the safety
property a `guest` role would otherwise have provided: a capability added later is paid-only
until someone deliberately opens it, so the failure mode of forgetting is "too strict",
never "accidentally free".

---

## 3. Capability matrix

| Capability | Min tier | Notes |
|---|---|---|
| `market_estimate.run` | `guest` | The pre-membership estimate — see §3a. Additionally IP-capped, same budget as before — see §5 |
| `buyer_discovery.run` | `guest` | Results capped at `max_buyer_results` for guests |
| `exporter_profile.view` | `guest` | |
| `readiness.run` | `free` | |
| `buyer_contact.view` | `free` | The paid asset; see §4 |
| `buyer_lead.create` | `free` | Created with `assigned_agent_id = null` below `paid` |
| `exporter_master_data.edit` | `free` | |
| `commitment_fee.pay` | `free` | Records the fee paid and flips the org to `paid` — see §3a |
| `demand_discovery.run` | `paid` | **Changed.** Full ranked Demand Discovery — ranked markets, market detail, save/select — now requires the commitment fee paid. Was `guest`; guest/free get `market_estimate.run` instead |
| `market_assessment.save` | `paid` | **Changed**, same reason — save/select is part of "full" Demand Discovery |
| *everything else* | `paid` | Deals, documents, shipment, payment, outreach, disputes, payout, agent assignment, audit |

### 3a. The commitment fee gate (pre-membership estimate → full Discovery)

**This is not a new membership concept.** It is the commitment fee docs/01 §2 always
specified (`not_due` / `due` / `paid` / `waived` / `refunded`), now doing the work of
gating `paid` tier instead of sitting unused. `ExporterOrg` carries the fee's status,
amount/currency/policy-version snapshot, and paid-at/source — the same "rule of record"
a deal's quoted terms follow: the amount owed is fixed at the moment the fee becomes due
(registration), never re-read live against a later `FeePolicy` version.

```
visitor → market_estimate.run (guest) → register → due → pay → paid tier → demand_discovery.run
```

- **`market_estimate.run`** (`POST /api/v1/market-estimates`) is the guest-facing
  replacement for full Discovery: a synchronous, no-LLM read of the trade warehouse
  returning **observed historical import values and unit-price bands only** — never a
  ranking, never a projection. Framing is a product requirement, not copy preference:
  language is "buyers in these markets imported X at Y–Z per unit," with an explicit
  disclaimer that past trade data is not a forecast. See `src/lib/market-estimate.ts`.
  **This is now the "first search" that mints a guest tenant** (§5) — full ranked
  Discovery no longer does (it rejects an anonymous caller before any write; see §3a).
  The estimate itself is never persisted (no run row, computed fresh or served from
  cache each call) — only the guest tenant/session is a durable write, and only once per
  visitor. Spends against the **same** per-IP quota the guest floor always used, in the
  same quota-before-mint order `discovery-runs` established — not a separate budget.
- **The fee becomes `due` the moment registration completes** (`POST /api/v1/register`,
  both the guest-upgrade and fresh-signup branches) — snapshotted from the active
  `FeePolicy` at that instant.
- **Paying** (`PATCH /api/v1/exporter-org/commitment-fee`, `commitment_fee.pay`) is
  self-reported or Ops-confirmed via the same `PaymentSource` vocabulary buyer payments
  already use — this platform has no payment gateway, so "paid" here is the identical
  kind of milestone/visibility fact `Payment.status` already models for a different
  money event, not a promise that ClearTrade processed a transaction (docs/01's
  never-a-bank rule applies here too).
- Paying (or an Ops waiver) flips `tier: free → paid` in the same transaction as the
  status write — see `src/lib/state-machines/commitment-fee.ts`.

Role limits still apply independently. A **paid** exporter still cannot `outreach.send` or
`agent.assign` — those are agent/ops capabilities and no amount of money changes that.
Staff principals (agent, ops, admin) have no tenant and resolve to `tier: 'paid'`, so the
tier gate never fires on them.

### Error semantics

| Situation | Code | HTTP |
|---|---|---|
| Role denies it | `FORBIDDEN` | 403 |
| Role allows, tier denies | `UPGRADE_REQUIRED` + `required_tier` | 402 |
| Guest over IP quota | `RATE_LIMITED` | 429 |

The distinction is load-bearing: `FORBIDDEN` means "your role will never allow this",
`UPGRADE_REQUIRED` means "buy this and it works". Collapsing them makes it impossible to
render an upsell without re-deriving the reason on the client.

**Convention for every mutation route** — two checks, in this order:

```ts
assertCan(principal, 'the.capability');          // role + tier, distinct errors
await assertPermitted(canDoThing(principal, …)); // tenant scope
```

The resource predicates return a plain boolean and so cannot carry *why* they denied.
Calling one alone turns a tier denial into a bare `FORBIDDEN` and silently disables the
upsell. This was a real defect during implementation; it is why the order is written down.

---

## 4. What each tier gets

**Guest** — the pre-membership market estimate (hard cap, §5 — same budget `market_
estimate.run` always used) and Buyer Discovery. **Changed:** full ranked Demand Discovery
is no longer guest-tier — see §3a. Buyer **contacts are withheld**: the API omits the
relation entirely and returns `contacts_total` (a count) plus `contacts_locked: true`, so
the UI can say *"3 contacts hidden — create a free account"* rather than implying the
buyer has none. No readiness, no saved history, no leads, no agent workflow.

**Free** — everything above plus saved discovery history, full readiness, buyer contacts,
and their own lead pipeline. Leads are created **unassigned**: agent assignment is a paid
capability, so a free tenant owns its pipeline but no agent capacity is consumed. This is
enforced by tier, not by the absence of an assignment — a free org with an active
`AgentAssignment` row still gets `assigned_agent_id = null`. The commitment fee is `due`
from the moment of registration — free tier's next step is paying it, not running full
Demand Discovery, which still requires `paid` (§3a).

**Paid** — unlocked by paying the commitment fee (§3a): full ranked Demand Discovery
(ranked markets, market detail, save/select) plus the full agent-assisted workflow.

### Ad-hoc product context

Guests have **no `Product` rows, and none are ever created for them.** A guest types a
product description and optional HS code straight into discovery. That input is snapshotted
onto `DiscoveryRun.input_snapshot` (the immutable input snapshot docs/04 EXP-04-AC01 already
required), which for a guest is the only record of what was searched.

This is why `MarketAssessment.product_id` is nullable: an ad-hoc run produces assessments
with no Product to point at.

At registration the user is **offered** the choice to save that input as a real Product. It
is opt-in — a registration incentive, never an automatic side effect of signing up.

### Guest UI must show the boundary

docs/03 §5 and docs/00 §6 apply with full force: a withheld feature is rendered as a
labelled locked state with the reason and the next action (`UpgradeNotice`), never as a
blank space, a silently missing column, or a disabled control with no explanation. The nav
does not render routes the tier cannot reach (docs/03 §1) — a link to `/app/deals` for a
guest would be a dead end, not an upsell.

---

## 5. Guest lifecycle

```
visitor → [first SEARCH] → guest tenant → [registration] → free → [payment] → paid
              │                              │
              │                              └─ upgrade IN PLACE: same org id,
              │                                 same user id, runs survive
              └─ quota checked BEFORE anything is written
```

### Mint

The guest tenant is created on the **first search**, not the first page view. Browsing
costs nothing and creates nothing. Ordering inside `POST /api/v1/discovery-runs` is a
security control, not a style choice:

1. resolve + hash the client IP
2. **consume IP quota** — throws 429 before any row is written
3. mint `ExporterOrg` + `User` in one transaction
4. issue the guest session (`signIn('guest', …)`)
5. authorize, validate, create the run

If 2 and 3 were swapped, a script clearing its cookie between requests would grow
`ExporterOrg` without bound even while every search was correctly rejected — the quota would
limit AI spend but not database growth.

The guest `User` has `password_hash = null`, which means *this account cannot be logged
into*. `authorize()` rejects a null hash before bcrypt sees it. The email is synthetic on
the RFC 2606 reserved `.invalid` TLD, so it can never collide with or be mailed as a real
address.

The guest provider does **not** accept a caller-supplied user id — that would let anyone
request a session for an arbitrary account, including a paying one. The route presents a
server-issued HMAC proof (`guestMintProof`), and the provider additionally re-checks that
the target really is a passwordless guest-tier row.

### Upgrade

`POST /api/v1/register` with a guest session **upgrades in place**: same org id, same user
id, `tier: guest → free`, `guest_expires_at` cleared. Every `DiscoveryRun` already attached
stays attached and becomes visible history. Losing someone's search at the moment they sign
up is the worst possible time to lose it, so this is a hard requirement, not a nicety.

On an email collision the request is rejected and the guest session is left intact, so their
work stays reachable and they can sign in separately. Merging a guest tenant into an
existing one is a cross-tenant data move — precisely what `tenantScope()` exists to prevent
— and is not done implicitly during signup.

### Retention

Guest discovery runs **are persisted**. docs/09 §3 requires job state to survive a refresh
and a login on another device, and that applies to a guest exactly as to a paying tenant.
"Nothing saved" is therefore a **retention and visibility** property, not a write-path one:

- runs persist normally, and are audited normally;
- guests get no history UI at all;
- `scripts/purge-guests.ts` deletes expired guest tenants and their runs after
  `guest.policy.run_retention_days`;
- on registration the runs survive and become history.

The purge only ever touches `tier = 'guest'`, and upgrading clears `guest_expires_at`, so a
converted tenant can never be selected — verified by forcing a stale expiry onto an upgraded
org and confirming it survives.

---

## 6. Abuse & cost surface

Anonymous callers trigger AI jobs, which spend real money. The per-IP cap is necessary and
nowhere near sufficient.

| Risk | Mitigation | Status |
|---|---|---|
| Unmetered AI spend per caller | `discovery_runs_per_ip` per rolling window | Built |
| Cookie-clearing to reset the cap | Quota keyed on hashed IP, not on the guest row | Built |
| Row growth from repeated mints | Quota consumed **before** any write; purge job | Built |
| `X-Forwarded-For` spoofing | Only trusted proxy headers; XFF opt-in via `GUEST_TRUST_XFF` | Built |
| IP stored as personal data | HMAC-SHA256 with `GUEST_IP_HASH_SECRET`; hard failure if unset | Built |
| Scraping the buyer dataset | `max_buyer_results` ceiling for guests | Built |
| Duplicate identical searches | `Job.dedupe_key` / `JOB_ALREADY_RUNNING` | Schema ready, worker pending |
| **Total spend across many IPs** | Platform-wide daily guest budget + circuit breaker | **Not built** |
| **Guest jobs starving paid jobs** | Separate queue lane or concurrency cap by tier | **Not built** |
| Rotating datacenter/VPN IPs | Proof-of-work or CAPTCHA at mint; DC range blocking | Not built |

The two bolded gaps matter before this is exposed publicly. A per-IP cap bounds cost *per
attacker*, not in total: 10,000 IPs × 2 runs is still 20,000 AI calls. And guest jobs
sharing a queue with paid work means paying customers wait behind free load.

**CGNAT is why the window is rolling, not lifetime.** Indian mobile carriers put very large
numbers of real users behind one address; a lifetime cap would permanently lock out
legitimate prospects in the primary market. The trade-off is accepted knowingly: the cap is
also trivially reset by toggling airplane mode, so it is a speed bump against casual abuse,
not a defence against a determined attacker. The global budget is what actually bounds loss.

---

## 7. Configuration

All limits live in `guest.policy` (`src/lib/config.ts`), read through `getConfig()`. They
bound real money, so Ops must be able to retune them under load without a deploy — the same
rule docs/01 §2 applies to fees and SLAs. Nothing here is a constant in feature code.

| Key | Default | Meaning |
|---|---|---|
| `discovery_runs_per_ip` | 2 | Runs allowed per IP per window |
| `quota_window_hours` | 24 | Rolling window length |
| `run_retention_days` | 30 | Before an unconverted guest is purged |
| `session_days` | 30 | Guest session lifetime |
| `max_buyer_results` | 50 | Guest paging ceiling |

Required environment: `GUEST_IP_HASH_SECRET` (mandatory — the quota refuses to run without
it) and `GUEST_TRUST_XFF` (default `false`; enable only behind a proxy that *overwrites*
`X-Forwarded-For`).

---

## 8. Consequence for the portal boundary

`/app/layout.tsx` **no longer requires a session.** It cannot: a visitor has not been minted
as a guest until their first search, so a portal-wide auth guard would redirect them to
`/login` before they could run one.

Stated plainly, because it is a real shift in the security model: **the portal boundary is
no longer the authorization boundary for `/app`.** The layout still enforces the *role*
boundary (an agent or ops user has no business rendering the exporter shell), but every page
under `/app` must enforce its own requirement, and every route must call `assertCan()` for
the capability and tier it needs. Pages that assume a session must use
`requireExporterPrincipal()` themselves rather than relying on the layout.
