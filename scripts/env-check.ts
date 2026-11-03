/**
 * `npm run env:check` — report environment configuration health without printing values.
 *
 * Two things go wrong with environment configuration, and neither is visible by reading a
 * file: a variable the current environment needs is absent, and a variable belonging to a
 * *different* environment has leaked into this one. This reports both.
 *
 * SAFETY: this script never prints a variable's value, and never a fingerprint from which a
 * short value could be recovered. It prints presence, classification, and — for a small set
 * of non-secret mode/identity variables whose whole purpose is to be read by a human — the
 * literal value. Those are listed explicitly in `SHOW_VALUE`; everything else reports
 * `set` / `missing` only. `validateRuntimeEnvironment`'s error strings name variables and
 * never echo their contents, so they are safe to surface verbatim.
 *
 * Exit code is 1 when something required for the detected environment is missing or a
 * forbidden value is present, so this can gate CI. A warning alone does not fail the run.
 */

import { existsSync } from 'node:fs';
import { appEnvironment, isRealWorkflowEnvironment, type ClearTradeEnvironment } from '../src/lib/evidence-environment';
import { envFilePolicyProblem } from './env-file-policy';
import { validateRuntimeEnvironment, type RuntimeRole } from '../src/lib/runtime-config';

type Need = 'required' | 'recommended' | 'optional' | 'forbidden';
type Class = 'secret' | 'public';

interface Entry {
  name: string;
  cls: Class;
  provider: string;
  /** Requirement per environment. Omitted environments default to 'optional'. */
  local?: Need;
  staging?: Need;
  production?: Need;
  note?: string;
}

/**
 * Non-secret variables whose value is the thing an operator needs to see. Anything not in
 * this set is reported as set/missing only, regardless of how harmless it looks.
 */
const SHOW_VALUE = new Set([
  'APP_ENV', 'NODE_ENV', 'DATABASE_ENVIRONMENT', 'NEXT_PUBLIC_APP_URL', 'COMTRADE_CLIENT',
  'DISCOVERY_ENGINE', 'RATIONALE_WRITER', 'STORAGE_BACKEND', 'STORAGE_REGION',
  'STORAGE_FORCE_PATH_STYLE', 'STORAGE_SERVER_SIDE_ENCRYPTION', 'DOCUMENT_MALWARE_SCANNER',
  'DOCUMENT_ENGINE', 'NOTIFICATION_PROVIDER', 'ERROR_REPORTING_PROVIDER', 'GUEST_TRUST_XFF',
  'AUTH_TRUST_HOST', 'REQUIRE_WORKER_READY', 'IMPORT_BUYER_REF_KEY_VERSION', 'PAYMENTS_DISABLED',
  'IMPORT_RAW_IDENTITY_KEY_VERSION', 'SANCTIONS_REQUIRE_ARTIFACT_RETENTION',
]);

/** Placeholders that must never reach a real environment; mirrors runtime-config.ts. */
const PLACEHOLDERS = new Set(['REPLACE', 'REPLACE_WITH_SECRET_MANAGER_VALUE', 'changeme', 'change-me', 'placeholder', 'todo', 'example']);

const INVENTORY: Entry[] = [
  // --- Environment identity -------------------------------------------------------------
  { name: 'APP_ENV', cls: 'public', provider: 'ClearTrade', local: 'required', staging: 'required', production: 'required', note: 'Gates every real-environment rule' },
  { name: 'DATABASE_ENVIRONMENT', cls: 'public', provider: 'ClearTrade', local: 'required', staging: 'required', production: 'required', note: 'Must equal APP_ENV in real environments' },
  { name: 'NEXT_PUBLIC_APP_URL', cls: 'public', provider: 'ClearTrade', local: 'required', staging: 'required', production: 'required', note: 'https required in real environments; baked into client bundle' },
  { name: 'EVIDENCE_DEMO_MODE', cls: 'public', provider: 'ClearTrade', note: 'Opt into demo evidence labelling' },
  { name: 'DANGEROUS_ALLOW_PRODUCTION_FIXTURES', cls: 'public', provider: 'ClearTrade', staging: 'forbidden', production: 'forbidden', note: 'Emergency fixture override only' },

  // --- Database -------------------------------------------------------------------------
  { name: 'DATABASE_URL', cls: 'secret', provider: 'managed Postgres', local: 'required', staging: 'required', production: 'required', note: 'Pooled; sslmode required in real environments' },
  { name: 'DIRECT_DATABASE_URL', cls: 'secret', provider: 'managed Postgres', local: 'recommended', staging: 'required', production: 'required', note: 'Unpooled; required for the migration role' },
  { name: 'DATABASE_IDENTITY_SHA256', cls: 'secret', provider: 'ClearTrade', staging: 'required', production: 'required', note: 'SHA-256 pin of the resolved DATABASE_URL; prevents cross-environment URL reuse' },
  { name: 'DIRECT_DATABASE_IDENTITY_SHA256', cls: 'secret', provider: 'ClearTrade', staging: 'required', production: 'required', note: 'Independent SHA-256 pin of the resolved DIRECT_DATABASE_URL; gates migrations and direct operations' },
  { name: 'RESTORE_DRILL_DATABASE_URL', cls: 'secret', provider: 'managed Postgres', note: 'Restore drill only; URL must contain restore_drill' },

  // --- Auth / crypto (ClearTrade-generated) ---------------------------------------------
  { name: 'AUTH_SECRET', cls: 'secret', provider: 'generated', local: 'required', staging: 'required', production: 'required', note: 'min 32 chars in real environments' },
  { name: 'AUTH_TRUST_HOST', cls: 'public', provider: 'ClearTrade' },
  { name: 'AUTH_GOOGLE_ID', cls: 'secret', provider: 'Google OAuth', note: 'Optional. If set, AUTH_GOOGLE_SECRET must also be set.' },
  { name: 'AUTH_GOOGLE_SECRET', cls: 'secret', provider: 'Google OAuth', note: 'Optional. If set, AUTH_GOOGLE_ID must also be set.' },
  { name: 'AUTH_APPLE_ID', cls: 'secret', provider: 'Apple OAuth', note: 'Optional. If set, AUTH_APPLE_SECRET must also be set.' },
  { name: 'AUTH_APPLE_SECRET', cls: 'secret', provider: 'Apple OAuth', note: 'Optional. ES256 JWT, expires <=6 months — see docs/29 for rotation.' },
  // Generation-time only: consumed by `npm run secrets:apple`, never read at runtime.
  { name: 'APPLE_TEAM_ID', cls: 'public', provider: 'Apple Developer', note: 'Only needed to GENERATE AUTH_APPLE_SECRET' },
  { name: 'APPLE_KEY_ID', cls: 'public', provider: 'Apple Developer', note: 'Only needed to GENERATE AUTH_APPLE_SECRET' },
  { name: 'APPLE_AUTH_KEY_FILE', cls: 'public', provider: 'Apple Developer', note: 'Path to the .p8 signing key; never commit the key itself' },
  { name: 'GUEST_IP_HASH_SECRET', cls: 'secret', provider: 'generated', local: 'required', staging: 'required', production: 'required' },
  { name: 'GUEST_TRUST_XFF', cls: 'public', provider: 'ClearTrade', note: 'Only true behind a proxy that overwrites XFF' },
  { name: 'OPERATIONS_TOKEN', cls: 'secret', provider: 'generated', staging: 'required', production: 'required', note: 'Local: unset is fine; APP_ENV=development opens /api/metrics' },
  { name: 'IMPORT_BUYER_REF_SECRET', cls: 'secret', provider: 'generated', local: 'required', staging: 'required', production: 'required' },
  { name: 'IMPORT_BUYER_REF_KEY_VERSION', cls: 'public', provider: 'generated', staging: 'required', production: 'required' },
  { name: 'IMPORT_BUYER_REF_PREVIOUS_SECRETS', cls: 'secret', provider: 'generated', note: 'JSON keyed by version; rotation state' },
  { name: 'IMPORT_RAW_IDENTITY_ENCRYPTION_KEY', cls: 'secret', provider: 'generated', local: 'required', staging: 'required', production: 'required', note: 'Exactly 32 bytes base64 in real environments' },
  { name: 'IMPORT_RAW_IDENTITY_KEY_VERSION', cls: 'public', provider: 'generated', staging: 'required', production: 'required' },
  { name: 'IMPORT_RAW_IDENTITY_PREVIOUS_KEYS', cls: 'secret', provider: 'generated', note: 'JSON keyed by version; needed to decrypt historical rows' },

  // --- Comtrade -------------------------------------------------------------------------
  { name: 'COMTRADE_CLIENT', cls: 'public', provider: 'ClearTrade', local: 'required', staging: 'required', production: 'required', note: 'mock locally; must be real in staging/production' },
  { name: 'COMTRADE_API_KEY', cls: 'secret', provider: 'UN Comtrade', staging: 'required', production: 'required', note: 'Only needed locally when COMTRADE_CLIENT=real' },
  { name: 'COMTRADE_BASE_URL', cls: 'public', provider: 'UN Comtrade' },

  // --- Discovery / scoring / documents --------------------------------------------------
  { name: 'DISCOVERY_ENGINE', cls: 'public', provider: 'ClearTrade', staging: 'recommended', production: 'recommended', note: 'mock is rejected in real environments' },
  { name: 'DISCOVERY_MOCK_LATENCY_MS', cls: 'public', provider: 'ClearTrade' },
  { name: 'RATIONALE_WRITER', cls: 'public', provider: 'ClearTrade', note: 'template | claude' },
  { name: 'ANTHROPIC_API_KEY', cls: 'secret', provider: 'Anthropic', note: 'Required only when RATIONALE_WRITER=claude' },
  { name: 'DOCUMENT_ENGINE', cls: 'public', provider: 'ClearTrade', note: 'mock (default) | legacy — explicit only, never inferred' },

  // --- Storage --------------------------------------------------------------------------
  { name: 'STORAGE_BACKEND', cls: 'public', provider: 'ClearTrade', local: 'required', staging: 'required', production: 'required', note: 'local on a dev machine; must be s3 in real environments' },
  { name: 'STORAGE_BUCKET', cls: 'public', provider: 'object storage', staging: 'required', production: 'required' },
  { name: 'STORAGE_REGION', cls: 'public', provider: 'object storage', staging: 'required', production: 'required' },
  { name: 'STORAGE_ENDPOINT', cls: 'public', provider: 'object storage', note: 'Non-AWS S3-compatible endpoints' },
  { name: 'STORAGE_FORCE_PATH_STYLE', cls: 'public', provider: 'object storage' },
  { name: 'STORAGE_SERVER_SIDE_ENCRYPTION', cls: 'public', provider: 'object storage', note: 'AES256 | aws:kms' },
  { name: 'STORAGE_PUBLIC_BASE_URL', cls: 'public', provider: 'object storage', note: 'Used only to probe that the bucket is private' },
  { name: 'AWS_ACCESS_KEY_ID', cls: 'secret', provider: 'object storage', staging: 'required', production: 'required', note: 'Read by the AWS SDK credential chain, not by app code' },
  { name: 'AWS_SECRET_ACCESS_KEY', cls: 'secret', provider: 'object storage', staging: 'required', production: 'required', note: 'Prefer workload identity where available' },
  { name: 'STORAGE_IDENTITY_SHA256', cls: 'secret', provider: 'ClearTrade', staging: 'required', note: 'SHA-256 pin of endpoint, bucket and access-key identity; prevents cross-environment storage reuse' },
  { name: 'UPLOAD_MAX_BYTES', cls: 'public', provider: 'ClearTrade', note: 'Defaults to 25 MiB' },

  // --- Malware scanner ------------------------------------------------------------------
  { name: 'DOCUMENT_MALWARE_SCANNER', cls: 'public', provider: 'ClearTrade', local: 'required', staging: 'required', production: 'required', note: 'development locally; must be http in real environments' },
  { name: 'DOCUMENT_MALWARE_SCANNER_URL', cls: 'public', provider: 'self-hosted', staging: 'required', production: 'required', note: 'https enforced' },
  { name: 'DOCUMENT_MALWARE_SCANNER_TOKEN', cls: 'secret', provider: 'self-hosted', staging: 'recommended', production: 'recommended', note: 'Must equal the scanner service SCANNER_AUTH_TOKEN' },
  { name: 'DOCUMENT_MALWARE_SCANNER_TIMEOUT_MS', cls: 'public', provider: 'ClearTrade' },
  { name: 'DOCUMENT_MALWARE_SCANNER_MAX_BYTES', cls: 'public', provider: 'ClearTrade' },

  // --- Notifications --------------------------------------------------------------------
  { name: 'NOTIFICATION_PROVIDER', cls: 'public', provider: 'ClearTrade', local: 'required', staging: 'required', production: 'required', note: 'sandbox locally; http|resend in real environments' },
  { name: 'RESEND_API_KEY', cls: 'secret', provider: 'Resend', note: 'Required when NOTIFICATION_PROVIDER=resend' },
  { name: 'NOTIFICATION_PROVIDER_API_KEY', cls: 'secret', provider: 'email provider', note: 'Required when NOTIFICATION_PROVIDER=http' },
  { name: 'NOTIFICATION_PROVIDER_URL', cls: 'public', provider: 'email provider', note: 'Required when NOTIFICATION_PROVIDER=http' },
  { name: 'NOTIFICATION_FROM_EMAIL', cls: 'public', provider: 'Resend', note: 'Must be a verified sender' },
  { name: 'NOTIFICATION_ALLOWED_RECIPIENTS', cls: 'public', provider: 'ClearTrade', note: 'Outside production, this or NOTIFICATION_REDIRECT_TO is required' },
  { name: 'NOTIFICATION_REDIRECT_TO', cls: 'public', provider: 'ClearTrade', note: 'Funnels all staging mail to one inbox' },

  // --- Payments (Razorpay) ---------------------------------------------------------------
  // All five or none — `isRazorpayConfigured()` is all-or-nothing, and `runtime-config.ts`
  // enforces that partial configuration fails at boot rather than at first checkout.
  { name: 'RAZORPAY_KEY_ID', cls: 'secret', provider: 'Razorpay', production: 'required', note: 'LIVE key in production, TEST key locally. Never the same value in both.' },
  { name: 'RAZORPAY_KEY_SECRET', cls: 'secret', provider: 'Razorpay', production: 'required', note: 'Paired with RAZORPAY_KEY_ID; all five payment variables are required together' },
  { name: 'RAZORPAY_WEBHOOK_SECRET', cls: 'secret', provider: 'Razorpay', production: 'required', note: 'Per-environment; the only thing authenticating the webhook endpoint' },
  { name: 'RAZORPAY_PLAN_ID_MONTHLY', cls: 'public', provider: 'Razorpay', production: 'required', note: 'Test-mode and live-mode plan ids are distinct objects' },
  { name: 'RAZORPAY_PLAN_ID_ANNUAL', cls: 'public', provider: 'Razorpay', production: 'required', note: 'Test-mode and live-mode plan ids are distinct objects' },
  { name: 'PAYMENTS_DISABLED', cls: 'public', provider: 'ClearTrade', note: 'Set to true to run production deliberately without payments; refused alongside Razorpay keys' },

  // --- Workers / operations -------------------------------------------------------------
  { name: 'REQUIRE_WORKER_READY', cls: 'public', provider: 'ClearTrade', staging: 'recommended', production: 'recommended', note: 'Readiness requires a live worker heartbeat' },
  { name: 'WORKER_HEARTBEAT_INTERVAL_MS', cls: 'public', provider: 'ClearTrade' },
  { name: 'WORKER_READY_MAX_AGE_MS', cls: 'public', provider: 'ClearTrade' },
  { name: 'WORKER_MAX_CONSECUTIVE_FAILURES', cls: 'public', provider: 'ClearTrade' },
  { name: 'WORKER_INSTANCE_ID', cls: 'public', provider: 'platform' },
  { name: 'ERROR_REPORTING_PROVIDER', cls: 'public', provider: 'ClearTrade', note: 'log until a vendor is selected' },
  { name: 'BACKUP_DIRECTORY', cls: 'public', provider: 'ClearTrade', note: 'db-backup.sh target' },
  { name: 'PORT', cls: 'public', provider: 'platform' },

  // --- Sanctions ------------------------------------------------------------------------
  { name: 'SANCTIONS_REFRESH_HOURS', cls: 'public', provider: 'ClearTrade', note: 'Cadence; per-dataset overrides use SANCTIONS_REFRESH_HOURS_<DATASET>' },
  { name: 'SANCTIONS_LEASE_TTL_MINUTES', cls: 'public', provider: 'ClearTrade' },
  { name: 'SANCTIONS_REQUIRE_ARTIFACT_RETENTION', cls: 'public', provider: 'ClearTrade', note: 'Unset defaults to required in real environments' },
  { name: 'SANCTIONS_MAX_AGE_DAYS', cls: 'public', provider: 'compliance policy', note: 'Freshness threshold, not a refresh cadence' },
];

function needFor(entry: Entry, env: ClearTradeEnvironment): Need {
  if (env === 'staging') return entry.staging ?? 'optional';
  if (env === 'production') return entry.production ?? 'optional';
  return entry.local ?? 'optional';
}

// Colour only when attached to a terminal, so redirecting this report to a file or a CI log
// produces plain text rather than raw escape sequences.
const colour = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const sgr = (code: string) => (colour ? `\u001b[${code}m` : '');
const GREEN = sgr('32'), RED = sgr('31'), YELLOW = sgr('33'), DIM = sgr('2'), RESET = sgr('0');

function main() {
  const env = process.env;
  const environment = appEnvironment(env);
  const real = isRealWorkflowEnvironment(env);
  const role = (process.argv.find((a) => a.startsWith('--role='))?.split('=')[1] ?? 'web') as RuntimeRole;

  console.log(`\nClearTrade environment check`);
  console.log(`${DIM}No variable values are printed except the non-secret mode/identity fields below.${RESET}`);
  console.log(`\n  environment  ${environment}${real ? '  (real workflow environment — fail-closed rules active)' : '  (non-real — mocks and local stand-ins permitted)'}`);
  console.log(`  role         ${role}`);
  console.log(`  NODE_ENV     ${env.NODE_ENV ?? '(unset)'}\n`);

  const errors: string[] = [];
  const warnings: string[] = [];
  const rows: string[] = [];

  for (const entry of INVENTORY) {
    const need = needFor(entry, environment);
    const raw = env[entry.name];
    const present = Boolean(raw?.trim());
    const shown = present && SHOW_VALUE.has(entry.name) ? raw!.trim() : present ? 'set' : 'missing';

    let mark = present ? `${GREEN}ok${RESET}` : `${DIM}-${RESET}`;
    if (need === 'required' && !present) { mark = `${RED}MISSING${RESET}`; errors.push(`${entry.name} is required in ${environment}.`); }
    else if (need === 'recommended' && !present) { mark = `${YELLOW}advise${RESET}`; warnings.push(`${entry.name} is recommended in ${environment}${entry.note ? ` — ${entry.note}` : ''}.`); }
    else if (need === 'forbidden' && present) { mark = `${RED}FORBIDDEN${RESET}`; errors.push(`${entry.name} must not be set in ${environment}.`); }

    if (present && real && PLACEHOLDERS.has(raw!.trim())) { mark = `${RED}PLACEHOLDER${RESET}`; errors.push(`${entry.name} still holds an example placeholder.`); }

    rows.push(`  ${mark.padEnd(20)} ${entry.name.padEnd(38)} ${entry.cls.padEnd(7)} ${DIM}${entry.provider.padEnd(18)}${RESET} ${shown === 'set' || shown === 'missing' ? DIM + shown + RESET : shown}`);
  }

  console.log(`  ${'STATUS'.padEnd(11)} ${'VARIABLE'.padEnd(38)} ${'CLASS'.padEnd(7)} ${'PROVIDER'.padEnd(18)} VALUE`);
  console.log(rows.join('\n'));

  // File-level policy before value-level checks: a stray `.env` changes what every later
  // line in this report means, so it is reported as an error, not a warning.
  const filePolicy = envFilePolicyProblem((file) => existsSync(file), real);
  if (filePolicy) errors.push(filePolicy.message);

  // Cross-environment leak detection: the most damaging misconfiguration is a local
  // checkout pointed at a real database or bucket, which no per-variable check would catch.
  if (!real) {
    const dbUrl = env.DATABASE_URL ?? '';
    if (/neon\.tech|pooler|amazonaws|supabase|railway/i.test(dbUrl))
      warnings.push('DATABASE_URL looks like a hosted provider while APP_ENV is not staging/production. Local development should target a local database.');
    if (/sslmode=(require|verify)/i.test(dbUrl) && !/localhost|127\.0\.0\.1/.test(dbUrl))
      warnings.push('DATABASE_URL requests TLS to a non-local host — confirm this is a deliberate, controlled staging test.');
    if (env.STORAGE_BACKEND === 's3') warnings.push('STORAGE_BACKEND=s3 outside a real environment writes to real object storage.');
    if (env.COMTRADE_CLIENT === 'real') warnings.push('COMTRADE_CLIENT=real spends the shared UN Comtrade quota from a dev machine. Use mock unless deliberately testing the live client.');
    if (env.NOTIFICATION_PROVIDER === 'resend') warnings.push('NOTIFICATION_PROVIDER=resend can send real email from a dev machine. Use sandbox locally.');
    // The one payment misconfiguration that charges a real customer's card from a laptop.
    if (env.RAZORPAY_KEY_ID?.startsWith('rzp_live_')) warnings.push('RAZORPAY_KEY_ID is a LIVE key outside a real environment — this takes real money. Live keys belong in Railway Variables only; use a rzp_test_ key locally.');
  }

  // Finally, the authoritative check: would the app actually boot with this configuration?
  let boots = true;
  let bootError = '';
  try { validateRuntimeEnvironment(role, env); } catch (e) { boots = false; bootError = e instanceof Error ? e.message : String(e); }

  console.log(`\n  runtime validation (${role}): ${boots ? `${GREEN}passes${RESET}` : `${RED}fails${RESET}`}`);
  if (!boots) console.log(`    ${bootError}`);

  if (warnings.length) {
    console.log(`\n${YELLOW}  warnings${RESET}`);
    for (const w of warnings) console.log(`    - ${w}`);
  }
  if (errors.length) {
    console.log(`\n${RED}  errors${RESET}`);
    for (const e of errors) console.log(`    - ${e}`);
  }

  const failed = errors.length > 0 || !boots;
  console.log(`\n  ${failed ? `${RED}FAIL${RESET}` : `${GREEN}OK${RESET}`}  ${INVENTORY.length} variables inventoried, ${errors.length} error(s), ${warnings.length} warning(s)\n`);
  process.exit(failed ? 1 : 0);
}

main();
