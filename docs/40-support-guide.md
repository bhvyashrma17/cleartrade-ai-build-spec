# Support guide (WP6)

Who answers what once real exporters use `www.cleartrade.in`, how to check the product is healthy,
what to do when something breaks, and which data needs refreshing when. It covers what is built on
the release that passed the Phase 1 gate (E-048) and went to production by docs/39.

**Support inbox:** `hello@cleartrade.in` (Zoho). **In-app bug reports:** `/app/support/report-bug`,
`/agent/support/report-bug`, `/ops/support/report-bug`.

## 1. Who does what

| Role | Owns |
|---|---|
| **Owner** (product and engineering owner) | Escalations; production changes (docs/39); provider accounts: Railway, Neon, Resend, Razorpay, UN Comtrade, Zoho, GoDaddy; every role below until it is staffed |
| **Ops supervisor** | Daily checks (§2), Demand Discovery health and data freshness (`/ops/discovery`), imports with an operator (§5), exceptions and assignments, sanctions status (`/ops/sanctions`) |
| **Ops finance** | Memberships and payments in Razorpay; refunds (§3.5) |
| **Agent** | Exporter questions; confirming product classifications; reviewing runs (promote, flag or reject beside the computed rank, never replacing it, docs/36 §7) |

Exporters see only their own organisation; agents only their assigned exporters; ops everything
(AGENTS.md). Support never works around that: it answers from the screen the person is allowed to see.

## 2. Daily checks (about five minutes)

1. `https://www.cleartrade.in/api/health/ready` returns `ready`: database, storage and worker.
2. `/ops` (Control Tower): **Stale data inputs** and open exceptions.
3. `/ops/discovery`: **Data freshness**, worst first; failed or partial runs since yesterday.
4. `/ops/sanctions`: the last refresh succeeded.
5. Railway: web, worker and scanner deployments are healthy; the worker's daily `input_freshness` line.
6. The support inbox and `/ops/support` (bug reports).

## 3. Common requests

### 3.1 "My Demand Discovery run failed" or "it's still running"
- Find the run in `/ops/discovery`. A partial run carries a note for every step that degraded it
  (R-34); a failed one says why.
- Fix the cause first: a provider outage (§4) or missing data (§5).
- Then start it again: the exporter or their agent presses **Run again** on the Demand Discovery
  screen (`POST /api/v1/discovery-runs`, paid tier), or a changed classification starts one by
  itself. Every run is a snapshot; never edit stored rows.
- A job left `processing` with `attempts: 0` is a worker started before a new job type: restart the
  worker (AGENTS.md). Stale jobs are also requeued automatically after `stale_after_seconds`.

### 3.1a "Where do I add my product?"
Markets → describe the product, pick its HS code (the code finder helps), tick "This code describes my
product" and press "Save product and find markets". The product is saved, the code is recorded as the
exporter's own confirmed classification, and Demand Discovery starts. Members only (D-039). Products
also has an "Add a product" button that leads there. "Add another product" on Markets adds more.

### 3.1b "Where are my buyers? Can I search them?"
Members don't search buyers themselves: their ClearTrade agent finds and vets importers in the
markets Demand Discovery hands on (docs/11 §7). Buyers shows, per product, those markets and how
many importers an official list holds there (UK: HMRC; Canada: the Canadian Importers Database),
and each market page says the same. Contacts arrive through the agent.

### 3.2 "The product code is wrong"
- The product code finder opens under every HS code field and asks the separating question.
- An agent, ops supervisor or admin confirms the classification; confirming a different code starts a
  new run automatically (D-018). The earlier run stays as history.
- Disagreements go to the ops supervisor, with the rationale written on the classification.

### 3.3 "Why is this market ranked low?" or "Where is market X?"
- The results page gives each market's reasons ("Ranked lower: …"), labels every estimate, and lists
  India's own top destinations with their ranks ("Where India already sells most").
- `not_enough_data` means fewer live data points than the policy needs; it is not a zero.
- Agents may promote, flag or reject a market beside its rank. Nobody changes a score by hand: the
  scoring and the gate are frozen with Phase 1 (E-048), and a change needs a new version, a new
  `PASS` on staging and a new sign-off (docs/34).

### 3.4 "These figures look old"
- Every figure names its source and years (E-037). `/ops/discovery` → Data freshness shows what is
  due or overdue; §5 says who refreshes it.

### 3.5 Payments and memberships
- Every tool runs for paid members only (D-039, docs/14 §3c). Visitors and free accounts see a sample
  and a "Create an account" or "See plans" button; "I signed up but can't run anything" is expected
  until they pay.
- A member without paying (the owner's test account, a partner the owner names) is a commitment-fee
  waiver: an admin runs `scripts/waive-commitment-fee.ts` with the account's email and a reason
  (production also needs `--confirm-production`, docs/39 §2). It is audited and does not expire.
  Only on the owner's instruction.
- Memberships are Razorpay subscriptions (monthly or annual). Access unlocks when Razorpay's
  webhook confirms the payment at `https://www.cleartrade.in/api/v1/billing/razorpay/webhook`.
- Paid but locked: in Razorpay, check that the payment was captured and look at the webhook's
  delivery log. A failed delivery is retried by Razorpay; if it keeps failing, escalate to the owner.
- Halted (a failed retry) and paused keep access until the paid-through date; cancelled keeps it
  until that date; expired or completed give none.
- Exporters cannot mark a fee paid themselves while Razorpay is configured, and can never claim a
  staff confirmation (bank partner, Account Aggregator, Ops) for themselves (E-049).
- Refunds: ops finance refunds in Razorpay and cancels the subscription there, then records it in the
  ledger. The app has no refund screen yet; never change a tier in the database by hand (the waiver
  script above is the one audited way to grant one).

### 3.6 Accounts and sign-in
- Sign-in is by email and password, or Google or Apple where enabled (docs/29).
- **Forgotten password:** "Forgot your password?" on the sign-in page sends a link that works once,
  for 30 minutes (at most three an hour per account). The page answers the same way whether or not
  the email has an account. Accounts made with Google or Apple sign in with them instead (E-050).
- A reset does not sign out sessions already open on other devices; they end when they expire.
- Staff join by invitation (`/ops/agents`); remove departing staff the same day.

### 3.7 Uploads
- Every upload is scanned by ClearTrade's own scanner before it is stored. If the scanner is down,
  uploads fail closed with a message and nothing unscanned is kept: check the scanner service's
  `/health/ready` and web's scanner settings (docs/39 §2.4).

### 3.8 Importer lists and personal data
- The UK list is HMRC's; it names sole traders, and HMRC honours opt-outs month by month. Import each
  new monthly file (a newer file supersedes its month), which drops opted-out entries (R-31).
- Any other request about personal data goes to the owner the same day.

### 3.9 Emails not arriving
- Resend's logs show each delivery and bounce. The sender is `NOTIFICATION_FROM_EMAIL`, a verified
  domain. Staging rewrites every recipient to its redirect address, so staging never mails a customer.

### 3.10 Bug reports
- Every report from the in-app forms appears in `/ops/support` (Bug reports in the Ops menu), newest
  first, and each active admin and ops supervisor gets an in-app notification (E-050). Reply within
  one working day from the support inbox.

## 4. When a provider is down

| Provider | What users see | What the product does | Support action |
|---|---|---|---|
| Neon (database) | Errors everywhere; readiness `database` fails | Nothing can run | Neon status page; escalate. Restore from a Neon branch only for damaged data (docs/39 §7) |
| Railway bucket (storage) | Readiness `storage` fails; uploads and runs fail | — | Check web's and worker's storage variables are references, not copies (docs/39 §2.2) |
| Worker | Runs stay queued; readiness `worker` fails | Jobs wait in the queue | Restart the worker in Railway |
| Scanner | Uploads refused | Fails closed | Restart or redeploy the scanner |
| UN Comtrade | Runs finish partial with a note | BACI carries the ranking | Start the run again after recovery |
| World Bank, Comtrade lists | Freshness row turns due or overdue | Daily auto-import retries; the other inputs still import | None unless overdue; then §5 |
| CEPII (BACI) | — | Yearly import by an operator | §5 |
| US Census | US regional demand "unavailable" with the reason | — | Check `CENSUS_API_KEY`; retry later |
| HMRC | UK buyers stay at the last imported month | — | Import the next month when published |
| Singapore Statutes Online | Singapore's tariff stays on its last good copy | Nightly refresh 03:00–07:00 SGT; failures recorded, the active release untouched (R-26) | None unless the copy passes 7 days old |
| ECB rates | A run note; the run is "Ranked, with gaps" | Runs read rates when missing and try a failed fetch once more after 3 s (E-057) | Start the run again once the ECB answers (on 10 Nov 2026 its IDR series was down for hours) |
| Resend | Emails delayed | Notification jobs retry | Resend status page |
| Razorpay | Checkout fails | Razorpay retries webhooks | Razorpay status page; §3.5 |

## 5. Data calendar

| When | What | Who and how |
|---|---|---|
| Daily, automatic | World Bank indicators and Comtrade's reporting lists (`reference_auto_import_actor_email` set); re-runs on new data (hourly, at most 100 a day); sanctions refresh (every 12 h); Singapore's tariff (nightly, in the window) | Worker. Check `/ops/discovery` and `/ops/sanctions` (§2) |
| Monthly | Sanctions programmes curated check (stale after 31 days, R-21); HMRC importer list (R-31); TARIC and Brazil's CAMEX workbook (stale after 45 days, R-29); published duty rules near their `review_by` (R-22); spot-check agent-entered tariff lines (R-23) | Ops supervisor with an operator: the source's own importer (docs/36 §10, docs/37); each import twice, the second UNCHANGED |
| Every six months | India's trade agreements; ECGC country risk (stale after 182 days; take ECGC's newest list) | Curated update, then `import-reference-dataset.ts` |
| Yearly | BACI's new release (due 1 January, overdue 1 March); currency pegs; the EAC Gazette (1 July, R-27); China's tariff (late December, R-29); the UAE CEPA year (R-29); directory links (R-22); tariff sources with no publishing rhythm, such as the GCC tariff and the UEMOA edition of the ECOWAS tariff (`scripts/recheck-authority-source.ts --list`, then fetch the files it names and run it with them: unchanged records the re-check, changed names the files to import, E-069) | Operator import or re-check; the ledger records each |

## 6. Incidents

1. **Confirm**: readiness, Railway deployments, the affected screen.
2. **Contain**: if the last release caused it, redeploy the previous deployment (docs/39 §7).
3. **Tell affected users** from the support inbox: what is affected and when to expect the next update.
4. **Fix**, then **record** a ledger entry: what happened, the cause, the fix and the check that proved it.

A leaked secret: rotate it as docs/39 §2.3 does (the provider key, then the variable); a new
`AUTH_SECRET` signs everyone out. Damaged data: the audit trail is append-only, so read it first;
restore a Neon branch only when the data cannot be corrected forward.

## 7. Changes and releases

- Every change: a PR into `staging/railway` with green CI, checked on staging, merged by the owner.
- A release: a PR from `staging/railway` into `master`, merged by the owner; production deploys by
  itself and its pre-deploy step applies migrations after the identity check.
- Never run seed, demo or pilot-seeding scripts against production; they refuse. The two operator
  scripts that may write there ask for `--confirm-production` (docs/39 §6).
