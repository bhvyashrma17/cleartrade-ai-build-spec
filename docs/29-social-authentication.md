# Social authentication (Google, Apple)

**No secret values appear in this document.** Variable names, semantic values and external
console settings only.

Continue with Google and Continue with Apple sit on the existing `/login` page, alongside the
existing credentials sign-in. Nothing about the credentials, guest, RBAC or onboarding
architecture changed; social sign-in is an additional provider on the same Auth.js v5
instance.

---

## 1. Architecture, and why there is no Prisma adapter

`@auth/prisma-adapter` is **not** installed and is deliberately not used.

The existing session strategy is `jwt`, and two of the three providers (credentials, guest)
mint sessions for rows that the adapter model does not describe — a guest is a `User` with a
null `password_hash` and a `guest`-tier org, created by `mintGuest()` under an IP quota.
Dropping the standard adapter in would have introduced a second, parallel notion of "user
record" (`Account`, `Session`, `VerificationToken`) next to the one the whole product already
scopes on, and `session.strategy` would have had to change with it.

Instead, social identity is bound through one purpose-built table:

```
AuthProviderAccount
  (provider, provider_account_id)  UNIQUE   -- one external identity -> exactly one local user
  (user_id, provider)              UNIQUE   -- one account per provider per user
  user_id -> User.id               CASCADE
```

Provisioning and lookup happen in `resolveSocialIdentity()` / `claimsForSocialAccount()`
(`src/lib/social-auth.ts`), called from the `signIn` and `jwt` callbacks in `src/lib/auth.ts`.
Auth.js still owns the OAuth flow itself, so **state, PKCE and CSRF protection are unchanged** —
there is no hand-rolled OAuth anywhere.

The session contract is also unchanged: the JWT carries `id`/`role`/`exporter_org_id` as a
*hint*, and `getPrincipal()` re-reads the user row on every request. A social user whose role
changes or who is deactivated loses access immediately, exactly like a credentials user.

## 2. How a social user differs from a credentials user

Both paths land in the same place — `role = exporter_owner`, a `free`-tier `ExporterOrg`, and a
commitment fee marked `due` at the same policy version. The differences are:

| | Credentials registration (`POST /api/v1/register`) | Social sign-in (`resolveSocialIdentity`) |
|---|---|---|
| `User.password_hash` | bcrypt hash | **`null`** |
| `User.name` | user-supplied | provider display name, else the email local-part |
| `ExporterOrg.display_name` | user-supplied `organization_name` | **derived** — `"<FirstWord> Exports"` |
| `AuthProviderAccount` | none | one row, `(provider, provider_account_id)` |
| Audit event | `object_type: 'exporter_org'` | `object_type: 'user'`, `after_summary.via_oauth = true` |
| Guest upgrade-in-place | supported | **not supported** — see §7 |
| Can use email/password login | yes | no, until a password is set |

The `password_hash = null` overlap with guest rows is load-bearing and worth stating plainly:
the guest credentials provider requires **both** `password_hash === null` **and**
`exporter_org.tier === 'guest'`. The tier check is the only thing preventing a valid guest mint
proof from being used to impersonate a social account. `tests/social-auth.test.ts` asserts that
check still exists.

## 3. Account-linking behaviour — precise, per case

ClearTrade **never links by email alone**, and `allowDangerousEmailAccountLinking` is not set on
any provider. Linkage exists only through a durable `AuthProviderAccount` row.

| # | Situation | Behaviour |
|---|---|---|
| 1 | Google email that does not exist locally | New `User` + new `free` `ExporterOrg` + `AuthProviderAccount`. Role `exporter_owner`. |
| 2 | Provider account already linked | Signs into the linked user. No writes, no name/email overwrite. |
| 3 | Credentials user with the **same email** | **Refused.** `email_conflict` → `/login?error=OAuthEmailConflict`. The user is told to sign in with their existing method and ask support to link. No automatic linkage, so a Google account cannot take over a password account. |
| 4 | Existing Apple account | Same as case 2, keyed on Apple's stable `sub`. |
| 5 | Apple private-relay email | Accepted and stored as the account email. Relay addresses are Apple-controlled and deliverable, so they are treated as ordinary verified emails. |
| 6 | No usable/verified email | **Refused.** Missing email → `missing_email`; Google with `email_verified !== true` → `email_not_verified`. Both surface as `OAuthEmailUnavailable`. |
| 7 | Duplicate provider account | Prevented at the database level by `(provider, provider_account_id)` UNIQUE. Re-presenting the identity resolves to the original user; it can never be re-pointed at a second one. |
| 8 | Authenticated user linking another provider | **Not supported.** There is no self-service linking UI, so there is no flow to abuse. Linking is a support operation. |

Deactivated accounts are refused at both gates — `signIn` returns `AccessDenied`, and
`claimsForSocialAccount()` returns null so no JWT claim can be minted either.

## 4. New-user onboarding

A brand-new social identity receives exactly the safe exporter state, and nothing more:

- `role = exporter_owner` — never `agent`, `admin`, `ops_supervisor` or `ops_finance`. Those
  strings do not appear anywhere in `social-auth.ts`, and a test asserts their absence so a
  future edit that introduces one fails loudly.
- A **new** `ExporterOrg` at `tier = free`, with the commitment fee `due` at the current policy
  version — identical to a fresh credentials registration.
- No agent assignment, no ops membership, no privileged org membership.
- Onboarding is **not** bypassed: the user lands in the normal exporter portal with the same
  readiness/commitment-fee state a newly registered user has.

## 5. Google — exact console values

Google Cloud Console → **APIs & Services → Credentials → Create credentials → OAuth client ID**
→ Application type **Web application**.

Create **one client per environment**; do not add localhost to the staging credential.

**Local development client**

| Field | Value |
|---|---|
| Authorised JavaScript origins | `http://localhost:3000` |
| Authorised redirect URIs | `http://localhost:3000/api/auth/callback/google` |

**Staging client**

| Field | Value |
|---|---|
| Authorised JavaScript origins | `https://cleartrade-ai-build-spec-staging.up.railway.app` |
| Authorised redirect URIs | `https://cleartrade-ai-build-spec-staging.up.railway.app/api/auth/callback/google` |

Then set, per environment:

```
AUTH_GOOGLE_ID       = <the OAuth client ID>
AUTH_GOOGLE_SECRET   = <the OAuth client secret>
```

**Scopes: `openid email profile` only.** That is set explicitly in `auth.ts` rather than left
to the provider default, so a future dependency bump cannot silently widen it. No Gmail,
Drive, Calendar or Contacts scope is requested — those would require a Google verification
review and would give the app access it has no reason to hold. The OAuth consent screen needs
only the three non-sensitive scopes, which keeps it out of sensitive-scope verification.

`prompt: 'select_account'` is set so a shared browser does not silently reuse whichever Google
account happens to be signed in.

## 6. Apple — exact external setup

Apple sign-in cannot be completed from this repository alone. All of the following happens in
the Apple Developer portal, and requires a **paid** Apple Developer Program membership.

1. **App ID** — Certificates, Identifiers & Profiles → Identifiers → **App IDs**. Enable the
   *Sign In with Apple* capability.
2. **Services ID** — Identifiers → **Services IDs**. This value becomes `AUTH_APPLE_ID`
   (e.g. `com.cleartrade.staging.signin`). Create one per environment.
   Configure *Sign In with Apple* on it:
   - **Domains and Subdomains**: `cleartrade-ai-build-spec-staging.up.railway.app`
   - **Return URLs**: `https://cleartrade-ai-build-spec-staging.up.railway.app/api/auth/callback/apple`
   - Apple **rejects `http://` and bare `localhost`** return URLs. Local Apple sign-in
     therefore needs an https tunnel (e.g. a named dev domain) registered as its own Services
     ID — which is why Apple stays disabled locally by default.
3. **Key** — Keys → **+** → enable *Sign In with Apple* → download the `AuthKey_XXXXXXXXXX.p8`
   **once** (Apple will not let you download it again). Note the **Key ID**.
4. **Team ID** — top right of the developer portal / Membership details.

### Generating and rotating `AUTH_APPLE_SECRET`

Apple does not issue a static client secret. It is an **ES256 JWT you sign yourself**, and
Apple caps its lifetime at ~6 months, so this is a recurring operational task:

```bash
npm run secrets:apple -- \
  --key-file ~/secure/AuthKey_ABC1234567.p8 \
  --team-id  <TEAM_ID> \
  --key-id   <KEY_ID> \
  --client-id <SERVICES_ID>
```

The script (`scripts/generate-apple-client-secret.ts`) writes a `0600`
`.env.apple.secret` containing only `AUTH_APPLE_SECRET=…`, and prints a fingerprint and the
**exact expiry** — never the JWT, never the private key. Transfer the value into the target
environment, then delete the file.

Rules for the `.p8`:

- **Never commit it.** `.gitignore` excludes `*.p8` and `.env.apple.secret`.
- Store it in a secret manager or offline; it can mint credentials for the Services ID until
  revoked, so it outranks the JWT it produces.
- If it leaks, revoke the key in the Apple portal and generate a new one — rotating only
  `AUTH_APPLE_SECRET` does not help, because the leaked key can mint more.

**Diarise the expiry.** When the JWT expires Apple returns an opaque `invalid_client` and
Apple sign-in stops working with no other signal. Nothing in the app can detect this in
advance, because the secret is opaque to it.

## 7. Known limitations

- **A guest who signs up with Google or Apple does not get an upgrade-in-place.** The
  credentials registration path deliberately upgrades a guest's existing `ExporterOrg` so their
  discovery history survives signup. Social sign-in creates a fresh tenant instead, so a guest
  who converts via Google starts empty. This is called out rather than silently implemented:
  attaching a guest session to an external identity mid-OAuth-callback is a linkage decision
  with real takeover surface, and it needs a product decision about proof of ownership first.
  Guest emails are synthetic (`@guest.invalid`), so there is no email collision either way.
- **The organisation display name is derived**, not chosen — `"<FirstWord> Exports"`. A social
  user cannot name their organisation during signup because OAuth returns no such field. The
  name is editable afterwards; a first-run prompt would be the better fix.
- **Apple is disabled locally by default**, because Apple refuses `http://localhost` return
  URLs. The button renders in a clearly disabled state with an explanatory line rather than
  redirecting into a guaranteed failure.
- **No self-service provider linking.** Case 3 and case 8 both route to support.

## 8. Enablement and failure modes

A provider appears in the UI only when **both** of its variables are set
(`socialProviderStates()`). Enablement is re-checked server-side in `startSocialSignIn()` — the
disabled button is a UI affordance, not a control, so a hand-crafted POST is rejected too.

`validateRuntimeEnvironment` enforces, in staging and production only, that each provider's ID
and secret are **either both set or both absent**. A half-configured provider is a hard startup
failure; an entirely absent provider is not — so Apple not yet being enabled does not block
deployment, per current product policy. Placeholder values are rejected in real environments.

Errors surface on `/login` through `loginErrorMessage()` and never leak provider internals:

| Query error | Message shown |
|---|---|
| `OAuthEmailConflict` / `OAuthAccountNotLinked` | already registered with a different sign-in method |
| `OAuthEmailUnavailable` | provider returned no usable verified email |
| `OAuthProviderDisabled` | not configured in this environment |
| `AccessDenied` | cancelled or denied |
| `OAuthSignin` / `OAuthCallback` / `OAuthCreateAccount` | could not be completed, try again |

`callbackUrl` is preserved across the whole redirect and normalised by
`normalizeCallbackUrl()`, which permits only same-site paths plus the configured
`NEXT_PUBLIC_APP_URL` origin — an off-site `callbackUrl` collapses to `/` rather than becoming
an open redirect out of the login page.
